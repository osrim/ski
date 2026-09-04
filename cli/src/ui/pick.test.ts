import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySkill } from "../core/install/apply.ts";
import { emptyLock } from "../core/install/lockfile.ts";
import type { SkillFile } from "../core/skill/files.ts";
import type { DiscoveredSkill } from "../core/source/discover.ts";
import { LocalSource } from "../core/source/local-source.ts";
import { pickSkillsToAdd, skillOption } from "./pick.ts";

const skill = (over: Partial<DiscoveredSkill> = {}): DiscoveredSkill => ({
  name: "tdd",
  path: "skills/tdd",
  ...over,
});

describe("skillOption", () => {
  test("a held skill is disabled and its description is hidden", () => {
    const option = skillOption({
      skill: skill({ description: "Write the test first." }),
      held: true,
    });
    expect(option.disabled).toBe(true);
    expect(option).not.toHaveProperty("hint");
  });

  test("a held skill keeps a hint for a reason the glyph cannot give", () => {
    const option = skillOption({
      skill: skill(),
      held: true,
      why: "installed from owner/repo, use ski remove",
    });
    expect(option.hint).toBe("installed from owner/repo, use ski remove");
  });

  test("an offerable skill is selectable and hints its description", () => {
    const option = skillOption({ skill: skill({ description: "Write the test first." }) });
    expect(option).not.toHaveProperty("disabled");
    expect(option.hint).toBe("Write the test first.");
  });

  test("an existing directory warns in the label and explains in the hint", () => {
    const option = skillOption({
      skill: skill({ description: "Write the test first." }),
      mark: "existing directory in claude",
    });
    expect(option).not.toHaveProperty("disabled");
    expect(option.hint).toBe("existing directory in claude");
  });

  test("an ambiguous skill keeps its path in both the value and the label", () => {
    const option = skillOption({ skill: skill({ ambiguous: true }) });
    expect(option.value).toBe("skills/tdd");
    expect(option.label).toContain("skills/tdd");
  });
});

