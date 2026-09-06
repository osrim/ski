# Releasing

For maintainers. A release is a tag, a GitHub Release with four binaries, and a Homebrew formula.

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

The `build` job is a matrix. Each matrix job compiles one binary on a runner that can run it:

| binary | runner |
| --- | --- |
| `darwin-arm64` | `macos-latest` |
| `darwin-x64` | `macos-latest`, smoke test under Rosetta |
| `linux-x64` | `ubuntu-latest` |
| `linux-arm64` | `ubuntu-24.04-arm` |

Each matrix job checks `ski --version`, runs `ski add` and `ski install` against a local skill, and uploads `ski-<os>-<arch>.tar.gz` as a workflow artifact.

The `release` job runs on `ubuntu-latest` after all matrix jobs pass:

1. Runs the test suite.
2. Checks that `cli/package.json` matches the tag.
3. Downloads the tarballs and writes `checksums.txt`.
4. Uploads them to a GitHub Release. Notes are generated from merged PR titles.
5. Renders `Formula/ski.rb` with `cli/scripts/brew-formula.ts` and pushes it to `osrim/homebrew-tap` with the `TAP_DEPLOY_KEY` secret.

Step 5 runs last. The asset must be public before the formula points at it. From then on `brew install osrim/tap/ski` and `brew upgrade` serve the new version.

To check the build and the formula locally, use a fake `checksums.txt` with four different hashes. `brew style` only lints a formula inside a tap. Render into the local tap checkout, lint, then reset the tap:

```sh
bun run build && ./dist/ski --version
printf '%064d  ski-darwin-arm64.tar.gz\n%064d  ski-darwin-x64.tar.gz\n%064d  ski-linux-arm64.tar.gz\n%064d  ski-linux-x64.tar.gz\n' 1 2 3 4 > dist/checksums.txt
bun scripts/brew-formula.ts 0.1.0 dist/checksums.txt > "$(brew --repo osrim/tap)/Formula/ski.rb"
brew style osrim/tap/ski && git -C "$(brew --repo osrim/tap)" checkout Formula/ski.rb
```

## Supported platforms

macOS on Apple silicon and Intel. Linux on x64 and arm64 with glibc 2.17 or newer. The x64 binaries are Bun `baseline` builds, so they run without AVX2 and under Rosetta. Alpine and other musl distributions are not supported. Bun has `-musl` targets when that changes.

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
