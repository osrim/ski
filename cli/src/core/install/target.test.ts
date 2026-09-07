import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { join, win32 } from "node:path";
import { tmpdir } from "node:os";
import { isInside, present, realpathOrNearest, relativeInside } from "./target.ts";

let tmp: string;

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "ski-target-test-")));
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

test("isInside accepts the root and its descendants only", () => {
  expect(isInside("/a/b", "/a/b")).toBe(true);
  expect(isInside("/a/b/c/d", "/a/b")).toBe(true);
  expect(isInside("/a/bc", "/a/b")).toBe(false);
  expect(isInside("/a", "/a/b")).toBe(false);
  expect(isInside("/x/y", "/a/b")).toBe(false);
  expect(isInside("/a/b", "/")).toBe(true);
});

test("relativeInside normalizes Windows descendants and rejects another drive", () => {
  expect(relativeInside("C:\\project\\custom-directory", "C:\\project", win32)).toBe(
    "custom-directory",
  );
  expect(relativeInside("D:\\outside", "C:\\project", win32)).toBeUndefined();
});

test("realpathOrNearest resolves the deepest existing ancestor and keeps the rest", async () => {
  await mkdir(join(tmp, "real"), { recursive: true });
  await symlink(join(tmp, "real"), join(tmp, "alias"));
  expect(await realpathOrNearest(join(tmp, "alias", "new", "child"))).toBe(
    join(tmp, "real", "new", "child"),
  );
  expect(present(join(tmp, "alias"))).toBe(true);
  expect(present(join(tmp, "alias", "new"))).toBe(false);
});
