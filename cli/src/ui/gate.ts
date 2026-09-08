import * as p from "@clack/prompts";
import type { SkillFile } from "../core/skill/files.ts";
import { CRITICAL_EXIT, runScanners, type Finding, type Severity } from "../core/scan/index.ts";
import { isInteractive, unwrap } from "./prompt.ts";
import { logError, logFindings, logWarn, renderFiles, warn } from "./report.ts";
import { skillName } from "./style.ts";

type GateOutcome = "pass" | "declined" | "blocked";

export interface ReviewOptions {
  yes?: boolean;
  dangerousSkipCriticalApproval?: boolean;
}

interface Reviewable {
  name: string;
  files: SkillFile[];
  warnings?: string[];
}

interface GateResult<T> {
  approved: T[];
  blocked: boolean;
}

export const reviewSkills = async <T extends Reviewable>(
  selection: T[],
  options: ReviewOptions,
): Promise<GateResult<T>> => {
  const approved: T[] = [];
  let blocked = false;
  for (const entry of selection) {
    const { name, files } = entry;
    p.note(renderFiles(files), `${skillName(name)}: ${files.length} file(s)`);
    for (const warning of entry.warnings ?? []) logWarn(warning);
    const outcome = await reviewSkill(name, files, options);
    if (outcome === "pass") {
      approved.push(entry);
    } else {
      if (outcome === "blocked") blocked = true;
      warn(`${skillName(name)}: skipped`);
    }
  }
  return { approved, blocked };
};

export const stopsOn = (
  findings: Finding[],
  { yes, dangerousSkipCriticalApproval }: ReviewOptions,
): Severity | null => {
  if (!dangerousSkipCriticalApproval && findings.some((finding) => finding.severity === "critical"))
    return "critical";
  if (!yes && findings.some((finding) => finding.severity === "warn")) return "warn";
  return null;
};

const reviewSkill = async (
  name: string,
  files: SkillFile[],
  options: ReviewOptions,
): Promise<GateOutcome> => {
  const findings = runScanners({ name, files });
  logFindings(name, findings);
  const stop = stopsOn(findings, options);
  if (!stop) return "pass";
  const stopping = findings.filter((finding) => finding.severity === stop);
  const outcome =
    stop === "critical" ? await askApproval(name, stopping) : await askWarnFindings(name, stopping);
  if (outcome === "blocked") process.exitCode = CRITICAL_EXIT;
  return outcome;
};

const askApproval = async (name: string, criticals: Finding[]): Promise<GateOutcome> => {
  if (!isInteractive()) {
    logError(`${skillName(name)}: review critical findings in a terminal.`);
    return "blocked";
  }
  const proceed = unwrap(
    await p.confirm({
      message: `Approve ${skillName(name)} with ${criticals.length} critical finding(s)?`,
      initialValue: false,
    }),
  );
  return proceed ? "pass" : "declined";
};

const askWarnFindings = async (name: string, warnFindings: Finding[]): Promise<GateOutcome> => {
  if (!isInteractive()) return "pass";
  const proceed = unwrap(
    await p.confirm({
      message: `Continue with ${skillName(name)} and ${warnFindings.length} warn finding(s)?`,
      initialValue: true,
    }),
  );
  return proceed ? "pass" : "declined";
};
