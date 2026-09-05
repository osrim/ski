# Terminal output reference

This page defines CLI prompts and output.

## Streams

Human output uses a Clack frame on stdout. Runtime warnings and errors use stderr.

Security findings stay on stdout because they are part of the review. `list --json` writes only JSON to stdout.

## Prompts

| prompt | non-interactive input |
| --- | --- |
| Skill selection | Pass names or `--all`. |
| Scope or agents | Use flags or defaults. |
| Write confirmation | Pass `--yes`. |
| Critical finding approval | Run interactively. |
| Warn finding review | Continue, or skip the prompt with `--yes`. |

`--all` selects skills. It never confirms a write. `--yes` never approves critical findings.

`install` treats restore confirmation differently. Without a terminal it preserves edits and installs other rows. `--yes` allows restore.

Ctrl-C exits `130`. Completed writes remain completed.

## Defaults

Project scope is the default. The smallest detected agent set is the default target.

```text
Using project scope. Use -g for global.
Linking to claude.
```

`ski` saves explicit scope and agent choices in the config file. A broken preference is ignored.

Saved scope and agent targets preselect the next prompt. A new choice in the prompt or an explicit
flag replaces the saved value.

## Paths

`ski` follows the XDG base directories.

| path | default | variable |
| --- | --- | --- |
| global skills | `~/.local/share/ski/skills` | `XDG_DATA_HOME` |
| store | `~/.local/share/ski/store` | `XDG_DATA_HOME` |
| global lockfile | `~/.local/share/ski/ski-lock.json` | `XDG_DATA_HOME` |
| config | `~/.config/ski/config.json` | `XDG_CONFIG_HOME` |
| update-check stamp | `~/.cache/ski/last-update-check` | `XDG_CACHE_HOME` |

`SKI_HOME` replaces the data root and the config root at once, so `SKI_HOME=/tmp/x` puts the store, the global lockfile, and the config under `/tmp/x`. Every path variable must be absolute.

## Security review

`add` and content-changing `update` show every file and finding before writing.

- `critical` needs explicit approval.
- `warn` pauses once per skill unless `--yes` is set.
- `info` never pauses.

`install` does not review anything. Every lockfile row was reviewed at `add` or `update` time, and the integrity check proves the content still matches. A row that fails the check is skipped with an error.

Each skill gets at most one review question.

## Result lines

Use `name: result` for one skill:

```text
grilling: installed @ v1.2.0
grilling: restored @ v1.2.0
grilling: source no longer has skills/grilling, skipped
```

Use the skill name once. Put a remedy on the next line when needed. Do not print stack traces.

A failed skill does not stop the batch. The command continues, writes state that matches disk, and exits `1`.

No-op messages are `Nothing selected.` or `Nothing to add|copy|install|update.`

## Color

| style | meaning |
| --- | --- |
| cyan | skill name |
| bold | heading |
| dim | secondary text or missing state |
| green | success |
| orange | needs attention |
| red | failure or critical finding |
| blue | information |

Color is off for non-TTY stdout and `TERM=dumb`. `NO_COLOR` disables it. `FORCE_COLOR` enables it.

## Update notice

The CLI checks the registry for a newer version at most once a day and prints the notice after the command output.

The check makes no request when stdout is not a TTY, when `--json` is set, when the CLI runs from a git checkout, or when `CI`, `NO_UPDATE_NOTIFIER`, or `SKI_NO_UPDATE_NOTIFIER` is set.

## Tables and spinners

Tables have no borders. Group rows by source and indent skill rows by two spaces. Measure rendered width with `Bun.stringWidth`.

One spinner covers one wait. Its final line states the result. Spinners do not nest.

## JSON

Only `list` supports JSON:

```json
{
  "scope": "project",
  "lockfile": "/work/repo/ski-lock.json",
  "skills": []
}
```

The payload reports local state only.
