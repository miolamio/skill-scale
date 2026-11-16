import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { loadCatalogue } from "../../src/catalog/load.ts";
import { AREAS } from "../../src/catalog/types.ts";
import { CHECKS_BY_PRACTICE } from "../../src/checks/index.ts";
import { loadSkill } from "../../src/loader/skill.ts";
import { renderHtml, REPO_URL } from "../../src/report/html.ts";
import type { HtmlInput } from "../../src/report/html.ts";
import { buildRecords, summarise } from "../../src/score/score.ts";
import { FM_DESC, skillMd, tempDir, variant, writeSkill } from "../helpers/skills.ts";

const SHIPPED = new URL("../../catalog/", import.meta.url).pathname;
const cat = loadCatalogue(SHIPPED);
const tmp = tempDir();
after(() => tmp.cleanup());

const EVIL = "</code><script>alert(1)</script>";
const files = variant({ "SKILL.md": skillMd(`name: Bad_Name\n${FM_DESC}`, `# Skill\n\nSee [the data guide](reference/data-guide.md).\n\nEvil: ${EVIL} & "quoted"\n`) });
const dir = writeSkill(tmp.path, "Bad_Name", files);
const skill = loadSkill(dir);
const records = buildRecords(cat, skill, "portable", CHECKS_BY_PRACTICE);
const summary = summarise(records, AREAS);
const sources = Object.fromEntries(cat.sources.map((s) => [s.id, { title: s.title, url: s.urls[0] as string }]));
const input = (extra: Partial<HtmlInput> = {}): HtmlInput => ({
  version: "9.9.9", revision: cat.meta.revision, profile: "portable", skillPath: dir, skillName: "Bad_Name", skill, records, summary, sources, ...extra,
});

