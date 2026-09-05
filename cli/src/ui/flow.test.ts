import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkSkill, writeCanonical } from "../core/install/link.ts";
import { emptyLock, readLock } from "../core/install/lockfile.ts";
import { git } from "../core/source/git.ts";
import { land } from "./flow.ts";
import { captureEnv } from "../test-env.ts";

let tmp: string;
let cwd: string;

const restoreEnv = captureEnv("SKI_HOME");

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ski-flow-test-"));
  cwd = process.cwd();
  process.env.SKI_HOME = join(tmp, "ski-home");
});

afterAll(async () => {
  process.chdir(cwd);
  restoreEnv();
  process.exitCode = 0;
  await rm(tmp, { recursive: true, force: true });
});

test("lands later items after a failure, writes the lock, and hides links", async () => {
  const root = join(tmp, "project");
  await mkdir(root, { recursive: true });
  expect((await git(["init", "--quiet"], root)).code).toBe(0);
  process.chdir(root);

  const files = [{ path: "SKILL.md", content: Buffer.from("demo\n"), mode: "100644" }];
  await writeCanonical("works", files, "project");
  await linkSkill("works", "project", "claude");

  const lock = emptyLock();
  await land({
    items: ["fails", "works"],
    name: (item) => item,
    apply: (item) => {
      if (item === "fails") return Promise.reject(new Error("nope"));
      lock.skills[item] = {
        source: "local:demo",
        path: "",
        integrity: "sha256-qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=",
        track: "auto",
      };
      return Promise.resolve({ success: "worked" });
    },
    scope: "project",
    lock,
  });

  expect(process.exitCode).toBe(1);
  expect((await readLock("project")).skills).toEqual(lock.skills);
  expect(await readFile(join(root, ".git", "info", "exclude"), "utf8")).toContain(
    ".claude/skills/works",
  );
  process.exitCode = 0;
});
