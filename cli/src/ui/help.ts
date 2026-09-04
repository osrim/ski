import { wrapAnsi } from "fast-wrap-ansi";

export interface HelpSection {
  title?: string;
  body: string;
}

export interface CommandHelp {
  description: string;
  coordinate?: string;
  examples: string[];
}

const indent = (text: string): string =>
  text
    .split("\n")
    .map((line) => (line === "" ? line : `  ${line}`))
    .join("\n");

export const wrap = (text: string, width = 78): string => indent(wrapAnsi(text, width));

export const applyCommandHelp = (sections: HelpSection[], help: CommandHelp): void => {
  sections.splice(2, 0, { title: "Description", body: wrap(help.description) });
  if (help.coordinate) {
    sections.splice(3, 0, { title: "Coordinate", body: indent(help.coordinate) });
  }
  sections.push({ title: "Examples", body: indent(help.examples.join("\n")) });
};

const EXIT_CODES = [
  "0    success",
  "1    error",
  "2    usage error",
  "3    critical findings need review",
  "130  cancelled",
].join("\n");

interface Aliased {
  name: string;
  aliasNames: string[];
}

export const applyRootHelp = (sections: HelpSection[], commands: Aliased[]): void => {
  const aliased = commands.filter((command) => command.aliasNames.length > 0);
  if (aliased.length > 0) {
    const width = Math.max(...aliased.map((command) => command.aliasNames.join(", ").length));
    sections.push({
      title: "Aliases",
      body: indent(
        aliased
          .map((command) => `${command.aliasNames.join(", ").padEnd(width)}  ${command.name}`)
          .join("\n"),
      ),
    });
  }
  sections.push({ title: "Exit codes", body: indent(EXIT_CODES) });
};
