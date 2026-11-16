import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { loadCatalogue } from "../../src/catalog/load.ts";
import { AREAS, PROFILES } from "../../src/catalog/types.ts";
import type { Catalogue, Practice } from "../../src/catalog/types.ts";
import { CHECKS_BY_PRACTICE } from "../../src/checks/index.ts";
import { ContractError } from "../../src/checks/types.ts";
import type { Check } from "../../src/checks/types.ts";
import { loadSkill } from "../../src/loader/skill.ts";
import type { CriterionRecord } from "../../src/score/score.ts";
import { buildRecords, EXIT, exitCodeFor, summarise } from "../../src/score/score.ts";
import { BAD_FIXTURES } from "../helpers/bad-fixtures.ts";
import { GOOD_DIR, GOOD_FILES, tempDir, writeSkill } from "../helpers/skills.ts";
import type { FileMap } from "../helpers/skills.ts";

const cat = loadCatalogue(new URL("../../catalog/", import.meta.url).pathname);
const tmp = tempDir();
after(() => tmp.cleanup());
let n = 0;
const skillFrom = (dir: string, files: FileMap) => loadSkill(writeSkill(tmp.path, `${n++}/${dir}`, files));

describe("buildRecords", () => {
  for (const profile of PROFILES)
    it(`yields exactly one record for each of the 123 practices (${profile})`, () => {
      const records = buildRecords(cat, skillFrom(GOOD_DIR, GOOD_FILES), profile, CHECKS_BY_PRACTICE);
      assert.equal(records.length, 123);
      assert.deepEqual(records.map((r) => r.id), cat.practices.map((p) => p.id));
      const s = summarise(records, AREAS);
      assert.equal(s.scored + s.not_run + s.not_applicable + s.contested + s.process, 123);
    });

  it("carries the practice's scope note on its record, so a reviewer can tell when it does not apply", () => {
    const records = buildRecords(cat, skillFrom(GOOD_DIR, GOOD_FILES), "claude-code", CHECKS_BY_PRACTICE);
    const rec = records.find((r) => r.id === "TRIG-08");
    assert.match(rec?.scope_note ?? "", /verification skills/);
    assert.equal(records.find((r) => r.id === "META-01")?.scope_note, null);
  });

  it("scores the good fixture 3 on every mechanical check and reports no blocker", () => {
    const records = buildRecords(cat, skillFrom(GOOD_DIR, GOOD_FILES), "claude-code", CHECKS_BY_PRACTICE);
    const scored = records.filter((r) => r.status === "scored");
    assert.equal(scored.length, 15); // 17 checks, minus META-02 and DESC-10, which belong to the portable profile only
    assert.ok(scored.every((r) => r.score === 3));
    const s = summarise(records, AREAS);
    assert.deepEqual(s.blockers, []);
    assert.equal(exitCodeFor(s), EXIT.OK);
  });

  it("marks practices that need other layers not_run, process practices process, and out-of-profile practices not_applicable", () => {
    const by = Object.fromEntries(buildRecords(cat, skillFrom(GOOD_DIR, GOOD_FILES), "claude-code", CHECKS_BY_PRACTICE).map((r) => [r.id, r]));
    assert.equal(by["DESC-03"]?.status, "not_run");
    assert.match(by["DESC-03"]?.reason ?? "", /judgement layer/);
    assert.equal(by["TEST-04"]?.status, "not_run");
    assert.match(by["TEST-04"]?.reason ?? "", /live run/);
    assert.equal(by["SCRIPT-08"]?.status, "not_run");
    assert.match(by["SCRIPT-08"]?.reason ?? "", /no mechanical check/);
    assert.equal(by["TEST-01"]?.status, "process");
    assert.equal(by["META-02"]?.status, "not_applicable");
    assert.match(by["META-02"]?.reason ?? "", /portable|claude-code/);
    assert.equal(by["DESC-06"]?.status, "contested");
  });

  it("words the judgement not_run reason by whether the judge is on", () => {
    const off = Object.fromEntries(buildRecords(cat, skillFrom(GOOD_DIR, GOOD_FILES), "claude-code", CHECKS_BY_PRACTICE, { judge: false }).map((r) => [r.id, r]));
    assert.equal(off["DESC-03"]?.reason, "needs the judgement layer (run with --judge)");
    const exp = cat.practices.find((p) => p.experimental && p.assess.includes("judgement") && p.profiles.includes("claude-code"));
    assert.ok(exp);
    const on = Object.fromEntries(buildRecords(cat, skillFrom(GOOD_DIR, GOOD_FILES), "claude-code", CHECKS_BY_PRACTICE, { judge: true }).map((r) => [r.id, r]));
    assert.equal(on[(exp as Practice).id]?.reason, "experimental judgement practice, not sent to the judge");
  });

  it("makes infrastructure failure not_run, never 0: unreadable frontmatter does not score the checks that need it", () => {
    const f = BAD_FIXTURES.find((b) => b.label === "YAML does not parse") as (typeof BAD_FIXTURES)[number];
    const by = Object.fromEntries(buildRecords(cat, skillFrom(f.dirName, f.files), "claude-code", CHECKS_BY_PRACTICE).map((r) => [r.id, r]));
    for (const id of ["META-01", "META-03", "META-06", "DESC-01", "DESC-02"]) {
      assert.equal(by[id]?.status, "not_run", id);
      assert.equal(by[id]?.score, null, id);
    }
    assert.equal(by["META-05"]?.score, 0);
  });

  it("makes a must-practice at 0 a blocker only for the profile where it is a must", () => {
    const f = BAD_FIXTURES.find((b) => b.label === "uppercase name") as (typeof BAD_FIXTURES)[number];
    const skill = skillFrom(f.dirName, f.files);
    const portable = summarise(buildRecords(cat, skill, "portable", CHECKS_BY_PRACTICE), AREAS);
    assert.deepEqual(portable.blockers.map((b) => b.id), ["META-01"]);
    assert.equal(exitCodeFor(portable), EXIT.BLOCKERS);
    const cc = summarise(buildRecords(cat, skill, "claude-code", CHECKS_BY_PRACTICE), AREAS);
    assert.deepEqual(cc.blockers, []);
  });

  it("does not make a directive at 0 a blocker", () => {
    const f = BAD_FIXTURES.find((b) => b.practice === "STRUCT-07") as (typeof BAD_FIXTURES)[number];
    const s = summarise(buildRecords(cat, skillFrom(f.dirName, f.files), "claude-code", CHECKS_BY_PRACTICE), AREAS);
    assert.equal(s.blockers.length, 0);
    assert.equal(exitCodeFor(s), EXIT.OK);
  });

  it("fills the active profile's numbers into anchors and the fix hint", () => {
    const f = BAD_FIXTURES.find((b) => b.practice === "DESC-02" && b.profile === "portable") as (typeof BAD_FIXTURES)[number];
    const rec = buildRecords(cat, skillFrom(f.dirName, f.files), "portable", CHECKS_BY_PRACTICE).find((r) => r.id === "DESC-02");
    assert.match(rec?.anchors["0"] ?? "", /1024 characters/);
    assert.match(rec?.fix_hint ?? "", /1024 characters/);
    assert.equal(rec?.anchors_inferred, true);
  });
});

