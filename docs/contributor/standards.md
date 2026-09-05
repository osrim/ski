# Code standards

For contributors. Every change under `cli/` must pass the required checks below. Module boundaries are in [architecture.md](architecture.md).

## TypeScript

Keep strict mode and its current checks. Do not use `any` or weaken compiler options. Narrow `unknown`, keep type imports explicit, and include `.ts` in import paths. Target Bun and modern ECMAScript.

## Lint and format

Oxlint enforces correctness, suspicious-code, function-style, and async rules. Exported and local functions use arrow syntax. Source adapter classes may use methods. Oxfmt owns formatting.

Do not disable a rule unless the exception is required and explained in place.

## Functions and modules

- Keep functions at 100 lines or fewer, with at most five positional parameters.
- Split files by responsibility. Use kebab-case filenames.
- Use `index.ts` only for a real module, never as a barrel.
- Command files export only `run` and `help`. Keep help copy beside its command.
- Remove code your change makes unused.

## Comments

Always prefer self-documented code over comments. Comment only when the code cannot explain a constraint or a reason. Do not add file summaries, restated types, control-flow narration, typed JSDoc, or history notes. Remove stale comments you touch.

## Tests

Tests import core and UI functions into one Bun process. The suite does not spawn the CLI, so command registration, argument wiring, and exit codes are checked by hand. Add a small `Bun.spawn` harness for `-y` paths when those checks become brittle or miss a bug.

- Add unit tests for changed `core/` behavior. Network modules require tests.
- Assert against literals, worked examples, fixtures, or documented contracts. Do not copy implementation logic into assertions.
- Use temporary directories and restore environment changes with `test-env.ts`.
- Cover branches and failure paths. Do not chase a coverage number.
- Manually test changed command paths, non-interactive errors, and exit codes.

## Required checks

Run from `cli/`:

```sh
bun run typecheck
bun run lint
bun run fmt:check
bun run test
```

CI runs the same checks. PR titles use a conventional commit type and a lowercase subject.

## Supply chain

- Bun is pinned by `.bun-version`.
- Commit `bun.lock` and use frozen installs in CI.
- Pin GitHub Actions to full commit SHAs.
- Start workflows with `permissions: {}` and grant only what a job needs.
- Review `trustedDependencies` as executable third-party code.
- Add a dependency only when Bun, Node, and the current packages cannot cover the need.

## Repository hygiene

Do not commit `.DS_Store`, `cli/dist/`, or machine-local skill links. The project uses the MIT license.
