import { isAbsolute, normalize, join, dirname, basename, extname } from "node:path";
import { LinkifyIt } from "linkify-it";
import { isSymlink, MODE_EXEC } from "../skill/files.ts";
import { asText, parseFrontmatter } from "../skill/frontmatter.ts";
import { codeFences, lineAt } from "../skill/text.ts";
import type { Finding, Scanner, Severity } from "./index.ts";

const RULES = {
  "curl-pipe-shell": { help: "pipes a download into a shell" },
  "base64-exec": { help: "decodes and runs base64" },
  "exfil-domain": { help: "known exfiltration endpoint" },
  "claude-settings": { help: "edits agent permissions" },
  "skip-permissions": { help: "disables permission prompts" },
  "credential-paths": { help: "reads credentials (~/.ssh, ~/.aws)" },
  "env-secrets": { help: "reads env vars or .env" },
  "prompt-injection": { help: "asks the agent to hide actions" },
  destructive: { help: "recursive delete" },
  "invisible-unicode": { help: "invisible characters" },
  "allowed-tools": { help: "pre-approves tools for itself" },
  "disallowed-tools": { help: "takes a tool away from the agent" },
  hooks: { help: "runs a configured command" },
  "load-time-exec": { help: "runs before the skill loads" },
  "context-fork": { help: "runs itself in a subagent" },
  "user-invocable": { help: "hidden from you, still callable by the agent" },
  "skill-config": { help: "sets how the agent runs it" },
  "unknown-field": { help: "a frontmatter field ski has no rule for" },
  frontmatter: { help: "frontmatter could not be read" },
  "frontmatter-inventory": { help: "frontmatter in a file no agent loads" },
  "agent-config": { help: "bundles agent config" },
  symlink: { help: "ships a symlink" },
  executable: { help: "ships an executable" },
  archive: { help: "ships an archive" },
  binary: { help: "ships a binary" },
  "external-url": { help: "links to an external host" },
} as const;

export type Rule = keyof typeof RULES;

const finding = (
  rule: Rule,
  fields: Omit<Finding, "rule" | "help">,
  help: string = RULES[rule].help,
): Finding => ({ rule, help, ...fields });

const isText = (buf: Buffer): boolean => !buf.subarray(0, 1024).includes(0);

const ARCHIVE_EXTS = new Set([".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar"]);

const AGENT_CONFIG_FILES = new Set([
  "plugin.json",
  ".mcp.json",
  "settings.json",
  "hooks.json",
  "opencode.json",
  "opencode.jsonc",
]);

const fileFlags: Scanner = ({ files }) => {
  const findings: Finding[] = [];
  for (const file of files) {
    if (isSymlink(file.mode)) {
      const target = file.content.toString("utf8").trim();
      const escapes =
        isAbsolute(target) || normalize(join(dirname(file.path), target)).startsWith("..");
      findings.push(
        finding("symlink", {
          severity: escapes ? "critical" : "warn",
          file: file.path,
          detail: escapes
            ? `symlink escapes the skill directory (→ ${target})`
            : `symlink → ${target}`,
        }),
      );
      continue;
    }
    if (file.mode === MODE_EXEC) {
      findings.push(
        finding("executable", {
          severity: "warn",
          file: file.path,
          detail: "executable file",
        }),
      );
    }
    if (ARCHIVE_EXTS.has(extname(file.path).toLowerCase())) {
      findings.push(
        finding("archive", { severity: "warn", file: file.path, detail: "archive file" }),
      );
    } else if (!isText(file.content)) {
      findings.push(
        finding("binary", { severity: "warn", file: file.path, detail: "binary file" }),
      );
    }
    if (AGENT_CONFIG_FILES.has(basename(file.path))) {
      findings.push(
        finding("agent-config", {
          severity: "critical",
          file: file.path,
          detail: "bundles agent configuration (plugin/MCP/settings/hooks)",
        }),
      );
    }
  }
  return findings;
};

const INVISIBLE_RANGES = [
  { lo: 0xe0000, hi: 0xe007f, name: "Unicode tag" },
  { lo: 0x200b, hi: 0x200d, name: "zero-width" },
  { lo: 0xfeff, hi: 0xfeff, name: "zero-width no-break space" },
  { lo: 0x202a, hi: 0x202e, name: "bidi override" },
  { lo: 0x2066, hi: 0x2069, name: "bidi isolate" },
];

