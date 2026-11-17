import type { CriterionRecord, Summary } from "../score/score.ts";
import { describeSkipped } from "../loader/files.ts";
import type { Strings } from "./strings.ts";
import { t } from "./strings.ts";

export interface ReportContext {
  version: string;
  revision: number;
  profile: string;
  skillPath: string;
  skippedFiles?: { path: string; bytes: number }[];
  /** Shown by the pretty report; the plain one ignores it. */
  skillName?: string;
}

/** Everything a console renderer needs. */
export interface ConsoleReport {
  ctx: ReportContext;
  records: CriterionRecord[];
  summary: Summary;
  strings: Strings;
}

const BAR_WIDTH = 15;
const LOWEST_SHOWN = 10;

function bar(mean: number | null): string {
  if (mean === null) return "-".repeat(BAR_WIDTH);
  const filled = Math.round((mean / 3) * BAR_WIDTH);
  return "#".repeat(filled) + ".".repeat(BAR_WIDTH - filled);
}

export function where(file: string | null, line: number | null): string {
  return file === null ? "" : `  [${file}${line === null ? "" : `:${line}`}]`;
}

export const joinAnd = (xs: string[]): string => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** "mechanical only", "a and b", "no layer". */
export function layersText(summary: Summary): string {
  return summary.scored_by.length === 0 ? "no layer" : summary.scored_by.length === 1 ? `${summary.scored_by[0]} only` : joinAnd(summary.scored_by);
}

/** The "not a full assessment" sentence, or "" when every layer ran. */
export function notFullText(summary: Summary, strings: Strings): string {
  const n = summary.layers_not_run.length;
  return n === 0 ? "" : t(strings, "notFull", { missing: `the ${joinAnd(summary.layers_not_run)} ${n === 1 ? "layer" : "layers"}` });
}

/** Per-id marker text: stale, experimental, unstable. */
export function markerFor(records: CriterionRecord[], strings: Strings): (id: string) => string {
  const stale = new Set(records.filter((r) => r.freshness === "stale-unconfirmed").map((r) => r.id));
  const experimental = new Set(records.filter((r) => r.experimental).map((r) => r.id));
  const unstable = new Set(records.filter((r) => r.judge?.unstable === true).map((r) => r.id));
  return (id) =>
    (stale.has(id) ? ` ${t(strings, "staleMarker")}` : "") + (experimental.has(id) ? ` ${t(strings, "experimentalMarker")}` : "") + (unstable.has(id) ? ` ${t(strings, "unstableMarker")}` : "");
}

/** The scored records below 3, worst first, at most LOWEST_SHOWN. */
export function selectLowest(records: CriterionRecord[]): CriterionRecord[] {
  return records
    .filter((r) => r.status === "scored" && (r.score ?? 3) < 3)
    .sort((x, y) => (x.score ?? 0) - (y.score ?? 0) || x.id.localeCompare(y.id))
    .slice(0, LOWEST_SHOWN);
}

/** The judge summary line, the stability line and the opinion sentence. */
export function judgeLines(judge: NonNullable<Summary["judge"]>, strings: Strings): string[] {
  const lines = [
    t(strings, "judgeLine", {
      model: judge.model,
      runs: `${judge.repeats} ${judge.repeats === 1 ? "run" : "runs"}`,
      calls: `${judge.calls} ${judge.calls === 1 ? "call" : "calls"}`,
      cost: judge.cost_usd.toFixed(4),
      seconds: (judge.duration_ms / 1000).toFixed(1),
    }),
  ];
  if (!judge.stability_measured) lines.push(t(strings, judge.repeats === 1 ? "stabilityNone" : "stabilityFew"));
  else if (judge.unstable.length > 0) lines.push(t(strings, "unstableList", { ids: judge.unstable.join(", ") }));
  else lines.push(t(strings, "noUnstable", { n: judge.repeats }));
  lines.push(t(strings, "judgeOpinion"));
  return lines;
}

