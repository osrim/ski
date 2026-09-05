import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { integrityOf } from "../skill/integrity.ts";
import type { SkillFile } from "../skill/files.ts";
import { skillsDir, type AgentId } from "./agents.ts";
import { canonicalPath, copySkill, linkSkill, skillPath, writeCanonical } from "./link.ts";
import { emptyLock, type LockEntry } from "./lockfile.ts";
import {
  addPlacement,
  installPlacement,
  lackingAgents,
  modifiedSkills,
  placementOf,
  updatePlacement,
} from "./placement.ts";
import { captureEnv } from "../../test-env.ts";

let tmp: string;

const restoreEnv = captureEnv("HOME", "SKI_HOME", "CLAUDE_HOME", "XDG_CONFIG_HOME");

const files: SkillFile[] = [
  { path: "SKILL.md", content: Buffer.from("hello\n"), mode: "100644" },
  { path: "scripts/run.sh", content: Buffer.from("echo hi\n"), mode: "100755" },
];
const integrity = integrityOf(files);
const source = "https://github.com/o/r";

const row = (name: string, agents?: AgentId[]): LockEntry & { name: string } => ({
  name,
  source,
  path: "",
  integrity,
  mode: "auto",
  ...(agents ? { copy: true, agents } : {}),
});

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ski-placement-test-"));
  process.env.SKI_HOME = join(tmp, "ski-home");
  process.env.CLAUDE_HOME = join(tmp, "claude-home");
  process.env.XDG_CONFIG_HOME = join(tmp, "xdg-config");
  process.env.HOME = tmp;
});

afterAll(async () => {
  restoreEnv();
  await rm(tmp, { recursive: true, force: true });
});

const linkInto = async (name: string, ...agents: AgentId[]): Promise<void> => {
  await writeCanonical(name, files, "global");
  for (const agent of agents) await linkSkill(name, "global", agent);
};

test("a link's agents come from disk, a copy's from the row's directories that are present", async () => {
  await linkInto("linked", "claude");
  await mkdir(join(skillsDir("global", "opencode"), "linked"), { recursive: true });
  expect(await placementOf(row("linked"), "global")).toEqual({ form: "link", agents: ["claude"] });

  await copySkill("copied", files, "global", "claude", false);
  await mkdir(join(skillsDir("global", "opencode"), "copied"), { recursive: true });
  expect(await placementOf(row("copied", ["claude", "universal"]), "global")).toEqual({
    form: "copy",
    agents: ["claude"],
  });
});

test("lackingAgents names the chosen agents without a link, foreign entries included", async () => {
  await linkInto("partial", "claude");
  await mkdir(join(skillsDir("global", "opencode"), "partial"), { recursive: true });

  expect(
    await lackingAgents(row("partial"), "global", ["claude", "opencode", "universal"]),
  ).toEqual(["opencode", "universal"]);
  expect(await lackingAgents(row("partial"), "global", ["claude"])).toEqual([]);
});

test("lackingAgents for a copy row trusts only the directories the row names", async () => {
  await copySkill("partial-copy", files, "global", "claude", false);
  await mkdir(join(skillsDir("global", "opencode"), "partial-copy"), { recursive: true });

  expect(
    await lackingAgents(row("partial-copy", ["claude"]), "global", [
      "claude",
      "opencode",
      "universal",
    ]),
  ).toEqual(["opencode", "universal"]);
  expect(
    await lackingAgents(row("partial-copy", ["claude", "universal"]), "global", [
      "claude",
      "universal",
    ]),
  ).toEqual(["universal"]);
});

test("modifiedSkills names only the rows whose canonical copy drifted", async () => {
  await linkInto("clean", "claude");
  await linkInto("touched", "claude");
  await writeFile(join(canonicalPath("touched", "global"), "SKILL.md"), "hand edit\n");
  const rows = [
    row("clean"),
    row("touched"),
    { ...row("absent"), integrity: "sha256-mZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZk=" },
  ];
  expect([...(await modifiedSkills(rows, "global"))]).toEqual(["touched"]);
  expect(existsSync(canonicalPath("clean", "global"))).toBe(true);
});

test("modifiedSkills reads a copy row's directories", async () => {
  await copySkill("dup", files, "global", "claude", false);
  await copySkill("dup", files, "global", "universal", false);
  const dup = row("dup", ["claude", "universal"]);
  expect([...(await modifiedSkills([dup], "global"))]).toEqual([]);
  await writeFile(join(skillPath("dup", "global", "universal"), "SKILL.md"), "edited\n");
  expect([...(await modifiedSkills([dup], "global"))]).toEqual(["dup"]);
  await rm(skillPath("dup", "global", "universal"), { recursive: true });
  expect([...(await modifiedSkills([dup], "global"))]).toEqual([]);
});

test("addPlacement treats a copy row's agents as managed and records the row", () => {
  const lock = emptyLock();
  const dest = { scope: "global" as const, agents: ["opencode" as const], lock };
  expect(addPlacement(row("fresh", ["claude"]), { ...dest, copy: true })).toEqual({
    ...dest,
    copy: { managed: ["claude"] },
  });
  expect(addPlacement(undefined, { ...dest, copy: true })).toEqual({
    ...dest,
    copy: { managed: [] },
  });
  expect(addPlacement(row("fresh"), { ...dest, copy: false })).toEqual(dest);
  expect(addPlacement(undefined, { ...dest, copy: false })).toEqual(dest);
  expect(addPlacement(row("fresh", ["claude"]), { ...dest, copy: false })).toEqual({
    ...dest,
    copy: { managed: ["claude"] },
  });
  expect(addPlacement(row("fresh"), { ...dest, copy: true })).toEqual(dest);
});

test("updatePlacement rewrites the held agents, else the default cover", async () => {
  const lock = emptyLock();
  expect(await updatePlacement(row("copied", ["claude", "universal"]), "global", lock)).toEqual({
    target: {
      scope: "global",
      agents: ["claude", "universal"],
      lock,
      copy: { managed: ["claude", "universal"] },
    },
    defaulted: false,
  });

  await linkInto("linked-up", "opencode");
  expect(await updatePlacement(row("linked-up"), "global", lock)).toEqual({
    target: { scope: "global", agents: ["opencode"], lock },
    defaulted: false,
  });

  expect(await updatePlacement(row("nowhere"), "global", lock)).toEqual({
    target: { scope: "global", agents: ["claude"], lock },
    defaulted: true,
  });
});

test("installPlacement writes only missing and modified copies, and links where chosen", async () => {
  await copySkill("inst", files, "global", "claude", false);
  await copySkill("inst", files, "global", "opencode", false);
  await writeFile(join(skillPath("inst", "global", "opencode"), "SKILL.md"), "edited\n");
  const managed: AgentId[] = ["claude", "opencode", "universal"];
  expect(await installPlacement(row("inst", managed), "global", ["claude"])).toEqual({
    scope: "global",
    agents: ["universal", "opencode"],
    copy: { managed },
  });
  expect(await installPlacement(row("inst-link"), "global", ["claude", "universal"])).toEqual({
    scope: "global",
    agents: ["claude", "universal"],
  });
});
