import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MODE_EXEC,
  MODE_SYMLINK,
  isSkillContent,
  readDirFiles,
  writeFiles,
  type SkillFile,
} from "./files.ts";
import { integrityHex, integrityOf, integrityOfDir } from "./integrity.ts";

let dir: string;

const file = (path: string, text: string, mode = "100644"): SkillFile => ({
  path,
  content: Buffer.from(text),
  mode,
});

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ski-integrity-test-"));
  await mkdir(join(dir, "scripts"), { recursive: true });
  await mkdir(join(dir, ".git"), { recursive: true });
  await mkdir(join(dir, "node_modules", "pkg"), { recursive: true });
  await writeFile(join(dir, "SKILL.md"), "hello\n");
  await writeFile(join(dir, "scripts", "run.sh"), "echo hi\n");
  await chmod(join(dir, "scripts", "run.sh"), 0o755);
  await symlink("./SKILL.md", join(dir, "alias.md"));
  await writeFile(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
  await writeFile(join(dir, "node_modules", "pkg", "index.js"), "module.exports = 1\n");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("readDirFiles: relative paths, git modes, .git and node_modules skipped", async () => {
  const files = await readDirFiles(dir);
  expect(files.map((f) => f.path)).toEqual(["SKILL.md", "alias.md", "scripts/run.sh"]);

  expect(files.find((f) => f.path === "scripts/run.sh")!.mode).toBe(MODE_EXEC);
  const link = files.find((f) => f.path === "alias.md")!;
  expect(link.mode).toBe(MODE_SYMLINK);
  expect(link.content.toString()).toBe("./SKILL.md");
});

test("isSkillContent drops .git and node_modules at any depth, and nothing else", () => {
  expect(isSkillContent("SKILL.md")).toBe(true);
  expect(isSkillContent("scripts/node_modules.md")).toBe(true);
  expect(isSkillContent("node_modules/pkg/index.js")).toBe(false);
  expect(isSkillContent("vendor/.git/HEAD")).toBe(false);
});

test("integrityOf is SRI-formatted, deterministic, order-independent, content-sensitive", () => {
  const a = [file("a.md", "one"), file("b.md", "two")];
  expect(integrityOf(a)).toBe(integrityOf([...a].toReversed()));
  expect(integrityOf(a)).toMatch(/^sha256-[A-Za-z0-9+/]{43}=$/u);
  expect(integrityHex(integrityOf(a))).toMatch(/^[0-9a-f]{64}$/u);
  expect(() => integrityHex("f".repeat(64))).toThrow("not an integrity");

  expect(integrityOf([file("a.md", "one"), file("b.md", "CHANGED")])).not.toBe(integrityOf(a));
  expect(integrityOf([file("renamed.md", "one"), file("b.md", "two")])).not.toBe(integrityOf(a));
  expect(integrityOf([file("a.md", "one", MODE_EXEC), file("b.md", "two")])).not.toBe(
    integrityOf(a),
  );
});

test("integrityOf is stable across releases (pinned values)", () => {
  expect(integrityOf([file("b.md", "two"), file("a.md", "one")])).toBe(
    "sha256-49ZxxbpwUib6CPnZHOxozNL4HVfoDdhL07xHbJqgx6c=",
  );
  expect(
    integrityOf([
      file("SKILL.md", "hello\n"),
      file("scripts/run.sh", "#!/bin/sh\necho hi\n", MODE_EXEC),
      { path: "alias.md", content: Buffer.from("./SKILL.md"), mode: MODE_SYMLINK },
    ]),
  ).toBe("sha256-O7q38CfQ/qjNji5cciELE++NlgLvTNAQsi36pLLOy40=");
});

test("readDirFiles → writeFiles → readDirFiles is integrity-stable", async () => {
  const fetched: SkillFile[] = [
    file("SKILL.md", "hello\n"),
    file("scripts/run.sh", "#!/bin/sh\necho hi\n", MODE_EXEC),
    { path: "alias.md", content: Buffer.from("./SKILL.md"), mode: MODE_SYMLINK },
    { path: "odd.md", content: Buffer.from("./SKILL.md "), mode: MODE_SYMLINK },
  ];
  const out = join(dir, "roundtrip");
  await writeFiles(out, fetched);
  expect(await integrityOfDir(out)).toBe(integrityOf(fetched));
  expect(await integrityOfDir(out)).toBe(integrityOf(await readDirFiles(out)));

  const again = join(dir, "roundtrip-2");
  await writeFiles(again, await readDirFiles(out));
  expect(await integrityOfDir(again)).toBe(integrityOf(fetched));
});
