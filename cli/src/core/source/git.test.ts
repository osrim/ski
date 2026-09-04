import { afterEach, beforeEach, expect, test } from "bun:test";
import { $ } from "bun";
import { chmod, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODE_EXEC, MODE_FILE, MODE_SYMLINK } from "../skill/files.ts";
import {
  defaultBranch,
  diffSubtree,
  ensureClone,
  findRef,
  git,
  gitReason,
  headCommit,
  isBranch,
  listTags,
  lsTreeEntries,
  resolveRef,
  readBlob,
  sshAlternate,
  subtreeOid,
} from "./git.ts";

let tmp: string;
let remote: string;
let work: string;
let firstSha: string;
let previousCache: string | undefined;
let previousGitConfig: string | undefined;
let previousGitConfigCount: string | undefined;
let previousGitNoSystem: string | undefined;

const commit = async (message: string): Promise<string> => {
  await $`git -C ${work} add -A`.quiet();
  await $`git -C ${work} -c commit.gpgsign=false -c user.email=test@example.com -c user.name=Test commit -q -m ${message}`.quiet();
  return (await $`git -C ${work} rev-parse HEAD`.text()).trim();
};

const addSecondCommit = async (): Promise<string> => {
  await writeFile(join(work, "skills", "demo", "SKILL.md"), "second\n");
  await writeFile(join(work, "skills", "demo", "notes.txt"), "new\n");
  const sha = await commit("second");
  await $`git -C ${work} push -q origin main`.quiet();
  return sha;
};

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ski-git-test-"));
  previousCache = process.env.XDG_CACHE_HOME;
  previousGitConfig = process.env.GIT_CONFIG_GLOBAL;
  previousGitConfigCount = process.env.GIT_CONFIG_COUNT;
  previousGitNoSystem = process.env.GIT_CONFIG_NOSYSTEM;
  process.env.XDG_CACHE_HOME = join(tmp, "cache");
  process.env.GIT_CONFIG_GLOBAL = join(tmp, "empty-gitconfig");
  process.env.GIT_CONFIG_COUNT = "0";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  await writeFile(process.env.GIT_CONFIG_GLOBAL, "");
  remote = join(tmp, "remote.git");
  work = join(tmp, "work");

  await $`git init -q --bare --object-format=sha1 --initial-branch=main ${remote}`.quiet();
  await $`git init -q --object-format=sha1 --initial-branch=main ${work}`.quiet();
  await mkdir(join(work, "skills", "demo"), { recursive: true });
  await writeFile(join(work, "README.md"), "fixture\n");
  await writeFile(join(work, "run.sh"), "#!/bin/sh\necho fixture\n");
  await chmod(join(work, "run.sh"), 0o755);
  await writeFile(join(work, "skills", "demo", "SKILL.md"), "first\n");
  await symlink("README.md", join(work, "readme-link"));
  firstSha = await commit("first");
  await $`git -C ${work} remote add origin ${remote}`.quiet();
  await $`git -C ${work} push -q -u origin main`.quiet();
  await $`git -C ${work} branch topic`.quiet();
  await $`git -C ${work} push -q origin topic`.quiet();
  await $`git -C ${work} -c tag.gpgsign=false -c user.email=test@example.com -c user.name=Test tag -a v1.0.0 -m release`.quiet();
  await $`git -C ${work} tag preview`.quiet();
  await $`git -C ${work} push -q origin --tags`.quiet();
}, 30_000);

