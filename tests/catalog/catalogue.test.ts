import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadCatalogue } from "../../src/catalog/load.ts";
import { AREAS, PROFILES } from "../../src/catalog/types.ts";
import type { ProfileId } from "../../src/catalog/types.ts";
import type { Practice } from "../../src/catalog/types.ts";

const cat = loadCatalogue(new URL("../../catalog/", import.meta.url).pathname);

/**
 * Section 2.11 of the research file (revision 5), copied as constants because the research file lives in the
 * gitignored .dev/ and tests must not read it. tools/build-catalogue.ts checks the same table against the file itself.
 * Columns: practices, artifact, run, process, recent, undated-live, stale-unconfirmed.
 */
const SECTION_2_11: Record<string, number[]> = {
  META: [8, 8, 0, 0, 6, 2, 0],
  DESC: [12, 12, 0, 0, 5, 2, 5],
  TRIG: [9, 7, 0, 2, 5, 3, 1],
  BODY: [23, 23, 0, 0, 14, 7, 2],
  STRUCT: [10, 9, 1, 0, 4, 5, 1],
  SCRIPT: [10, 9, 1, 0, 3, 6, 1],
  SAFE: [6, 4, 0, 2, 4, 1, 1],
  TEST: [21, 5, 11, 5, 10, 6, 5],
  PROC: [9, 0, 0, 9, 2, 2, 5],
  MAINT: [9, 1, 4, 4, 3, 4, 2],
  FIT: [6, 4, 0, 2, 5, 0, 1],
};
/**
 * MUST / DIRECTIVE / SUGGESTION / STATEMENT per area for each profile, from the two tables of section 2.11 (revision 5).
 * These check the parser and the builder only; the strength of each practice comes from its own Strength line.
 */
const STRENGTH_2_11: Record<ProfileId, Record<string, number[]>> = {
  "claude-code": {
    META: [0, 2, 1, 5], DESC: [0, 8, 2, 2], TRIG: [0, 4, 0, 5], BODY: [0, 17, 1, 5], STRUCT: [0, 9, 0, 1], SCRIPT: [0, 6, 0, 4],
    SAFE: [0, 5, 0, 1], TEST: [0, 11, 1, 9], PROC: [0, 7, 0, 2], MAINT: [0, 5, 0, 4], FIT: [0, 3, 0, 3],
  },
  portable: {
    META: [3, 2, 1, 2], DESC: [3, 7, 1, 1], TRIG: [0, 4, 0, 5], BODY: [0, 17, 1, 5], STRUCT: [0, 9, 0, 1], SCRIPT: [0, 6, 0, 4],
    SAFE: [0, 5, 0, 1], TEST: [0, 11, 1, 9], PROC: [0, 7, 0, 2], MAINT: [0, 5, 0, 4], FIT: [0, 3, 0, 3],
  },
};

const inArea = (a: string): Practice[] => cat.practices.filter((p) => p.area === a);

describe("shipped catalogue matches research section 2.11", () => {
  it("has 123 practices, 54 sources, and revision 5", () => {
    assert.equal(cat.practices.length, 123);
    assert.equal(cat.sources.length, 54);
    assert.equal(cat.meta.revision, 5);
  });
  it("has the 82 / 17 / 24 split by assessable_from and the 61 / 38 / 24 split by freshness", () => {
    const n = (f: (p: Practice) => boolean): number => cat.practices.filter(f).length;
    assert.deepEqual([n((p) => p.assessable_from === "artifact"), n((p) => p.assessable_from === "run"), n((p) => p.assessable_from === "process")], [82, 17, 24]);
    assert.deepEqual([n((p) => p.freshness === "recent"), n((p) => p.freshness === "undated-live"), n((p) => p.freshness === "stale-unconfirmed")], [61, 38, 24]);
  });
  for (const area of AREAS)
    it(`${area}: practice, assessable_from and freshness counts match`, () => {
      const ps = inArea(area);
      const got = [
        ps.length,
        ps.filter((p) => p.assessable_from === "artifact").length,
        ps.filter((p) => p.assessable_from === "run").length,
        ps.filter((p) => p.assessable_from === "process").length,
        ps.filter((p) => p.freshness === "recent").length,
        ps.filter((p) => p.freshness === "undated-live").length,
        ps.filter((p) => p.freshness === "stale-unconfirmed").length,
      ];
      assert.deepEqual(got, SECTION_2_11[area]);
    });
  for (const profile of PROFILES)
    for (const area of AREAS)
      it(`${area}: strength counts match for ${profile}`, () => {
        const ps = inArea(area);
        const strengthOf = (p: Practice) => (profile === "portable" ? p.profile_rules?.portable?.strength : undefined) ?? p.strength;
        const got = (["must", "directive", "suggestion", "statement"] as const).map((s) => ps.filter((p) => strengthOf(p) === s).length);
        assert.deepEqual(got, STRENGTH_2_11[profile][area]);
      });
  it("states the deciding word and its source for every practice, and the portable word where it differs", () => {
    assert.ok(cat.practices.every((p) => p.strength_word !== "" && p.strength_source !== ""));
    assert.ok(cat.practices.every((p) => p.profile_rules?.portable?.strength === undefined || p.profile_rules.portable.strength_word));
  });
  it("carries the 20 load-blocking facts of section 2.12", () => {
    assert.deepEqual(cat.load_facts.map((f) => f.id), Array.from({ length: 20 }, (_, i) => `LB-${String(i + 1).padStart(2, "0")}`));
  });
  it("lists the same 24 process practices as the research file", () => {
    const ids = cat.practices.filter((p) => p.assessable_from === "process").map((p) => p.id);
    assert.deepEqual(ids.filter((i) => i.startsWith("TEST")), ["TEST-01", "TEST-10", "TEST-13", "TEST-17", "TEST-21"]);
    assert.equal(ids.length, 24);
  });
  it("marks exactly DESC-06, DESC-08 and PROC-08 as contested", () => {
    assert.deepEqual(cat.practices.filter((p) => p.contested).map((p) => p.id), ["DESC-06", "DESC-08", "PROC-08"]);
  });
});

describe("shipped catalogue is consistent", () => {
  it("lists every area's practices in id order, each with at least one quote", () => {
    for (const a of AREAS) {
      const ids = inArea(a).map((p) => p.id);
      assert.deepEqual(ids, [...ids].sort(), a);
    }
    assert.ok(cat.practices.every((p) => p.quotes.length >= 1));
  });
});

describe("experimental practices", () => {
  const EXPECTED = [
    "BODY-04", "BODY-06", "BODY-07", "BODY-08", "BODY-12", "BODY-14", "BODY-15", "BODY-16", "BODY-18", "BODY-20", "BODY-21", "TRIG-06", "TRIG-09",
    "FIT-02", "FIT-05", "MAINT-04", "SCRIPT-01", "SCRIPT-02", "SCRIPT-03", "SCRIPT-04", "SCRIPT-06", "SCRIPT-10", "STRUCT-01",
  ];
  it("marks exactly the practices that failed the real-skill agreement test, each with a reason and its source note", () => {
    const flagged = cat.practices.filter((p) => p.experimental);
    assert.deepEqual(flagged.map((p) => p.id).sort(), [...EXPECTED].sort());
    for (const p of flagged) assert.ok(p.experimental_reason && /^agreement-real-[ab]\.md/.test(p.experimental_source ?? ""), p.id);
  });
  it("keeps the unflagged practices free of an experimental reason", () => {
    for (const p of cat.practices.filter((q) => !q.experimental)) assert.equal(p.experimental_reason, undefined, p.id);
  });
});
