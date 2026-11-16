import { posix } from "node:path";
import type { SkillFile } from "./files.ts";

export type ReferenceKind = "link" | "skill-dir" | "code";

export interface Reference {
  from: string;
  line: number;
  kind: ReferenceKind;
  /** The target as written. */
  target: string;
  /** Skill-relative path it resolves to (the best guess when it does not exist). */
  resolved: string;
  exists: boolean;
  /** True when the path leaves the skill folder. */
  escapes: boolean;
}

export const LINK = /\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
const SKILL_DIR = /\$\{CLAUDE_SKILL_DIR\}\/([^\s"'`)<>]+)/g;
export const INLINE_CODE = /`([^`\n]+)`/g;
export const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*:|\/\/|\/)/;

function safeDecode(s: string): string {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
}

function resolve(from: string, target: string, entries: Set<string>, rootOnly: boolean): { resolved: string; exists: boolean; escapes: boolean } {
  const clean = safeDecode(target.split("#")[0].split("?")[0]).replace(/\/+$/, "");
  const candidates = rootOnly ? [posix.normalize(clean)] : [posix.normalize(posix.join(posix.dirname(from), clean)), posix.normalize(clean)];
  const hit = candidates.find((c) => entries.has(c));
  if (hit) return { resolved: hit, exists: true, escapes: false };
  const first = candidates[0];
  return { resolved: first, exists: false, escapes: candidates.every((c) => c === ".." || c.startsWith("../")) };
}

export interface ProseLine {
  line: number;
  text: string;
  inFence: boolean;
}

/** Lines of a Markdown file with a flag for lines inside fenced code blocks (the fence lines themselves are skipped). */
export function* proseLines(text: string): Generator<ProseLine> {
  let fence: string | null = null;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const f = /^\s*(```|~~~)/.exec(lines[i]);
    if (f) {
      fence = fence === null ? f[1] : fence === f[1] ? null : fence;
      continue;
    }
    yield { line: i + 1, text: lines[i], inFence: fence !== null };
  }
}

export function extractReferences(files: SkillFile[], dirs: string[]): Reference[] {
  const entries = new Set<string>([...files.map((f) => f.path), ...dirs]);
  const fileSet = new Set(files.map((f) => f.path));
  const out: Reference[] = [];
  for (const file of files) {
    if (file.kind !== "text" || !/\.(md|markdown)$/i.test(file.path) || file.text === null) continue;
    for (const { line: lineNo, text: line, inFence } of proseLines(file.text)) {
      for (const m of line.matchAll(SKILL_DIR)) {
        const target = m[1].replace(/[.,;:]+$/, "");
        out.push({ from: file.path, line: lineNo, kind: "skill-dir", target, ...resolve(file.path, target, entries, true) });
      }
      if (inFence) continue;
      for (const m of line.matchAll(LINK)) {
        const target = m[1];
        if (SCHEME.test(target) || target.startsWith("#") || /[{}<>$]/.test(target)) continue;
        out.push({ from: file.path, line: lineNo, kind: "link", target, ...resolve(file.path, target, entries, false) });
      }
      for (const m of line.matchAll(INLINE_CODE)) {
        const target = m[1];
        if (target.length > 200 || /\s/.test(target) || !/[./]/.test(target) || SCHEME.test(target)) continue;
        const r = resolve(file.path, target, entries, false);
        if (r.exists && fileSet.has(r.resolved)) out.push({ from: file.path, line: lineNo, kind: "code", target, ...r });
      }
    }
  }
  return out;
}
