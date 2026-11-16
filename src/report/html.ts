import type { Advice, AdviceChange } from "../advisor/types.ts";
import { lowScoreRecords } from "../advisor/advisor.ts";
import { judgeFiles, numberedLines } from "../judge/prompt.ts";
import type { SkillModel } from "../loader/skill.ts";
import type { CriterionRecord, Summary } from "../score/score.ts";
import { REPORT_CSS } from "./html-style.ts";

export const REPO_URL = "https://github.com/miolamio/";
const FONTS = "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Condensed:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap";
const MAX_EXCERPT_ROWS = 30;
const OFFLINE_QUOTES = 2;

export type AdvisorState = { state: "ok"; advice: Advice } | { state: "failed"; reason: string };

export interface HtmlInput {
  version: string;
  revision: number;
  profile: string;
  skillPath: string;
  skillName: string;
  skill: SkillModel;
  records: CriterionRecord[];
  summary: Summary;
  /** Source id to title and page URL, from the catalogue. */
  sources: Record<string, { title: string; url: string }>;
  /** Absent when no advisor call was made (offline run, or no judged answer). */
  advisor?: AdvisorState;
}

export const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const plain = (q: string): string => q.replace(/[*`]/g, "");
const cell = (s: string): string => esc(s) || "&nbsp;";

/** Link to the source page; a text fragment jumps to the passage on pages that support it (not PDF). */
function sourceLink(ctx: Ctx, q: CriterionRecord["quotes"][number]): string {
  const src = ctx.input.sources[q.source];
  const sec = q.section ? ` &middot; ${esc(q.section)}` : "";
  if (!src || !/^https?:\/\//.test(src.url)) return `${esc(src?.title ?? q.source)}<span class="sec">${sec}</span>`;
  let href = src.url.split("#")[0] as string;
  if (!/\.pdf$/i.test(href)) href += `#:~:text=${encodeURIComponent(plain(q.text).split(/\s+/).filter(Boolean).slice(0, 8).join(" "))}`;
  return `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(src.title)}</a><span class="sec">${sec}</span>`;
}

const quoteBlocks = (ctx: Ctx, quotes: CriterionRecord["quotes"]): string =>
  quotes.map((q) => `<blockquote><p>${esc(plain(q.text))}</p><cite>${sourceLink(ctx, q)}</cite></blockquote>`).join("");

interface Ctx {
  input: HtmlInput;
  byId: Map<string, CriterionRecord>;
  files: Map<string, string[]>;
  skillFile: string;
  highlight: Set<number>;
  blockerIds: Set<string>;
}

function chip(ctx: Ctx, id: string): string {
  const r = ctx.byId.get(id);
  const score = r?.score ?? 0;
  const runs = r?.judge?.scores;
  const tip = `${id}: ${r?.title ?? ""}. Score ${score}${runs && runs.length > 0 ? ` (runs ${runs.join("/")})` : r?.judge ? "" : " (mechanical check)"}`;
  return `<span class="chip s${Math.min(3, Math.max(0, score))}" title="${esc(tip)}"><b>${score}</b> ${esc(id)}</span>`;
}

/** Numbered lines `start..end` of a file. Lines of the main skill file link to the viewer and are highlighted when `mark` is set. */
function excerpt(ctx: Ctx, file: string, start: number, end: number, mark: [number, number]): string {
  const lines = ctx.files.get(file);
  if (!lines || start < 1 || end < start || start > lines.length) return "";
  const last = Math.min(end, lines.length, start + MAX_EXCERPT_ROWS - 1);
  const main = file === ctx.skillFile;
  if (main) for (let i = mark[0]; i <= mark[1]; i++) ctx.highlight.add(i);
  let rows = "";
  for (let i = start; i <= last; i++) {
    const n = main ? `<a class="ln" href="#L${i}" title="Show in the full file">${i}</a>` : `<span class="ln">${i}</span>`;
    rows += `${n}<code>${cell(lines[i - 1] as string)}</code>`;
  }
  const where = main ? "" : `<div class="where">${esc(file)}, line${start === end ? "" : "s"} ${start}${end > start ? `&ndash;${last}` : ""}</div>`;
  return `${where}<div class="code">${rows}</div>${last < end ? `<p class="note">Showing ${last - start + 1} of ${end - start + 1} lines.</p>` : ""}`;
}

function changeBlock(ctx: Ctx, c: AdviceChange): string {
  const rows = (sign: string, cls: string, xs: string[]): string => xs.map((t) => `<span class="${cls}"><i>${sign}</i>${cell(t)}</span>`).join("");
  if (c.kind === "diff") {
    let where = `Change in <code>${esc(c.file)}</code>`;
    if (c.line !== undefined) where += c.remove.length > 1 ? `, lines ${c.line}&ndash;${c.line + c.remove.length - 1}` : `, line ${c.line}`;
    return `<div class="where">${where}</div><pre class="diff">${rows("-", "dr", c.remove)}${rows("+", "da", c.add)}</pre>`;
  }
  if (c.kind === "add") {
    const at = c.after_line === 0 ? `the top of <code>${esc(c.file)}</code>` : `<code>${esc(c.file)}</code> after line ${c.after_line}`;
    return `<div class="where">Add at ${at}</div><pre class="diff">${rows("+", "da", c.add)}</pre>`;
  }
  return `<div class="where">New file <code>${esc(c.file)}</code></div><pre class="file">${esc(c.add.join("\n"))}</pre>`;
}

/** The first piece of evidence that points at a line of a file we hold, shown with one line of context each side. */
function evidenceExcerpt(ctx: Ctx, r: CriterionRecord, context: number): string {
  const e = r.evidence.find((f) => f.file !== null && f.line !== null && ctx.files.has(f.file) && f.line >= 1 && f.line <= (ctx.files.get(f.file) as string[]).length);
  if (!e) return "";
  const line = e.line as number;
  const n = (ctx.files.get(e.file as string) as string[]).length;
  return excerpt(ctx, e.file as string, Math.max(1, line - context), Math.min(n, line + context), [line, line]);
}

const sortedQuotes = (r: CriterionRecord): CriterionRecord["quotes"] => [...r.quotes].sort((a, b) => Number(a.older) - Number(b.older));

function findingCard(ctx: Ctx, r: CriterionRecord): string {
  const ex = evidenceExcerpt(ctx, r, 1);
  const quotes = sortedQuotes(r).slice(0, OFFLINE_QUOTES);
  const blocker = ctx.blockerIds.has(r.id);
  const message = r.evidence[0]?.message ?? r.reason ?? "";
  return `<article class="rec" id="f-${esc(r.id)}">
  <div class="rhead">${blocker ? '<span class="pri p-high">blocker</span>' : ""}<h3>${esc(r.id)} &middot; ${esc(r.title)}</h3></div>
  <div class="chips">${chip(ctx, r.id)}</div>
  ${message ? `<p>${esc(message)}</p>` : ""}
  ${ex ? `<div class="label">In the skill</div>${ex}` : ""}
  ${quotes.length > 0 ? `<div class="label">Anthropic says</div>${quoteBlocks(ctx, quotes)}` : ""}
  ${r.fix_hint ? `<p class="note"><b>Fix:</b> ${esc(r.fix_hint)}</p>` : ""}
</article>`;
}

function renderFindings(ctx: Ctx, low: CriterionRecord[], intro: string): string {
  const body = low.length === 0 ? '<p class="note">No practice that ran scored below 3.</p>' : low.map((r) => findingCard(ctx, r)).join("\n");
  return `<section class="rejs"><h2>Findings</h2>${intro}${body}</section>`;
}

function renderAdvice(ctx: Ctx, advice: Advice): string {
  const recs = advice.recommendations;
  const cards = recs.map((r, i) => {
    const ex = r.lines.map((l) => excerpt(ctx, l.file, l.start, l.end, [l.start, l.end])).join("");
    return `<article class="rec" id="rec-${i + 1}">
  <div class="rhead"><span class="pri p-${r.priority}">${r.priority}</span><h3>${i + 1}. ${esc(r.title)}</h3></div>
  <div class="chips">${r.practice_ids.map((id) => chip(ctx, id)).join("")}</div>
  ${r.problem ? `<p>${esc(r.problem)}</p>` : ""}
  ${ex ? `<div class="label">In the skill</div>${ex}` : ""}
  ${r.quotes.length > 0 ? `<div class="label">Anthropic says</div>${quoteBlocks(ctx, r.quotes)}` : ""}
  ${r.change ? `<div class="label">Proposed change</div>${changeBlock(ctx, r.change)}` : ""}
  ${r.note ? `<p class="note">${esc(r.note)}</p>` : ""}
</article>`;
  });
  const summaryRows = recs.map((r, i) => `<tr><td><span class="pri p-${r.priority}">${r.priority}</span></td><td><a href="#rec-${i + 1}">${esc(r.title)}</a></td><td class="mono">${esc(r.practice_ids.join(", "))}</td></tr>`).join("");
  let html = recs.length === 0
    ? '<section class="rejs"><h2>Changes in order of effect</h2><p class="note">The advisor proposed no change that survived verification.</p></section>'
    : `<section style="display:grid;gap:10px"><h2>Changes in order of effect</h2><table class="summary">${summaryRows}</table><p class="note">Score chips show the practice and its score, 0 to 3. Hover a chip for the practice name and the judge runs. Line numbers open the line in the full file. The proposed text is a draft to edit; a change whose removed lines did not match the file was dropped.</p></section>\n${cards.join("\n")}`;
  if (advice.set_aside.length > 0) {
    const rej = advice.set_aside.map((s) => {
      const r = ctx.byId.get(s.practice_id);
      const ex = r ? evidenceExcerpt(ctx, r, 0) : "";
      return `<article class="rej"><div class="chips">${chip(ctx, s.practice_id)} <strong>${esc(r?.title ?? "")}</strong></div><p>${esc(s.reason)}</p>${ex}</article>`;
    });
    html += `\n<section class="rejs"><h2>Findings set aside</h2><p class="note">The scorer sees one skill at a time. These scores are not wrong by the anchors, but the advisor judged that the change they point to would not make this skill better.</p>${rej.join("\n")}</section>`;
  }
  if (advice.other.length > 0) {
    const items = advice.other.map((id) => {
      const r = ctx.byId.get(id);
      return `<li>${chip(ctx, id)}${esc(r?.title ?? "")}${r?.fix_hint ? `<br><span class="note">Fix: ${esc(r.fix_hint)}</span>` : ""}</li>`;
    });
    html += `\n<section class="rejs"><h2>Other low scores</h2><ul class="others">${items.join("")}</ul></section>`;
  }
  return html;
}

function method(input: HtmlInput, advisor: AdvisorState | undefined): string {
  const j = input.summary.judge;
  const parts = [`Scores come from skill-scale ${esc(input.version)}, catalogue revision ${input.revision}, profile ${esc(input.profile)}.`];
  if (!j) parts.push("This is the offline run: mechanical checks only, nothing was sent anywhere. Practices that need judgement were not scored.");
  else parts.push(`Judgement practices were scored by ${esc(j.model)}, ${j.repeats} ${j.repeats === 1 ? "run" : "runs"}, median.${advisor?.state === "ok" ? " The proposed changes come from one more call to the same model; the model never supplies the Anthropic quotes shown." : ""}`);
  parts.push("Anthropic quotes come from the tool's catalogue, where each is checked against its source page. Anchors and fix hints are the tool's inference, not Anthropic's words.");
  return `<section class="foot"><h2 style="color:var(--ink)">Method</h2><p>${parts.join(" ")}</p></section>`;
}

export function renderHtml(input: HtmlInput): string {
  const { skill, summary } = input;
  const files = new Map(judgeFiles(skill).map((f) => [f.path, numberedLines(f.text)]));
  const blockerIds = new Set([...summary.blockers.map((b) => b.id), ...summary.security_blockers.map((b) => b.id)]);
  const ctx: Ctx = { input, byId: new Map(input.records.map((r) => [r.id, r])), files, skillFile: skill.skillFileName, highlight: new Set(), blockerIds };
  const low = lowScoreRecords(input.records, blockerIds);
  const j = summary.judge;
  const advisor = input.advisor;

  let main: string;
  if (advisor?.state === "ok") main = renderAdvice(ctx, advisor.advice);
  else {
    const note =
      advisor?.state === "failed"
        ? `<p class="note warn">Proposed changes are unavailable: the advisor call failed (${esc(advisor.reason)}). The findings below are the judge's scores with their evidence.</p>`
        : j
          ? '<p class="note">Proposed changes were not generated for this run.</p>'
          : '<p class="note">Each card is a practice that scored 0 to 2, with the lines it points at and what Anthropic says. Run with --judge for proposed changes.</p>';
    main = renderFindings(ctx, low, note);
  }
  if (j && j.injection.length > 0) {
    main += `\n<section class="rejs"><h2>Judge notes</h2>${j.injection.map((i) => `<p class="note warn">The skill tried to instruct the reviewer (run ${i.repeat}): ${esc(i.text)}</p>`).join("")}</section>`;
  }

  const adviceOk = advisor?.state === "ok" ? advisor.advice : null;
  const facts = [
    `Practices scored <b>${summary.scored}</b>`,
    `Blockers <b>${summary.blockers.length + summary.security_blockers.length}</b>`,
    `Changes proposed <b>${adviceOk ? adviceOk.recommendations.length : "&ndash;"}</b>`,
    `Findings set aside <b>${adviceOk ? adviceOk.set_aside.length : "&ndash;"}</b>`,
    ...(j ? [`Judge cost <b>$${j.cost_usd.toFixed(2)}</b>`] : []),
  ];
  const mainLines = files.get(skill.skillFileName) ?? [];
  const full = mainLines.map((t, i) => `<a class="ln" id="L${i + 1}" href="#L${i + 1}">${i + 1}</a><code class="${ctx.highlight.has(i + 1) ? "hl" : ""}">${cell(t)}</code>`).join("");
  const name = esc(input.skillName);
  const intro = j
    ? `Mechanical checks plus the judge's scores${adviceOk ? " and the advisor's proposed edits" : ""} for ${name}. Scores run from 0 to 3.`
    : `Mechanical checks for ${name}. Scores run from 0 to 3; practices that need judgement were not scored.`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${name} skill review</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="label">skill-scale ${esc(input.version)} &middot; profile ${esc(input.profile)} &middot; ${esc(input.skillPath)}</div>
    <h1>${name} skill review</h1>
    <p>${intro}</p>
    <div class="facts">${facts.map((f) => `<span>${f}</span>`).join("")}</div>
  </header>

  <div class="cols">
    <div class="main">
      ${main}
      ${method(input, advisor)}
    </div>

    <aside>
      <div class="aside-head"><h2>${esc(skill.skillFileName)}</h2><span class="label">highlighted lines are cited</span></div>
      <div class="full-wrap"><div class="full">${full}</div></div>
    </aside>
  </div>

  <footer class="foot"><p><a href="${REPO_URL}">skill-scale</a> ${esc(input.version)}</p></footer>
</div>
</body>
</html>
`;
}
