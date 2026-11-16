import type { Finding } from "../checks/types.ts";

export interface JudgePractice {
  id: string; title: string; strength_word: string;
  anchors: Record<string, string>; scope_note: string | null;
}
export interface JudgeRequest { system: string; prompt: string; schema: object; model: string; timeoutMs: number }
export type RunnerResult =
  | { ok: true; output: unknown; costUsd: number; durationMs: number }
  | { ok: false; reason: string; costUsd: number; durationMs: number }; // reason is an infra description
export interface JudgeRunner { run(req: JudgeRequest): Promise<RunnerResult> }

export interface RawResult { practice_id: string; status: "scored" | "not_applicable"; score: number | null; quote: string; file: string; line: number; reason: string }
export interface RawAnswer { results: RawResult[]; injection: string | null }

/** One practice in one repeat, after validation and the single retry. */
export type RunResult =
  | { kind: "scored"; score: number; quote: string; file: string; line: number; reason: string }
  | { kind: "not_applicable"; reason: string; quote: string; file: string; line: number }
  | { kind: "not_run"; code: "infra" | "unsupported"; reason: string };

export interface PracticeJudgement {
  id: string;
  state: "scored" | "not_applicable" | "not_run";
  score: number | null;
  /** All numeric scores of the usable repeats, in repeat order. */
  scores: number[];
  unstable: boolean;
  /** Spread was computable (at least 2 usable repeats). */
  stability_measured: boolean;
  evidence: { quote: string; file: string; line: number; reason: string } | null;
  not_run_code: "infra" | "unsupported" | null;
  reason: string | null;
}
export interface JudgeOutcome {
  model: string; repeats: number; calls: number; costUsd: number; durationMs: number;
  /** True when no call at all produced a usable answer. The CLI exits 2. */
  allInfra: boolean;
  practices: PracticeJudgement[];
  injection: { text: string; repeat: number }[];
}
export type { Finding };
