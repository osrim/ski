import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { USAGE_ERROR } from "../usage.ts";
import { parseCoordinate, repoName } from "./coordinate.ts";

test("owner/repo shorthand expands to a GitHub URL", () => {
  expect(parseCoordinate("owner/repo")).toEqual({
    repo: "https://github.com/owner/repo",
    kind: "git",
  });
});

test("segments past the repo are the skill, and @ref pins it", () => {
  expect(parseCoordinate("owner/repo/pdf")).toEqual({
    repo: "https://github.com/owner/repo",
    kind: "git",
    skill: "pdf",
  });
  expect(parseCoordinate("owner/repo/skills/tdd")).toMatchObject({ skill: "skills/tdd" });
  expect(parseCoordinate("owner/repo@v1.2.0")).toMatchObject({ ref: "v1.2.0" });
  expect(parseCoordinate("owner/repo/tdd@v1.2.0")).toMatchObject({
    repo: "https://github.com/owner/repo",
    skill: "tdd",
    ref: "v1.2.0",
  });
});

test("# is refused as a usage error naming the path form", () => {
  for (const raw of ["owner/repo#pdf", "owner/repo@main#pdf", "o/r#", "./skill#a@v1"]) {
    expect(() => parseCoordinate(raw)).toThrow(
      "Put the skill in the path: owner/repo/tdd@v1.2.0 or ./repo/tdd.",
    );
  }
  try {
    parseCoordinate("owner/repo#pdf");
    expect.unreachable();
  } catch (e) {
    expect((e as Error).name).toBe(USAGE_ERROR);
  }
});

test("full URLs pass through with suffixes", () => {
  expect(parseCoordinate("https://github.com/o/r@develop")).toEqual({
    repo: "https://github.com/o/r",
    kind: "git",
    ref: "develop",
  });
  expect(parseCoordinate("git@github.com:o/r")).toMatchObject({
    repo: "git@github.com:o/r",
  });
  expect(parseCoordinate("git@github.com:o/r@v2")).toMatchObject({
    repo: "git@github.com:o/r",
    ref: "v2",
  });
});

test("local paths resolve to absolute local sources", () => {
  expect(parseCoordinate("./fixtures/repo")).toMatchObject({
    repo: resolve("./fixtures/repo"),
    kind: "local",
  });
  expect(parseCoordinate("/tmp/some/repo/skills/a")).toEqual({
    repo: "/tmp/some/repo/skills/a",
    kind: "local",
  });
  expect(parseCoordinate("file:///tmp/x@v1")).toMatchObject({
    repo: "file:///tmp/x",
    kind: "git",
    ref: "v1",
  });
});

test("~ expands to $HOME", () => {
  const prev = process.env.HOME;
  process.env.HOME = "/tmp/ski-test-home";
  try {
    expect(parseCoordinate("~/dev/skill")).toMatchObject({
      repo: "/tmp/ski-test-home/dev/skill",
      kind: "local",
    });
    expect(parseCoordinate("~")).toMatchObject({ repo: "/tmp/ski-test-home", kind: "local" });
  } finally {
    process.env.HOME = prev;
  }
});

test("a single-segment relative path is not a GitHub shorthand", () => {
  expect(parseCoordinate("./skill")).toMatchObject({ repo: resolve("./skill"), kind: "local" });
  expect(parseCoordinate("../skill")).toMatchObject({ repo: resolve("../skill"), kind: "local" });
});

test("a local path cannot carry a ref", () => {
  expect(() => parseCoordinate("./skill@v1")).toThrow("Local paths cannot use @ref");
});

test("garbage is rejected", () => {
  expect(() => parseCoordinate("")).toThrow("empty");
  expect(() => parseCoordinate("justaname")).toThrow("Invalid coordinate");
  expect(() => parseCoordinate("o/r@")).toThrow("empty ref");
});

test("repoName strips .git and trailing slashes", () => {
  expect(repoName("https://github.com/o/superpowers")).toBe("superpowers");
  expect(repoName("https://github.com/o/r.git")).toBe("r");
  expect(repoName("/tmp/upstream/")).toBe("upstream");
});

