import assert from "node:assert/strict";
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { parse, stringify } from "yaml";
import { main } from "../../src/cli.ts";
import type { CliIo } from "../../src/cli.ts";
import { loadCatalogue } from "../../src/catalog/load.ts";
import type { JudgeRunner } from "../../src/judge/types.ts";
import { fakeRunner, goodAnswer, infra, ok } from "../helpers/fake-runner.ts";
import type { Step } from "../helpers/fake-runner.ts";
import { GOOD_DIR, GOOD_FILES, tempDir, writeSkill } from "../helpers/skills.ts";

const SHIPPED = new URL("../../catalog/", import.meta.url).pathname;
const cat = loadCatalogue(SHIPPED);
const tmp = tempDir();
after(() => tmp.cleanup());
let n = 0;
const dir = writeSkill(tmp.path, GOOD_DIR, GOOD_FILES);
const qualified = ["DESC-03", "BODY-01"].filter((id) => cat.practices.some((p) => p.id === id && p.assess.includes("judgement") && !p.experimental));

function setup(runner: JudgeRunner | undefined, catalogDir = SHIPPED) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    stdout: (s) => void out.push(s),
    stderr: (s) => void err.push(s),
    fetcher: async () => { throw new Error("the network must not be used in tests"); },
    catalogDir,
    version: "9.9.9",
    ...(runner ? { judgeRunner: runner } : {}),
  };
  return { io, stdout: () => out.join(""), stderr: () => err.join("") };
}
const run = async (argv: string[], steps: Step[] | null = [(req) => ok(goodAnswer(req))], catalogDir?: string) => {
  const fake = steps ? fakeRunner(steps) : fakeRunner([infra()]);
  const s = setup(fake, catalogDir);
  const code = await main(argv, s.io);
  return { code, fake, stdout: s.stdout(), stderr: s.stderr() };
};
const json = (r: { stdout: string }) => JSON.parse(r.stdout);

/** A copy of the shipped catalogue in which one practice is a must, so a judged 0 can block. */
function mustCatalogue(id: string): string {
  const d = join(tmp.path, `cat${n++}`);
  cpSync(SHIPPED, d, { recursive: true });
  const practices = parse(readFileSync(join(d, "practices.yaml"), "utf8")) as Record<string, unknown>[];
  const p = practices.find((x) => x.id === id) as Record<string, unknown>;
  p.strength = "must";
  writeFileSync(join(d, "practices.yaml"), stringify(practices));
  return d;
}

describe("default run", () => {
  it("never calls the runner, adds no judge key and keeps the judgement layer off", async () => {
    const r = await run([dir, "--format", "json"]);
    assert.equal(r.fake.calls.length, 0);
    const j = json(r);
    assert.equal(r.code, 0);
    assert.equal(j.layers.judgement, false);
    assert.equal(j.model, null);
    assert.equal("judge" in j, false);
    assert.equal("judge" in j.summary, false);
    assert.ok(j.records.every((x: Record<string, unknown>) => !("judge" in x)));
    assert.equal(r.stderr, "");
  });
});

