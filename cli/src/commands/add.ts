import * as p from "@clack/prompts";
import { applySkill, type Backup } from "../core/install/apply.ts";
import { assertSkillsDirSafe } from "../core/install/link.ts";
import { addPlacement } from "../core/install/placement.ts";
import type { DiscoveredSkill } from "../core/source/discover.ts";
import type { SkillFile } from "../core/skill/files.ts";
import { readLock, type Lockfile } from "../core/install/lockfile.ts";
import type { AgentId } from "../core/install/agents.ts";
import type { Scope } from "../core/paths.ts";
import {
  COMMIT_HASH,
  displayLabel,
  type Labelled,
  type Revision,
} from "../core/source/revision.ts";
import type { ScopeOptions } from "../core/install/scope.ts";
import {
  resolveCoordinate,
  sourceForCoordinate,
  type ResolvedCoordinate,
  type Source,
} from "../core/source/index.ts";
import { parseCoordinate, type Coordinate } from "../core/source/coordinate.ts";
import { USAGE_ERROR } from "../core/usage.ts";
import { resolveDeps, type DepsContext } from "../ui/deps.ts";
import { confirm, fetchSkillFiles, land, type SkillFiles } from "../ui/flow.ts";
import { reviewSkills } from "../ui/gate.ts";
import type { CommandHelp } from "../ui/help.ts";
import { pickSkillsToAdd, type Extension } from "../ui/pick.ts";
import { fail } from "../ui/prompt.ts";
import { logSourceCaution } from "../ui/report.ts";
import { skillName } from "../ui/style.ts";
import {
  chooseAgents,
  chooseScope,
  warnAncestorCollisions,
  warnScopeCollisions,
  type LinkVerb,
} from "../ui/target.ts";

export const help: CommandHelp = {
  description: "Fetch, review, and add skills. Use --copy to write directories instead of links.",
  coordinate: [
    "owner/repo                        GitHub repository",
    "owner/repo/pdf                    named skill",
    "owner/repo/skills/pdf             skill path",
    "owner/repo@v1.2.0                 pinned ref",
    "https://github.com/o/r/tree/main  forge URL",
    "git@github.com:owner/repo.git     clone URL",
    "./skills/my-skill                 local directory",
  ].join("\n"),
  examples: [
    "$ ski add anthropics/skills",
    "$ ski add anthropics/skills/pdf -g",
    "$ ski add owner/repo@v1.2.0 --all -y",
    "$ ski add owner/repo/pdf --copy",
  ],
};

interface AddOptions extends ScopeOptions {
  all?: boolean;
  yes?: boolean;
  agent?: string | string[];
  copy?: boolean;
}

const MODES = {
  link: {
    intro: "ski add",
    where: "Add where?",
    verb: "link",
    confirm: "Add",
    nothingToDo: "Nothing to add.",
    landed: "installed",
    extended: "linked",
  },
  copy: {
    intro: "ski add --copy",
    where: "Copy where?",
    verb: "copy",
    confirm: "Copy",
    nothingToDo: "Nothing to copy.",
    landed: "copied",
    extended: "copied",
  },
} as const;

export const run = async (
  coordinate: string,
  names: string[],
  options: AddOptions,
): Promise<void> => {
  const copy = options.copy ?? false;
  const mode = MODES[copy ? "copy" : "link"];
  p.intro(mode.intro);

  const parsed = parseCoordinateOrFail(coordinate);
  if (parsed.skill) names = [parsed.skill, ...names];

  const source = sourceForCoordinate(parsed);
  const fetched = await resolveSource(source, parsed);
  if (!fetched) return;
  const { rev, skills } = fetched;

  const { scope, agents } = await chooseTargets(options, {
    where: mode.where,
    verb: mode.verb,
  });
  const scopedSource = source.forScope(scope);

  const lock = await readLock(scope);
  const picked = await pickSkillsToAdd({
    skills,
    names,
    lock,
    scope,
    agents,
    source: scopedSource,
    rev,
    options: { all: options.all, copy },
  });
  if (picked.skills.length === 0 && picked.extend.length === 0) {
    p.outro(picked.asked ? "Nothing selected." : mode.nothingToDo);
    return;
  }

  const ctx: DepsContext = {
    source: scopedSource,
    rev: rev.commit,
    skills,
    lock,
    scope,
    options,
  };
  const approved =
    picked.skills.length > 0 ? await approveNew(picked.skills, ctx, options.yes) : [];
  if (approved.length === 0 && picked.extend.length === 0) {
    p.outro("Nothing selected.");
    return;
  }

  const landing = [...approved, ...picked.extend].map((item) => item.skill.name);
  const proceed = await confirm(`${mode.confirm} ${landing.map(skillName).join(", ")}?`, {
    yes: options.yes,
    command: "add",
  });
  if (!proceed) {
    p.outro("Nothing selected.");
    return;
  }

  if (scope === "project") warnAncestorCollisions(landing);
  warnScopeCollisions(landing, scope, agents);

  const dest = { source: scopedSource, rev, ref: parsed.ref, scope, agents, lock, copy, mode };
  await land({
    items: [...approved, ...picked.extend],
    name: (item) => item.skill.name,
    apply: (item) =>
      "files" in item ? addSkill(item.skill, item.files, dest) : extendSkill(item, dest),
    scope,
    lock,
    outro: (added) => `Added ${added} skill(s). ${scope}: ${agents.join(", ")}.`,
  });
};

