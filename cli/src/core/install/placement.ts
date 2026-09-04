import { defaultAgents, type AgentId } from "./agents.ts";
import type { ApplyTarget } from "./apply.ts";
import { canonicalPath, copyState, dirModified, linkedAgents, occupiedAgents } from "./link.ts";
import type { LockEntry, Lockfile } from "./lockfile.ts";
import type { Scope } from "../paths.ts";

export type InstalledSkill = LockEntry & { name: string };

export const installedSkills = (lock: Lockfile): InstalledSkill[] =>
  Object.entries(lock.skills).map(([name, entry]) => Object.assign({ name }, entry));

export interface Placement {
  form: "link" | "copy";
  agents: AgentId[];
}

export const placementOf = async (skill: InstalledSkill, scope: Scope): Promise<Placement> => {
  if (skill.agents) {
    const named = skill.agents;
    const agents = occupiedAgents(skill.name, scope).filter((agent) => named.includes(agent));
    return { form: "copy", agents };
  }
  return { form: "link", agents: await linkedAgents(skill.name, scope) };
};

export const placements = async (
  skills: InstalledSkill[],
  scope: Scope,
): Promise<Map<string, Placement>> =>
  new Map(
    await Promise.all(
      skills.map(
        async (skill): Promise<[string, Placement]> => [
          skill.name,
          await placementOf(skill, scope),
        ],
      ),
    ),
  );

export const lackingAgents = async (
  skill: InstalledSkill,
  scope: Scope,
  chosen: AgentId[],
): Promise<AgentId[]> => {
  const { agents } = await placementOf(skill, scope);
  return chosen.filter((agent) => !agents.includes(agent));
};

export const modifiedSkills = async (
  skills: InstalledSkill[],
  scope: Scope,
): Promise<Set<string>> => {
  const hits = await Promise.all(
    skills.map(async (skill) => {
      const modified = skill.agents
        ? (await copyState(skill.name, skill.integrity, scope, skill.agents)).modified.length > 0
        : await dirModified(canonicalPath(skill.name, scope), skill.integrity);
      return modified ? skill.name : null;
    }),
  );
  return new Set(hits.filter((name): name is string => name !== null));
};

export const addPlacement = (
  row: LockEntry | undefined,
  dest: { scope: Scope; agents: AgentId[]; lock: Lockfile; copy: boolean },
): ApplyTarget => {
  const { scope, agents, lock } = dest;
  const copy = row ? row.agents !== undefined : dest.copy;
  if (copy) return { scope, agents, lock, copy: { managed: row?.agents ?? [] } };
  return { scope, agents, lock };
};

export const updatePlacement = async (
  skill: InstalledSkill,
  scope: Scope,
  lock: Lockfile,
): Promise<{ target: ApplyTarget; defaulted: boolean }> => {
  if (skill.agents) {
    const managed = skill.agents;
    return { target: { scope, agents: managed, lock, copy: { managed } }, defaulted: false };
  }
  const linked = await linkedAgents(skill.name, scope);
  if (linked.length > 0) return { target: { scope, agents: linked, lock }, defaulted: false };
  return { target: { scope, agents: defaultAgents(), lock }, defaulted: true };
};

export const installPlacement = async (
  skill: InstalledSkill,
  scope: Scope,
  chosen: AgentId[],
): Promise<ApplyTarget> => {
  if (!skill.agents) return { scope, agents: chosen };
  const state = await copyState(skill.name, skill.integrity, scope, skill.agents);
  return { scope, agents: [...state.missing, ...state.modified], copy: { managed: skill.agents } };
};