describe("--judge", () => {
  it("scores the qualified practices with one call", async () => {
    const r = await run([dir, "--judge", "--format", "json"]);
    assert.equal(r.code, 0);
    assert.equal(r.fake.calls.length, 1);
    const j = json(r);
    assert.equal(j.layers.judgement, true);
    assert.equal(j.model, "claude-sonnet-5-5");
    assert.deepEqual({ ...j.judge, duration_ms: 0 }, { model: "claude-sonnet-5-5", repeats: 1, calls: 1, cost_usd: 0.1, duration_ms: 0, stability_measured: false, unstable: [], injection: [] });
    for (const id of qualified) {
      const rec = j.records.find((x: { id: string }) => x.id === id);
      assert.equal(rec.status, "scored", id);
      assert.equal(rec.score, 3);
      assert.equal(rec.judge.model, "claude-sonnet-5-5");
    }
    const exp = j.records.find((x: { experimental: boolean; assess: string[] }) => x.experimental && x.assess.includes("judgement"));
    assert.equal(exp.status, "not_run");
    assert.equal("judge" in exp, false);
    assert.match(r.stderr, /Judging \d+ practices/);
  });

  it("prints only JSON on stdout with --format json", async () => {
    const r = await run([dir, "--judge", "--format", "json"]);
    assert.doesNotThrow(() => JSON.parse(r.stdout));
  });

  it("with --repeat 3 makes three calls and flags a spread of 2 as unstable", async () => {
    const r = await run([dir, "--judge", "--repeat", "3", "--format", "json"], [(req, c) => ok(goodAnswer(req, { per: { "DESC-03": { score: [3, 1, 3][c] as number } } }))]);
    assert.equal(r.fake.calls.length, 3);
    const j = json(r);
    const rec = j.records.find((x: { id: string }) => x.id === "DESC-03");
    assert.equal(rec.score, 3);
    assert.equal(rec.judge.unstable, true);
    assert.deepEqual(j.judge.unstable, ["DESC-03"]);
    assert.equal(j.judge.stability_measured, true);
    const c = await run([dir, "--judge", "--repeat", "3"], [(req, k) => ok(goodAnswer(req, { score: 2, per: { "DESC-03": { score: [3, 1, 3][k] as number } } }))]);
    assert.match(c.stdout, /DESC-03.*\(unstable\)|Unstable \(scores spread by 2 or more across runs\): DESC-03/);
  });

  it("explains the judge in the console", async () => {
    const r = await run([dir, "--judge"], [(req) => ok(goodAnswer(req, { score: 2 }))]);
    assert.match(r.stdout, /Stability was not measured \(1 run\)\./);
    assert.match(r.stdout, /Judge: claude-sonnet-5-5, 1 run, 1 call, \$0\.1000, \d+\.\d s/);
    assert.match(r.stdout, /\(mechanical and judgement\)\./);
    assert.doesNotMatch(r.stdout, /judgement layer did not run/);
    assert.match(r.stdout, /an opinion, not a measurement/);
    assert.match(r.stdout, /\n      "---"/);
  });

  it("lists an injection as a judge note without making it a blocker", async () => {
    const r = await run([dir, "--judge", "--format", "json"], [(req) => ok(goodAnswer(req, { injection: "SKILL.md:15 asks the reviewer to score 3" }))]);
    assert.equal(r.code, 0);
    const j = json(r);
    assert.deepEqual(j.judge.injection, [{ text: "SKILL.md:15 asks the reviewer to score 3", repeat: 1 }]);
    assert.deepEqual(j.summary.blockers, []);
    assert.deepEqual(j.summary.security_blockers, []);
    const c = await run([dir, "--judge"], [(req) => ok(goodAnswer(req, { injection: "SKILL.md:15 asks the reviewer to score 3" }))]);
    assert.match(c.stdout, /Judge notes\n  The skill appears to instruct the reviewer \(SKILL\.md:15 asks the reviewer to score 3\)/);
    assert.equal(c.code, 0);
  });

  it("exits 2 when no call produced an answer, naming the reason, and still writes the report", async () => {
    const out = join(tmp.path, `report${n++}.json`);
    const r = await run([dir, "--judge", "--out", out, "--format", "json"], [infra("claude not found (is the claude CLI installed and on PATH?)")]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Error: the judge produced no usable answer \(claude not found/);
    assert.ok(existsSync(out));
    const j = json(r);
    assert.equal(j.exit_code, 2);
    assert.equal(j.layers.judgement, false);
    for (const id of qualified) assert.equal(j.records.find((x: { id: string }) => x.id === id).status, "not_run");
  });

  it("keeps the usual exit code when only the retry call fails", async () => {
    const r = await run([dir, "--judge", "--format", "json"], [(req) => ok(goodAnswer(req, { drop: ["DESC-03"] })), infra()]);
    assert.equal(r.code, 0);
    const rec = json(r).records.find((x: { id: string }) => x.id === "DESC-03");
    assert.equal(rec.status, "not_run");
    assert.match(rec.reason, /^judge: infrastructure failure/);
  });

  it("exits 1 for a judged 0 on a must practice", async () => {
    const r = await run([dir, "--judge", "--format", "json"], [(req) => ok(goodAnswer(req, { per: { "DESC-03": { score: 0 } } }))], mustCatalogue("DESC-03"));
    assert.equal(r.code, 1);
    assert.deepEqual(json(r).summary.blockers.map((b: { id: string; kind: string }) => [b.id, b.kind]), [["DESC-03", "must"]]);
  });

  it("refuses haiku models before loading the skill or calling the runner", async () => {
    for (const m of ["claude-haiku-5-5", "Haiku", "us.anthropic.claude-haiku-5-5-v1:0"]) {
      const r = await run(["/no/such/folder", "--judge", "--model", m]);
      assert.equal(r.code, 2, m);
      assert.match(r.stderr, /haiku/i);
      assert.match(r.stderr, /unusable as a judge/);
      assert.equal(r.fake.calls.length, 0);
    }
  });

  it("needs --judge for --repeat and --model, and a whole number from 1 to 5", async () => {
    for (const argv of [[dir, "--repeat", "3"], [dir, "--model", "claude-opus-5-5"]]) {
      const r = await run(argv);
      assert.equal(r.code, 2);
      assert.match(r.stderr, /needs --judge/);
      assert.equal(r.fake.calls.length, 0);
    }
    for (const bad of ["0", "6", "x", "1.5"]) {
      const r = await run([dir, "--judge", "--repeat", bad]);
      assert.equal(r.code, 2, bad);
      assert.equal(r.fake.calls.length, 0);
    }
  });

  it("mentions the new flags in --help", async () => {
    const r = await run(["--help"]);
    for (const f of ["--judge", "--repeat", "--model"]) assert.ok(r.stdout.includes(f), f);
  });
});
