import { createHash } from "node:crypto";
import { byPath, readDirFiles, type SkillFile } from "./files.ts";

const INTEGRITY_PREFIX = "sha256-";

export const integrityHex = (integrity: string): string => {
  if (!integrity.startsWith(INTEGRITY_PREFIX)) throw new Error(`not an integrity: ${integrity}`);
  return Buffer.from(integrity.slice(INTEGRITY_PREFIX.length), "base64").toString("hex");
};

export const integrityOf = (files: SkillFile[]): string => {
  const hash = createHash("sha256");
  for (const file of files.toSorted(byPath)) {
    hash.update(`${file.path}\0${file.mode}\0`);
    hash.update(createHash("sha256").update(file.content).digest());
    hash.update("\n");
  }
  return `${INTEGRITY_PREFIX}${hash.digest("base64")}`;
};

export const integrityOfDir = async (dir: string): Promise<string> =>
  integrityOf(await readDirFiles(dir));
