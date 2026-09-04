import { parse } from "yaml";

export const parseFrontmatter = (text: string): Record<string, unknown> => {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/u);
  if (!match) return {};
  const doc: unknown = parse(match[1]!);
  if (doc === null) return {};
  if (typeof doc !== "object" || Array.isArray(doc)) {
    throw new SyntaxError("frontmatter is not a mapping");
  }
  return Object.fromEntries(
    Object.entries(doc).map(([key, value]) => [
      key.toLowerCase(),
      typeof value === "string" ? value.trim() : value,
    ]),
  );
};

export const asText = (value: unknown): string =>
  value === undefined || value === null
    ? ""
    : typeof value === "string"
      ? value
      : (JSON.stringify(value) ?? "");
