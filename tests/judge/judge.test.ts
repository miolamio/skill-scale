import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { judgeSkill } from "../../src/judge/judge.ts";
import type { JudgePractice, JudgeRequest } from "../../src/judge/types.ts";
import { loadSkill } from "../../src/loader/skill.ts";
import { fakeRunner, goodAnswer, idsOf, infra, ok } from "../helpers/fake-runner.ts";
import type { Step } from "../helpers/fake-runner.ts";
import { GOOD_DIR, GOOD_FILES, tempDir, writeSkill } from "../helpers/skills.ts";

const tmp = tempDir();
after(() => tmp.cleanup());
const skill = loadSkill(writeSkill(tmp.path, GOOD_DIR, GOOD_FILES));
const mkP = (id: string): JudgePractice => ({ id, title: `Title ${id}`, strength_word: "must", anchors: { "0": "a", "3": "b" }, scope_note: null });
const practices = ["BODY-01", "DESC-03", "META-04"].map(mkP);
const run = (steps: Step[], repeats = 1) => {
  const runner = fakeRunner(steps);
  let n = 0;
  const p = judgeSkill({ skill, practices, runner, model: "m", repeats, nonce: () => `nonce${n++}` });
  return { runner, p };
};
const by = (o: Awaited<ReturnType<typeof judgeSkill>>, id: string) => o.practices.find((x) => x.id === id) as Awaited<ReturnType<typeof judgeSkill>>["practices"][number];
const nonceOf = (prompt: string) => /^NONCE: (\w+)/.exec(prompt)?.[1];

