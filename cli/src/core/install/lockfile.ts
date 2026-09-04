import { readFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { z } from "zod";
import { AGENT_IDS, type AgentId } from "./agents.ts";
import { lockPath, type Scope } from "../paths.ts";

export interface LockEntry {
  source: string;
  branch?: string;
  path: string;
  commit?: string;
  integrity: string;
  mode: "auto" | "pin";
  pinnedAs?: string;
  tag?: string;
  copy?: true;
  agents?: AgentId[];
  installedAt: string;
}

export interface Lockfile {
  lockfileVersion: 1;
  skills: Record<string, LockEntry>;
}

export const emptyLock = (): Lockfile => ({ lockfileVersion: 1, skills: {} });

export const isApproved = (
  lock: Lockfile,
  name: string,
  content: { source: string; path: string; integrity: string },
): boolean => {
  const entry = lock.skills[name];
  return (
    entry !== undefined &&
    entry.source === content.source &&
    entry.path === content.path &&
    entry.integrity === content.integrity
  );
};

interface SerializedEntry {
  source: string;
  branch?: string | undefined;
  path: string;
  commit?: string | undefined;
  integrity: string;
  mode: "auto" | "pin";
  pinnedAs?: string | undefined;
  tag?: string | undefined;
  copy?: true | undefined;
  agents?: AgentId[] | undefined;
  installedAt: string;
}

export const serializeLock = (lock: Lockfile): string => {
  const skills: Record<string, SerializedEntry> = {};
  for (const name of Object.keys(lock.skills).toSorted()) {
    const entry = lock.skills[name]!;
    skills[name] = {
      source: entry.source,
      branch: entry.branch,
      path: entry.path,
      commit: entry.commit,
      integrity: entry.integrity,
      mode: entry.mode,
      pinnedAs: entry.pinnedAs,
      tag: entry.tag,
      copy: entry.copy,
      agents: entry.agents,
      installedAt: entry.installedAt,
    };
  }
  return `${JSON.stringify({ lockfileVersion: 1, skills }, null, 2)}\n`;
};

// Zod reports the first invalid key. Check specific errors before generic fields.
const EntrySchema = z
  .object({
    mode: z.enum(["auto", "pin"], {
      error: (issue) => `unknown mode ${JSON.stringify(issue.input)}`,
    }),
    integrity: z
      .string({ error: "missing integrity" })
      .regex(/^sha256-[A-Za-z0-9+/]{43}=$/u, { error: "integrity must be sha256-<base64>" }),
    source: z.string(),
    branch: z.string().optional(),
    path: z.string(),
    commit: z.string().optional(),
    pinnedAs: z.string().optional(),
    tag: z.string().optional(),
    copy: z.literal(true).optional(),
    agents: z
      .array(z.enum(AGENT_IDS))
      .nonempty({ error: "agents must name at least one agent" })
      .optional(),
    installedAt: z.string(),
  })
  .refine((entry) => (entry.copy === undefined) === (entry.agents === undefined), {
    error: "copy and agents must appear together",
  });

// One path segment: not empty, not `.` or `..`, no separator. Looser than STANDARD_NAME in
// source/discover.ts, which only warns: fallback names such as `My_Skill` still install.
const SKILL_NAME = /^(?!\.\.?$)[^/\\]+$/u;

const LockfileSchema = z.object({
  lockfileVersion: z.literal(1, {
    error: (issue) => `unsupported lockfile version ${String(issue.input)}`,
  }),
  skills: z.record(z.string().regex(SKILL_NAME), EntrySchema).default({}),
});

export const parseLock = (text: string, file: string): Lockfile => {
  if (!text.trim()) return emptyLock();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`${file}: ${(e as Error).message}`, { cause: e });
  }
  const parsed = LockfileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    if (issue.code === "invalid_key") {
      const name = JSON.stringify(issue.path[1]);
      throw new Error(`${file}: invalid skill name ${name}`, { cause: parsed.error });
    }
    const row = issue.path[0] === "skills" ? `${String(issue.path[1])}: ` : "";
    throw new Error(`${file}: ${row}${issue.message}`, { cause: parsed.error });
  }
  const skills: Record<string, LockEntry> = {};
  for (const [name, entry] of Object.entries(parsed.data.skills)) {
    skills[name] = {
      source: entry.source,
      ...(entry.branch === undefined ? {} : { branch: entry.branch }),
      path: entry.path,
      ...(entry.commit === undefined ? {} : { commit: entry.commit }),
      integrity: entry.integrity,
      mode: entry.mode,
      ...(entry.pinnedAs === undefined ? {} : { pinnedAs: entry.pinnedAs }),
      ...(entry.tag === undefined ? {} : { tag: entry.tag }),
      ...(entry.copy === undefined ? {} : { copy: entry.copy }),
      ...(entry.agents === undefined ? {} : { agents: entry.agents }),
      installedAt: entry.installedAt,
    };
  }
  return { lockfileVersion: 1, skills };
};

export const readLock = async (scope: Scope): Promise<Lockfile> => {
  const file = lockPath(scope);
  try {
    return parseLock(await readFile(file, "utf8"), file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return emptyLock();
  }
};

export const writeLock = async (scope: Scope, lock: Lockfile): Promise<void> => {
  const file = lockPath(scope);
  await mkdir(dirname(file), { recursive: true });
  await writeFileAtomic(file, serializeLock(lock));
};
