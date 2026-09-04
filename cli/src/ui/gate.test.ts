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
    expect(stopsOn([finding("info", "external-url")], false)).toBeNull();
  });

  test("a warn finding stops", () => {
    expect(stopsOn([finding("info", "external-url"), finding("warn", "executable")], false)).toBe(
      "warn",
    );
  });

  test("a critical finding outranks a warn finding", () => {
    expect(
      stopsOn([finding("warn", "executable"), finding("critical", "curl-pipe-shell")], false),
    ).toBe("critical");
  });

  test("-y skips the warn stop", () => {
    expect(stopsOn([finding("warn", "executable")], true)).toBeNull();
  });

  test("-y never answers the critical gate", () => {
    expect(stopsOn([finding("critical", "hooks")], true)).toBe("critical");
  });

  test("an unset -y stops like a false one", () => {
    expect(stopsOn([finding("warn", "executable")], undefined)).toBe("warn");
  });
});
