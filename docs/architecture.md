# How the code is organized

`ski` is a Bun workspace with one package in `cli/`.

## Layers

```text
index.ts -> commands -> ui -> core
                    \------> core
```

- `commands/` owns each command's policy and sequence. A command may contain prompts or
  spinner setup that only that command uses.
- `ui/` contains terminal behavior shared by commands: prompts, gates, reports, styling,
  per-skill progress, and exit status for UI failures.
- `core/` implements behavior without terminal input, output, or process exits.
- `index.ts` registers commands, renders root help, starts the update check for the
  commands that use the network, and handles argument and top-level errors.

Commands may import `ui/` and `core/`. UI may import `core/`. Imports must not point
upward.

## Main modules

```text
cli/src/
  index.ts
  commands/        add, install, update, remove, list
  ui/              prompts, gates, reports, help, status, placement choices
  core/
    source/        coordinates, Git, local sources, revisions
    skill/         files, frontmatter, integrity, dependencies
    scan/          scan rules and findings
    install/       scopes, agents, store, links, placement, lockfile
```

`core/` follows the terms in [CONTEXT.md](../CONTEXT.md).

`core/source/` and `core/install/` are sibling modules. Runtime dependencies point from
`core/install/` to `core/source/`; source modules must not value-import install modules.
Source adapters may use type-only imports for installed skill data. Commands and UI code
combine source operations with installation operations.

## Command flows

The lists name the main modules in call order. Repeated entries show when a command
returns to a module. A command can return between steps when there is no work or the
user declines.

```text
add
  index.ts
  -> commands/add.ts
  -> core/source/{coordinate,index}.ts
  -> ui/target.ts
  -> core/install/link.ts
  -> core/install/lockfile.ts
  -> core/source/
  -> core/skill/integrity.ts
  -> ui/pick.ts
  -> ui/flow.ts (fetchSkillFiles)
  -> core/source/
  -> ui/gate.ts
  -> ui/deps.ts
  -> ui/flow.ts (confirm, land)
  -> core/install/placement.ts
  -> core/install/apply.ts
  -> core/install/store.ts
  -> core/source/ (if an existing locked store entry needs restoration)
  -> core/install/{store,link}.ts
  -> ui/flow.ts
  -> core/install/lockfile.ts

install
  index.ts
  -> commands/install.ts
  -> core/install/scope.ts
  -> ui/target.ts
  -> core/install/link.ts
  -> core/install/{lockfile,placement}.ts
  -> ui/{target,status}.ts
  -> ui/flow.ts (land)
  -> core/install/placement.ts
  -> core/source/index.ts
  -> core/install/apply.ts
  -> core/install/store.ts
  -> core/source/ (if the locked store entry needs restoration)
  -> core/install/{store,link}.ts

update
  index.ts
  -> commands/update.ts
  -> core/install/{scope,lockfile,placement}.ts
  -> ui/status.ts
  -> ui/prompt.ts
  -> core/source/{upstream,index}.ts
  -> core/source/{git-source,local-source}.ts
  -> ui/status.ts
  -> core/source/upstream.ts
  -> ui/pick.ts (optional selection)
  -> core/install/link.ts + core/source/ (file preview)
  -> ui/gate.ts
  -> ui/deps.ts
  -> ui/flow.ts (confirm, land)
  -> core/install/placement.ts
  -> core/install/apply.ts
  -> core/source/ (moved revisions only)
  -> core/install/{store,link}.ts
  -> ui/flow.ts
  -> core/install/lockfile.ts

remove
  index.ts
  -> commands/remove.ts
  -> core/install/{scope,lockfile,placement}.ts
  -> ui/{status,style}.ts
  -> ui/pick.ts (optional selection prompt)
  -> ui/flow.ts (confirm, land)
  -> core/install/link.ts
  -> ui/flow.ts
  -> core/install/lockfile.ts

list
  index.ts
  -> commands/list.ts
  -> core/install/{scope,lockfile,placement}.ts
  -> core/{paths,source/revision}.ts
  -> ui/{status,report,style}.ts

list --json
  index.ts
  -> commands/list.ts
  -> core/install/{scope,lockfile,placement,link}.ts
  -> core/paths.ts
  -> commands/list.ts (JSON output)
```

## Installation and lockfile writes

`ui/flow.ts` exports the shared `fetchSkillFiles`, `confirm`, and `land` operations.
`add` uses all three. `update` uses `confirm` and `land`. `install` and `remove` use
`land`, while `remove` also uses `confirm`.

`land` applies each item, reports failures, writes a supplied lockfile after the batch,
and hides managed links from Git. `add` and `remove` supply a lockfile whenever they
reach `land`. `update` reaches `land` only when it has a moved revision or an approved
file update. `install` passes no lockfile because it restores the recorded state without
changing it.

`core/install/apply.ts` materializes a store entry, copies it to the canonical
`.ski/skills/<name>` directory for the scope, and creates each requested relative link or
copy. In project scope the canonical copy sits beside a `.ski/.gitignore` that hides it. The
store is a cache: a link row installs without the network when the store holds its integrity,
and every installed skill keeps working without the store. It records the installed skill in
memory only when the caller supplies a lockfile. `add` and `update` supply one. `install` does
not. `remove` deletes the selected rows in its `land` callback.

New or changed files pass through `ui/gate.ts`. The gate lists files, runs the scan, shows
findings, and returns `pass`, `declined`, or `blocked`. `install` never reaches the gate: every
lockfile row records content that already passed it, and the integrity check proves the files
still match. `add` can install mentioned dependencies after review. `update` reports missing
dependencies without installing them. A moved revision with unchanged skill files does not
need another review.

## Module rules

- Use kebab-case filenames.
- Use `index.ts` only for a real module, not a barrel.
- Include `.ts` in imports.
- Command files export only `run` and `help`.
- Keep help copy beside its command.

## Tests

Tests cover core behavior with temporary directories and controlled network boundaries.
UI tests cover shared behavior whose output or failure handling can break.

The suite deliberately does not spawn the CLI. Tests import core and UI functions into
one Bun process. Command registration, argument wiring, and process exit handling remain
manual checks. Add a small `Bun.spawn` harness for `-y` paths when those checks become
brittle or miss a bug.
