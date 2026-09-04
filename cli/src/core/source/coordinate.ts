import { isAbsolute, resolve as resolvePath } from "node:path";
import { userHome } from "../paths.ts";

export type SourceKind = "git" | "local";

export interface Coordinate {
  repo: string;
  kind: SourceKind;
  skill?: string;
  ref?: string;
  tree?: string[];
}

const GITHUB_SHORTHAND = /^[\w.-]+\/[\w.-]+$/u;

const LOCAL_PATH = /^(~|\.{1,2})?\//u;

const isLocalPath = (raw: string): boolean =>
  LOCAL_PATH.test(raw) || raw === "~" || raw === "." || raw === "..";

export const repoName = (repo: string): string =>
  repo
    .replace(/\/+$/u, "")
    .split("/")
    .pop()!
    .replace(/\.git$/u, "");

const splitRef = (input: string): { base: string; ref?: string } => {
  const refSeparator = input.lastIndexOf("@");
  if (refSeparator > input.lastIndexOf("/") && refSeparator > 0) {
    return { base: input.slice(0, refSeparator), ref: input.slice(refSeparator + 1) };
  }
  return { base: input };
};

const TREE_MARKERS = new Set(["tree", "blob", "blame", "raw", "src"]);
const REF_MARKERS = new Set(["commit", "commits", "releases", "tags"]);
const FILE_MARKERS = new Set(["blob", "blame", "raw"]);
const SRC_KINDS = new Set(["branch", "tag", "commit", "commits"]);

const dropGitSuffix = (name: string): string => name.replace(/\.git$/u, "");

interface WebUrl {
  repo: string;
  ref?: string;
  tree?: string[];
}

const parseWebUrl = (raw: string): WebUrl | null => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.replace(/^www\./u, "");
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (host === "raw.githubusercontent.com") {
    const [owner, repo, ...rest] = parts;
    if (!owner || !repo || rest.length === 0) return null;
    return {
      repo: `https://github.com/${owner}/${dropGitSuffix(repo)}`,
      tree: rest.slice(0, -1),
    };
  }

  const dash = parts.indexOf("-");
  const markerAt =
    dash > 0
      ? dash + 1
      : parts.findIndex(
          (part, index) => index >= 2 && (TREE_MARKERS.has(part) || REF_MARKERS.has(part)),
        );

  const kind = markerAt > 0 ? parts[markerAt] : undefined;
  if (kind === undefined || !(TREE_MARKERS.has(kind) || REF_MARKERS.has(kind))) return null;

  const repoEnd = dash > 0 ? dash : markerAt;
  if (repoEnd < 2) return null;
  const segments = parts.slice(0, repoEnd);
  segments[segments.length - 1] = dropGitSuffix(segments[segments.length - 1]!);
  const repo = `${url.protocol}//${host}/${segments.join("/")}`;

  let rest = parts.slice(markerAt + 1);

  if (kind === "releases") return rest[0] === "tag" && rest[1] ? { repo, ref: rest[1] } : { repo };
  if (kind === "tags") return rest[0] ? { repo, ref: rest[0] } : { repo };
  if (kind === "commit" || kind === "commits") return rest[0] ? { repo, ref: rest[0] } : { repo };

  if (kind === "src" && rest[0] !== undefined && SRC_KINDS.has(rest[0])) rest = rest.slice(1);
  if (FILE_MARKERS.has(kind)) rest = rest.slice(0, -1);

  return rest.length > 0 ? { repo, tree: rest } : { repo };
};

const assertSafeUrl = (raw: string): void => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return;
  }
  if (url.protocol === "http:") {
    throw new Error(`Plain HTTP is not supported.\nUse https://${url.host}${url.pathname}.`);
  }
  // Neither message repeats the URL: it holds the secret being rejected.
  if (url.protocol === "ssh:") {
    if (url.password) throw new Error("Remove the password from the URL.\nUse an SSH key.");
    return;
  }
  if (url.username || url.password) {
    throw new Error("Remove the credentials from the URL.\nUse SSH or a git credential helper.");
  }
};

const localPath = (raw: string): string => {
  const expanded = raw === "~" || raw.startsWith("~/") ? userHome() + raw.slice(1) : raw;
  return isAbsolute(expanded) ? expanded : resolvePath(expanded);
};

export const parseCoordinate = (raw: string): Coordinate => {
  const input = raw.trim();
  if (!input) throw new Error("empty coordinate");

  let repoPart = input;
  let skill: string | undefined;
  let ref: string | undefined;

  const skillSeparator = input.indexOf("#");
  if (skillSeparator >= 0) {
    repoPart = input.slice(0, skillSeparator);
    const skillPart = input.slice(skillSeparator + 1);
    const split = splitRef(skillPart);
    skill = split.base;
    ref = split.ref;
    if (!skill) throw new Error(`invalid coordinate "${raw}": empty skill after #`);
  }

  const split = splitRef(repoPart);
  repoPart = split.base;
  ref ??= split.ref;
  if (ref === "") throw new Error(`invalid coordinate "${raw}": empty ref after @`);

  if (!repoPart) throw new Error(`invalid coordinate "${raw}": no repo`);

  if (isLocalPath(repoPart)) {
    if (ref !== undefined) {
      throw new Error(
        `Local paths cannot use @ref.\nUse Git instead: ski add file://${localPath(repoPart)}@${ref}`,
      );
    }
    return {
      repo: localPath(repoPart),
      kind: "local",
      ...(skill !== undefined ? { skill } : {}),
    };
  }

  assertSafeUrl(repoPart);

  const web = /^https?:\/\//u.test(repoPart) ? parseWebUrl(repoPart) : null;
  if (web) {
    const chosen = ref ?? web.ref;
    return {
      repo: web.repo,
      kind: "git",
      ...(skill !== undefined ? { skill } : {}),
      ...(chosen !== undefined ? { ref: chosen } : {}),
      ...(web.tree !== undefined ? { tree: web.tree } : {}),
    };
  }

  const repo = GITHUB_SHORTHAND.test(repoPart) ? `https://github.com/${repoPart}` : repoPart;
  if (repo !== repoPart || /^(https?:\/\/|git@|ssh:\/\/|file:\/\/)/u.test(repoPart)) {
    return {
      repo,
      kind: "git",
      ...(skill !== undefined ? { skill } : {}),
      ...(ref !== undefined ? { ref } : {}),
    };
  }
  throw new Error(`Invalid coordinate "${raw}". Use owner/repo, a Git URL, or a local path.`);
};
