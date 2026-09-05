import { defaultAgents, type AgentId } from "./agents.ts";
import type { Destination } from "./apply.ts";
import { canonicalPath, copyState, dirModified, linkedAgents, occupiedAgents } from "./link.ts";
import type { LockEntry, Lockfile } from "./lockfile.ts";
import type { Scope } from "../paths.ts";

export type InstalledSkill = LockEntry & { name: string };

export const installedSkills = (lock: Lockfile): InstalledSkill[] =>
  Object.entries(lock.skills).map(([name, entry]) => Object.assign({ name }, entry));

export type Mode = "link" | "copy";

export interface Location {
  mode: Mode;
  agents: AgentId[];
}

export const locationOf = async (skill: InstalledSkill, scope: Scope): Promise<Location> => {
  if (skill.agents) {
    const named = skill.agents;
    const agents = occupiedAgents(skill.name, scope).filter((agent) => named.includes(agent));
    return { mode: "copy", agents };
  }
  return { mode: "link", agents: await linkedAgents(skill.name, scope) };
};

export const locationsOf = async (
  skills: InstalledSkill[],
  scope: Scope,
): Promise<Map<string, Location>> =>
  new Map(
    await Promise.all(
      skills.map(
        async (skill): Promise<[string, Location]> => [skill.name, await locationOf(skill, scope)],
      ),
    ),
  );

export const lackingAgents = async (
  skill: InstalledSkill,
  scope: Scope,
  chosen: AgentId[],
): Promise<AgentId[]> => {
  const { agents } = await locationOf(skill, scope);
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

export const addDestination = (
  entry: LockEntry | undefined,
  dest: { scope: Scope; agents: AgentId[]; lock: Lockfile; copy: boolean },
): Destination => {
  const { scope, agents, lock } = dest;
  const copy = entry ? entry.agents !== undefined : dest.copy;
  if (copy) return { scope, agents, lock, copy: { managed: entry?.agents ?? [] } };
  return { scope, agents, lock };
};

export const updateDestination = async (
  skill: InstalledSkill,
  scope: Scope,
  lock: Lockfile,
): Promise<{ destination: Destination; defaulted: boolean }> => {
  if (skill.agents) {
    const managed = skill.agents;
    return { destination: { scope, agents: managed, lock, copy: { managed } }, defaulted: false };
  }
  const linked = await linkedAgents(skill.name, scope);
  if (linked.length > 0) return { destination: { scope, agents: linked, lock }, defaulted: false };
  return { destination: { scope, agents: defaultAgents(), lock }, defaulted: true };
};

export const installDestination = async (
  skill: InstalledSkill,
  scope: Scope,
  chosen: AgentId[],
): Promise<Destination> => {
  if (!skill.agents) return { scope, agents: chosen };
  const state = await copyState(skill.name, skill.integrity, scope, skill.agents);
  return { scope, agents: [...state.missing, ...state.modified], copy: { managed: skill.agents } };
};
