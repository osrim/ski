import { expect, test } from "bun:test";
import { isNewerVersion, parseSemver, pickLatestTag } from "./semver.ts";

test("parseSemver accepts semver-ish tags and rejects the rest", () => {
  expect(parseSemver("1.2.3")).toEqual({ version: "1.2.3", prerelease: false });
  expect(parseSemver("v1.2.3")).toEqual({ version: "1.2.3", prerelease: false });
  expect(parseSemver("v0.5")).toEqual({ version: "0.5.0", prerelease: false });
  expect(parseSemver("1.2.3-beta.1")).toEqual({ version: "1.2.3-beta.1", prerelease: true });
  expect(parseSemver("1.2.3+build")).toEqual({ version: "1.2.3+build", prerelease: false });
  expect(parseSemver("v1")).toBeNull();
  expect(parseSemver("release-2026")).toBeNull();
  expect(parseSemver("1.2.3.4")).toBeNull();
});

test("isNewerVersion compares the numbers, not the strings", () => {
  expect(isNewerVersion("2.0.0", "1.10.0")).toBe(true);
  expect(isNewerVersion("1.10.0", "1.9.0")).toBe(true);
  expect(isNewerVersion("1.9.0", "1.10.0")).toBe(false);
  expect(isNewerVersion("1.2", "1.2.0")).toBe(false);
  expect(isNewerVersion("1.3", "1.2.9")).toBe(true);
  expect(isNewerVersion("2.0.0-rc.1", "1.9.0")).toBe(false);
  expect(isNewerVersion("1.2.3", "1.2.3-rc.1")).toBe(true);
  expect(isNewerVersion("release-2026", "1.0.0")).toBe(false);
});

const tag = (name: string, commit = "x") => ({ name, commit });

test("highest bare semver tag wins; prereleases are skipped", () => {
  const tags = [tag("v0.2.1"), tag("v0.5"), tag("v0.6.0-rc.1"), tag("not-a-version")];
  expect(pickLatestTag(tags, "skills")?.name).toBe("v0.5");
});

test("a lone prerelease tag is no tag at all", () => {
  expect(pickLatestTag([tag("v1.2.3-rc.1")], "skills")).toBeNull();
});

test("monorepo-scoped tags are preferred over bare ones", () => {
  const tags = [tag("v9.0.0"), tag("react-doctor@0.0.38"), tag("react-doctor@0.0.37")];
  expect(pickLatestTag(tags, "react-doctor")?.name).toBe("react-doctor@0.0.38");
  expect(pickLatestTag(tags, "other-repo")?.name).toBe("v9.0.0");
});

test("<repo>-vX.Y.Z scoping works too", () => {
  const tags = [tag("foo-v1.2.3"), tag("foo-v1.10.0"), tag("v0.1.0")];
  expect(pickLatestTag(tags, "foo")?.name).toBe("foo-v1.10.0");
});

test("no semver tags → null", () => {
  expect(pickLatestTag([tag("pinned-tag"), tag("release-2026")], "x")).toBeNull();
  expect(pickLatestTag([], "x")).toBeNull();
});
