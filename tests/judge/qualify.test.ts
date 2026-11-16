import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { loadCatalogue } from "../../src/catalog/load.ts";
import { PROFILES } from "../../src/catalog/types.ts";
import type { Practice } from "../../src/catalog/types.ts";
import { CHECKS_BY_PRACTICE } from "../../src/checks/index.ts";
import { qualifiedFor } from "../../src/judge/qualify.ts";
import { loadSkill } from "../../src/loader/skill.ts";
import { buildRecords } from "../../src/score/score.ts";
import { GOOD_DIR, GOOD_FILES, tempDir, writeSkill } from "../helpers/skills.ts";

const cat = loadCatalogue(new URL("../../catalog/", import.meta.url).pathname);
const tmp = tempDir();
after(() => tmp.cleanup());
const skill = loadSkill(writeSkill(tmp.path, GOOD_DIR, GOOD_FILES));

const predicate = (p: Practice): boolean => p.assess.includes("judgement") && p.assessable_from === "artifact" && !p.experimental && !p.contested;

describe("qualifiedFor", () => {
  for (const profile of PROFILES)
    it(`returns the open judgement practices of the ${profile} profile`, () => {
      const records = buildRecords(cat, skill, profile, CHECKS_BY_PRACTICE);
      const got = qualifiedFor(cat, records, profile);
      const expected = cat.practices.filter((p) => predicate(p) && records.find((r) => r.id === p.id)?.status === "not_run").map((p) => p.id);
      assert.ok(got.length > 0);
      assert.deepEqual(got.map((g) => g.id), expected);
      assert.equal(new Set(got.map((g) => g.id)).size, got.length);
    });

  it("matches the catalogue-wide predicate across profiles, and never exceeds it per profile", () => {
    const all = cat.practices.filter(predicate).map((p) => p.id);
    assert.ok(all.length >= 1);
    for (const profile of PROFILES) {
      const got = qualifiedFor(cat, buildRecords(cat, skill, profile, CHECKS_BY_PRACTICE), profile).map((g) => g.id);
      for (const id of got) assert.ok(all.includes(id));
    }
  });

  it("leaves out experimental, contested and out-of-profile practices", () => {
    for (const profile of PROFILES) {
      const records = buildRecords(cat, skill, profile, CHECKS_BY_PRACTICE);
      const ids = new Set(qualifiedFor(cat, records, profile).map((g) => g.id));
      for (const p of cat.practices) {
        if (p.experimental || p.contested) assert.ok(!ids.has(p.id), p.id);
        if (!p.profiles.includes(profile)) assert.ok(!ids.has(p.id), p.id);
      }
    }
  });

  it("renders anchors for the profile and takes the strength word from the profile rule when there is one", () => {
    for (const profile of PROFILES) {
      const records = buildRecords(cat, skill, profile, CHECKS_BY_PRACTICE);
      for (const g of qualifiedFor(cat, records, profile)) {
        const p = cat.practices.find((x) => x.id === g.id) as Practice;
        assert.deepEqual(g.anchors, records.find((r) => r.id === g.id)?.anchors);
        assert.equal(g.strength_word, p.profile_rules?.[profile]?.strength_word ?? p.strength_word);
        assert.equal(g.scope_note, p.scope_note ?? null);
      }
    }
  });
});
