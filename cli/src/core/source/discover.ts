import { basename, dirname } from "node:path";
import { Glob } from "bun";
import { lsTreeEntries, readBlob } from "./git.ts";
import { parseFrontmatter } from "../skill/frontmatter.ts";

export interface DiscoveredSkill {
  name: string;
  path: string;
  description?: string;
  warnings?: string[];
  ambiguous?: boolean;
}

export const selector = (skill: DiscoveredSkill): string =>
  skill.ambiguous ? skill.path : skill.name;

const MAX_DEPTH = 5;

const CONVENTIONAL_LAYOUT = new Glob("skills/*/SKILL.md");

const STANDARD_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/u;
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;

const slugify = (name: string): string =>
  name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

const standardWarnings = (name: string, fromFallback: boolean, description?: string): string[] => {
  const warnings: string[] = [];
  if (!STANDARD_NAME.test(name) || name.length > MAX_NAME) {
    warnings.push(
      `${name}: invalid skill name. Use lowercase letters, digits, and single hyphens.` +
        (fromFallback ? " Add `name:` to SKILL.md." : ""),
    );
  }
  if (description && description.length > MAX_DESCRIPTION) {
    warnings.push(
      `${name}: description has ${description.length} characters. Limit: ${MAX_DESCRIPTION}.`,
    );
  }
  return warnings;
};

const skillDirs = (paths: string[]): string[] => {
  if (paths.includes("SKILL.md")) return [""];

  const conventional = paths
    .filter((path) => CONVENTIONAL_LAYOUT.match(path))
    .map((path) => dirname(path));
  if (conventional.length > 0) return conventional;

  const candidates = paths
    .filter((path) => basename(path) === "SKILL.md")
    .map((path) => dirname(path))
    .filter((dir) => {
      const segments = dir === "." ? [] : dir.split("/");
      if (segments.length > MAX_DEPTH) return false;
      return !segments.some((segment) => segment.startsWith(".") || segment === "node_modules");
    })
    .toSorted((a, b) => a.length - b.length);

  const kept: string[] = [];
  for (const dir of candidates) {
    if (!kept.some((parent) => dir.startsWith(`${parent}/`))) kept.push(dir);
  }
  return kept;
};

export const discoverIn = async (
  paths: string[],
  read: (path: string) => Promise<Buffer>,
  fallbackName: string,
  root = "",
): Promise<DiscoveredSkill[]> => {
  const prefix = root ? `${root}/` : "";
  const inRoot = root ? paths.filter((path) => path.startsWith(prefix)) : paths;
  const dirs = skillDirs(inRoot.map((path) => path.slice(prefix.length)));
  const rootName = root ? basename(root) : fallbackName;

  const skills = await Promise.all(
    dirs.map(async (dir): Promise<DiscoveredSkill> => {
      const skillMd = dir === "" ? `${prefix}SKILL.md` : `${prefix}${dir}/SKILL.md`;
      const text = (await read(skillMd)).toString("utf8");
      let frontmatter: Record<string, unknown> = {};
      let malformed = false;
      try {
        frontmatter = parseFrontmatter(text);
      } catch {
        malformed = true;
      }
      const fallback = dir === "" ? rootName : basename(dir);
      const declared = frontmatter["name"];
      const slug = typeof declared === "string" ? slugify(declared) : "";
      const name = slug || fallback;
      const declaredDescription = frontmatter["description"];
      const description =
        typeof declaredDescription === "string" && declaredDescription
          ? declaredDescription
          : undefined;
      const warnings = standardWarnings(name, typeof declared !== "string", description);
      if (malformed) warnings.unshift(`${name}: invalid YAML in SKILL.md frontmatter.`);
      const skill: DiscoveredSkill = { name, path: dir === "" ? root : `${prefix}${dir}` };
      if (description !== undefined) skill.description = description;
      if (warnings.length > 0) skill.warnings = warnings;
      return skill;
    }),
  );

  const countByName = new Map<string, number>();
  for (const skill of skills) countByName.set(skill.name, (countByName.get(skill.name) ?? 0) + 1);
  for (const skill of skills) if (countByName.get(skill.name)! > 1) skill.ambiguous = true;

  return skills.toSorted((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
};

export const discoverSkills = async (
  clone: string,
  rev: string,
  repoName: string,
  root = "",
): Promise<DiscoveredSkill[]> => {
  const entries = await lsTreeEntries(clone, rev, root);
  return discoverIn(
    entries.map((entry) => entry.path),
    (path) => readBlob(clone, `${rev}:${path}`),
    repoName,
    root,
  );
};
