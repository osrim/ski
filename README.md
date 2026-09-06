# 🎿 ski

[![release](https://img.shields.io/github/v/release/osrim/ski)](https://github.com/osrim/ski/releases)
[![checks](https://github.com/osrim/ski/actions/workflows/checks.yml/badge.svg)](https://github.com/osrim/ski/actions/workflows/checks.yml)

`ski` installs, updates, and links community skills into your coding agent. It scans every file before writing it and records what you installed in `ski-lock.json`, so your team runs the same reviewed skills.

<img width="1200" height="663" alt="ski-screen-capture" src="https://github.com/user-attachments/assets/5f23bea3-5fb3-495b-9ab4-f75a50461b4d" />

## Features

- **Pick what you install**: `ski add owner/repo` lists the skills in a repository and lets you choose.
- **One install, every agent**: _Claude Code_, _OpenCode_, and any agent that reads `.agents/skills`. Each skill is stored once and symlinked into every skills directory.
- **Reviewed updates**: `ski update` compares each installed skill with its source and shows the diff before it changes anything.
- **Dependencies**: skills that depend on other skills from the same source are detected, and `ski add` offers to add them too.
- **Security scan**: every file is scanned before it is written. A critical finding stops the install until you approve it. See [Security scan](docs/security-scan.md).

## Install

```sh
brew tap osrim/tap
brew install osrim/tap/ski
```

> ⚠️ `ski` currently runs on macOS only.

## Quickstart

```sh
ski add anthropics/skills   # pick skills, review them, write ski-lock.json
ski install                 # restore every skill in ski-lock.json on a fresh checkout
ski update                  # check upstream and review what changed
```

Commit `ski-lock.json`. `ski install` checks each skill against the integrity recorded in `ski-lock.json` before writing it, so teammates get the files you approved.

## Docs

- [Commands](docs/commands.md): every command, flag, and exit code, plus non-interactive use.
- [Configuration](docs/configuration.md): scope, agents, paths, environment variables, and the lockfile.
- [Security scan](docs/security-scan.md): what the scan catches and what it cannot.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