describe("states for synthetic practices", () => {
  const practice = (over: Partial<Practice>): Practice => ({
    id: "META-01", area: "META", title: "t", strength: "must", strength_word: "Must", strength_source: "BP", profiles: ["claude-code"], assess: ["mechanical"], assessable_from: "artifact",
    freshness: "recent", contested: false, experimental: false, quotes: [{ text: "a long enough quote", source: "BP", section: "" }], ...over,
  });
  const only = (p: Practice): Catalogue => ({ ...cat, practices: [p] });
  const checkReturning = (kind: "findings" | "clean" | "not_run"): Check => ({
    practice: "META-01",
    run: () => (kind === "not_run" ? { kind: "not_run", reason: "layer failed" } : { kind: "ran", findings: kind === "clean" ? [] : [{ practice: "META-01", message: "m", file: "f", line: 1, evidence: null }] }),
  });
  const run = (p: Practice, c: Check) => buildRecords(only(p), skillFrom("syn", GOOD_FILES), "claude-code", new Map([[c.practice, c]]))[0]!;

  const effectFinding = (lb: string[]) => ({ practice: "META-01", message: "m", file: "f", line: 1, evidence: null, effect: "not_loaded" as const, lb });
  const checkEmitting = (effects: string[] | undefined, lb: string[]): Check => ({ practice: "META-01", ...(effects ? { effects } : {}), run: () => ({ kind: "ran", findings: [effectFinding(lb)] }) });

  it("throws a ContractError naming the check and LB ID when a finding carries an effect the check does not declare (SKM-31)", () => {
    assert.throws(() => run(practice({}), checkEmitting(undefined, ["LB-04"])), (e: Error) => e instanceof ContractError && /META-01/.test(e.message) && /LB-04/.test(e.message));
    assert.throws(() => run(practice({}), checkEmitting(["LB-01"], ["LB-01", "LB-09"])), (e: Error) => e instanceof ContractError && /LB-09/.test(e.message));
  });
  it("throws for an undeclared effect even on a contested or experimental practice", () => {
    assert.throws(() => run(practice({ contested: true }), checkEmitting(undefined, ["LB-04"])), ContractError);
    assert.throws(() => run(practice({ experimental: true }), checkEmitting(undefined, ["LB-04"])), ContractError);
  });
  it("lets a declared effect through", () => {
    assert.equal(run(practice({}), checkEmitting(["LB-04"], ["LB-04"])).status, "scored");
  });
  it("shows a contested practice as contested with an informational score", () => {
    const r = run(practice({ contested: true }), checkReturning("findings"));
    assert.deepEqual([r.status, r.score], ["contested", 0]);
  });
  it("keeps an experimental criterion out of the area mean and the blockers", () => {
    const records = [run(practice({ experimental: true }), checkReturning("findings"))];
    const s = summarise(records, ["META"]);
    assert.equal(s.areas[0]?.mean, null);
    assert.equal(s.areas[0]?.experimental, 1);
    assert.deepEqual(s.blockers, []);
    assert.equal(exitCodeFor(s), EXIT.FAILURE);
  });
  it("counts an experimental scored practice apart: not in scored, not in the area mean, not a must blocker", () => {
    const ok = run(practice({ id: "META-02" }), { ...checkReturning("clean"), practice: "META-02" });
    const exp = run(practice({ experimental: true, experimental_reason: "r", experimental_source: "s" }), checkReturning("findings"));
    const s = summarise([{ ...ok, id: "META-02" }, exp], ["META"]);
    assert.deepEqual([s.scored, s.experimental, s.areas[0]?.scored, s.areas[0]?.mean, s.areas[0]?.experimental], [1, 1, 1, 3, 1]);
    assert.deepEqual(s.blockers, []);
    assert.equal(exp.experimental_reason, "r");
  });
  it("keeps an experimental finding with an effect out of the blockers too", () => {
    const rs = buildRecords(only(practice({ experimental: true })), skillFrom("syn", GOOD_FILES), "claude-code", new Map([["META-01", finding("fields_ignored")]]));
    assert.deepEqual(summarise(rs, ["META"]).blockers, []);
  });
  it("gives a check on a practice that also needs judgement only as signals, never a score", () => {
    const r = run(practice({ assess: ["mechanical", "judgement"] }), checkReturning("findings"));
    assert.deepEqual([r.status, r.score, r.evidence.length], ["not_run", null, 1]);
  });
  const finding = (effect?: "not_loaded" | "fields_ignored"): Check => ({
    practice: "META-01",
    effects: ["LB-09"],
    run: () => ({ kind: "ran", findings: [{ practice: "META-01", message: "m", file: "f", line: 1, evidence: null, ...(effect ? { effect, lb: ["LB-09"] } : {}) }] }),
  });
  it("makes a finding with an effect a blocker in every profile, even for a practice that is only a statement", () => {
    const p = practice({ strength: "statement", profiles: ["claude-code", "portable"] });
    for (const profile of ["claude-code", "portable"] as const) {
      const records = buildRecords(only(p), skillFrom("syn", GOOD_FILES), profile, new Map([["META-01", finding("fields_ignored")]]));
      const s = summarise(records, ["META"]);
      assert.deepEqual(s.blockers.map((b) => [b.id, b.kind, b.effect, b.lb]), [["META-01", "effect", "fields_ignored", ["LB-09"]]], profile);
      assert.equal(exitCodeFor(s), EXIT.BLOCKERS);
    }
  });
  it("makes no blocker of a 0 that has no effect and no must", () => {
    const s = summarise([run(practice({ strength: "directive" }), finding())], ["META"]);
    assert.deepEqual(s.blockers, []);
    assert.equal(exitCodeFor(s), EXIT.OK);
  });
  it("reports one blocker per effect finding, not an extra one for the must", () => {
    const s = summarise([run(practice({ strength: "must" }), finding("not_loaded"))], ["META"]);
    assert.deepEqual(s.blockers.map((b) => b.kind), ["effect"]);
  });
  describe("security checks (SKM-34)", () => {
    const secCheck: Check = { practice: "META-01", security: { risk: "credential_exposure" }, run: () => ({ kind: "ran", findings: [{ practice: "META-01", message: "m", file: "f", line: 3, evidence: null }] }) };
    for (const strength of ["statement", "directive", "must"] as const)
      for (const profile of ["claude-code", "portable"] as const)
        it(`blocks in ${profile} for a ${strength} practice and names the risk`, () => {
          const p = practice({ strength, profiles: ["claude-code", "portable"] });
          const s = summarise(buildRecords(only(p), skillFrom("syn", GOOD_FILES), profile, new Map([["META-01", secCheck]])), ["META"]);
          assert.deepEqual(s.security_blockers.map((b) => [b.id, b.risk, b.file, b.line]), [["META-01", "credential_exposure", "f", 3]]);
          assert.deepEqual(s.blockers.filter((b) => b.kind !== "must"), []);
          assert.equal(exitCodeFor(s), EXIT.BLOCKERS);
        });
    it("does not block when the practice is experimental", () => {
      const p = practice({ strength: "directive", experimental: true, experimental_reason: "r", experimental_source: "s" });
      const s = summarise(buildRecords(only(p), skillFrom("syn", GOOD_FILES), "claude-code", new Map([["META-01", secCheck]])), ["META"]);
      assert.deepEqual(s.security_blockers, []);
    });
    it("does not block when the check is not_run", () => {
      const c: Check = { ...secCheck, run: () => ({ kind: "not_run", reason: "skipped" }) };
      const s = summarise(buildRecords(only(practice({ strength: "directive" })), skillFrom("syn", GOOD_FILES), "claude-code", new Map([["META-01", c]])), ["META"]);
      assert.deepEqual(s.security_blockers, []);
    });
  });
  it("takes the area mean and coverage from scored records only, leaving out contested, not_run, not_applicable and process", () => {
    const base = run(practice({}), checkReturning("clean"));
    const rec = (status: CriterionRecord["status"], score: number | null): CriterionRecord => ({ ...base, status, score });
    const records = [rec("scored", 3), rec("scored", 1), rec("contested", 0), rec("not_run", null), rec("not_applicable", null), rec("process", null)];
    const area = summarise(records, ["META"]).areas[0]!;
    assert.equal(area.mean, 2); // (3 + 1) / 2; a contested 0 or a not_run read as 0 would pull it to 1.33
    assert.equal(area.scored, 2);
    assert.equal(area.assessable, 4); // scored 2 + not_run 1 + contested 1
    assert.deepEqual([area.not_run, area.contested, area.not_applicable, area.process], [1, 1, 1, 1]);
    const s = summarise(records, ["META"]);
    assert.equal(s.scored, 2);
    assert.equal(s.total, 6);
    assert.deepEqual(s.scored_by, ["mechanical"]);
  });
  it("takes the mean of scored criteria only and rounds to two decimals", () => {
    const rs = [3, 0, 3].map((score, i) => ({ ...run(practice({}), checkReturning("clean")), id: `META-0${i}`, score }));
    assert.equal(summarise(rs, ["META"]).areas[0]?.mean, 2);
  });
});

