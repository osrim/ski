import {
  assertSkillsDirSafe,
  removeCanonical,
  removeCopy,
  unlinkSkill,
} from "../core/install/link.ts";
import { readLock } from "../core/install/lockfile.ts";
import { installedSkills, placements } from "../core/install/placement.ts";
import { resolveScope, type ScopeOptions } from "../core/install/scope.ts";
import { confirm, land } from "../ui/flow.ts";
import type { CommandHelp } from "../ui/help.ts";
import { pickToRemove } from "../ui/pick.ts";
import { fail, intro, outro, promptWarn } from "../ui/prompt.ts";
import { emptyScopeMessage } from "../ui/status.ts";
import { skillName } from "../ui/style.ts";

export const help: CommandHelp = {
  description: "Remove selected lockfile rows and managed links or copies.",
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
  const held = await placements(installedSkills(lock), scope);

  const unknown = names.filter((name) => !installed.includes(name));
  if (unknown.length > 0) {
    fail(`Not installed: ${unknown.join(", ")}\nInstalled: ${installed.map(skillName).join(", ")}`);
  }

  let selection = names;
  if (selection.length === 0 && options.all) selection = installed;
  if (selection.length === 0) {
    selection = await pickToRemove(installed, lock, held);
  }
  if (selection.length === 0) {
    outro("Nothing selected.");
    return;
  }
  const agents = new Set(selection.flatMap((name) => held.get(name)!.agents));
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
      const { form, agents: from } = held.get(name)!;
      for (const agent of from) {
        await (form === "copy" ? removeCopy(name, scope, agent) : unlinkSkill(name, scope, agent));
      }
      if (form === "link") await removeCanonical(name, scope);
      delete lock.skills[name];
      return { success: from.length > 0 ? `removed from ${from.join(", ")}` : "removed" };
    },
    scope,
    lock,
    outro: (removed) => `Removed ${removed} skill(s). Scope: ${scope}.`,
  });
};
