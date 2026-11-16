import type { JudgeRequest, JudgeRunner, RawAnswer, RunnerResult } from "../../src/judge/types.ts";

export type Step = RunnerResult | ((req: JudgeRequest, call: number) => RunnerResult | Promise<RunnerResult>);

/** Plays the steps in order, one per call; the last step repeats. Records every request. */
export function fakeRunner(steps: Step[]): JudgeRunner & { calls: JudgeRequest[] } {
  const calls: JudgeRequest[] = [];
  return {
    calls,
    async run(req) {
      const n = calls.length;
      calls.push(req);
      const step = steps[Math.min(n, steps.length - 1)] as Step;
      return typeof step === "function" ? step(req, n) : step;
    },
  };
}

export const idsOf = (req: JudgeRequest): string[] =>
  ((req.schema as any).properties.results.items.properties.practice_id.enum as string[]);

/** The first non-empty numbered line of the first file in the prompt: { line, text }. */
export function firstLine(req: JudgeRequest): { line: number; text: string; file: string } {
  const file = /<file path="([^"]*)">/.exec(req.prompt)?.[1] ?? "SKILL.md";
  const start = req.prompt.indexOf("<file path=");
  for (const l of req.prompt.slice(req.prompt.indexOf("\n", start) + 1).split("\n")) {
    const m = /^(\d+)\t(.*)$/.exec(l);
    if (m && (m[2] as string).trim() !== "") return { line: Number(m[1]), text: m[2] as string, file };
  }
  throw new Error("no numbered line in prompt");
}

type Result = RawAnswer["results"][number];

/** A valid answer: every id scored `score`, quote = the first non-empty line of SKILL.md, line = its number. */
export function goodAnswer(
  req: JudgeRequest,
  o: { score?: number; per?: Record<string, Partial<Result>>; injection?: string | null; drop?: string[]; dup?: string[] } = {},
): RawAnswer {
  const first = firstLine(req);
  const results: Result[] = [];
  for (const id of idsOf(req)) {
    if (o.drop?.includes(id)) continue;
    const r: Result = { practice_id: id, status: "scored", score: o.score ?? 3, quote: first.text, file: first.file, line: first.line, reason: `reason for ${id}`, ...o.per?.[id] };
    results.push(r);
    if (o.dup?.includes(id)) results.push({ ...r });
  }
  return { results, injection: o.injection ?? null };
}

export const ok = (output: unknown, costUsd = 0.1, durationMs = 1000): RunnerResult => ({ ok: true, output, costUsd, durationMs });
export const infra = (reason = "exit 1"): RunnerResult => ({ ok: false, reason, costUsd: 0, durationMs: 10 });
