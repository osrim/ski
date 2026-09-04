import { expect, test } from "bun:test";
import { applyCommandHelp, applyRootHelp, type HelpSection } from "./help.ts";

const commandSections = (): HelpSection[] => [
  { body: "ski/0.2.0" },
  { title: "Usage", body: "  $ ski add <coordinate> [...skills]" },
  { title: "Options", body: "  -g, --global  Add globally" },
];

const titles = (sections: HelpSection[]): (string | undefined)[] => sections.map((s) => s.title);

test("description lands between usage and options", () => {
  const sections = commandSections();
  applyCommandHelp(sections, {
    description: "Fetch a repo's skills.",
    examples: ["$ ski add x/y"],
  });
  expect(titles(sections)).toEqual([undefined, "Usage", "Description", "Options", "Examples"]);
});

test("coordinate lands between description and options", () => {
  const sections = commandSections();
  applyCommandHelp(sections, {
    description: "Fetch a repo's skills.",
    coordinate: "owner/repo[/path/to/skill][@ref]",
    examples: ["$ ski add x/y"],
  });
  expect(titles(sections)).toEqual([
    undefined,
    "Usage",
    "Description",
    "Coordinate",
    "Options",
    "Examples",
  ]);
});

test("bodies are indented two spaces, like cac's own", () => {
  const sections = commandSections();
  applyCommandHelp(sections, {
    description: "Short.",
    coordinate: "owner/repo",
    examples: ["$ ski add x/y", "$ ski add x/y --copy"],
  });
  expect(sections[2]!.body).toBe("  Short.");
  expect(sections[3]!.body).toBe("  owner/repo");
  expect(sections[5]!.body).toBe("  $ ski add x/y\n  $ ski add x/y --copy");
});

test("root help closes with aliases and exit codes", () => {
  const sections: HelpSection[] = [{ body: "ski/0.2.0" }, { title: "Commands", body: "  add" }];
  applyRootHelp(sections, [
    { name: "add", aliasNames: [] },
    { name: "install", aliasNames: ["i"] },
    { name: "update", aliasNames: ["up"] },
  ]);
  expect(titles(sections)).toEqual([undefined, "Commands", "Aliases", "Exit codes"]);
  expect(sections[2]!.body).toBe("  i   install\n  up  update");
  expect(sections[3]!.body).toContain("  130  cancelled");
});

test("a surface with no aliases gets no aliases section", () => {
  const sections: HelpSection[] = [{ body: "ski/0.2.0" }];
  applyRootHelp(sections, [{ name: "add", aliasNames: [] }]);
  expect(titles(sections)).toEqual([undefined, "Exit codes"]);
});
