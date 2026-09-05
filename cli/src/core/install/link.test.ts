import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
  readFile,
  readlink,
  lstat,
  realpath,
  rename,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { integrityOf } from "../skill/integrity.ts";
import { entryMatches, IntegrityError, materialize, storeEntryPath } from "./store.ts";
import {
  assertSkillsDirSafe,
  canonicalPath,
  copySkill,
  linkedAgents,
  linkSkill,
  occupiedAgents,
  removeCanonical,
  skillPath,
  unlinkSkill,
  writeCanonical,
} from "./link.ts";
import { skillsDir } from "./agents.ts";
import { dataDir, storeDir } from "../paths.ts";
import type { SkillFile } from "../skill/files.ts";
import { captureEnv } from "../../test-env.ts";

let tmp: string;

const restoreEnv = captureEnv("HOME", "SKI_HOME", "CLAUDE_HOME", "XDG_CONFIG_HOME");

const files: SkillFile[] = [
  { path: "SKILL.md", content: Buffer.from("hello\n"), mode: "100644" },
  { path: "scripts/run.sh", content: Buffer.from("echo hi\n"), mode: "100755" },
];

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ski-install-test-"));
  process.env.SKI_HOME = join(tmp, "ski-home");
  process.env.CLAUDE_HOME = join(tmp, "claude-home");
  process.env.XDG_CONFIG_HOME = join(tmp, "xdg-config");
  process.env.HOME = tmp;
});

afterAll(async () => {
  restoreEnv();
  await rm(tmp, { recursive: true, force: true });
});

const integrity = integrityOf(files);

// 32 bytes of 0xaa, so its hex is "a" * 64 and the store suffix is "a" * 12.
const allAA = "sha256-qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=";

test("storeEntryPath paths are per repo and integrity, under the store", () => {
  const entry = storeEntryPath("https://github.com/o/r", "demo", allAA);
  expect(entry).toBe(join(storeDir(), "github.com_o_r", `demo@${"a".repeat(12)}`));
  expect(storeEntryPath("local:./skills/x", "demo", allAA)).toBe(
    join(storeDir(), "local_._skills_x", `demo@${"a".repeat(12)}`),
  );
  expect(storeEntryPath("../..", "demo", allAA)).toBe(
    join(storeDir(), ".._..", `demo@${"a".repeat(12)}`),
  );
});

test("materialize writes files with modes, names the entry by what landed, and is immutable", async () => {
  const { entry, integrity: got } = await materialize("https://github.com/o/r", "demo", files);
  expect(got).toBe(integrity);
  expect(entry).toBe(storeEntryPath("https://github.com/o/r", "demo", integrity));
  expect(await readFile(join(entry, "SKILL.md"), "utf8")).toBe("hello\n");
  const mode = (await lstat(join(entry, "scripts", "run.sh"))).mode & 0o111;
  expect(mode).not.toBe(0);
  expect(existsSync(`${join(storeDir(), "github.com_o_r", "demo")}.tmp`)).toBe(false);

  expect((await materialize("https://github.com/o/r", "demo", files)).entry).toBe(entry);
  const other = [{ ...files[0]!, content: Buffer.from("other") }];
  expect((await materialize("https://github.com/o/r", "demo", other)).entry).not.toBe(entry);
  expect(await readFile(join(entry, "SKILL.md"), "utf8")).toBe("hello\n");
});

test("materialize with an expected integrity refuses a mismatch before anything lands", async () => {
  const expected = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  const run = materialize("https://github.com/o/r", "checked", files, expected);
  await expect(run).rejects.toBeInstanceOf(IntegrityError);
  const e = (await run.catch((x: unknown) => x)) as IntegrityError;
  expect(e.expected).toBe(expected);
  expect(e.actual).toBe(integrity);
  expect(existsSync(storeEntryPath("https://github.com/o/r", "checked", integrity))).toBe(false);
  expect(existsSync(`${join(storeDir(), "github.com_o_r", "checked")}.tmp`)).toBe(false);
  const ok = await materialize("https://github.com/o/r", "checked", files, integrity);
  expect(ok.integrity).toBe(integrity);
});

test("entryMatches sees an entry whose bytes drifted from the integrity in its name", async () => {
  const { entry } = await materialize("https://github.com/o/r", "verified", files);
  expect(await entryMatches(entry, integrity)).toBe(true);
  await writeFile(join(entry, "SKILL.md"), "changed\n");
  expect(await entryMatches(entry, integrity)).toBe(false);
});

test("materialize replaces an entry that was edited in place", async () => {
  const { entry } = await materialize("https://github.com/o/r", "edited", files);
  await writeFile(join(entry, "SKILL.md"), "hand edit\n");
  const again = await materialize("https://github.com/o/r", "edited", files);
  expect(again.entry).toBe(entry);
  expect(again.restored).toBe(true);
  expect(await readFile(join(entry, "SKILL.md"), "utf8")).toBe("hello\n");
  expect((await materialize("https://github.com/o/r", "edited", files)).restored).toBe(false);
});

