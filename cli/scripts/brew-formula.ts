// Render Formula/ski.rb for the Homebrew tap.
// Usage: bun scripts/brew-formula.ts <version> <checksums.txt> > Formula/ski.rb

const asset = (arch: string): string => `ski-darwin-${arch}.tar.gz`;
const DOWNLOAD = "https://github.com/osrim/ski/releases/download";

export const sha256For = (checksums: string, name: string): string => {
  const line = checksums.split("\n").find((entry) => entry.trim().endsWith(` ${name}`));
  const sha = line?.trim().split(/\s+/u)[0];
  if (!sha || !/^[0-9a-f]{64}$/u.test(sha)) throw new Error(`no sha256 for ${name}`);
  return sha;
};

export const renderFormula = (version: string, checksums: string): string => `class Ski < Formula
  desc "Skill manager for coding agents"
  homepage "https://github.com/osrim/ski"
  if Hardware::CPU.arm?
    url "${DOWNLOAD}/v${version}/${asset("arm64")}"
    sha256 "${sha256For(checksums, asset("arm64"))}"
  else
    url "${DOWNLOAD}/v${version}/${asset("x64")}"
    sha256 "${sha256For(checksums, asset("x64"))}"
  end
  version "${version}"
  license "MIT"

  depends_on "git"
  depends_on :macos

  def install
    bin.install "ski"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/ski --version")
  end
end
`;

if (import.meta.main) {
  const [version, checksumsPath] = Bun.argv.slice(2);
  if (!version || !checksumsPath) {
    console.error("usage: bun scripts/brew-formula.ts <version> <checksums.txt>");
    process.exit(2);
  }
  const checksums = await Bun.file(checksumsPath).text();
  process.stdout.write(renderFormula(version, checksums));
}
