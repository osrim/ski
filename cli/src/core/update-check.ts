import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import * as find from "empathic/find";
import { cacheDir } from "./paths.ts";
import { isNewerVersion } from "./source/semver.ts";

const PACKAGE = "@0scrm/ski";
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE}/latest`;
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
  Boolean(process.env.SKI_NO_UPDATE_NOTIFIER) ||
  inGitCheckout();

const latestVersion = async (): Promise<string | null> => {
  try {
    const response = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return null;
    const body = (await response.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  }
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
  return `Update available: ${currentVersion} → ${latest}\nRun \`npm i -g ${PACKAGE}@latest\` to update.`;
};
