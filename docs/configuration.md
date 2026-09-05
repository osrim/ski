# Configuration

Where `ski` writes files, which environment variables it reads, and what the lockfile contains. Commands and flags are in [commands.md](commands.md).

## Scope

A skill is installed in one scope.

| scope | flag | skills live in | lockfile |
| --- | --- | --- | --- |
| project | `-p` | `<project root>/.ski/skills` | `<project root>/ski-lock.json` |
| global | `-g` | `~/.local/share/ski/skills` | `~/.local/share/ski/ski-lock.json` |

The project root is the nearest parent directory that holds `ski-lock.json`, `.claude`, `.opencode`, `.agents`, or `.git`. The search stops at your home directory. Without a marker, the current directory is the root.

`ski add` asks for the scope. Every other command defaults to project scope. Running from your home directory selects global scope.

## Agents

An agent is a tool that loads skills. `ski` writes a relative symlink from the agent's skills directory to the skill in the scope's `skills` directory, or a real copy when you pass `--copy`.

| agent | project | global |
| --- | --- | --- |
| `claude` | `.claude/skills` | `$CLAUDE_HOME/skills` or `~/.claude/skills` |
| `opencode` | `.opencode/skills` | `$XDG_CONFIG_HOME/opencode/skills` or `~/.config/opencode/skills` |
| `universal` | `.agents/skills` | `~/.agents/skills` |

Without `--agent`, `ski` asks which agents to target and preselects the ones whose directories already exist. Without a terminal it uses the saved choice, else the detected agents, else `claude`.

Editing a linked skill changes it for every linked agent.

In project scope, `.ski/.gitignore` keeps the skill directories out of Git. Commit `ski-lock.json`. Copies made with `--copy` can be committed.

## Saved choices

When you pick a scope or agents in a prompt, or pass `-g`, `-p`, or `--agent`, `ski` saves the choice in `config.json` and preselects it next time. A new choice replaces the saved one. A config file that fails to parse is ignored.

```json
{
  "scope": "project",
  "agents": ["claude", "universal"]
}
```

## Paths

`ski` follows the XDG base directory specification.

| path | default | variable |
| --- | --- | --- |
| global skills | `~/.local/share/ski/skills` | `XDG_DATA_HOME` |
| global lockfile | `~/.local/share/ski/ski-lock.json` | `XDG_DATA_HOME` |
| store | `~/.local/share/ski/store` | `XDG_DATA_HOME` |
| config | `~/.config/ski/config.json` | `XDG_CONFIG_HOME` |
| update-check stamp | `~/.cache/ski/last-update-check` | `XDG_CACHE_HOME` |

`SKI_HOME` replaces the data and config roots at once. `SKI_HOME=/tmp/x` puts the global skills, the global lockfile, the store, and the config under `/tmp/x`. It does not move the cache.

Every path variable, including `HOME` and `CLAUDE_HOME`, must be an absolute path. `~` is not expanded.

The store is a download cache. A lockfile row installs without the network when the store holds its content, and every installed skill keeps working if you delete the store.

## Lockfile

`ski-lock.json` records every installed skill in a scope. `ski install` recreates the installation from it.

```json
{
  "lockfileVersion": 1,
  "skills": {
    "pdf": {
      "source": "https://github.com/anthropics/skills",
      "branch": "main",
      "path": "skills/pdf",
      "commit": "474e3e791559398762c4f5eff1399efe8f402156",
      "integrity": "sha256-Y7e8N/hx+rfGdAq0eQxb/7nXc6OLzBdbqVICpPivokY=",
      "mode": "auto"
    }
  }
}
```

| field | meaning |
| --- | --- |
| `source` | Git URL or local path of the source. |
| `path` | Skill directory inside the source. |
| `integrity` | sha256 of the installed skill files. `install` verifies every file against it. |
| `mode` | `auto` follows the latest stable tag or the branch. `pin` stays at the ref you typed. |
| `commit` | Installed commit. Absent for local sources. |
| `branch` | Default branch of the source, or the branch you pinned. Absent for local sources. |
| `tag` | Installed tag. |
| `pinnedAs` | The ref you typed after `@`, when it is not a branch or commit. |
| `copy` | `true` when the skill was added with `--copy`. |
| `agents` | Agents that received a copy. Link rows do not record agents. |

## Environment variables

| variable | effect |
| --- | --- |
| `SKI_HOME` | Root for data and config. See [Paths](#paths). |
| `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` | Standard XDG roots. |
| `CLAUDE_HOME` | Global Claude directory. Default `~/.claude`. |
| `NO_COLOR` | Disable color. |
| `FORCE_COLOR` | Enable color when stdout is not a terminal. |
| `CI`, `NO_UPDATE_NOTIFIER`, `SKI_NO_UPDATE_NOTIFIER` | Disable the update notice. |

Color is also off when stdout is not a terminal or `TERM=dumb`.

## Update notice

Commands that use the network check the npm registry for a newer `ski` at most once a day and print a notice on stderr after the command output. No request is made when stdout is not a terminal, when `--json` is set, when `ski` runs from a Git checkout, or when one of the variables above is set.
