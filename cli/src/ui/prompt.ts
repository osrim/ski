import * as p from "@clack/prompts";
import { logError } from "./report.ts";

export const isInteractive = (): boolean => Boolean(process.stdin.isTTY && process.stdout.isTTY);

export const intro = p.intro;
export const outro = p.outro;
export const promptWarn = p.log.warn;

export const unwrap = <T>(value: T | symbol): T => {
  if (p.isCancel(value)) {
    p.cancel("Cancelled.");
    process.exit(130);
  }
  return value as T;
};

export const fail = (message: string): never => {
  logError(message);
  process.exit(1);
};

export const failNoTTY = (question: string, remedy: string): never => {
  logError(`${question}, and there is no terminal to ask.\n${remedy}`);
  process.exit(2);
};

export const requireTTY = (question: string, remedy: string): void => {
  if (!isInteractive()) failNoTTY(question, remedy);
};

export const withSpinner = async <T>(
  message: string,
  work: () => Promise<T>,
  done: (result: T) => string | null,
): Promise<T> => {
  const spinner = p.spinner();
  spinner.start(message);
  try {
    const result = await work();
    const line = done(result);
    if (line === null) spinner.clear();
    else spinner.stop(line);
    return result;
  } catch (e) {
    spinner.error(`${message}: failed`);
    throw e;
  }
};
