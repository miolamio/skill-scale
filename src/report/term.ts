// Terminal helpers for the pretty console report. Pure: every function takes what it needs.

export interface EnvLike {
  [key: string]: string | undefined;
}

/** FORCE_COLOR (non-empty, not "0") wins; otherwise a TTY, unless NO_COLOR is non-empty or TERM is "dumb". */
export function detectPretty(env: EnvLike, stream: { isTTY?: boolean }): boolean {
  const force = env.FORCE_COLOR;
  if (force !== undefined && force !== "" && force !== "0") return true;
  if (stream.isTTY !== true) return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  return env.TERM !== "dumb";
}

export function termWidth(stream: { columns?: number }): number {
  const c = stream.columns;
  if (typeof c !== "number" || !Number.isFinite(c) || c <= 0) return 80;
  return Math.min(100, Math.max(60, Math.floor(c)));
}

const style = (open: number, close: number) => (s: string, color: boolean): string => (color ? `\x1b[${open}m${s}\x1b[${close}m` : s);
export const bold = style(1, 22);
export const dim = style(2, 22);
export const red = style(31, 39);
export const green = style(32, 39);
export const yellow = style(33, 39);
export const cyan = style(36, 39);

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
export const stripAnsi = (s: string): string => s.replace(ANSI, "");
export const visibleWidth = (s: string): number => [...stripAnsi(s)].length;

/**
 * Wraps plain text at word boundaries. Every line is `indent` spaces plus text, except the first,
 * which starts with `first` when given (its visible width should not exceed `indent` by much; it
 * counts against the line budget). Words wider than the room are hard-broken.
 */
export function wrap(text: string, width: number, indent: number, first?: string): string[] {
  const pad = " ".repeat(indent);
  const lines: string[] = [];
  let line = first ?? pad;
  let lineWidth = visibleWidth(line);
  let empty = true;
  const room = (): number => Math.max(1, width - lineWidth);
  const flush = (): void => {
    lines.push(line);
    line = pad;
    lineWidth = indent;
    empty = true;
  };
  for (const word of text.split(/\s+/).filter((w) => w !== "")) {
    let w = [...word];
    const need = w.length + (empty ? 0 : 1);
    if (need <= width - lineWidth) {
      line += (empty ? "" : " ") + word;
      lineWidth += need;
      empty = false;
      continue;
    }
    if (!empty) flush();
    while (w.length > room()) {
      const n = room();
      line += w.slice(0, n).join("");
      w = w.slice(n);
      flush();
    }
    line += w.join("");
    lineWidth += w.length;
    empty = false;
  }
  lines.push(line);
  return lines;
}

/** Fits a path into `room` columns: keeps the tail, with `…` standing for the dropped front at a `/` boundary. */
export function ellipsizePath(path: string, room: number): string {
  if ([...path].length <= room) return path;
  const segs = path.split("/").filter((x) => x !== "");
  let best = "";
  for (let i = 1; i <= segs.length; i++) {
    const cand = `…/${segs.slice(-i).join("/")}`;
    if ([...cand].length > room) break;
    best = cand;
  }
  if (best !== "") return best;
  const last = [...(segs[segs.length - 1] ?? path)];
  return `…${last.slice(-Math.max(0, room - 1)).join("")}`;
}
