# Glossary

`ski` installs Agent Skills from Git repositories and local directories. It scans each new skill and pins its content.

Use these terms in code, docs, and output.

## Sources

| term | meaning | avoid |
| --- | --- | --- |
| coordinate | User input in the form `owner/repo[/path/to/skill][@ref]` for GitHub, a Git URL, or a local path. | spec, locator, target |
| forge URL | Web URL of a repository page, such as `https://github.com/o/r/tree/main/skills`. | browser URL, web link |
| source | Git repository or local directory that holds a skill. | repo, substrate |
| source kind | `git` or `local`. | type |
| source id | String the lockfile stores in `source`: a Git URL, or `local:` followed by a path. | repo, url |
| revision | Resolved source state and its track. Git sources include a commit. | version, ref, pin |
| track | `auto` follows the latest stable tag or the default branch. `pin` stays at the typed ref. | mode, tracking, strategy |
| commit | Full 40-character Git commit. | ref, hash, SHA |
| short id | First 8 hex characters of a commit, or of the integrity when there is no commit. | short hash, abbreviated commit |
| label | Human form of a revision: the pinned ref, else the tag, else the short id. | display name, version string |
| integrity | `ski`'s sha256 of installed skill files. | hash, checksum, digest |
| ref | Tag, branch, or commit typed after `@`. | revision, reference |
| pinned | Installed with an explicit ref. It updates only when named. | locked, frozen |
| upstream | Revision an installed skill would move to. | target, remote, head |
| verdict | `update`'s classification of one installed skill: up to date, outdated, moved, pinned, rewritten, gone, or unreachable. | status, state |
| up to date | Installed files match upstream and the revision did not move. | current, fresh, synced |
| ahead | Number of new commits on the skill path between the installed and upstream commits. | behind, distance |
| unreachable | The source cannot be cloned or fetched. | offline, failed, error |
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
| ambiguous | Two discovered skills in one source share a name. Each is selected by its path. | duplicate, conflict |
| dependency | Another skill needed from the same source. | requirement, peer |
| mention | One use of another skill's name in a skill file. | reference, link, citation |
| batch | The skills one command run processes. One failure does not stop the batch. | set, group, queue |

## Installation

| term | meaning | avoid |
| --- | --- | --- |
| scope | `global` for one machine or `project` for one project root. | workspace, environment, context |
| project root | Nearest parent with `ski-lock.json`, an agent's root directory (`.claude`, `.opencode`, `.agents`), or `.git`. | workspace root, repo root, cwd |
| lockfile entry | One skill's record in `ski-lock.json`. | row, record |
| store | Download cache in `~/.local/share/ski/store`. Installed skills do not depend on it. | cache, vault |
| store entry | Cached directory in the store holding one skill at one integrity. Never a link target. | package dir, cache entry, snapshot |
| materialize | Write skill files into a store entry and check the integrity. | download, cache, populate |
| canonical copy | Real skill directory in the scope's `skills` directory (`.ski/skills` or `~/.local/share/ski/skills`) that links point to. One per scope. `ski` owns it while a link entry names it. | master copy, primary |
| link | Relative symlink from an agent's skills directory to the canonical copy. | shortcut, alias, pointer |
| copy | Real skill directory that `add --copy` writes: an agent copy or a path copy. | clone, download |
| agent copy | Copy in an agent's skills directory. The lockfile entry records the agents. | agent-dir copy |
| path copy | Copy below a destination root. The lockfile entry records `copyPath`. | custom copy, export |
| placement | `link`, `agent copy`, or `path copy`: how a lockfile entry reaches disk. Each entry has exactly one. | kind, form |
| mode | `link` or `copy`: whether an installed skill is a symlink or real directory. | form, verb, kind |
| destination root | Project-relative directory recorded in `copyPath` for path copies. Each skill is a named child. | output directory, target directory |
| managed | Link that points into the canonical copy, or copy that the matching lockfile entry names. | owned, tracked |
| unmanaged | Existing link or directory at a destination that is not managed. `ski` refuses to replace or delete it. | foreign, stray, existing |
| recorded | Present in the lockfile, whether or not a link or copy exists. | listed, locked |
| installed | Recorded in the lockfile and present as a link or copy. | added, present, tracked |
| missing | Recorded, but no link or copy is present at its recorded location. | not linked, not installed, absent |
| held | Installed skill that the `add` picker shows but does not offer. | disabled, taken |
| extend | Add an installed skill to more agents without a new review. | relink, widen |
| destination | Where `ski` writes a skill: its scope, placement, and agents or destination root. | target |
| location | Where an installed skill already is. It includes its placement and the agents or path-copy presence found on disk. | presence |
| land | Apply a batch, write the lockfile, and hide links from Git. | commit, finalize, flush |
| collision | Same skill name in the other scope's skills directory or in an ancestor directory. | conflict, duplicate, clash |
| overlap | One agent reads another agent's skills directory. OpenCode reads `.claude/skills` and `.agents/skills`. | clash, double load |
| exclude block | `ski`'s section of `.git/info/exclude` that hides project links. | ignore block |
| remembered choice | Scope and agents kept in `config.json` and preselected next time. | saved choice, preference, default |

## Security

| term | meaning | avoid |
| --- | --- | --- |
| scan | Local pass that returns findings. | audit, check, lint |
| rule | Named check the scan runs. Every finding cites one rule. | check, pattern, detector |
| finding | Scan result with `info`, `warn`, or `critical` severity. | issue, violation, alert |
| critical finding | Result that needs human approval unless the invocation skips critical approval. | error, failure |
| warn finding | Result that pauses for review unless `-y` is set. | warning, minor finding |
| review | One skill's pass through the gate: file list, scan, findings, and at most one question. | audit, verify, validate |
| gate | UI that shows findings and asks for approval. | prompt, confirmation, checkpoint |
| approval | Human approval for one source, path, integrity, and scope. | trust, waiver, allowlist entry |
| declined | The user answered no at the gate. The skill is skipped. | rejected, refused |
| blocked | Critical findings with no terminal to approve them and no flag to skip approval. The skill is skipped and the command exits `3`. | refused, rejected |
| skipped | Skill the command did not write: declined, blocked, modified without consent, or failed. | ignored, omitted |

## Agents

| term | meaning | avoid |
| --- | --- | --- |
| agent | Tool that loads skills. | harness, client, host, editor |
| universal | `.agents` skills directory for agents other than Claude Code and OpenCode. | other, generic, fallback |
| detected | Agent whose directory or binary exists on this machine. | installed, found, present |
| opt-in | Agent that is never detected. `universal` is chosen only by hand. | manual, optional |
| skills directory | Directory from which an agent loads skills. | skills dir, agent directory, target dir, install dir |

## ski releases

| term | meaning | avoid |
| --- | --- | --- |
| version | `ski`'s semver number. | revision, build |
| release | Tagged commit and GitHub release with the binaries for one version. Stable versions also get the Homebrew formula. | publish, ship, cut |