describe("pickSkillsToAdd", () => {
  let tmp: string;
  let upstream: LocalSource;
  let prevHome: string | undefined;
  const files: SkillFile[] = [{ path: "SKILL.md", content: Buffer.from("hi\n"), mode: "100644" }];
  const sourceId = "https://github.com/o/r";
  const rev = { mode: "auto" as const };
  const only = skill({ name: "adhd", path: "adhd" });

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), "ski-pick-test-"));
    const sourceDir = join(tmp, "source");
    await mkdir(join(sourceDir, "adhd"), { recursive: true });
    await mkdir(join(sourceDir, "copied"), { recursive: true });
    await mkdir(join(sourceDir, "changed"), { recursive: true });
    await writeFile(join(sourceDir, "adhd", "SKILL.md"), "hi\n");
    await writeFile(join(sourceDir, "copied", "SKILL.md"), "hi\n");
    await writeFile(join(sourceDir, "changed", "SKILL.md"), "changed\n");
    upstream = new LocalSource(sourceDir, sourceId);
    process.env.SKI_HOME = join(tmp, "ski-home");
    process.env.CLAUDE_HOME = join(tmp, "claude-home");
    process.env.XDG_CONFIG_HOME = join(tmp, "xdg-config");
    prevHome = process.env.HOME;
    process.env.HOME = tmp;
  });

  afterAll(async () => {
    process.env.HOME = prevHome;
    await rm(tmp, { recursive: true, force: true });
  });

  test("asking for both of one shared name stops the run and names both paths", async () => {
    const exit = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    const written: string[] = [];
    const stderr = spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
    const shared = {
      skills: [
        skill({ name: "auto", path: "a/auto", ambiguous: true }),
        skill({ name: "auto", path: "b/auto", ambiguous: true }),
      ],
      lock: emptyLock(),
      scope: "global" as const,
      agents: ["claude" as const],
      source: upstream,
      rev,
    };
    try {
      await expect(
        pickSkillsToAdd({ ...shared, names: ["a/auto", "b/auto"], options: { copy: false } }),
      ).rejects.toThrow("exit");
      await expect(
        pickSkillsToAdd({ ...shared, names: [], options: { all: true, copy: false } }),
      ).rejects.toThrow("exit");
      expect(written.join("")).toInclude("Cannot install two skills named auto: a/auto and b/auto");
    } finally {
      exit.mockRestore();
      stderr.mockRestore();
    }
  });

  test("matching upstream bytes extend an approved skill to a missing agent", async () => {
    const lock = emptyLock();
    await applySkill(
      {
        name: "adhd",
        source: sourceId,
        path: "adhd",
        revision: { mode: "auto" },
        files: () => Promise.resolve(files),
      },
      { scope: "global", agents: ["claude"], lock },
    );
    const both = await pickSkillsToAdd({
      skills: [only],
      names: [],
      lock,
      scope: "global",
      agents: ["claude", "universal"],
      source: upstream,
      rev,
      options: { copy: false },
    });
    expect(both).toEqual({
      skills: [],
      extend: [{ skill: only, agents: ["universal"] }],
      asked: false,
    });

    const same = await pickSkillsToAdd({
      skills: [only],
      names: ["adhd"],
      lock,
      scope: "global",
      agents: ["claude"],
      source: upstream,
      rev,
      options: { copy: false },
    });
    expect(same).toEqual({ skills: [], extend: [], asked: false });
  });

  test("a skill path resolves by its last segment when no path matches", async () => {
    const picked = await pickSkillsToAdd({
      skills: [only],
      names: ["skills/adhd"],
      lock: emptyLock(),
      scope: "global",
      agents: ["claude"],
      source: upstream,
      rev,
      options: { copy: false },
    });
    expect(picked).toEqual({ skills: [only], extend: [], asked: false });
  });

  test("an exact path wins over another skill whose name is the last segment", async () => {
    const renamed = skill({ name: "docs", path: "skills/tdd" });
    const picked = await pickSkillsToAdd({
      skills: [renamed, skill({ name: "tdd", path: "other/tdd" })],
      names: ["skills/tdd"],
      lock: emptyLock(),
      scope: "global",
      agents: ["claude"],
      source: upstream,
      rev,
      options: { copy: false },
    });
    expect(picked).toEqual({ skills: [renamed], extend: [], asked: false });
  });

  test("a path matching neither a path nor a last-segment name stops the run", async () => {
    const exit = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    const written: string[] = [];
    const stderr = spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
    try {
      await expect(
        pickSkillsToAdd({
          skills: [only],
          names: ["skills/nope"],
          lock: emptyLock(),
          scope: "global",
          agents: ["claude"],
          source: upstream,
          rev,
          options: { copy: false },
        }),
      ).rejects.toThrow("exit");
      expect(written.join("")).toInclude("has no skill called skills/nope");
    } finally {
      exit.mockRestore();
      stderr.mockRestore();
    }
  });

  test("changed upstream bytes return an installed skill for review", async () => {
    const lock = emptyLock();
    const changed = skill({ name: "changed", path: "changed" });
    await applySkill(
      {
        name: "changed",
        source: sourceId,
        path: "changed",
        revision: rev,
        files: () => Promise.resolve(files),
      },
      { scope: "global", agents: ["claude"], lock },
    );

    const picked = await pickSkillsToAdd({
      skills: [changed],
      names: ["changed"],
      lock,
      scope: "global",
      agents: ["claude", "universal"],
      source: upstream,
      rev,
      options: { copy: false },
    });

    expect(picked).toEqual({ skills: [changed], extend: [], asked: false });
  });

  test("--all extends a copy row into the chosen agents its row does not name", async () => {
    const lock = emptyLock();
    const copied = skill({ name: "copied", path: "copied" });
    await applySkill(
      {
        name: "copied",
        source: sourceId,
        path: "copied",
        revision: { mode: "auto" },
        files: () => Promise.resolve(files),
      },
      { scope: "global", agents: ["claude"], lock, copy: { managed: [] } },
    );
    const picked = await pickSkillsToAdd({
      skills: [copied],
      names: [],
      lock,
      scope: "global",
      agents: ["claude", "opencode"],
      source: upstream,
      rev,
      options: { all: true, copy: true },
    });
    expect(picked).toEqual({
      skills: [],
      extend: [{ skill: copied, agents: ["opencode"] }],
      asked: false,
    });
  });
});
