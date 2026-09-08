import { afterAll, afterEach, beforeAll, beforeEach, expect, mock, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureEnv } from "../test-env.ts";
import { startUpdateCheck, upgradeHint } from "./update-check.ts";

const NOW = Date.UTC(2026, 7, 24, 12);
const TTL_MS = 24 * 60 * 60 * 1000;
const LATEST_RELEASE_URL = "https://api.github.com/repos/osrim/ski/releases/latest";

let tmp: string;
const restoreEnv = captureEnv(
  "XDG_CACHE_HOME",
  "CI",
  "SKI_NO_UPDATE_NOTIFIER",
  "NO_UPDATE_NOTIFIER",
);
let ttyDescriptor: PropertyDescriptor | undefined;
let execPathDescriptor: PropertyDescriptor | undefined;
let fetchDescriptor: PropertyDescriptor;
let fetchMock: ReturnType<typeof mock>;

const cachePath = (): string => join(process.env.XDG_CACHE_HOME!, "ski", "last-update-check");

const readCache = async (): Promise<unknown> => JSON.parse(await readFile(cachePath(), "utf8"));

const writeCache = async (content: string): Promise<void> => {
  await mkdir(join(process.env.XDG_CACHE_HOME!, "ski"), { recursive: true });
  await writeFile(cachePath(), content);
};

const cacheEntry = (checkedAt: number, latest: string): string =>
  JSON.stringify({ checkedAt, latest });

const latestRelease = (tag_name: unknown, status = 200): Response =>
  Response.json({ tag_name }, { status });

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ski-update-check-test-"));
  ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  execPathDescriptor = Object.getOwnPropertyDescriptor(process, "execPath");
  fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch")!;
});

beforeEach(async () => {
  process.env.XDG_CACHE_HOME = join(tmp, crypto.randomUUID());
  delete process.env.CI;
  delete process.env.SKI_NO_UPDATE_NOTIFIER;
  delete process.env.NO_UPDATE_NOTIFIER;
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
  Object.defineProperty(process, "execPath", {
    configurable: true,
    value: join(tmp, "plain", "ski"),
  });
  spyOn(fs, "existsSync").mockReturnValue(false);
  spyOn(Date, "now").mockReturnValue(NOW);
  fetchMock = mock(() => Promise.resolve(latestRelease("v1.2.0")));
  Object.defineProperty(globalThis, "fetch", { ...fetchDescriptor, value: fetchMock });
  await rm(process.env.XDG_CACHE_HOME, { recursive: true, force: true });
});

