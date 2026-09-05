import type { InstalledSkill } from "../install/destination.ts";
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

export interface UpToDateVerdict extends Verdict {
  kind: "up-to-date";
}

export type UpdateVerdict =
  | UnreachableVerdict
  | GoneVerdict
  | RewrittenVerdict
  | PinnedVerdict
  | MovedVerdict
  | OutdatedVerdict
  | UpToDateVerdict;

export const computeVerdicts = (
  skills: InstalledSkill[],
  named: string[] = [],
): Promise<UpdateVerdict[]> => {
  const names = new Set(named);
  return Promise.all(skills.map((skill) => verdictOf(skill, names)));
};

const verdictOf = async (skill: InstalledSkill, names: Set<string>): Promise<UpdateVerdict> => {
  const source = sourceFor(skill.source);
  try {
    const { revision: upstream, ...flags } = await source.upstream(skill);
    const verdict = { skill, source, upstream, ahead: flags.ahead };
    const rewritten = await rewrittenRef(skill, source);
    if (rewritten) return { kind: "rewritten", ...verdict, ...rewritten };
    if (flags.gone) return { kind: "gone", ...verdict };
    if (skill.track === "pin" && !names.has(skill.name) && (flags.outdated || flags.moved)) {
      return { kind: "pinned", ...verdict };
    }
    if (flags.moved) return { kind: "moved", ...verdict };
    if (flags.outdated) return { kind: "outdated", ...verdict };
    return { kind: "up-to-date", ...verdict };
  } catch (e) {
    return {
      kind: "unreachable",
      skill,
      source,
      upstream: { track: skill.track },
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
  if (skill.track !== "pin" || !skill.pinnedAs || !skill.commit) return;
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
    const selected = outdated.filter((verdict) => names.includes(verdict.skill.name));
    const skipped = names.filter(
      (name) => !selected.some((verdict) => verdict.skill.name === name),
    );
    return { selected, skipped, needsPrompt: false };
  }
  if (all) return { selected: outdated, skipped: [], needsPrompt: false };
  return { selected: [], skipped: [], needsPrompt: true };
};
