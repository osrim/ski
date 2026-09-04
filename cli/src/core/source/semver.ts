import type { TagRef } from "./git.ts";

interface SemVer {
  version: string;
  prerelease: boolean;
}

export const parseSemver = (input: string): SemVer | null => {
  const match = input.match(/^[vV]?(\d+)\.(\d+)(?:\.(\d+))?([-+].*)?$/u);
  if (!match) return null;
  return {
    version: `${match[1]}.${match[2]}.${match[3] ?? 0}${match[4] ?? ""}`,
    prerelease: match[4]?.startsWith("-") ?? false,
  };
};

const latestStableTag = (tags: TagRef[], prefixes: string[]): TagRef | null => {
  let bestTag: TagRef | null = null;
  let bestVersion: SemVer | null = null;
  for (const tag of tags) {
    const prefix = prefixes.find((candidate) => tag.name.startsWith(candidate));
    if (prefix === undefined) continue;
    const version = parseSemver(tag.name.slice(prefix.length));
    if (!version || version.prerelease) continue;
    if (!bestVersion || Bun.semver.order(version.version, bestVersion.version) > 0) {
      bestTag = tag;
      bestVersion = version;
    }
  }
  return bestTag;
};

export const isNewerVersion = (candidate: string, current: string): boolean => {
  const parsedCandidate = parseSemver(candidate);
  const parsedCurrent = parseSemver(current);
  return Boolean(
    parsedCandidate &&
    parsedCurrent &&
    !parsedCandidate.prerelease &&
    Bun.semver.order(parsedCandidate.version, parsedCurrent.version) > 0,
  );
};

export const pickLatestTag = (tags: TagRef[], repoName: string): TagRef | null =>
  latestStableTag(tags, [`${repoName}@`, `${repoName}-v`]) ?? latestStableTag(tags, [""]);
