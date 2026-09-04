import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { projectRoot, claudeDir, envPath, userHome, type Scope } from "../paths.ts";

export type AgentId = "claude" | "opencode" | "universal";

interface AgentDef {
  id: AgentId;
  display: string;
  rootDir: string;
  globalDir: () => string;
  detect: (() => boolean) | null;
  loads: Scope | null;
}

const opencodeConfigDir = (): string =>
  join(envPath("XDG_CONFIG_HOME") ?? join(userHome(), ".config"), "opencode");

const onPath = (binary: string): boolean =>
  (process.env.PATH ?? "")
    .split(delimiter)
    .some((dir) => dir !== "" && existsSync(join(dir, binary)));

const inProject = (dir: string): boolean => existsSync(join(projectRoot(), dir));

export const AGENTS: AgentDef[] = [
  {
    id: "claude",
    display: "Claude Code",
    rootDir: ".claude",
    globalDir: () => join(claudeDir(), "skills"),
    detect: () => existsSync(claudeDir()) || inProject(".claude"),
    loads: "global",
  },
  {
    id: "opencode",
    display: "OpenCode",
    rootDir: ".opencode",
    globalDir: () => join(opencodeConfigDir(), "skills"),
    detect: () => existsSync(opencodeConfigDir()) || onPath("opencode") || inProject(".opencode"),
    loads: "project",
  },
  {
    id: "universal",
    display: "Universal",
    rootDir: ".agents",
    globalDir: () => join(userHome(), ".agents", "skills"),
    detect: null,
    loads: null,
  },
];

export const AGENT_IDS: AgentId[] = AGENTS.map((agent) => agent.id);

export const isOptIn = (agent: AgentDef): boolean => agent.detect === null;

const agentDef = (id: AgentId): AgentDef => {
  const found = AGENTS.find((agent) => agent.id === id);
  if (!found) throw new Error(`unknown agent: ${id}`);
  return found;
};

export const agentDisplay = (id: AgentId): string => agentDef(id).display;

export const loadedScope = (id: AgentId): Scope | null => agentDef(id).loads;

export const skillsDir = (scope: Scope, agent: AgentId): string => {
  const def = agentDef(agent);
  return scope === "global" ? def.globalDir() : join(projectRoot(), def.rootDir, "skills");
};

export const detectAgents = (): AgentId[] =>
  AGENTS.filter((agent) => agent.detect?.() === true).map((agent) => agent.id);

export const defaultAgents = (detected: AgentId[] = detectAgents()): AgentId[] => {
  if (detected.includes("claude")) return ["claude"];
  if (detected.includes("opencode")) return ["opencode"];
  return ["claude"];
};

export const overlapWarning = (agents: AgentId[]): string | null => {
  if (!agents.includes("opencode")) return null;
  const clashes = agents.filter((agent) => agent === "claude" || agent === "universal");
  if (clashes.length === 0) return null;
  const dirs = clashes.map((agent) => `${agentDef(agent).rootDir}/skills`).join(" and ");
  return `opencode also reads ${dirs}. Pick one target to avoid loading skills twice.`;
};

export const ancestorSkillsDirs = (): string[] => {
  const home = userHome();
  const dirs: string[] = [];
  let dir = dirname(projectRoot());
  while (dir !== home && dir !== dirname(dir)) {
    for (const agent of AGENTS) {
      const candidate = join(dir, agent.rootDir, "skills");
      if (existsSync(candidate)) dirs.push(candidate);
    }
    if (existsSync(join(dir, ".git"))) break;
    dir = dirname(dir);
  }
  return dirs;
};

export const parseAgentFlag = (value: string | string[] | undefined): AgentId[] | null => {
  if (value === undefined) return null;
  const raw = (Array.isArray(value) ? value : [value])
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== "");
  if (raw.length === 0) return null;
  const unknown = raw.filter((item) => !AGENT_IDS.includes(item as AgentId));
  if (unknown.length > 0) {
    throw new Error(`Unknown agent(s): ${unknown.join(", ")}\nKnown: ${AGENT_IDS.join(", ")}`);
  }
  return [...new Set(raw as AgentId[])];
};
