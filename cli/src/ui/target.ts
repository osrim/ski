import { existsSync } from "node:fs";
import { join } from "node:path";
import * as p from "@clack/prompts";
import {
  AGENTS,
  agentDisplay,
  ancestorSkillsDirs,
  defaultAgents,
  detectAgents,
  isOptIn,
  loadedScope,
  overlapWarning,
  parseAgentFlag,
  skillsDir,
  type AgentId,
} from "../core/install/agents.ts";
import { readConfig, remember } from "../core/config.ts";
import { syncExcludes } from "../core/install/exclude.ts";
import { projectRoot, type Scope } from "../core/paths.ts";
import { resolveScope, type ScopeOptions } from "../core/install/scope.ts";
import { isInteractive, unwrap, fail } from "./prompt.ts";
import { logWarn, warn } from "./report.ts";
import { dim, pad, skillName, tildify } from "./style.ts";

interface AgentSelection {
  agent?: string | string[];
  yes?: boolean;
}

const scopeNotice = (scope: Scope): string =>
  scope === "global"
    ? "Using global scope. Use -p for project."
    : "Using project scope. Use -g for global.";

export const chooseScope = async (
  options: ScopeOptions & { yes?: boolean },
  message = "Add where?",
): Promise<Scope> => {
  const preferred = (await readConfig()).scope ?? "project";
  const resolved = resolveScope(options, p.log.warn);
  if (resolved) {
    if (options.global || options.project) await remember({ scope: resolved });
    return resolved;
  }
  if (options.yes || !isInteractive()) {
    p.log.info(scopeNotice(preferred));
    return preferred;
  }
  const picked = unwrap(
    await p.select<Scope>({
      message,
      options: [
        { value: "project", label: "this project", hint: tildify(projectRoot()) },
        { value: "global", label: "global", hint: "every project on this machine" },
      ],
      initialValue: preferred,
    }),
  );
  await remember({ scope: picked });
  return picked;
};

const VERBS = {
  link: {
    imperative: "Link",
    gerund: "Linking",
    explainer: undefined,
  },
  copy: {
    imperative: "Copy",
    gerund: "Copying",
    explainer: `Copies are real directories. The lockfile records their agents.`,
  },
} as const;

export type LinkVerb = keyof typeof VERBS;

export const agentRows = (
  paths: string[],
  detected: AgentId[],
): { value: AgentId; label: string }[] => {
  const nameWidth = Math.max(...AGENTS.map((agent) => Bun.stringWidth(agent.display)));
  const pathWidth = Math.max(...paths.map((path) => Bun.stringWidth(path)));
  return AGENTS.map((agent, index) => {
    const marker = detected.includes(agent.id) ? "(detected)" : isOptIn(agent) ? "(opt-in)" : "";
    const cells = [pad(agent.display, nameWidth), pad(paths[index]!, pathWidth), dim(marker)];
    return { value: agent.id, label: cells.join("  ").trimEnd() };
  });
};

export const preferredAgents = (
  remembered: AgentId[] | undefined,
  detected: AgentId[],
): AgentId[] => remembered ?? defaultAgents(detected);

export const chooseAgents = async (
  options: AgentSelection,
  scope: Scope,
  verb: LinkVerb = "link",
): Promise<AgentId[]> => {
  const { imperative, gerund, explainer } = VERBS[verb];
  const explicit = ((): AgentId[] | null => {
    try {
      return parseAgentFlag(options.agent);
    } catch (e) {
      return fail((e as Error).message);
    }
  })();
  if (explicit) {
    await remember({ agents: explicit });
    return warnOverlap(explicit);
  }

  const remembered = (await readConfig()).agents;

  if (options.yes || !isInteractive()) {
    if (remembered) {
      p.log.info(`${gerund} to ${remembered.join(", ")}.`);
      return warnOverlap(remembered);
    }
    const detected = detectAgents();
    const preferred = preferredAgents(undefined, detected);
    if (detected.length === 0) {
      warn("No agent detected. Using claude. Pass --agent to choose.");
    }
    p.log.info(`${gerund} to ${preferred.join(", ")}.`);
    return warnOverlap(preferred);
  }

  const detected = detectAgents();
  const preferred = preferredAgents(remembered, detected);
  if (detected.length === 0) {
    warn("No agent detected. Using claude. Pass --agent to choose.");
  }

  if (explainer) p.log.info(explainer);
  const picked = unwrap(
    await p.multiselect<AgentId>({
      message: `${imperative} to which agents?`,
      options: agentRows(
        AGENTS.map((agent) => tildify(skillsDir(scope, agent.id))),
        detected,
      ),
      initialValues: preferred,
      required: true,
    }),
  );
  await remember({ agents: picked });
  return warnOverlap(picked);
};

const warnOverlap = (agents: AgentId[]): AgentId[] => {
  const warning = overlapWarning(agents);
  if (warning) warn(warning);
  return agents;
};

export const warnAncestorCollisions = (names: string[]): void => {
  const dirs = ancestorSkillsDirs();
  if (dirs.length === 0) return;
  for (const name of names) {
    for (const dir of dirs) {
      if (existsSync(join(dir, name))) {
        logWarn(`${skillName(name)} is also at ${tildify(dir)}. opencode loads both.`);
      }
    }
  }
};

export const shadowNote = (scope: Scope, agent: AgentId): string => {
  const loads = loadedScope(agent);
  if (loads === null) return "which one loads is up to the agent.";
  return loads === scope
    ? `${agentDisplay(agent)} loads this one and ignores that one.`
    : `${agentDisplay(agent)} loads that one and ignores this install.`;
};

export const warnScopeCollisions = (names: string[], scope: Scope, agents: AgentId[]): void => {
  const other: Scope = scope === "global" ? "project" : "global";
  for (const agent of agents) {
    const dir = skillsDir(other, agent);
    if (dir === skillsDir(scope, agent)) continue;
    for (const name of names) {
      if (existsSync(join(dir, name))) {
        logWarn(`${skillName(name)} is also at ${tildify(dir)}. ${shadowNote(scope, agent)}`);
      }
    }
  }
};

export const hideLinksFromGit = async (scope: Scope): Promise<void> => {
  if (scope !== "project") return;
  const sync = await syncExcludes().catch((e: Error) => {
    logWarn(`could not update .git/info/exclude: ${e.message}`);
    return null;
  });
  if (!sync?.changed) return;
  p.log.info(
    sync.patterns.length === 0
      ? "Cleared ski's entries from .git/info/exclude."
      : `${sync.patterns.length} link(s) hidden with .git/info/exclude. Commit ski-lock.json.`,
  );
};
