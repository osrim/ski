import { mkdir, rm, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import { cacheDir } from "../paths.ts";

interface GitResult {
  code: number;
  out: string;
  buf: Buffer;
  err: string;
}

export const git = async (
  args: string[],
  cwd?: string,
  env?: Record<string, string>,
): Promise<GitResult> => {
  const full = cwd ? ["git", "-C", cwd, ...args] : ["git", ...args];
  // Prevent Git from waiting for credentials during non-interactive runs.
  const result = await $`${full}`
    .env({ ...process.env, GIT_TERMINAL_PROMPT: "0", ...env })
    .nothrow()
    .quiet();
  const buf = result.stdout as Buffer;
  return {
    code: result.exitCode,
    out: buf.toString("utf8").trim(),
    buf,
    err: (result.stderr as Buffer).toString("utf8"),
  };
};

const pendingClones = new Map<string, Promise<string>>();

const AUTH_REMEDY = "Private repos need an ssh key or a git credential helper that can read them.";
const NOT_FOUND_REMEDY =
  "Check the name. A private repo also reads as not found when git has no credentials for it.";
const AUTH_FAILURE =
  /terminal prompts disabled|Authentication failed|Permission denied|Host key verification/u;
export const gitReason = (result: Pick<GitResult, "err">): string => {
  const line = result.err
    .trim()
    .split("\n")
    .findLast(Boolean)
    ?.replace(/^fatal:\s*/u, "");
  if (!line) return "";
  if (AUTH_FAILURE.test(result.err)) return ` (authentication failed)\n${AUTH_REMEDY}`;
  if (/repository .* not found/u.test(result.err)) {
    return ` (repository not found)\n${NOT_FOUND_REMEDY}`;
  }
  return ` (${line})`;
};

export const ensureClone = (repo: string): Promise<string> => {
  let pending = pendingClones.get(repo);
  if (!pending) {
    pending = cloneOrFetch(repo).finally(() => pendingClones.delete(repo));
    pendingClones.set(repo, pending);
  }
  return pending;
};

export const sshAlternate = (repo: string): string | null => {
  if (!repo.startsWith("https://") && !repo.startsWith("http://")) return null;
  let url: URL;
  try {
    url = new URL(repo);
  } catch {
    return null;
  }
  if (url.username || url.password || url.port) return null;
  const path = url.pathname.replace(/^\/+|\/+$/gu, "");
  return path ? `git@${url.hostname}:${path}` : null;
};

const cloneTo = async (repo: string, dest: string): Promise<GitResult> => {
  const args = ["clone", "--quiet", "--filter=blob:none", "--no-checkout"];
  const httpsAttempt = await git([...args, repo, dest]);
  const sshRepo = httpsAttempt.code === 0 ? null : sshAlternate(repo);
  if (!sshRepo) return httpsAttempt;
  await rm(dest, { recursive: true, force: true });
  // The automatic SSH retry must not request credentials or host-key approval.
  const sshAttempt = await git([...args, sshRepo, dest], undefined, {
    GIT_SSH_COMMAND: `${process.env.GIT_SSH_COMMAND ?? "ssh"} -o BatchMode=yes`,
  });
  return sshAttempt.code === 0 ? sshAttempt : httpsAttempt;
};

const cloneOrFetch = async (repo: string): Promise<string> => {
  const dir = join(cacheDir(), "repos", repo.replace(/[^a-zA-Z0-9]/gu, "_"));
  if (existsSync(dir)) {
    const fetched = await git(["fetch", "--quiet", "--prune", "--tags", "--force", "origin"], dir);
    if (fetched.code === 0) return dir;
    const fresh = `${dir}.new`;
    await rm(fresh, { recursive: true, force: true });
    const cloned = await cloneTo(repo, fresh);
    if (cloned.code !== 0) {
      await rm(fresh, { recursive: true, force: true });
      throw new Error(`cannot reach ${repo}${gitReason(cloned)}`);
    }
    await rm(dir, { recursive: true, force: true });
    await rename(fresh, dir);
    return dir;
  }
  await mkdir(join(cacheDir(), "repos"), { recursive: true });
  const cloned = await cloneTo(repo, dir);
  if (cloned.code !== 0) {
    await rm(dir, { recursive: true, force: true });
    throw new Error(`cannot reach ${repo}${gitReason(cloned)}`);
  }
  return dir;
};

export const headCommit = async (clone: string, branch: string): Promise<string> => {
  const result = await git(["rev-parse", `origin/${branch}`], clone);
  if (result.code !== 0) throw new Error(`branch ${branch} not found upstream`);
  return result.out;
};

export const subtreeOid = async (
  clone: string,
  rev: string,
  path: string,
): Promise<string | null> => {
  const result = await git(["rev-parse", `${rev}:${path}`], clone);
  return result.code === 0 ? result.out : null;
};

export interface TreeEntry {
  mode: string;
  path: string;
}

export const lsTreeEntries = async (
  clone: string,
  rev: string,
  path: string,
): Promise<TreeEntry[]> => {
  const args = ["ls-tree", "-r", rev, ...(path ? ["--", path] : [])];
  const result = await git(args, clone);
  if (result.code !== 0) return [];
  return result.out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [meta, entryPath] = line.split("\t") as [string, string];
      return { mode: meta.split(" ")[0]!, path: entryPath };
    });
};

export interface TagRef {
  name: string;
  commit: string;
}

export const listTags = async (clone: string): Promise<TagRef[]> => {
  // %(*objectname) resolves annotated tags to their commits.
  const result = await git(
    ["for-each-ref", "refs/tags", "--format=%(refname:short)%09%(objectname)%09%(*objectname)"],
    clone,
  );
  if (result.code !== 0) return [];
  return result.out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, tagObject, commit] = line.split("\t");
      return { name: name!, commit: commit || tagObject! };
    });
};

export const defaultBranch = async (clone: string): Promise<string> => {
  const result = await git(["symbolic-ref", "refs/remotes/origin/HEAD"], clone);
  if (result.code === 0) return result.out.replace("refs/remotes/origin/", "");
  const remote = await git(["ls-remote", "--symref", "origin", "HEAD"], clone);
  const match = remote.out.match(/^ref: refs\/heads\/(\S+)\tHEAD$/mu);
  if (match) return match[1]!;
  throw new Error("cannot determine the default branch");
};

export const findRef = async (clone: string, ref: string): Promise<string | null> => {
  for (const candidate of [`origin/${ref}`, `refs/tags/${ref}^{commit}`, `${ref}^{commit}`]) {
    const result = await git(["rev-parse", "--verify", "--quiet", candidate], clone);
    if (result.code === 0) return result.out;
  }
  return null;
};

export const resolveRef = async (clone: string, ref: string): Promise<string> => {
  const commit = await findRef(clone, ref);
  if (commit === null) throw new Error(`ref "${ref}" not found upstream`);
  return commit;
};

export const isBranch = async (clone: string, ref: string): Promise<boolean> => {
  const result = await git(
    ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${ref}`],
    clone,
  );
  return result.code === 0;
};

export const diffSubtree = async (
  clone: string,
  oldRev: string,
  newRev: string,
  path: string,
): Promise<string> => {
  const revspec = (rev: string): string => (path ? `${rev}:${path}` : `${rev}^{tree}`);
  const result = await git(["diff", "--stat", "--patch", revspec(oldRev), revspec(newRev)], clone);
  return result.code === 0 ? result.buf.toString("utf8") : "";
};

export const readBlob = async (clone: string, revspec: string): Promise<Buffer> =>
  (await git(["show", revspec], clone)).buf;
