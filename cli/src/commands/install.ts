import * as p from "@clack/prompts";
import { applySkill } from "../core/install/apply.ts";
import { assertSkillsDirSafe } from "../core/install/link.ts";
import { readLock } from "../core/install/lockfile.ts";
import { installedSkills, installPlacement, modifiedSkills } from "../core/install/placement.ts";
import { CRITICAL_EXIT, runScanners, type Finding } from "../core/scan/index.ts";
import { shortId } from "../core/source/revision.ts";
import { resolveScope, type ScopeOptions } from "../core/install/scope.ts";
import { sourceFor } from "../core/source/index.ts";
import { IntegrityError } from "../core/install/store.ts";
import { land } from "../ui/flow.ts";
import { stopsOn } from "../ui/gate.ts";
import type { CommandHelp } from "../ui/help.ts";
import { fail, isInteractive, unwrap } from "../ui/prompt.ts";
import { logError, logFindings, logSkillError } from "../ui/report.ts";
import { reportModified } from "../ui/status.ts";
import { skillName } from "../ui/style.ts";
import { chooseAgents, warnScopeCollisions } from "../ui/target.ts";

export const help: CommandHelp = {
  description: "Restore every skill in ski-lock.json. Modified files need confirmation.",
  examples: ["$ ski install", "$ ski i -g", "$ ski install --agent opencode -y"],
};

interface InstallOptions extends ScopeOptions {
  yes?: boolean;
  agent?: string | string[];
}

export const run = async (options: InstallOptions): Promise<void> => {
  p.intro("ski install");
  const scope = resolveScope(options, p.log.warn) ?? "project";
  const agents = await chooseAgents(options, scope);
  for (const agent of agents) {
    await assertSkillsDirSafe(scope, agent).catch((e: Error) => fail(e.message));
  }

  const lock = await readLock(scope);
  const skills = installedSkills(lock);
  if (skills.length === 0) {
    p.log.info(`${scope} lockfile is empty. Run \`ski add\`.`);
    p.outro("Nothing to install.");
    return;
  }

  warnScopeCollisions(
    skills.map((skill) => skill.name),
    scope,
    agents,
  );

  const modified = await modifiedSkills(skills, scope);
  let restore = false;
  if (modified.size > 0) {
    reportModified([...modified], "Restoring discards those edits and cannot be undone.");
    restore = await confirmOptional(
      `Restore ${modified.size} modified skill(s) from the source?`,
      options.yes,
    );
  }

  const scanned: { name: string; findings: Finding[] }[] = [];
  const installed = await land({
    items: skills,
    name: ({ name }) => name,
    apply: async (entry) => {
      const { name } = entry;
      if (modified.has(name) && !restore) {
        throw new Error(
          "modified, skipped\nCopy the edits or run `ski install -y` to discard them.",
        );
      }
      const target = await installPlacement(entry, scope, agents);
      const source = sourceFor(entry.source);
      const { backedUp, restored } = await applySkill(
        {
          name,
          source: entry.source,
          path: entry.path,
          revision: entry,
          integrity: entry.integrity,
          files: () => source.fetchFiles(entry.commit, entry.path),
          scan: (files) => {
            const findings = runScanners({ name, files });
            if (findings.length > 0) scanned.push({ name, findings });
            if (stopsOn(findings, true)) {
              process.exitCode = CRITICAL_EXIT;
              throw new Error("critical findings, skipped\nRun `ski add` to review them.");
            }
          },
        },
        target,
      );
      return {
        backedUp,
        restored,
        success: `${restored || modified.has(name) ? "restored" : "installed"} @ ${shortId(entry)}`,
      };
    },
    onError: (entry, error) => {
      if (error instanceof IntegrityError) {
        reportMismatch(entry.name, error);
      } else {
        logSkillError(entry.name, error);
      }
    },
    spinner: (entry) =>
      modified.has(entry.name) && !restore ? null : `Installing ${skillName(entry.name)}`,
    scope,
    lock: null,
  });
  for (const { name, findings } of scanned) logFindings(name, findings);
  p.outro(`Installed ${installed}/${skills.length} skill(s) (${scope}: ${agents.join(", ")}).`);
};

const confirmOptional = async (message: string, yes?: boolean): Promise<boolean> => {
  if (yes) return true;
  if (!isInteractive()) return false;
  return unwrap(await p.confirm({ message, initialValue: false }));
};

const reportMismatch = (name: string, error: IntegrityError): void => {
  logError(
    [
      `${skillName(name)}: source files do not match ski-lock.json`,
      `  expected  ${error.expected}`,
      `  actual    ${error.actual}`,
      "Run `ski add` to re-review the content.",
    ].join("\n"),
  );
};
