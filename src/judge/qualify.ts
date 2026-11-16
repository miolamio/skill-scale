import type { Catalogue, ProfileId } from "../catalog/types.ts";
import type { CriterionRecord } from "../score/score.ts";
import type { JudgePractice } from "./types.ts";

/** Practices the judge is asked about: judgement-assessable from the artifact, not experimental or contested, still open after the mechanical pass. */
export function qualifiedFor(cat: Catalogue, records: CriterionRecord[], profile: ProfileId): JudgePractice[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  const out: JudgePractice[] = [];
  for (const p of cat.practices) {
    if (!p.assess.includes("judgement") || p.assessable_from !== "artifact" || p.experimental || p.contested) continue;
    const rec = byId.get(p.id);
    if (!rec || rec.status !== "not_run") continue;
    out.push({
      id: p.id,
      title: p.title,
      strength_word: p.profile_rules?.[profile]?.strength_word ?? p.strength_word,
      anchors: rec.anchors,
      scope_note: p.scope_note ?? null,
    });
  }
  return out;
}
