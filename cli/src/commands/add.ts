import * as p from "@clack/prompts";
import { applySkill } from "../core/install/apply.ts";
import { assertSkillsDirSafe } from "../core/install/link.ts";
import { addDestination } from "../core/install/destination.ts";
import { normalizeCopyPath } from "../core/install/path-copy.ts";
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
import { usageError, USAGE_ERROR } from "../core/usage.ts";
import { resolveDeps, type DepsContext } from "../ui/deps.ts";
import { confirm, fetchSkillFiles, land, type SkillFiles } from "../ui/flow.ts";
import { reviewSkills, type ReviewOptions } from "../ui/gate.ts";
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
  type Mode,
} from "../ui/destination.ts";

export const help: CommandHelp = {
  description:
    "Fetch, review, and add skills. --copy writes directories instead of links. With --copy, --path <directory> writes skills below a project destination root. Do not combine --path with -g or --agent.",
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
    "$ ski add owner/repo --all -y --copy --path ./custom-directory",
  ],
};

interface AddOptions extends ScopeOptions, ReviewOptions {
  all?: boolean;
  agent?: string | string[];
  copy?: boolean;
  path?: string;
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

  const { scope, agents, copyPath } = await chooseDestination(options, {
    where: mode.where,
    mode: mode.verb,
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
    options: { all: options.all, copy, copyPath },
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
  const approved = picked.skills.length > 0 ? await approveNew(picked.skills, ctx) : [];
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

  if (!copyPath && scope === "project") warnAncestorCollisions(landing);
  if (!copyPath) warnScopeCollisions(landing, scope, agents);

  const context = {
    source: scopedSource,
    rev,
    ref: parsed.ref,
    scope,
    agents,
    copyPath,
    lock,
    copy,
    mode,
  };
  await land({
    items: [...approved, ...picked.extend],
    name: (item) => item.skill.name,
    apply: (item) =>
      "files" in item ? addSkill(item.skill, item.files, context) : extendSkill(item, context),
    scope,
    lock,
    outro: (added) => `Added ${added} skill(s). ${scope}: ${copyPath ?? agents.join(", ")}.`,
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

interface Destination {
  scope: Scope;
  agents: AgentId[];
  copyPath: string | undefined;
}

const chooseDestination = async (
  options: AddOptions,
  prompts: { where: string; mode: Mode },
): Promise<Destination> => {
  if (options.path !== undefined) {
    if (!options.copy) throw usageError("Pass --copy with --path.");
    if (options.global) throw usageError("Do not combine --path with --global.");
    if (options.agent !== undefined) throw usageError("Do not combine --path with --agent.");
    try {
      return { scope: "project", agents: [], copyPath: await normalizeCopyPath(options.path) };
    } catch (e) {
      throw usageError((e as Error).message);
    }
  }
  const scope = await chooseScope(options, prompts.where);
  const agents = await chooseAgents(options, scope, prompts.mode);
  for (const agent of agents) {
    await assertSkillsDirSafe(scope, agent).catch((e: Error) => fail(e.message));
  }
  return { scope, agents, copyPath: undefined };
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

const approveNew = async (skills: DiscoveredSkill[], ctx: DepsContext): Promise<SkillFiles[]> => {
  logSourceCaution();
  const review = await reviewSkills(
    (await fetchSkillFiles(ctx.source, ctx.rev, skills)).map(({ skill, files }) => ({
      name: skill.name,
      files,
      warnings: skill.warnings ?? [],
      skill,
    })),
    ctx.options,
  );
  if (review.approved.length === 0) return [];
  const approved = review.approved.map(({ skill, files }) => ({ skill, files }));
  const deps = await resolveDeps(ctx, approved);
  return [...approved, ...deps.added];
};

interface AddContext {
  source: Source;
  rev: Revision;
  ref: string | undefined;
  scope: Scope;
  agents: AgentId[];
  copyPath: string | undefined;
  lock: Lockfile;
  copy: boolean;
  mode: (typeof MODES)[keyof typeof MODES];
}

const addSkill = async (
  skill: DiscoveredSkill,
  files: SkillFile[],
  context: AddContext,
): Promise<{ integrity: string; restored: boolean; success: string }> => {
  const { integrity, restored } = await applySkill(
    {
      name: skill.name,
      source: context.source.id,
      path: skill.path,
      revision: context.rev,
      files: () => Promise.resolve(files),
    },
    addDestination(context.lock.skills[skill.name], context),
  );
  const label = shownLabel(context.ref, { ...context.rev, integrity });
  return { restored, integrity, success: `${context.mode.landed} @ ${label}` };
};

const extendSkill = async (
  { skill, agents }: Extension,
  context: AddContext,
): Promise<{ integrity: string; restored: boolean; success: string }> => {
  const entry = context.lock.skills[skill.name]!;
  const { restored } = await applySkill(
    {
      name: skill.name,
      source: context.source.id,
      path: skill.path,
      revision: entry,
      integrity: entry.integrity,
      files: () => context.source.fetchFiles(context.rev.commit, skill.path),
    },
    addDestination(entry, { ...context, agents }),
  );
  const label = displayLabel(entry);
  return {
    restored,
    integrity: entry.integrity,
    success: `${context.mode.extended} into ${agents.join(", ")} @ ${label}`,
  };
};
