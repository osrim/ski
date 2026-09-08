import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureEnv } from "../test-env.ts";

let tmp: string;
const restoreEnv = captureEnv("HOME", "SKI_HOME");
const cli = join(import.meta.dir, "..", "index.ts");

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "ski-path-cli-test-")));
  process.env.HOME = tmp;
  process.env.SKI_HOME = join(tmp, "ski-home");
});

afterAll(async () => {
  restoreEnv();
  await rm(tmp, { recursive: true, force: true });
});

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const runCli = async (cwd: string, ...args: string[]): Promise<RunResult> => {
  const child = Bun.spawn([process.execPath, cli, ...args], {
    cwd,
    env: {
      ...process.env,
      HOME: tmp,
      SKI_HOME: join(tmp, "ski-home"),
      CI: "1",
      NO_COLOR: "1",
      TERM: "dumb",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
};

const runInteractiveCli = async (cwd: string, ...args: string[]): Promise<RunResult> => {
  const decoder = new TextDecoder();
  let output = "";
  let prompt = 0;
  const child = Bun.spawn([process.execPath, cli, ...args], {
    cwd,
    env: {
      ...process.env,
      HOME: tmp,
      SKI_HOME: join(tmp, "ski-home"),
      CI: "1",
      NO_COLOR: "1",
      TERM: "dumb",
    },
    terminal: {
      data(terminal, data) {
        output += decoder.decode(data, { stream: true });
        if (prompt === 0 && output.includes("Add these dependencies?")) {
          prompt++;
          terminal.write(" \r");
        } else if (prompt === 1 && output.includes("Copy primary, helper?")) {
          prompt++;
          terminal.write("\r");
        }
      },
    },
  });
  const exitCode = await child.exited;
  child.terminal?.close();
  output += decoder.decode();
  return { exitCode, stdout: output, stderr: "" };
};

const makeSkill = async (root: string, name: string, body = `# ${name}\n`): Promise<void> => {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: test\n---\n${body}`);
};

test("add --copy --path writes every skill below the destination root and records no agents", async () => {
  const project = join(tmp, "add-project");
  const source = join(tmp, "add-source");
  await mkdir(join(project, ".git"), { recursive: true });
  await makeSkill(source, "alpha");
  await makeSkill(source, "beta");

  const result = await runCli(
    project,
    "add",
    source,
    "--copy",
    "--path",
    "./custom-directory",
    "--all",
    "--yes",
  );

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(await readFile(join(project, "custom-directory", "alpha", "SKILL.md"), "utf8")).toContain(
    "name: alpha",
  );
  expect(await readFile(join(project, "custom-directory", "beta", "SKILL.md"), "utf8")).toContain(
    "name: beta",
  );
  const lock = JSON.parse(await readFile(join(project, "ski-lock.json"), "utf8"));
  expect(lock.skills.alpha).toMatchObject({
    copy: true,
    copyPath: "custom-directory",
  });
  expect(lock.skills.alpha.agents).toBeUndefined();
});

test.each([false, true])(
  "an approved dependency uses the same path-copy destination root, critical: %s",
  async (critical) => {
    const project = join(tmp, `dependency-project-${critical}`);
    const sourceDir = join(tmp, `dependency-source-${critical}`);
    await mkdir(join(project, ".git"), { recursive: true });
    await makeSkill(sourceDir, "primary", "Use /helper.\n");
    await makeSkill(sourceDir, "helper");
    if (critical) await writeFile(join(sourceDir, "helper", "hooks.json"), "{}\n");

    const result = await runInteractiveCli(
      project,
      "add",
      sourceDir,
      "primary",
      "--copy",
      "--path",
      "published",
      ...(critical ? ["--dangerous-skip-critical-approval"] : []),
    );

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(project, "published", "primary", "SKILL.md"))).toBe(true);
    expect(existsSync(join(project, "published", "helper", "SKILL.md"))).toBe(true);
    const lock = JSON.parse(await readFile(join(project, "ski-lock.json"), "utf8"));
    expect(lock.skills.primary).toMatchObject({ copy: true, copyPath: "published" });
    expect(lock.skills.helper).toMatchObject({ copy: true, copyPath: "published" });
    if (critical) {
      expect(result.stdout).toContain("critical");
      expect(result.stdout).toContain("hooks.json");
      expect(result.stdout).not.toContain("Approve helper with");
    }
  },
);

test("--path reports invalid combinations and escaping destinations as usage errors", async () => {
  const project = join(tmp, "usage-project");
  const source = join(tmp, "usage-source");
  await mkdir(join(project, ".git"), { recursive: true });
  await makeSkill(source, "demo");

  const cases = [
    { args: ["--path", "./custom-directory"], message: "Pass --copy with --path." },
    {
      args: ["--copy", "--path", "./custom-directory", "--global"],
      message: "Do not combine --path with --global.",
    },
    {
      args: ["--copy", "--path", "./custom-directory", "--agent", "claude"],
      message: "Do not combine --path with --agent.",
    },
    {
      args: ["--copy", "--path", "../outside"],
      message: "must not contain `..`",
    },
  ];
  for (const item of cases) {
    const result = await runCli(project, "add", source, "--all", "--yes", ...item.args);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(item.message);
  }
});

test("list identifies a path copy and JSON keeps source and destination paths distinct", async () => {
  const project = join(tmp, "list-project");
  const source = join(tmp, "list-source");
  await mkdir(join(project, ".git"), { recursive: true });
  await makeSkill(source, "demo");
  expect(
    (
      await runCli(
        project,
        "add",
        source,
        "demo",
        "--copy",
        "--path",
        "./custom-directory",
        "--yes",
      )
    ).exitCode,
  ).toBe(0);

  const human = await runCli(project, "list");
  expect(human.exitCode).toBe(0);
  expect(human.stdout).toContain("custom-directory/demo");
  expect(human.stdout).not.toContain("1 missing");

  const json = await runCli(project, "list", "--json");
  expect(json.exitCode).toBe(0);
  expect(json.stderr).toBe("");
  const row = JSON.parse(json.stdout).skills[0];
  expect(row.path).toBe("demo");
  expect(row.copyPath).toBe("custom-directory");
  expect(row.agents).toEqual([]);
  expect(row.links).toEqual([]);
});

test("update detects edits and replaces the recorded path copy", async () => {
  const project = join(tmp, "update-project");
  const source = join(tmp, "update-source");
  await mkdir(join(project, ".git"), { recursive: true });
  await makeSkill(source, "demo", "version one\n");
  expect(
    (await runCli(project, "add", source, "--copy", "--path", "published", "--all", "--yes"))
      .exitCode,
  ).toBe(0);

  const installed = join(project, "published", "demo", "SKILL.md");
  await writeFile(installed, "local edit\n");
  const listed = await runCli(project, "list");
  expect(listed.stdout).toContain("1 modified");

  await makeSkill(source, "demo", "version two\n");
  const updated = await runCli(project, "update", "demo", "--yes");
  expect(updated.exitCode).toBe(0);
  expect(updated.stdout).not.toContain("installed content is missing");
  expect(updated.stdout).toContain("local edit");
  expect(await readFile(installed, "utf8")).toContain("version two");
});

test("install restores a missing path copy without selecting agents", async () => {
  const project = join(tmp, "install-project");
  const source = join(tmp, "install-source");
  await mkdir(join(project, ".git"), { recursive: true });
  await makeSkill(source, "demo");
  expect(
    (await runCli(project, "add", source, "--copy", "--path", "published", "--all", "--yes"))
      .exitCode,
  ).toBe(0);

  const target = join(project, "published", "demo");
  await rm(target, { recursive: true });
  const listed = await runCli(project, "list");
  expect(listed.stdout).toMatch(/demo\s+\S+\s+published\/demo copy \(missing\)/u);
  expect(listed.stdout).toContain("1 missing");
  const installed = await runCli(project, "install", "--yes");
  expect(installed.exitCode).toBe(0);
  expect(installed.stdout).not.toContain("Linking to");
  expect(installed.stdout).not.toContain("No agent detected");
  expect(installed.stdout).toContain("Installed 1/1 skill(s) (project: published)");
  expect(await readFile(join(target, "SKILL.md"), "utf8")).toContain("name: demo");
});

test("install keeps a modified path copy without --yes and replaces it with --yes", async () => {
  const project = join(tmp, "modified-install-project");
  const source = join(tmp, "modified-install-source");
  await mkdir(join(project, ".git"), { recursive: true });
  await makeSkill(source, "demo");
  expect(
    (await runCli(project, "add", source, "--copy", "--path", "published", "--all", "--yes"))
      .exitCode,
  ).toBe(0);

  const file = join(project, "published", "demo", "SKILL.md");
  await writeFile(file, "keep me\n");
  const kept = await runCli(project, "install");
  expect(kept.exitCode).toBe(1);
  expect(await readFile(file, "utf8")).toBe("keep me\n");
  expect(kept.stderr).toContain("modified, skipped");

  const restored = await runCli(project, "install", "--yes");
  expect(restored.exitCode).toBe(0);
  expect(await readFile(file, "utf8")).toContain("name: demo");
});

test("remove deletes only the managed skill directory below a destination root", async () => {
  const project = join(tmp, "remove-project");
  const source = join(tmp, "remove-source");
  await mkdir(join(project, ".git"), { recursive: true });
  await makeSkill(source, "demo");
  expect(
    (await runCli(project, "add", source, "--copy", "--path", "published", "--all", "--yes"))
      .exitCode,
  ).toBe(0);
  await writeFile(join(project, "published", "keep.txt"), "keep\n");

  const removed = await runCli(project, "remove", "demo", "--yes");
  expect(removed.exitCode).toBe(0);
  expect(existsSync(join(project, "published", "demo"))).toBe(false);
  expect(await readFile(join(project, "published", "keep.txt"), "utf8")).toBe("keep\n");
  const lock = JSON.parse(await readFile(join(project, "ski-lock.json"), "utf8"));
  expect(lock.skills).toEqual({});
});

test.each([false, true])(
  "an unmanaged path collision skips one skill while the rest of the batch lands, critical: %s",
  async (critical) => {
    const project = join(tmp, `collision-project-${critical}`);
    const source = join(tmp, `collision-source-${critical}`);
    await mkdir(join(project, ".git"), { recursive: true });
    await makeSkill(source, "alpha");
    await makeSkill(source, "beta");
    if (critical) await writeFile(join(source, "beta", "hooks.json"), "{}\n");
    await mkdir(join(project, "published", "alpha"), { recursive: true });
    await writeFile(join(project, "published", "alpha", "mine.txt"), "mine\n");

    const result = await runCli(
      project,
      "add",
      source,
      "--copy",
      "--path",
      "published",
      "--all",
      "--yes",
      ...(critical ? ["--dangerous-skip-critical-approval"] : []),
    );
    expect(result.exitCode).toBe(1);
    if (critical) expect(result.stdout).toContain("critical");
    expect(result.stderr).toContain("exists but is unmanaged");
    expect(await readFile(join(project, "published", "alpha", "mine.txt"), "utf8")).toBe("mine\n");
    expect(await readFile(join(project, "published", "beta", "SKILL.md"), "utf8")).toContain(
      "name: beta",
    );
    const lock = JSON.parse(await readFile(join(project, "ski-lock.json"), "utf8"));
    expect(Object.keys(lock.skills)).toEqual(["beta"]);
  },
);

test("changing a path copy to an agent copy requires remove then add", async () => {
  const project = join(tmp, "placement-project");
  const source = join(tmp, "placement-source");
  await mkdir(join(project, ".git"), { recursive: true });
  await makeSkill(source, "demo");
  expect(
    (await runCli(project, "add", source, "--copy", "--path", "published", "--all", "--yes"))
      .exitCode,
  ).toBe(0);

  const changed = await runCli(
    project,
    "add",
    source,
    "demo",
    "--copy",
    "--agent",
    "claude",
    "--yes",
  );
  expect(changed.exitCode).toBe(1);
  expect(changed.stderr).toContain("Run `ski remove demo` first");
  const lock = JSON.parse(await readFile(join(project, "ski-lock.json"), "utf8"));
  expect(lock.skills.demo.copyPath).toBe("published");
  expect(lock.skills.demo.agents).toBeUndefined();
});

test("install restores mixed link, agent-copy, and path-copy placements", async () => {
  const project = join(tmp, "mixed-project");
  const source = join(tmp, "mixed-source");
  await mkdir(join(project, ".git"), { recursive: true });
  await makeSkill(source, "alpha");
  await makeSkill(source, "beta");
  await makeSkill(source, "gamma");

  const additions = [
    ["alpha", "--copy", "--path", "published"],
    ["beta", "--project", "--agent", "claude"],
    ["gamma", "--project", "--copy", "--agent", "universal"],
  ];
  for (const args of additions) {
    expect((await runCli(project, "add", source, ...args, "--yes")).exitCode).toBe(0);
  }

  await rm(join(project, "published", "alpha"), { recursive: true });
  await rm(join(project, ".claude", "skills", "beta"), { force: true });
  await rm(join(project, ".ski", "skills", "beta"), { recursive: true });
  await rm(join(project, ".agents", "skills", "gamma"), { recursive: true });

  const installed = await runCli(project, "install", "--agent", "opencode", "--yes");
  expect(installed.exitCode).toBe(0);
  expect(existsSync(join(project, "published", "alpha", "SKILL.md"))).toBe(true);
  expect((await lstat(join(project, ".opencode", "skills", "beta"))).isSymbolicLink()).toBe(true);
  expect((await lstat(join(project, ".agents", "skills", "gamma"))).isDirectory()).toBe(true);
});

test("a critical finding blocks a non-interactive path copy with exit code 3", async () => {
  const project = join(tmp, "critical-project");
  const source = join(tmp, "critical-source");
  await mkdir(join(project, ".git"), { recursive: true });
  await makeSkill(source, "dangerous");
  await writeFile(
    join(source, "dangerous", "SKILL.md"),
    "---\nname: dangerous\ndescription: test\nhooks: {}\n---\n# Dangerous\n",
  );

  const result = await runCli(
    project,
    "add",
    source,
    "--copy",
    "--path",
    "published",
    "--all",
    "--yes",
  );
  expect(result.exitCode).toBe(3);
  expect(result.stdout).toContain("critical");
  expect(existsSync(join(project, "published", "dangerous"))).toBe(false);
});

test("the dangerous flag writes a path copy while retaining critical findings", async () => {
  const project = join(tmp, "skip-critical-project");
  const source = join(tmp, "skip-critical-source");
  await mkdir(join(project, ".git"), { recursive: true });
  await makeSkill(source, "dangerous");
  await writeFile(join(source, "dangerous", "hooks.json"), "{}\n");

  const result = await runCli(
    project,
    "add",
    source,
    "--copy",
    "--path",
    "published",
    "--all",
    "--yes",
    "--dangerous-skip-critical-approval",
  );

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("critical");
  expect(result.stdout).toContain("hooks.json");
  expect(result.stdout).toContain("2 file(s)");
  expect(await readFile(join(project, "published", "dangerous", "hooks.json"), "utf8")).toBe(
    "{}\n",
  );
  const lock = JSON.parse(await readFile(join(project, "ski-lock.json"), "utf8"));
  expect(lock.skills.dangerous).toMatchObject({ copy: true, copyPath: "published" });
  expect(JSON.stringify(lock)).not.toContain("dangerousSkipCriticalApproval");
});

test("a path-copy update needs a fresh critical approval override on each invocation", async () => {
  const project = join(tmp, "critical-update-project");
  const source = join(tmp, "critical-update-source");
  await mkdir(join(project, ".git"), { recursive: true });
  await makeSkill(source, "demo", "version one\n");
  expect(
    (await runCli(project, "add", source, "--copy", "--path", "published", "--all", "--yes"))
      .exitCode,
  ).toBe(0);
  const installed = join(project, "published", "demo", "SKILL.md");
  const lockPath = join(project, "ski-lock.json");
  const beforeFile = await readFile(installed, "utf8");
  const beforeLock = await readFile(lockPath, "utf8");
  await makeSkill(source, "demo", "version two\n");
  await writeFile(join(source, "demo", "hooks.json"), "{}\n");

  const blocked = await runCli(project, "update", "--all", "--yes");
  expect(blocked.exitCode).toBe(3);
  expect(await readFile(installed, "utf8")).toBe(beforeFile);
  expect(await readFile(lockPath, "utf8")).toBe(beforeLock);
  expect(existsSync(join(project, "published", "demo", "hooks.json"))).toBe(false);

  const unconfirmed = await runCli(
    project,
    "update",
    "--all",
    "--dangerous-skip-critical-approval",
  );
  expect(unconfirmed.exitCode).toBe(2);
  expect(unconfirmed.stderr).toContain("Pass -y to proceed.");
  expect(await readFile(installed, "utf8")).toBe(beforeFile);
  expect(await readFile(lockPath, "utf8")).toBe(beforeLock);

  const updated = await runCli(
    project,
    "update",
    "--all",
    "--yes",
    "--dangerous-skip-critical-approval",
  );
  expect(updated.exitCode).toBe(0);
  expect(updated.stdout).toContain("critical");
  expect(updated.stdout).toContain("hooks.json");
  expect(await readFile(installed, "utf8")).toContain("version two");
  expect(await readFile(join(project, "published", "demo", "hooks.json"), "utf8")).toBe("{}\n");
  const updatedLock = await readFile(lockPath, "utf8");
  expect(JSON.parse(updatedLock).skills.demo.integrity).not.toBe(
    JSON.parse(beforeLock).skills.demo.integrity,
  );
  expect(updatedLock).not.toContain("dangerousSkipCriticalApproval");

  await makeSkill(source, "demo", "version three\n");
  expect((await runCli(project, "update", "--all", "--yes")).exitCode).toBe(3);
  expect(await readFile(installed, "utf8")).toContain("version two");
  expect(await readFile(lockPath, "utf8")).toBe(updatedLock);
});

test("the dangerous flag does not confirm a path-copy write", async () => {
  const project = join(tmp, "unconfirmed-critical-project");
  const source = join(tmp, "unconfirmed-critical-source");
  await mkdir(join(project, ".git"), { recursive: true });
  await makeSkill(source, "demo");
  await writeFile(join(source, "demo", "hooks.json"), "{}\n");

  const result = await runCli(
    project,
    "add",
    source,
    "--copy",
    "--path",
    "published",
    "--all",
    "--dangerous-skip-critical-approval",
  );
  expect(result.exitCode).toBe(2);
  expect(result.stdout).toContain("critical");
  expect(result.stderr).toContain("Pass -y to proceed.");
  expect(existsSync(join(project, "published", "demo"))).toBe(false);
  expect(existsSync(join(project, "ski-lock.json"))).toBe(false);
});
