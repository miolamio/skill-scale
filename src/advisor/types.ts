import type { CriterionRecord } from "../score/score.ts";

export type Priority = "high" | "medium" | "low";

/** A proposed edit. `remove` lines were verified against the file for kind "diff". */
export interface AdviceChange {
  kind: "diff" | "add" | "new_file";
  file: string;
  after_line?: number;
  /** For a diff: the 1-based line where the `remove` block starts, found when the advice was validated. */
  line?: number;
  remove: string[];
  add: string[];
}

export interface AdviceLines { file: string; start: number; end: number }

export interface Recommendation {
  title: string;
  priority: Priority;
  practice_ids: string[];
  problem: string;
  lines: AdviceLines[];
  change: AdviceChange | null;
  note: string | null;
  /** Taken from the catalogue quotes of `practice_ids`, never from the model. */
  quotes: CriterionRecord["quotes"];
}

export interface SetAside { practice_id: string; reason: string }

export interface Advice {
  recommendations: Recommendation[];
  set_aside: SetAside[];
  /** Practices that were sent and are neither recommended nor set aside, in the order they were sent. */
  other: string[];
}

export type AdvisorResult =
  | { ok: true; advice: Advice; costUsd: number; durationMs: number }
  | { ok: false; reason: string; costUsd: number; durationMs: number };

export interface Sibling { name: string; description: string }
