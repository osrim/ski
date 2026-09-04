import { readFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { parseAgentFlag, type AgentId } from "./install/agents.ts";
import { skiHome, type Scope } from "./paths.ts";

export interface Config {
  scope?: Scope;
  agents?: AgentId[];
}

export const configPath = (): string => join(skiHome(), "config.json");

export const parseConfig = (text: string): Config => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {};
  }
  if (typeof raw !== "object" || raw === null) return {};
  const { scope, agents } = raw as Record<string, unknown>;
  const config: Config = {};
  if (scope === "global" || scope === "project") config.scope = scope;
  if (Array.isArray(agents)) {
    try {
      const ids = parseAgentFlag(agents.filter((item) => typeof item === "string"));
      if (ids) config.agents = ids;
    } catch {}
  }
  return config;
};

export const readConfig = async (): Promise<Config> => {
  try {
    return parseConfig(await readFile(configPath(), "utf8"));
  } catch {
    return {};
  }
};

export const remember = async (patch: Config): Promise<void> => {
  const file = configPath();
  try {
    const merged = { ...(await readConfig()), ...patch };
    await mkdir(dirname(file), { recursive: true });
    await writeFileAtomic(file, `${JSON.stringify(merged, null, 2)}\n`);
  } catch {
    return;
  }
};
