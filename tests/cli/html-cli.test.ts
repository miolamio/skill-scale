import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { main } from "../../src/cli.ts";
import type { CliIo } from "../../src/cli.ts";
import type { JudgeRequest } from "../../src/judge/types.ts";
import { fakeRunner, goodAnswer, infra, ok } from "../helpers/fake-runner.ts";
import type { Step } from "../helpers/fake-runner.ts";
import { GOOD_DIR, GOOD_FILES, tempDir, writeSkill } from "../helpers/skills.ts";

const SHIPPED = new URL("../../catalog/", import.meta.url).pathname;
const tmp = tempDir();
after(() => tmp.cleanup());
let n = 0;
const dir = writeSkill(tmp.path, GOOD_DIR, GOOD_FILES);

const isAdvisor = (req: JudgeRequest): boolean => req.system.includes("turns low practice scores");
const advisorIds = (req: JudgeRequest): string[] => (req.schema as any).properties.recommendations.items.properties.practice_ids.items.enum;

/** Judge answers score 1 everywhere; the advisor recommends the first id and sets the second aside. */
const judgeAndAdvise: Step = (req) => {
  if (!isAdvisor(req)) return ok(goodAnswer(req, { score: 1 }), 0.1, 1000);
  const [a, b] = advisorIds(req) as [string, string];
  return ok({
    recommendations: [{ title: "Rewrite the opening", priority: "high", practice_ids: [a], problem: "It is thin.", lines: [{ file: "SKILL.md", start: 1, end: 3 }], change: { kind: "diff", file: "SKILL.md", remove: ["# Good skill"], add: ["# Good skill (sales)"] }, note: null }],
    set_aside: [{ practice_id: b, reason: "Not needed here." }],
  }, 0.07, 500);
};

function setup(runner = fakeRunner([judgeAndAdvise])) {
  const out: string[] = [];
  const err: string[] = [];
  const cwd = join(tmp.path, `cwd${n++}`);
  mkdirSync(cwd);
  const io: CliIo = {
    stdout: (s) => void out.push(s),
    stderr: (s) => void err.push(s),
    fetcher: async () => { throw new Error("the network must not be used in tests"); },
    catalogDir: SHIPPED,
    version: "9.9.9",
    judgeRunner: runner,
    cwd,
  };
  return { io, cwd, runner, stdout: () => out.join(""), stderr: () => err.join("") };
}

describe("--format html", () => {
  it("is accepted, listed in --help, and an unknown format names it", async () => {
    const s = setup();
    assert.equal(await main(["--help"], s.io), 0);
    assert.match(s.stdout(), /--format console\|json\|html/);
    const t = setup();
    assert.equal(await main([dir, "--format", "pdf"], t.io), 2);
    assert.match(t.stderr(), /console, json or html/);
  });

  it("without --out writes ./<skill-name>.skill-scale.html and prints the path; never calls the runner offline", async () => {
    const s = setup();
    const code = await main([dir, "--format", "html"], s.io);
    assert.equal(code, 0);
    assert.equal(s.stdout().trim(), "./good-skill.skill-scale.html");
    const file = join(s.cwd, "good-skill.skill-scale.html");
    assert.ok(existsSync(file));
    const html = readFileSync(file, "utf8");
    assert.match(html, /<title>good-skill skill review<\/title>/);
    assert.ok(html.includes("https://github.com/miolamio/"));
    assert.ok(!/<script/i.test(html));
    assert.equal(s.runner.calls.length, 0);
  });

  it("with --out writes there and prints nothing", async () => {
    const s = setup();
    const out = join(tmp.path, `report${n++}.html`);
    assert.equal(await main([dir, "--format", "html", "--out", out], s.io), 0);
    assert.equal(s.stdout(), "");
    assert.match(readFileSync(out, "utf8"), /^<!doctype html>/);
    assert.ok(!existsSync(join(s.cwd, "good-skill.skill-scale.html")));
  });

  it("does not use the folder name when frontmatter has a name; hostile names stay inside the file name", async () => {
    const hostile = writeSkill(join(tmp.path, `h${n++}`), "x", { "SKILL.md": "---\nname: ../../evil name\ndescription: Does a thing. Use when asked.\n---\nbody\n" });
    const s = setup();
    await main([hostile, "--format", "html"], s.io);
    assert.match(s.stdout(), /^\.\/[A-Za-z0-9._-]+\.skill-scale\.html\n$/);
    assert.ok(!s.stdout().includes("/.."));
    assert.ok(existsSync(join(s.cwd, s.stdout().trim().slice(2))));
  });
});