const invisibleUnicode: Scanner = ({ files }) => {
  const findings: Finding[] = [];
  for (const file of files) {
    if (!isText(file.content)) continue;
    const hits: string[] = [];
    let index = 0;
    for (const ch of file.content.toString("utf8")) {
      const codepoint = ch.codePointAt(0)!;
      // A leading U+FEFF is a byte-order mark.
      if (!(codepoint === 0xfeff && index === 0)) {
        const range = INVISIBLE_RANGES.find(
          (candidate) => codepoint >= candidate.lo && codepoint <= candidate.hi,
        );
        if (range) hits.push(`U+${codepoint.toString(16).toUpperCase()} (${range.name})`);
      }
      index++;
    }
    if (hits.length > 0) {
      const sample = [...new Set(hits)].slice(0, 5).join(", ");
      findings.push(
        finding("invisible-unicode", {
          severity: "critical",
          file: file.path,
          detail: `${hits.length} invisible character(s): ${sample}`,
        }),
      );
    }
  }
  return findings;
};

const BENIGN_FIELDS = new Set([
  "name",
  "description",
  "when_to_use",
  "argument-hint",
  "arguments",
  "license",
  "compatibility",
  "metadata",
  "disable-model-invocation",
]);

const CONFIG_FIELDS = ["model", "effort", "paths", "shell"];

const fieldText = (key: string, value: unknown): string => {
  const text = asText(value).trim();
  return text ? `${key}: ${text}` : key;
};

const isMap = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : [value]);

const isFalse = (value: unknown): boolean => asText(value).trim() === "false";
const isTrue = (value: unknown): boolean => asText(value).trim() === "true";

const toolList = (value: unknown): string[] => {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.map((item) => asText(item).trim()).filter(Boolean);
  if (typeof value !== "string") return [asText(value)];
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === "," || /\s/u.test(ch))) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  return [...parts, current].map((part) => part.trim()).filter(Boolean);
};

