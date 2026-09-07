import { lstatSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

interface PathPlatform {
  isAbsolute(path: string): boolean;
  relative(from: string, to: string): string;
  sep: string;
}

const nativePaths: PathPlatform = { isAbsolute, relative, sep };

export const present = (path: string): boolean =>
  lstatSync(path, { throwIfNoEntry: false }) !== undefined;

// Resolves the deepest existing ancestor so a path inside a not-yet-created directory still compares.
export const realpathOrNearest = async (path: string): Promise<string> => {
  try {
    return await realpath(path);
  } catch {
    const parent = dirname(path);
    if (parent === path) return path;
    return join(await realpathOrNearest(parent), basename(path));
  }
};

export const relativeInside = (
  path: string,
  root: string,
  platform: PathPlatform = nativePaths,
): string | undefined => {
  const fromRoot = platform.relative(root, path);
  const outside =
    platform.isAbsolute(fromRoot) || fromRoot === ".." || fromRoot.startsWith(`..${platform.sep}`);
  if (outside) return undefined;
  return fromRoot.split(platform.sep).join("/") || ".";
};

export const isInside = (path: string, root: string): boolean =>
  relativeInside(path, root) !== undefined;

export const unmanagedError = (path: string): Error =>
  new Error(
    `ski skipped this skill because ${path} exists but is unmanaged.\nMove or delete it, then run the command again.`,
  );