test("materialize refuses an empty file set", async () => {
  await expect(materialize("https://github.com/o/r", "never", [])).rejects.toThrow("no files");
});

test.each([
  ["", 'invalid skill name ""'],
  [".", 'invalid skill name "."'],
  ["..", 'invalid skill name ".."'],
  ["a/b", 'invalid skill name "a/b"'],
  ["../x", 'invalid skill name "../x"'],
  ["a/", 'invalid skill name "a/"'],
])("store and agent paths refuse the name %p", async (name, message) => {
  expect(() => storeEntryPath("https://github.com/o/r", name, integrity)).toThrow(message);
  expect(() => skillPath(name, "global", "claude")).toThrow(message);
  await expect(materialize("https://github.com/o/r", name, files)).rejects.toThrow(message);
});

test.each([
  ["", 'invalid source ""'],
  [".", 'invalid source "."'],
  ["..", 'invalid source ".."'],
])("store paths refuse the source %p", async (source, message) => {
  expect(() => storeEntryPath(source, "demo", integrity)).toThrow(message);
  await expect(materialize(source, "demo", files)).rejects.toThrow(message);
});

test("a rejected name or source writes nothing outside the store", () => {
  expect(existsSync(join(dataDir(), "x.tmp"))).toBe(false);
  expect(existsSync(join(dataDir(), "demo.tmp"))).toBe(false);
  expect(existsSync(join(storeDir(), "github.com_o_r", "a"))).toBe(false);
});

test("linkSkill writes a relative link to the canonical copy; relink is idempotent", async () => {
  await writeCanonical("demo", files, "global");
  await linkSkill("demo", "global", "claude");
  const target = skillPath("demo", "global", "claude");
  expect((await lstat(target)).isSymbolicLink()).toBe(true);
  expect(await readlink(target)).toBe(join("..", "..", "ski-home", "skills", "demo"));
  expect(await realpath(target)).toBe(await realpath(canonicalPath("demo", "global")));
  await linkSkill("demo", "global", "claude");
});

test("one canonical copy, one relative link per agent, universal included", async () => {
  await linkSkill("demo", "global", "universal");
  await linkSkill("demo", "global", "opencode");

  expect((await lstat(canonicalPath("demo", "global"))).isDirectory()).toBe(true);
  for (const agent of ["claude", "opencode", "universal"] as const) {
    const link = await readlink(skillPath("demo", "global", agent));
    expect(isAbsolute(link)).toBe(false);
    expect(await realpath(skillPath("demo", "global", agent))).toBe(
      await realpath(canonicalPath("demo", "global")),
    );
  }
  expect(await linkedAgents("demo", "global")).toEqual(["claude", "opencode", "universal"]);
  expect(occupiedAgents("demo", "global")).toEqual(["claude", "opencode", "universal"]);
});

test("linkedAgents ignores links and directories that are not ours", async () => {
  const dir = skillsDir("global", "claude");
  await mkdir(join(dir, "handwritten"), { recursive: true });
  await symlink(join(tmp, "elsewhere"), join(dir, "outsider"));
  expect(await linkedAgents("handwritten", "global")).toEqual([]);
  expect(await linkedAgents("outsider", "global")).toEqual([]);
  expect(occupiedAgents("handwritten", "global")).toEqual(["claude"]);
});

test("a link written through a symlinked agent dir still resolves", async () => {
  const realClaude = join(tmp, "dotfiles", "claude");
  await mkdir(realClaude, { recursive: true });
  const prev = process.env.CLAUDE_HOME;
  process.env.CLAUDE_HOME = join(tmp, "claude-link");
  await symlink(realClaude, process.env.CLAUDE_HOME);
  try {
    await writeCanonical("dotted", files, "global");
    await linkSkill("dotted", "global", "claude");
    const target = skillPath("dotted", "global", "claude");
    expect(isAbsolute(await readlink(target))).toBe(false);
    expect(await readFile(join(target, "SKILL.md"), "utf8")).toBe("hello\n");
    expect(await linkedAgents("dotted", "global")).toEqual(["claude"]);
  } finally {
    process.env.CLAUDE_HOME = prev;
  }
});

test("a real dir at the target is refused, not clobbered", async () => {
  const target = skillPath("mine", "global", "claude");
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "SKILL.md"), "the user's own skill\n");

  await writeCanonical("mine", files, "global");
  await expect(linkSkill("mine", "global", "claude")).rejects.toThrow(
    "~/claude-home/skills/mine exists and is not managed by ski, skipped\nMove or delete it, then re-run.",
  );
  expect(await readFile(join(target, "SKILL.md"), "utf8")).toBe("the user's own skill\n");
});

