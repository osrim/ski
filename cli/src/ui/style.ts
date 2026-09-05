import { Ansis } from "ansis";
import cliTruncate from "cli-truncate";
import { createSupportsColor } from "supports-color";
export { tildify } from "../core/paths.ts";

// supports-color handles piped output and TERM=dumb. NO_COLOR needs an explicit check.
const colorLevel = (): 0 | 1 | 2 | 3 => {
  if (process.env.NO_COLOR) return 0;
  const support = createSupportsColor(process.stdout, { sniffFlags: false });
  return support ? support.level : 0;
};

type Paint = (text: string) => string;

const ansi = new Ansis(colorLevel());

export const orange: Paint = ansi.fg(208);

export const softOrange: Paint = ansi.fg(215);
export const red: Paint = ansi.red;
export const green: Paint = ansi.green;
export const blue: Paint = ansi.blue;
export const bold: Paint = ansi.bold;
export const dim: Paint = ansi.dim;

export const skillName: Paint = ansi.cyan;

export const unstruck: Paint = (text) => `${ansi.strikethrough.close}${text}`;

const SGR_SEQUENCE = new RegExp(`${"\\u001B"}\\[[\\d;]*m`, "gu");

const stripSgr = (chunk: unknown): unknown => {
  if (typeof chunk === "string") return chunk.replace(SGR_SEQUENCE, "");
  if (chunk instanceof Uint8Array) {
    return Buffer.from(Buffer.from(chunk).toString("latin1").replace(SGR_SEQUENCE, ""), "latin1");
  }
  return chunk;
};

let enforced = false;

// Clack ignores this color policy. Filter only SGR sequences at the stream boundary.
export const enforceColorPolicy = (): void => {
  if (ansi.level > 0 || enforced) return;
  enforced = true;
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream);
    stream.write = ((chunk: unknown, ...rest: unknown[]) =>
      (write as (...a: unknown[]) => boolean)(stripSgr(chunk), ...rest)) as typeof stream.write;
  }
};

export const pad = (text: string, width: number): string =>
  text + " ".repeat(Math.max(0, width - Bun.stringWidth(text)));

export const summarize = (text: string | undefined, width = 60): string | undefined =>
  text === undefined || text === ""
    ? undefined
    : cliTruncate(text.replace(/\s+/gu, " ").trim(), width, { preferTruncationOnSpace: true });
