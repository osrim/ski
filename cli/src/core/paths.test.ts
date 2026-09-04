import { afterEach, beforeEach, expect, test } from "bun:test";
import { isAbsolute } from "node:path";
import { cacheDir, claudeDir, envPath, skiHome, userHome } from "./paths.ts";

const HOME = "/fixture/home";
const VARS = ["HOME", "SKI_HOME", "CLAUDE_HOME", "XDG_CACHE_HOME"] as const;
const saved = new Map(VARS.map((name) => [name, process.env[name]]));

beforeEach(() => {
  process.env.HOME = HOME;
  delete process.env.SKI_HOME;
  delete process.env.CLAUDE_HOME;
  delete process.env.XDG_CACHE_HOME;
});

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("an empty variable falls back", () => {
  process.env.SKI_HOME = "";
  process.env.CLAUDE_HOME = "";
  expect(skiHome()).toBe("/fixture/home/.ski");
  expect(claudeDir()).toBe("/fixture/home/.claude");
});

test("a whitespace-only variable falls back", () => {
  process.env.SKI_HOME = "   ";
  expect(skiHome()).toBe("/fixture/home/.ski");
});

test("an empty HOME reaches the system home, never a relative path", () => {
  process.env.HOME = "";
  expect(isAbsolute(userHome())).toBe(true);
  expect(isAbsolute(skiHome())).toBe(true);
});

test("a relative required variable throws", () => {
  process.env.SKI_HOME = "store";
  expect(() => skiHome()).toThrow('SKI_HOME must be an absolute path, got "store".');
});

test("a tilde path says that the shell did not expand it", () => {
  process.env.CLAUDE_HOME = "~/.claude";
  expect(() => claudeDir()).toThrow("Environment variables do not expand `~`.");
});

test("surrounding whitespace is trimmed off an absolute value", () => {
  process.env.SKI_HOME = " /opt/ski ";
  expect(skiHome()).toBe("/opt/ski");
});

test("a relative XDG_CACHE_HOME falls back instead of throwing", () => {
  process.env.XDG_CACHE_HOME = "cache";
  expect(cacheDir()).toBe("/fixture/home/.cache/ski");
});

test("envPath reports an absolute value unchanged", () => {
  process.env.SKI_HOME = "/var/lib/ski";
  expect(envPath("SKI_HOME")).toBe("/var/lib/ski");
  expect(envPath("SKI_NOT_SET_AT_ALL")).toBeUndefined();
});
