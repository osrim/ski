# Contributing

For bugs, include the command, its output, and `ski --version`.

## Set up

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

Run from `cli/`:

```sh
bun run typecheck
bun run lint
bun run fmt:check
bun test
```

Use `bun run lint:fix` and `bun run fmt` to apply fixes.

## Read before coding

- [Glossary](CONTEXT.md) for project terms
- [Code standards](docs/contributor/standards.md) for quality rules
- [Architecture](docs/contributor/architecture.md) for module boundaries
- [Terminal style](docs/contributor/terminal-style.md) for prompts and output
- [Commands](docs/commands.md), [Configuration](docs/configuration.md), and [Security scan](docs/security-scan.md) for the user-facing contract

Update the matching document when you change a command, exit code, or lockfile field.

Use a conventional commit PR title, such as `feat: add agent target`. Squash merges use the PR title as the commit subject.
