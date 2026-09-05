import {
  defaultBranch,
  diffSubtree,
  ensureClone,
  findRef,
  git,
  lsTreeEntries,
  readBlob,
  subtreeOid,
} from "./git.ts";
import { isSkillContent, type SkillFile } from "../skill/files.ts";
import { discoverSkills, type DiscoveredSkill } from "./discover.ts";
import { repoName } from "./coordinate.ts";
import { resolveRevision, resolveUpstream, type Revision } from "./revision.ts";
import type { InstalledSkill } from "../install/destination.ts";
import type { Scope } from "../paths.ts";
import type { Changes, Upstream, Source } from "./index.ts";

const commitOf = (skill: InstalledSkill): string => {
  if (!skill.commit) throw new Error(`${skill.name}: lockfile entry has no commit`);
  return skill.commit;
};
const branchOf = (skill: InstalledSkill): string => {
  if (!skill.branch) throw new Error(`${skill.name}: lockfile entry has no branch`);
  return skill.branch;
};

const requireCommit = (rev: string | undefined): string => {
  if (!rev) throw new Error("git source: no commit to read");
  return rev;
};

export class GitSource implements Source {
  readonly kind = "git" as const;
  readonly display: string;
  constructor(readonly id: string) {
    this.display = id;
  }

  private clone(): Promise<string> {
    return ensureClone(this.id);
  }

  forScope(_scope: Scope): Source {
    return this;
  }

  async resolve(userRef?: string): Promise<Revision> {
    return resolveRevision(await this.clone(), this.id, userRef);
  }

  async upstream(skill: InstalledSkill): Promise<Upstream> {
    const clone = await this.clone();
    const commit = commitOf(skill);
    const branch = branchOf(skill);
    const upstream = await resolveUpstream(clone, this.id, branch);
    const baseOid = await subtreeOid(clone, commit, skill.path);
    const headOid = await subtreeOid(clone, upstream.commit, skill.path);
    const gone = headOid === null;
    const outdated = !gone && (baseOid === null || baseOid !== headOid);
    const moved = !gone && !outdated && upstream.commit !== commit;
    let ahead = 0;
    if (outdated) {
      const pathspec = skill.path ? ["--", skill.path] : [];
      const counted = await git(
        ["rev-list", "--count", `${commit}..${upstream.commit}`, ...pathspec],
        clone,
      );
      ahead = counted.code === 0 ? Number.parseInt(counted.out || "0", 10) : 0;
    }
    const track = skill.track;
    return {
      revision: {
        commit: upstream.commit,
        branch,
        track,
        ...(upstream.tag ? { tag: upstream.tag } : {}),
        ...(track === "pin" && upstream.tag ? { pinnedAs: upstream.tag } : {}),
      },
      outdated,
      moved,
      gone,
      ahead,
    };
  }

  async discover(rev: string | undefined, root = ""): Promise<DiscoveredSkill[]> {
    return discoverSkills(await this.clone(), requireCommit(rev), repoName(this.id), root);
  }

  async splitTree(segments: string[]): Promise<{ ref?: string; dir: string }> {
    const clone = await this.clone();
    // Try the longest ref because branch names can contain slashes.
    for (let refSegmentCount = segments.length; refSegmentCount > 0; refSegmentCount--) {
      const ref = segments.slice(0, refSegmentCount).join("/");
      if (!(await findRef(clone, ref))) continue;
      const dir = segments.slice(refSegmentCount).join("/");
      const defaultRef = await defaultBranch(clone).catch(() => null);
      return ref === defaultRef ? { dir } : { ref, dir };
    }
    return { dir: segments.join("/") };
  }

  async fetchFiles(rev: string | undefined, path: string): Promise<SkillFile[]> {
    const commit = requireCommit(rev);
    const clone = await this.clone();
    const entries = await lsTreeEntries(clone, commit, path);
    const strip = path ? path.length + 1 : 0;
    return Promise.all(
      entries
        .filter((entry) => isSkillContent(entry.path.slice(strip)))
        .map(async (entry) => ({
          path: entry.path.slice(strip),
          content: await readBlob(clone, `${commit}:${entry.path}`),
          mode: entry.mode,
        })),
    );
  }

  async changes(from: InstalledSkill, to: string | undefined, _before: string): Promise<Changes> {
    const clone = await this.clone();
    const commit = commitOf(from);
    return { patch: await diffSubtree(clone, commit, requireCommit(to), from.path) };
  }
}
