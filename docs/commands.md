# Commands

Commands, flags, aliases, and exit codes are compatibility contracts. Paths, environment variables, and the lockfile are in [configuration.md](configuration.md). The scan and its severities are in [security-scan.md](security-scan.md).

| command | alias | purpose |
| --- | --- | --- |
| `add <coordinate> [...skills]` | | Fetch, review, and add skills. |
| `install` | `i` | Restore every skill in `ski-lock.json`. |
| `update [...skills]` | `up` | Check upstream and update skills. |
| `remove [...skills]` | `rm` | Remove installed skills. |
| `list` | `ls` | Show installed skills. |

`ski --help` and `ski <command> --help` print usage. `ski --version` prints the version, platform, and Bun version.

## `add`

```text
ski add <coordinate> [...skills] [-g|-p] [-a] [-y] [--agent <id>] [--copy [--path <directory>]] [--dangerous-skip-critical-approval]
```

A coordinate names a source:

```text
owner/repo                        GitHub repository
owner/repo/pdf                    skill named pdf
owner/repo/skills/pdf             skill at path skills/pdf
owner/repo@v1.2.0                 pinned ref
https://github.com/o/r/tree/main  forge URL
git@github.com:owner/repo.git     clone URL
./skills/my-skill                 local directory
```

`owner/repo` always means GitHub. Every other forge needs a full URL. Segments after `owner/repo` name one skill: its path in the source, or else a skill whose name is the last segment. A URL path is the repository, so name the skill as a positional argument instead.

`ski` rejects plain `http://` URLs, URLs that carry a username or password, and any coordinate that contains `#`.

- Without skill names, `add` opens a picker. A source with one skill skips the picker.
- `--all` selects every skill in the source.
- Named skills must exist in the source and have distinct names.
- `@ref` pins the skill. A pinned skill updates only when you name it in `ski update`.
- `add` shows and scans every file before writing. See [security-scan.md](security-scan.md).
- `add` finds mentions of other skills from the same source and offers to review them too.
- `--copy` writes a real directory instead of a link. To switch a skill between link and copy, remove it and add it again.
- `--path <directory>` writes each selected skill to `<directory>/<skill name>`. It requires `--copy` and selects project scope. It skips agent selection.
- Do not combine `--path` with `--global` or `--agent`. Relative paths resolve from the project root. Absolute paths must resolve inside the project root.
- A path cannot contain `..` or escape the project root through a symlinked ancestor.
- A matching lockfile entry manages an existing path-copy destination. `ski` skips other existing directories and continues the batch.

## `install`

```text
ski install [-g|-p] [-y] [--agent <id>]
```

`install` restores every lockfile entry. It takes no positional arguments; passing one exits `2`.

`install` does not scan. `add` or `update` reviewed every entry, and `install` verifies each file against the recorded integrity before writing it. An entry whose content does not match is skipped and the command exits `1`.

Restoring a modified skill discards your edits, so `install` asks first. Without a terminal it keeps the edits and installs the other entries. `--yes` restores without asking.

Agent copies install to the agents recorded in the entry. Path copies install to their recorded destination roots.

Link entries install to the agents you pass with `--agent`, or to the saved or detected defaults. A lockfile without link entries selects no agents.

## `update`

```text
ski update [...skills] [-g|-p] [-a] [-y] [--dangerous-skip-critical-approval]
```

`update` checks every installed skill against its source, then shows and scans changed files before writing.

- Without names or `--all`, it opens a picker of outdated skills.
- Pinned skills update only when named.
- A skill whose files did not change at a new revision updates without review.
- A pinned tag or branch that now resolves to a different commit is reported and never updated automatically.
- Missing dependencies are reported, not installed.
- Updating a modified skill discards your edits. Run `ski install` to restore the locked files instead.
- `update` compares and updates each path copy at its recorded project-relative destination.

## `remove`

```text
ski remove [...skills] [-g|-p] [-a] [-y]
```

`remove` deletes the selected lockfile entries and the links or copies that `ski` created. For a path copy, it deletes only the named skill directory. It keeps the destination root and does not use the network.

Without names or `--all`, it opens a picker. `--all` selects every installed skill. `--yes` skips the confirmation.

## `list`

```text
ski list [-g|-p] [--json]
```

`list` shows every lockfile entry with its revision and location. It marks missing skills and skills whose files differ from the lockfile.

Path copies show their project-relative destination. `list` does not use the network.

`--json` writes one JSON object to stdout and nothing else. Diagnostics go to stderr.

