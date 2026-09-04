import * as p from "@clack/prompts";
import type { Backup } from "../core/install/apply.ts";
import type { DiscoveredSkill } from "../core/source/discover.ts";
import type { Source } from "../core/source/index.ts";
import type { SkillFile } from "../core/skill/files.ts";
import { writeLock, type Lockfile } from "../core/install/lockfile.ts";
import type { Scope } from "../core/paths.ts";
import { failNoTTY, isInteractive, unwrap, withSpinner } from "./prompt.ts";
import { logSkillError, warnBackups } from "./report.ts";
import { warnRestored } from "./status.ts";
import { skillName } from "./style.ts";
import { hideLinksFromGit } from "./target.ts";

export interface SkillFiles {
  skill: DiscoveredSkill;
  files: SkillFile[];
}

export const fetchSkillFiles = (
  source: Source,
  rev: string | undefined,
  skills: DiscoveredSkill[],
): Promise<SkillFiles[]> =>
  withSpinner(
    `Fetching ${skills.length} skill(s) from ${source.display}`,
    async () => {
      const fetched: SkillFiles[] = [];
      for (const skill of skills) {
        fetched.push({ skill, files: await source.fetchFiles(rev, skill.path) });
      }
      return fetched;
    },
    (fetched) => `Fetched ${fetched.length} skill(s) from ${source.display}`,
  );

interface ConfirmOptions {
  yes?: boolean | undefined;
  command: string;
  initialValue?: boolean;
}

export const confirm = async (message: string, options: ConfirmOptions): Promise<boolean> => {
  if (options.yes) return true;
  if (!isInteractive()) {
    failNoTTY(`ski ${options.command} needs confirmation`, "Pass -y to proceed.");
  }
  return unwrap(await p.confirm({ message, initialValue: options.initialValue ?? true }));
};

interface Landing<T> {
  items: T[];
  name: (item: T) => string;
  apply: (item: T) => Promise<LandingResult>;
  onError?: (item: T, error: unknown) => void;
  spinner?: (item: T) => string | null;
  scope: Scope;
  lock: Lockfile | null;
  outro?: (applied: number) => string;
}

interface LandingResult {
  success: string;
  backedUp?: Backup[];
  restored?: boolean;
}

export const land = async <T>({
  items,
  name,
  apply,
  onError,
  spinner,
  scope,
  lock,
  outro,
}: Landing<T>): Promise<number> => {
  let applied = 0;
  let failed = 0;
  for (const item of items) {
    try {
      const message = spinner?.(item);
      const result = message
        ? await withSpinner(
            message,
            () => apply(item),
            (outcome) => `${skillName(name(item))}: ${outcome.success}`,
          )
        : await apply(item);
      if (result.restored) warnRestored(name(item));
      warnBackups(name(item), result.backedUp ?? []);
      if (!message) p.log.success(`${skillName(name(item))}: ${result.success}`);
      applied++;
    } catch (e) {
      if (onError) onError(item, e);
      else logSkillError(name(item), e);
      failed++;
    }
  }
  if (failed > 0) process.exitCode = process.exitCode === 3 ? 3 : 1;
  if (lock) await writeLock(scope, lock);
  await hideLinksFromGit(scope);
  if (outro) p.outro(outro(applied));
  return applied;
};
