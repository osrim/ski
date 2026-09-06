const asset = (os: string, arch: string): string => `ski-${os}-${arch}.tar.gz`;
const DOWNLOAD = "https://github.com/osrim/ski/releases/download";

export const sha256For = (checksums: string, name: string): string => {
  const line = checksums.split("\n").find((entry) => entry.trim().endsWith(` ${name}`));
  const sha = line?.trim().split(/\s+/u)[0];
  if (!sha || !/^[0-9a-f]{64}$/u.test(sha)) throw new Error(`no sha256 for ${name}`);
  return sha;
};

interface Release {
  version: string;
  checksums: string;
}

const source = (release: Release, os: string, arch: string): string => {
  const name = asset(os, arch);
  return `      url "${DOWNLOAD}/v${release.version}/${name}"
      sha256 "${sha256For(release.checksums, name)}"`;
};

// Homebrew rejects url/sha256 inside top-level on_arm/on_intel, hence the CPU conditional.
const onSystem = (
  release: Release,
  os: "darwin" | "linux",
): string => `  on_${os === "darwin" ? "macos" : "linux"} do
    if Hardware::CPU.arm?
${source(release, os, "arm64")}
    else
${source(release, os, "x64")}
    end
  end`;

export const renderFormula = (version: string, checksums: string): string => {
  const release = { version, checksums };
  return `class Ski < Formula
  desc "Skill manager for coding agents"
  homepage "https://github.com/osrim/ski"
  version "${version}"
  license "MIT"

  depends_on "git"

${onSystem(release, "darwin")}

${onSystem(release, "linux")}

  def install
    bin.install "ski"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/ski --version")
  end
end
`;
};

if (import.meta.main) {
  const [version, checksumsPath] = Bun.argv.slice(2);
  if (!version || !checksumsPath) {
    console.error("usage: bun scripts/brew-formula.ts <version> <checksums.txt>");
    process.exit(2);
  }
  const checksums = await Bun.file(checksumsPath).text();
  process.stdout.write(renderFormula(version, checksums));
}
