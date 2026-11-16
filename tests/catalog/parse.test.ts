import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parseCountsTable, parseLoadFacts, parsePractices, parseSources } from "../../tools/catalogue/parse-research.ts";

const md = readFileSync(new URL("../fixtures/research-sample.md", import.meta.url), "utf8");

describe("parseSources", () => {
  it("reads tier, absolute URLs and version evidence from the register tables", () => {
    const s = parseSources(md);
    assert.deepEqual(s.map((x) => [x.id, x.tier]), [["BP", "A"], ["CC", "A"], ["THQ", "B-recent"], ["PDF", "B-older"], ["SB", "C"]]);
    assert.deepEqual(s[1]?.urls, ["https://example.test/cc"]);
    assert.deepEqual(s[2]?.urls, ["https://example.test/thq"]);
    assert.equal(s[0]?.versionEvidence, "no date; 42,405 bytes");
  });
});

describe("parsePractices", () => {
  const ids = new Set(parseSources(md).map((s) => s.id));
  const ps = parsePractices(md, ids);
  it("finds the entries and their fields", () => {
    assert.deepEqual(ps.map((p) => p.id), ["META-01", "DESC-06", "PROC-01"]);
    const m = ps[0]!;
    assert.equal(m.title, "Name length and characters");
    assert.deepEqual(m.assessCodes, ["M"]);
    assert.deepEqual(m.scopeTokens, ["CC", "API", "AI", "SPEC"]);
    assert.equal(m.freshness, "recent");
    assert.equal(m.assessableFrom, "artifact");
  });
  it("strips the qualifier from the title and reads contested and Class", () => {
    const d = ps[1]!;
    assert.equal(d.title, "Phrase the description as an instruction");
    assert.equal(d.contested, true);
    assert.deepEqual(d.strengths, [{ scope: "all", cls: "DIRECTIVE", word: "Use", source: "THQ" }]);
    assert.equal(ps[0]?.contested, false);
  });
  it("reads profile-prefixed Strength lines", () => {
    assert.deepEqual(ps[0]!.strengths.map((l) => [l.scope, l.cls, l.word, l.source]), [["claude-code", "STATEMENT", "are ignored", "CC"], ["portable", "MUST", "Must", "BP"]]);
  });
  it("extracts only quotes that are followed by a known citation", () => {
    const q = ps[0]!.quotes.map((x) => `${x.source}|${x.section}|${x.text}|${x.older}`);
    assert.deepEqual(q, [
      "CC|Frontmatter|Names longer than 256 characters are ignored|false",
      "BP|name field|Must be 1-64 characters|false",
      "BP|Skill structure note|Maximum 64 characters|false",
      "BP|Skill structure note|Must contain only lowercase letters|false",
      "PDF|p.10|Use kebab-case: notion-project-setup|true",
    ]);
  });
});

describe("parseCountsTable", () => {
  it("reads one table per profile, with the strength columns", () => {
    const t = parseCountsTable(md);
    assert.deepEqual(t["claude-code"].map((r) => r.area), ["META", "DESC", "PROC"]);
    assert.deepEqual(t["claude-code"][2], { area: "PROC", practices: 1, must: 0, directive: 0, suggestion: 0, statement: 1, artifact: 0, run: 0, process: 1, recent: 0, undatedLive: 1, staleUnconfirmed: 0 });
    assert.equal(t.portable[0]?.must, 1);
  });
});

describe("parseLoadFacts", () => {
  it("reads the rows of the section 2.12 table", () => {
    const rows = parseLoadFacts(md);
    assert.deepEqual(rows.map((r) => [r.id, r.stops]), [["LB-01", "load"], ["LB-09", "nothing stops loading; fields are not read"]]);
    assert.match(rows[0]?.quote ?? "", /refuses its directory or file name/);
  });
  it("fails when the research file has no section 2.12", () => {
    assert.throws(() => parseLoadFacts(md.replace("### 2.12", "### 2.13")), /section 2\.12 not found/);
  });
});
