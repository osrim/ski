import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  emptyLock,
  isApproved,
  parseLock,
  readLock,
  serializeLock,
  writeLock,
  type Lockfile,
} from "./lockfile.ts";
import { lockPath, projectRoot } from "../paths.ts";
import { captureEnv } from "../../test-env.ts";

let tmp: string;

const restoreEnv = captureEnv("SKI_HOME");

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "ski-lock-test-")));
  process.env.SKI_HOME = join(tmp, "ski-home");
});

afterAll(async () => {
  restoreEnv();
  await rm(tmp, { recursive: true, force: true });
});

const integrity = "sha256-//////////////////////////////////////////8=";

const entry = {
  source: "https://github.com/o/r",
  branch: "main",
  path: "skills/tdd",
  commit: "a".repeat(40),
  integrity,
  mode: "auto" as const,
};

const local = {
  source: "local:./skills/mine",
  path: "",
  integrity,
  mode: "auto" as const,
};

const inDir = async <T>(dir: string, fn: () => T | Promise<T>): Promise<T> => {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(prev);
  }
};

test("missing lockfile reads as empty", async () => {
  expect(await readLock("global")).toEqual(emptyLock());
});

test("roundtrip preserves entries; entries are sorted by name; keys in row order", async () => {
  const lock: Lockfile = {
    lockfileVersion: 1,
    skills: {
      zeta: { ...entry, tag: "v1.2.0" },
      alpha: { ...entry, mode: "pin", pinnedAs: "v1" },
      bare: { ...entry, path: "" },
      mine: local,
    },
  };
  await writeLock("global", lock);
  expect(await readLock("global")).toEqual(lock);

  const raw = await readFile(lockPath("global"), "utf8");
  expect(JSON.parse(raw)).toEqual({
    lockfileVersion: 1,
    skills: {
      alpha: {
        source: entry.source,
        branch: "main",
        path: "skills/tdd",
        commit: entry.commit,
        integrity,
        mode: "pin",
        pinnedAs: "v1",
      },
      bare: {
        source: entry.source,
        branch: "main",
        path: "",
        commit: entry.commit,
        integrity,
        mode: "auto",
      },
      mine: {
        source: "local:./skills/mine",
        path: "",
        integrity,
        mode: "auto",
      },
      zeta: {
        source: entry.source,
        branch: "main",
        path: "skills/tdd",
        commit: entry.commit,
        integrity,
        mode: "auto",
        tag: "v1.2.0",
      },
    },
  });
  expect(raw.startsWith('{\n  "lockfileVersion": 1,')).toBe(true);
  expect(raw.indexOf("alpha")).toBeLessThan(raw.indexOf("zeta"));
  expect(raw.endsWith("\n")).toBe(true);
  expect(raw).not.toContain("null");
  const keys = Object.keys(
    (JSON.parse(raw) as { skills: Record<string, object> }).skills["alpha"]!,
  );
  expect(keys).toEqual(["source", "branch", "path", "commit", "integrity", "mode", "pinnedAs"]);
  const localKeys = Object.keys(
    (JSON.parse(raw) as { skills: Record<string, object> }).skills["mine"]!,
  );
  expect(localKeys).toEqual(["source", "path", "integrity", "mode"]);
});

test("a copy row keeps copy and agents through a round trip, in the documented key order", async () => {
  const copy = { ...entry, copy: true as const, agents: ["claude", "universal"] as const };
  await writeLock("global", {
    lockfileVersion: 1,
    skills: { tdd: { ...copy, agents: [...copy.agents] } },
  });
  const read = await readLock("global");
  expect(read.skills["tdd"]).toEqual({ ...copy, agents: [...copy.agents] });
  const raw = await readFile(lockPath("global"), "utf8");
  const keys = Object.keys((JSON.parse(raw) as { skills: Record<string, object> }).skills["tdd"]!);
  expect(keys).toEqual([
    "source",
    "branch",
    "path",
    "commit",
    "integrity",
    "mode",
    "copy",
    "agents",
  ]);
  await writeLock("global", { lockfileVersion: 1, skills: { tdd: entry } });
  expect(await readFile(lockPath("global"), "utf8")).not.toContain("copy");
});

test("isApproved matches only the exact (source, path, integrity) row; the commit is not part of it", () => {
  const lock: Lockfile = { lockfileVersion: 1, skills: { tdd: entry } };
  const at = { source: entry.source, path: entry.path, integrity };
  expect(isApproved(lock, "tdd", at)).toBe(true);
  expect(isApproved(lock, "other", at)).toBe(false);
  expect(
    isApproved(lock, "tdd", {
      ...at,
      integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    }),
  ).toBe(false);
  expect(isApproved(lock, "tdd", { ...at, source: "https://github.com/o/fork" })).toBe(false);
  expect(isApproved(lock, "tdd", { ...at, path: "" })).toBe(false);
  const moved: Lockfile = {
    lockfileVersion: 1,
    skills: { tdd: { ...entry, commit: "b".repeat(40) } },
  };
  expect(isApproved(moved, "tdd", at)).toBe(true);
});

