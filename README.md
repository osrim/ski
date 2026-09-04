# ski 🎿

`ski` installs, updates, and links skills from Git or local directories straight into your favorite coding agent. It runs a security scan on every file before installation, and uses a `ski-lock.json` file to ensure everyone on your team runs the exact same reviewed code.

<img width="1280" height="714" alt="ski-demo" src="https://github.com/user-attachments/assets/dea66a3e-8b8b-49d6-88a2-f95e07a5ef7e" />

## Get started

### 1. Install the CLI

You need [Bun](https://bun.sh) and Git.

```sh
git clone git@github.com:0scrm/ski.git
cd ski/cli
bun install
bun link
```

### 2. Install a skill

```sh
cd your-project
ski add anthropics/skills
```

Commit `ski-lock.json` after adding a skill. Anyone who checks out the project can then install the same files:

```sh
ski install
```

> `ski install` verifies each file against its lockfile hash before installing it.

## Add a skill

Pass `owner/repo`, a Git or forge URL, or a local directory. Add a skill name when the source contains more than one skill.

```sh
ski add owner/repo
ski add owner/repo tdd
ski add owner/repo#tdd@v1.2.0
ski add owner/repo --all
ski add ./skills/my-skill
```

> Without `@ref`, `ski` uses the latest stable semver tag. If the source has no tag, it uses the default branch.

## Security scan

Before `add` or an update that changes files, `ski` shows every file and reports URLs, tool grants, hooks, and commands that run when an agent loads the skill.

- `info` flags external URLs and unknown fields.
- `warn` flags destructive commands such as `rm -rf`, environment-variable reads, binaries, archives, prompt-injection phrases, and tools withheld from the agent.
- `critical` flags downloaded scripts piped to a shell, encoded commands, known exfiltration endpoints, `--dangerously-skip-permissions`, changes to agent settings or hooks, reads of `~/.ssh` or `~/.aws`, and invisible characters.

> ⚠️ The scan cannot ensure that a skill is safe. Read the files before approving them.

## Scope and targets

`ski add` asks whether to install in the current project or globally on the machine. Pass `-p` or `-g` to choose the scope without a prompt.

It also asks which agent directories should receive the skill. Pass `--agent` to choose them on the command line:

```sh
ski add owner/repo --agent claude --agent universal
ski install --agent opencode -y
```

| agent       | project            | global                                                            |
| ----------- | ------------------ | ----------------------------------------------------------------- |
| `claude`    | `.claude/skills`   | `$CLAUDE_HOME/skills` or `~/.claude/skills`                       |
| `opencode`  | `.opencode/skills` | `$XDG_CONFIG_HOME/opencode/skills` or `~/.config/opencode/skills` |
| `universal` | `.agents/skills`   | `~/.agents/skills`                                                |

## Update or remove skills

Check for upstream changes and choose which skills to update:

```sh
ski update
ski update tdd
ski update --all --yes
```

`ski` shows and scans changed files before replacing an installed skill. A skill pinned with `@ref` updates only when you name it.

Remove skills you no longer want:

```sh
ski remove
ski remove tdd --yes
```

`ski remove` deletes the lockfile entry and the links or copies that `ski` manages. It leaves other files in agent directories alone.

## Work with local changes

By default, `ski` writes one copy of each skill to `.ski/skills/<name>` (or `~/.ski/skills/<name>` for global scope) and links each selected agent directory to it with a relative symlink. `.ski/.gitignore` keeps that directory out of Git, so commit only `ski-lock.json`. The project works from any checkout location, and `~/.ski/store` is only a download cache. Editing a linked skill changes that copy for every linked agent. `ski list` marks changed skills, and `ski install` asks before replacing local changes with the locked files.

Use `--copy` when an agent needs its own real directory instead of a symlink:

```sh
ski add owner/repo pdf --copy
```

Copies can be committed. To switch between a link and a copy, remove the skill and add it again.

## Run ski in CI

Choose agents with `--agent` and pass `--yes` to accept non-critical confirmations and defaults. Critical findings still require approval in a terminal.

`ski list --json` writes JSON to stdout. Diagnostics go to stderr.

| code  | meaning                               |
| ----- | ------------------------------------- |
| `0`   | success or no work                    |
| `1`   | operation failed                      |
| `2`   | invalid usage or missing prompt input |
| `3`   | critical findings need review         |
| `130` | cancelled                             |

## Reference

- [CLI reference](docs/command-surface.md) lists every command and flag.
- [Terminal output](docs/interaction.md) covers prompts, output, and defaults.
- [Contributing](CONTRIBUTING.md) is for people working on ski itself.

## License

[MIT](LICENSE)