describe("exitCodeFor", () => {
  const summary = (scored: number, blockers: number) => ({ total: scored, scored_by: [], layers_not_run: [], stale_unconfirmed: [], scored, experimental: 0, not_run: 0, not_applicable: 0, contested: 0, process: 0, areas: [], blockers: Array.from({ length: blockers }, () => ({ id: "X", kind: "must" as const, effect: null, lb: [], title: "", reason: "", file: null, line: null })), security_blockers: [] as { id: string; risk: string; title: string; reason: string; file: string | null; line: number | null }[], suppressed_security: [] });
  it("is 2 when nothing scored, whatever else is true", () => {
    assert.equal(exitCodeFor(summary(0, 0)), 2);
    assert.equal(exitCodeFor(summary(0, 1)), 2);
  });
  it("is 1 for a security blocker alone", () => {
    const sec = { id: "SAFE-02", risk: "r", title: "", reason: "", file: null, line: null };
    assert.equal(exitCodeFor({ ...summary(5, 0), security_blockers: [sec] }), 1);
    assert.equal(exitCodeFor({ ...summary(0, 0), security_blockers: [sec] }), 2);
  });
  it("is 1 for a blocker and 0 otherwise", () => {
    assert.equal(exitCodeFor(summary(5, 1)), 1);
    assert.equal(exitCodeFor(summary(5, 0)), 0);
  });
});
