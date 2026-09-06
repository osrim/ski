# Releasing

For maintainers. A release is a tag, a GitHub Release with two macOS binaries, and a Homebrew formula.

## Version scheme

`ski` is 0.x. A breaking change bumps the minor version. Anything else bumps the patch version. Move to 1.0 when a breaking minor bump would annoy users.

The version lives in `cli/package.json`. The tag is the version with a `v` prefix. `release.yml` fails when they differ.

## Release command

From `cli/`, on `main`, with a clean tree:

```sh
bunx bumpp
```

`bumpp` asks for the bump, writes `cli/package.json`, commits `chore: release vX.Y.Z`, tags `vX.Y.Z`, and pushes. The tag push starts `release.yml`. Nothing else is needed.

Do not create tags by hand.

## What release.yml does

Runs on `macos-latest` (arm64). Rosetta runs the Intel smoke test.

1. Runs the test suite.
2. Checks that `cli/package.json` matches the tag.
3. Compiles one binary per architecture and checks `ski --version` on each.
4. Uploads `ski-darwin-arm64.tar.gz`, `ski-darwin-x64.tar.gz`, and `checksums.txt` to a GitHub Release. Notes are generated from merged PR titles.
5. Renders `Formula/ski.rb` with `cli/scripts/brew-formula.ts` and pushes it to `osrim/homebrew-tap` with the `TAP_DEPLOY_KEY` secret.

Step 5 runs last: the asset must be public before the formula points at it. From then on `brew install osrim/tap/ski` and `brew upgrade` serve the new version.

Local check of steps 3 and 5. The formula script only needs a `checksums.txt`, so a fake one is enough:

```sh
bun run build && ./dist/ski --version
printf '%064d  ski-darwin-arm64.tar.gz\n%064d  ski-darwin-x64.tar.gz\n' 0 0 > dist/checksums.txt
bun scripts/brew-formula.ts 0.1.0 dist/checksums.txt
```

## Supported platform

macOS only, Apple silicon and Intel. The Intel binary is the Bun `x64-baseline` build, so it runs on every Intel Mac and under Rosetta. The formula declares `depends_on :macos`, so Linux fails at `brew install` with a clear message. Linux is tracked as future work.

## Prereleases

None before 1.0. When one is needed, choose a `-beta.N` version in `bumpp`. A tag with `-` becomes a GitHub prerelease and the tap step is skipped, so `brew` users never see it.

## When a release fails

- Never reuse a version. A version that reached the tap is on users' machines.
- Runner or network failure: re-run from the Actions tab with `workflow_dispatch` and the tag as input. Existing assets are replaced.
- Failure before the tap step, fix needed in code: delete the tag and the Release, merge the fix on `main`, then tag again by hand. `cli/package.json` already holds `X.Y.Z`, so `bumpp` is not run again.

  ```sh
  gh release delete vX.Y.Z --yes
  git push origin :refs/tags/vX.Y.Z
  git tag -d vX.Y.Z
  # after the fix is on main
  git tag vX.Y.Z && git push origin vX.Y.Z
  ```

- Failure after the tap step, or a bug found in a shipped version: ship a patch release.
