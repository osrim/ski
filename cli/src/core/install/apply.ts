import { existsSync } from "node:fs";
import type { AgentId } from "./agents.ts";
import type { SkillFile } from "../skill/files.ts";
import type { LockEntry, Lockfile } from "./lockfile.ts";
import {
  refuseUnmanaged,
  assertSkillsDirSafe,
  copySkill,
  linkSkill,
  writeCanonical,
} from "./link.ts";
import type { Scope } from "../paths.ts";
import type { Revision } from "../source/revision.ts";
import { readDirFiles } from "../skill/files.ts";
import { entryMatches, materialize, storeEntryPath, type Materialized } from "./store.ts";
import { pathCopyState, refuseUnmanagedPathCopy, writePathCopy } from "./path-copy.ts";

interface ApplyPlan {
  name: string;
  source: string;
  path: string;
  revision: Revision;
  integrity?: string;
  files: () => Promise<SkillFile[]>;
}

export type Destination = { scope: Scope; lock?: Lockfile } & (
  | { kind: "link"; agents: AgentId[] }
  | { kind: "agent-copy"; agents: AgentId[]; managed: AgentId[] }
  | { kind: "path-copy"; root: string; managed: boolean }
);

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

const refuseAgentTargets = async (
  name: string,
  scope: Scope,
  agents: AgentId[],
  managed: AgentId[],
): Promise<void> => {
  for (const agent of agents) {
    await assertSkillsDirSafe(scope, agent);
    if (!managed.includes(agent)) await refuseUnmanaged(name, scope, agent);
  }
};

export const applySkill = async (
  plan: ApplyPlan,
  destination: Destination,
): Promise<{ integrity: string; restored: boolean }> => {
  if (destination.kind === "path-copy") {
    if (destination.scope !== "project") throw new Error("Path copies require project scope.");
    if (!destination.managed) await refuseUnmanagedPathCopy(plan.name, destination.root);
    if (destination.managed && plan.integrity !== undefined) {
      const state = await pathCopyState(plan.name, plan.integrity, destination.root);
      if (!state.missing && !state.modified) return { integrity: plan.integrity, restored: false };
    }
  } else {
    const managed = destination.kind === "agent-copy" ? destination.managed : [];
    await refuseAgentTargets(plan.name, destination.scope, destination.agents, managed);
  }

  const { integrity, restored, files } = await ensureStoreEntry(plan);
  const entry: LockEntry = {
    source: plan.source,
    path: plan.path,
    ...plan.revision,
    integrity,
  };

  if (destination.kind === "link") {
    await writeCanonical(plan.name, files, destination.scope);
    for (const agent of destination.agents) await linkSkill(plan.name, destination.scope, agent);
  } else if (destination.kind === "agent-copy") {
    const { agents, managed, scope } = destination;
    for (const agent of agents) {
      await copySkill(plan.name, files, scope, agent, managed.includes(agent));
    }
    Object.assign(entry, {
      copy: true,
      agents: [...new Set([...managed, ...agents])],
    });
  } else {
    await writePathCopy(plan.name, files, destination.root, destination.managed);
    Object.assign(entry, { copy: true, copyPath: destination.root });
  }
  if (destination.lock) destination.lock.skills[plan.name] = entry;
  return { integrity, restored };
};