test("copySkill writes a real dir, not a link, and linkedAgents does not claim it", async () => {
  const target = skillPath("copied", "global", "opencode");
  await copySkill("copied", files, "global", "opencode", false);

  expect((await lstat(target)).isSymbolicLink()).toBe(false);
  expect(await readFile(join(target, "SKILL.md"), "utf8")).toBe("hello\n");
  expect((await lstat(join(target, "scripts", "run.sh"))).mode & 0o111).not.toBe(0);
  expect(await linkedAgents("copied", "global")).toEqual([]);
});

test("copySkill refuses a foreign dir, replaces a managed one in place", async () => {
  const target = skillPath("copied", "global", "opencode");
  await writeFile(join(target, "notes.md"), "mine\n");
  await expect(copySkill("copied", files, "global", "opencode", false)).rejects.toThrow(
    "is not managed by ski, skipped",
  );
  expect(await readFile(join(target, "notes.md"), "utf8")).toBe("mine\n");

  await copySkill("copied", files, "global", "opencode", true);
  expect(existsSync(join(target, "notes.md"))).toBe(false);
  expect(await readFile(join(target, "SKILL.md"), "utf8")).toBe("hello\n");
});

test("unlinkSkill removes links but refuses foreign dirs; removeCanonical drops the copy", async () => {
  for (const agent of ["claude", "opencode", "universal"] as const) {
    await unlinkSkill("demo", "global", agent);
    expect(existsSync(skillPath("demo", "global", agent))).toBe(false);
  }
  expect(await linkedAgents("demo", "global")).toEqual([]);
  await unlinkSkill("demo", "global", "claude");
  expect(existsSync(canonicalPath("demo", "global"))).toBe(true);
  await removeCanonical("demo", "global");
  expect(existsSync(canonicalPath("demo", "global"))).toBe(false);

  const target = skillPath("real", "global", "claude");
  await mkdir(target, { recursive: true });
  expect(unlinkSkill("real", "global", "claude")).rejects.toThrow("not managed by ski");
});

test("a refusal names a path inside the project relative to it", async () => {
  const dir = join(tmp, "proj-refusal");
  await mkdir(join(dir, ".claude", "skills", "tdd"), { recursive: true });
  const prev = process.cwd();
  process.chdir(dir);
  try {
    await writeCanonical("tdd", files, "project");
    await expect(linkSkill("tdd", "project", "claude")).rejects.toThrow(
      ".claude/skills/tdd exists and is not managed by ski, skipped\nMove or delete it, then re-run.",
    );
  } finally {
    process.chdir(prev);
  }
});

test("writeCanonical in project scope hides .ski from Git with its own .gitignore", async () => {
  const dir = join(tmp, "proj-ignore");
  await mkdir(join(dir, ".git"), { recursive: true });
  const prev = process.cwd();
  process.chdir(dir);
  try {
    await writeCanonical("demo", files, "project");
    expect(await readFile(join(dir, ".ski", ".gitignore"), "utf8")).toBe("*\n");
    expect(await readFile(join(dir, ".ski", "skills", "demo", "SKILL.md"), "utf8")).toBe("hello\n");
    await writeFile(join(dir, ".ski", ".gitignore"), "# theirs\n");
    await writeCanonical("demo", files, "project");
    expect(await readFile(join(dir, ".ski", ".gitignore"), "utf8")).toBe("# theirs\n");
  } finally {
    process.chdir(prev);
  }
});

test("assertSkillsDirSafe rejects an agent skills dir that is the canonical dir", async () => {
  const dir = join(tmp, "proj-canonical");
  await mkdir(join(dir, ".ski", "skills"), { recursive: true });
  await mkdir(join(dir, ".claude"), { recursive: true });
  await mkdir(join(dir, ".opencode", "skills"), { recursive: true });
  const prev = process.cwd();
  process.chdir(dir);
  try {
    await symlink(join("..", ".ski", "skills"), join(dir, ".claude", "skills"));
    await expect(assertSkillsDirSafe("project", "claude")).rejects.toThrow(
      "are the same directory",
    );
    expect(await assertSkillsDirSafe("project", "opencode")).toBe(skillsDir("project", "opencode"));
    expect(await assertSkillsDirSafe("project", "universal")).toBe(
      skillsDir("project", "universal"),
    );
  } finally {
    process.chdir(prev);
  }
});

test("assertSkillsDirSafe rejects a skills dir symlinked into the store", async () => {
  const dir = join(tmp, "proj");
  await mkdir(join(dir, ".claude"), { recursive: true });
  await mkdir(storeDir(), { recursive: true });
  const prev = process.cwd();
  process.chdir(dir);
  try {
    await symlink(storeDir(), join(dir, ".claude", "skills"));
    expect(assertSkillsDirSafe("project", "claude")).rejects.toThrow("symlink into the store");
  } finally {
    process.chdir(prev);
  }
});

