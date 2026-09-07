import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureEnv } from "../../test-env.ts";
import { integrityOf } from "../skill/integrity.ts";
import type { SkillFile } from "../skill/files.ts";
import { locationDisplayPath, locationOf, modifiedSkills } from "./destination.ts";
import { normalizeCopyPath, pathCopyTarget } from "./path-copy.ts";

let tmp: string;
const restoreEnv = captureEnv("HOME");
const files: SkillFile[] = [{ path: "SKILL.md", content: Buffer.from("hello\n"), mode: "100644" }];
const integrity = integrityOf(files);

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "ski-path-copy-test-")));
  process.env.HOME = tmp;
});

afterAll(async () => {
  restoreEnv();
  await rm(tmp, { recursive: true, force: true });
});

const inDir = async <T>(dir: string, fn: () => T | Promise<T>): Promise<T> => {
  const previous = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(previous);
  }
};

test("normalizeCopyPath resolves from the project root and returns a relative path", async () => {
  const root = join(tmp, "project");
  const nested = join(root, "packages", "app");
  await mkdir(join(root, ".git"), { recursive: true });
  await mkdir(join(root, "actual"), { recursive: true });
  await symlink(join(root, "actual"), join(root, "alias"));
  await mkdir(nested, { recursive: true });

  await inDir(nested, async () => {
    expect(await normalizeCopyPath("./custom-directory")).toBe("custom-directory");
    expect(await normalizeCopyPath(join(root, "custom-directory"))).toBe("custom-directory");
    expect(await normalizeCopyPath("alias/skills")).toBe("actual/skills");
    expect(await pathCopyTarget("demo", "custom-directory")).toBe(
      join(root, "custom-directory", "demo"),
    );
  });
});

test("normalizeCopyPath and pathCopyTarget reject traversal, outside paths, and symlink escapes", async () => {
  const root = join(tmp, "safe-project");
  const outside = join(tmp, "outside");
  await mkdir(join(root, ".git"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await symlink(outside, join(root, "escaped"));
  await mkdir(join(root, "safe"), { recursive: true });
  await symlink(outside, join(root, "safe", "demo"));

  await inDir(root, async () => {
    await expect(normalizeCopyPath("")).rejects.toThrow("Pass a directory to --path");
    await expect(normalizeCopyPath("../outside")).rejects.toThrow("must not contain `..`");
    await expect(normalizeCopyPath("skills/../custom-directory")).rejects.toThrow(
      "must not contain `..`",
    );
    await expect(normalizeCopyPath(outside)).rejects.toThrow("outside the project root");
    await expect(normalizeCopyPath("skills\\custom-directory")).rejects.toThrow(
      "must not contain a backslash",
    );
    await expect(normalizeCopyPath("escaped/skills")).rejects.toThrow("outside the project root");
    await expect(pathCopyTarget("demo", "escaped")).rejects.toThrow("outside the project root");
    await expect(pathCopyTarget("demo", "safe")).rejects.toThrow("outside the project root");
  });
});

test("a path copy location reports its destination, presence, and modified state", async () => {
  const root = join(tmp, "located-project");
  await mkdir(join(root, ".git"), { recursive: true });

  await inDir(root, async () => {
    const skill = {
      name: "demo",
      source: "local:source",
      path: "",
      integrity,
      track: "auto" as const,
      copy: true as const,
      copyPath: "custom-directory",
    };
    expect(await locationOf(skill, "project")).toEqual({
      kind: "path-copy",
      copyPath: "custom-directory",
      present: false,
    });
    expect(
      locationDisplayPath("demo", {
        kind: "path-copy",
        copyPath: "custom-directory",
        present: false,
      }),
    ).toBe("custom-directory/demo");
    expect(locationDisplayPath("demo", { kind: "path-copy", copyPath: ".", present: true })).toBe(
      "demo",
    );

    const target = await pathCopyTarget("demo", "custom-directory");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "SKILL.md"), "hello\n");
    expect(await locationOf(skill, "project")).toEqual({
      kind: "path-copy",
      copyPath: "custom-directory",
      present: true,
    });
    expect([...(await modifiedSkills([skill], "project"))]).toEqual([]);

    await writeFile(join(target, "SKILL.md"), "edited\n");
    expect([...(await modifiedSkills([skill], "project"))]).toEqual(["demo"]);
  });
});
