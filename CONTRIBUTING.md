# Contributing

Thanks for considering contributing to `ski`!

Every kind of contribution is welcome:

- Issues: bug reports, feature requests, questions, ideas
- Pull requests: docs fixes, bug fixes, new features

> Testing on Linux and with agents other than Claude Code is especially useful right now, since `ski` has only been used on macOS so far.

## Reporting a bug

[Open a bug report](https://github.com/osrim/ski/issues/new?template=bug.yml). The form asks for `ski --version`, the command, what `ski` printed, and what you expected. A report with those four things can usually be fixed without a follow-up question.

## Before you start on a change

Open an issue first for anything beyond a small fix, so the change can be discussed before you spend time on it. Questions go in issues too.

## Set up `ski` locally

You need [Bun](https://bun.sh).

```sh
cd cli
bun install
bun link
```

If `ski` is not found, add Bun to `PATH`:

```sh
export PATH="$HOME/.bun/bin:$PATH"
```

## Check your change

Run from `cli/`. CI runs the same four commands.

```sh
bun run typecheck
bun run lint
bun run fmt:check
bun run test
```

`bun run lint:fix` and `bun run fmt` apply fixes.

## Submitting a PR

- One change per PR.
- The title is a lowercase conventional commit, such as `feat: add agent target`. PRs are squash-merged, so the title becomes the commit subject and the release-notes line.
- Behavior changes need tests.
- A change to a contract (commands, exit codes, lockfile) updates its doc in the same PR.
- Your contribution is licensed under the [MIT license](LICENSE), like the rest of the project.

## AI-assisted contributions

AI tools are welcome. Rules:

- You must understand every line you submit and be able to explain it in your own words.
- Say in the PR that AI was used.
- Write issues, PR descriptions, and replies yourself. Do not paste long generated text.

## Read before coding

- [Glossary](CONTEXT.md) for project terms
- [Code standards](docs/contributor/standards.md) for quality rules
- [Architecture](docs/contributor/architecture.md) for module boundaries
- [Terminal style](docs/contributor/terminal-style.md) for prompts and output
- [Commands](docs/commands.md), [Configuration](docs/configuration.md), and [Security scan](docs/security-scan.md) for the user-facing contract
