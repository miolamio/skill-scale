import type { CheckContext, CheckOutcome, Finding } from "./types.ts";
import { ContractError } from "./types.ts";

export function numParam(ctx: CheckContext, practice: string, key: string): number {
  const v = ctx.params[key];
  if (typeof v !== "number") throw new ContractError(`${practice}: the catalogue has no number "${key}" for profile ${ctx.profile}`);
  return v;
}

export function strParam(ctx: CheckContext, practice: string, key: string): string {
  const v = ctx.params[key];
  if (typeof v !== "string") throw new ContractError(`${practice}: the catalogue has no text "${key}" for profile ${ctx.profile}`);
  return v;
}

export function flagParam(ctx: CheckContext, key: string): boolean {
  return ctx.params[key] === true;
}

export function listParam(ctx: CheckContext, key: string): string[] {
  const v = ctx.params[key];
  return Array.isArray(v) ? v : [];
}

export function ran(findings: Finding[]): CheckOutcome {
  return { kind: "ran", findings };
}

export function at(practice: string, message: string, file: string | null, line: number | null, evidence: string | null = null): Finding {
  return { practice, message, file, line, evidence };
}

export function clip(s: string, max = 80): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** Checks that read frontmatter fields cannot say anything when Claude Code would load the skill with no fields. */
export function frontmatterUnreadable(ctx: CheckContext): CheckOutcome | null {
  const s = ctx.skill.frontmatter.status;
  return s === "invalid" || s === "misplaced" ? { kind: "not_run", reason: "the frontmatter could not be read (see META-05)" } : null;
}

export function fmLine(ctx: CheckContext, key: string): number | null {
  return ctx.skill.frontmatter.keyLines[key] ?? (ctx.skill.frontmatter.openLine || null);
}

export function fmString(ctx: CheckContext, key: string): string | undefined {
  const v = ctx.skill.frontmatter.data[key];
  return typeof v === "string" ? v : undefined;
}

export function charCount(s: string): number {
  return [...s].length;
}
