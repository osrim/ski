import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { configPath, parseConfig, readConfig, remember } from "./config.ts";

let tmp: string;
const previousHome = process.env.SKI_HOME;

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "ski-config-test-")));
  process.env.SKI_HOME = join(tmp, "ski-home");
});

beforeEach(async () => {
  await rm(configPath(), { force: true });
});

afterAll(async () => {
  if (previousHome === undefined) delete process.env.SKI_HOME;
  else process.env.SKI_HOME = previousHome;
  await rm(tmp, { recursive: true, force: true });
});

const writeConfig = async (text: string): Promise<void> => {
  await mkdir(join(tmp, "ski-home"), { recursive: true });
  await writeFile(configPath(), text);
};

test("no file is no preferences", async () => {
  expect(await readConfig()).toEqual({});
});

test("a recorded key reads back", async () => {
  await remember({ scope: "global", agents: ["opencode"] });
  expect(await readConfig()).toEqual({ scope: "global", agents: ["opencode"] });
});

test("recording a key merges with and overwrites prior values", async () => {
  await remember({ agents: ["claude"] });
  await remember({ scope: "global" });
  await remember({ scope: "project" });
  expect(await readConfig()).toEqual({ scope: "project", agents: ["claude"] });
});

test("a broken key drops alone", () => {
  expect(parseConfig('{"scope":"everywhere","agents":["claude"]}')).toEqual({
    agents: ["claude"],
  });
  expect(parseConfig('{"scope":"global","agents":["emacs"]}')).toEqual({ scope: "global" });
  expect(parseConfig('{"scope":"global","agents":"claude"}')).toEqual({ scope: "global" });
});

test("junk is no preferences", () => {
  expect(parseConfig("not json at all")).toEqual({});
  expect(parseConfig("null")).toEqual({});
  expect(parseConfig("[1, 2]")).toEqual({});
  expect(parseConfig("")).toEqual({});
});

test("a corrupt file does not stop a command", async () => {
  await writeConfig("{ truncated");
  expect(await readConfig()).toEqual({});
});

test("agent ids are normalised the way the flag is", async () => {
  await writeConfig('{"agents":["Claude","claude","opencode"]}');
  expect(await readConfig()).toEqual({ agents: ["claude", "opencode"] });
});
