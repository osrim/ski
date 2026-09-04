import { expect, test } from "bun:test";
import { parseFrontmatter } from "./frontmatter.ts";

test("parseFrontmatter reads, normalises, and trims a frontmatter mapping", () => {
  const fm = parseFrontmatter("---\nNAME: x\ndescription: ' y z '\nallowed-tools: Read\n---\nbody");
  expect(fm).toEqual({ name: "x", description: "y z", "allowed-tools": "Read" });
  expect(parseFrontmatter("no frontmatter")).toEqual({});
});

test("parseFrontmatter throws when the block is not a mapping", () => {
  expect(() => parseFrontmatter("---\njust a scalar\n---\n")).toThrow(SyntaxError);
  expect(parseFrontmatter("---\n\n---\n")).toEqual({});
});