afterEach(async () => {
  if (previousCache === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = previousCache;
  if (previousGitConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = previousGitConfig;
  if (previousGitConfigCount === undefined) delete process.env.GIT_CONFIG_COUNT;
  else process.env.GIT_CONFIG_COUNT = previousGitConfigCount;
  if (previousGitNoSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
  else process.env.GIT_CONFIG_NOSYSTEM = previousGitNoSystem;
  await rm(tmp, { recursive: true, force: true });
}, 30_000);

test("git captures stdout, binary output, and failures", async () => {
  const text = await git(["show", "HEAD:README.md"], work);
  expect(text).toMatchObject({ code: 0, out: "fixture", err: "" });
  expect(text.buf).toEqual(Buffer.from("fixture\n"));

  const failure = await git(["rev-parse", "missing"], work);
  expect(failure.code).not.toBe(0);
  expect(failure.err).toContain("unknown revision");
});

test("ensureClone shares concurrent work and fetches later changes", async () => {
  const first = ensureClone(remote);
  expect(ensureClone(remote)).toBe(first);
  const clone = await first;
  expect(clone).toStartWith(join(process.env.XDG_CACHE_HOME!, "ski", "repos"));
  expect(await headCommit(clone, "main")).toBe(firstSha);

  const secondSha = await addSecondCommit();
  expect(await ensureClone(remote)).toBe(clone);
  expect(await headCommit(clone, "main")).toBe(secondSha);
});

test("a failed fetch replaces the cached clone from the source repository", async () => {
  const clone = await ensureClone(remote);
  await git(["remote", "set-url", "origin", join(tmp, "missing.git")], clone);

  expect(await ensureClone(remote)).toBe(clone);
  expect(await headCommit(clone, "main")).toBe(firstSha);
  expect((await git(["remote", "get-url", "origin"], clone)).out).toBe(remote);
});

test("a failed replacement preserves the last cached clone and permits a retry", async () => {
  const clone = await ensureClone(remote);
  await git(["remote", "set-url", "origin", join(tmp, "missing.git")], clone);
  const unavailable = `${remote}.unavailable`;
  await rename(remote, unavailable);

  expect(ensureClone(remote)).rejects.toThrow(`cannot reach ${remote}`);
  expect(await headCommit(clone, "main")).toBe(firstSha);

  await rename(unavailable, remote);
  expect(await ensureClone(remote)).toBe(clone);
});

test("a rejected initial clone can be retried after the repository appears", async () => {
  const lateRemote = join(tmp, "late.git");
  expect(ensureClone(lateRemote)).rejects.toThrow(`cannot reach ${lateRemote}`);
  await $`git init -q --bare --object-format=sha1 --initial-branch=main ${lateRemote}`.quiet();
  expect(await ensureClone(lateRemote)).toStartWith(
    join(process.env.XDG_CACHE_HOME!, "ski", "repos"),
  );
});

test("tree operations preserve paths, modes, contents, and subtree identity", async () => {
  const clone = await ensureClone(remote);
  expect(await lsTreeEntries(clone, firstSha, "")).toEqual([
    { mode: MODE_FILE, path: "README.md" },
    { mode: MODE_SYMLINK, path: "readme-link" },
    { mode: MODE_EXEC, path: "run.sh" },
    { mode: MODE_FILE, path: "skills/demo/SKILL.md" },
  ]);
  expect(await readBlob(clone, `${firstSha}:skills/demo/SKILL.md`)).toEqual(Buffer.from("first\n"));
  expect(await subtreeOid(clone, firstSha, "skills/demo")).toMatch(/^[0-9a-f]{40}$/u);
  expect(await subtreeOid(clone, firstSha, "missing")).toBeNull();
});

test("refs resolve branches, lightweight tags, annotated tags, and commits", async () => {
  const clone = await ensureClone(remote);
  expect(await findRef(clone, "main")).toBe(firstSha);
  expect(await findRef(clone, "preview")).toBe(firstSha);
  expect(await findRef(clone, "v1.0.0")).toBe(firstSha);
  expect(await findRef(clone, firstSha)).toBe(firstSha);
  expect(await findRef(clone, "missing")).toBeNull();
  expect(await resolveRef(clone, "topic")).toBe(firstSha);
  expect(resolveRef(clone, "missing")).rejects.toThrow('ref "missing" not found upstream');
  expect(await isBranch(clone, "topic")).toBe(true);
  expect(await isBranch(clone, "preview")).toBe(false);
  expect(await listTags(clone)).toEqual([
    { name: "preview", commit: firstSha },
    { name: "v1.0.0", commit: firstSha },
  ]);
});

test("defaultBranch falls back to ls-remote when origin/HEAD is absent", async () => {
  const clone = await ensureClone(remote);
  await git(["symbolic-ref", "--delete", "refs/remotes/origin/HEAD"], clone);
  expect(await defaultBranch(clone)).toBe("main");
});

test("defaultBranch reports an ls-remote failure", async () => {
  const clone = await ensureClone(remote);
  await git(["symbolic-ref", "--delete", "refs/remotes/origin/HEAD"], clone);
  await git(["remote", "set-url", "origin", join(tmp, "missing.git")], clone);
  expect(defaultBranch(clone)).rejects.toThrow("cannot determine the default branch");
});

test("diff operations report fixture changes at the repo and subtree levels", async () => {
  const clone = await ensureClone(remote);
  const secondSha = await addSecondCommit();
  await ensureClone(remote);
  const diff = await diffSubtree(clone, firstSha, secondSha, "skills/demo");
  expect(diff).toContain("-first");
  expect(diff).toContain("+second");
  expect(diff).toContain("notes.txt");
});

test("missing branches and invalid trees use the documented failure values", async () => {
  const clone = await ensureClone(remote);
  expect(headCommit(clone, "missing")).rejects.toThrow("branch missing not found upstream");
  expect(await lsTreeEntries(clone, "missing", "")).toEqual([]);
  expect(await diffSubtree(clone, "missing", firstSha, "")).toBe("");
});

test("an https address maps to the scp-style ssh address of the same repository", () => {
  expect(sshAlternate("https://github.com/owner/repo")).toBe("git@github.com:owner/repo");
  expect(sshAlternate("https://gitlab.com/group/sub/repo.git")).toBe(
    "git@gitlab.com:group/sub/repo.git",
  );
  expect(sshAlternate("https://github.com/owner/repo/")).toBe("git@github.com:owner/repo");
  expect(sshAlternate("git@github.com:owner/repo")).toBeNull();
  expect(sshAlternate(`file://${remote}`)).toBeNull();
  expect(sshAlternate("https://token@github.com/owner/repo")).toBeNull();
  expect(sshAlternate("https://github.com:8443/owner/repo")).toBeNull();
  expect(sshAlternate("https://github.com/")).toBeNull();
});

test("an unreachable https clone falls back to the ssh address", async () => {
  await writeFile(
    process.env.GIT_CONFIG_GLOBAL!,
    `[url "${remote}"]\n\tinsteadOf = git@ski-test.invalid:demo\n`,
  );
  const clone = await ensureClone("https://ski-test.invalid/demo");
  expect(await headCommit(clone, "main")).toBe(firstSha);
}, 30_000);

test("a failure on both addresses reports the https attempt the user named", async () => {
  await expect(ensureClone("https://ski-test.invalid/demo")).rejects.toThrow(
    /cannot reach https:\/\/ski-test\.invalid\/demo \(.*ski-test\.invalid/u,
  );
}, 30_000);

test("gitReason names auth and not-found failures and passes the rest through", () => {
  const remedy = "Private repos need an ssh key or a git credential helper that can read them.";
  expect(
    gitReason({
      err: "fatal: could not read Username for 'https://github.com': terminal prompts disabled\n",
    }),
  ).toBe(` (authentication failed)\n${remedy}`);
  expect(
    gitReason({
      err: "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.\n",
    }),
  ).toBe(` (authentication failed)\n${remedy}`);
  expect(
    gitReason({
      err: "remote: Repository not found.\nfatal: repository 'https://github.com/o/r/' not found\n",
    }),
  ).toBe(
    " (repository not found)\nCheck the name. A private repo also reads as not found when git has no credentials for it.",
  );
  expect(
    gitReason({
      err: "fatal: unable to access 'x': Could not resolve host: nope.invalid\n",
    }),
  ).toBe(" (unable to access 'x': Could not resolve host: nope.invalid)");
  expect(gitReason({ err: "" })).toBe("");
});
