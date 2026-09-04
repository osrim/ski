import { extname } from "node:path";
import type { SkillFile } from "./files.ts";
import { lineAt, stripFencedCode } from "./text.ts";

interface SkillMention {
  name: string;
  file: string;
  line: number;
}

const SKILL_NAME = "[a-z][a-z0-9-]{1,63}";

// Exclude paths, closing tags, and slash-prefixed commands.
const STANDALONE_SLASH_MENTION = new RegExp(`(?:^|[^\\w/.<-])/(${SKILL_NAME})\\b`, "gmu");

const NAMED_SKILL_CODE_MENTION = new RegExp(
  `\`/?(${SKILL_NAME})\`(?=[^\\n]{0,40}\\bskill\\b)`,
  "gmu",
);

export const findMentions = (
  files: SkillFile[],
  self: string,
  known: Iterable<string>,
): SkillMention[] => {
  const names = new Set(known);
  const found = new Map<string, SkillMention>();
  for (const file of files) {
    if (extname(file.path).toLowerCase() !== ".md") continue;
    const text = stripFencedCode(file.content.toString("utf8"));
    for (const pattern of [STANDALONE_SLASH_MENTION, NAMED_SKILL_CODE_MENTION]) {
      pattern.lastIndex = 0;
      for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
        const name = match[1]!;
        if (name === self || !names.has(name) || found.has(name)) continue;
        found.set(name, { name, file: file.path, line: lineAt(text, match.index) });
      }
    }
  }
  return [...found.values()].toSorted((a, b) => a.name.localeCompare(b.name));
};

export interface MissingDep extends SkillMention {
  from: string;
}

export interface BatchSkill {
  name: string;
  files: SkillFile[];
}

export const missingDeps = (
  batch: BatchSkill[],
  known: Iterable<string>,
  alreadyHere: (name: string) => boolean,
): MissingDep[] => {
  const inBatch = new Set(batch.map((skill) => skill.name));
  const missing = new Map<string, MissingDep>();
  for (const { name: from, files } of batch) {
    for (const mention of findMentions(files, from, known)) {
      if (inBatch.has(mention.name) || missing.has(mention.name) || alreadyHere(mention.name))
        continue;
      missing.set(mention.name, { ...mention, from });
    }
  }
  return [...missing.values()];
};
