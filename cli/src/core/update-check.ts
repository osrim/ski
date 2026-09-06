import { realpathSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import * as find from "empathic/find";
import { cacheDir } from "./paths.ts";
import { isNewerVersion } from "./source/semver.ts";

const LATEST_RELEASE_URL = "https://api.github.com/repos/osrim/ski/releases/latest";
const TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 1500;

const stampFile = (): string => join(cacheDir(), "last-update-check");

const checkedRecently = async (): Promise<boolean> => {
  try {
    const stamp = Number.parseInt(await readFile(stampFile(), "utf8"), 10);
    return Number.isFinite(stamp) && Date.now() - stamp < TTL_MS;
  } catch {
    return false;
  }
};

export const markUpToDate = async (): Promise<void> => {
  await mkdir(cacheDir(), { recursive: true });
  await writeFile(stampFile(), String(Date.now()));
};

const inGitCheckout = (): boolean => find.up(".git", { cwd: import.meta.dir }) !== undefined;

const silenced = (json: boolean): boolean =>
  json ||
  !process.stdout.isTTY ||
  Boolean(process.env.CI) ||
  Boolean(process.env.NO_UPDATE_NOTIFIER) ||
  Boolean(process.env.SKI_NO_UPDATE_NOTIFIER) ||
  inGitCheckout();

const latestVersion = async (): Promise<string | null> => {
  try {
    const response = await fetch(LATEST_RELEASE_URL, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { tag_name?: unknown };
    return typeof body.tag_name === "string" ? body.tag_name.replace(/^v/u, "") : null;
  } catch {
    return null;
  }
};

export const upgradeHint = (binary: string): string => {
  let resolved = binary;
  try {
    resolved = realpathSync(binary);
  } catch {}
  return resolved.includes("/Cellar/")
    ? "Run `brew upgrade osrim/tap/ski` to update."
    : "Download it from https://github.com/osrim/ski/releases/latest";
};

export const startUpdateCheck = async (
  currentVersion: string,
  json: boolean,
): Promise<string | null> => {
  if (silenced(json) || (await checkedRecently())) return null;
  const latest = await latestVersion();
  if (!latest) return null;
  await markUpToDate();
  if (!isNewerVersion(latest, currentVersion)) return null;
  return `Update available: ${currentVersion} → ${latest}\n${upgradeHint(process.execPath)}`;
};
