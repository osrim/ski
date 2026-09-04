import { existsSync } from "node:fs";
import type { AgentId } from "./agents.ts";
import type { SkillFile } from "../skill/files.ts";
import type { Lockfile } from "./lockfile.ts";
import { assertSkillsDirSafe, copySkill, linkSkill, writeCanonical } from "./link.ts";
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
  scan?: (files: SkillFile[]) => void;
}

export interface ApplyTarget {
  scope: Scope;
  agents: AgentId[];
  lock?: Lockfile;
  copy?: { managed: AgentId[] };
}

export interface Backup {
  agent: AgentId;
  path: string;
}

const ensureStoreEntry = async (
  plan: ApplyPlan,
): Promise<Materialized & { files: SkillFile[] }> => {
  if (plan.integrity !== undefined) {
    const entry = storeEntryPath(plan.source, plan.name, plan.integrity);
    if (existsSync(entry) && (await entryMatches(entry, plan.integrity))) {
      const files = await readDirFiles(entry);
      plan.scan?.(files);
      return { entry, integrity: plan.integrity, restored: false, files };
    }
  }
  const files = await plan.files();
  plan.scan?.(files);
  return { ...(await materialize(plan.source, plan.name, files, plan.integrity)), files };
};

export const applySkill = async (
  plan: ApplyPlan,
  target: ApplyTarget,
): Promise<{ backedUp: Backup[]; integrity: string; restored: boolean }> => {
  for (const agent of target.agents) await assertSkillsDirSafe(target.scope, agent);
  const { integrity, restored, files } = await ensureStoreEntry(plan);
  if (!target.copy) await writeCanonical(plan.name, files, target.scope);
  const backedUp: Backup[] = [];
  for (const agent of target.agents) {
    const path = target.copy
      ? await copySkill(plan.name, files, target.scope, agent, target.copy.managed.includes(agent))
      : await linkSkill(plan.name, target.scope, agent);
    if (path) backedUp.push({ agent, path });
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
      installedAt: new Date().toISOString(),
    };
  }
  return { backedUp, integrity, restored };
};
