import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";
import { discoverSkills, selector } from "./discover.ts";

let tmp: string;

const repoWith = async (name: string, files: Record<string, string>): Promise<[string, string]> => {
  const dir = join(tmp, name);
  await mkdir(dir, { recursive: true });
  await $`git -C ${dir} init -q -b main --template=`.quiet();
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await writeFile(join(dir, rel), content);
  }
  await $`git -C ${dir} add -A`.quiet();
  await $`git -C ${dir} -c commit.gpgsign=false -c user.email=t@t -c user.name=t commit -q -m init`.quiet();
  const sha = (await $`git -C ${dir} rev-parse HEAD`.text()).trim();
  return [dir, sha];
};

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ski-discover-test-"));
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

test("root SKILL.md: the repo is a single skill named after the repo", async () => {
  const [dir, sha] = await repoWith("rootskill", {
    "SKILL.md": "---\ndescription: whole repo\n---\n",
    "rules/extra.md": "x",
  });
  const skills = await discoverSkills(dir, sha, "rootskill");
  expect(skills).toEqual([{ name: "rootskill", path: "", description: "whole repo" }]);
});

test("frontmatter name wins over the dir name", async () => {
  const [dir, sha] = await repoWith("named", {
    "SKILL.md": "---\nname: fancy-name\ndescription: d\n---\n",
  });
  const skills = await discoverSkills(dir, sha, "named");
  expect(skills[0]!.name).toBe("fancy-name");
});

test("skills/<name>/SKILL.md layout", async () => {
  const [dir, sha] = await repoWith("conventional", {
    "skills/alpha/SKILL.md": "---\ndescription: a\n---\n",
    "skills/beta/SKILL.md": "---\ndescription: b\n---\n",
    "skills/beta/scripts/run.md": "aux",
    "README.md": "not a skill",
  });
  const skills = await discoverSkills(dir, sha, "conventional");
  expect(skills.map((s) => [s.name, s.path])).toEqual([
    ["alpha", "skills/alpha"],
    ["beta", "skills/beta"],
  ]);
});

test("fallback walk: depth cap, dot-dirs skipped, topmost SKILL.md per branch", async () => {
  const [dir, sha] = await repoWith("walk", {
    "packages/tools/pdf/SKILL.md": "---\ndescription: pdf\n---\n",
    "packages/tools/pdf/nested/SKILL.md": "nested under a skill, ignored",
    ".hidden/secret/SKILL.md": "in a dot dir, ignored",
    "a/b/c/d/e/f/SKILL.md": "too deep, ignored",
    "node_modules/pkg/SKILL.md": "in node_modules, ignored",
  });
  const skills = await discoverSkills(dir, sha, "walk");
  expect(skills.map((s) => s.path)).toEqual(["packages/tools/pdf"]);
});

test("a name derived from the dir warns when it breaks the Agent Skills rule", async () => {
  const [dir, sha] = await repoWith("My_Repo", {
    "SKILL.md": "---\ndescription: no name field\n---\n",
  });
  const skills = await discoverSkills(dir, sha, "My_Repo");
  expect(skills[0]!.name).toBe("My_Repo");
  expect(skills[0]!.warnings?.[0]).toContain("invalid skill name");
  expect(skills[0]!.warnings?.[0]).toContain("Add `name:` to SKILL.md");
});

test("a declared name with spaces or capitals becomes a slug, without warning", async () => {
  const [dir, sha] = await repoWith("dae6f9571534f3fbd1266a384be00e11", {
    "SKILL.md": "---\nname: The Café  Whip!\ndescription: d\n---\n",
  });
  const skills = await discoverSkills(dir, sha, "dae6f9571534f3fbd1266a384be00e11");
  expect(skills[0]!.name).toBe("the-cafe-whip");
  expect(skills[0]!.warnings).toBeUndefined();
});

test("a declared name with no letters or digits falls back to the dir, without the add-name hint", async () => {
  const [dir, sha] = await repoWith("Punct", {
    "SKILL.md": "---\nname: '!!!'\ndescription: d\n---\n",
  });
  const skills = await discoverSkills(dir, sha, "Punct");
  expect(skills[0]!.name).toBe("Punct");
  expect(skills[0]!.warnings?.[0]).toContain("invalid skill name");
  expect(skills[0]!.warnings?.[0]).not.toContain("Add `name:`");
});

