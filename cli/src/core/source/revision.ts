import { integrityHex } from "../skill/integrity.ts";
import { defaultBranch, headCommit, isBranch, listTags, resolveRef } from "./git.ts";
import { pickLatestTag } from "./semver.ts";
import { repoName } from "./coordinate.ts";

export interface Revision {
  commit?: string;
  branch?: string;
  mode: "auto" | "pin";
  pinnedAs?: string;
  tag?: string;
}

export const COMMIT_HASH = /^[0-9a-f]{40}$/u;

export const shortId = (entry: { commit?: string; integrity?: string }): string =>
  (entry.commit ?? (entry.integrity === undefined ? "" : integrityHex(entry.integrity))).slice(
    0,
    8,
  );

export interface Labelled {
  pinnedAs?: string;
  tag?: string;
  commit?: string;
  integrity?: string;
}

export const displayLabel = (entry: Labelled): string =>
  entry.pinnedAs ?? entry.tag ?? shortId(entry);

export const resolveUpstream = async (
  clone: string,
  repo: string,
  branch: string,
): Promise<{ commit: string; tag?: string }> => {
  const latest = pickLatestTag(await listTags(clone), repoName(repo));
  return latest
    ? { commit: latest.commit, tag: latest.name }
    : { commit: await headCommit(clone, branch) };
};

export const resolveRevision = async (
  clone: string,
  repo: string,
  userRef?: string,
): Promise<Revision> => {
  if (userRef) {
    const commit = await resolveRef(clone, userRef);
    const branchPin = await isBranch(clone, userRef);
    return {
      commit,
      branch: branchPin ? userRef : await defaultBranch(clone),
      mode: "pin",
      ...(branchPin || COMMIT_HASH.test(userRef) ? {} : { pinnedAs: userRef }),
    };
  }
  const branch = await defaultBranch(clone);
  const { commit, tag } = await resolveUpstream(clone, repo, branch);
  return { commit, branch, mode: "auto", ...(tag ? { tag } : {}) };
};
