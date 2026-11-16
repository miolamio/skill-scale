import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { BuildError, buildCatalogue, deriveAssess, deriveProfiles } from "../../tools/catalogue/build.ts";
import type { Overlays } from "../../tools/catalogue/build.ts";

const md = readFileSync(new URL("../fixtures/research-sample.md", import.meta.url), "utf8");
const overlays = (): Overlays => ({ overrides: {}, quotes: {}, sources: {}, practices: {} });

describe("derivations", () => {
  it("derives profiles from the Scope tokens", () => {
    assert.deepEqual(deriveProfiles([]), ["claude-code", "portable"]);
    assert.deepEqual(deriveProfiles(["CC"]), ["claude-code"]);
    assert.deepEqual(deriveProfiles(["SPEC", "AI"]), ["portable"]);
    assert.deepEqual(deriveProfiles(["CC", "API"]), ["claude-code", "portable"]);
  });
  it("derives assess kinds, falling back to assessable_from", () => {
    assert.deepEqual(deriveAssess(["M", "J"], "artifact"), ["mechanical", "judgement"]);
    assert.deepEqual(deriveAssess(["X"], "run"), ["live"]);
    assert.deepEqual(deriveAssess(["process"], "process"), ["judgement"]);
    assert.deepEqual(deriveAssess([], "run"), ["live"]);
  });
});

describe("buildCatalogue", () => {
  it("builds records that agree with section 2.11", () => {
    const built = buildCatalogue(md, overlays());
    assert.equal(built.meta.revision, 5);
    assert.equal(built.meta.research_date, "2026-11-05");
    const ps = built.practices;
    assert.deepEqual(ps.map((p) => [p.id, p.strength, p.strength_word, p.contested, p.freshness]), [
      ["META-01", "statement", "are ignored", false, "recent"],
      ["DESC-06", "directive", "Use", true, "stale-unconfirmed"],
      ["PROC-01", "statement", "land below", false, "undated-live"],
    ]);
    assert.deepEqual(ps[0]?.profiles, ["claude-code", "portable"]);
    assert.deepEqual(ps[0]?.profile_rules, { portable: { strength: "must", strength_word: "Must", strength_source: "BP" } });
    assert.equal(ps[1]?.profile_rules, undefined);
  });
  it("carries the LB facts of section 2.12 into the catalogue", () => {
    const built = buildCatalogue(md, overlays());
    assert.deepEqual(built.load_facts.map((f) => f.id), ["LB-01", "LB-09"]);
    assert.throws(() => buildCatalogue(md.replace("### 2.12", "### 2.13"), overlays()), /section 2\.12 not found/);
  });
  it("is repeatable: two builds give the same records", () => {
    assert.deepEqual(buildCatalogue(md, overlays()), buildCatalogue(md, overlays()));
  });
  it("merges authored content and marks it as inference", () => {
    const o = overlays();
    o.practices["META-01"] = { anchors: { "0": "bad", "3": "good" }, fix_hint: "Fix it." };
    const p = buildCatalogue(md, o).practices[0]!;
    assert.deepEqual(p.anchors, { "0": "bad", "3": "good" });
    assert.equal(p.inferred, true);
  });
  it("fails when an entry has no Strength line, when an overlay names an unknown practice, authors a strength, or counts disagree", () => {
    const noLine = md.replace('Strength: DIRECTIVE; word: "Use"; source: THQ\n', "");
    assert.throws(() => buildCatalogue(noLine, overlays()), (e: unknown) => e instanceof BuildError && e.problems.some((p) => p.startsWith("DESC-06: the research entry has no Strength line")));
    const o3 = overlays();
    o3.practices["META-01"] = { profile_rules: { portable: { strength: "must" } } };
    assert.throws(() => buildCatalogue(md, o3), /strength is authored/);
    const o2 = overlays();
    o2.practices["NOPE-01"] = { fix_hint: "x" };
    assert.throws(() => buildCatalogue(md, o2), /unknown practice NOPE-01/);
    const broken = md.replace("| META | 1 | 0 |", "| META | 2 | 0 |");
    assert.throws(() => buildCatalogue(broken, overlays()), /claude-code META: practices is 1 but section 2.11 says 2/);
    const wrongStrength = md.replace("| META | 1 | 1 | 0 | 0 | 0 |", "| META | 1 | 0 | 1 | 0 | 0 |");
    assert.throws(() => buildCatalogue(wrongStrength, overlays()), /portable META: must is 1 but section 2.11 says 0/);
  });
  it("lets an override replace the derived profiles and requires a source overlay for a source with no URL", () => {
    const o = overlays();
    o.overrides["META-01"] = { profiles: ["portable"], reason: "test" };
    assert.deepEqual(buildCatalogue(md, o).practices[0]?.profiles, ["portable"]);
    const noUrl = md.replace("https://example.test/guide.pdf", "none");
    assert.throws(() => buildCatalogue(noUrl, overlays()), /source PDF has no URL/);
  });
});
