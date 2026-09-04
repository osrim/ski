import { isAbsolute, relative, resolve } from "node:path";
import { projectRoot, type Scope } from "../paths.ts";
import type { DiscoveredSkill } from "./discover.ts";
import type { SourceKind, Coordinate } from "./coordinate.ts";
import type { Revision } from "./revision.ts";
import type { SkillFile } from "../skill/files.ts";
import type { InstalledSkill } from "../install/placement.ts";
import { GitSource } from "./git-source.ts";
import { LocalSource } from "./local-source.ts";

export const LOCAL_PREFIX = "local:";

export interface Upstream {
  revision: Revision;
  outdated: boolean;
  moved: boolean;
  gone: boolean;
  ahead: number;
}

export interface Changes {
  patch: string;
}

export interface Source {
  readonly kind: SourceKind;
  readonly display: string;
  readonly id: string;

  forScope(scope: Scope): Source;
  resolve(userRef?: string): Promise<Revision>;
  upstream(skill: InstalledSkill): Promise<Upstream>;
  discover(rev: string | undefined, root?: string): Promise<DiscoveredSkill[]>;
  splitTree(segments: string[]): Promise<{ ref?: string; dir: string }>;
  fetchFiles(rev: string | undefined, path: string): Promise<SkillFile[]>;
  changes(from: InstalledSkill, to: string | undefined, before: string): Promise<Changes>;
}

export const sourceFor = (id: string, base?: string): Source => {
  if (id.startsWith(LOCAL_PREFIX)) {
    const dir = id.slice(LOCAL_PREFIX.length);
    return new LocalSource(isAbsolute(dir) ? dir : resolve(base ?? projectRoot(), dir));
  }
  return new GitSource(id);
};

export const sourceForCoordinate = (coordinate: Coordinate): Source =>
  coordinate.kind === "local" ? new LocalSource(coordinate.repo) : new GitSource(coordinate.repo);

export interface ResolvedCoordinate {
  rev: Revision;
  skills: DiscoveredSkill[];
  dir: string;
  ref: string | undefined;
}

export const resolveCoordinate = async (
  source: Source,
  coordinate: Coordinate,
): Promise<ResolvedCoordinate> => {
  let dir = "";
  let ref = coordinate.ref;
  if (coordinate.tree) {
    const split = await source.splitTree(coordinate.tree);
    dir = split.dir;
    ref ??= split.ref;
  }
  const rev = await source.resolve(ref);
  return { rev, skills: await source.discover(rev.commit, dir), dir, ref };
};

export const localSourceId = (dir: string, scope: Scope): string => {
  if (scope === "global") return `${LOCAL_PREFIX}${dir}`;
  const root = projectRoot();
  const rel = relative(root, dir);
  const inside = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  return `${LOCAL_PREFIX}${inside ? `./${rel}` : dir}`;
};

export const coordinateFor = (sourceId: string): string =>
  sourceId.startsWith(LOCAL_PREFIX)
    ? resolve(projectRoot(), sourceId.slice(LOCAL_PREFIX.length))
    : sourceId;
