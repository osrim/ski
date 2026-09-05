import { afterAll, beforeEach, expect, test } from "bun:test";
import { isAbsolute } from "node:path";
import { captureEnv } from "../test-env.ts";
import {
  cacheDir,
  claudeDir,
  configDir,
  dataDir,
  envPath,
  lockPath,
  storeDir,
  userHome,
} from "./paths.ts";

const HOME = "/fixture/home";
const VARS = [
  "HOME",
  "SKI_HOME",
  "CLAUDE_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
] as const;
const restoreEnv = captureEnv(...VARS);

beforeEach(() => {
  process.env.HOME = HOME;
  for (const name of VARS.slice(1)) delete process.env[name];
});

afterAll(restoreEnv);

test("the three roots follow the XDG base directories", () => {
  expect(dataDir()).toBe("/fixture/home/.local/share/ski");
  expect(configDir()).toBe("/fixture/home/.config/ski");
  expect(cacheDir()).toBe("/fixture/home/.cache/ski");
});

test("each XDG variable moves its own root", () => {
  process.env.XDG_DATA_HOME = "/xdg/data";
  process.env.XDG_CONFIG_HOME = "/xdg/config";
  process.env.XDG_CACHE_HOME = "/xdg/cache";
  expect(dataDir()).toBe("/xdg/data/ski");
  expect(configDir()).toBe("/xdg/config/ski");
  expect(cacheDir()).toBe("/xdg/cache/ski");
});

test("the store and the global lockfile live under the data root", () => {
  expect(storeDir()).toBe("/fixture/home/.local/share/ski/store");
  expect(lockPath("global")).toBe("/fixture/home/.local/share/ski/ski-lock.json");
});

test("SKI_HOME replaces the data and config roots at once", () => {
  process.env.SKI_HOME = "/opt/ski";
  process.env.XDG_DATA_HOME = "/xdg/data";
  process.env.XDG_CONFIG_HOME = "/xdg/config";
  expect(dataDir()).toBe("/opt/ski");
  expect(configDir()).toBe("/opt/ski");
  expect(storeDir()).toBe("/opt/ski/store");
  expect(lockPath("global")).toBe("/opt/ski/ski-lock.json");
});

test("an empty variable falls back", () => {
  process.env.SKI_HOME = "";
  process.env.CLAUDE_HOME = "";
  expect(dataDir()).toBe("/fixture/home/.local/share/ski");
  expect(claudeDir()).toBe("/fixture/home/.claude");
});

test("a whitespace-only variable falls back", () => {
  process.env.SKI_HOME = "   ";
  expect(dataDir()).toBe("/fixture/home/.local/share/ski");
});

test("an empty HOME reaches the system home, never a relative path", () => {
  process.env.HOME = "";
  expect(isAbsolute(userHome())).toBe(true);
  expect(isAbsolute(dataDir())).toBe(true);
});

test("a relative required variable throws", () => {
  process.env.SKI_HOME = "store";
  expect(() => dataDir()).toThrow('SKI_HOME must be an absolute path, got "store".');
});

test("a tilde path says that the shell did not expand it", () => {
  process.env.CLAUDE_HOME = "~/.claude";
  expect(() => claudeDir()).toThrow("Environment variables do not expand `~`.");
});

test("surrounding whitespace is trimmed off an absolute value", () => {
  process.env.SKI_HOME = " /opt/ski ";
  expect(dataDir()).toBe("/opt/ski");
});

test("a relative XDG variable falls back instead of throwing", () => {
  process.env.XDG_CACHE_HOME = "cache";
  process.env.XDG_DATA_HOME = "data";
  expect(cacheDir()).toBe("/fixture/home/.cache/ski");
  expect(dataDir()).toBe("/fixture/home/.local/share/ski");
});

test("envPath reports an absolute value unchanged", () => {
  process.env.SKI_HOME = "/var/lib/ski";
  expect(envPath("SKI_HOME")).toBe("/var/lib/ski");
  expect(envPath("SKI_NOT_SET_AT_ALL")).toBeUndefined();
});
