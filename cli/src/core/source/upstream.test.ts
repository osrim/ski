import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";
import type { InstalledSkill } from "../install/destination.ts";
import { computeVerdicts, selectUpdates, type OutdatedVerdict } from "./upstream.ts";
import { integrityOf } from "../skill/integrity.ts";
import { ensureClone } from "./git.ts";
import { storeEntryPath } from "../install/store.ts";
import { skillPath } from "../install/link.ts";
import { applySkill } from "../install/apply.ts";
import { emptyLock } from "../install/lockfile.ts";
import { sourceFor } from "./index.ts";

let tmp: string;
let upstream: string;
let skill: InstalledSkill;
let v1 = "";
let v2 = "";
let prevHome: string | undefined;

const commitAll = async (message: string): Promise<string> => {
  await $`git -C ${upstream} add -A`.quiet();
  await $`git -C ${upstream} -c commit.gpgsign=false -c user.email=test@test -c user.name=test commit -q -m ${message}`.quiet();
  return (await $`git -C ${upstream} rev-parse HEAD`.text()).trim();
};

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ski-upstream-test-"));
  prevHome = process.env.HOME;
  process.env.HOME = tmp;
  process.env.XDG_CACHE_HOME = join(tmp, "cache");
  process.env.SKI_HOME = join(tmp, "ski-home");
  process.env.CLAUDE_HOME = join(tmp, "claude-home");

  upstream = join(tmp, "upstream");
  await mkdir(join(upstream, "skills", "demo"), { recursive: true });
  await $`git -C ${upstream} init -q -b main --template=`.quiet();
  await writeFile(join(upstream, "skills", "demo", "SKILL.md"), "v1\n");
  await writeFile(join(upstream, "skills", "demo", "extra.md"), "extra\n");
  v1 = await commitAll("v1");
  await $`git -C ${upstream} -c tag.gpgSign=false -c tag.forceSignAnnotated=false tag pinned-tag`.quiet();

  const files = await sourceFor(upstream).fetchFiles(v1, "skills/demo");
  skill = {
    name: "demo",
    source: upstream,
    branch: "main",
    path: "skills/demo",
    commit: v1,
    integrity: integrityOf(files),
    track: "auto",
  };

  await writeFile(join(upstream, "skills", "demo", "SKILL.md"), "v2\n");
  await rm(join(upstream, "skills", "demo", "extra.md"));
  await writeFile(join(upstream, "skills", "demo", "new.md"), "new\n");
  v2 = await commitAll("v2");
});

afterAll(async () => {
  process.env.HOME = prevHome;
  await rm(tmp, { recursive: true, force: true });
});

test("computeVerdicts detects upstream changes", async () => {
  const [verdict] = await computeVerdicts([skill]);
  expect(verdict!.kind).toBe("outdated");
  expect(verdict!.upstream.commit).toBe(v2);
  expect(verdict!.ahead).toBe(1);
});

test("the diff describes the update", async () => {
  const [verdict] = await computeVerdicts([skill]);
  const changes = await verdict!.source.changes(
    skill,
    v2,
    storeEntryPath(skill.source, skill.name, skill.integrity),
  );
  expect(changes.patch).toContain("-v1");
  expect(changes.patch).toContain("+v2");
});

test("update through the pipeline = new store entry + new canonical copy; the old entry survives", async () => {
  const [verdict] = await computeVerdicts([skill]);
  const source = verdict!.source;
  const lock = emptyLock();

  await applySkill(
    {
      name: skill.name,
      source: skill.source,
      path: skill.path,
      revision: { commit: v1, branch: "main", track: "auto" },
      files: () => source.fetchFiles(v1, skill.path),
    },
    { scope: "global", agents: ["claude"], lock },
  );
  const oldEntry = storeEntryPath(skill.source, skill.name, skill.integrity);
  expect(lock.skills[skill.name]!.commit).toBe(v1);
  expect(lock.skills[skill.name]!.integrity).toBe(skill.integrity);

  const newFiles = await source.fetchFiles(v2, skill.path);
  await applySkill(
    {
      name: skill.name,
      source: skill.source,
      path: skill.path,
      revision: verdict!.upstream,
      files: () => Promise.resolve(newFiles),
    },
    { scope: "global", agents: ["claude"], lock },
  );

  const target = skillPath(skill.name, "global", "claude");
  const newEntry = storeEntryPath(skill.source, skill.name, integrityOf(newFiles));
  expect(await readFile(join(newEntry, "SKILL.md"), "utf8")).toBe("v2\n");
  expect(await readFile(join(target, "SKILL.md"), "utf8")).toBe("v2\n");
  expect(await readFile(join(target, "new.md"), "utf8")).toBe("new\n");
  expect(lock.skills[skill.name]!.commit).toBe(v2);
  expect(lock.skills[skill.name]!.integrity).toBe(integrityOf(newFiles));
  expect(await readFile(join(oldEntry, "SKILL.md"), "utf8")).toBe("v1\n");
  expect(await readFile(join(oldEntry, "extra.md"), "utf8")).toBe("extra\n");
});

test("verdict is clean once the commit matches head", async () => {
  const [verdict] = await computeVerdicts([{ ...skill, commit: v2 }]);
  expect(verdict!.kind).toBe("up-to-date");
});

test("gone: upstream removed the skill's path", async () => {
  const [verdict] = await computeVerdicts([{ ...skill, path: "skills/removed" }]);
  expect(verdict!.kind).toBe("gone");
});

