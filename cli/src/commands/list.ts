import * as p from "@clack/prompts";
import { skillPath } from "../core/install/link.ts";
import { readLock, type LockEntry, type Lockfile } from "../core/install/lockfile.ts";
import {
  installedSkills,
  locationAgents,
  locationDisplayPath,
  locationPresent,
  modifiedSkills,
  locationsOf,
  type Location,
} from "../core/install/destination.ts";
import { lockPath, type Scope } from "../core/paths.ts";
import { displayLabel } from "../core/source/revision.ts";
import { resolveScope, scopeFlag, type ScopeOptions } from "../core/install/scope.ts";
import type { CommandHelp } from "../ui/help.ts";
import { logWarn } from "../ui/report.ts";
import { emptyScopeMessage, friendlySource, reportModified } from "../ui/status.ts";
import { bold, dim, pad, skillName, softOrange, tildify } from "../ui/style.ts";

export const help: CommandHelp = {
  description: "Show revisions, agents, missing installs, and modified files.",
  examples: ["$ ski list", "$ ski list -g", "$ ski ls --json"],
};

const MODIFIED_GLYPH = p.S_WARN;

interface ListOptions extends ScopeOptions {
  json?: boolean;
}

interface ListRow {
  name: string;
  entry: LockEntry;
  location: Location;
  modified: boolean;
}

export const run = async (options: ListOptions): Promise<void> => {
  if (options.json) return runJson(options);

  p.intro("ski list");
  const scope = resolveScope(options, p.log.warn) ?? "project";
  const lock = await readLock(scope);
  if (Object.keys(lock.skills).length === 0) {
    p.outro(await emptyScopeMessage(scope));
    return;
  }

  const rows = await buildRows(lock, scope);

  p.log.step(`Installed skills (${tildify(lockPath(scope))})`);
  printRows(rows);
  reportMissing(rows);
  reportModifiedRows(rows, scope);
  p.outro(summaryLine(rows, scope));
};

const buildRows = async (lock: Lockfile, scope: Scope): Promise<ListRow[]> => {
  const skills = installedSkills(lock);
  const locations = await locationsOf(skills, scope);
  const modified = await modifiedSkills(skills, scope);
  return skills.map(({ name, ...entry }) => ({
    name,
    entry,
    location: locations.get(name)!,
    modified: modified.has(name),
  }));
};

const locationText = (row: ListRow): string => {
  const where = locationDisplayPath(row.name, row.location);
  if (!locationPresent(row.location)) {
    return row.location.kind === "path-copy"
      ? `${where} ${dim("copy")} ${dim("(missing)")}`
      : dim("missing");
  }
  return row.location.kind === "link" ? where : `${where} ${dim("copy")}`;
};

const nameLabel = (row: ListRow): string =>
  row.modified ? `${skillName(row.name)} ${softOrange(MODIFIED_GLYPH)}` : skillName(row.name);

const printRows = (rows: ListRow[]): void => {
  const nameWidth = Math.max(...rows.map((row) => Bun.stringWidth(nameLabel(row))));
  const revWidth = Math.max(...rows.map((row) => Bun.stringWidth(displayLabel(row.entry))));

  for (const [source, items] of Map.groupBy(rows, (row) => row.entry.source)) {
    p.log.message([
      bold(friendlySource(source)),
      ...items.map((row) => {
        const cells = [
          pad(nameLabel(row), nameWidth),
          pad(displayLabel(row.entry), revWidth),
          locationText(row),
        ];
        return `  ${cells.join("  ")}`;
      }),
    ]);
  }
};

const reportMissing = (rows: ListRow[]): void => {
  const missing = rows.filter((row) => !locationPresent(row.location));
  if (missing.length === 0) return;
  p.log.info(
    `${missing.length} missing: ${missing.map((row) => skillName(row.name)).join(", ")}\nRun \`ski install\`.`,
  );
};

const reportModifiedRows = (rows: ListRow[], scope: Scope): void => {
  const modified = rows.filter((row) => row.modified);
  if (modified.length === 0) return;
  reportModified(
    modified.map((row) => row.name),
    `Run ${dim(`ski install${scopeFlag(scope)}`)} to restore them.`,
  );
};

const summaryLine = (rows: ListRow[], scope: Scope): string => {
  const missing = rows.filter((row) => !locationPresent(row.location)).length;
  const modified = rows.filter((row) => row.modified).length;
  const notes = [
    ...(missing > 0 ? [`${missing} missing`] : []),
    ...(modified > 0 ? [`${modified} modified`] : []),
  ];
  const verb = missing > 0 ? "recorded" : "installed";
  return notes.length > 0
    ? `${rows.length} skill(s) ${verb} (${scope}); ${notes.join(", ")}.`
    : `${rows.length} skill(s) installed (${scope}).`;
};

const runJson = async (options: ListOptions): Promise<void> => {
  const scope = resolveScope(options, logWarn) ?? "project";
  const lock = await readLock(scope);
  const rows = await buildRows(lock, scope);
  console.log(
    JSON.stringify(
      {
        scope,
        lockfile: lockPath(scope),
        skills: rows.map((row) =>
          Object.assign({ name: row.name }, row.entry, {
            modified: row.modified,
            agents: locationAgents(row.location),
            links: locationAgents(row.location).map((agent) => skillPath(row.name, scope, agent)),
          }),
        ),
      },
      null,
      2,
    ),
  );
};
