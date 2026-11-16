import type { CriterionRecord, JudgeDetail } from "../score/score.ts";
import type { Finding, JudgeOutcome, PracticeJudgement } from "./types.ts";

function detail(o: JudgeOutcome, j: PracticeJudgement): JudgeDetail {
  return {
    model: o.model,
    repeats: o.repeats,
    scores: j.scores,
    unstable: j.unstable,
    stability_measured: j.stability_measured,
    quote: j.evidence?.quote ?? null,
    file: j.evidence?.file ?? null,
    line: j.evidence?.line ?? null,
    reason: j.reason ?? j.evidence?.reason ?? null,
    not_run_code: j.not_run_code,
  };
}

/**
 * Writes the judge's answers into the records. A mechanical finding on the same practice stays in `evidence`, after the
 * judge's own finding: the judge's score is the record's score (spec section 7, mixed practices). A practice the judge was
 * not asked about is returned untouched. Nothing here ever produces a score of 0 from a failure.
 */
export function applyJudge(records: CriterionRecord[], outcome: JudgeOutcome): CriterionRecord[] {
  const byId = new Map(outcome.practices.map((p) => [p.id, p]));
  return records.map((r): CriterionRecord => {
    const j = byId.get(r.id);
    if (!j) return r;
    const judge = detail(outcome, j);
    if (j.state === "scored" && j.evidence) {
      const finding: Finding = { practice: r.id, message: j.evidence.reason, file: j.evidence.file, line: j.evidence.line, evidence: j.evidence.quote };
      return { ...r, status: "scored", score: j.score, reason: null, evidence: [finding, ...r.evidence], judge };
    }
    if (j.state === "not_applicable") return { ...r, status: "not_applicable", score: null, reason: j.reason ?? "judged not applicable", judge };
    const why = j.reason ?? "no reason given";
    const reason = j.not_run_code === "unsupported" ? `judge: no verified evidence (${why})` : `judge: infrastructure failure (${why})`;
    return { ...r, status: "not_run", score: null, reason, judge };
  });
}
