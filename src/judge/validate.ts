import { normaliseForMatch } from "../catalog/normalise.ts";
import { numberedLines } from "./prompt.ts";
import type { RunResult } from "./types.ts";

export type FailKind = "missing" | "duplicate" | "unsupported";
export interface Validation {
  accepted: Map<string, RunResult>;
  failing: { id: string; kind: FailKind; detail: string }[];
}

const MAX_QUOTE = 200;
const WINDOW = [0, -1, 1, -2, 2];

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * The quote occurs on the cited line, or within 2 lines of it. A match on the whitespace-collapsed raw text is
 * accepted too: `normaliseForMatch` strips Markdown emphasis, so a quote that leaves out a closing `**` would
 * otherwise fail against the normalised line. Nothing wider than that is accepted.
 */
export function quoteOnLine(quote: string, lines: string[], line: number): boolean {
  if (/[\r\n]/.test(quote)) return false;
  const q = normaliseForMatch(quote);
  if (q === "") return false;
  const raw = quote.replace(/\s+/g, " ").trim();
  for (const d of WINDOW) {
    const text = lines[line - 1 + d];
    if (text === undefined) continue;
    if (normaliseForMatch(text).includes(q) || text.replace(/\s+/g, " ").includes(raw)) return true;
  }
  return false;
}

function check(id: string, e: Record<string, unknown>, files: Map<string, string[]>): RunResult | string {
  const { status, score, quote, file, line, reason } = e;
  if (status !== "scored" && status !== "not_applicable") return "status is neither scored nor not_applicable";
  if (typeof quote !== "string" || typeof file !== "string" || typeof reason !== "string") return "quote, file or reason is not a string";
  if (typeof line !== "number" || !Number.isInteger(line)) return "line is not an integer";
  if (status === "scored") {
    if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 3) return "scored without an integer score from 0 to 3";
  } else if (score !== null && score !== undefined) return "not_applicable with a score";
  if (quote.length > MAX_QUOTE) return `quote is longer than ${MAX_QUOTE} characters`;
  const lines = files.get(file);
  if (!lines) return `file ${file.slice(0, 60)} is not one of the skill's files`;
  if (line < 1 || line > lines.length) return `line ${line} is outside ${file}`;
  if (!quoteOnLine(quote, lines, line)) return `quote not found within 2 lines of ${id} ${file}:${line}: "${quote.slice(0, 60)}"`;
  return status === "scored"
    ? { kind: "scored", score: score as number, quote, file, line, reason }
    : { kind: "not_applicable", reason, quote, file, line };
}

export function validateAnswer(answer: unknown, sentIds: string[], files: { path: string; text: string }[]): Validation {
  const accepted = new Map<string, RunResult>();
  const failing: Validation["failing"] = [];
  const byFile = new Map(files.map((f) => [f.path, numberedLines(f.text)]));
  const entries = isObj(answer) && Array.isArray(answer.results) ? answer.results : [];
  const groups = new Map<string, unknown[]>();
  for (const e of entries) {
    const id = isObj(e) ? e.practice_id : undefined;
    if (typeof id === "string" && sentIds.includes(id)) groups.set(id, [...(groups.get(id) ?? []), e]);
  }
  for (const id of sentIds) {
    const got = groups.get(id) ?? [];
    if (got.length === 0) failing.push({ id, kind: "missing", detail: "judge returned no result for this practice" });
    else if (got.length > 1) failing.push({ id, kind: "duplicate", detail: "judge returned this practice more than once" });
    else {
      const r = check(id, got[0] as Record<string, unknown>, byFile);
      if (typeof r === "string") failing.push({ id, kind: "unsupported", detail: r });
      else accepted.set(id, r);
    }
  }
  return { accepted, failing };
}
