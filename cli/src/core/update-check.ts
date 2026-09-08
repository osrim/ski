import { realpathSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import * as find from "empathic/find";
import { z } from "zod";
import { cacheDir } from "./paths.ts";
import { isNewerVersion } from "./source/semver.ts";

const LATEST_RELEASE_URL = "https://api.github.com/repos/osrim/ski/releases/latest";
const TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 1500;

const CacheSchema = z.object({ checkedAt: z.number(), latest: z.string() });

const cacheFile = (): string => join(cacheDir(), "last-update-check");

const readCache = async (): Promise<z.infer<typeof CacheSchema> | null> => {
  try {
    const parsed = CacheSchema.safeParse(JSON.parse(await readFile(cacheFile(), "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const writeCache = async (latest: string): Promise<void> => {
  try {
    await mkdir(cacheDir(), { recursive: true });
    await writeFile(cacheFile(), JSON.stringify({ checkedAt: Date.now(), latest }));
  } catch {}
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
  if (silenced(json)) return null;
  const cached = await readCache();
  let latest = cached?.latest ?? null;
  const age = cached ? Date.now() - cached.checkedAt : Infinity;
  if (age < 0 || age >= TTL_MS) {
    const fetched = await latestVersion();
    if (fetched) {
      await writeCache(fetched);
      latest = fetched;
    }
  }
  if (!latest || !isNewerVersion(latest, currentVersion)) return null;
  return `Update available: ${currentVersion} → ${latest}\n${upgradeHint(process.execPath)}`;
};
