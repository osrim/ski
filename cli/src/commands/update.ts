import * as p from "@clack/prompts";
import { applySkill, type Destination } from "../core/install/apply.ts";
import { readLock, type Lockfile } from "../core/install/lockfile.ts";
import { canonicalPath } from "../core/install/link.ts";
import {
  installedSkills,
  modifiedSkills,
  updateDestination,
  type InstalledSkill,
} from "../core/install/destination.ts";
import type { Scope } from "../core/paths.ts";
import { displayLabel, shortId } from "../core/source/revision.ts";
import { resolveScope, scopeFlag, type ScopeOptions } from "../core/install/scope.ts";
import {
  computeVerdicts,
  selectUpdates,
  type MovedVerdict,
  type OutdatedVerdict,
} from "../core/source/upstream.ts";
import { reportUpdateDeps, type UpdatedFiles } from "../ui/deps.ts";
import { confirm, land } from "../ui/flow.ts";
import { reviewSkills } from "../ui/gate.ts";
import type { CommandHelp } from "../ui/help.ts";
import { pickUpdates } from "../ui/pick.ts";
import { fail, withSpinner } from "../ui/prompt.ts";
import { logSourceCaution, warn } from "../ui/report.ts";
import { emptyScopeMessage, reportModified, reportVerdicts, revisionRange } from "../ui/status.ts";
import { dim, skillName } from "../ui/style.ts";

export const help: CommandHelp = {
  description:
    "Check upstream, review changes, and update selected skills. Name pinned skills to update them.",
  examples: [
    "$ ski update",
    "$ ski up grilling prototype",
    "$ ski update --all -y",
    "$ ski update -g",
  ],
};

interface UpdateOptions extends ScopeOptions {
  all?: boolean;
  yes?: boolean;
}

const DIFF_PREVIEW_LINES = 120;

export const run = async (names: string[], options: UpdateOptions): Promise<void> => {
  p.intro("ski update");
  const scope = resolveScope(options, p.log.warn) ?? "project";

  const lock = await readLock(scope);
  const skills = installedSkills(lock);
  if (skills.length === 0) {
    p.outro(await emptyScopeMessage(scope));
    return;
  }

  const unknown = names.filter((name) => !skills.some((skill) => skill.name === name));
  if (unknown.length > 0) {
    fail(
      `Not installed: ${unknown.join(", ")}\nInstalled: ${skills.map((skill) => skillName(skill.name)).join(", ")}`,
    );
  }

  const modified = await modifiedSkills(skills, scope);
  if (modified.size > 0) {
    reportModified(
      [...modified],
      `Updating one discards its edits. Run ${dim(`ski install${scopeFlag(scope)}`)} to restore it instead.`,
    );
  }

  const verdicts = await withSpinner(
    `Checking upstream for ${skills.length} skill(s)`,
    () => computeVerdicts(skills, names),
    () => "Checked upstream sources",
  );
  const { moved, outdated } = reportVerdicts(verdicts, names, scope);

  const destinationOf = (skill: InstalledSkill): Promise<Destination> =>
    destinationFor(skill, scope, lock);

  if (outdated.length === 0) {
    return landUpdates(moved, [], destinationOf, scope, lock, "Nothing to update.");
  }

  const movedNames = new Set(moved.map((verdict) => verdict.skill.name));
  const selection = selectUpdates(outdated, names, options.all ?? false);
  for (const name of selection.skipped) {
    if (!movedNames.has(name)) p.log.info(`${skillName(name)}: up to date`);
  }

  let selected = selection.selected;
  if (selection.needsPrompt) {
    const picked = await pickUpdates(outdated);
    selected = selectUpdates(outdated, picked, false).selected;
  }
  if (selected.length === 0) {
    return landUpdates(moved, [], destinationOf, scope, lock, "Nothing selected.");
  }

  logSourceCaution();
  const approved = await previewAndReview(selected, scope, options.yes);
  if (approved.length === 0) {
    return landUpdates(moved, [], destinationOf, scope, lock, "Nothing selected.");
  }
  await reportUpdateDeps(approved, lock, scope);

  const proceed = await confirm(
    `Update ${approved.map((item) => skillName(item.verdict.skill.name)).join(", ")} (${scope})?`,
    { yes: options.yes, command: "update" },
  );
  if (!proceed) {
    return landUpdates(moved, [], destinationOf, scope, lock, "Nothing selected.");
  }

  await landUpdates(moved, approved, destinationOf, scope, lock, "Nothing selected.");
};