test("isApproved does not see a row from the other scope", async () => {
  const at = { source: entry.source, path: entry.path, integrity };
  await writeLock("global", { lockfileVersion: 1, skills: { tdd: entry } });
  expect(isApproved(await readLock("global"), "tdd", at)).toBe(true);

  const dir = join(tmp, "scoped");
  await mkdir(dir, { recursive: true });
  await inDir(dir, async () => {
    expect(isApproved(await readLock("project"), "tdd", at)).toBe(false);
  });
});

test("parse errors: bad version, unparseable JSON, bad mode, missing or non-SRI integrity", () => {
  expect(() => parseLock('{"lockfileVersion":9,"skills":{}}', "f")).toThrow(
    "unsupported lockfile version 9",
  );
  expect(() => parseLock('{"skills":{}}', "f")).toThrow("unsupported lockfile version undefined");
  expect(() => parseLock("not json", "f")).toThrow("f:");
  expect(() => parseLock('{"lockfileVersion":1,"skills":{"a":{"mode":"nope"}}}', "f")).toThrow(
    'unknown mode "nope"',
  );
  expect(() =>
    parseLock(
      `{"lockfileVersion":1,"skills":{"a":{"source":"r","branch":"main","path":"","sha":"${"a".repeat(40)}","mode":"auto"}}}`,
      "ski-lock.json",
    ),
  ).toThrow("ski-lock.json: a: missing integrity");
  expect(() =>
    parseLock(
      `{"lockfileVersion":1,"skills":{"a":{"source":"r","path":"","integrity":"sha256:${"f".repeat(64)}","mode":"auto"}}}`,
      "ski-lock.json",
    ),
  ).toThrow("ski-lock.json: a: integrity must be sha256-<base64>");
  expect(parseLock("", "f")).toEqual(emptyLock());
});

test("projectRoot walks up to the nearest marker", async () => {
  const root = join(tmp, "repo");
  const deep = join(root, "src", "components");
  await mkdir(join(root, ".git"), { recursive: true });
  await mkdir(deep, { recursive: true });
  await inDir(deep, () => {
    expect(projectRoot()).toBe(root);
    expect(lockPath("project")).toBe(join(root, "ski-lock.json"));
  });

  const lockRoot = join(tmp, "lockroot");
  await mkdir(join(lockRoot, "nested"), { recursive: true });
  await writeFile(join(lockRoot, "ski-lock.json"), serializeLock(emptyLock()));
  await inDir(join(lockRoot, "nested"), () => {
    expect(projectRoot()).toBe(lockRoot);
  });
});

test("projectRoot falls back to cwd when nothing is found", async () => {
  const bare = join(tmp, "bare", "dir");
  await mkdir(bare, { recursive: true });
  await inDir(bare, () => {
    expect(projectRoot()).toBe(bare);
  });
});

test("parse errors: unsafe skill names and inconsistent copy configuration", () => {
  const lock = (name: string, extra = ""): string =>
    `{"lockfileVersion":1,"skills":{${JSON.stringify(name)}:{"source":"r","path":"","integrity":"${integrity}","mode":"auto"${extra}}}}`;
  expect(() => parseLock(lock(""), "f")).toThrow('f: invalid skill name ""');
  expect(() => parseLock(lock("."), "f")).toThrow('f: invalid skill name "."');
  expect(() => parseLock(lock(".."), "f")).toThrow('f: invalid skill name ".."');
  expect(() => parseLock(lock("a/b"), "f")).toThrow('f: invalid skill name "a/b"');
  expect(() => parseLock(lock("a\\b"), "f")).toThrow('f: invalid skill name "a\\\\b"');
  expect(() => parseLock(lock("../x"), "f")).toThrow('f: invalid skill name "../x"');
  expect(() => parseLock(lock("a", ',"copy":true,"agents":[]'), "f")).toThrow(
    "f: a: agents must name at least one agent",
  );
  expect(() => parseLock(lock("a", ',"copy":true'), "f")).toThrow(
    "f: a: copy and agents must appear together",
  );
  expect(() => parseLock(lock("a", ',"agents":["claude"]'), "f")).toThrow(
    "f: a: copy and agents must appear together",
  );
  expect(parseLock(lock("My_Skill.v2", ',"copy":true,"agents":["claude"]'), "f").skills).toEqual({
    "My_Skill.v2": {
      source: "r",
      path: "",
      integrity,
      mode: "auto",
      copy: true,
      agents: ["claude"],
    },
  });
});

test("a lockfile carrying installedAt loads without it and re-serializes without it", () => {
  const text = `{"lockfileVersion":1,"skills":{"tdd":{"source":"r","path":"","integrity":"${integrity}","mode":"auto","installedAt":"2026-08-03T12:00:00Z"}}}`;
  const parsed = parseLock(text, "ski-lock.json");
  expect(parsed.skills["tdd"]).toEqual({ source: "r", path: "", integrity, mode: "auto" });
  expect(serializeLock(parsed)).not.toContain("installedAt");
});
