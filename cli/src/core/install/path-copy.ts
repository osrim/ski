import { dirname, resolve } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { childPath, projectRoot } from "../paths.ts";
import { writeFiles, type SkillFile } from "../skill/files.ts";
import { integrityOfDir } from "../skill/integrity.ts";
import { present, realpathOrNearest, relativeInside, unmanagedError } from "./target.ts";

const projectRelativePath = async (path: string): Promise<string> => {
  const root = await realpathOrNearest(projectRoot());
  const relative = relativeInside(await realpathOrNearest(path), root);
  if (relative !== undefined) return relative;
  throw new Error(`${path} resolves outside the project root (${projectRoot()}).`);
};

export const normalizeCopyPath = async (path: string): Promise<string> => {
  if (path === "") throw new Error("Pass a directory to --path.");
  if (path.includes("\\")) {
    throw new Error(`Copy path ${JSON.stringify(path)} must not contain a backslash.`);
  }
  if (path.split("/").includes("..")) {
    throw new Error(`Copy path ${JSON.stringify(path)} must not contain \`..\`.`);
  }
  const root = projectRoot();
  const destination = resolve(root, path);
  return await projectRelativePath(destination);
};

export const pathCopyDisplay = (name: string, copyPath: string): string =>
  copyPath === "." ? name : `${copyPath}/${name}`;

export const pathCopyTarget = async (name: string, copyPath: string): Promise<string> => {
  const target = childPath(resolve(projectRoot(), await normalizeCopyPath(copyPath)), name);
  // The destination root resolves inside the project. The skill directory can still be a
  // symlink to a path outside the project.
  await projectRelativePath(target);
  return target;
};

export const refuseUnmanagedPathCopy = async (name: string, copyPath: string): Promise<void> => {
  if (present(await pathCopyTarget(name, copyPath))) {
    throw unmanagedError(pathCopyDisplay(name, copyPath));
  }
};

export const writePathCopy = async (
  name: string,
  files: SkillFile[],
  copyPath: string,
  managed: boolean,
): Promise<void> => {
  const target = await pathCopyTarget(name, copyPath);
  if (!managed) await refuseUnmanagedPathCopy(name, copyPath);
  await mkdir(dirname(target), { recursive: true });
  await rm(target, { recursive: true, force: true });
  await writeFiles(target, files);
};

export const removePathCopy = async (name: string, copyPath: string): Promise<void> =>
  rm(await pathCopyTarget(name, copyPath), { recursive: true, force: true });

export const pathCopyState = async (
  name: string,
  integrity: string,
  copyPath: string,
): Promise<{ missing: boolean; modified: boolean }> => {
  const target = await pathCopyTarget(name, copyPath);
  if (!present(target)) return { missing: true, modified: false };
  return { missing: false, modified: (await integrityOfDir(target)) !== integrity };
};
