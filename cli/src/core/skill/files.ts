import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

export interface SkillFile {
  path: string;
  content: Buffer;
  mode: string;
}

export const MODE_FILE = "100644";
export const MODE_EXEC = "100755";
export const MODE_SYMLINK = "120000";
export const isSymlink = (mode: string): boolean => mode === MODE_SYMLINK;

// Use code-unit order so integrity values do not depend on the system locale.
export const byPath = (a: { path: string }, b: { path: string }): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

const SKIP_DIRS = new Set([".git", "node_modules"]);

export const isSkillContent = (path: string): boolean =>
  !path.split("/").some((segment) => SKIP_DIRS.has(segment));

const walk = async (root: string, current: string, out: SkillFile[]): Promise<void> => {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(current, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(root, full, out);
      continue;
    }
    const path = relative(root, full).split(sep).join("/");
    if (entry.isSymbolicLink()) {
      out.push({ path, content: Buffer.from(await readlink(full)), mode: MODE_SYMLINK });
      continue;
    }
    if (!entry.isFile()) continue;
    const stats = await lstat(full);
    out.push({
      path,
      content: await readFile(full),
      mode: stats.mode & 0o111 ? MODE_EXEC : MODE_FILE,
    });
  }
};

export const readDirFiles = async (dir: string): Promise<SkillFile[]> => {
  const files: SkillFile[] = [];
  await walk(dir, dir, files);
  return files.toSorted(byPath);
};

export const writeFiles = async (dest: string, files: SkillFile[]): Promise<void> => {
  if (files.length === 0) throw new Error("nothing to install: skill has no files");
  for (const file of files) {
    const out = join(dest, file.path);
    await mkdir(dirname(out), { recursive: true });
    if (isSymlink(file.mode)) {
      await symlink(file.content.toString("utf8"), out);
    } else {
      await writeFile(out, file.content);
      if (file.mode === MODE_EXEC) await chmod(out, 0o755);
    }
  }
};
