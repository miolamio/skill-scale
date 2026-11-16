import { paramsFor, render } from "../catalog/params.ts";
import type { Catalogue, Practice, ProfileId, Strength } from "../catalog/types.ts";
import { isMechanicalOnly } from "../catalog/types.ts";
import { ContractError } from "../checks/types.ts";
import type { Check, Effect, Finding } from "../checks/types.ts";
import type { SkillModel } from "../loader/skill.ts";

/** What the judge said about one practice. Fields that do not apply are null. */
export interface JudgeDetail {
  model: string;
  repeats: number;
  scores: number[];
  unstable: boolean;
  stability_measured: boolean;
  quote: string | null;
  file: string | null;
  line: number | null;
  reason: string | null;
  not_run_code: "infra" | "unsupported" | null;
}

export type Status = "scored" | "not_run" | "not_applicable" | "contested" | "process";

export interface CriterionRecord {
  id: string;
  area: string;
  title: string;
  status: Status;
  /** 0 to 3 when status is scored. For contested records it is shown for information only. */
  score: number | null;
  reason: string | null;
  strength: Strength;
  freshness: string;
  contested: boolean;
  experimental: boolean;
  /** Why the practice is experimental, or null. */
  experimental_reason: string | null;
  assess: string[];
  /** Anchors and fix hint are our inference, never Anthropic's words. The active profile's numbers are filled in. */
  anchors: Record<string, string>;
  anchors_inferred: true;
  fix_hint: string | null;
  /** When the practice applies (our inference). A reviewer records not_applicable where it does not. */
  scope_note: string | null;
  evidence: Finding[];
  /** Present only when the judge ran (`--judge`) and was asked about this practice. */
  judge?: JudgeDetail;
  quotes: { text: string; source: string; section: string; older: boolean }[];
}

export interface AreaSummary {
  area: string;
  /** Mean of scored, non-experimental criteria, or null when none were scored. */
  mean: number | null;
  scored: number;
  /** Criteria the scale can score in principle for this profile: scored, not_run and contested. */
  assessable: number;
  not_run: number;
  contested: number;
  process: number;
  not_applicable: number;
  experimental: number;
}

export interface Blocker {
  id: string;
  /** must: the practice is a must for the active profile. effect: a finding states what Claude Code does with the defect. */
  kind: "must" | "effect";
  effect: Effect | null;
  lb: string[];
  title: string;
  reason: string;
  file: string | null;
  line: number | null;
}

/** A finding from a check marked `security`. It blocks in every profile (SKM-34) and is listed apart from `Blocker`. */
export interface SecurityBlocker {
  id: string;
  /** The named risk of the check, for example credential_exposure. */
  risk: string;
  title: string;
  reason: string;
  file: string | null;
  line: number | null;
}

/** A security finding that an inline `skill-scale: ignore SAFE-02` marker suppressed. Listed, never blocking. */
export interface SuppressedSecurity {
  id: string;
  risk: string;
  file: string | null;
  line: number | null;
  reason: "inline marker";
}

export const LAYERS = ["mechanical", "judgement", "live"] as const;

export interface Summary {
  /** Every record, whatever its state. */
  total: number;
  /** Scored practices that count: experimental ones are left out. */
  scored: number;
  /** Scored practices that are experimental: shown, but not counted in scored, area means or blockers. */
  experimental: number;
  /** Layers that produced at least one score, counted from the records. */
  scored_by: string[];
  /** Layers some record names that produced no score, so the assessment is incomplete. */
  layers_not_run: string[];
  /** Scored, non-experimental practices whose freshness is stale-unconfirmed. */
  stale_unconfirmed: string[];
  not_run: number;
  not_applicable: number;
  contested: number;
  process: number;
  areas: AreaSummary[];
  blockers: Blocker[];
  /** Findings of security checks. Kept apart from `blockers`; both make the exit code 1. */
  security_blockers: SecurityBlocker[];
  /** Security findings suppressed by an inline marker: visible, but not blockers and not in the score. */
  suppressed_security: SuppressedSecurity[];
  /** Set by the CLI after `summarise`, only when the judge ran. */
  judge?: {
    model: string;
    repeats: number;
    calls: number;
    cost_usd: number;
    duration_ms: number;
    stability_measured: boolean;
    unstable: string[];
    injection: { text: string; repeat: number }[];
  };
}