export function renderConsole(ctx: ReportContext, records: CriterionRecord[], summary: Summary, strings: Strings): string {
  const out: string[] = [];
  out.push(t(strings, "title", { version: ctx.version, revision: ctx.revision, profile: ctx.profile }));
  out.push(t(strings, "skill", { path: ctx.skillPath }), "");
  const layers = layersText(summary);
  const nf = notFullText(summary, strings);
  const notFull = nf === "" ? "" : ` ${nf}`;
  out.push(`${t(strings, "headline", { scored: summary.scored, total: summary.total, layers })}${summary.experimental > 0 ? ` ${t(strings, "headlineExperimental", { experimental: summary.experimental })}` : ""}${notFull}`, "");
  const marker = markerFor(records, strings);
  out.push(t(strings, "areas"));
  for (const a of summary.areas) {
    if (a.assessable === 0 && a.process === 0 && a.not_applicable === 0) continue;
    const mean = a.mean === null ? t(strings, "noScore") : a.mean.toFixed(2);
    const process = a.process > 0 ? `, ${t(strings, "areaProcess", { process: a.process })}` : "";
    out.push(`  ${a.area.padEnd(7)}${bar(a.mean)}  ${mean.padStart(8)}   ${t(strings, "coverage", { scored: a.scored, assessable: a.assessable })}${process}`);
  }
  const judge = summary.judge;
  if (judge) {
    out.push("", ...judgeLines(judge, strings));
  }
  const noneAtAll = summary.blockers.length === 0 && summary.security_blockers.length === 0;
  if (summary.blockers.length > 0 || noneAtAll) out.push("", t(strings, "blockers"));
  if (noneAtAll) out.push(`  ${t(strings, "noBlockers")}`);
  for (const b of summary.blockers) {
    out.push(`  ${b.id} ${b.title}${marker(b.id)}: ${b.reason}${where(b.file, b.line)}`);
    if (b.kind === "effect") out.push(`      ${t(strings, "effect", { effect: b.effect ?? "", lb: b.lb.join(", ") })}`);
  }
  if (summary.security_blockers.length > 0) {
    out.push("", t(strings, "securityBlockers"));
    for (const b of summary.security_blockers) {
      out.push(`  ${b.id} ${b.title}: ${b.reason}${where(b.file, b.line)}`);
      out.push(`      ${t(strings, "risk", { risk: b.risk })}`);
    }
  }
  if (summary.suppressed_security.length > 0) {
    out.push("", t(strings, "suppressedSecurity"));
    for (const b of summary.suppressed_security) out.push(`  ${b.id}${where(b.file, b.line)}: ${t(strings, "suppressedReason", { reason: b.reason })}`);
  }

  if (judge && judge.injection.length > 0) {
    out.push("", t(strings, "judgeNotes"));
    for (const i of judge.injection) out.push(`  ${t(strings, "judgeNote", { text: i.text })}`);
  }

  const lowest = selectLowest(records);
  out.push("", t(strings, "lowest"));
  if (lowest.length === 0) out.push(`  ${t(strings, "noLowest")}`);
  for (const r of lowest) {
    const e = r.evidence[0];
    out.push(`  ${r.score} ${r.id} ${r.title}${marker(r.id)}${where(e?.file ?? null, e?.line ?? null)}`);
    if (e) out.push(`      ${e.message}`);
    if (r.judge?.quote) out.push(`      "${r.judge.quote}"`);
    if (r.fix_hint) out.push(`      ${t(strings, "fixPrefix")} ${r.fix_hint}`);
  }
  out.push("", t(strings, "notScored", { not_run: summary.not_run, contested: summary.contested, not_applicable: summary.not_applicable, process: summary.process }));
  if (summary.stale_unconfirmed.length > 0) out.push(t(strings, "staleCount", { count: summary.stale_unconfirmed.length, ids: summary.stale_unconfirmed.join(", ") }));
  const skipped = ctx.skippedFiles ?? [];
  if (skipped.length > 0) out.push(t(strings, "notScanned", { files: skipped.map(describeSkipped).join(", ") }));
  out.push(t(strings, "inference"));
  if (summary.scored === 0) out.push(t(strings, "nothingScored"));
  return `${out.join("\n")}\n`;
}
