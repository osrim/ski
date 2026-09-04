# CLI reference

Commands, flags, aliases, and exit codes are compatibility contracts.

## Commands

| command | alias | purpose |
| --- | --- | --- |
| `add <coordinate> [...skills]` | | Add reviewed skills. |
| `install` | `i` | Restore a lockfile. |
| `update [...skills]` | `up` | Check and apply upstream changes. |
| `remove [...skills]` | `rm` | Remove managed skills. |
| `list` | `ls` | Show local installed state. |

Global options are `-h/--help` and `-v/--version`.

## `add`

```text
ski add <coordinate> [...skills] [-g|-p] [-a] [-y] [--agent <id>] [--copy]
```

Accepted coordinates are `owner/repo[/path/to/skill][@ref]`, Git URLs, forge URLs, and local paths.
HTTP URLs are rejected; use `https`. A URL that carries a username or password is rejected.
`#` is rejected with exit `2`.

- `owner/repo` expands to GitHub. Every other forge needs a full URL.
- Segments after `owner/repo` name one skill: its path in the source, else a skill whose
  name is the last segment. A Git URL path is the repo, so name the skill as a positional
  argument instead.
- An explicit `@ref` pins the skill.
- Without names, `add` opens a picker. A one-skill source skips the picker.
- Named skills must exist and have distinct names.
- `--all` selects every available skill.
- Approved content is not scanned again when added to another agent.
- `--copy` writes real directories. Remove and re-add to change form.

`add` detects same-source dependencies in skill text and offers to review them.

## `install`

```text
ski install [-g|-p] [-y] [--agent <id>]
```

`install` restores every lockfile row. It rejects positional arguments.

It verifies file integrity before writing. Modified skills need confirmation because restore discards edits. Without a terminal, modified skills are skipped unless `--yes` is set.

Every restored file is scanned, whether it was fetched or reused from the store. A row with a critical finding is skipped and the command exits `3`. `--yes` never approves critical findings. Warn findings are printed and do not stop the install.

Copy rows use the agents recorded in the row. Link rows use `--agent` or the selected defaults.

## `update`

```text
ski update [...skills] [-g|-p] [-a] [-y]
```

`update` checks every installed skill. It previews and scans changed content before writing.

- Without names or `--all`, it opens an outdated-skill picker.
- Pinned skills update only when named.
- Identical files at a new revision update without review.
- Rewritten pinned refs never update automatically.
- Missing dependencies are reported, not installed.

`update --all --yes` works without a terminal unless critical findings need review.

## `remove`

```text
ski remove [...skills] [-g|-p] [-a] [-y]
```

`remove` deletes selected lockfile rows and their managed links or copies. It does not delete unmanaged entries. It does not use the network.

Without names or `--all`, it opens a picker. `--all` selects only. `--yes` confirms removal.

## `list`

```text
ski list [-g|-p] [--json]
```

`list` reports lockfile rows, revisions, agents, missing installs, and modified files. It does not use the network.

`--json` writes one object with `scope`, `lockfile`, and `skills`. Diagnostics stay on stderr.

## Flags

| flag | commands | effect |
| --- | --- | --- |
| `-g/--global` | all | Use global scope. |
| `-p/--project` | all | Use project scope. |
| `--agent <id>` | `add`, `install` | Target `claude`, `opencode`, or `universal`. Repeat or use commas. |
| `-a/--all` | `add`, `update`, `remove` | Select all skills. It does not confirm or approve. |
| `-y/--yes` | `add`, `install`, `update`, `remove` | Accept ordinary confirmations and defaults. It cannot approve critical findings. |
| `--json` | `list` | Write JSON only to stdout. |

`-g` and `-p` cannot be combined. Passing both exits `2`.

`add` asks for scope when no scope flag is set. Other commands default to project scope. The home directory resolves to global scope.

## Exit codes

| code | meaning |
| --- | --- |
| `0` | Success or no work. |
| `1` | Operation failed. |
| `2` | Invalid usage or missing prompt input. |
| `3` | Critical findings blocked a skill. |
| `130` | Cancelled. |
