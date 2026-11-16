export const PROFILES = ["claude-code", "portable"] as const;
export type ProfileId = (typeof PROFILES)[number];

export const AREAS = ["META", "DESC", "TRIG", "BODY", "STRUCT", "SCRIPT", "SAFE", "TEST", "PROC", "MAINT", "FIT"] as const;
export type Area = (typeof AREAS)[number];

export const STRENGTHS = ["must", "directive", "suggestion", "statement"] as const;
export type Strength = (typeof STRENGTHS)[number];

export const ASSESS_KINDS = ["mechanical", "judgement", "live"] as const;
export type AssessKind = (typeof ASSESS_KINDS)[number];

export const ASSESSABLE_FROM = ["artifact", "run", "process"] as const;
export type AssessableFrom = (typeof ASSESSABLE_FROM)[number];

export const FRESHNESS = ["recent", "undated-live", "stale-unconfirmed"] as const;
export type Freshness = (typeof FRESHNESS)[number];

export const SOURCE_TIERS = ["A", "B-recent", "B-older", "C"] as const;
export type SourceTier = (typeof SOURCE_TIERS)[number];

export type ParamValue = number | string | boolean | string[];

export interface Quote {
  text: string;
  source: string;
  section: string;
  older?: boolean;
}

export interface ProfileRule {
  /** Set only where the research file gives this profile its own Strength line. */
  strength?: Strength;
  strength_word?: string;
  strength_source?: string;
  params?: Record<string, ParamValue>;
}

export interface Practice {
  id: string;
  area: Area;
  title: string;
  /** For the claude-code profile, or for portable when the practice is portable-only. */
  strength: Strength;
  /** The word in the source's quote that decides the strength. */
  strength_word: string;
  strength_source: string;
  profiles: ProfileId[];
  assess: AssessKind[];
  assessable_from: AssessableFrom;
  freshness: Freshness;
  contested: boolean;
  experimental: boolean;
  /** Set exactly when experimental is true: why the practice failed qualification, and the note it came from. */
  experimental_reason?: string;
  experimental_source?: string;
  scope_note?: string;
  quotes: Quote[];
  profile_rules?: Partial<Record<ProfileId, ProfileRule>>;
  anchors?: Partial<Record<"0" | "1" | "2" | "3", string>>;
  fix_hint?: string;
  inferred?: boolean;
}

export interface Source {
  id: string;
  tier: SourceTier;
  urls: string[];
  title: string;
  version_evidence: string;
  verify: "auto" | "skip";
  skip_reason?: string;
}

export interface CatalogueMeta {
  revision: number;
  research_date: string;
}

export interface Catalogue {
  meta: CatalogueMeta;
  practices: Practice[];
  sources: Source[];
  /** Research section 2.12: what Claude Code does with a defect, in the docs' words. */
  load_facts: LoadFact[];
}

export function isMechanicalOnly(p: Pick<Practice, "assess" | "assessable_from">): boolean {
  return p.assessable_from === "artifact" && p.assess.length === 1 && p.assess[0] === "mechanical";
}

export interface LoadFact {
  id: string;
  condition: string;
  quote: string;
  source: string;
  stops: string;
}

/** What Claude Code does with a defect, as its docs or changelog state (research section 2.12). */
export type Effect = "not_loaded" | "fields_ignored";