test("an unreachable upstream does not take down the batch", async () => {
  const dead: InstalledSkill = { ...skill, name: "dead", source: join(tmp, "gone") };
  const [good, bad] = await computeVerdicts([{ ...skill, commit: v2 }, dead]);
  expect(good!.kind).toBe("up-to-date");
  expect(bad).toMatchObject({
    kind: "unreachable",
    error: expect.stringContaining("cannot reach"),
  });
});

test("a git entry missing its commit or branch is an error, not a crash", async () => {
  const { commit: _c, ...noCommit } = skill;
  const { branch: _b, ...noBranch } = skill;
  const [a, b] = await computeVerdicts([noCommit, noBranch]);
  expect(a).toMatchObject({ kind: "unreachable", error: expect.stringContaining("no commit") });
  expect(b).toMatchObject({ kind: "unreachable", error: expect.stringContaining("no branch") });
});

test("track auto tracks the latest semver tag, not branch HEAD", async () => {
  const clone = await ensureClone(upstream);

  await $`git -C ${upstream} -c tag.gpgSign=false -c tag.forceSignAnnotated=false tag v0.1.0 ${v1}`.quiet();
  await $`git -C ${clone} fetch --quiet --prune --tags --force origin`.quiet();
  let [verdict] = await computeVerdicts([skill]);
  expect(verdict!.upstream.commit).toBe(v1);
  expect(verdict!.upstream.tag).toBe("v0.1.0");
  expect(verdict!.kind).toBe("up-to-date");

  await $`git -C ${upstream} -c tag.gpgSign=false -c tag.forceSignAnnotated=false tag v0.2.0 ${v2}`.quiet();
  await $`git -C ${clone} fetch --quiet --prune --tags --force origin`.quiet();
  [verdict] = await computeVerdicts([skill]);
  expect(verdict!.upstream.commit).toBe(v2);
  expect(verdict!.upstream.tag).toBe("v0.2.0");
  expect(verdict!.kind).toBe("outdated");
});

test("a pinned skill needs a name", async () => {
  const pinned = { ...skill, track: "pin" as const, pinnedAs: "pinned-tag" };
  const [held] = await computeVerdicts([pinned]);
  const [named] = await computeVerdicts([pinned], [skill.name]);
  expect(held!.kind).toBe("pinned");
  expect(named!.kind).toBe("outdated");
});

test("a rewritten pinned tag never auto-updates", async () => {
  await $`git -C ${upstream} -c tag.gpgSign=false -c tag.forceSignAnnotated=false tag -f pinned-tag ${v2}`.quiet();
  const pinned = { ...skill, track: "pin" as const, pinnedAs: "pinned-tag" };
  const [verdict] = await computeVerdicts([pinned], [skill.name]);
  expect(verdict).toMatchObject({
    kind: "rewritten",
    pinnedAs: "pinned-tag",
    expected: v1,
    actual: v2,
  });
});

test("moved without outdated is a bump", async () => {
  await writeFile(join(upstream, "README.md"), "release-only\n");
  const v3 = await commitAll("release-only");
  await $`git -C ${upstream} -c tag.gpgSign=false -c tag.forceSignAnnotated=false tag v0.3.0 ${v3}`.quiet();
  const [verdict] = await computeVerdicts([{ ...skill, commit: v2 }]);
  expect(verdict!.kind).toBe("moved");
});

test("a rewritten pinned ref wins over a removed skill", async () => {
  await rm(join(upstream, "skills", "demo"), { recursive: true });
  const v4 = await commitAll("removed");
  await $`git -C ${upstream} -c tag.gpgSign=false -c tag.forceSignAnnotated=false tag v0.4.0 ${v4}`.quiet();
  await $`git -C ${upstream} -c tag.gpgSign=false -c tag.forceSignAnnotated=false tag -f pinned-tag ${v4}`.quiet();
  const pinned = { ...skill, track: "pin" as const, pinnedAs: "pinned-tag" };
  const [verdict] = await computeVerdicts([pinned]);
  expect(verdict).toMatchObject({ kind: "rewritten", expected: v1, actual: v4 });
});

const outdatedStatus = (name: string): OutdatedVerdict => ({
  kind: "outdated",
  skill: {
    name,
    source: "r",
    branch: "main",
    path: `skills/${name}`,
    commit: "a".repeat(40),
    integrity: "sha256-qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=",
    track: "auto",
  },
  source: sourceFor("r"),
  upstream: { commit: "b".repeat(40), branch: "main", track: "auto" as const },
  ahead: 1,
});

const outdatedSet = [outdatedStatus("alpha"), outdatedStatus("beta")];

test("selectUpdates: explicit names select matching outdated skills", () => {
  const s = selectUpdates(outdatedSet, ["alpha"], false);
  expect(s.selected.map((x) => x.skill.name)).toEqual(["alpha"]);
  expect(s.skipped).toEqual([]);
  expect(s.needsPrompt).toBe(false);
});

test("selectUpdates: names not in the outdated set are reported as skipped", () => {
  const s = selectUpdates(outdatedSet, ["alpha", "gamma"], false);
  expect(s.selected.map((x) => x.skill.name)).toEqual(["alpha"]);
  expect(s.skipped).toEqual(["gamma"]);
});

test("selectUpdates: names win over --all", () => {
  const s = selectUpdates(outdatedSet, ["beta"], true);
  expect(s.selected.map((x) => x.skill.name)).toEqual(["beta"]);
});

test("selectUpdates: --all takes everything without prompting", () => {
  const s = selectUpdates(outdatedSet, [], true);
  expect(s.selected).toHaveLength(2);
  expect(s.needsPrompt).toBe(false);
});

test("selectUpdates: no names, no --all: prompt needed", () => {
  const s = selectUpdates(outdatedSet, [], false);
  expect(s.selected).toEqual([]);
  expect(s.needsPrompt).toBe(true);
});
