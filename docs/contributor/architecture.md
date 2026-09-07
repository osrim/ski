# Architecture

For contributors. `ski` is a Bun workspace with one package in `cli/`. Terms follow [CONTEXT.md](../../CONTEXT.md).

## Layers

```text
index.ts -> commands -> ui -> core
                    \------> core
```

- `index.ts` registers commands, renders root help, starts the update check for commands that use the network, and turns argument and top-level errors into exit codes.
- `commands/` owns each command's policy and sequence. A prompt or spinner used by one command only may live in that command.
- `ui/` holds terminal behavior shared by commands: prompts, the review gate, reports, styling, per-skill progress, and exit status for UI failures.
- `core/` implements behavior with no terminal input, terminal output, or process exit.

Imports point downward only. Commands may import `ui/` and `core/`. UI may import `core/`. Nothing imports `commands/` or `index.ts`.

## Modules

```text
cli/src/
  index.ts
  test-env.ts        environment capture and restore, tests only
  commands/          add, install, update, remove, list
  ui/                prompts, gate, reports, help, status, destination choices
  core/
    config.ts        remembered scope and agent choices
    paths.ts         XDG roots, project root, lockfile path
    suggest.ts       command typo suggestions
    update-check.ts  latest release version check
    usage.ts         usage error type
    source/          coordinates, Git and local sources, revisions, upstream
    skill/           files, frontmatter, integrity, dependency mentions
    scan/            scan rules and findings
    install/         scope, agents, store, target checks, links, path copies, destination, lockfile
```

`core/source/` and `core/install/` are siblings. Runtime imports point from `install/` to `source/` only. Source adapters may type-import installed skill data. Commands and UI combine the two.

## Write path

Every command that writes goes through `ui/flow.ts`, which exports `fetchSkillFiles`, `confirm`, and `land`.

| command | uses |
| --- | --- |
| `add` | `fetchSkillFiles`, `confirm`, `land` |
| `update` | `confirm`, `land` |
| `remove` | `confirm`, `land` |
| `install` | `land` |

`land` applies each item, reports failures, writes the supplied lockfile after the batch, and hides managed links from Git. A failed item does not stop the batch. The command exits `1` and the lockfile matches what is on disk. `add` and `remove` always supply a lockfile. `update` supplies one only when a revision moved or a file update was approved. `install` supplies none because it restores the recorded state without changing it.

`core/install/lockfile.ts` derives one `Placement` from each entry: link, agent copy, or path copy. `core/install/destination.ts` switches on that placement.

`core/install/destination.ts` gives commands the installed location, filesystem path, state, apply destination, and removal operation. Commands do not read `agents` or `copyPath` to decide placement.

`core/install/apply.ts` refuses unmanaged targets and ensures that a store entry exists. It then applies the destination's placement.

Links use `core/install/link.ts`. Path copies use `core/install/path-copy.ts`. Both use the path probes and containment check in `core/install/target.ts`.

A path copy does not create a canonical copy or agent link. The store is a cache. Installed skills do not depend on it.

## Review gate

New or changed files pass through `ui/gate.ts`. The gate lists files, runs the scan, shows findings, and returns `pass`, `declined`, or `blocked`. `blocked` sets exit code `3`.

- `add` reaches the gate for every new skill and for dependencies it offers to install.
- `update` reaches the gate only when skill files changed. A moved revision with identical files skips it. Missing dependencies are reported, not installed.
- `install` never reaches the gate. Every lockfile entry records content that already passed it, and the integrity check proves the files still match.

An approval covers one source, path, integrity, and scope. Adding approved content to another agent does not reopen the gate.
