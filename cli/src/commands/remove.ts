import { assertSkillsDirSafe } from "../core/install/link.ts";
import { readLock } from "../core/install/lockfile.ts";
import {
  installedSkills,
  locationAgents,
  locationDisplayPath,
  locationsOf,
  removeInstalledSkill,
} from "../core/install/destination.ts";
import { resolveScope, type ScopeOptions } from "../core/install/scope.ts";
import { confirm, land } from "../ui/flow.ts";
import type { CommandHelp } from "../ui/help.ts";
import { pickToRemove } from "../ui/pick.ts";
import { fail, intro, outro, promptWarn } from "../ui/prompt.ts";
import { emptyScopeMessage } from "../ui/status.ts";
import { skillName } from "../ui/style.ts";

export const help: CommandHelp = {
  description: "Remove selected lockfile entries and managed links or copies.",
  examples: ["$ ski remove", "$ ski rm grilling", "$ ski remove --all -y", "$ ski rm -g grilling"],
};

interface RemoveOptions extends ScopeOptions {
  all?: boolean;
  yes?: boolean;
}

export const run = async (names: string[], options: RemoveOptions): Promise<void> => {
  intro("ski remove");
  const scope = resolveScope(options, promptWarn) ?? "project";

  const lock = await readLock(scope);
  const installed = Object.keys(lock.skills).toSorted();
  if (installed.length === 0) {
    outro(await emptyScopeMessage(scope));
    return;
  }
  const locations = await locationsOf(installedSkills(lock), scope);

  const unknown = names.filter((name) => !installed.includes(name));
  if (unknown.length > 0) {
    fail(`Not installed: ${unknown.join(", ")}\nInstalled: ${installed.map(skillName).join(", ")}`);
  }

  let selection = names;
  if (selection.length === 0 && options.all) selection = installed;
  if (selection.length === 0) {
    selection = await pickToRemove(installed, lock, locations);
  }
  if (selection.length === 0) {
    outro("Nothing selected.");
    return;
  }
  const agents = new Set(selection.flatMap((name) => locationAgents(locations.get(name)!)));
  for (const agent of agents) {
    await assertSkillsDirSafe(scope, agent).catch((e: Error) => fail(e.message));
  }

  const proceed = await confirm(`Remove ${selection.map(skillName).join(", ")} (${scope})?`, {
    yes: options.yes,
    command: "remove",
    initialValue: false,
  });
  if (!proceed) {
    outro("Nothing selected.");
    return;
  }

  await land({
    items: selection,
    name: (name) => name,
    apply: async (name) => {
      const location = locations.get(name)!;
      await removeInstalledSkill(name, scope, location);
      delete lock.skills[name];
      const from = locationDisplayPath(name, location);
      return { success: from ? `removed from ${from}` : "removed" };
    },
    scope,
    lock,
    outro: (removed) => `Removed ${removed} skill(s). Scope: ${scope}.`,
  });
};
