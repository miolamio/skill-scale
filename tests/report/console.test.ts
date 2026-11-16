import assert from "node:assert/strict";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { loadCatalogue } from "../../src/catalog/load.ts";
import { AREAS } from "../../src/catalog/types.ts";
import { CHECKS_BY_PRACTICE } from "../../src/checks/index.ts";
import { loadSkill } from "../../src/loader/skill.ts";
import { renderConsole } from "../../src/report/console.ts";
import { STRINGS_EN, t } from "../../src/report/strings.ts";
import type { CriterionRecord } from "../../src/score/score.ts";
import { buildRecords, summarise } from "../../src/score/score.ts";
import { BAD_FIXTURES } from "../helpers/bad-fixtures.ts";
import { tempDir, writeSkill } from "../helpers/skills.ts";

const cat = loadCatalogue(new URL("../../catalog/", import.meta.url).pathname);
const tmp = tempDir();
after(() => tmp.cleanup());

function report(label: string, profile: "claude-code" | "portable", tweak: (records: CriterionRecord[]) => void = () => {}) {
  const f = BAD_FIXTURES.find((b) => b.label === label) as (typeof BAD_FIXTURES)[number];
  const skill = loadSkill(writeSkill(join(tmp.path, f.label.replace(/\W/g, "_")), f.dirName, f.files));
  const records = buildRecords(cat, skill, profile, CHECKS_BY_PRACTICE);
  tweak(records);
  const summary = summarise(records, AREAS);
  return renderConsole({ version: "1.2.3", revision: 4, profile, skillPath: skill.root }, records, summary, STRINGS_EN);
}

describe("renderConsole", () => {
  it("prints the header, one bar per area with coverage, blockers, and the lowest scores with file, line and fix", () => {
    const text = report("uppercase name", "portable");
    assert.match(text, /^skill-scale 1\.2\.3 \| catalogue r4 \| profile portable/);
    assert.match(text, /META\s+[#.]{15}\s+\d\.\d\d\s+\d+ of \d+ scored/);
    assert.match(text, /Blockers\n  META-01 Name length and characters: the name may only use lowercase letters, digits and single hyphens.*\[SKILL\.md:2\]/);
    assert.match(text, /Lowest scores\n  0 META-01 .*\[SKILL\.md:2\]\n      the name may only use.*\n      Fix: Shorten the name to at most 64 characters/);
    assert.match(text, /Not scored: \d+ not run, \d+ contested/);
    assert.match(text, /our inference/);
  });
  it("says so when there is no blocker or no low score", () => {
    const text = report("README.md in the folder", "claude-code");
    assert.match(text, /No blockers\./);
    assert.match(text, /0 STRUCT-07/);
    assert.match(text, /PROC\s+-{15}\s+no score\s+0 of 0 scored, 9 for the checklist/);
  });
  it("marks a stale-unconfirmed practice on the lowest-scores line and counts them", () => {
    const text = report("README.md in the folder", "claude-code");
    assert.match(text, /0 STRUCT-07 .*\(stale, unconfirmed\)/);
    assert.match(text, /Stale, unconfirmed: \d+ of the scored practices \(.*STRUCT-07.*\)\./);
    assert.doesNotMatch(text, /Stale, unconfirmed: 0/);
  });
  it("marks a stale-unconfirmed practice on a blocker line", () => {
    const text = report("uppercase name", "portable", (rs) => {
      for (const r of rs) if (r.id === "META-01") r.freshness = "stale-unconfirmed";
    });
    assert.match(text, /Blockers\n  META-01 Name length and characters \(stale, unconfirmed\): /);
    assert.match(text, /Stale, unconfirmed: \d+ of the scored practices \(.*META-01.*\)\./);
  });
  it("leaves out the count line when no scored practice is stale", () => {
    const text = report("uppercase name", "portable", (rs) => {
      for (const r of rs) r.freshness = "recent";
    });
    assert.doesNotMatch(text, /Stale, unconfirmed/);
    assert.doesNotMatch(text, /\(stale, unconfirmed\)/);
  });
  it("opens with a headline counted from the records: scored of total, by which layers, and not a full assessment", () => {
    let scored = 0;
    let total = 0;
    const text = report("README.md in the folder", "claude-code", (rs) => {
      total = rs.length;
      scored = rs.filter((r) => r.status === "scored" && !r.experimental).length;
    });
    const lines = text.split("\n");
    assert.equal(lines[3], `Scored ${scored} of ${total} practices (mechanical only). Not a full assessment: the judgement and live layers did not run.`);
    assert.ok(scored > 0 && scored < total);
  });
  it("counts the headline from the records, not from constants", () => {
    const text = report("README.md in the folder", "claude-code", (rs) => {
      for (const r of rs.filter((x) => x.status === "scored").slice(0, 3)) {
        r.status = "not_run";
        r.score = null;
      }
    });
    const m = /^Scored (\d+) of (\d+) practices/m.exec(text);
    const full = /^Scored (\d+) of/m.exec(report("README.md in the folder", "claude-code"));
    assert.ok(m && full);
    assert.equal(Number(m[1]) + 3, Number(full[1]));
  });
  it("says how many scored practices were experimental, leaves them out of the count, and marks them where listed", () => {
    const text = report("uppercase name", "portable", (rs) => {
      const low = rs.filter((r) => r.status === "scored" && r.score === 0).slice(0, 1);
      assert.equal(low.length, 1);
      for (const r of low) r.experimental = true;
    });
    const full = /^Scored (\d+) of/m.exec(report("uppercase name", "portable"));
    const m = /^Scored (\d+) of \d+ practices \([^)]*\)\. (\d+) more scored as experimental and are not counted\./m.exec(text);
    assert.ok(m && full);
    assert.equal(m[2], "1");
    assert.equal(Number(m[1]) + 1, Number(full[1]));
    assert.match(text, /\(experimental, not counted\)/);
  });
  it("leaves the experimental count out of the headline when none scored as experimental", () => {
    assert.doesNotMatch(report("README.md in the folder", "claude-code"), /experimental and are not counted/);
  });
  it("says no layer scored anything when nothing was scored", () => {
    const text = report("README.md in the folder", "claude-code", (rs) => {
      for (const r of rs) if (r.status === "scored") Object.assign(r, { status: "not_run", score: null });
    });
    assert.match(text, /^Scored 0 of \d+ practices \(no layer\)\. Not a full assessment: the mechanical, judgement and live layers did not run\./m);
  });
  it("keeps every string in the strings table", () => {
    for (const key of Object.keys(STRINGS_EN) as (keyof typeof STRINGS_EN)[]) assert.ok(t(STRINGS_EN, key).length > 0);
  });
});