afterEach(() => {
  Object.defineProperty(globalThis, "fetch", fetchDescriptor);
  restoreEnv();
  if (ttyDescriptor === undefined) Reflect.deleteProperty(process.stdout, "isTTY");
  else Object.defineProperty(process.stdout, "isTTY", ttyDescriptor);
  if (execPathDescriptor === undefined) Reflect.deleteProperty(process, "execPath");
  else Object.defineProperty(process, "execPath", execPathDescriptor);
  mock.restore();
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

test("a newer release returns the update notice and records the check", async () => {
  expect(await startUpdateCheck("1.1.0", false)).toBe(
    "Update available: 1.1.0 → 1.2.0\nDownload it from https://github.com/osrim/ski/releases/latest",
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, options] = fetchMock.mock.calls[0]!;
  expect(url).toBe(LATEST_RELEASE_URL);
  expect(options).toMatchObject({
    headers: { Accept: "application/vnd.github+json" },
    signal: expect.any(AbortSignal),
  });
  expect(await readCache()).toEqual({ checkedAt: NOW, latest: "1.2.0" });
});

test("the upgrade hint names brew only for a Cellar binary", () => {
  const brew = "Run `brew upgrade osrim/tap/ski` to update.";
  const download = "Download it from https://github.com/osrim/ski/releases/latest";
  expect(upgradeHint("/opt/homebrew/Cellar/ski/1.2.0/bin/ski")).toBe(brew);
  expect(upgradeHint("/home/linuxbrew/.linuxbrew/Cellar/ski/1.2.0/bin/ski")).toBe(brew);
  expect(upgradeHint(join(tmp, "plain", "ski"))).toBe(download);
});

test("the upgrade hint resolves a symlink into the Cellar", async () => {
  const cellar = join(tmp, "Cellar", "ski", "1.2.0", "bin");
  await mkdir(cellar, { recursive: true });
  await writeFile(join(cellar, "ski"), "");
  await symlink(join(cellar, "ski"), join(tmp, "ski"));
  expect(upgradeHint(join(tmp, "ski"))).toContain("brew upgrade");
});

test("an up-to-date version is silent but still records the completed check", async () => {
  fetchMock.mockResolvedValueOnce(latestRelease("v1.1.0"));
  expect(await startUpdateCheck("1.1.0", false)).toBeNull();
  expect(await readCache()).toEqual({ checkedAt: NOW, latest: "1.1.0" });
});

test("a fresh cache with a newer version returns the notice without a request", async () => {
  await writeCache(cacheEntry(NOW - TTL_MS + 1, "1.2.0"));
  expect(await startUpdateCheck("1.1.0", false)).toBe(
    "Update available: 1.1.0 → 1.2.0\nDownload it from https://github.com/osrim/ski/releases/latest",
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

test.each([
  ["equal", "1.1.0"],
  ["older", "1.0.0"],
])("a fresh cache with an %s version is silent without a request", async (_name, latest) => {
  await writeCache(cacheEntry(NOW, latest));
  expect(await startUpdateCheck("1.1.0", false)).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("a stale cache triggers one request and rewrites both fields", async () => {
  await writeCache(cacheEntry(NOW - TTL_MS, "1.2.0"));
  fetchMock.mockResolvedValueOnce(latestRelease("v1.3.0"));
  expect(await startUpdateCheck("1.1.0", false)).toContain("1.1.0 → 1.3.0");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(await readCache()).toEqual({ checkedAt: NOW, latest: "1.3.0" });
});

test("a cache checked in the future triggers one request and rewrites both fields", async () => {
  await writeCache(cacheEntry(NOW + 1, "1.2.0"));
  fetchMock.mockResolvedValueOnce(latestRelease("v1.3.0"));
  expect(await startUpdateCheck("1.1.0", false)).toContain("1.1.0 → 1.3.0");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(await readCache()).toEqual({ checkedAt: NOW, latest: "1.3.0" });
});

test.each([
  ["a bare timestamp", String(NOW)],
  ["invalid JSON", "not-a-time"],
  ["a missing field", JSON.stringify({ checkedAt: NOW })],
])("%s in the cache counts as no prior check", async (_name, content) => {
  await writeCache(content);
  expect(await startUpdateCheck("1.1.0", false)).not.toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(await readCache()).toEqual({ checkedAt: NOW, latest: "1.2.0" });
});

test("a failed request keeps the cached notice and leaves the cache untouched", async () => {
  const stale = cacheEntry(NOW - TTL_MS, "1.2.0");
  await writeCache(stale);
  fetchMock.mockRejectedValueOnce(new Error("offline"));
  expect(await startUpdateCheck("1.1.0", false)).toContain("1.1.0 → 1.2.0");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(await readFile(cachePath(), "utf8")).toBe(stale);
});

test("an unwritable cache still returns the notice", async () => {
  await mkdir(cachePath(), { recursive: true });
  expect(await startUpdateCheck("1.1.0", false)).toContain("1.1.0 → 1.2.0");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test.each([
  ["JSON output", () => startUpdateCheck("1.1.0", true)],
  [
    "non-TTY output",
    () => {
      Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: false });
      return startUpdateCheck("1.1.0", false);
    },
  ],
  [
    "CI",
    () => {
      process.env.CI = "1";
      return startUpdateCheck("1.1.0", false);
    },
  ],
  [
    "the environment opt-out",
    () => {
      process.env.SKI_NO_UPDATE_NOTIFIER = "1";
      return startUpdateCheck("1.1.0", false);
    },
  ],
  [
    "the shared environment opt-out",
    () => {
      process.env.NO_UPDATE_NOTIFIER = "1";
      return startUpdateCheck("1.1.0", false);
    },
  ],
  [
    "a git checkout",
    () => {
      spyOn(fs, "existsSync").mockReturnValue(true);
      return startUpdateCheck("1.1.0", false);
    },
  ],
])("%s suppresses the check before fetching", async (_name, check) => {
  expect(await check()).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

test.each([
  ["an HTTP error", () => latestRelease("v1.2.0", 404)],
  ["a missing tag", () => latestRelease(null)],
  ["a non-string tag", () => latestRelease(120)],
  [
    "invalid JSON",
    () => new Response("not json", { headers: { "content-type": "application/json" } }),
  ],
])("%s fails silently without recording a check", async (_name, response) => {
  fetchMock.mockResolvedValueOnce(response());
  expect(await startUpdateCheck("1.1.0", false)).toBeNull();
  expect(readFile(cachePath(), "utf8")).rejects.toThrow();
});

test("a rejected request fails silently without recording a check", async () => {
  fetchMock.mockRejectedValueOnce(new Error("offline"));
  expect(await startUpdateCheck("1.1.0", false)).toBeNull();
  expect(readFile(cachePath(), "utf8")).rejects.toThrow();
});
