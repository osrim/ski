import * as p from "@clack/prompts";
import { missingDeps, type BatchSkill, type MissingDep } from "../core/skill/deps.ts";
import type { DiscoveredSkill } from "../core/source/discover.ts";
import type { SkillFile } from "../core/skill/files.ts";
import type { Lockfile } from "../core/install/lockfile.ts";
import type { Scope } from "../core/paths.ts";
import { scopeFlag } from "../core/install/scope.ts";
import { coordinateFor, type Source } from "../core/source/index.ts";
import type { OutdatedVerdict } from "../core/source/upstream.ts";
import { fetchSkillFiles, type SkillFiles } from "./flow.ts";
import { reviewSkills } from "./gate.ts";
import { isInteractive, unwrap, withSpinner } from "./prompt.ts";
import { logWarn, warn } from "./report.ts";
import { dim, skillName, summarize } from "./style.ts";

const asBatch = (selected: SkillFiles[]): BatchSkill[] =>
  selected.map(({ skill, files }) => ({ name: skill.name, files }));

const warnMentions = (missing: MissingDep[], note: string): void => {
  for (const dep of missing) {
    warn(
      `${skillName(dep.from)} mentions ${skillName(dep.name)} at ${dep.file}:${dep.line}. ${note}.`,
    );
  }
};

const reportNotInstalled = (missing: MissingDep[], sourceId: string, scope: Scope): void => {
  warnMentions(missing, "not installed");
  p.log.info(
    `Add them: ${dim(`ski add ${coordinateFor(sourceId)} ${missing.map((dep) => dep.name).join(" ")}${scopeFlag(scope)}`)}`,
  );
};

export interface DepsContext {
  source: Source;
  rev: string | undefined;
  skills: DiscoveredSkill[];
  lock: Lockfile;
  scope: Scope;
  options: { yes?: boolean };
}

interface ResolvedDeps {
  added: SkillFiles[];
  blocked: boolean;
}

export const resolveDeps = async (
  ctx: DepsContext,
  approved: SkillFiles[],
): Promise<ResolvedDeps> => {
  const known = ctx.skills.map((skill) => skill.name);
  const interactive = !ctx.options.yes && isInteractive();
  const added: SkillFiles[] = [];
  let blocked = false;
  const offered = new Set<string>();

  for (;;) {
    const missing = missingDeps(
      asBatch([...approved, ...added]),
      known,
      (name) => offered.has(name) || ctx.lock.skills[name] !== undefined,
    );
    if (missing.length === 0) return { added, blocked };
    for (const dep of missing) offered.add(dep.name);

    if (!interactive) {
      reportNotInstalled(missing, ctx.source.id, ctx.scope);
      return { added, blocked };
    }
    warnMentions(missing, "not installed");

    const picked = new Set(
      unwrap(
        await p.multiselect<string>({
          message: "Add these dependencies?",
          options: missing.map((dep) => {
            const skill = ctx.skills.find((candidate) => candidate.name === dep.name)!;
            return {
              value: dep.name,
              label: dep.name,
              hint: summarize(skill.description) ?? `mentioned by ${dep.from}`,
            };
          }),
          required: false,
        }),
      ),
    );
    if (picked.size === 0) return { added, blocked };
    const review = await reviewSkills(
      (
        await fetchSkillFiles(
          ctx.source,
          ctx.rev,
          ctx.skills.filter((skill) => picked.has(skill.name)),
        )
      ).map(({ skill, files }) => ({
        name: skill.name,
        files,
        warnings: skill.warnings ?? [],
        skill,
      })),
      false,
    );
    if (review.blocked) blocked = true;
    added.push(...review.approved.map(({ skill, files }) => ({ skill, files })));
  }
};

export interface UpdatedFiles {
  verdict: OutdatedVerdict;
  files: SkillFile[];
}

const discoveryKey = (verdict: OutdatedVerdict): string =>
  verdict.source.kind === "local"
    ? verdict.skill.source
    : `${verdict.skill.source}@${verdict.upstream.commit}`;

export const reportUpdateDeps = async (
  updated: UpdatedFiles[],
  lock: Lockfile,
  scope: Scope,
): Promise<void> => {
  const groups = Map.groupBy(updated, (item) => discoveryKey(item.verdict));
  for (const group of groups.values()) {
    const { source, upstream, skill } = group[0]!.verdict;
    let known: DiscoveredSkill[];
    try {
      known = await withSpinner(
        `Checking ${source.display} for dependencies`,
        () => source.discover(upstream.commit),
        () => null,
      );
    } catch (e) {
      logWarn(`${source.display}: dependency check skipped. ${(e as Error).message}`);
      continue;
    }
    const missing = missingDeps(
      group.map((item) => ({ name: item.verdict.skill.name, files: item.files })),
      known.map((candidate) => candidate.name),
      (name) => lock.skills[name] !== undefined,
    );
    if (missing.length > 0) reportNotInstalled(missing, skill.source, scope);
  }
};
