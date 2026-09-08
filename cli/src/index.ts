#!/usr/bin/env bun

import { cac, type CAC } from "cac";
import { USAGE_ERROR } from "./core/usage.ts";
import { nearest } from "./core/suggest.ts";
import { startUpdateCheck } from "./core/update-check.ts";
import { applyCommandHelp, applyRootHelp, type CommandHelp } from "./ui/help.ts";
import { enforceColorPolicy } from "./ui/style.ts";
import pkg from "../package.json" with { type: "json" };

enforceColorPolicy();

const LOADERS = {
  add: () => import("./commands/add.ts"),
  install: () => import("./commands/install.ts"),
  update: () => import("./commands/update.ts"),
  remove: () => import("./commands/remove.ts"),
  list: () => import("./commands/list.ts"),
};

type CommandName = keyof typeof LOADERS;

const isCommandName = (name: string | undefined): name is CommandName =>
  name !== undefined && name in LOADERS;

let matchedHelp: CommandHelp | undefined;

const buildCli = (): CAC => {
  const cli = cac("ski");
  cli
    .command("add <coordinate> [...skills]", "Add skills from Git or a local path")
    .option("-g, --global", "Use global scope")
    .option("-p, --project", "Use project scope")
    .option("-a, --all", "Select all skills")
    .option("-y, --yes", "Skip ordinary confirmations")
    .option("--dangerous-skip-critical-approval", "Skip approval for critical findings. Dangerous.")
    .option("--agent <id>", "Agents to install to: claude, opencode, universal. Repeatable")
    .option("--copy", "Copy directories instead of linking")
    .option(
      "--path <directory>",
      "With --copy, write below a project destination root. Do not combine --path with -g or --agent",
    )
    .action(async (coordinate, skills, options) =>
      (await LOADERS.add()).run(coordinate, skills, options),
    );
  cli
    .command("install", "Restore skills from ski-lock.json")
    .alias("i")
    .option("-g, --global", "Use the global scope")
    .option("-p, --project", "Use project scope")
    .option("-y, --yes", "Accept defaults and restore edits")
    .option("--agent <id>", "Agents to install to: claude, opencode, universal. Repeatable")
    .action(async (options) => (await LOADERS.install()).run(options));
  cli
    .command("update [...skills]", "Update skills from upstream")
    .alias("up")
    .option("-g, --global", "Use the global scope")
    .option("-p, --project", "Use project scope")
    .option("-a, --all", "Select all outdated skills")
    .option("-y, --yes", "Skip ordinary confirmations")
    .option("--dangerous-skip-critical-approval", "Skip approval for critical findings. Dangerous.")
    .action(async (skills, options) => (await LOADERS.update()).run(skills, options));
  cli
    .command("remove [...skills]", "Remove installed skills")
    .alias("rm")
    .option("-g, --global", "Use the global scope")
    .option("-p, --project", "Use project scope")
    .option("-a, --all", "Select all installed skills")
    .option("-y, --yes", "Confirm removal")
    .action(async (skills, options) => (await LOADERS.remove()).run(skills, options));
  cli
    .command("list", "Show installed skills")
    .alias("ls")
    .option("-g, --global", "Use the global scope")
    .option("-p, --project", "Use project scope")
    .option("--json", "Write JSON")
    .action(async (options) => (await LOADERS.list()).run(options));

  cli.help((sections) => {
    if (matchedHelp) applyCommandHelp(sections, matchedHelp);
    else applyRootHelp(sections, cli.commands);
  });
  cli.version(pkg.version);
  cli.showHelpOnExit = false;
  cli.showVersionOnExit = false;
  return cli;
};

const suggestCommand = (cli: CAC, typo: string): string | undefined =>
  nearest(typo, [
    ...cli.commands.map((command) => command.name),
    ...cli.commands.flatMap((command) => command.aliasNames),
  ]);

const printNotice = async (notice: Promise<string | null>): Promise<void> => {
  const message = await notice;
  if (message && !process.exitCode) console.error(message);
};

try {
  const argv = process.argv;
  const cli = buildCli();
  cli.parse(argv, { run: false });
  const notice = startUpdateCheck(pkg.version, Boolean(cli.options.json));

  if (cli.options.version) {
    console.info(`ski/${pkg.version} ${process.platform}-${process.arch} bun-v${Bun.version}`);
    await printNotice(notice);
    process.exit(0);
  }

  if (cli.options.help) {
    if (isCommandName(cli.matchedCommand?.name))
      matchedHelp = (await LOADERS[cli.matchedCommand.name]()).help;
    cli.outputHelp();
    if (!matchedHelp) await printNotice(notice);
    process.exit(0);
  }

  if (!cli.matchedCommand) {
    const typo = argv.length > 2 && !argv[2]!.startsWith("-") ? argv[2]! : null;
    if (typo === null) {
      cli.outputHelp();
      await printNotice(notice);
      process.exit(0);
    }
    const guess = suggestCommand(cli, typo);
    console.error(
      `Unknown command: ${typo}\n${guess ? `Did you mean \`ski ${guess}\`?` : "Run `ski --help` for the command list."}`,
    );
    process.exit(2);
  }

  if (cli.matchedCommand.name === "install" && cli.args.length > 0) {
    console.error(
      `ski install takes no arguments.\nTo add ${cli.args[0]}, run \`ski add ${cli.args.join(" ")}\`.`,
    );
    process.exit(2);
  }

  await cli.runMatchedCommand();
  await printNotice(notice);
} catch (e) {
  if (e instanceof Error && (e.name === "CACError" || e.name === USAGE_ERROR)) {
    console.error(`${e.message}\nSee \`ski --help\`.`);
    process.exit(2);
  }
  console.error(`Error: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