const isUnscopedBash = (grant: string): boolean => /^Bash$|^Bash\(\s*\*/u.test(grant);

const HANDLER_PAYLOAD: Record<string, string[]> = {
  command: ["command"],
  http: ["url"],
  mcp_tool: ["server", "tool"],
  prompt: ["prompt"],
  agent: ["prompt"],
};

const handlerSummary = (handler: unknown): string => {
  if (!isMap(handler)) return asText(handler);
  const type = asText(handler["type"]).trim();
  const keys = HANDLER_PAYLOAD[type] ?? [...new Set(Object.values(HANDLER_PAYLOAD).flat())];
  const payload = keys
    .filter((key) => handler[key] !== undefined)
    .map((key) => asText(handler[key]).trim())
    .join(" ");
  const what = payload || asText(handler);
  return type && type !== "command" ? `${type} ${what}` : what;
};

const hookFindings = (hooks: unknown, file: string): Finding[] => {
  const found = (detail: string): Finding =>
    finding("hooks", { severity: "critical", file, detail });
  if (!isMap(hooks)) return [found(`hooks: ${asText(hooks)}`)];
  const findings: Finding[] = [];
  for (const [event, entries] of Object.entries(hooks)) {
    for (const entry of asList(entries)) {
      const matcher = isMap(entry) ? asText(entry["matcher"]).trim() : "";
      const where = matcher ? `${event}[${matcher}]` : event;
      const handlers =
        isMap(entry) && entry["hooks"] !== undefined ? asList(entry["hooks"]) : [entry];
      if (handlers.length === 0) {
        findings.push(found(`${where} → ${asText(entry)}`));
        continue;
      }
      for (const handler of handlers) findings.push(found(`${where} → ${handlerSummary(handler)}`));
    }
  }
  return findings.length > 0 ? findings : [found(`hooks: ${asText(hooks)}`)];
};

const skillPrivileges = (frontmatter: Record<string, unknown>, file: string): Finding[] => {
  const findings: Finding[] = [];
  const claimed = new Set([
    ...BENIGN_FIELDS,
    "hooks",
    "allowed-tools",
    "disallowed-tools",
    "user-invocable",
  ]);

  if (frontmatter["hooks"] !== undefined && frontmatter["hooks"] !== null) {
    findings.push(...hookFindings(frontmatter["hooks"], file));
  }
  for (const grant of toolList(frontmatter["allowed-tools"])) {
    findings.push(
      finding("allowed-tools", {
        severity: isUnscopedBash(grant) ? "critical" : "warn",
        file,
        detail: grant,
      }),
    );
  }
  for (const tool of toolList(frontmatter["disallowed-tools"])) {
    findings.push(finding("disallowed-tools", { severity: "warn", file, detail: tool }));
  }

  if (asText(frontmatter["context"]).trim() === "fork") {
    claimed.add("context").add("agent").add("background");
    const extras = ["agent", "background"]
      .filter((key) => frontmatter[key] !== undefined)
      .map((key) => fieldText(key, frontmatter[key]));
    findings.push(
      finding("context-fork", {
        severity: "warn",
        file,
        detail: `context: fork${extras.length > 0 ? ` (${extras.join(", ")})` : ""}`,
      }),
    );
  }

  if (isFalse(frontmatter["user-invocable"]) && !isTrue(frontmatter["disable-model-invocation"])) {
    findings.push(
      finding("user-invocable", {
        severity: "warn",
        file,
        detail: "user-invocable: false, model invocation not disabled",
      }),
    );
  }

  for (const key of CONFIG_FIELDS) {
    claimed.add(key);
    if (frontmatter[key] === undefined) continue;
    findings.push(
      finding("skill-config", {
        severity: "info",
        file,
        detail: fieldText(key, frontmatter[key]),
      }),
    );
  }

  for (const [key, value] of Object.entries(frontmatter)) {
    if (claimed.has(key)) continue;
    findings.push(
      finding("unknown-field", { severity: "info", file, detail: fieldText(key, value) }),
    );
  }
  return findings;
};

const frontmatterInventory = (frontmatter: Record<string, unknown>, file: string): Finding[] =>
  Object.entries(frontmatter)
    .filter(([key]) => !BENIGN_FIELDS.has(key))
    .map(([key, value]) =>
      finding("frontmatter-inventory", {
        severity: "info",
        file,
        detail: fieldText(key, value),
      }),
    );

const isMarkdown = (path: string): boolean => extname(path).toLowerCase() === ".md";

const isEntry = (path: string): boolean => path === "SKILL.md";

const frontmatterPrivileges: Scanner = ({ files }) => {
  const findings: Finding[] = [];
  for (const file of files) {
    if (!isMarkdown(file.path) || !isText(file.content)) continue;
    const entry = isEntry(file.path);
    let frontmatter: Record<string, unknown>;
    try {
      frontmatter = parseFrontmatter(file.content.toString("utf8"));
    } catch (e) {
      // Only SKILL.md grants permissions when an agent loads the skill.
      findings.push(
        finding(entry ? "frontmatter" : "frontmatter-inventory", {
          severity: entry ? "critical" : "info",
          file: file.path,
          detail: entry
            ? `invalid YAML. Permissions could not be checked. ${(e as Error).message}`
            : `invalid YAML. ${(e as Error).message}`,
        }),
      );
      continue;
    }
    findings.push(
      ...(entry
        ? skillPrivileges(frontmatter, file.path)
        : frontmatterInventory(frontmatter, file.path)),
    );
  }
  return findings;
};

// Claude executes these forms before it sends the skill to the model.
const INLINE_EXEC = /(?:^|\s)!`([^`\n]+)`/gu;
const loadTimeExecution: Scanner = ({ files }) => {
  const findings: Finding[] = [];
  for (const file of files) {
    if (!isMarkdown(file.path) || !isText(file.content)) continue;
    const severity: Severity = isEntry(file.path) ? "critical" : "info";
    const text = file.content.toString("utf8");
    const report = (line: number, detail: string): void => {
      findings.push(finding("load-time-exec", { severity, file: file.path, line, detail }));
    };
    const inFence = new Set<number>();
    for (const fence of codeFences(text).filter((candidate) =>
      candidate.infoString.startsWith("!"),
    )) {
      for (let line = fence.startLine; line < fence.endLineExclusive; line += 1) inFence.add(line);
      for (const [lineOffset, line] of fence.content.split("\n").entries()) {
        const command = line.trim();
        if (command && !command.startsWith("#")) {
          report(fence.startLine + lineOffset + 2, command);
        }
      }
    }
    for (const [i, line] of text.split("\n").entries()) {
      if (inFence.has(i)) continue;
      for (const match of line.matchAll(INLINE_EXEC)) report(i + 1, match[1]!.trim());
    }
  }
  return findings;
};

interface PatternRule {
  rule: Rule;
  severity: Severity;
  pattern: RegExp;
}

const PATTERN_RULES: PatternRule[] = [
  {
    rule: "curl-pipe-shell",
    severity: "critical",
    pattern: /\b(curl|wget)\b[^\n|]*\|\s*(ba|z|da)?sh\b/u,
  },
  {
    rule: "base64-exec",
    severity: "critical",
    pattern: /base64\s+(-d|-D|--decode)[^\n]*\|\s*(ba|z)?sh\b|eval[^\n]*base64/u,
  },
  {
    rule: "exfil-domain",
    severity: "critical",
    pattern:
      /webhook\.site|requestbin|pipedream\.net|ngrok(-free)?\.(io|app|dev)|discord(app)?\.com\/api\/webhooks|api\.telegram\.org\/bot|hooks\.slack\.com/u,
  },
  {
    rule: "claude-settings",
    severity: "critical",
    pattern: /\.claude\/settings(\.local)?\.json|permissions\.allow/u,
  },
  { rule: "skip-permissions", severity: "critical", pattern: /--dangerously-skip-permissions/u },
  {
    rule: "credential-paths",
    severity: "critical",
    pattern: /~\/\.ssh\b|\bid_rsa\b|~\/\.aws\b/u,
  },
  {
    rule: "env-secrets",
    severity: "warn",
    pattern: /process\.env\b|os\.environ\b|(^|[^\w.])\.env\b/u,
  },
  {
    rule: "prompt-injection",
    severity: "warn",
    pattern:
      /ignore (all )?(previous|prior|above) instructions|do not (tell|inform) the user|without (telling|asking) the user/iu,
  },
  { rule: "destructive", severity: "warn", pattern: /\brm\s+-(rf|fr)\b/u },
];

const suspiciousPatterns: Scanner = ({ files }) => {
  const findings: Finding[] = [];
  for (const file of files) {
    if (!isText(file.content)) continue;
    const text = file.content.toString("utf8");
    for (const { rule, severity, pattern } of PATTERN_RULES) {
      const match = text.match(pattern);
      if (!match) continue;
      findings.push(
        finding(rule, {
          severity,
          file: file.path,
          line: lineAt(text, match.index!),
          detail: match[0].trim(),
        }),
      );
    }
  }
  return findings;
};

// Fuzzy matching can report filenames with country-code extensions as hosts.
const linkify = new LinkifyIt({ fuzzyLink: true, fuzzyEmail: false });

const urlInventory: Scanner = ({ files }) => {
  const urlsByHost = new Map<string, Set<string>>();
  for (const file of files) {
    if (isSymlink(file.mode) || !isText(file.content)) continue;
    for (const link of linkify.match(file.content.toString("utf8")) ?? []) {
      try {
        const host = new URL(link.url).host;
        urlsByHost.set(host, (urlsByHost.get(host) ?? new Set()).add(link.text));
      } catch {
        continue;
      }
    }
  }
  const hostCount = urlsByHost.size;
  const linkCount = [...urlsByHost.values()].reduce((sum, urls) => sum + urls.size, 0);
  const help = `${hostCount} external host${hostCount === 1 ? "" : "s"}, ${linkCount} link${linkCount === 1 ? "" : "s"}`;
  return [...urlsByHost.entries()]
    .toSorted((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
    .flatMap(([host, urls]) =>
      [...urls]
        .toSorted()
        .map((url) => finding("external-url", { severity: "info", file: host, detail: url }, help)),
    );
};

export const defaultScanners: Scanner[] = [
  fileFlags,
  invisibleUnicode,
  frontmatterPrivileges,
  loadTimeExecution,
  suspiciousPatterns,
  urlInventory,
];
