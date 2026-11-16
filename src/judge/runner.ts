import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JudgeRequest, JudgeRunner, RunnerResult } from "./types.ts";

export type Exec = (
  cmd: string,
  args: string[],
  opts: { input: string; cwd: string; timeoutMs: number; env: NodeJS.ProcessEnv },
) => Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>;

const MAX_OUTPUT = 64 * 1024 * 1024;

export const defaultExec: Exec = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (d: string) => { if (stdout.length < MAX_OUTPUT) stdout += d; });
    child.stderr.setEncoding("utf8").on("data", (d: string) => { if (stderr.length < MAX_OUTPUT) stderr += d; });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
    child.stdin.on("error", () => undefined);
    child.stdin.end(opts.input);
  });

/** Arguments of the isolated `claude -p` call. The prompt goes through stdin, never argv. */
export function claudeArgs(req: JudgeRequest): string[] {
  return [
    "-p", "--output-format", "json", "--tools", "", "--setting-sources", "project,local", "--strict-mcp-config",
    "--disable-slash-commands", "--no-session-persistence", "--system-prompt", req.system, "--model", req.model,
    "--json-schema", JSON.stringify(req.schema),
  ];
}

/** The one place that knows the shape of the CLI's JSON. Anything unexpected is an infrastructure failure, never a score. */
function parseCliJson(stdout: string): { cost: number; duration: number | null; output: unknown } | { error: string; cost: number } {
  let j: unknown;
  try {
    j = JSON.parse(stdout);
  } catch {
    return { error: "claude printed output that is not JSON", cost: 0 };
  }
  if (typeof j !== "object" || j === null || Array.isArray(j)) return { error: "claude printed JSON that is not an object", cost: 0 };
  const o = j as Record<string, unknown>;
  const cost = typeof o.total_cost_usd === "number" ? o.total_cost_usd : 0;
  const duration = typeof o.duration_ms === "number" ? o.duration_ms : null;
  if (o.is_error === true) return { error: "claude reported an error (is_error)", cost };
  const so = o.structured_output;
  if (typeof so !== "object" || so === null) return { error: "claude returned no structured_output", cost };
  return { cost, duration, output: so };
}

export function claudeRunner(opts: { exec?: Exec; claudeBin?: string; tmpRoot?: string } = {}): JudgeRunner {
  const exec = opts.exec ?? defaultExec;
  const bin = opts.claudeBin ?? "claude";
  return {
    async run(req: JudgeRequest): Promise<RunnerResult> {
      const started = Date.now();
      const wall = (): number => Date.now() - started;
      const dir = mkdtempSync(join(opts.tmpRoot ?? tmpdir(), "skill-scale-judge-"));
      try {
        let res;
        try {
          res = await exec(bin, claudeArgs(req), { input: req.prompt, cwd: dir, timeoutMs: req.timeoutMs, env: process.env });
        } catch (e) {
          const code = (e as { code?: string }).code;
          const why = code === "ENOENT" ? `claude not found (is the claude CLI installed and on PATH?)` : `could not run claude: ${(e as Error).message.slice(0, 300)}`;
          return { ok: false, reason: why, costUsd: 0, durationMs: wall() };
        }
        if (res.timedOut) return { ok: false, reason: `claude timed out after ${Math.round(req.timeoutMs / 1000)} s`, costUsd: 0, durationMs: wall() };
        const parsed = parseCliJson(res.stdout);
        const cost = parsed.cost;
        if (res.code !== 0) {
          const err = res.stderr.trim().slice(0, 300);
          return { ok: false, reason: `claude exited with code ${res.code}${err ? `: ${err}` : ""}`, costUsd: cost, durationMs: wall() };
        }
        if (readdirSync(dir).length > 0) return { ok: false, reason: "claude left files in its working directory", costUsd: cost, durationMs: wall() };
        if ("error" in parsed) return { ok: false, reason: parsed.error, costUsd: cost, durationMs: wall() };
        return { ok: true, output: parsed.output, costUsd: parsed.cost, durationMs: parsed.duration ?? wall() };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
