import { describeSkipped, MAX_TEXT_BYTES } from "../loader/files.ts";
import { at, ran } from "./helpers.ts";
import type { Check, Finding } from "./types.ts";

/** Marker for an inline suppression: it covers the line it is on and the next line, in any comment syntax. */
export const SUPPRESS_MARKER = /skill-scale:\s*ignore\s+SAFE-02\b/;

/** Shannon entropy in bits per character. */
export function shannon(s: string): number {
  if (s.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  const n = [...s].length;
  let h = 0;
  for (const c of counts.values()) {
    const p = c / n;
    h -= p * Math.log2(p);
  }
  return h;
}

/** A body that is one repeated character, has a long run of x/X/0, or contains a placeholder word is not a credential. */
export function isPlaceholder(body: string, opts: { runs?: boolean } = {}): boolean {
  if (/^(.)\1*$/su.test(body)) return true;
  if (opts.runs !== false && /x{4,}|0{4,}/i.test(body)) return true;
  // The words count only as whole segments (delimited by - or _ or the ends), so random bodies rarely trip on them.
  // The AWS documentation keys end in EXAMPLE without a delimiter (SKM-3).
  return /(?<![A-Za-z0-9])(?:EXAMPLE|your|here)(?![A-Za-z0-9])/i.test(body) || /EXAMPLE$/.test(body);
}

interface Rule {
  name: string;
  /** Group 1 is the token body (after the vendor prefix); the entropy gate and the placeholder filter run on it. */
  re: RegExp;
  /** Minimum Shannon entropy of the body. */
  minEntropy: number;
  /** Extra acceptance test on the body. */
  accept?: (body: string) => boolean;
  /** The body has numeric ID parts, so the x/0-run placeholder test does not apply. */
  numericParts?: boolean;
}

/**
 * High-precision credential formats only. The shapes and lengths come from the vendors' public token formats.
 * The list is our inference, not Anthropic's: the source says "check for API keys, tokens, or passwords" and gives no patterns.
 * Rule shapes and entropy thresholds were cross-checked against gitleaks (MIT, Copyright (c) 2019 Zachary Rice),
 * config/gitleaks.toml at commit 5f6ec56. The regexes are rewritten, not copied. Re-check once a year.
 * Left out on purpose: JWT, database connection strings and keyword-plus-value rules (measured on a corpus of 1,466 public skills: too many false positives).
 */
export const CREDENTIAL_PATTERNS: Rule[] = [
  { name: "AWS access key ID", re: /\b(?:AKIA|ASIA)([0-9A-Z]{16})\b/, minEntropy: 2.5 },
  { name: "GitHub token", re: /\bgh[pousr]_([A-Za-z0-9]{36})(?![A-Za-z0-9_])/, minEntropy: 3 },
  { name: "GitHub fine-grained token", re: /\bgithub_pat_([A-Za-z0-9_]{22,})(?![A-Za-z0-9_])/, minEntropy: 3 },
  { name: "Anthropic API key", re: /\bsk-ant-([A-Za-z0-9_-]{20,})/, minEntropy: 3 },
  // The plain sk- form needs a digit and at most two hyphens, so kebab-case prose such as sk-learn-is-a-python-library-... does not
  // match. The sk-proj-/sk-svcacct-/sk-admin- forms are long base64url strings that legitimately hold many hyphens: they need a
  // digit only. The T3BlbkFJ marker (base64 of "OpenAI") inside the body is a strong positive.
  {
    name: "OpenAI-style secret key",
    re: /\bsk-(?!ant-)((?:(?:proj|svcacct|admin)-)?[A-Za-z0-9_-]{32,})/,
    minEntropy: 3,
    accept: (b) => b.includes("T3BlbkFJ") || (/\d/.test(b) && (/^(?:proj|svcacct|admin)-/.test(b) || (b.match(/-/g) ?? []).length <= 2)),
  },
  { name: "Slack token", re: /\bxox[abprs]-([A-Za-z0-9-]{10,})/, minEntropy: 3, numericParts: true },
  { name: "Slack webhook URL", re: /https:\/\/hooks\.slack\.com\/(?:services|workflows|triggers)\/([A-Za-z0-9+/]{43,56})(?![A-Za-z0-9+/])/, minEntropy: 3 },
  { name: "GCP API key", re: /\bAIza([0-9A-Za-z_-]{35})(?![\w-])/, minEntropy: 3.5 },
  { name: "Stripe live key", re: /\b[sr]k_live_([A-Za-z0-9]{24,99})(?![A-Za-z0-9])/, minEntropy: 3 },
  { name: "HuggingFace token", re: /\bhf_([A-Za-z]{34})(?![A-Za-z0-9_])/, minEntropy: 3 },
  { name: "npm token", re: /\bnpm_([A-Za-z0-9]{36})(?![A-Za-z0-9_])/, minEntropy: 3 },
  { name: "GitLab personal access token", re: /\bglpat-([A-Za-z0-9_-]{20})(?![A-Za-z0-9_-])/, minEntropy: 3 },
  { name: "SendGrid API key", re: /\bSG\.([A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/, minEntropy: 3.5 },
];

/** Whole-file rule: a PEM private key header followed by at least 64 base64 characters. The header alone is prose. */
export const PRIVATE_KEY = {
  name: "private key block",
  header: /-----BEGIN [A-Z0-9 _-]{0,100}PRIVATE KEY(?: BLOCK)?-----/g,
  minBody: 64,
};

/** Characters of key body (base64) that follow a header, after optional `Name: value` armor lines. */
function keyBodyLength(rest: string): number {
  const m = /^(?:[ \t]*\r?\n)*(?:[A-Za-z][A-Za-z-]*:[^\n]*\r?\n)*(?:[ \t]*\r?\n)*((?:[A-Za-z0-9+/=]+[ \t]*(?:\r?\n|$))*)/.exec(rest);
  return (m?.[1] ?? "").replace(/[^A-Za-z0-9+/]/g, "").length;
}

/**
 * Text as the PEM scan sees it: literal `\n` / `\r\n` escapes become newlines (JSON strings), and each line loses a leading
 * run of spaces, tabs, `>` and `#` (YAML blocks, blockquotes, comments). `origLine[i]` is the 1-based source line of normalised line i.
 */
function normaliseForPem(text: string): { text: string; origLine: number[] } {
  const out: string[] = [];
  const origLine: number[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const seg of line.split(/(?:\\r)?\\n/)) {
      out.push(seg.replace(/^[ \t>#]*/, ""));
      origLine.push(i + 1);
    }
  });
  return { text: out.join("\n"), origLine };
}

function scanLine(line: string): { rule: Rule; token: string }[] {
  const hits: { rule: Rule; token: string }[] = [];
  for (const rule of CREDENTIAL_PATTERNS) {
    const re = new RegExp(rule.re.source, "g");
    for (let m = re.exec(line); m; m = re.exec(line)) {
      const body = m[1] ?? "";
      if (isPlaceholder(body, { runs: !rule.numericParts }) || shannon(body) < rule.minEntropy || (rule.accept && !rule.accept(body))) continue;
      hits.push({ rule, token: m[0] });
      break;
    }
  }
  return hits;
}

/*
 * Candidates reviewed for `security: true` (SKM-34). Only SAFE-02 is marked. Not marked, on purpose:
 *  - SAFE-04 (no check yet): a mechanical check for shell-injection patterns or unpinned remote execution
 *    (`curl | sh`) has a concrete risk, but it needs patterns with a low false-positive rate first. Revisit when it is built.
 *  - Broad `allowed-tools` (for example an unrestricted `Bash`): it grants capability and does not leak or run anything
 *    by itself, and legitimate skills need it. No check exists; not a blocker.
 *  - SAFE-03 (external fetch) and the other SAFE practices need judgement, and the invariant allows security marks on
 *    purely mechanical, non-contested, non-experimental practices only.
 */
export const safe02: Check = {
  practice: "SAFE-02",
  security: { risk: "credential_exposure" },
  run(ctx) {
    const out: Finding[] = [];
    for (const f of ctx.skill.files) {
      if (f.kind !== "text" || f.text === null) continue;
      const text = f.text;
      const lines = text.split(/\r?\n/);
      const covered = new Set<number>(); // 1-based lines covered by an inline marker
      lines.forEach((l, i) => {
        if (!SUPPRESS_MARKER.test(l)) return;
        covered.add(i + 1);
        covered.add(i + 2);
      });
      const add = (finding: Finding): void => {
        out.push(finding.line !== null && covered.has(finding.line) ? { ...finding, suppressed: true } : finding);
      };
      lines.forEach((line, i) => {
        for (const { rule, token } of scanLine(line)) add(at("SAFE-02", `looks like a hardcoded ${rule.name}`, f.path, i + 1, `${token.slice(0, 4)}… (${token.length} characters)`));
      });
      const norm = normaliseForPem(text);
      for (const m of norm.text.matchAll(PRIVATE_KEY.header)) {
        if (keyBodyLength(norm.text.slice(m.index + m[0].length)) < PRIVATE_KEY.minBody) continue;
        const line = norm.origLine[norm.text.slice(0, m.index).split("\n").length - 1] ?? 1;
        add(at("SAFE-02", `looks like a hardcoded ${PRIVATE_KEY.name}`, f.path, line, m[0]));
      }
    }
    // Rule (SKM-2): a skill with unscanned files is never a clean 3. If a secret was found in the scanned files the
    // result stays a scored 0; if nothing was found, the check is not_run and names the files it could not read.
    // A finding that an inline marker suppresses does not count as found.
    if (!out.some((f) => f.suppressed !== true) && ctx.skill.skippedFiles.length > 0)
      return { kind: "not_run", reason: `not checked for secrets: ${ctx.skill.skippedFiles.map(describeSkipped).join(", ")} over ${MAX_TEXT_BYTES / 1_048_576} MB and not scanned` };
    return ran(out);
  },
};
