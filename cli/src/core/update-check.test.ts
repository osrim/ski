import { afterAll, afterEach, beforeAll, beforeEach, expect, mock, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureEnv } from "../test-env.ts";
import { markUpToDate, startUpdateCheck } from "./update-check.ts";

const NOW = Date.UTC(2026, 7, 24, 12);
const REGISTRY_URL = "https://registry.npmjs.org/@0scrm/ski/latest";

let tmp: string;
const restoreEnv = captureEnv(
  "XDG_CACHE_HOME",
  "CI",
  "SKI_NO_UPDATE_NOTIFIER",
  "NO_UPDATE_NOTIFIER",
);
let ttyDescriptor: PropertyDescriptor | undefined;
let fetchDescriptor: PropertyDescriptor;
let fetchMock: ReturnType<typeof mock>;

const stampPath = (): string => join(process.env.XDG_CACHE_HOME!, "ski", "last-update-check");

const registryVersion = (version: unknown, status = 200): Response =>
  Response.json({ version }, { status });

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ski-update-check-test-"));
  ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch")!;
});

beforeEach(async () => {
  process.env.XDG_CACHE_HOME = join(tmp, crypto.randomUUID());
  delete process.env.CI;
  delete process.env.SKI_NO_UPDATE_NOTIFIER;
  delete process.env.NO_UPDATE_NOTIFIER;
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
  spyOn(fs, "existsSync").mockReturnValue(false);
  spyOn(Date, "now").mockReturnValue(NOW);
  fetchMock = mock(() => Promise.resolve(registryVersion("1.2.0")));
  Object.defineProperty(globalThis, "fetch", { ...fetchDescriptor, value: fetchMock });
  await rm(process.env.XDG_CACHE_HOME, { recursive: true, force: true });
});

afterEach(() => {
  Object.defineProperty(globalThis, "fetch", fetchDescriptor);
  restoreEnv();
  if (ttyDescriptor === undefined) Reflect.deleteProperty(process.stdout, "isTTY");
  else Object.defineProperty(process.stdout, "isTTY", ttyDescriptor);
  mock.restore();
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

test("a newer registry version returns the npm update notice and records the check", async () => {
  expect(await startUpdateCheck("1.1.0", false)).toBe(
    "Update available: 1.1.0 → 1.2.0\nRun `npm i -g @0scrm/ski@latest` to update.",
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, options] = fetchMock.mock.calls[0]!;
  expect(url).toBe(REGISTRY_URL);
  expect(options).toMatchObject({ signal: expect.any(AbortSignal) });
  expect(await readFile(stampPath(), "utf8")).toBe(String(NOW));
});

test("an up-to-date version is silent but still records the completed check", async () => {
  fetchMock.mockResolvedValueOnce(registryVersion("1.1.0"));
  expect(await startUpdateCheck("1.1.0", false)).toBeNull();
  expect(await readFile(stampPath(), "utf8")).toBe(String(NOW));
});

test("a recent stamp skips the registry", async () => {
  await markUpToDate();
  expect(await startUpdateCheck("1.1.0", false)).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("an expired or invalid stamp permits another registry check", async () => {
  await markUpToDate();
  await writeFile(stampPath(), String(NOW - 24 * 60 * 60 * 1000));
  expect(await startUpdateCheck("1.1.0", false)).not.toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);

  await writeFile(stampPath(), "not-a-time");
  expect(await startUpdateCheck("1.1.0", false)).not.toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(2);
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
  ["an HTTP error", () => registryVersion({ error: "missing" }, 404)],
  ["a missing version", () => registryVersion(null)],
  ["a non-string version", () => registryVersion(120)],
  [
    "invalid JSON",
    () => new Response("not json", { headers: { "content-type": "application/json" } }),
  ],
])("%s fails silently without recording a check", async (_name, response) => {
  fetchMock.mockResolvedValueOnce(response());
  expect(await startUpdateCheck("1.1.0", false)).toBeNull();
  expect(readFile(stampPath(), "utf8")).rejects.toThrow();
});

test("a rejected registry request fails silently without recording a check", async () => {
  fetchMock.mockRejectedValueOnce(new Error("offline"));
  expect(await startUpdateCheck("1.1.0", false)).toBeNull();
  expect(readFile(stampPath(), "utf8")).rejects.toThrow();
});