describe("--judge --format html", () => {
  it("runs the judge, then one advisor call with the same model; its cost is added; the page shows the change", async () => {
    const s = setup();
    const out = join(tmp.path, `report${n++}.html`);
    const code = await main([dir, "--judge", "--model", "claude-test-1", "--format", "html", "--out", out], s.io);
    assert.equal(code, 0);
    assert.equal(s.runner.calls.length, 2);
    assert.ok(isAdvisor(s.runner.calls[1] as JudgeRequest));
    assert.ok(!isAdvisor(s.runner.calls[0] as JudgeRequest));
    for (const c of s.runner.calls) assert.equal(c.model, "claude-test-1");
    assert.match((s.runner.calls[1] as JudgeRequest).prompt, /<untrusted-skill-[0-9a-f]+>/);
    const html = readFileSync(out, "utf8");
    assert.match(html, /Rewrite the opening/);
    assert.ok(html.includes("# Good skill (sales)"));
    assert.match(html, /Findings set aside/);
    assert.ok(html.includes("Judge cost <b>$0.17</b>"));
    assert.match(html, /Changes proposed <b>1<\/b>/);
  });

  it("an advisor failure leaves a findings page with a note and the same exit code as json", async () => {
    const steps: Step[] = [(req) => (isAdvisor(req) ? infra("advisor exploded") : ok(goodAnswer(req, { score: 1 }), 0.1, 1000))];
    const s = setup(fakeRunner(steps));
    const out = join(tmp.path, `report${n++}.html`);
    const code = await main([dir, "--judge", "--format", "html", "--out", out], s.io);
    const j = setup(fakeRunner(steps));
    const jsonCode = await main([dir, "--judge", "--format", "json"], j.io);
    assert.equal(code, jsonCode);
    assert.equal(j.runner.calls.length, 1, "json never calls the advisor");
    const html = readFileSync(out, "utf8");
    assert.match(html, /Proposed changes are unavailable/);
    assert.ok(html.includes("advisor exploded"));
    assert.match(html, /<h2>Findings<\/h2>/);
  });

  it("an advisor answer in the wrong shape is a failure note, not a crash", async () => {
    const s = setup(fakeRunner([(req) => (isAdvisor(req) ? ok({ nonsense: true }) : ok(goodAnswer(req, { score: 1 })))]));
    const out = join(tmp.path, `report${n++}.html`);
    assert.equal(await main([dir, "--judge", "--format", "html", "--out", out], s.io), 0);
    assert.match(readFileSync(out, "utf8"), /Proposed changes are unavailable/);
  });

  it("no advisor call when the judge gave no usable answer (exit 2, page still written)", async () => {
    const s = setup(fakeRunner([infra()]));
    const out = join(tmp.path, `report${n++}.html`);
    assert.equal(await main([dir, "--judge", "--format", "html", "--out", out], s.io), 2);
    assert.equal(s.runner.calls.length, 1);
    assert.ok(existsSync(out));
  });

  it("no advisor call when nothing scored below 3", async () => {
    const s = setup(fakeRunner([(req) => (isAdvisor(req) ? infra() : ok(goodAnswer(req, { score: 3 })))]));
    const out = join(tmp.path, `report${n++}.html`);
    await main([dir, "--judge", "--format", "html", "--out", out], s.io);
    // the good skill has no mechanical findings, so every practice is 3
    assert.equal(s.runner.calls.length, 1);
  });
});