```json
{
  "scope": "project",
  "lockfile": "/work/repo/ski-lock.json",
  "skills": [
    {
      "name": "pdf",
      "source": "https://github.com/anthropics/skills",
      "path": "skills/pdf",
      "commit": "474e3e791559398762c4f5eff1399efe8f402156",
      "integrity": "sha256-...",
      "track": "auto",
      "branch": "main",
      "copy": true,
      "copyPath": "custom-directory",
      "modified": false,
      "agents": [],
      "links": []
    }
  ]
}
```

Each skill carries its lockfile fields (see [configuration.md](configuration.md#lockfile)) plus `modified`, `agents`, and `links`.

## Flags

| flag | commands | effect |
| --- | --- | --- |
| `-g`, `--global` | all | Use global scope. |
| `-p`, `--project` | all | Use project scope. |
| `--agent <id>` | `add`, `install` | Install to `claude`, `opencode`, or `universal`. Repeat the flag or separate ids with commas. |
| `-a`, `--all` | `add`, `update`, `remove` | Select every skill. It does not confirm or approve anything. |
| `-y`, `--yes` | `add`, `install`, `update`, `remove` | Accept ordinary confirmations and defaults. It cannot approve critical findings. |
| `--dangerous-skip-critical-approval` | `add`, `update` | Skip approval for critical findings. Dangerous. Files and findings remain visible. |
| `--copy` | `add` | Write directories instead of links. |
| `--path <directory>` | `add` | With `--copy`, write named skill directories below a project destination root. |
| `--json` | `list` | Write JSON only. |

`-g` and `-p` cannot be combined. Passing both exits `2`.

`--dangerous-skip-critical-approval` applies only to the current invocation, including dependencies reviewed by `add`. It does not imply `--yes`, `--all`, a scope, an agent, `--copy`, or `--path`. Warn finding review and write confirmation keep their existing behavior. The flag is never saved in the lockfile or configuration and has no environment-variable equivalent.

`add` asks for the scope when neither flag is present. `--path` selects project scope without asking. The other commands default to project scope.

Running a command from your home directory selects global scope.

## Non-interactive use

`ski` prompts when it needs a decision. Each prompt has a flag replacement:

| prompt | replacement |
| --- | --- |
| Which skills | Pass names or `--all`. |
| Scope or agents | Pass `-g`, `-p`, or `--agent`. |
| Path-copy destination | Pass `--copy --path <directory>`. Do not pass an agent flag. |
| Write confirmation | Pass `--yes`. |
| Warn finding review | Pass `--yes`. |
| Critical finding approval | Run in a terminal, or pass `--dangerous-skip-critical-approval` to skip approval. |

An ordinary prompt with no terminal and no replacement flag exits `2`. In `add` and `update`, critical findings instead block the skill with exit `3` unless `--dangerous-skip-critical-approval` is provided. `install` keeps modified skills and continues when there is no terminal.

Ctrl-C exits `130`. Files already written stay written.

## CI

Install a pinned release and check it against the release's `checksums.txt`. Every release has a `ski-<os>-<arch>.tar.gz` for `linux-x64`, `linux-arm64`, `darwin-arm64`, and `darwin-x64`.

```sh
set -e
SKI_VERSION=0.2.0
BASE="https://github.com/osrim/ski/releases/download/v$SKI_VERSION"
curl -fsSLO "$BASE/ski-linux-x64.tar.gz"
curl -fsSL "$BASE/checksums.txt" | grep ski-linux-x64.tar.gz | sha256sum -c -
tar xzf ski-linux-x64.tar.gz
install -m 755 ski /usr/local/bin/ski

ski install --agent claude --yes
```

`git` must be on `PATH`. `ski install` exits `0` when every entry in `ski-lock.json` is on disk with its recorded integrity. `CI` disables the update notice and its release check.

`ski add` and `ski update` also run without a terminal. `--yes` accepts warn findings. A critical finding exits `3` unless `--dangerous-skip-critical-approval` skips approval. `ski list --json` prints machine-readable output.

For reviewed sources whose critical findings you accept, use CI to keep a repository's published skill copies current. Every run still lists files, scans them, and prints all findings:

```sh
ski add owner/skills --all --yes --copy --path ./custom-directory --dangerous-skip-critical-approval
ski update --all --yes --dangerous-skip-critical-approval
git diff --exit-code ski-lock.json ./custom-directory
```

## Exit codes

| code | meaning |
| --- | --- |
| `0` | Success or nothing to do. |
| `1` | A skill failed. The rest of the batch still ran. |
| `2` | Invalid usage, or a prompt had no terminal and no flag. |
| `3` | Critical findings blocked at least one skill in `add` or `update` without `--dangerous-skip-critical-approval`. |
| `130` | Cancelled. |