test("a GitHub tree URL yields the repo and an unsplit remainder", () => {
  expect(parseCoordinate("https://github.com/cursor/plugins/tree/main/pstack")).toEqual({
    repo: "https://github.com/cursor/plugins",
    kind: "git",
    tree: ["main", "pstack"],
  });
  expect(parseCoordinate("https://github.com/cursor/plugins/tree/main")).toEqual({
    repo: "https://github.com/cursor/plugins",
    kind: "git",
    tree: ["main"],
  });
});

test("a blob URL drops the filename, whichever way the ref splits", () => {
  expect(
    parseCoordinate("https://github.com/o/r/blob/main/pstack/skills/tdd/SKILL.md"),
  ).toMatchObject({ repo: "https://github.com/o/r", tree: ["main", "pstack", "skills", "tdd"] });
  expect(parseCoordinate("https://github.com/o/r/blob/main/SKILL.md")).toMatchObject({
    tree: ["main"],
  });
});

test("a URL naming a ref outright needs no split", () => {
  expect(parseCoordinate("https://github.com/o/r/releases/tag/v1.2.0")).toEqual({
    repo: "https://github.com/o/r",
    kind: "git",
    ref: "v1.2.0",
  });
  expect(parseCoordinate("https://github.com/o/r/commit/abc123")).toMatchObject({ ref: "abc123" });
});

test("query strings, www, and .git come off the repo URL", () => {
  expect(parseCoordinate("https://www.github.com/o/r.git/tree/main/x?tab=readme")).toEqual({
    repo: "https://github.com/o/r",
    kind: "git",
    tree: ["main", "x"],
  });
});

test("other forges parse by path shape, self-hosted included", () => {
  expect(parseCoordinate("https://gitlab.com/group/sub/repo/-/tree/main/x")).toEqual({
    repo: "https://gitlab.com/group/sub/repo",
    kind: "git",
    tree: ["main", "x"],
  });
  expect(parseCoordinate("https://codeberg.org/o/r/src/branch/main/x")).toMatchObject({
    repo: "https://codeberg.org/o/r",
    tree: ["main", "x"],
  });
  expect(parseCoordinate("https://bitbucket.org/o/r/src/main/x")).toMatchObject({
    tree: ["main", "x"],
  });
  expect(parseCoordinate("https://git.example.com/o/r/tree/main/x")).toMatchObject({
    repo: "https://git.example.com/o/r",
    tree: ["main", "x"],
  });
  expect(parseCoordinate("https://raw.githubusercontent.com/o/r/main/skills/tdd/SKILL.md")).toEqual(
    {
      repo: "https://github.com/o/r",
      kind: "git",
      tree: ["main", "skills", "tdd"],
    },
  );
});

test("a URL with no browser path is left alone as a clone URL", () => {
  expect(parseCoordinate("https://git.example.com/o/r.git")).toEqual({
    repo: "https://git.example.com/o/r.git",
    kind: "git",
  });
  expect(parseCoordinate("https://github.com/o/r")).toEqual({
    repo: "https://github.com/o/r",
    kind: "git",
  });
});

test("an explicit @ref wins over the ref the page showed", () => {
  expect(parseCoordinate("https://github.com/o/r/tree/main/x@v2")).toMatchObject({
    ref: "v2",
    tree: ["main", "x"],
  });
});

test("a URL carrying credentials is refused without echoing them", () => {
  for (const url of [
    "https://alice:ghp_secret@github.com/acme/private.git",
    "https://alice@github.com/acme/private.git",
    "https://alice:ghp_secret@github.com/acme/private/tree/main/skills",
  ]) {
    expect(() => parseCoordinate(url)).toThrow(
      "Remove the credentials from the URL.\nUse SSH or a git credential helper.",
    );
  }
});

test("an ssh URL keeps its username and refuses a password", () => {
  expect(() => parseCoordinate("ssh://alice:pw@example.com/acme/p.git")).toThrow(
    "Remove the password from the URL.\nUse an SSH key.",
  );
  expect(parseCoordinate("ssh://git@example.com/acme/p.git")).toMatchObject({
    repo: "ssh://git@example.com/acme/p.git",
    kind: "git",
  });
});

test("plain HTTP is refused with the https form", () => {
  expect(() => parseCoordinate("http://github.com/acme/repo")).toThrow(
    "Plain HTTP is not supported.\nUse https://github.com/acme/repo.",
  );
  expect(() => parseCoordinate("http://github.com/acme/repo/tree/main/skills")).toThrow(
    "Plain HTTP is not supported.",
  );
});
