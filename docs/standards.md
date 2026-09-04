# Code standards

All `cli/` changes must pass the required checks.

## Comments

Comment only when the code cannot explain a constraint or reason.

Do not add file summaries, restated types, control-flow narration, typed JSDoc, or history notes. Remove stale comments.

## TypeScript

Keep strict mode and its current checks. Do not use `any` or weaken compiler options.

Narrow `unknown`, keep type imports explicit, and include `.ts` in import paths. Target Bun and modern ECMAScript.

## Lint and format

Oxlint enforces correctness, suspicious-code, function-style, and async rules. Exported and local functions use arrow syntax. Source adapter classes may use methods.

Do not disable a rule unless the exception is required and explained. Oxfmt owns formatting.

## Functions and modules

- Keep functions at 100 lines or fewer.
- Use at most five positional parameters.
- Split by responsibility.
- Follow [architecture.md](architecture.md).
- Use kebab-case filenames.
- Remove unused code introduced by your change.

## Tests

Add unit tests for changed `core/` behavior. Network modules require tests.

Assert against literals, worked examples, fixtures, or documented contracts. Do not copy implementation logic into assertions.

Use temporary directories and restore environment changes. Review branches and failure paths instead of chasing a coverage number.

There is no end-to-end CLI harness. Manually test changed command paths, non-interactive errors, and exit codes.

## Required checks

Run from `cli/`:

```sh
bun run typecheck
bun run lint
bun run fmt:check
bun run test
```

CI runs the same checks. PR titles must use a conventional commit type and lowercase subject.

## Supply chain

- Bun is pinned by `.bun-version`.
- Commit `bun.lock` and use frozen installs in CI.
- Pin GitHub Actions to full commit SHAs.
- Start workflows with `permissions: {}` and grant only needed permissions.
- Review `trustedDependencies` as executable third-party code.
- Add dependencies only when Bun, Node, and current packages cannot cover the need.

## Repository hygiene

Keep `@0scrm/ski` publishable. Do not commit `.DS_Store` or machine-local skill links. The project uses the MIT license.
