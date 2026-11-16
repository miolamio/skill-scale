import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { htmlToText } from "../../src/catalog/fetcher.ts";
import type { Fetcher } from "../../src/catalog/fetcher.ts";
import { normaliseForMatch } from "../../src/catalog/normalise.ts";
import type { Catalogue, Practice, Source } from "../../src/catalog/types.ts";
import { verifyCatalogue } from "../../src/catalog/verify.ts";

const practice = (id: string, quotes: Practice["quotes"]): Practice => ({
  id, area: "META", title: id, strength: "directive", strength_word: "Keep", strength_source: "A", profiles: ["claude-code"], assess: ["mechanical"], assessable_from: "artifact",
  freshness: "recent", contested: false, experimental: false, quotes,
});
const source = (id: string, urls: string[], extra: Partial<Source> = {}): Source => ({ id, tier: "A", urls, title: id, version_evidence: "", verify: "auto", ...extra });

const cat = (): Catalogue => ({
  meta: { revision: 5, research_date: "2026-11-05" },
  load_facts: [],
  sources: [source("A", ["https://a.test/1", "https://a.test/2"]), source("B", ["https://b.test/1"]), source("P", [], { verify: "skip", skip_reason: "a PDF" })],
  practices: [
    practice("META-01", [{ text: "Keep it under 500 lines.", source: "A", section: "s" }, { text: "Always use forward slashes", source: "B", section: "s" }]),
    practice("META-02", [{ text: "Text from the PDF guide", source: "P", section: "p.1" }]),
  ],
});

const pages = (map: Record<string, string>): Fetcher => async (url) => {
  const text = map[url];
  if (text === undefined) throw new Error("HTTP 404");
  return text;
};

describe("normaliseForMatch", () => {
  it("folds typographic quotes, drops backticks, bold markers and escapes, and collapses whitespace", () => {
    assert.equal(normaliseForMatch("It’s  **very**\n `ok` \\_ “done”"), 'It\'s very ok _ "done"');
    assert.equal(normaliseForMatch("a\\*b \\`c\\`"), "a*b c");
  });
  it("keeps case", () => assert.notEqual(normaliseForMatch("Must"), normaliseForMatch("must")));
});

describe("normaliseForMatch links", () => {
  it("reads a Markdown link as its text", () => {
    assert.equal(normaliseForMatch("Keep [reference files](#file-references) focused."), "Keep reference files focused.");
  });
});

describe("htmlToText inline tags", () => {
  it("joins text across inline tags without inventing spaces before punctuation", () => {
    assert.equal(htmlToText("<p>folder <code>synced</code>, in any <a href=\"/x\">capitalization</a>.</p>").replace(/\s+/g, " ").trim(), "folder synced, in any capitalization.");
  });
  it("still separates block elements", () => {
    assert.equal(htmlToText("<p>one</p><p>two</p>").replace(/\s+/g, " ").trim(), "one two");
  });
});

describe("htmlToText", () => {
  it("drops scripts and tags and decodes entities", () => {
    assert.equal(htmlToText("<p>Use <code>a &lt; b</code> &amp; c&nbsp;d</p><script>var x=1</script>").replace(/\s+/g, " ").trim(), "Use a < b & c d");
  });
});

describe("normaliseForMatch emphasis markers (SKM-32)", () => {
  const n = normaliseForMatch;
  it("strips emphasis markers next to words", () => {
    assert.equal(n("a **bold** word"), "a bold word");
    assert.equal(n("*it* and ***both***."), "it and both.");
    assert.equal(n('**"quoted"** text'), '"quoted" text');
  });
  it("keeps a star between two word characters", () => {
    assert.equal(n("2*3"), "2*3");
    assert.notEqual(n("2*3"), n("23"));
  });
  it("keeps a star standing alone between spaces", () => {
    assert.equal(n("a * b"), "a * b");
    assert.notEqual(n("a * b"), n("a b"));
  });
  it("keeps stars inside inline code and drops the backticks", () => {
    assert.equal(n("use `a*b` and `**/*.md`"), "use a*b and **/*.md");
  });
  it("keeps an escaped star as a literal star", () => {
    assert.equal(n("a\\*b"), "a*b");
  });
  it("leaves underscores alone", () => {
    assert.equal(n("snake_case and _x_"), "snake_case and _x_");
  });
  it("reads an image as its alt text", () => {
    assert.equal(n("see ![diagram](img/x.png) here"), "see diagram here");
    assert.equal(n("a [link](u) b"), "a link b");
  });
});

