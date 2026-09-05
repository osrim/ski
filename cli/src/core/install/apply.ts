import { existsSync } from "node:fs";
import type { AgentId } from "./agents.ts";
import type { SkillFile } from "../skill/files.ts";
import type { Lockfile } from "./lockfile.ts";
import {
  assertNotForeign,
  assertSkillsDirSafe,
  copySkill,
  linkSkill,
  writeCanonical,
} from "./link.ts";
import type { Scope } from "../paths.ts";
import type { Revision } from "../source/revision.ts";
import { readDirFiles } from "../skill/files.ts";
import { entryMatches, materialize, storeEntryPath, type Materialized } from "./store.ts";

interface ApplyPlan {
  name: string;
  source: string;
  path: string;
  revision: Revision;
  integrity?: string;
  files: () => Promise<SkillFile[]>;
}

export interface ApplyTarget {
  scope: Scope;
  agents: AgentId[];
  lock?: Lockfile;
  copy?: { managed: AgentId[] };
}

const ensureStoreEntry = async (
  plan: ApplyPlan,
): Promise<Materialized & { files: SkillFile[] }> => {
  if (plan.integrity !== undefined) {
    const entry = storeEntryPath(plan.source, plan.name, plan.integrity);
    if (existsSync(entry) && (await entryMatches(entry, plan.integrity))) {
      const files = await readDirFiles(entry);
      return { entry, integrity: plan.integrity, restored: false, files };
    }
  }
  const files = await plan.files();
  return { ...(await materialize(plan.source, plan.name, files, plan.integrity)), files };
};

export const applySkill = async (
  plan: ApplyPlan,
  target: ApplyTarget,
): Promise<{ integrity: string; restored: boolean }> => {
  const managedCopy = (agent: AgentId): boolean => target.copy?.managed.includes(agent) === true;
  // Refuse every foreign entry up front so a failed skill leaves no canonical copy behind.
  for (const agent of target.agents) {
    await assertSkillsDirSafe(target.scope, agent);
    if (!managedCopy(agent)) await assertNotForeign(plan.name, target.scope, agent);
  }
  const { integrity, restored, files } = await ensureStoreEntry(plan);
  if (!target.copy) await writeCanonical(plan.name, files, target.scope);
  for (const agent of target.agents) {
    if (target.copy) {
      await copySkill(plan.name, files, target.scope, agent, managedCopy(agent));
    } else {
      await linkSkill(plan.name, target.scope, agent);
    }
  }
  if (target.lock) {
    target.lock.skills[plan.name] = {
      source: plan.source,
      path: plan.path,
      ...plan.revision,
      integrity,
      ...(target.copy
        ? { copy: true, agents: [...new Set([...target.copy.managed, ...target.agents])] }
        : {}),
    };
  }
  return { integrity, restored };
};
