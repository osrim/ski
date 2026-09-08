# Security scan

`add`, and `update` when skill files changed, show every file and every finding before writing. `install` does not scan; see [commands.md](commands.md#install). Flags and exit codes are also in [commands.md](commands.md).

## Severities

| severity | effect |
| --- | --- |
| `critical` | Needs approval in a terminal unless `--dangerous-skip-critical-approval` is set. `--yes` cannot approve it. Without a terminal or the dangerous flag, the skill is skipped and the command exits `3`. |
| `warn` | Pauses once per skill. `--yes` skips the pause. |
| `info` | Never pauses. |

A skill you decline is skipped. The other skills in the batch still install.

`add` and `update` accept `--dangerous-skip-critical-approval` in interactive and non-interactive runs. It skips only critical approval for that invocation. The gate still lists every file, runs the scan, and prints every finding with its original severity. Warn finding review and the final write confirmation still use `--yes`. The flag is never remembered or recorded in the lockfile.

An approval covers one source, path, integrity, and scope. Adding approved content to another agent does not reopen the review.

## What is scanned

Every file in the skill directory except `.git` and `node_modules`, including files the agent never reads.

### Files

| finding | severity |
| --- | --- |
| Symlink that points outside the skill directory | `critical` |
| Symlink inside the skill directory | `warn` |
| Executable, binary, or archive file | `warn` |
| Bundled agent configuration: `plugin.json`, `.mcp.json`, `settings.json`, `hooks.json`, `opencode.json`, `opencode.jsonc` | `critical` |
| Invisible characters: Unicode tags, zero-width characters, bidi overrides and isolates | `critical` |

### `SKILL.md` frontmatter

Only `SKILL.md` grants permissions when an agent loads the skill. Non-standard frontmatter fields in other Markdown files are listed as `info`.

| finding | severity |
| --- | --- |
| `hooks` | `critical` |
| `allowed-tools` with unrestricted `Bash` | `critical` |
| Any other `allowed-tools` entry, and every `disallowed-tools` entry | `warn` |
| `context: fork` | `warn` |
| `user-invocable: false` without `disable-model-invocation: true` | `warn` |
| Invalid YAML | `critical` |
| Fields that configure the agent, and unknown fields | `info` |

### Load-time execution

Claude Code runs `` !`command` `` and code fences whose info string starts with `!` before the skill reaches the model. Each command is `critical` in `SKILL.md` and `info` in other Markdown files.

### Text patterns

| finding | severity |
| --- | --- |
| `curl` or `wget` piped to a shell | `critical` |
| Base64-decoded commands | `critical` |
| Known exfiltration hosts: webhook.site, requestbin, pipedream, ngrok, Discord, Telegram, and Slack webhooks | `critical` |
| Mentions of `.claude/settings.json` or `permissions.allow` | `critical` |
| `--dangerously-skip-permissions` | `critical` |
| `~/.ssh`, `id_rsa`, `~/.aws` | `critical` |
| Environment variable reads and `.env` files | `warn` |
| Prompt-injection phrases such as "ignore previous instructions" | `warn` |
| `rm -rf` | `warn` |

### URLs

Every URL is listed as `info`, grouped by host.

## Limits

The scan matches known patterns. It does not run the skill, follow URLs, or understand intent. A skill can be harmful and pass with no findings, and a safe skill can trigger a `warn`. Read the files before you approve them.
