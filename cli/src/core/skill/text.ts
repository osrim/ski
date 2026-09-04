import MarkdownIt from "markdown-it";

export const lineAt = (text: string, index: number): number =>
  text.slice(0, index).split("\n").length;

const markdown = new MarkdownIt();

export interface Fence {
  infoString: string;
  content: string;
  startLine: number;
  endLineExclusive: number;
}

export const codeFences = (text: string): Fence[] =>
  markdown.parse(text, {}).flatMap((token) => {
    const [start, end] = token.map ?? [];
    return token.type === "fence" && start !== undefined && end !== undefined
      ? [
          {
            infoString: token.info,
            content: token.content,
            startLine: start,
            endLineExclusive: end,
          },
        ]
      : [];
  });

export const stripFencedCode = (text: string): string => {
  const lines = text.split("\n");
  for (const fence of codeFences(text)) {
    for (let line = fence.startLine; line < fence.endLineExclusive; line += 1) lines[line] = "";
  }
  return lines.join("\n");
};
