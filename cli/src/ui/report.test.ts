import { expect, test } from "bun:test";
import type { Finding } from "../core/scan/index.ts";
import { renderFindings } from "./report.ts";

test("renderFindings renders the supplied help literally", () => {
  const findings: Finding[] = [
    {
      severity: "critical",
      rule: "hooks",
      help: "literal help from the scanner",
      file: "SKILL.md",
      line: 4,
      detail: "PreToolUse -> ./inspect.sh",
    },
    {
      severity: "warn",
      rule: "executable",
      help: "ships an executable",
      file: "scripts/run.sh",
      detail: "executable file",
    },
  ];

  expect(Bun.stripANSI(renderFindings("fixture", findings))).toBe(
    [
      "fixture: security scan",
      "",
      "1 critical finding",
      "  hooks: literal help from the scanner",
      "    SKILL.md:4  PreToolUse -> ./inspect.sh",
      "",
      "1 warn finding",
      "  executable: ships an executable",
      "    scripts/run.sh  executable file",
    ].join("\n"),
  );
});
