import { userHome, type Scope } from "../paths.ts";
import { usageError } from "../usage.ts";

const isHomeCwd = (): boolean => process.cwd() === userHome();

const HOME_SCOPE_WARNING = "Home directory. Using global scope.";

export interface ScopeOptions {
  global?: boolean;
  project?: boolean;
}

export const resolveScope = (
  options: ScopeOptions,
  warn: (message: string) => void,
): Scope | null => {
  if (options.global && options.project) throw usageError("Pass either -g or -p, not both.");
  if (options.global) return "global";
  if (options.project) return "project";
  if (isHomeCwd()) {
    warn(HOME_SCOPE_WARNING);
    return "global";
  }
  return null;
};

export const scopeFlag = (scope: Scope): string => (scope === "global" ? " -g" : "");
