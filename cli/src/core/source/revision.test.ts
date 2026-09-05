import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";
import { ensureClone } from "./git.ts";
import { displayLabel, resolveRevision, resolveUpstream, shortId } from "./revision.ts";

const commit = "0123456789abcdef0123456789abcdef01234567";
const integrity = "sha256-/ty6mHZUMhAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

test("shortId: first 8 hex of the commit, else of the integrity, else nothing", () => {
  expect(shortId({ commit })).toBe("01234567");
  expect(shortId({ commit, integrity })).toBe("01234567");
  expect(shortId({ integrity })).toBe("fedcba98");
  expect(shortId({})).toBe("");
});

test("displayLabel: pinned ref, else tag, else short id", () => {
  expect(displayLabel({ pinnedAs: "v1.2.0", tag: "v1.3.0", commit })).toBe("v1.2.0");
  expect(displayLabel({ tag: "v1.3.0", commit })).toBe("v1.3.0");
  expect(displayLabel({ commit })).toBe("01234567");
  expect(displayLabel({ integrity })).toBe("fedcba98");
});

let tmp: string;
let upstream: string;
let first = "";
let second = "";

const commitAll = async (message: string): Promise<string> => {
  await $`git -C ${upstream} add -A`.quiet();
  await $`git -C ${upstream} -c commit.gpgsign=false -c user.email=test@test -c user.name=test commit -q -m ${message}`.quiet();
  return (await $`git -C ${upstream} rev-parse HEAD`.text()).trim();
};

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ski-revision-test-"));
  process.env.XDG_CACHE_HOME = join(tmp, "cache");

  upstream = join(tmp, "upstream");
  await mkdir(upstream, { recursive: true });
  await $`git -C ${upstream} init -q -b main --template=`.quiet();
  await writeFile(join(upstream, "SKILL.md"), "one\n");
  first = await commitAll("one");
  await writeFile(join(upstream, "SKILL.md"), "two\n");
  second = await commitAll("two");
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

test("no releases: track auto follows branch HEAD, no tag", async () => {
  const clone = await ensureClone(upstream);
  const rev = await resolveRevision(clone, upstream);
  expect(rev).toEqual({ commit: second, branch: "main", track: "auto" });
});

test("with a release: track auto resolves the latest semver tag", async () => {
  await $`git -C ${upstream} -c tag.gpgSign=false -c tag.forceSignAnnotated=false tag v0.1.0 ${first}`.quiet();
  const clone = await ensureClone(upstream);
  await $`git -C ${clone} fetch --quiet --prune --tags --force origin`.quiet();
  const rev = await resolveRevision(clone, upstream);
  expect(rev).toEqual({ commit: first, branch: "main", track: "auto", tag: "v0.1.0" });

  const latest = await resolveUpstream(clone, upstream, "main");
  expect(latest).toEqual({ commit: first, tag: "v0.1.0" });
});

test("pin to a tag: pinnedAs records the symbolic ref", async () => {
  const clone = await ensureClone(upstream);
  const rev = await resolveRevision(clone, upstream, "v0.1.0");
  expect(rev).toEqual({ commit: first, branch: "main", track: "pin", pinnedAs: "v0.1.0" });
});

test("pin to a branch: no pinnedAs (branches move legitimately)", async () => {
  const clone = await ensureClone(upstream);
  const rev = await resolveRevision(clone, upstream, "main");
  expect(rev).toEqual({ commit: second, branch: "main", track: "pin" });
});

test("pin to a full commit: no pinnedAs (nothing symbolic to drift)", async () => {
  const clone = await ensureClone(upstream);
  const rev = await resolveRevision(clone, upstream, first);
  expect(rev).toEqual({ commit: first, branch: "main", track: "pin" });
});
