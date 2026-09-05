import * as p from "@clack/prompts";
import { readLock } from "../core/install/lockfile.ts";
import type { Scope } from "../core/paths.ts";
import { displayLabel, shortId } from "../core/source/revision.ts";
import { scopeFlag } from "../core/install/scope.ts";
import {
  type MovedVerdict,
  type OutdatedVerdict,
  type UpdateVerdict,
} from "../core/source/upstream.ts";
import { logError, warn } from "./report.ts";
import { bold, dim, skillName } from "./style.ts";

export const emptyScopeMessage = async (scope: Scope): Promise<string> => {
  const other: Scope = scope === "project" ? "global" : "project";
  const count = Object.keys((await readLock(other)).skills).length;
  const base = `Nothing installed (${scope}).`;
  if (count === 0) return base;
  const hint = other === "global" ? "pass -g to see them" : "run from the project to see them";
  return `${base} ${count} in ${other} scope. ${hint}.`;
};

export const reportModified = (names: string[], remedy: string): void => {
  warn(
    [
      `${names.length} skill(s) modified since install: ${names.map(skillName).join(", ")}`,
      remedy,
    ].join("\n"),
  );
};

export const warnRestored = (name: string): void => {
  warn(`${skillName(name)}: restored local edits from the source`);
};

export const reportVerdicts = (
  verdicts: UpdateVerdict[],
  names: string[],
  scope: Scope,
): { moved: MovedVerdict[]; outdated: OutdatedVerdict[] } => {
  const moved: MovedVerdict[] = [];
  const outdated: OutdatedVerdict[] = [];
  for (const verdict of verdicts) {
    const { skill } = verdict;
    switch (verdict.kind) {
      case "unreachable":
        logError(`${skillName(skill.name)}: no upstream. ${verdict.error}`);
        if (names.includes(skill.name)) process.exitCode = 1;
        break;
      case "gone": {
        const what = skill.path ? `no longer has ${skill.path}` : "no longer has this skill";
        warn(`${skillName(skill.name)}: source ${what}. Skipped.`);
        break;
      }
      case "rewritten":
        logError(
          `${skillName(skill.name)}: pinned ref "${verdict.pinnedAs}" was rewritten. ${shortId({ commit: verdict.expected })} → ${shortId({ commit: verdict.actual })}.\nReinstall to accept it.`,
        );
        if (names.includes(skill.name)) process.exitCode = 1;
        break;
      case "pinned":
        p.log.info(
          `${skillName(skill.name)}: pinned at ${displayLabel(skill)}. Latest: ${displayLabel(verdict.upstream)}.\nRun ${dim(`ski update ${skill.name}${scopeFlag(scope)}`)} to update.`,
        );
        break;
      case "moved":
        moved.push(verdict);
        break;
      case "outdated":
        outdated.push(verdict);
        break;
      case "up-to-date":
        break;
    }
  }
  return { moved, outdated };
};

const describeAhead = (verdict: OutdatedVerdict): string =>
  verdict.ahead > 0 ? `${verdict.ahead} new commit(s)` : "content changed";

export const describeOutdated = (verdict: OutdatedVerdict): string => {
  const range = revisionRange(verdict);
  return range ? `${describeAhead(verdict)} (${range})` : describeAhead(verdict);
};

export const revisionRange = (verdict: OutdatedVerdict): string => {
  const to = displayLabel(verdict.upstream);
  return to ? `${displayLabel(verdict.skill)} → ${to}` : "";
};

export const friendlySource = (source: string): string =>
  source
    .replace(/^(https?:\/\/|ssh:\/\/|git@|file:\/\/)/u, "")
    .replace(/^github\.com[:/]/u, "")
    .replace(/\.git$/u, "");

export const groupLabel = (source: string, items: OutdatedVerdict[]): string => {
  const name = bold(friendlySource(source));
  const oldTags = new Set(items.map((verdict) => displayLabel(verdict.skill)));
  const newTags = new Set(items.map((verdict) => displayLabel(verdict.upstream)));
  if (oldTags.size !== 1 || newTags.size !== 1) return name;
  const [oldTag] = oldTags;
  const [newTag] = newTags;
  return oldTag === newTag ? name : `${name} (${oldTag} → ${newTag})`;
};
