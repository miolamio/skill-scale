import assert from "node:assert/strict";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { claudeRunner } from "../../src/judge/runner.ts";
import type { Exec } from "../../src/judge/runner.ts";
import type { JudgeRequest } from "../../src/judge/types.ts";
import { tempDir } from "../helpers/skills.ts";

const tmp = tempDir();
after(() => tmp.cleanup());
const req: JudgeRequest = { system: "SYS", prompt: "PROMPT-TEXT", schema: { type: "object" }, model: "claude-sonnet-5-5", timeoutMs: 5000 };
const goodJson = JSON.stringify({ is_error: false, structured_output: { results: [], injection: null }, total_cost_usd: 0.12, duration_ms: 18000, result: "x" });
const done = (o: Partial<Awaited<ReturnType<Exec>>> = {}) => ({ code: 0, stdout: goodJson, stderr: "", timedOut: false, ...o });

describe("claudeRunner", () => {
  it("builds the isolated argument vector and sends the prompt on stdin", async () => {
    let seen: { args: string[]; input: string } | undefined;
    const exec: Exec = async (_c, args, o) => { seen = { args, input: o.input }; return done(); };
    await claudeRunner({ exec, tmpRoot: tmp.path }).run(req);
    assert.deepEqual(seen?.args, [
      "-p", "--output-format", "json", "--tools", "", "--setting-sources", "project,local", "--strict-mcp-config",
      "--disable-slash-commands", "--no-session-persistence", "--system-prompt", "SYS", "--model", "claude-sonnet-5-5",
      "--json-schema", JSON.stringify(req.schema),
    ]);
    assert.equal(seen?.input, "PROMPT-TEXT");
    assert.ok(!seen?.args.includes("PROMPT-TEXT"));
  });

  it("passes the environment through unchanged, auth variables included", async () => {
    process.env.ANTHROPIC_API_KEY = "x";
    let key: string | undefined;
    const exec: Exec = async (_c, _a, o) => { key = o.env.ANTHROPIC_API_KEY; return done(); };
    try {
      await claudeRunner({ exec, tmpRoot: tmp.path }).run(req);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
    assert.equal(key, "x");
  });

  it("uses a fresh empty directory under tmpRoot per call and removes it afterwards", async () => {
    const dirs: string[] = [];
    const exec: Exec = async (_c, _a, o) => { assert.ok(existsSync(o.cwd)); dirs.push(o.cwd); return done(); };
    const r = claudeRunner({ exec, tmpRoot: tmp.path });
    await r.run(req);
    await r.run(req);
    assert.notEqual(dirs[0], dirs[1]);
    for (const d of dirs) {
      assert.ok(d.startsWith(tmp.path));
      assert.ok(!existsSync(d));
    }
  });

  it("removes the directory after a throw and after a timeout", async () => {
    const dirs: string[] = [];
    await claudeRunner({ exec: async (_c, _a, o) => { dirs.push(o.cwd); throw Object.assign(new Error("boom"), { code: "EOTHER" }); }, tmpRoot: tmp.path }).run(req);
    await claudeRunner({ exec: async (_c, _a, o) => { dirs.push(o.cwd); return done({ timedOut: true, stdout: "" }); }, tmpRoot: tmp.path }).run(req);
    assert.equal(dirs.length, 2);
    for (const d of dirs) assert.ok(!existsSync(d));
  });

  it("returns the structured output, cost and duration of a good call", async () => {
    const r = await claudeRunner({ exec: async () => done(), tmpRoot: tmp.path }).run(req);
    assert.deepEqual(r, { ok: true, output: { results: [], injection: null }, costUsd: 0.12, durationMs: 18000 });
  });

  it("falls back to measured wall time when the CLI gives no duration", async () => {
    const stdout = JSON.stringify({ is_error: false, structured_output: {}, total_cost_usd: 0.01 });
    const r = await claudeRunner({ exec: async () => done({ stdout }), tmpRoot: tmp.path }).run(req);
    assert.ok(r.ok && r.durationMs >= 0 && r.costUsd === 0.01);
  });

  const failures: [string, Awaited<ReturnType<Exec>> | Error | ((cwd: string) => Awaited<ReturnType<Exec>>), RegExp][] = [
    ["non-zero exit", done({ code: 1, stderr: "login required" }), /exited with code 1.*login required/],
    ["timeout", done({ timedOut: true }), /timed out/],
    ["not JSON", done({ stdout: "oops" }), /not JSON/],
    ["is_error", done({ stdout: JSON.stringify({ is_error: true, total_cost_usd: 0.05, structured_output: {} }) }), /is_error/],
    ["structured_output absent", done({ stdout: JSON.stringify({ is_error: false, total_cost_usd: 0.05 }) }), /structured_output/],
    ["structured_output not an object", done({ stdout: JSON.stringify({ is_error: false, structured_output: "x", total_cost_usd: 0.05 }) }), /structured_output/],
    ["leftover file", (cwd) => { writeFileSync(join(cwd, "stray.txt"), "x"); return done(); }, /left files/],
    ["claude missing", Object.assign(new Error("claude ENOENT"), { code: "ENOENT" }), /claude not found/],
  ];
  for (const [label, behaviour, pattern] of failures)
    it(`reports an infrastructure failure for: ${label}`, async () => {
      const exec: Exec = async (_c, _a, o) => {
        if (behaviour instanceof Error) throw behaviour;
        return typeof behaviour === "function" ? behaviour(o.cwd) : behaviour;
      };
      const r = await claudeRunner({ exec, tmpRoot: tmp.path }).run(req);
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.match(r.reason, pattern);
        assert.ok(!r.reason.includes("PROMPT-TEXT"));
        if (label === "is_error" || label.startsWith("structured")) assert.equal(r.costUsd, 0.05);
      }
    });

  it("leaves no directory behind in tmpRoot", () => {
    assert.deepEqual(readdirSync(tmp.path).filter((n) => n.startsWith("skill-scale-judge-")), []);
  });
});