describe("normaliseForMatch list bullets and paired stars (SKM-32 follow-up)", () => {
  const n = normaliseForMatch;
  it("drops a line-leading star bullet", () => {
    assert.equal(n("* list item"), "list item");
    assert.equal(n("intro\n* one\n  * two"), "intro one two");
    assert.equal(n("* a *b* c"), "a b c");
  });
  it("strips balanced emphasis inside words", () => {
    assert.equal(n("**a**b"), "ab");
    assert.equal(n("a**b**"), "ab");
    assert.equal(n("*it*s"), "its");
    assert.equal(n("_*x*_"), "_x_");
  });
  it("keeps unpaired or spaced stars", () => {
    assert.equal(n("2*3"), "2*3");
    assert.equal(n("a * b"), "a * b");
    assert.equal(n("a ** b"), "a ** b");
    assert.equal(n("a * b * c"), "a * b * c");
    assert.equal(n("**/*.md"), "**/*.md");
  });
  it("treats a star after an escaped backslash as markup", () => {
    assert.equal(n("\\\\*x*"), "\\x");
    assert.equal(n("\\*x\\*"), "*x*");
  });
});

describe("htmlToText adjacent inline tags (SKM-32)", () => {
  const t = (h: string) => htmlToText(h).replace(/\s+/g, " ").trim();
  it("separates two inline elements that touch", () => {
    assert.equal(t("<b>one</b><b>two</b>"), "one two");
    assert.equal(t('<a href="/x">one</a><code>two</code>'), "one two");
  });
  it("does not split a word that is partly styled", () => {
    assert.equal(t("wor<b>d</b>"), "word");
    assert.equal(t("<b>wor</b>d"), "word");
  });
  it("does not add a space before punctuation", () => {
    assert.equal(t("<code>x</code>, <b>y</b>."), "x, y.");
  });
  it("does not split syntax-highlighting spans", () => {
    assert.equal(t("<span>foo</span><span>(</span><span>1</span>"), "foo(1");
  });
});

describe("verifyCatalogue", () => {
  it("passes when every quote is an exact substring (after normalisation), skipping skipped sources", async () => {
    const r = await verifyCatalogue(cat(), pages({ "https://a.test/1": "x", "https://a.test/2": "Keep it **under 500 lines**.", "https://b.test/1": "Always use forward slashes in paths" }));
    assert.deepEqual(r.counts, { ok: 2, changed: 0, unverified: 0, skipped: 1 });
    assert.equal(r.exitCode, 0);
    assert.deepEqual(r.sources.map((s) => [s.id, s.status]), [["A", "ok"], ["B", "ok"], ["P", "skipped"]]);
  });
  it("reports a changed quote and exits 1, without rewriting anything", async () => {
    const c = cat();
    const before = JSON.stringify(c);
    const r = await verifyCatalogue(c, pages({ "https://a.test/1": "Keep it under 400 lines.", "https://a.test/2": "y", "https://b.test/1": "Always use forward slashes" }));
    assert.equal(r.counts.changed, 1);
    assert.equal(r.quotes.find((q) => q.status === "changed")?.practice, "META-01");
    assert.equal(r.exitCode, 1);
    assert.equal(JSON.stringify(c), before);
  });
  it("treats a failed fetch as infrastructure: quotes not found are unverified and the exit code is 2", async () => {
    const r = await verifyCatalogue(cat(), pages({ "https://a.test/1": "Keep it under 500 lines.", "https://a.test/2": "z" }));
    assert.deepEqual(r.sources.map((s) => [s.id, s.status]), [["A", "ok"], ["B", "failed"], ["P", "skipped"]]);
    assert.equal(r.counts.unverified, 1);
    assert.equal(r.exitCode, 2);
  });
  it("does not call a quote changed when one of its source's pages could not be read", async () => {
    const r = await verifyCatalogue(cat(), pages({ "https://a.test/1": "nothing here", "https://b.test/1": "Always use forward slashes" }));
    assert.equal(r.sources[0]?.status, "partial");
    assert.equal(r.counts.changed, 0);
    assert.equal(r.counts.unverified, 1);
    assert.equal(r.exitCode, 2);
  });
  it("never passes when nothing was verified", async () => {
    const c = cat();
    c.sources = c.sources.map((s) => ({ ...s, verify: "skip" as const, skip_reason: "test" }));
    const r = await verifyCatalogue(c, pages({}));
    assert.equal(r.counts.ok + r.counts.changed, 0);
    assert.equal(r.exitCode, 2);
  });
  it("can be limited to one source", async () => {
    const r = await verifyCatalogue(cat(), pages({ "https://b.test/1": "Always use forward slashes" }), { only: "B" });
    assert.deepEqual(r.sources.map((s) => s.id), ["B"]);
    assert.equal(r.exitCode, 0);
  });
});
