import { existsSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeFiles, type SkillFile } from "../skill/files.ts";
import { integrityHex, integrityOfDir } from "../skill/integrity.ts";
import { childPath, storeDir } from "../paths.ts";

const sourceKey = (source: string): string =>
  source.replace(/^[a-z+]+:\/\//u, "").replace(/[^a-zA-Z0-9._-]/gu, "_");

const entryDir = (source: string): string => {
  const dir = join(storeDir(), sourceKey(source));
  if (dirname(dir) !== storeDir()) throw new Error(`invalid source ${JSON.stringify(source)}`);
  return dir;
};

export const storeEntryPath = (source: string, name: string, integrity: string): string =>
  `${childPath(entryDir(source), name)}@${integrityHex(integrity).slice(0, 12)}`;

export class IntegrityError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super("integrity mismatch");
  }
}

export const entryMatches = async (entry: string, expected: string): Promise<boolean> =>
  (await integrityOfDir(entry)) === expected;

export interface Materialized {
  integrity: string;
  entry: string;
  restored: boolean;
}

export const materialize = async (
  source: string,
  name: string,
  files: SkillFile[],
  expected?: string,
): Promise<Materialized> => {
  const tmp = `${childPath(entryDir(source), name)}.tmp`;
  await rm(tmp, { recursive: true, force: true });
  await writeFiles(tmp, files);
  const integrity = await integrityOfDir(tmp);
  const entry = storeEntryPath(source, name, integrity);
  if (expected !== undefined && integrity !== expected) {
    await rm(tmp, { recursive: true, force: true });
    throw new IntegrityError(expected, integrity);
  }
  const restored = existsSync(entry) && !(await entryMatches(entry, integrity));
  if (existsSync(entry) && !restored) {
    await rm(tmp, { recursive: true, force: true });
    return { integrity, entry, restored };
  }
  if (restored) await rm(entry, { recursive: true, force: true });
  await rename(tmp, entry);
  return { integrity, entry, restored };
};
