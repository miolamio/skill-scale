import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { loadCatalogue } from "../../src/catalog/load.ts";
import { AREAS } from "../../src/catalog/types.ts";
import { CHECKS_BY_PRACTICE } from "../../src/checks/index.ts";
import type { Check } from "../../src/checks/types.ts";
import { applyJudge } from "../../src/judge/apply.ts";
import { qualifiedFor } from "../../src/judge/qualify.ts";
import type { JudgeOutcome, PracticeJudgement } from "../../src/judge/types.ts";
import { loadSkill } from "../../src/loader/skill.ts";
import { buildRecords, EXIT, exitCodeFor, summarise } from "../../src/score/score.ts";
import { GOOD_DIR, GOOD_FILES, tempDir, writeSkill } from "../helpers/skills.ts";

const cat = loadCatalogue(new URL("../../catalog/", import.meta.url).pathname);
const tmp = tempDir();
after(() => tmp.cleanup());
const skill = loadSkill(writeSkill(tmp.path, GOOD_DIR, GOOD_FILES));
// No shipped judgement practice is a must today, so the first qualified practice is made one in a copy of the catalogue.
const shippedIds = qualifiedFor(cat, buildRecords(cat, skill, "claude-code", CHECKS_BY_PRACTICE), "claude-code").map((p) => p.id);
const must = shippedIds[0] as string;
const nonMust = shippedIds[1] as string;
const mustCat = { ...cat, practices: cat.practices.map((p) => (p.id === must ? { ...p, strength: "must" as const } : p)) };
const records = (checks = CHECKS_BY_PRACTICE) => buildRecords(mustCat, skill, "claude-code", checks, { judge: true });

const pj = (id: string, o: Partial<PracticeJudgement> = {}): PracticeJudgement => ({
  id, state: "scored", score: 2, scores: [2], unstable: false, stability_measured: false,
  evidence: { quote: "# Good skill", file: "SKILL.md", line: 7, reason: `why ${id}` }, not_run_code: null, reason: null, ...o,
});
const outcome = (practices: PracticeJudgement[]): JudgeOutcome => ({ model: "m", repeats: 1, calls: 1, costUsd: 0.1, durationMs: 10, allInfra: false, practices, injection: [] });
const get = (rs: ReturnType<typeof records>, id: string) => rs.find((r) => r.id === id)!;

describe("applyJudge", () => {
  it("has a must and a non-must practice to test with", () => {
    assert.equal(records().find((r) => r.id === must)?.strength, "must");
    assert.notEqual(records().find((r) => r.id === nonMust)?.strength, "must");
  });

  it("scores a judged practice and records the judge detail", () => {
    const out = applyJudge(records(), outcome([pj(must, { scores: [2, 3, 2], unstable: false, stability_measured: true })]));
    const r = get(out, must);
    assert.equal(r.status, "scored");
    assert.equal(r.score, 2);
    assert.equal(r.reason, null);
    assert.deepEqual(r.evidence[0], { practice: must, message: `why ${must}`, file: "SKILL.md", line: 7, evidence: "# Good skill" });
    assert.deepEqual(r.judge, { model: "m", repeats: 1, scores: [2, 3, 2], unstable: false, stability_measured: true, quote: "# Good skill", file: "SKILL.md", line: 7, reason: `why ${must}`, not_run_code: null });
  });

  it("maps not_applicable to the existing state", () => {
    const out = applyJudge(records(), outcome([pj(must, { state: "not_applicable", score: null, scores: [], reason: "no scripts here" })]));
    assert.equal(get(out, must).status, "not_applicable");
    assert.equal(get(out, must).reason, "no scripts here");
  });

  it("keeps a failed practice not_run with a reason, never 0", () => {
    const out = applyJudge(records(), outcome([
      pj(must, { state: "not_run", score: null, scores: [], evidence: null, not_run_code: "infra", reason: "exit 1" }),
      pj(nonMust, { state: "not_run", score: null, scores: [], evidence: null, not_run_code: "unsupported", reason: "quote not found" }),
    ]));
    assert.equal(get(out, must).status, "not_run");
    assert.equal(get(out, must).score, null);
    assert.match(get(out, must).reason ?? "", /^judge: infrastructure failure/);
    assert.match(get(out, nonMust).reason ?? "", /^judge: no verified evidence/);
    assert.equal(get(out, nonMust).judge?.not_run_code, "unsupported");
  });

  it("lets the judge's score stand for a mixed practice and keeps the mechanical finding as a signal", () => {
    const mech: Check = { practice: must, run: () => ({ kind: "ran", findings: [{ practice: must, message: "mechanical signal", file: "SKILL.md", line: 1, evidence: null }] }) };
    const base = records(new Map([[must, mech]]));
    assert.equal(get(base, must).status, "not_run");
    const out = applyJudge(base, outcome([pj(must, { score: 3, scores: [3], evidence: { quote: "q", file: "SKILL.md", line: 7, reason: "judge says fine" } })]));
    const r = get(out, must);
    assert.equal(r.score, 3);
    assert.deepEqual(r.evidence.map((f) => f.message), ["judge says fine", "mechanical signal"]);
    assert.deepEqual(summarise(out, AREAS).blockers.filter((b) => b.id === must), []);
  });

  it("leaves practices the judge was not asked about untouched, with the not-sent reason", () => {
    const exp = cat.practices.find((p) => p.experimental && p.assess.includes("judgement") && p.profiles.includes("claude-code"));
    assert.ok(exp);
    const before = records();
    const out = applyJudge(before, outcome([pj(must)]));
    assert.deepEqual(get(out, (exp as { id: string }).id), get(before, (exp as { id: string }).id));
    assert.equal(get(out, (exp as { id: string }).id).status, "not_run");
    assert.match(get(out, (exp as { id: string }).id).reason ?? "", /experimental judgement practice, not sent to the judge/);
  });

  it("a judged 0 blocks on a must practice and not on others", () => {
    const zero = (id: string) => pj(id, { score: 0, scores: [0], evidence: { quote: "# Good skill", file: "SKILL.md", line: 7, reason: `bad ${id}` } });
    const s = summarise(applyJudge(records(), outcome([zero(must), zero(nonMust)])), AREAS);
    assert.deepEqual(s.blockers.map((b) => [b.id, b.kind, b.reason, b.file, b.line]), [[must, "must", `bad ${must}`, "SKILL.md", 7]]);
    assert.equal(exitCodeFor(s), EXIT.BLOCKERS);
    const only = summarise(applyJudge(records(), outcome([zero(nonMust)])), AREAS);
    assert.deepEqual(only.blockers, []);
  });

  it("adds the judgement layer to scored_by and drops it from layers_not_run once something was judged", () => {
    const plain = summarise(records(), AREAS);
    assert.ok(!plain.scored_by.includes("judgement"));
    assert.ok(plain.layers_not_run.includes("judgement"));
    const s = summarise(applyJudge(records(), outcome([pj(must)])), AREAS);
    assert.ok(s.scored_by.includes("judgement"));
    assert.ok(!s.layers_not_run.includes("judgement"));
  });
});