test("a standard-compliant name warns about nothing", async () => {
  const [dir, sha] = await repoWith("fine", {
    "SKILL.md": "---\nname: my-skill\ndescription: d\n---\n",
  });
  expect((await discoverSkills(dir, sha, "fine"))[0]!.warnings).toBeUndefined();
});

test("an over-long description warns", async () => {
  const [dir, sha] = await repoWith("wordy", {
    "SKILL.md": `---\nname: wordy\ndescription: ${"x".repeat(1025)}\n---\n`,
  });
  const skills = await discoverSkills(dir, sha, "wordy");
  expect(skills[0]!.warnings?.[0]).toContain("1025 characters. Limit: 1024");
});

test("malformed frontmatter: named after the dir, warns why", async () => {
  const [dir, sha] = await repoWith("broken", {
    "SKILL.md": "---\nname: [unclosed\ndescription: d\n---\n",
  });
  const skills = await discoverSkills(dir, sha, "broken");
  expect(skills[0]!.name).toBe("broken");
  expect(skills[0]!.description).toBeUndefined();
  expect(skills[0]!.warnings).toEqual(["broken: invalid YAML in SKILL.md frontmatter."]);
});

test("duplicate names across dirs are marked ambiguous, not rejected", async () => {
  const [dir, sha] = await repoWith("dups", {
    "skills/x/SKILL.md": "---\nname: same\n---\n",
    "skills/y/SKILL.md": "---\nname: same\n---\n",
    "skills/z/SKILL.md": "---\nname: alone\n---\n",
  });
  const skills = await discoverSkills(dir, sha, "dups");
  expect(skills.map((s) => [s.name, s.path, s.ambiguous ?? false])).toEqual([
    ["alone", "skills/z", false],
    ["same", "skills/x", true],
    ["same", "skills/y", true],
  ]);
  expect(skills.filter((s) => s.ambiguous).map(selector)).toEqual(["skills/x", "skills/y"]);
});

test("a root scopes discovery to one subtree, keeping source-relative paths", async () => {
  const [dir, sha] = await repoWith("plugins", {
    "alpha/skills/shared/SKILL.md": "---\nname: shared\n---\n",
    "alpha/skills/only-alpha/SKILL.md": "---\nname: only-alpha\n---\n",
    "beta/skills/shared/SKILL.md": "---\nname: shared\n---\n",
  });
  const all = await discoverSkills(dir, sha, "plugins");
  expect(all.map((s) => s.path)).toEqual([
    "alpha/skills/only-alpha",
    "alpha/skills/shared",
    "beta/skills/shared",
  ]);
  expect(all.filter((s) => s.ambiguous)).toHaveLength(2);

  const alpha = await discoverSkills(dir, sha, "plugins", "alpha");
  expect(alpha.map((s) => [s.name, s.path])).toEqual([
    ["only-alpha", "alpha/skills/only-alpha"],
    ["shared", "alpha/skills/shared"],
  ]);
  expect(alpha.some((s) => s.ambiguous)).toBe(false);
});

test("a root holding SKILL.md is itself the skill, named after the directory", async () => {
  const [dir, sha] = await repoWith("plugins", {
    "alpha/SKILL.md": "---\ndescription: d\n---\n",
    "beta/skills/x/SKILL.md": "---\nname: x\n---\n",
  });
  const alpha = await discoverSkills(dir, sha, "plugins", "alpha");
  expect(alpha.map((s) => [s.name, s.path])).toEqual([["alpha", "alpha"]]);
});

test("a root with no SKILL.md under it finds nothing", async () => {
  const [dir, sha] = await repoWith("plugins", {
    "alpha/skills/x/SKILL.md": "---\nname: x\n---\n",
    "docs/guide.md": "hi\n",
  });
  expect(await discoverSkills(dir, sha, "plugins", "docs")).toEqual([]);
});
