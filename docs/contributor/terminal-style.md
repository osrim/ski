# Terminal style

For contributors. Rules for what `ski` prints and asks. User-facing behavior of prompts, flags, and exit codes is in [commands.md](../commands.md).

## Streams

Human output goes to stdout inside a Clack frame. Runtime warnings, errors, and the update notice go to stderr. Security findings stay on stdout because they are part of the review. `list --json` writes only JSON to stdout.

## Prompts

Every prompt has a flag replacement, and the replacements do not overlap:

- `--all` selects skills. It never confirms a write.
- `--yes` accepts ordinary confirmations and defaults. It never approves a critical finding.
- A critical finding needs a terminal. Without one, the skill is skipped with exit `3`.
- A prompt with no terminal and no flag exits `2` with a message that names the flag.

`install` is the exception to the last rule. Without a terminal it keeps modified skills and installs the other entries, because restoring silently would destroy edits.

Each skill gets at most one review question.

Cancel exits `130` with `Cancelled.` Completed writes remain completed.

## Defaults

Announce a default when the user did not choose it:

```text
Using project scope. Use -g for global.
Linking to claude.
```

## Result lines

Use `name: result` for one skill. Name the skill once. Put a remedy on the next line when there is one. Never print a stack trace.

```text
grilling: installed @ v1.2.0
grilling: restored @ v1.2.0
grilling: source no longer has skills/grilling, skipped
```

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

Paint through `ui/style.ts` only. It resolves `NO_COLOR`, `FORCE_COLOR`, `TERM=dumb`, and non-TTY output, and strips escape codes that Clack emits when color is off.

## Tables and spinners

Tables have no borders. Group rows by source and indent skill rows by two spaces. Measure rendered width with `Bun.stringWidth`.

One spinner covers one wait. Its final line states the result. Spinners do not nest.
