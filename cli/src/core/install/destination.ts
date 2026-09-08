import { defaultAgents, type AgentId } from "./agents.ts";
import type { Destination } from "./apply.ts";
import {
  canonicalPath,
  copyState,
  dirModified,
  linkedAgents,
  occupiedAgents,
  removeCanonical,
  removeCopy,
  skillPath,
  unlinkSkill,
} from "./link.ts";
import { placementOf, type LockEntry, type Lockfile } from "./lockfile.ts";
import type { Scope } from "../paths.ts";
import { pathCopyDisplay, pathCopyState, pathCopyTarget, removePathCopy } from "./path-copy.ts";

export type InstalledSkill = LockEntry & { name: string };

export const installedSkills = (lock: Lockfile): InstalledSkill[] =>
  Object.entries(lock.skills).map(([name, entry]) => Object.assign({ name }, entry));

export type Location =
  | { kind: "link"; agents: AgentId[] }
  | { kind: "agent-copy"; agents: AgentId[] }
  | { kind: "path-copy"; copyPath: string; present: boolean };

export const locationAgents = (location: Location): AgentId[] =>
  location.kind === "path-copy" ? [] : location.agents;

export const locationPresent = (location: Location): boolean =>
  location.kind === "path-copy" ? location.present : location.agents.length > 0;

export const locationDisplayPath = (name: string, location: Location): string =>
  location.kind === "path-copy"
    ? pathCopyDisplay(name, location.copyPath)
    : location.agents.join(", ");

const presentAgents = (name: string, scope: Scope, recorded: AgentId[]): AgentId[] =>
  occupiedAgents(name, scope).filter((agent) => recorded.includes(agent));

type DestinationResult = { destination: Destination; defaulted: boolean };

export const locationOf = async (skill: InstalledSkill, scope: Scope): Promise<Location> => {
  const placement = placementOf(skill);
  if (placement.kind === "link") {
    return { kind: "link", agents: await linkedAgents(skill.name, scope) };
  }
  if (placement.kind === "agent-copy") {
    return {
      kind: "agent-copy",
      agents: presentAgents(skill.name, scope, placement.agents),
    };
  }
  const { copyPath } = placement;
  const { missing } = await pathCopyState(skill.name, skill.integrity, copyPath);
  return { kind: "path-copy", copyPath, present: !missing };
};

export const locationsOf = async (
  skills: InstalledSkill[],
  scope: Scope,
): Promise<Map<string, Location>> =>
  new Map(
    await Promise.all(
      skills.map(async (skill): Promise<[string, Location]> => [
        skill.name,
        await locationOf(skill, scope),
      ]),
    ),
  );

export const recordedLocations = (skill: InstalledSkill): string[] => {
  const placement = placementOf(skill);
  if (placement.kind === "link") return [];
  if (placement.kind === "agent-copy") return placement.agents;
  return [placement.copyPath];
};

export const lackingAgents = async (
  skill: InstalledSkill,
  scope: Scope,
  chosen: AgentId[],
): Promise<AgentId[]> => {
  const agents = locationAgents(await locationOf(skill, scope));
  return chosen.filter((agent) => !agents.includes(agent));
};

export const modifiedSkills = async (
  skills: InstalledSkill[],
  scope: Scope,
): Promise<Set<string>> => {
  const hits = await Promise.all(
    skills.map(async (skill) => {
      const placement = placementOf(skill);
      if (placement.kind === "link") {
        return (await dirModified(canonicalPath(skill.name, scope), skill.integrity))
          ? skill.name
          : null;
      }
      if (placement.kind === "agent-copy") {
        const state = await copyState(skill.name, skill.integrity, scope, placement.agents);
        return state.modified.length > 0 ? skill.name : null;
      }
      const state = await pathCopyState(skill.name, skill.integrity, placement.copyPath);
      return state.modified ? skill.name : null;
    }),
  );
  return new Set(hits.filter((name): name is string => name !== null));
};

export const installedPath = async (skill: InstalledSkill, scope: Scope): Promise<string> => {
  const placement = placementOf(skill);
  if (placement.kind === "link") return canonicalPath(skill.name, scope);
  if (placement.kind === "agent-copy") {
    const [present] = presentAgents(skill.name, scope, placement.agents);
    return skillPath(skill.name, scope, present ?? placement.agents[0]!);
  }
  return await pathCopyTarget(skill.name, placement.copyPath);
};

export const addDestination = (
  entry: LockEntry | undefined,
  dest: {
    scope: Scope;
    agents: AgentId[];
    lock: Lockfile;
    copy: boolean;
    copyPath?: string | undefined;
  },
): Destination => {
  const { scope, agents, lock, copyPath } = dest;
  if (copyPath !== undefined) {
    const managed = entry?.copyPath === copyPath;
    return { kind: "path-copy", scope, lock, root: copyPath, managed };
  }
  const copy = entry ? placementOf(entry).kind === "agent-copy" : dest.copy;
  if (copy) return { kind: "agent-copy", scope, agents, lock, managed: entry?.agents ?? [] };
  return { kind: "link", scope, agents, lock };
};

export const updateDestination = async (
  skill: InstalledSkill,
  scope: Scope,
  lock: Lockfile,
): Promise<DestinationResult> => {
  const placement = placementOf(skill);
  if (placement.kind === "link") {
    const linked = await linkedAgents(skill.name, scope);
    const agents = linked.length > 0 ? linked : defaultAgents();
    return {
      destination: { kind: "link", scope, lock, agents },
      defaulted: linked.length === 0,
    };
  }
  if (placement.kind === "agent-copy") {
    const agents = placement.agents;
    return {
      destination: { kind: "agent-copy", scope, lock, agents, managed: agents },
      defaulted: false,
    };
  }
  return {
    destination: { kind: "path-copy", scope, lock, root: placement.copyPath, managed: true },
    defaulted: false,
  };
};

export const installDestination = async (
  skill: InstalledSkill,
  scope: Scope,
  chosen: AgentId[],
): Promise<Destination> => {
  const placement = placementOf(skill);
  if (placement.kind === "link") return { kind: "link", scope, agents: chosen };
  if (placement.kind === "agent-copy") {
    const state = await copyState(skill.name, skill.integrity, scope, placement.agents);
    return {
      kind: "agent-copy",
      scope,
      agents: [...state.missing, ...state.modified],
      managed: placement.agents,
    };
  }
  return { kind: "path-copy", scope, root: placement.copyPath, managed: true };
};

export const removeInstalledSkill = async (
  name: string,
  scope: Scope,
  location: Location,
): Promise<void> => {
  if (location.kind === "link") {
    for (const agent of location.agents) await unlinkSkill(name, scope, agent);
    await removeCanonical(name, scope);
    return;
  }
  if (location.kind === "agent-copy") {
    for (const agent of location.agents) await removeCopy(name, scope, agent);
    return;
  }
  await removePathCopy(name, location.copyPath);
};