test("assertSkillsDirSafe rejects a project skills dir symlinked into a global agent dir", async () => {
  const dir = join(tmp, "proj-global-link");
  await mkdir(join(dir, ".claude"), { recursive: true });
  await mkdir(join(dir, ".opencode"), { recursive: true });
  await mkdir(join(dir, ".agents"), { recursive: true });
  const claudeGlobal = skillsDir("global", "claude");
  const opencodeGlobal = skillsDir("global", "opencode");
  await mkdir(claudeGlobal, { recursive: true });
  await mkdir(opencodeGlobal, { recursive: true });
  const elsewhere = join(tmp, "dotfiles-skills");
  await mkdir(elsewhere, { recursive: true });
  const prev = process.cwd();
  process.chdir(dir);
  try {
    await symlink(relative(join(dir, ".claude"), claudeGlobal), join(dir, ".claude", "skills"));
    await symlink(join(opencodeGlobal, "nested"), join(dir, ".opencode", "skills"));
    await symlink(elsewhere, join(dir, ".agents", "skills"));
    await expect(assertSkillsDirSafe("project", "claude")).rejects.toThrow(
      `is a symlink into a global skills dir (${await realpath(claudeGlobal)}).\nRemove it and re-run.`,
    );
    await expect(assertSkillsDirSafe("project", "opencode")).rejects.toThrow(
      "symlink into a global skills dir",
    );
    expect(await assertSkillsDirSafe("project", "universal")).toBe(
      skillsDir("project", "universal"),
    );
  } finally {
    process.chdir(prev);
  }
});

test("assertSkillsDirSafe leaves a global skills dir symlink alone", async () => {
  const universalGlobal = skillsDir("global", "universal");
  const claudeGlobal = skillsDir("global", "claude");
  await mkdir(claudeGlobal, { recursive: true });
  await mkdir(universalGlobal, { recursive: true });
  const aside = `${universalGlobal}.aside`;
  await rename(universalGlobal, aside);
  await symlink(claudeGlobal, universalGlobal);
  try {
    expect(await assertSkillsDirSafe("global", "universal")).toBe(universalGlobal);
  } finally {
    await rm(universalGlobal, { force: true });
    await rename(aside, universalGlobal);
  }
});

test("a symlink ski did not create is refused, not clobbered", async () => {
  const dir = skillsDir("global", "claude");
  await mkdir(dir, { recursive: true });
  const theirs = join(tmp, "their-skill");
  await mkdir(theirs, { recursive: true });
  await symlink(theirs, join(dir, "borrowed"));
  await symlink(join(tmp, "never-existed"), join(dir, "dangling"));

  await writeCanonical("borrowed", files, "global");
  await expect(linkSkill("borrowed", "global", "claude")).rejects.toThrow(
    "is not managed by ski, skipped",
  );
  expect(await readlink(join(dir, "borrowed"))).toBe(theirs);

  expect(occupiedAgents("dangling", "global")).toEqual(["claude"]);
  await writeCanonical("dangling", files, "global");
  await expect(linkSkill("dangling", "global", "claude")).rejects.toThrow(
    "is not managed by ski, skipped",
  );
  expect(await readlink(join(dir, "dangling"))).toBe(join(tmp, "never-existed"));
});

test("unlinkSkill refuses a symlink that does not point at the canonical dir", async () => {
  const dir = skillsDir("global", "universal");
  await mkdir(dir, { recursive: true });
  await symlink(join(tmp, "their-skill"), join(dir, "theirs"));
  expect(unlinkSkill("theirs", "global", "universal")).rejects.toThrow("not managed by ski");
  expect((await lstat(join(dir, "theirs"))).isSymbolicLink()).toBe(true);
});

test("skillPath refuses a name that leaves the skills dir", async () => {
  expect(() => skillPath("", "global", "claude")).toThrow('invalid skill name ""');
  expect(() => skillPath(".", "global", "claude")).toThrow('invalid skill name "."');
  expect(() => skillPath("..", "global", "claude")).toThrow('invalid skill name ".."');
  expect(() => skillPath("../x", "global", "claude")).toThrow('invalid skill name "../x"');
  expect(() => skillPath("a/b", "global", "claude")).toThrow('invalid skill name "a/b"');
  await expect(copySkill("../x", files, "global", "claude", true)).rejects.toThrow(
    "invalid skill name",
  );
  await expect(linkSkill("..", "global", "claude")).rejects.toThrow("invalid skill name");
  expect(existsSync(join(tmp, "x"))).toBe(false);
});
