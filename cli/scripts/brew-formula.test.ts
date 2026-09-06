import { expect, test } from "bun:test";
import { renderFormula, sha256For } from "./brew-formula.ts";

const ARM = "a".repeat(64);
const X64 = "b".repeat(64);
const CHECKSUMS = `${ARM}  ski-darwin-arm64.tar.gz\n${X64}  ski-darwin-x64.tar.gz\n`;

test("sha256For picks the line for the asset", () => {
  expect(sha256For(CHECKSUMS, "ski-darwin-arm64.tar.gz")).toBe(ARM);
  expect(() => sha256For(CHECKSUMS, "missing.tar.gz")).toThrow("no sha256");
  expect(() => sha256For("nope  ski-darwin-arm64.tar.gz\n", "ski-darwin-arm64.tar.gz")).toThrow();
});

test("renderFormula points each architecture at its tagged asset", () => {
  const formula = renderFormula("0.1.0", CHECKSUMS);
  expect(formula).toContain(
    'url "https://github.com/osrim/ski/releases/download/v0.1.0/ski-darwin-arm64.tar.gz"',
  );
  expect(formula).toContain(
    'url "https://github.com/osrim/ski/releases/download/v0.1.0/ski-darwin-x64.tar.gz"',
  );
  expect(formula).toContain(`sha256 "${ARM}"`);
  expect(formula).toContain(`sha256 "${X64}"`);
  expect(formula).toContain('version "0.1.0"');
  expect(() => renderFormula("0.1.0", `${ARM}  ski-darwin-arm64.tar.gz\n`)).toThrow("x64");
});