export const EXIT = { OK: 0, BLOCKERS: 1, FAILURE: 2 } as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

function notRunReason(p: Practice, hasCheck: boolean, judgeOn: boolean): string {
  if (p.assess.includes("live") && !p.assess.includes("judgement") && !p.assess.includes("mechanical")) return "needs a live run (--live), which this version does not have";
  if (p.assess.includes("judgement")) {
    if (!judgeOn) return "needs the judgement layer (run with --judge)";
    return p.experimental ? "experimental judgement practice, not sent to the judge" : "judgement practice that needs more than the skill files, not sent to the judge";
  }
  if (p.assess.includes("live")) return "needs a live run (--live), which this version does not have";
  return hasCheck ? "the check did not run" : "no mechanical check is implemented for this practice yet";
}

/** A finding with an effect, or an LB ID, that the check did not declare in `effects` is a programming error, not a score. */
function assertEffectsDeclared(check: Check, findings: Finding[]): void {
  const declared = new Set(check.effects ?? []);
  for (const f of findings) {
    if (f.effect === undefined && (f.lb ?? []).length === 0) continue;
    const ids = f.lb ?? [];
    const undeclared = ids.filter((lb) => !declared.has(lb));
    if (ids.length === 0 || undeclared.length > 0)
      throw new ContractError(`${check.practice}: a finding carries the effect ${f.effect ?? "(none)"} with ${ids.length === 0 ? "no LB ID" : undeclared.join(", ")}, which the check does not declare in \`effects\``);
  }
}

