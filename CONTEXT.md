# Glossary

`ski` installs Agent Skills from Git repositories and local directories. It scans each new skill and pins its content.

Use these terms in code, docs, and output.

## Sources

| term | meaning | avoid |
| --- | --- | --- |
| coordinate | User input in the form `owner/repo[/path/to/skill][@ref]` for GitHub, a Git URL, or a local path. | spec, locator, target |
| source | Git repository or local directory that holds a skill. | repo, substrate |
| source kind | `git` or `local`. | type |
| revision | Resolved source state and its tracking mode. Git sources include a commit. | version, ref, pin |
| commit | Full 40-character Git commit. | ref, hash, SHA |
| integrity | `ski`'s sha256 of installed skill files. | hash, checksum, digest |
| ref | Tag, branch, or commit typed after `@`. | revision, reference |
| pinned | Installed with an explicit ref. It updates only when named. | locked, frozen |
| upstream | Revision an installed skill would move to. | target, remote, head |
| outdated | Upstream skill files differ from installed files. | stale, behind |
| moved | Upstream revision changed but the skill files did not. | retagged, shifted |
| rewritten | A pinned symbolic ref now resolves to a different commit. | retagged |
| gone | The source no longer has the skill at its recorded path. | missing, deleted |
| modified | Installed files differ from the locked integrity. | dirty, drift, tampered |
| restored | Modified files replaced with locked content. | reset, repaired, reverted |

## Skills

| term | meaning | avoid |
| --- | --- | --- |
| skill | Directory with `SKILL.md` at its root. | package, plugin, module |
| discovered skill | Skill found before installation. | remote skill, candidate |
| dependency | Another skill needed from the same source. | requirement, peer |
| mention | One use of another skill's name in a skill file. | reference, link, citation |

## Installation

| term | meaning | avoid |
| --- | --- | --- |
| scope | `global` for one machine or `project` for one project root. | workspace, environment, context |
| project root | Nearest parent with `ski-lock.json`, an agent directory, or `.git`. | workspace root, repo root, cwd |
| store entry | Cached directory in `~/.ski/store` holding one skill at one integrity. Never a link target. | package dir, cache entry, snapshot |
| canonical copy | Real skill directory in `.ski/skills` that links point to. One per scope. `ski` owns it while a link row names it. | master copy, primary |
| link | Relative symlink from an agent's skills directory to the canonical copy. | shortcut, alias, pointer |
| copy | Real skill directory written with `add --copy`. | clone, download |
| backup | Entry moved aside before `ski` writes the same name. | copy, archive |
| managed | Link or copy created by `ski`. | owned, tracked |
| installed | Recorded in the lockfile and present as a link or copy. | added, present, tracked |
| placement | An installed skill's scope, agents, and form (link or copy). | target, location |

## Security

| term | meaning | avoid |
| --- | --- | --- |
| scan | Local pass that returns findings. | audit, check, lint |
| finding | Scan result with `info`, `warn`, or `critical` severity. | issue, violation, alert |
| critical finding | Result that needs human approval. | error, block, failure |
| warn finding | Result that pauses for review unless `-y` is set. | warning, minor finding |
| review | Decision based on skill files. It does not prompt. | audit, verify, validate |
| gate | UI that shows findings and asks for approval. | prompt, confirmation, checkpoint |
| approval | Human approval for one source, path, integrity, and scope. | trust, waiver, allowlist entry |

## Agents

| term | meaning | avoid |
| --- | --- | --- |
| agent | Tool that loads skills. | harness, client, host, editor |
| universal | `.agents` target for consumers other than Claude Code and opencode. | other, generic, fallback |
| skills dir | Directory from which an agent loads skills. | target dir, install dir |

## ski releases

| term | meaning | avoid |
| --- | --- | --- |
| version | `ski`'s semver number. | revision, build |
| release | Tagged commit, GitHub release, and npm package for one version. | publish, ship, cut |
