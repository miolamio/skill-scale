import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateAuthored, validatePractices, validateSources } from "../../src/catalog/schema.ts";
import type { Practice } from "../../src/catalog/types.ts";

const base = (): Practice => ({
  id: "META-01", area: "META", title: "t", strength: "must", strength_word: "Must", strength_source: "BP", profiles: ["claude-code", "portable"], assess: ["mechanical"],
  assessable_from: "artifact", freshness: "recent", contested: false, experimental: false,
  quotes: [{ text: "A long enough quote", source: "BP", section: "s" }],
  anchors: { "0": "The name is longer than the limit the profile sets.", "3": "The name is within the limit the profile sets for it." },
  fix_hint: "Shorten the name until it is within the limit.", inferred: true,
});
const ids = new Set(["BP"]);
const problems = (p: unknown): string[] => validatePractices([p], ids);

describe("validatePractices", () => {
  it("accepts a complete record", () => assert.deepEqual(problems(base()), []));
  it("rejects bad enums, a missing quote, an unknown source and a duplicate id", () => {
    assert.match(problems({ ...base(), strength: "loud" }).join(), /strength/);
    assert.match(problems({ ...base(), quotes: [] }).join(), /at least one quote/);
    assert.match(problems({ ...base(), quotes: [{ text: "A long enough quote", source: "ZZ", section: "" }] }).join(), /not in sources/);
    assert.match(validatePractices([base(), base()], ids).join(), /duplicate id/);
  });
  it("rejects an area that does not match the id, and anchors without inferred: true", () => {
    assert.match(problems({ ...base(), area: "DESC" }).join(), /area/);
    assert.match(problems({ ...base(), inferred: false }).join(), /inferred must be true/);
  });
  it("needs a reason and a source for an experimental practice and forbids them otherwise", () => {
    assert.match(problems({ ...base(), experimental: true }).join(), /needs experimental_reason/);
    assert.deepEqual(problems({ ...base(), experimental: true, experimental_reason: "r", experimental_source: "s" }), []);
    assert.match(problems({ ...base(), experimental_reason: "r" }).join(), /not experimental/);
  });
  it("rejects profile_rules for a profile the practice does not have", () => {
    assert.match(problems({ ...base(), profiles: ["portable"], profile_rules: { "claude-code": { strength: "must" } } }).join(), /not in profiles/);
  });
});

describe("validateSources", () => {
  it("requires a reason for skip and a URL for auto", () => {
    const s = { id: "A", tier: "A", urls: ["https://a.test"], title: "", version_evidence: "", verify: "auto" };
    assert.deepEqual(validateSources([s]), []);
    assert.match(validateSources([{ ...s, verify: "skip" }]).join(), /skip_reason/);
    assert.match(validateSources([{ ...s, urls: [] }]).join(), /at least one URL/);
  });
});

describe("validateAuthored", () => {
  it("accepts a pure mechanical record with anchors 0 and 3", () => assert.deepEqual(validateAuthored([base()]), []));
  it("requires all four anchors for judgement practices and none for process practices", () => {
    assert.match(validateAuthored([{ ...base(), assess: ["judgement"] }]).join(), /keys \[0,1,2,3\]/);
    assert.match(validateAuthored([{ ...base(), assessable_from: "process" }]).join(), /keys \[\]/);
  });
  it("rejects vague words, short anchors, identical anchors and a missing hint", () => {
    const b = base();
    assert.match(validateAuthored([{ ...b, anchors: { "0": "The name is poor and far too long for it.", "3": b.anchors?.["3"] as string } }]).join(), /vague word "poor"/);
    assert.match(validateAuthored([{ ...b, anchors: { "0": "Too short here.", "3": b.anchors?.["3"] as string } }]).join(), /6 to 30 words/);
    assert.match(validateAuthored([{ ...b, anchors: { "0": b.anchors?.["3"] as string, "3": b.anchors?.["3"] as string } }]).join(), /distinct/);
    assert.match(validateAuthored([{ ...b, fix_hint: undefined }]).join(), /fix_hint is missing/);
    assert.match(validateAuthored([{ ...b, fix_hint: "Shorten the name until it is short TODO." }]).join(), /placeholder/);
  });
  it("rejects an anchor that copies nine consecutive words from a quote", () => {
    const b = base();
    const quoted = { ...b, quotes: [{ text: "the name is longer than the limit the profile sets today", source: "BP", section: "" }] };
    assert.match(validateAuthored([quoted]).join(), /copies 9/);
  });
  it("rejects a placeholder that is not a param", () => {
    const b = base();
    assert.match(validateAuthored([{ ...b, fix_hint: "Shorten the name to {name_max_chars} characters now." }]).join(), /placeholder \{name_max_chars\}/);
  });
});
