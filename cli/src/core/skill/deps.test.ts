import { expect, test } from "bun:test";
import { findMentions, missingDeps } from "./deps.ts";
import type { SkillFile } from "./files.ts";

const md = (path: string, content: string): SkillFile => ({
  path,
  content: Buffer.from(content),
  mode: "100644",
});

const KNOWN = ["codebase-design", "grilling", "domain-modeling", "tdd", "code-review", "research"];

const names = (files: SkillFile[], self = "self"): string[] =>
  findMentions(files, self, KNOWN).map((r) => r.name);

test("slash idiom", () => {
  expect(names([md("SKILL.md", "Use /tdd where possible, at pre-agreed seams.")])).toEqual(["tdd"]);
});

test("backtick idiom needs the word skill nearby", () => {
  expect(names([md("SKILL.md", "see the `code-review` skill")])).toEqual(["code-review"]);
  expect(names([md("SKILL.md", "the `code-review` module handles this")])).toEqual([]);
});

test("backticked slash reference, no nearby skill word", () => {
  expect(names([md("SKILL.md", "Resolved by a `/research` **subagent**.")])).toEqual(["research"]);
});

test("only names known in the repo resolve", () => {
  const text = "Write to /tmp, see /issues and /docs, run /compact, check /users/me.";
  expect(names([md("SKILL.md", text)])).toEqual([]);
});

test("path segments and closing tags are not references", () => {
  const files = [
    md("SKILL.md", "read docs/agents/tdd for details"),
    md("a.md", "</grilling>"),
    md("b.md", "notes.md/tdd"),
  ];
  expect(names(files)).toEqual([]);
});

test("self-references are skipped", () => {
  expect(names([md("SKILL.md", "re-run /tdd to restart")], "tdd")).toEqual([]);
});

test("non-markdown files are ignored", () => {
  const files = [md("agents/openai.yaml", "skills: [/tdd, /grilling, /research]")];
  expect(names(files)).toEqual([]);
});

test("deduped by name, first mention cited, sorted", () => {
  const files = [
    md("SKILL.md", "line one\nrun the `/grilling` skill\nand /tdd\nlater /grilling again"),
    md("HTML-REPORT.md", "vocabulary from the `/codebase-design` skill"),
  ];
  const refs = findMentions(files, "self", KNOWN);
  expect(refs.map((r) => r.name)).toEqual(["codebase-design", "grilling", "tdd"]);
  expect(refs.find((r) => r.name === "grilling")).toEqual({
    name: "grilling",
    file: "SKILL.md",
    line: 2,
  });
  expect(refs.find((r) => r.name === "codebase-design")!.file).toBe("HTML-REPORT.md");
});

test("references inside a fenced block are examples, not dependencies", () => {
  const text = ["Usage:", "", "```", "/tdd", "```", "", "then run the `grilling` skill"].join("\n");
  const refs = findMentions([md("SKILL.md", text)], "self", KNOWN);
  expect(refs.map((r) => r.name)).toEqual(["grilling"]);
  expect(refs[0]!.line).toBe(7);
});

test("trailing punctuation does not break the match", () => {
  expect(names([md("SKILL.md", "hand off to /tdd. Then stop.")])).toEqual(["tdd"]);
});

test("missingDeps drops batch members, skills already here and repeats; first mention wins", () => {
  const batch = [
    { name: "a", files: [md("SKILL.md", "run /tdd then /grilling and /research")] },
    { name: "tdd", files: [md("SKILL.md", "line\nsee the `grilling` skill")] },
  ];
  const missing = missingDeps(batch, KNOWN, (n) => n === "research");
  expect(missing).toEqual([{ name: "grilling", file: "SKILL.md", line: 1, from: "a" }]);
});
