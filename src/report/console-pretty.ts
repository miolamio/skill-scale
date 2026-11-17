import { describeSkipped } from "../loader/files.ts";
import type { ConsoleReport } from "./console.ts";
import { judgeLines, layersText, markerFor, notFullText, selectLowest, where } from "./console.ts";
import { t } from "./strings.ts";
import { bold, cyan, dim, ellipsizePath, green, red, visibleWidth, wrap, yellow } from "./term.ts";

export interface PrettyOptions {
  width: number;
  home: string;
  /** Defaults to true; false gives the same layout with no escape codes. */
  color?: boolean;
}

const BAR_WIDTH = 15;

/** Same facts and order as renderConsole, laid out for a terminal. */
export function renderConsolePretty(report: ConsoleReport, opts: PrettyOptions): string {
  const { ctx, records, summary, strings } = report;
  const c = opts.color ?? true;
  const width = opts.width;
  const out: string[] = [];
  const marker = markerFor(records, strings);

  /** Wrap `text` under a styled prefix; `style` is applied to each wrapped text line. */
  const block = (prefix: string, text: string, indent: number, style: (s: string) => string = (s) => s): void => {
    const lead = " ".repeat(visibleWidth(prefix));
    const lines = wrap(text, width, indent, lead);
    lines.forEach((l, i) => {
      const body = l.slice(i === 0 ? lead.length : indent);
      out.push((i === 0 ? prefix : " ".repeat(indent)) + style(body));
    });
  };
  const note = (text: string, indent: number): void => block(" ".repeat(indent), text, indent, (s) => dim(s, c));

  const home = opts.home.replace(/\/+$/, "");
  const path = home !== "" && (ctx.skillPath === home || ctx.skillPath.startsWith(`${home}/`)) ? `~${ctx.skillPath.slice(home.length)}` : ctx.skillPath;
  const name = ctx.skillName ?? ctx.skillPath.split("/").filter(Boolean).pop() ?? ctx.skillPath;

  out.push(`${cyan("◢◤", c)} ${bold(`skill-scale ${ctx.version}`, c)}${dim(` · r${ctx.revision} · ${ctx.profile}`, c)}`);
  const lead = `${name}  →  `;
  out.push("", `${bold(name, c)}  →  ${ellipsizePath(path, width - visibleWidth(lead))}`);
  out.push("");

  const headline = `${summary.scored} of ${summary.total} scored · ${layersText(summary)}`;
  out.push(...wrap(headline, width, 0));
  if (summary.experimental > 0) out.push(...wrap(t(strings, "headlineExperimental", { experimental: summary.experimental }), width, 0).map((l) => dim(l, c)));
  const nf = notFullText(summary, strings);
  if (nf !== "") out.push(...wrap(nf, width, 0).map((l) => dim(l, c)));
  out.push("");

  out.push(bold(t(strings, "areas"), c));
  for (const a of summary.areas) {
    if (a.assessable === 0 && a.process === 0 && a.not_applicable === 0) continue;
    let barText: string;
    let mean: string;
    if (a.mean === null) {
      barText = dim("·".repeat(BAR_WIDTH), c);
      mean = dim("—".padStart(4), c);
    } else {
      const filled = Math.round((a.mean / 3) * BAR_WIDTH);
      const paint = a.mean >= 3 ? green : a.mean >= 1 ? yellow : red;
      barText = paint("█".repeat(filled) + "░".repeat(BAR_WIDTH - filled), c);
      mean = paint(a.mean.toFixed(2), c);
    }
    const process = a.process > 0 ? dim(` · ${a.process} for the checklist`, c) : "";
    out.push(`  ${a.area.padEnd(7)}${barText}  ${mean}  ${`${a.scored}/${a.assessable}`.padStart(5)}${process}`);
  }

  const judge = summary.judge;
  if (judge) {
    out.push("");
    const lines = judgeLines(judge, strings);
    out.push(...wrap(lines[0] as string, width, 0));
    for (const l of lines.slice(1)) out.push(...wrap(l, width, 0).map((x) => dim(x, c)));
  }

  const noneAtAll = summary.blockers.length === 0 && summary.security_blockers.length === 0;
  if (summary.blockers.length > 0 || noneAtAll) out.push("", bold(t(strings, "blockers"), c));
  if (noneAtAll) out.push(`  ${green(`✓ ${t(strings, "noBlockers").replace(/\.$/, "")}`, c)}`);
  const mark = `  ${red("✗", c)} `;
  for (const b of summary.blockers) {
    block(`${mark}${bold(b.id, c)} `, `${b.title}${marker(b.id)}: ${b.reason}${where(b.file, b.line)}`, 4);
    if (b.kind === "effect") note(t(strings, "effect", { effect: b.effect ?? "", lb: b.lb.join(", ") }), 4);
  }
  if (summary.security_blockers.length > 0) {
    out.push("", bold(t(strings, "securityBlockers"), c));
    for (const b of summary.security_blockers) {
      block(`${mark}${bold(b.id, c)} `, `${b.title}: ${b.reason}${where(b.file, b.line)}`, 4);
      note(t(strings, "risk", { risk: b.risk }), 4);
    }
  }
  if (summary.suppressed_security.length > 0) {
    out.push("", bold(t(strings, "suppressedSecurity"), c));
    for (const b of summary.suppressed_security) block("  ", `${b.id}${where(b.file, b.line)}: ${t(strings, "suppressedReason", { reason: b.reason })}`, 4, (s) => dim(s, c));
  }
  if (judge && judge.injection.length > 0) {
    out.push("", bold(t(strings, "judgeNotes"), c));
    for (const i of judge.injection) block("  ", t(strings, "judgeNote", { text: i.text }), 4);
  }

  const lowest = selectLowest(records);
  out.push("", bold(t(strings, "lowest"), c));
  if (lowest.length === 0) out.push(`  ${green(t(strings, "noLowest"), c)}`);
  for (const r of lowest) {
    const e = r.evidence[0];
    const sign = (r.score ?? 0) < 1 ? red(`✗ ${r.score}`, c) : yellow(`▲ ${r.score}`, c);
    block(`  ${sign} ${bold(r.id, c)} `, `${r.title}${marker(r.id)}${where(e?.file ?? null, e?.line ?? null)}`, 6);
    if (e) block(" ".repeat(6), e.message, 6);
    if (r.judge?.quote) block(" ".repeat(6), `"${r.judge.quote}"`, 6);
    if (r.fix_hint) block(`${" ".repeat(6)}${dim("→", c)} `, r.fix_hint, 8);
  }

  out.push("");
  const dimLines = (text: string): void => void out.push(...wrap(text, width, 0).map((l) => dim(l, c)));
  dimLines(`Not scored: ${[`${summary.not_run} not run`, `${summary.contested} contested`, `${summary.not_applicable} not applicable`, `${summary.process} process items for the checklist`].join(" · ")}`);
  if (summary.stale_unconfirmed.length > 0) dimLines(t(strings, "staleCount", { count: summary.stale_unconfirmed.length, ids: summary.stale_unconfirmed.join(", ") }));
  const skipped = ctx.skippedFiles ?? [];
  if (skipped.length > 0) dimLines(t(strings, "notScanned", { files: skipped.map(describeSkipped).join(", ") }));
  dimLines(t(strings, "inference"));
  if (summary.scored === 0) out.push(bold(red(t(strings, "nothingScored"), c), c));
  return `${out.join("\n")}\n`;
}
