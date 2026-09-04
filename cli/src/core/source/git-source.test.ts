import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";
import { GitSource } from "./git-source.ts";

let tmp: string;
let repo: string;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ski-git-source-test-"));
  process.env.XDG_CACHE_HOME = join(tmp, "cache");

  repo = join(tmp, "repo");
  await mkdir(join(repo, "pstack", "skills", "tdd"), { recursive: true });
  await writeFile(join(repo, "pstack", "skills", "tdd", "SKILL.md"), "---\nname: tdd\n---\n");
  await $`git -C ${repo} init -q -b main --template=`.quiet();
  await $`git -C ${repo} add -A`.quiet();
  await $`git -C ${repo} -c commit.gpgsign=false -c user.email=t@t -c user.name=t commit -q -m init`.quiet();
  await $`git -C ${repo} branch release/1.0`.quiet();
  await $`git -C ${repo} branch side`.quiet();
  await $`git -C ${repo} -c tag.gpgsign=false -c user.email=t@t -c user.name=t tag -a v1.2.0 -m release`.quiet();
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

test("the default branch splits off the subtree without becoming a ref", async () => {
  expect(await new GitSource(repo).splitTree(["main", "pstack"])).toEqual({ dir: "pstack" });
  expect(await new GitSource(repo).splitTree(["main"])).toEqual({ dir: "" });
});

test("a topic branch is a choice, so it stays a ref", async () => {
  expect(await new GitSource(repo).splitTree(["side", "pstack"])).toEqual({
    ref: "side",
    dir: "pstack",
  });
});

test("a slashed branch is found because the longest ref wins", async () => {
  expect(await new GitSource(repo).splitTree(["release", "1.0", "pstack"])).toEqual({
    ref: "release/1.0",
    dir: "pstack",
  });
});

test("a tag splits like a branch", async () => {
  expect(await new GitSource(repo).splitTree(["v1.2.0", "pstack"])).toEqual({
    ref: "v1.2.0",
    dir: "pstack",
  });
});

test("no prefix naming a ref leaves the whole remainder as a subtree", async () => {
  expect(await new GitSource(repo).splitTree(["nope", "pstack"])).toEqual({
    dir: "nope/pstack",
  });
});

test("discovery scoped to the split subtree finds the plugin's own skills", async () => {
  const source = new GitSource(repo);
  const { ref, dir } = await source.splitTree(["side", "pstack"]);
  const rev = await source.resolve(ref);
  const skills = await source.discover(rev.commit, dir);
  expect(skills.map((s) => [s.name, s.path])).toEqual([["tdd", "pstack/skills/tdd"]]);
});

const NO_COMMIT = "git source: no commit to read";

test("a read without a commit fails instead of standing in for a revision", async () => {
  const source = new GitSource(repo);
  await expect(source.discover(undefined)).rejects.toThrow(NO_COMMIT);
  await expect(source.fetchFiles(undefined, "pstack/skills/tdd")).rejects.toThrow(NO_COMMIT);
});
