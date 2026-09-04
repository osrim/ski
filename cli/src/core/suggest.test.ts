import { expect, test } from "bun:test";
import { nearest } from "./suggest.ts";

const COMMANDS = ["add", "install", "update", "remove", "list", "i", "up", "rm", "ls"];

test("one wrong, missing or extra letter is a hit", () => {
  expect(nearest("instal", COMMANDS)).toBe("install");
  expect(nearest("updte", COMMANDS)).toBe("update");
  expect(nearest("adds", COMMANDS)).toBe("add");
  expect(nearest("lists", COMMANDS)).toBe("list");
});

test("two swapped letters are a hit", () => {
  expect(nearest("remvoe", COMMANDS)).toBe("remove");
  expect(nearest("isntall", COMMANDS)).toBe("install");
  expect(nearest("udpate", COMMANDS)).toBe("update");
});

test("an alias is suggestible", () => {
  expect(nearest("lst", COMMANDS)).toBe("list");
  expect(nearest("ip", COMMANDS)).toBe("up");
});

test("a short alias is not a catch-all", () => {
  expect(nearest("x", COMMANDS)).toBeUndefined();
  expect(nearest("is", COMMANDS)).toBe("ls");
  expect(nearest("j", ["i"])).toBeUndefined();
});

test("nothing close enough suggests nothing", () => {
  expect(nearest("frobnicate", COMMANDS)).toBeUndefined();
  expect(nearest("publish", COMMANDS)).toBeUndefined();
  expect(nearest("", COMMANDS)).toBeUndefined();
});

test("the closest wins, and a tie goes to the earlier candidate", () => {
  expect(nearest("lis", ["list", "ls"])).toBe("list");
  expect(nearest("l", ["ls", "list"])).toBe("ls");
});