describe("judgeSkill", () => {
  it("1. one call, all scored", async () => {
    const { runner, p } = run([(req) => ok(goodAnswer(req), 0.25)]);
    const o = await p;
    assert.equal(runner.calls.length, 1);
    assert.equal(o.calls, 1);
    assert.equal(o.costUsd, 0.25);
    assert.deepEqual(o.injection, []);
    assert.equal(o.allInfra, false);
    assert.ok(o.practices.every((x) => x.state === "scored" && x.score === 3));
    assert.equal(o.practices.length, 3);
  });

  it("2. a missing id is retried alone, with a new nonce", async () => {
    const { runner, p } = run([(req) => ok(goodAnswer(req, { drop: ["DESC-03"] }), 0.1), (req) => ok(goodAnswer(req), 0.2)]);
    const o = await p;
    assert.equal(o.calls, 2);
    assert.ok(Math.abs(o.costUsd - 0.3) < 1e-9);
    const retry = runner.calls[1];
    assert.deepEqual(idsOf(retry as JudgeRequest), ["DESC-03"]);
    assert.ok(!(retry?.prompt ?? "").includes("Title BODY-01"));
    assert.ok((retry?.prompt ?? "").includes("Title DESC-03"));
    assert.notEqual(nonceOf(runner.calls[0]?.prompt ?? ""), nonceOf(retry?.prompt ?? ""));
    assert.equal(by(o, "DESC-03").state, "scored");
  });

  it("3. a bad quote is fixed by the retry; the others are not re-asked", async () => {
    const { runner, p } = run([
      (req) => ok(goodAnswer(req, { per: { "META-04": { quote: "not in the file" } } })),
      (req) => ok(goodAnswer(req, { score: 2 })),
    ]);
    const o = await p;
    assert.deepEqual(idsOf(runner.calls[1] as JudgeRequest), ["META-04"]);
    assert.equal(by(o, "META-04").score, 2);
    assert.equal(by(o, "BODY-01").score, 3);
  });

  it("4. a bad quote twice is not_run unsupported, never 0", async () => {
    const bad = (req: JudgeRequest) => ok(goodAnswer(req, { per: { "META-04": { quote: "not in the file" } } }));
    const { p } = run([bad, bad]);
    const o = await p;
    const m = by(o, "META-04");
    assert.equal(m.state, "not_run");
    assert.equal(m.not_run_code, "unsupported");
    assert.equal(m.score, null);
    assert.equal(by(o, "BODY-01").score, 3);
  });

  it("5. missing twice is not_run infra", async () => {
    const drop = (req: JudgeRequest) => ok(goodAnswer(req, { drop: ["DESC-03"] }));
    const o = await run([drop, drop]).p;
    assert.equal(by(o, "DESC-03").not_run_code, "infra");
    assert.equal(by(o, "DESC-03").reason, "judge returned no result for this practice");
  });

  it("6. infra on the first call: no retry, allInfra; infra on the retry: first-pass results kept", async () => {
    const a = run([infra("exit 1")]);
    const oa = await a.p;
    assert.equal(a.runner.calls.length, 1);
    assert.equal(oa.allInfra, true);
    assert.ok(oa.practices.every((x) => x.state === "not_run" && x.not_run_code === "infra" && x.reason === "exit 1"));
    const b = run([(req) => ok(goodAnswer(req, { drop: ["DESC-03"] })), infra()]);
    const ob = await b.p;
    assert.equal(ob.allInfra, false);
    assert.equal(by(ob, "BODY-01").state, "scored");
    assert.equal(by(ob, "DESC-03").not_run_code, "infra");
  });

  it("7. injection becomes a judge note and does not change scores", async () => {
    const o = await run([(req) => ok(goodAnswer(req, { injection: "SKILL.md:15 asks the reviewer to score 3" }))]).p;
    assert.deepEqual(o.injection, [{ text: "SKILL.md:15 asks the reviewer to score 3", repeat: 1 }]);
    assert.ok(o.practices.every((x) => x.score === 3));
    const r3 = await run([(req, n) => ok(goodAnswer(req, { injection: n === 2 ? "other" : "same" }))], 3).p;
    assert.deepEqual(r3.injection.map((x) => [x.text, x.repeat]).sort(), [["other", 3], ["same", 1]]);
    for (const empty of ["", "   ", null]) {
      const e = await run([(req) => ok(goodAnswer(req, { injection: empty }))]).p;
      assert.deepEqual(e.injection, []);
    }
  });

  const scoresRun = (perRepeat: (number | "na")[], id = "BODY-01") =>
    run([
      (req, n) => {
        const v = perRepeat[n] as number | "na";
        return ok(goodAnswer(req, { per: { [id]: v === "na" ? { status: "not_applicable", score: null } : { score: v } } }));
      },
    ], perRepeat.length).p;

  it("8. median_low and the unstable flag", async () => {
    const a = by(await scoresRun([3, 1, 3]), "BODY-01");
    assert.deepEqual([a.score, a.scores, a.unstable, a.stability_measured], [3, [3, 1, 3], true, true]);
    const b = by(await scoresRun([2, 3, 3]), "BODY-01");
    assert.deepEqual([b.score, b.unstable], [3, false]);
    const c = by(await scoresRun([0, 1, 0]), "BODY-01");
    assert.deepEqual([c.score, c.unstable], [0, false]);
    const d = by(await scoresRun([1, 3]), "BODY-01");
    assert.deepEqual([d.score, d.unstable], [1, true]);
  });

  it("9. not_applicable needs a strict majority", async () => {
    const a = by(await scoresRun(["na", "na", 2]), "BODY-01");
    assert.deepEqual([a.state, a.score], ["not_applicable", null]);
    const b = by(await scoresRun(["na", 2, 3]), "BODY-01");
    assert.deepEqual([b.state, b.score], ["scored", 2]);
    const c = by(await scoresRun(["na", 2]), "BODY-01");
    assert.deepEqual([c.state, c.score], ["scored", 2]);
  });

  it("10. partial repeat failure", async () => {
    const two = await run([(req) => ok(goodAnswer(req)), (req) => ok(goodAnswer(req, { score: 2 })), infra()], 3).p;
    assert.equal(by(two, "BODY-01").stability_measured, true);
    assert.equal(by(two, "BODY-01").scores.length, 2);
    const one = await run([(req) => ok(goodAnswer(req)), infra()], 3).p;
    assert.equal(by(one, "BODY-01").stability_measured, false);
    assert.equal(by(one, "BODY-01").unstable, false);
    assert.equal(by(one, "BODY-01").state, "scored");
    const none = await run([infra()], 3).p;
    assert.equal(none.allInfra, true);
    assert.ok(none.practices.every((x) => x.state === "not_run" && x.not_run_code === "infra"));
  });

  it("11. N=1 never measures stability", async () => {
    const o = await run([(req) => ok(goodAnswer(req))]).p;
    assert.equal(o.repeats, 1);
    assert.ok(o.practices.every((x) => !x.stability_measured));
  });

  it("12. repeats run in parallel with distinct nonces", async () => {
    let started = 0;
    let release: () => void = () => undefined;
    const latch = new Promise<void>((r) => (release = r));
    const { runner, p } = run([async (req) => {
      started++;
      if (started === 3) release();
      await latch;
      return ok(goodAnswer(req));
    }], 3);
    await p;
    assert.equal(started, 3);
    assert.equal(new Set(runner.calls.map((c) => nonceOf(c.prompt))).size, 3);
  });

  it("13. unsupported in every repeat is unsupported; infra in every repeat is infra", async () => {
    const bad = (req: JudgeRequest) => ok(goodAnswer(req, { per: { "BODY-01": { quote: "no such text" } } }));
    assert.equal(by(await run([bad], 2).p, "BODY-01").not_run_code, "unsupported");
    assert.equal(by(await run([infra()], 2).p, "BODY-01").not_run_code, "infra");
  });

  it("13b. a practice unsupported in one repeat and scored in another uses the scored one", async () => {
    const { p } = run([
      (req, n) => ok(goodAnswer(req, n === 0 || n === 1 ? { per: { "BODY-01": { quote: "no such text" } } } : {})),
    ], 2);
    // Parallel order: calls 0 and 1 are the two first calls; BODY-01 is bad in both, retried in calls 2 and 3, which are good.
    const o = await p;
    assert.equal(by(o, "BODY-01").state, "scored");
  });
});
