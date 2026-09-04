import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { readDirFiles, type SkillFile } from "../skill/files.ts";
import { discoverIn, type DiscoveredSkill } from "./discover.ts";
import { git } from "./git.ts";
import { integrityOf } from "../skill/integrity.ts";
import type { Revision } from "./revision.ts";
import type { InstalledSkill } from "../install/placement.ts";
import type { Scope } from "../paths.ts";
import { localSourceId, LOCAL_PREFIX, type Changes, type Upstream, type Source } from "./index.ts";

const NO_REVISION: Revision = { mode: "auto" };

export class LocalSource implements Source {
  readonly kind = "local" as const;
  readonly display: string;
  constructor(
    readonly dir: string,
    readonly id = `${LOCAL_PREFIX}${dir}`,
  ) {
    this.display = dir;
  }

  private subtree(path: string): string {
    return path ? join(this.dir, path) : this.dir;
  }

  forScope(scope: Scope): Source {
    return new LocalSource(this.dir, localSourceId(this.dir, scope));
  }

  private async requireDir(path = ""): Promise<string> {
    const dir = this.subtree(path);
    const info = await stat(dir).catch(() => null);
    if (!info) throw new Error(`no such directory: ${dir}`);
    if (!info.isDirectory()) throw new Error(`not a directory: ${dir}`);
    return dir;
  }

  async resolve(): Promise<Revision> {
    const files = await readDirFiles(await this.requireDir());
    if (files.length === 0) throw new Error(`${this.dir} is empty`);
    return NO_REVISION;
  }

  async upstream(skill: InstalledSkill): Promise<Upstream> {
    const dir = this.subtree(skill.path);
    const info = await stat(dir).catch(() => null);
    if (!info?.isDirectory()) {
      return { revision: NO_REVISION, outdated: false, moved: false, gone: true, ahead: 0 };
    }
    const files = await readDirFiles(dir);
    return {
      revision: NO_REVISION,
      outdated: files.length > 0 && integrityOf(files) !== skill.integrity,
      moved: false,
      gone: files.length === 0,
      ahead: 0,
    };
  }

  async discover(_rev: string | undefined, root = ""): Promise<DiscoveredSkill[]> {
    const dir = await this.requireDir();
    const files = await readDirFiles(dir);
    const contentByPath = new Map(files.map((file) => [file.path, file.content]));
    return discoverIn(
      files.map((file) => file.path),
      (path) => Promise.resolve(contentByPath.get(path) ?? Buffer.alloc(0)),
      basename(dir),
      root,
    );
  }

  splitTree(segments: string[]): Promise<{ dir: string }> {
    return Promise.resolve({ dir: segments.join("/") });
  }

  async fetchFiles(_rev: string | undefined, path: string): Promise<SkillFile[]> {
    return readDirFiles(await this.requireDir(path));
  }

  async changes(from: InstalledSkill, _to: string | undefined, before: string): Promise<Changes> {
    const after = this.subtree(from.path);
    if (!existsSync(before)) {
      return { patch: "(installed content is missing; showing no diff)" };
    }
    const diffed = await git([
      "diff",
      "--no-index",
      "--stat",
      "--patch",
      "--src-prefix=installed/",
      "--dst-prefix=current/",
      before,
      after,
    ]);
    return { patch: diffed.code <= 1 ? diffed.buf.toString("utf8") : "" };
  }
}
