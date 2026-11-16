import type { Effect, ParamValue, ProfileId } from "../catalog/types.ts";
import type { SkillModel } from "../loader/skill.ts";

export type { Effect };

export interface Finding {
  /** Practice ID the finding belongs to. */
  practice: string;
  message: string;
  file: string | null;
  line: number | null;
  /** The offending text, shortened. Secrets are never included in full. */
  evidence: string | null;
  /** Set only for the LB facts of research section 2.12. Any finding with an effect is a blocker in every profile. */
  effect?: Effect;
  /** The LB IDs of section 2.12 that state the effect. */
  lb?: string[];
  /** The named risk, stamped by the scorer from the check's `security` mark. Checks do not set it. */
  security?: string;
  /** An inline `skill-scale: ignore SAFE-02` marker covers this finding: it is listed, does not block and does not lower the score. */
  suppressed?: boolean;
}

export type CheckOutcome =
  | { kind: "ran"; findings: Finding[] }
  | { kind: "not_applicable"; reason: string }
  | { kind: "not_run"; reason: string };

export interface CheckContext {
  skill: SkillModel;
  profile: ProfileId;
  /** The params the catalogue gives this practice for the active profile. */
  params: Record<string, ParamValue>;
}

/** A named risk. Any finding from a check that carries one is a blocker in every profile (SKM-34). */
export interface SecurityMark {
  risk: string;
}

export interface Check {
  practice: string;
  /**
   * Marks the check as a security check. Only for practices that are neither contested nor experimental
   * (enforced in tests/checks/catalogue-link.test.ts, SKM-31). Do not add a mark without a concrete risk.
   */
  security?: SecurityMark;
  /**
   * The LB IDs of every effect this check can put on a finding. Declare it whenever the check calls `withEffect`.
   * A finding with an effect is a blocker in every profile, but `summarise` drops findings of contested, experimental
   * or non-mechanical practices, so tests/checks/catalogue-link.test.ts fails when such a practice has a check that
   * declares effects, and when a check emits an effect it does not declare (SKM-31).
   */
  effects?: string[];
  run(ctx: CheckContext): CheckOutcome;
}

/** The catalogue does not give a check the data it needs. This is a contract failure, not a score. */
export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractError";
  }
}
