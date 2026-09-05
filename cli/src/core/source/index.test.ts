import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  coordinateFor,
  localSourceId,
  LOCAL_PREFIX,
  sourceFor,
  sourceForCoordinate,
} from "./index.ts";
import { readDirFiles } from "../skill/files.ts";
import { integrityOf } from "../skill/integrity.ts";
import { materialize } from "../install/store.ts";
import type { InstalledSkill } from "../install/destination.ts";

let tmp: string;
let dir: string;

const installed = (
  name: string,
  path: string,
  integrity: string,
  source = dir,
): InstalledSkill => ({
  name,
  source,
  path,
  integrity,
  track: "auto",
});

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "ski-source-test-")));
  process.env.SKI_HOME = join(tmp, "ski-home");
  dir = join(tmp, "workspace");
  await mkdir(join(dir, "skills", "alpha"), { recursive: true });
  await mkdir(join(dir, "skills", "beta"), { recursive: true });
  await writeFile(join(dir, "skills", "alpha", "SKILL.md"), "---\nname: alpha\n---\nv1\n");
  await writeFile(join(dir, "skills", "beta", "SKILL.md"), "---\nname: beta\n---\nbeta\n");
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

test("only the local: prefix means a directory; a bare path is a clonable repo", () => {
  expect(sourceFor(`${LOCAL_PREFIX}/tmp/x`).kind).toBe("local");
  expect(sourceFor(`${LOCAL_PREFIX}./x`).kind).toBe("local");
  expect(sourceFor("/tmp/x").kind).toBe("git");
  expect(sourceFor("https://github.com/o/r").kind).toBe("git");
  expect(sourceFor("git@github.com:o/r").kind).toBe("git");
});

test("sourceForCoordinate follows the syntax the user typed", () => {
  expect(sourceForCoordinate({ repo: "/tmp/x", kind: "local" }).kind).toBe("local");
  expect(sourceForCoordinate({ repo: "file:///tmp/x", kind: "git" }).kind).toBe("git");
});

test("a local source discovers the same layouts a repo does", async () => {
  const skills = await sourceForCoordinate({ repo: dir, kind: "local" }).discover(undefined);
  expect(skills.map((s) => s.name)).toEqual(["alpha", "beta"]);
  expect(skills.find((s) => s.name === "alpha")!.path).toBe("skills/alpha");
});

test("a directory resolves to a revision with neither commit nor branch", async () => {
  const source = sourceForCoordinate({ repo: dir, kind: "local" });
  expect(await source.resolve()).toEqual({ track: "auto" });
});

test("each skill is pinned by its own files, so a sibling edit leaves it alone", async () => {
  const source = sourceForCoordinate({ repo: dir, kind: "local" });
  const alphaIntegrity = integrityOf(await source.fetchFiles(undefined, "skills/alpha"));
  const betaIntegrity = integrityOf(await source.fetchFiles(undefined, "skills/beta"));
  expect(alphaIntegrity).not.toBe(betaIntegrity);

  const alpha = installed("alpha", "skills/alpha", alphaIntegrity);
  const beta = installed("beta", "skills/beta", betaIntegrity);
  expect((await source.upstream(alpha)).outdated).toBe(false);

  await writeFile(join(dir, "skills", "alpha", "SKILL.md"), "---\nname: alpha\n---\nv2\n");
  const moved = await source.upstream(alpha);
  expect(moved.outdated).toBe(true);
  expect(moved.revision).toEqual({ track: "auto" });
  expect((await source.upstream(beta)).outdated).toBe(false);
});

test("an emptied skill directory reports gone, not outdated", async () => {
  const source = sourceForCoordinate({ repo: dir, kind: "local" });
  await mkdir(join(dir, "skills", "hollow"), { recursive: true });
  const r = await source.upstream(
    installed("hollow", "skills/hollow", "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="),
  );
  expect(r.gone).toBe(true);
  expect(r.outdated).toBe(false);
});

test("a deleted skill directory reports gone, not an error", async () => {
  const source = sourceForCoordinate({ repo: dir, kind: "local" });
  const r = await source.upstream(
    installed("ghost", "skills/ghost", "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="),
  );
  expect(r.gone).toBe(true);
  expect(r.outdated).toBe(false);
});

test("local changes diff the installed store entry against the directory", async () => {
  const source = sourceForCoordinate({ repo: dir, kind: "local" });
  const before = await readDirFiles(join(dir, "skills", "beta"));
  const { entry, integrity } = await materialize(source.id, "beta", before);

  await writeFile(join(dir, "skills", "beta", "SKILL.md"), "---\nname: beta\n---\nedited\n");
  await writeFile(join(dir, "skills", "beta", "extra.md"), "new file\n");

  const changes = await source.changes(
    installed("beta", "skills/beta", integrity, source.id),
    undefined,
    entry,
  );
  expect(changes.patch).toContain("-beta");
  expect(changes.patch).toContain("+edited");
});

test("localSourceId is relative inside the project, absolute outside and global", () => {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    expect(localSourceId(join(dir, "skills", "alpha"), "project")).toBe(
      `${LOCAL_PREFIX}./skills/alpha`,
    );
    expect(localSourceId("/elsewhere/skill", "project")).toBe(`${LOCAL_PREFIX}/elsewhere/skill`);
    expect(localSourceId(join(dir, "skills", "alpha"), "global")).toBe(
      `${LOCAL_PREFIX}${join(dir, "skills", "alpha")}`,
    );
  } finally {
    process.chdir(prev);
  }
});

test("a project-scoped local source records its project-relative id", () => {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    expect(
      sourceForCoordinate({ repo: join(dir, "skills", "alpha"), kind: "local" }).forScope("project")
        .id,
    ).toBe(`${LOCAL_PREFIX}./skills/alpha`);
  } finally {
    process.chdir(prev);
  }
});

test("coordinateFor turns a recorded id back into something ski add accepts", async () => {
  await mkdir(join(dir, ".git"), { recursive: true });
  const prev = process.cwd();
  process.chdir(join(dir, "skills"));
  try {
    expect(coordinateFor(`${LOCAL_PREFIX}./skills/alpha`)).toBe(join(dir, "skills", "alpha"));
    expect(coordinateFor(`${LOCAL_PREFIX}/elsewhere/skill`)).toBe("/elsewhere/skill");
    expect(coordinateFor("https://github.com/owner/repo")).toBe("https://github.com/owner/repo");
  } finally {
    process.chdir(prev);
  }
});