export function buildRecords(cat: Catalogue, skill: SkillModel, profile: ProfileId, checks: ReadonlyMap<string, Check>, opts: { judge?: boolean } = {}): CriterionRecord[] {
  const judgeOn = opts.judge === true;
  const sources = new Map(cat.sources.map((s) => [s.id, s]));
  return cat.practices.map((p): CriterionRecord => {
    const params = paramsFor(p, profile);
    const check = checks.get(p.id);
    const base = {
      id: p.id,
      area: p.area,
      title: p.title,
      strength: p.profile_rules?.[profile]?.strength ?? p.strength,
      freshness: p.freshness,
      contested: p.contested,
      experimental: p.experimental,
      experimental_reason: p.experimental ? (p.experimental_reason ?? null) : null,
      assess: p.assess,
      anchors: Object.fromEntries(Object.entries(p.anchors ?? {}).map(([k, v]) => [k, render(v, params)])),
      anchors_inferred: true as const,
      fix_hint: p.fix_hint ? render(p.fix_hint, params) : null,
      scope_note: p.scope_note ?? null,
      quotes: p.quotes.map((q) => ({ text: q.text, source: q.source, section: q.section, older: q.older === true })),
    };
    const done = (status: Status, score: number | null, reason: string | null, evidence: Finding[] = []): CriterionRecord => ({ ...base, status, score, reason, evidence });

    if (!p.profiles.includes(profile)) return done("not_applicable", null, `not part of the ${profile} profile${p.scope_note ? `: ${p.scope_note}` : ""}`);
    if (p.assessable_from === "process") return done("process", null, "concerns how the skill was authored; it goes to the process checklist");

    const outcome = check ? check.run({ skill, profile, params }) : null;
    // SKM-31: runs before every status decision, so no flag on the practice can hide an effect blocker.
    if (check && outcome?.kind === "ran") assertEffectsDeclared(check, outcome.findings);
    if (outcome?.kind === "not_applicable") return done("not_applicable", null, outcome.reason);
    if (p.contested) {
      const info = outcome?.kind === "ran" ? (outcome.findings.length === 0 ? 3 : 0) : null;
      return done("contested", info, "official sources disagree; see the quotes", outcome?.kind === "ran" ? outcome.findings : []);
    }
    if (outcome === null) return done("not_run", null, notRunReason(p, false, judgeOn));
    if (outcome.kind === "not_run") return done("not_run", null, outcome.reason);
    // A check on a practice that also needs judgement or a live run only yields signals; it never scores alone.
    if (!isMechanicalOnly(p)) return done("not_run", null, notRunReason(p, true, judgeOn), outcome.findings);
    const risk = check?.security?.risk;
    const findings = risk && !p.experimental ? outcome.findings.map((f) => ({ ...f, security: risk })) : outcome.findings;
    // SKM-36: a finding that an inline marker suppresses stays in the evidence but does not lower the score.
    return done("scored", findings.every((f) => f.suppressed === true) ? 3 : 0, null, findings);
  });
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function summarise(records: CriterionRecord[], areaOrder: readonly string[]): Summary {
  const count = (s: Status): number => records.filter((r) => r.status === s).length;
  const areas: AreaSummary[] = areaOrder.map((area) => {
    const rs = records.filter((r) => r.area === area);
    const scoredRs = rs.filter((r) => r.status === "scored" && !r.experimental);
    const c = (s: Status): number => rs.filter((r) => r.status === s).length;
    return {
      area,
      mean: scoredRs.length === 0 ? null : round2(scoredRs.reduce((a, r) => a + (r.score ?? 0), 0) / scoredRs.length),
      scored: scoredRs.length,
      assessable: c("scored") + c("not_run") + c("contested"),
      not_run: c("not_run"),
      contested: c("contested"),
      process: c("process"),
      not_applicable: c("not_applicable"),
      experimental: rs.filter((r) => r.status === "scored" && r.experimental).length,
    };
  });
  const blockers: Blocker[] = records
    .filter((r) => r.status === "scored" && r.score === 0 && !r.experimental && !r.evidence.some((f) => f.security !== undefined))
    .flatMap((r): Blocker[] => {
      const effects = r.evidence.filter((f) => f.effect !== undefined);
      if (effects.length > 0)
        return effects.map((f) => ({ id: r.id, kind: "effect" as const, effect: f.effect ?? null, lb: f.lb ?? [], title: r.title, reason: f.message, file: f.file, line: f.line }));
      if (r.strength !== "must") return [];
      return [{ id: r.id, kind: "must" as const, effect: null, lb: [], title: r.title, reason: r.evidence[0]?.message ?? "scored 0", file: r.evidence[0]?.file ?? null, line: r.evidence[0]?.line ?? null }];
    });
  const security_blockers: SecurityBlocker[] = records
    .filter((r) => r.status === "scored" && r.score === 0 && !r.experimental)
    .flatMap((r) => r.evidence.filter((f) => f.security !== undefined && f.suppressed !== true).map((f): SecurityBlocker => ({ id: r.id, risk: f.security ?? "", title: r.title, reason: f.message, file: f.file, line: f.line })));
  const suppressed_security: SuppressedSecurity[] = records
    .filter((r) => r.status === "scored" && !r.experimental)
    .flatMap((r) => r.evidence.filter((f) => f.security !== undefined && f.suppressed === true).map((f): SuppressedSecurity => ({ id: r.id, risk: f.security ?? "", file: f.file, line: f.line, reason: "inline marker" })));
  const scoredRecords = records.filter((r) => r.status === "scored");
  const layersIn = (rs: CriterionRecord[]): string[] => LAYERS.filter((l) => rs.some((r) => r.assess.includes(l)));
  // A judged score came from the judgement layer alone, even when the practice could also use a live run.
  const scoredBy: string[] = LAYERS.filter((l) => scoredRecords.some((r) => (r.judge && r.status === "scored" ? ["judgement"] : r.assess).includes(l)));
  return {
    total: records.length,
    scored: records.filter((r) => r.status === "scored" && !r.experimental).length,
    experimental: records.filter((r) => r.status === "scored" && r.experimental).length,
    scored_by: scoredBy,
    layers_not_run: layersIn(records.filter((r) => r.status !== "not_applicable")).filter((l) => !scoredBy.includes(l)),
    stale_unconfirmed: scoredRecords.filter((r) => !r.experimental && r.freshness === "stale-unconfirmed").map((r) => r.id),
    not_run: count("not_run"),
    not_applicable: count("not_applicable"),
    contested: count("contested"),
    process: count("process"),
    areas,
    blockers,
    security_blockers,
    suppressed_security,
  };
}

/** Nothing scored never passes: it is a failure (2), not a pass. */
export function exitCodeFor(summary: Summary): ExitCode {
  if (summary.scored === 0) return EXIT.FAILURE;
  if (summary.blockers.length > 0 || summary.security_blockers.length > 0) return EXIT.BLOCKERS;
  return EXIT.OK;
}
