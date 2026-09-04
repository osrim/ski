import { expect, test } from "bun:test";
import { resolveScope, scopeFlag, USAGE_ERROR } from "./scope.ts";

const noWarn = (): void => {};

test("each flag alone picks its scope", () => {
  expect(resolveScope({ global: true }, noWarn)).toBe("global");
  expect(resolveScope({ project: true }, noWarn)).toBe("project");
});

test("both flags together are a usage error", () => {
  try {
    resolveScope({ global: true, project: true }, noWarn);
    expect.unreachable();
  } catch (e) {
    expect((e as Error).message).toBe("Pass either -g or -p, not both.");
    expect((e as Error).name).toBe(USAGE_ERROR);
  }
});

test("no flag leaves the scope unresolved", () => {
  expect(resolveScope({}, noWarn)).toBeNull();
});

test("the global flag adds -g to a suggested command", () => {
  expect(scopeFlag("global")).toBe(" -g");
  expect(scopeFlag("project")).toBe("");
});