const parseCoordinateOrFail = (raw: string): Coordinate => {
  try {
    return parseCoordinate(raw);
  } catch (e) {
    if ((e as Error).name === USAGE_ERROR) throw e;
    return fail((e as Error).message);
  }
};

interface Targets {
  scope: Scope;
  agents: AgentId[];
}

const chooseTargets = async (
  options: AddOptions,
  prompts: { where: string; verb: LinkVerb },
): Promise<Targets> => {
  const scope = await chooseScope(options, prompts.where);
  const agents = await chooseAgents(options, scope, prompts.verb);
  for (const agent of agents) {
    await assertSkillsDirSafe(scope, agent).catch((e: Error) => fail(e.message));
  }
  return { scope, agents };
};

const shownLabel = (userRef: string | undefined, entry: Labelled): string =>
  userRef && !COMMIT_HASH.test(userRef) ? userRef : displayLabel(entry);

interface Fetched {
  rev: Revision;
  skills: DiscoveredSkill[];
}

const resolveSource = async (source: Source, coordinate: Coordinate): Promise<Fetched | null> => {
  const spinner = p.spinner();
  spinner.start(
    coordinate.kind === "local" ? `Reading ${source.display}` : `Fetching ${source.display}`,
  );
  let found: ResolvedCoordinate;
  try {
    found = await resolveCoordinate(source, coordinate);
    const where = found.dir ? ` ${found.dir}/` : "";
    const label = shownLabel(found.ref, found.rev);
    const at = label ? ` @ ${label}` : "";
    spinner.stop(`${source.display}${where}${at}: ${found.skills.length} skill(s)`);
  } catch (e) {
    spinner.error(coordinate.kind === "local" ? "Cannot read that directory" : "Fetch failed");
    return fail((e as Error).message);
  }
  const { rev, skills, dir } = found;
  if (skills.length === 0) {
    p.outro(dir ? `No SKILL.md found under ${dir}/.` : "No SKILL.md found.");
    return null;
  }
  return { rev, skills };
};

const approveNew = async (
  skills: DiscoveredSkill[],
  ctx: DepsContext,
  yes: boolean | undefined,
): Promise<SkillFiles[]> => {
  logSourceCaution();
  const review = await reviewSkills(
    (await fetchSkillFiles(ctx.source, ctx.rev, skills)).map(({ skill, files }) => ({
      name: skill.name,
      files,
      warnings: skill.warnings ?? [],
      skill,
    })),
    yes,
  );
  if (review.approved.length === 0) return [];
  const approved = review.approved.map(({ skill, files }) => ({ skill, files }));
  const deps = await resolveDeps(ctx, approved);
  return [...approved, ...deps.added];
};

interface Destination {
  source: Source;
  rev: Revision;
  ref: string | undefined;
  scope: Scope;
  agents: AgentId[];
  lock: Lockfile;
  copy: boolean;
  mode: (typeof MODES)[keyof typeof MODES];
}

const addSkill = async (
  skill: DiscoveredSkill,
  files: SkillFile[],
  dest: Destination,
): Promise<{ backedUp: Backup[]; integrity: string; restored: boolean; success: string }> => {
  const { backedUp, integrity, restored } = await applySkill(
    {
      name: skill.name,
      source: dest.source.id,
      path: skill.path,
      revision: dest.rev,
      files: () => Promise.resolve(files),
    },
    addPlacement(dest.lock.skills[skill.name], dest),
  );
  const label = shownLabel(dest.ref, { ...dest.rev, integrity });
  return { backedUp, restored, integrity, success: `${dest.mode.landed} @ ${label}` };
};

const extendSkill = async (
  { skill, agents }: Extension,
  dest: Destination,
): Promise<{ backedUp: Backup[]; integrity: string; restored: boolean; success: string }> => {
  const row = dest.lock.skills[skill.name]!;
  const { backedUp, restored } = await applySkill(
    {
      name: skill.name,
      source: dest.source.id,
      path: skill.path,
      revision: row,
      integrity: row.integrity,
      files: () => dest.source.fetchFiles(dest.rev.commit, skill.path),
    },
    addPlacement(row, { ...dest, agents }),
  );
  const label = displayLabel(row);
  return {
    backedUp,
    restored,
    integrity: row.integrity,
    success: `${dest.mode.extended} into ${agents.join(", ")} @ ${label}`,
  };
};