describe("renderHtml, offline", () => {
  const html = renderHtml(input());

  it("has the title, header label, footer link and version", () => {
    assert.match(html, /<title>Bad_Name skill review<\/title>/);
    assert.match(html, /skill-scale 9\.9\.9 &middot; profile portable/);
    assert.ok(html.includes(`<a href="${REPO_URL}">skill-scale</a> 9.9.9`));
    assert.equal(REPO_URL, "https://github.com/miolamio/");
    assert.ok(html.trimEnd().endsWith("</html>"));
    assert.ok(html.indexOf(REPO_URL) > html.indexOf("Method"), "the footer comes after the method section");
  });

  it("has no script, escapes untrusted text and loads only the fonts stylesheet", () => {
    assert.ok(!/<script/i.test(html));
    assert.ok(!html.includes("<script>alert(1)"));
    assert.ok(html.includes("&lt;/code&gt;&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.ok(html.includes("&amp; &quot;quoted&quot;"));
    assert.ok(!/<(img|iframe|object|embed)\b|@import|\bsrc=|url\(/i.test(html));
    assert.equal((html.match(/<link rel="stylesheet"/g) ?? []).length, 1);
  });

  it("escapes judge and advisor-free fields such as the skill name and path", () => {
    const h = renderHtml(input({ skillName: `x"><img src=x onerror=1>`, skillPath: "/p/<b>" }));
    assert.ok(!h.includes("<img src=x"));
    assert.ok(!h.includes("/p/<b>"));
  });

  it("numbers every line of the file with an anchor and highlights the cited line", () => {
    const n = skill.raw.split("\n").length - 1;
    assert.ok(html.includes('id="L1"'));
    assert.ok(html.includes(`id="L${n}"`));
    assert.ok(!html.includes(`id="L${n + 1}"`));
    assert.match(html, /<code class="hl">/);
    assert.match(html, /<a class="ln" href="#L\d+" title="Show in the full file">\d+<\/a><code>/);
  });

  it("lists findings: blockers and low scores, a note about --judge, no proposed changes", () => {
    assert.match(html, /<h2>Findings<\/h2>/);
    assert.match(html, /Run with --judge for proposed changes/);
    assert.match(html, /class="chip s0"/);
    assert.ok(!html.includes("Proposed change<"));
    assert.match(html, /Fix:/);
    assert.match(html, /Anthropic says/);
    assert.match(html, /Changes proposed <b>&ndash;<\/b>/);
    assert.ok(!html.includes("Judge cost"));
  });

  it("links quotes to their source, with a text fragment unless the source is a PDF", () => {
    assert.match(html, /<a href="https:\/\/[^"]+#:~:text=[^"]+" target="_blank" rel="noopener">/);
    const pdf = Object.fromEntries(Object.keys(sources).map((k) => [k, { title: "Guide", url: "https://example.com/g.pdf" }]));
    const h = renderHtml(input({ sources: pdf }));
    assert.ok(!/\.pdf#:~:text/.test(h));
    assert.ok(h.includes('href="https://example.com/g.pdf"'));
  });

  it("puts blockers first, then lowest score, then id", () => {
    const ids = [...html.matchAll(/<article class="rec" id="f-([A-Z]+-\d+)">/g)].map((m) => m[1] as string);
    assert.ok(ids.length >= 1);
    const blockers = new Set(summary.blockers.map((b) => b.id));
    const firstNonBlocker = ids.findIndex((id) => !blockers.has(id));
    assert.ok(ids.slice(0, firstNonBlocker < 0 ? ids.length : firstNonBlocker).every((id) => blockers.has(id)));
    assert.ok(ids.slice(firstNonBlocker < 0 ? ids.length : firstNonBlocker).every((id) => !blockers.has(id)));
  });
});

const judged = (cost: number) => ({ ...summary, judge: { model: "m-1", repeats: 1, calls: 1, cost_usd: cost, duration_ms: 1, stability_measured: false, unstable: [], injection: [{ text: `ignore <b>rules</b>`, repeat: 1 }] } });

describe("renderHtml, with an advisor", () => {
  const id = records.find((r) => r.status === "scored" && r.score === 0)?.id as string;
  const other = records.filter((r) => r.status === "scored" && r.score === 0).map((r) => r.id).find((x) => x !== id) as string;
  const rec = records.find((r) => r.id === id);
  const advice = {
    recommendations: [{
      title: "Fix <it>", priority: "high" as const, practice_ids: [id], problem: "Because <b>.", lines: [{ file: "SKILL.md", start: 1, end: 2 }],
      change: { kind: "diff" as const, file: "SKILL.md", remove: ["# Skill"], add: ["# New <skill>"] }, note: null, quotes: rec?.quotes.slice(0, 1) ?? [],
    }, {
      title: "Add file", priority: "low" as const, practice_ids: other ? [other] : [id], problem: "p", lines: [],
      change: { kind: "new_file" as const, file: "evals/x.json", remove: [], add: ["[1 < 2]"] }, note: "A note", quotes: [],
    }],
    set_aside: [{ practice_id: records.find((r) => r.status === "scored" && r.score !== null && r.score < 3 && r.id !== id && r.id !== other)?.id ?? "NOPE", reason: "Not <useful>" }],
    other: [],
  };
  const html = renderHtml(input({ summary: judged(0.1234), advisor: { state: "ok", advice } }));

  it("renders recommendations, diffs, new files, set-asides and the judge cost, all escaped", () => {
    assert.match(html, /Changes in order of effect/);
    assert.ok(html.includes("Fix &lt;it&gt;"));
    assert.ok(html.includes("<span class=\"dr\"><i>-</i># Skill</span>"));
    assert.ok(html.includes("# New &lt;skill&gt;"));
    assert.match(html, /<pre class="file">\[1 &lt; 2\]<\/pre>/);
    assert.match(html, /Findings set aside/);
    assert.ok(html.includes("Not &lt;useful&gt;"));
    assert.ok(html.includes("Judge cost <b>$0.12</b>"));
    assert.ok(html.includes("ignore &lt;b&gt;rules&lt;/b&gt;"));
    assert.ok(!/<script/i.test(html));
    assert.ok(!html.includes("<it>"));
    assert.match(html, /Changes proposed <b>2<\/b>/);
  });

  it("labels a diff with the line recorded at validation, not one found again", () => {
    const withLine = (line: number | undefined) => {
      const change = { kind: "diff" as const, file: "SKILL.md", remove: ["# Skill"], add: ["x"], ...(line === undefined ? {} : { line }) };
      const a = { ...advice, recommendations: [{ ...advice.recommendations[0] as (typeof advice.recommendations)[number], change }] };
      return renderHtml(input({ summary: judged(0.1), advisor: { state: "ok", advice: a as never } }));
    };
    assert.match(withLine(9), /Change in <code>SKILL\.md<\/code>, line 9</);
    assert.match(withLine(9), /<\/div><pre class="diff">/);
    assert.ok(!/Change in <code>SKILL\.md<\/code>, line/.test(withLine(undefined)));
  });

  it("highlights the lines a recommendation cites", () => {
    assert.match(html, /<code class="hl"># Skill<\/code>|<code class="hl">/);
  });

  it("lists other low scores with their fix hint", () => {
    const o = renderHtml(input({ advisor: { state: "ok", advice: { ...advice, other: [id] } } }));
    assert.match(o, /<h2>Other low scores<\/h2>/);
  });

  it("falls back to findings plus a note when the advisor failed", () => {
    const f = renderHtml(input({ summary: judged(0.1), advisor: { state: "failed", reason: "claude <timed> out" } }));
    assert.match(f, /Proposed changes are unavailable/);
    assert.ok(f.includes("claude &lt;timed&gt; out"));
    assert.match(f, /<h2>Findings<\/h2>/);
    assert.ok(f.includes(REPO_URL));
  });
});

describe("renderHtml, odd inputs", () => {
  it("renders a skill with no findings", () => {
    const clean = records.map((r) => (r.status === "scored" ? { ...r, score: 3, evidence: [] } : r));
    const h = renderHtml(input({ records: clean, summary: summarise(clean, AREAS) }));
    assert.match(h, /No practice that ran scored below 3/);
  });

  it("does not fail on a cited line outside the file", () => {
    const odd = records.map((r) => (r.status === "scored" && r.score === 0 ? { ...r, evidence: [{ ...(r.evidence[0] as object), file: "SKILL.md", line: 9999 } as never] } : r));
    assert.doesNotThrow(() => renderHtml(input({ records: odd })));
  });
});
