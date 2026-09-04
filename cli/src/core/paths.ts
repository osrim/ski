import { basename, dirname, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import * as find from "empathic/find";

const LOCKFILE_NAME = "ski-lock.json";

export type Scope = "global" | "project";

export const childPath = (dir: string, name: string): string => {
  const target = join(dir, name);
  if (basename(name) !== name || dirname(target) !== dir) {
    throw new Error(`invalid skill name ${JSON.stringify(name)}`);
  }
  return target;
};

export const envPath = (name: string, required = true): string | undefined => {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") return undefined;
  if (isAbsolute(value)) return value;
  if (!required) return undefined;
  const hint = value.startsWith("~") ? " Environment variables do not expand `~`." : "";
  throw new Error(`${name} must be an absolute path, got ${JSON.stringify(value)}.${hint}`);
};

const systemHome = (): string | undefined => {
  try {
    return homedir();
  } catch {
    return undefined;
  }
};

export const userHome = (): string => {
  const home = envPath("HOME") ?? systemHome();
  if (home !== undefined && isAbsolute(home)) return home;
  throw new Error("Cannot determine your home directory. Set HOME to an absolute path.");
};

export const claudeDir = (): string => envPath("CLAUDE_HOME") ?? join(userHome(), ".claude");
export const skiHome = (): string => envPath("SKI_HOME") ?? join(userHome(), ".ski");
export const storeDir = (): string => join(skiHome(), "store");
export const canonicalDir = (scope: Scope): string =>
  join(scope === "global" ? skiHome() : join(projectRoot(), ".ski"), "skills");
export const cacheDir = (): string =>
  join(envPath("XDG_CACHE_HOME", false) ?? join(userHome(), ".cache"), "ski");

const ROOT_MARKERS = [LOCKFILE_NAME, ".claude", ".opencode", ".agents", ".git"];

export const projectRoot = (): string => {
  const cwd = process.cwd();
  const home = userHome();
  const marker = find.any(ROOT_MARKERS, { cwd, last: home });
  const root = marker === undefined ? cwd : dirname(marker);
  return root === home ? cwd : root;
};

export const lockPath = (scope: Scope): string =>
  scope === "global" ? join(skiHome(), LOCKFILE_NAME) : join(projectRoot(), LOCKFILE_NAME);
