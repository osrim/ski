import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ancestorSkillsDirs,
  defaultAgents,
  detectAgents,
  overlapWarning,
  parseAgentFlag,
  skillsDir,
} from "./agents.ts";

let tmp: string;
let prev: {
  claude?: string | undefined;
  xdg?: string | undefined;
  path?: string | undefined;
  home?: string | undefined;
  cwd: string;
};

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ski-agents-test-"));
  prev = {
    claude: process.env.CLAUDE_HOME,
    xdg: process.env.XDG_CONFIG_HOME,
    path: process.env.PATH,
    home: process.env.HOME,
    cwd: process.cwd(),
  };
  process.env.HOME = join(tmp, "home");
  process.env.CLAUDE_HOME = join(tmp, "no-claude");
  process.env.XDG_CONFIG_HOME = join(tmp, "no-xdg");
  process.env.PATH = join(tmp, "empty-bin");
});

afterEach(() => {
  process.env.CLAUDE_HOME = join(tmp, "no-claude");
  process.env.XDG_CONFIG_HOME = join(tmp, "no-xdg");
  process.env.PATH = join(tmp, "empty-bin");
  process.chdir(prev.cwd);
});

afterAll(async () => {
  process.env.CLAUDE_HOME = prev.claude;
  process.env.XDG_CONFIG_HOME = prev.xdg;
  process.env.PATH = prev.path;
  process.env.HOME = prev.home;
  process.chdir(prev.cwd);
  await rm(tmp, { recursive: true, force: true });
});

const project = async (name: string, dirs: string[] = []): Promise<string> => {
  const root = join(tmp, name);
  await mkdir(join(root, ".git"), { recursive: true });
  for (const d of dirs) await mkdir(join(root, d), { recursive: true });
  process.chdir(root);
  return process.cwd();
};

test("global targets follow $CLAUDE_HOME and $XDG_CONFIG_HOME", () => {
  process.env.CLAUDE_HOME = join(tmp, "ch");
  process.env.XDG_CONFIG_HOME = join(tmp, "xdg");
  expect(skillsDir("global", "claude")).toBe(join(tmp, "ch", "skills"));
  expect(skillsDir("global", "opencode")).toBe(join(tmp, "xdg", "opencode", "skills"));
});

test("project targets are the agents' dot-dirs under the project root", async () => {
  const root = await project("targets");
  expect(skillsDir("project", "claude")).toBe(join(root, ".claude", "skills"));
  expect(skillsDir("project", "opencode")).toBe(join(root, ".opencode", "skills"));
  expect(skillsDir("project", "universal")).toBe(join(root, ".agents", "skills"));
});

test("nothing on the machine detects nothing", async () => {
  await project("bare");
  expect(detectAgents()).toEqual([]);
});

test("a global config dir detects its agent", async () => {
  await project("global-detect");
  process.env.CLAUDE_HOME = join(tmp, "real-claude");
  await mkdir(process.env.CLAUDE_HOME, { recursive: true });
  expect(detectAgents()).toEqual(["claude"]);

  process.env.XDG_CONFIG_HOME = join(tmp, "real-xdg");
  await mkdir(join(process.env.XDG_CONFIG_HOME, "opencode"), { recursive: true });
  expect(detectAgents()).toEqual(["claude", "opencode"]);
});

test("what the repo already uses counts too", async () => {
  await project("proj-detect", [".opencode"]);
  expect(detectAgents()).toEqual(["opencode"]);
});

test("universal is opt-in: never detected", async () => {
  await project("universal-detect", [".claude", ".opencode", ".agents"]);
  expect(detectAgents()).toEqual(["claude", "opencode"]);
});

test("the default is a minimal cover, not everything detected", () => {
  expect(defaultAgents(["claude", "opencode"])).toEqual(["claude"]);
  expect(defaultAgents(["claude"])).toEqual(["claude"]);
  expect(defaultAgents(["opencode"])).toEqual(["opencode"]);
  expect(defaultAgents([])).toEqual(["claude"]);
  expect(defaultAgents(["universal"])).toEqual(["claude"]);
});

test("overlapping targets warn, non-overlapping ones don't", () => {
  expect(overlapWarning(["claude"])).toBeNull();
  expect(overlapWarning(["opencode"])).toBeNull();
  expect(overlapWarning(["claude", "universal"])).toBeNull();
  expect(overlapWarning(["claude", "opencode"])).toContain(".claude/skills");
  expect(overlapWarning(["opencode", "universal"])).toContain(".agents/skills");
});

test("--agent parses repeats, commas and case; rejects unknowns", () => {
  expect(parseAgentFlag(undefined)).toBeNull();
  expect(parseAgentFlag("claude")).toEqual(["claude"]);
  expect(parseAgentFlag(["claude", "opencode"])).toEqual(["claude", "opencode"]);
  expect(parseAgentFlag("claude,OpenCode")).toEqual(["claude", "opencode"]);
  expect(parseAgentFlag(["claude", "claude"])).toEqual(["claude"]);
  expect(() => parseAgentFlag("cursor")).toThrow("Unknown agent(s): cursor");
});

test("ancestor skills dirs stop at the git worktree root", async () => {
  const raw = join(tmp, "mono");
  await mkdir(join(tmp, ".claude", "skills"), { recursive: true });
  await mkdir(join(raw, ".git"), { recursive: true });
  await mkdir(join(raw, ".claude", "skills"), { recursive: true });
  await mkdir(join(raw, "apps", "web", ".opencode", "skills"), { recursive: true });
  await mkdir(join(raw, "apps", "web", ".git"), { recursive: true });
  process.chdir(join(raw, "apps", "web"));
  const root = join(process.cwd(), "..", "..");

  expect(ancestorSkillsDirs()).toEqual([join(root, ".claude", "skills")]);
});

test("a relative XDG_CONFIG_HOME is refused rather than redirecting the install", () => {
  const saved = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "config";
  try {
    expect(() => skillsDir("global", "opencode")).toThrow(
      'XDG_CONFIG_HOME must be an absolute path, got "config".',
    );
  } finally {
    if (saved === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved;
  }
});
