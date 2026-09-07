import { mkdir, rm, symlink, lstat, readlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { skillsDir, AGENTS, type AgentId } from "./agents.ts";
import { writeFiles, type SkillFile } from "../skill/files.ts";
import { integrityOfDir } from "../skill/integrity.ts";
import { canonicalDir, childPath, dataDir, tildify, type Scope } from "../paths.ts";
import { isInside, present, realpathOrNearest, unmanagedError } from "./target.ts";

const isSymlinkPath = async (path: string): Promise<boolean> => {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch {
    return false;
  }
};

export const assertSkillsDirSafe = async (scope: Scope, agent: AgentId): Promise<string> => {
  const dest = skillsDir(scope, agent);
  const canonical = canonicalDir(scope);
  if ((await realpathOrNearest(dest)) === (await realpathOrNearest(canonical))) {
    throw new Error(
      `${dest} and ${canonical} are the same directory.\nski keeps skill copies in ${canonical} and links agents to them. Remove the symlink and re-run.`,
    );
  }
  if (!(await isSymlinkPath(dest))) return dest;
  const resolved = await realpathOrNearest(resolve(dirname(dest), await readlink(dest)));
  const forbidden = [{ label: "the store", root: dataDir() }];
  if (scope === "project") {
    for (const def of AGENTS)
      forbidden.push({ label: "a global skills directory", root: def.globalDir() });
  }
  for (const { label, root } of forbidden) {
    if (isInside(resolved, await realpathOrNearest(root))) {
      throw new Error(`${dest} is a symlink into ${label} (${resolved}).\nRemove it and re-run.`);
    }
  }
  return dest;
};

export const skillPath = (name: string, scope: Scope, agent: AgentId): string =>
  childPath(skillsDir(scope, agent), name);

export const canonicalPath = (name: string, scope: Scope): string =>
  childPath(canonicalDir(scope), name);

const isManagedLink = async (path: string, scope: Scope): Promise<boolean> => {
  if (!(await isSymlinkPath(path))) return false;
  try {
    const resolved = resolve(await realpathOrNearest(dirname(path)), await readlink(path));
    return isInside(resolved, await realpathOrNearest(canonicalDir(scope)));
  } catch {
    return false;
  }
};

const isUnmanaged = async (path: string, scope: Scope): Promise<boolean> =>
  present(path) && !(await isManagedLink(path, scope));

const displayPath = (path: string): string => {
  const rel = relative(process.cwd(), path);
  return rel.startsWith("..") ? tildify(path) : rel;
};

export const refuseUnmanaged = async (
  name: string,
  scope: Scope,
  agent: AgentId,
): Promise<void> => {
  const path = skillPath(name, scope, agent);
  if (await isUnmanaged(path, scope)) throw unmanagedError(displayPath(path));
};

export const linkedAgents = async (name: string, scope: Scope): Promise<AgentId[]> => {
  const hits = await Promise.all(
    AGENTS.map(async (agent) =>
      (await isManagedLink(skillPath(name, scope, agent.id), scope)) ? agent.id : null,
    ),
  );
  return hits.filter((id): id is AgentId => id !== null);
};

export const occupiedAgents = (name: string, scope: Scope): AgentId[] =>
  AGENTS.filter((agent) => present(skillPath(name, scope, agent.id))).map((agent) => agent.id);

export const linkSkill = async (name: string, scope: Scope, agent: AgentId): Promise<void> => {
  const path = skillPath(name, scope, agent);
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  await refuseUnmanaged(name, scope, agent);
  await rm(path, { force: true });
  // Resolve both ends so the link still holds when an agent dir is itself a symlink.
  const from = await realpathOrNearest(dir);
  const to = await realpathOrNearest(canonicalPath(name, scope));
  await symlink(relative(from, to), path);
};

export const copySkill = async (
  name: string,
  files: SkillFile[],
  scope: Scope,
  agent: AgentId,
  managed: boolean,
): Promise<void> => {
  const path = skillPath(name, scope, agent);
  await mkdir(dirname(path), { recursive: true });
  if (!managed) await refuseUnmanaged(name, scope, agent);
  await rm(path, { recursive: true, force: true });
  await writeFiles(path, files);
};

export const removeCopy = (name: string, scope: Scope, agent: AgentId): Promise<void> =>
  rm(skillPath(name, scope, agent), { recursive: true, force: true });

export const writeCanonical = async (
  name: string,
  files: SkillFile[],
  scope: Scope,
): Promise<void> => {
  const path = canonicalPath(name, scope);
  await mkdir(dirname(path), { recursive: true });
  if (scope === "project") {
    const ignore = join(canonicalDir(scope), "..", ".gitignore");
    if (!existsSync(ignore)) await writeFile(ignore, "*\n");
  }
  await rm(path, { recursive: true, force: true });
  await writeFiles(path, files);
};

export const removeCanonical = (name: string, scope: Scope): Promise<void> =>
  rm(canonicalPath(name, scope), { recursive: true, force: true });

export const dirModified = async (path: string, integrity: string): Promise<boolean> =>
  present(path) && (await integrityOfDir(path)) !== integrity;

export interface CopyState {
  missing: AgentId[];
  modified: AgentId[];
}

export const copyState = async (
  name: string,
  integrity: string,
  scope: Scope,
  agents: AgentId[],
): Promise<CopyState> => {
  const state: CopyState = { missing: [], modified: [] };
  for (const agent of agents) {
    const path = skillPath(name, scope, agent);
    if (!present(path)) state.missing.push(agent);
    else if (await dirModified(path, integrity)) state.modified.push(agent);
  }
  return state;
};

export const unlinkSkill = async (name: string, scope: Scope, agent: AgentId): Promise<void> => {
  const path = skillPath(name, scope, agent);
  if (await isUnmanaged(path, scope)) {
    throw new Error(`${displayPath(path)} is not managed by ski. Delete it yourself.`);
  }
  await rm(path, { recursive: true, force: true });
};
