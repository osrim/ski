import { expect, test } from "bun:test";
import { agentRows, preferredAgents, shadowNote } from "./destination.ts";

const SGR = new RegExp(`${"\\u001B"}\\[[\\d;]*m`, "gu");
const plain = (text: string): string => text.replace(SGR, "");

const PATHS = ["~/.claude/skills", "~/.config/opencode/skills", "~/.agents/skills"];

test("rows put the path in the label, padded to one column", () => {
  const rows = agentRows(PATHS, ["claude"]);
  expect(rows.map((r) => r.value)).toEqual(["claude", "opencode", "universal"]);
  expect(rows.map((r) => plain(r.label))).toEqual([
    "Claude Code  ~/.claude/skills           (detected)",
    "OpenCode     ~/.config/opencode/skills",
    "Universal    ~/.agents/skills           (opt-in)",
  ]);
});

test("the marker separates opt-in from undetected", () => {
  const rows = agentRows(PATHS, ["opencode"]);
  expect(plain(rows[0]!.label)).toEndWith("~/.claude/skills");
  expect(plain(rows[1]!.label)).toEndWith("(detected)");
  expect(plain(rows[2]!.label)).toEndWith("(opt-in)");
});

test("a remembered agent set takes precedence over detection in the picker", () => {
  expect(preferredAgents(["opencode", "universal"], ["claude"])).toEqual(["opencode", "universal"]);
  expect(preferredAgents(undefined, ["opencode"])).toEqual(["opencode"]);
});

const markerColumn = (label: string): number =>
  Bun.stringWidth(plain(label).slice(0, plain(label).indexOf("(")));

test("columns are measured in display cells, not code units", () => {
  const rows = agentRows(["~/技能", ...PATHS.slice(1)], ["claude", "opencode"]);
  expect(markerColumn(rows[0]!.label)).toBe(markerColumn(rows[2]!.label));
});

test("the note names the install that loses, per agent's own rule", () => {
  expect(shadowNote("project", "claude")).toBe(
    "Claude Code loads that one and ignores this install.",
  );
  expect(shadowNote("global", "claude")).toBe("Claude Code loads this one and ignores that one.");
  expect(shadowNote("project", "opencode")).toBe("OpenCode loads this one and ignores that one.");
  expect(shadowNote("global", "opencode")).toBe(
    "OpenCode loads that one and ignores this install.",
  );
  expect(shadowNote("project", "universal")).toBe("which one loads is up to the agent.");
});
