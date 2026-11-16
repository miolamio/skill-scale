import type { SkillModel } from "../loader/skill.ts";
import { buildSchema, buildUserMessage, judgeFiles, newNonce, SYSTEM_PROMPT } from "./prompt.ts";
import type { JudgeOutcome, JudgePractice, JudgeRunner, PracticeJudgement, RunResult } from "./types.ts";
import { validateAnswer } from "./validate.ts";

const DEFAULT_TIMEOUT_MS = 300_000;
const NO_RESULT = "judge returned no result for this practice";

interface OnceResult {
  results: Map<string, RunResult>;
  injection: string[];
  calls: number;
  costUsd: number;
  anyOk: boolean;
}

const injectionOf = (answer: unknown): string | null => {
  const inj = typeof answer === "object" && answer !== null ? (answer as { injection?: unknown }).injection : null;
  return typeof inj === "string" && inj.trim() !== "" ? inj.trim() : null;
};

export async function judgeSkill(o: {
  skill: SkillModel;
  practices: JudgePractice[];
  runner: JudgeRunner;
  model: string;
  repeats: number;
  timeoutMs?: number;
  nonce?: () => string;
  now?: () => number;
}): Promise<JudgeOutcome> {
  const now = o.now ?? Date.now;
  const nonce = o.nonce ?? newNonce;
  const started = now();
  const files = judgeFiles(o.skill);

  const ask = async (batch: JudgePractice[]) => {
    const res = await o.runner.run({
      system: SYSTEM_PROMPT,
      prompt: buildUserMessage(o.skill, batch, nonce()),
      schema: buildSchema(batch.map((p) => p.id)),
      model: o.model,
      timeoutMs: o.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    return res;
  };

  const judgeOnce = async (): Promise<OnceResult> => {
    const ids = o.practices.map((p) => p.id);
    const out: OnceResult = { results: new Map(), injection: [], calls: 1, costUsd: 0, anyOk: false };
    const infraAll = (batch: string[], reason: string): void => {
      for (const id of batch) out.results.set(id, { kind: "not_run", code: "infra", reason });
    };
    const first = await ask(o.practices);
    out.costUsd += first.costUsd;
    if (!first.ok) {
      infraAll(ids, first.reason);
      return out;
    }
    out.anyOk = true;
    const i1 = injectionOf(first.output);
    if (i1) out.injection.push(i1);
    const v1 = validateAnswer(first.output, ids, files);
    for (const [id, r] of v1.accepted) out.results.set(id, r);
    if (v1.failing.length === 0) return out;

    const retryIds = v1.failing.map((f) => f.id);
    const second = await ask(o.practices.filter((p) => retryIds.includes(p.id)));
    out.calls++;
    out.costUsd += second.costUsd;
    if (!second.ok) {
      infraAll(retryIds, second.reason);
      return out;
    }
    const i2 = injectionOf(second.output);
    if (i2) out.injection.push(i2);
    const v2 = validateAnswer(second.output, retryIds, files);
    for (const [id, r] of v2.accepted) out.results.set(id, r);
    for (const f of v2.failing)
      out.results.set(f.id, f.kind === "unsupported" ? { kind: "not_run", code: "unsupported", reason: f.detail } : { kind: "not_run", code: "infra", reason: NO_RESULT });
    return out;
  };

  const runs = await Promise.all(Array.from({ length: o.repeats }, judgeOnce));

  const practices = o.practices.map((p): PracticeJudgement => {
    const mine = runs.map((r) => r.results.get(p.id) as RunResult);
    const usable = mine.filter((r): r is Exclude<RunResult, { kind: "not_run" }> => r.kind !== "not_run");
    const base = { id: p.id, stability_measured: usable.length >= 2 };
    if (usable.length === 0) {
      const notRun = mine.filter((r): r is Extract<RunResult, { kind: "not_run" }> => r.kind === "not_run");
      const unsupported = notRun.find((r) => r.code === "unsupported");
      const pick = unsupported ?? (notRun[0] as Extract<RunResult, { kind: "not_run" }>);
      return { ...base, state: "not_run", score: null, scores: [], unstable: false, evidence: null, not_run_code: pick.code, reason: pick.reason };
    }
    const scored = usable.filter((r): r is Extract<RunResult, { kind: "scored" }> => r.kind === "scored");
    const scores = scored.map((r) => r.score);
    const na = usable.filter((r) => r.kind === "not_applicable");
    if (na.length > usable.length / 2) {
      const e = na[0] as Extract<RunResult, { kind: "not_applicable" }>;
      return { ...base, state: "not_applicable", score: null, scores, unstable: false, evidence: { quote: e.quote, file: e.file, line: e.line, reason: e.reason }, not_run_code: null, reason: e.reason };
    }
    const sorted = [...scores].sort((a, b) => a - b);
    const median = sorted[(sorted.length - 1) >> 1] as number;
    const e = scored.find((r) => r.score === median) as Extract<RunResult, { kind: "scored" }>;
    const unstable = sorted.length >= 2 && (sorted[sorted.length - 1] as number) - (sorted[0] as number) >= 2;
    return { ...base, state: "scored", score: median, scores, unstable, evidence: { quote: e.quote, file: e.file, line: e.line, reason: e.reason }, not_run_code: null, reason: null };
  });

  const injection: { text: string; repeat: number }[] = [];
  runs.forEach((r, i) => {
    for (const text of r.injection) if (!injection.some((x) => x.text === text)) injection.push({ text, repeat: i + 1 });
  });

  return {
    model: o.model,
    repeats: o.repeats,
    calls: runs.reduce((a, r) => a + r.calls, 0),
    costUsd: runs.reduce((a, r) => a + r.costUsd, 0),
    durationMs: now() - started,
    allInfra: runs.every((r) => !r.anyOk),
    practices,
    injection,
  };
}