type DestinationOf = (skill: InstalledSkill) => Promise<Destination>;

const destinationFor = async (
  skill: InstalledSkill,
  scope: Scope,
  lock: Lockfile,
): Promise<Destination> => {
  const { destination, defaulted } = await updateDestination(skill, scope, lock);
  if (defaulted) {
    warn(`${skillName(skill.name)}: missing. Linking to ${destination.agents.join(", ")}.`);
  }
  return destination;
};

type UpdateAction =
  | { kind: "moved"; verdict: MovedVerdict }
  | { kind: "update"; updated: UpdatedFiles };

const landUpdates = async (
  moved: MovedVerdict[],
  approved: UpdatedFiles[],
  destinationOf: DestinationOf,
  scope: Scope,
  lock: Lockfile,
  nothing: string,
): Promise<void> => {
  const items: UpdateAction[] = [
    ...moved.map((verdict) => ({ kind: "moved" as const, verdict })),
    ...approved.map((updated) => ({ kind: "update" as const, updated })),
  ];
  if (items.length === 0) {
    p.outro(nothing);
    return;
  }
  await land({
    items,
    name: (item) =>
      item.kind === "moved" ? item.verdict.skill.name : item.updated.verdict.skill.name,
    apply: (item) =>
      item.kind === "moved"
        ? recordMoved(item.verdict, destinationOf)
        : applyUpdate(item.updated, destinationOf),
    spinner: (item) =>
      item.kind === "moved"
        ? `Recording ${skillName(item.verdict.skill.name)} at ${displayLabel(item.verdict.upstream)}`
        : null,
    scope,
    lock,
    outro: (updated) => `Updated ${updated} skill(s). Scope: ${scope}.`,
  });
};

const recordMoved = async (
  verdict: MovedVerdict,
  destinationOf: DestinationOf,
): Promise<{ integrity: string; restored: boolean; success: string }> => {
  const { skill } = verdict;
  const destination = await destinationOf(skill);
  const result = await applySkill(
    {
      name: skill.name,
      source: skill.source,
      path: skill.path,
      revision: verdict.upstream,
      files: () => verdict.source.fetchFiles(verdict.upstream.commit, skill.path),
    },
    destination,
  );
  return {
    ...result,
    success: `${displayLabel(skill)} → ${displayLabel(verdict.upstream)}. No file changes.`,
  };
};

const previewAndReview = async (
  selected: OutdatedVerdict[],
  scope: Scope,
  yes: boolean | undefined,
): Promise<UpdatedFiles[]> => {
  const approved: UpdatedFiles[] = [];
  for (const verdict of selected) {
    const { skill } = verdict;
    const to = verdict.upstream.commit;
    const { changes, files } = await withSpinner(
      `Reading ${skillName(skill.name)}`,
      async () => ({
        changes: await verdict.source.changes(skill, to, canonicalPath(skill.name, scope)),
        files: await verdict.source.fetchFiles(to, skill.path),
      }),
      (read) => `${skillName(skill.name)}: read ${read.files.length} file(s)`,
    );
    const ids = to ? `: ${shortId(skill)} → ${shortId(verdict.upstream)}` : "";
    p.note(truncate(changes.patch), `${skillName(skill.name)}${ids}`);

    approved.push({ verdict, files });
  }
  const review = await reviewSkills(
    approved.map(({ verdict, files }) => ({ name: verdict.skill.name, files, verdict })),
    yes,
  );
  return review.approved.map(({ verdict, files }) => ({ verdict, files }));
};

const applyUpdate = async (
  { verdict, files }: UpdatedFiles,
  destinationOf: DestinationOf,
): Promise<{ restored: boolean; success: string }> => {
  const { skill } = verdict;
  const { integrity, restored } = await applySkill(
    {
      name: skill.name,
      source: skill.source,
      path: skill.path,
      revision: verdict.upstream,
      files: () => Promise.resolve(files),
    },
    await destinationOf(skill),
  );
  const range =
    revisionRange(verdict) ||
    `${displayLabel(skill)} → ${displayLabel({ ...verdict.upstream, integrity })}`;
  return { restored, success: `updated ${range}` };
};

const truncate = (diff: string): string => {
  const lines = diff.split("\n");
  if (lines.length <= DIFF_PREVIEW_LINES) return diff.trimEnd();
  const hidden = lines.length - DIFF_PREVIEW_LINES;
  return `${lines.slice(0, DIFF_PREVIEW_LINES).join("\n")}\n… (${hidden} more lines)`;
};
