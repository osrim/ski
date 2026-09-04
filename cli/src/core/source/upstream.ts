import type { InstalledSkill } from "../install/placement.ts";
import type { Revision } from "./revision.ts";
import { sourceFor, type Source } from "./index.ts";

interface Verdict {
  skill: InstalledSkill;
  source: Source;
  upstream: Revision;
  ahead: number;
}

export interface UnreachableVerdict extends Verdict {
  kind: "unreachable";
  error: string;
}

export interface GoneVerdict extends Verdict {
  kind: "gone";
}

export interface RewrittenVerdict extends Verdict {
  kind: "rewritten";
  pinnedAs: string;
  expected: string;
  actual: string;
}

export interface PinnedVerdict extends Verdict {
  kind: "pinned";
}

export interface MovedVerdict extends Verdict {
  kind: "moved";
}

export interface OutdatedVerdict extends Verdict {
  kind: "outdated";
}

export interface CurrentVerdict extends Verdict {
  kind: "current";
}

export type UpdateVerdict =
  | UnreachableVerdict
  | GoneVerdict
  | RewrittenVerdict
  | PinnedVerdict
  | MovedVerdict
  | OutdatedVerdict
  | CurrentVerdict;

export const computeStatus = (
  skills: InstalledSkill[],
  named: string[] = [],
): Promise<UpdateVerdict[]> => {
  const names = new Set(named);
  return Promise.all(skills.map((skill) => verdictOf(skill, names)));
};

const verdictOf = async (skill: InstalledSkill, names: Set<string>): Promise<UpdateVerdict> => {
  const source = sourceFor(skill.source);
  try {
    const { revision: upstream, ...status } = await source.upstream(skill);
    const verdict = { skill, source, upstream, ahead: status.ahead };
    const rewritten = await rewrittenRef(skill, source);
    if (rewritten) return { kind: "rewritten", ...verdict, ...rewritten };
    if (status.gone) return { kind: "gone", ...verdict };
    if (skill.mode === "pin" && !names.has(skill.name) && (status.outdated || status.moved)) {
      return { kind: "pinned", ...verdict };
    }
    if (status.moved) return { kind: "moved", ...verdict };
    if (status.outdated) return { kind: "outdated", ...verdict };
    return { kind: "current", ...verdict };
  } catch (e) {
    return {
      kind: "unreachable",
      skill,
      source,
      upstream: { mode: skill.mode },
      ahead: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
};

interface RewrittenRef {
  pinnedAs: string;
  expected: string;
  actual: string;
}

const rewrittenRef = async (
  skill: InstalledSkill,
  source: Source,
): Promise<RewrittenRef | undefined> => {
  if (skill.mode !== "pin" || !skill.pinnedAs || !skill.commit) return;
  try {
    const actual = (await source.resolve(skill.pinnedAs)).commit ?? "";
    return actual === skill.commit
      ? undefined
      : { pinnedAs: skill.pinnedAs, expected: skill.commit, actual };
  } catch {
    return;
  }
};

interface UpdateSelection {
  selected: OutdatedVerdict[];
  skipped: string[];
  needsPrompt: boolean;
}

export const selectUpdates = (
  outdated: OutdatedVerdict[],
  names: string[],
  all: boolean,
): UpdateSelection => {
  if (names.length > 0) {
    const selected = outdated.filter((status) => names.includes(status.skill.name));
    const skipped = names.filter((name) => !selected.some((status) => status.skill.name === name));
    return { selected, skipped, needsPrompt: false };
  }
  if (all) return { selected: outdated, skipped: [], needsPrompt: false };
  return { selected: [], skipped: [], needsPrompt: true };
};
