import type { Effect, Finding } from "./types.ts";

/**
 * Facts from research section 2.12 (what Claude Code's own docs and changelog say it does with a defect).
 * They hold for every profile, so the numbers and character sets here are constants, not catalogue params.
 *
 * Refused characters (LB-01, LB-03): "A zero-width space or a control character", "A character that changes the
 * direction of the text around it", "`<` or `>`"; the changelog adds "blank-like" (CL 2.1.299). The Unicode
 * categories below are our reading of those words: control (Cc), format such as zero-width and bidi marks (Cf),
 * private use (Co), line and paragraph separators, any space other than U+0020, and four invisible fillers.
 */
export const REFUSED_NAME_CHARS = /[<>\p{Cc}\p{Cf}\p{Co}\p{Zl}\p{Zp}\u2800\u115F\u1160\u3164\uFFA0]|(?! )\p{Zs}/u;

/** LB-04: "a skill's or a plugin file's `name` longer than that is ignored" (CL 2.1.292; 256). */
export const NAME_IGNORED_ABOVE = 256;

export function withEffect(f: Finding, effect: Effect, lb: string[]): Finding {
  return { ...f, effect, lb };
}
