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
  ui/                prompts, gate, reports, help, status, placement choices
  core/
    config.ts        saved scope and agent choices
    paths.ts         XDG roots, project root, lockfile path
    suggest.ts       command typo suggestions
    update-check.ts  registry version check
    usage.ts         usage error type
    source/          coordinates, Git and local sources, revisions, upstream
    skill/           files, frontmatter, integrity, dependency mentions
    scan/            scan rules and findings
    install/         scope, agents, store, links, placement, lockfile
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

`core/install/apply.ts` ensures a store entry exists, copies it to the canonical `skills/<name>` directory for the scope, and creates each requested link or copy. The store is a cache: a link row installs offline when the store already holds its integrity, and installed skills do not depend on the store.

## Review gate

New or changed files pass through `ui/gate.ts`. The gate lists files, runs the scan, shows findings, and returns `pass`, `declined`, or `blocked`. `blocked` sets exit code `3`.

- `add` reaches the gate for every new skill and for dependencies it offers to install.
- `update` reaches the gate only when skill files changed. A moved revision with identical files skips it. Missing dependencies are reported, not installed.
- `install` never reaches the gate. Every lockfile row records content that already passed it, and the integrity check proves the files still match.

An approval covers one source, path, integrity, and scope. Adding approved content to another agent does not reopen the gate.
