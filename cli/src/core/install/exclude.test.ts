import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { syncExcludes } from "./exclude.ts";
import { copySkill, linkSkill, removeCanonical, writeCanonical } from "./link.ts";
import { readLock, writeLock, type LockEntry } from "./lockfile.ts";
import { git } from "../source/git.ts";
import type { SkillFile } from "../skill/files.ts";

let tmp: string;
let prev: { cwd: string; home?: string | undefined; ski?: string | undefined };
let n = 0;

const BEGIN = "# >>> ski: managed skill links (rebuilt by `ski install`)";

const repo = async (init = true): Promise<string> => {
  const dir = join(tmp, `p${n++}`);
  await mkdir(dir, { recursive: true });
  process.chdir(dir);
  if (init) expect((await git(["init", "--quiet"], dir)).code).toBe(0);
  return process.cwd();
};

const files: SkillFile[] = [{ path: "SKILL.md", content: Buffer.from("x\n"), mode: "100644" }];

const row = (copy = false): LockEntry => ({
  source: "https://github.com/o/r",
  path: "",
  integrity: "sha256-qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=",
  mode: "auto",
  ...(copy ? { copy: true, agents: ["claude"] } : {}),
});

const link = async (name: string): Promise<void> => {
  await writeCanonical(name, files, "project");
  await linkSkill(name, "project", "claude");
  const lock = await readLock("project");
  lock.skills[name] = row();
  await writeLock("project", lock);
};

const readExclude = (root: string): Promise<string> =>
  readFile(join(root, ".git", "info", "exclude"), "utf8").catch(() => "");

const untracked = async (root: string): Promise<string> =>
  (await git(["status", "--porcelain", "-uall"], root)).out;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ski-exclude-test-"));
  prev = { cwd: process.cwd(), home: process.env.HOME, ski: process.env.SKI_HOME };
  process.env.HOME = tmp;
  process.env.SKI_HOME = join(tmp, "ski-home");
});

afterEach(() => process.chdir(prev.cwd));

afterAll(async () => {
  process.chdir(prev.cwd);
  process.env.HOME = prev.home;
  process.env.SKI_HOME = prev.ski;
  await rm(tmp, { recursive: true, force: true });
});

test("a link is hidden, .ski hides itself, and a hand-written skill beside it is not", async () => {
  const root = await repo();
  await link("demo");
  await mkdir(join(root, ".claude", "skills", "hand-written"), { recursive: true });
  await writeFile(join(root, ".claude", "skills", "hand-written", "SKILL.md"), "y\n");

  const sync = await syncExcludes();
  expect(sync.changed).toBe(true);
  expect(sync.patterns).toEqual([".claude/skills/demo"]);

  const status = await untracked(root);
  expect(status).toContain(".claude/skills/hand-written/SKILL.md");
  expect(status).not.toContain(".claude/skills/demo");
  expect(status).not.toContain(".ski/");
  expect(await readFile(join(root, ".ski", ".gitignore"), "utf8")).toBe("*\n");
});

test("a second sync changes nothing", async () => {
  const root = await repo();
  await link("demo");
  expect((await syncExcludes()).changed).toBe(true);
  const first = await readExclude(root);
  expect((await syncExcludes()).changed).toBe(false);
  expect(await readExclude(root)).toBe(first);
});

test("removing the link prunes its entry and leaves the file as found", async () => {
  const root = await repo();
  const file = join(root, ".git", "info", "exclude");
  await writeFile(file, "# mine\n*.log\n");
  await link("demo");
  await syncExcludes();
  expect(await readExclude(root)).toContain(".claude/skills/demo");

  await rm(join(root, ".claude", "skills", "demo"));
  await removeCanonical("demo", "project");
  const sync = await syncExcludes();
  expect(sync.changed).toBe(true);
  expect(sync.patterns).toEqual([]);
  expect(await readExclude(root)).toBe("# mine\n*.log\n");
});

test("the user's own lines survive a sync", async () => {
  const root = await repo();
  await writeFile(join(root, ".git", "info", "exclude"), "# mine\n*.log\n");
  await link("demo");
  await syncExcludes();
  const text = await readExclude(root);
  expect(text.startsWith("# mine\n*.log\n")).toBe(true);
  expect(text).toContain(BEGIN);
});

test("only link rows are listed, never a foreign link, a copy row, or an unlocked dir", async () => {
  const root = await repo();
  await link("demo");
  const outside = join(tmp, "elsewhere");
  await mkdir(outside, { recursive: true });
  await symlink(outside, join(root, ".claude", "skills", "borrowed"));
  await copySkill("copied", files, "project", "claude", false);
  await copySkill("copied", files, "project", "universal", false);
  await mkdir(join(root, ".agents", "skills", "unlocked"), { recursive: true });
  const lock = await readLock("project");
  lock.skills["copied"] = row(true);
  await writeLock("project", lock);
  expect((await syncExcludes()).patterns).toEqual([".claude/skills/demo"]);
});

test("outside a git repo nothing is written", async () => {
  await repo(false);
  expect(await syncExcludes()).toEqual({ patterns: [], changed: false });
});

test("a sibling worktree's entries survive a sync from this one", async () => {
  const main = await repo();
  const commit = [
    "-c",
    "user.email=t@t",
    "-c",
    "user.name=t",
    "commit",
    "--allow-empty",
    "-m",
    "i",
  ];
  expect((await git(commit, main)).code).toBe(0);
  await link("alpha");
  await syncExcludes();

  const other = join(tmp, `w${n++}`);
  expect((await git(["worktree", "add", "--quiet", "-b", "side", other], main)).code).toBe(0);
  process.chdir(other);
  await link("beta");
  const sync = await syncExcludes();

  expect(sync.patterns).toEqual([".claude/skills/alpha", ".claude/skills/beta"]);
  expect(await readExclude(main)).toContain(".claude/skills/alpha\n");
  expect(await untracked(main)).not.toContain(".claude/skills/alpha");
});

test("an entry no worktree can resolve is pruned", async () => {
  const main = await repo();
  const commit = [
    "-c",
    "user.email=t@t",
    "-c",
    "user.name=t",
    "commit",
    "--allow-empty",
    "-m",
    "i",
  ];
  expect((await git(commit, main)).code).toBe(0);
  await link("alpha");
  await syncExcludes();

  const other = join(tmp, `w${n++}`);
  expect((await git(["worktree", "add", "--quiet", "-b", "gone", other], main)).code).toBe(0);
  await rm(join(main, ".claude", "skills", "alpha"));
  process.chdir(other);
  expect((await syncExcludes()).patterns).toEqual([]);
});
