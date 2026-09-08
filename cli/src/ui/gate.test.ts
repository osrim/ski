import { describe, expect, test } from "bun:test";
import type { Finding } from "../core/scan/index.ts";
import { stopsOn } from "./gate.ts";

const finding = (severity: Finding["severity"], rule: Finding["rule"]): Finding => ({
  severity,
  rule,
  help: `${rule} help`,
  detail: `${rule} fired`,
});

describe("stopsOn", () => {
  test("info findings alone pass", () => {
    expect(stopsOn([finding("info", "external-url")], {})).toBeNull();
  });

  test("a warn finding stops", () => {
    expect(stopsOn([finding("info", "external-url"), finding("warn", "executable")], {})).toBe(
      "warn",
    );
  });

  test("a critical finding outranks a warn finding", () => {
    expect(
      stopsOn([finding("warn", "executable"), finding("critical", "curl-pipe-shell")], {}),
    ).toBe("critical");
  });

  test("-y skips the warn stop", () => {
    expect(stopsOn([finding("warn", "executable")], { yes: true })).toBeNull();
  });

  test("-y never answers the critical gate", () => {
    expect(stopsOn([finding("critical", "hooks")], { yes: true })).toBe("critical");
  });

  test("an unset -y stops like a false one", () => {
    expect(stopsOn([finding("warn", "executable")], {})).toBe("warn");
  });

  test.each([
    { critical: "critical", warn: "warn", mixed: "critical" },
    { yes: false, critical: "critical", warn: "warn", mixed: "critical" },
    { yes: true, critical: "critical", warn: null, mixed: "critical" },
    { dangerousSkipCriticalApproval: false, critical: "critical", warn: "warn", mixed: "critical" },
    {
      yes: false,
      dangerousSkipCriticalApproval: false,
      critical: "critical",
      warn: "warn",
      mixed: "critical",
    },
    {
      yes: true,
      dangerousSkipCriticalApproval: false,
      critical: "critical",
      warn: null,
      mixed: "critical",
    },
    { dangerousSkipCriticalApproval: true, critical: null, warn: "warn", mixed: "warn" },
    {
      yes: false,
      dangerousSkipCriticalApproval: true,
      critical: null,
      warn: "warn",
      mixed: "warn",
    },
    { yes: true, dangerousSkipCriticalApproval: true, critical: null, warn: null, mixed: null },
  ])("review options %j preserve independent approval and warn stops", (options) => {
    expect(stopsOn([finding("critical", "hooks")], options)).toBe(options.critical);
    expect(stopsOn([finding("warn", "executable")], options)).toBe(options.warn);
    expect(stopsOn([finding("critical", "hooks"), finding("warn", "executable")], options)).toBe(
      options.mixed,
    );
    expect(stopsOn([finding("info", "external-url")], options)).toBeNull();
    expect(stopsOn([], options)).toBeNull();
  });
});
