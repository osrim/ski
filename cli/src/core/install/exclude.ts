import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { git } from "../source/git.ts";
import { linkedAgents, skillPath } from "./link.ts";
import { placementOf, readLock } from "./lockfile.ts";
import { installedSkills } from "./destination.ts";
import { projectRoot } from "../paths.ts";

const BLOCK_BEGIN = "# >>> ski: managed skill links (rebuilt by `ski install`)";
const BLOCK_END = "# <<< ski";

const stripBlock = (text: string): string => {
  const lines = text.split("\n");
  const start = lines.indexOf(BLOCK_BEGIN);
  let kept = lines;
  if (start !== -1) {
    const end = lines.indexOf(BLOCK_END, start);
    kept = [...lines.slice(0, start), ...(end === -1 ? [] : lines.slice(end + 1))];
  }
  const joined = kept.join("\n").replace(/\n+$/u, "");
  return joined === "" ? "" : `${joined}\n`;
};

const blockPatterns = (text: string): string[] => {
  const lines = text.split("\n");
  const start = lines.indexOf(BLOCK_BEGIN);
  if (start === -1) return [];
  const end = lines.indexOf(BLOCK_END, start);
  return lines.slice(start + 1, end === -1 ? undefined : end).filter(Boolean);
};

export const replaceBlock = (current: string, patterns: string[]): string => {
  const kept = stripBlock(current);
  if (patterns.length === 0) return kept;
  const block = [BLOCK_BEGIN, ...patterns, BLOCK_END].join("\n");
  return `${kept}${kept === "" ? "" : "\n"}${block}\n`;
};

const excludeFile = async (root: string): Promise<string | null> => {
  const result = await git(["rev-parse", "--git-path", "info/exclude"], root);
  if (result.code !== 0) return null;
  return isAbsolute(result.out) ? result.out : join(root, result.out);
};

const managedPatterns = async (toplevel: string): Promise<string[]> => {
  const patterns: string[] = [];
  const links = installedSkills(await readLock("project")).filter(
    (skill) => placementOf(skill).kind === "link",
  );
  for (const { name } of links) {
    for (const agent of await linkedAgents(name, "project")) {
      const rel = relative(toplevel, skillPath(name, "project", agent));
      if (!rel.startsWith("..") && !isAbsolute(rel)) patterns.push(rel);
    }
  }
  return patterns;
};

const siblingWorktreePatterns = async (
  root: string,
  toplevel: string,
  existingPatterns: string[],
): Promise<string[]> => {
  if (existingPatterns.length === 0) return [];
  const result = await git(["worktree", "list", "--porcelain"], root);
  if (result.code !== 0) return [];
  const currentWorktree = await realpath(toplevel).catch(() => toplevel);
  const siblingWorktrees: string[] = [];
  for (const line of result.out.split("\n")) {
    if (!line.startsWith("worktree ")) continue;
    const dir = line.slice("worktree ".length);
    const worktree = await realpath(dir).catch(() => dir);
    if (worktree !== currentWorktree) siblingWorktrees.push(worktree);
  }
  return existingPatterns.filter((pattern) =>
    siblingWorktrees.some((worktree) => existsSync(join(worktree, pattern))),
  );
};

interface ExcludeSync {
  patterns: string[];
  changed: boolean;
}

export const syncExcludes = async (): Promise<ExcludeSync> => {
  const root = projectRoot();
  const file = await excludeFile(root);
  if (!file) return { patterns: [], changed: false };
  const toplevel = await git(["rev-parse", "--show-toplevel"], root);
  if (toplevel.code !== 0) return { patterns: [], changed: false };

  const current = await readFile(file, "utf8").catch(() => "");
  const own = await managedPatterns(toplevel.out);
  const sibling = await siblingWorktreePatterns(
    root,
    toplevel.out,
    blockPatterns(current).filter((pattern) => !own.includes(pattern)),
  );
  const patterns = [...own, ...sibling].toSorted();
  const next = replaceBlock(current, patterns);
  if (next === current) return { patterns, changed: false };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, next);
  return { patterns, changed: true };
};
