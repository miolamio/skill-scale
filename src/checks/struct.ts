import type { SkillFile } from "../loader/files.ts";
import type { Reference } from "../loader/references.ts";
import { INLINE_CODE, LINK, proseLines } from "../loader/references.ts";
import { at, numParam, ran } from "./helpers.ts";
import type { Check, Finding } from "./types.ts";

/** Markdown files other than the skill file that something in the skill links to. */
function referenceFiles(files: SkillFile[], refs: Reference[], skillFileName: string): SkillFile[] {
  const linked = new Set(refs.filter((r) => r.exists).map((r) => r.resolved));
  return files.filter((f) => f.kind === "text" && f.text !== null && /\.(md|markdown)$/i.test(f.path) && f.path !== skillFileName && linked.has(f.path));
}

export const struct02: Check = {
  practice: "STRUCT-02",
  run(ctx) {
    const main = ctx.skill.skillFileName;
    const direct = new Set(ctx.skill.refs.filter((r) => r.from === main && r.exists && !r.escapes).map((r) => r.resolved));
    if (direct.size === 0) return { kind: "not_applicable", reason: `${main} links to no other file in the skill` };
    const out: Finding[] = [];
    for (const r of ctx.skill.refs) {
      if (r.from === main || !direct.has(r.from) || !r.exists || r.escapes || r.kind === "code") continue;
      if (r.resolved === main || r.resolved === r.from || direct.has(r.resolved)) continue;
      out.push(at("STRUCT-02", `${r.from} points to ${r.resolved}, which ${main} does not link to directly`, r.from, r.line, r.target));
    }
    return ran(out);
  },
};

const TOC_HEADING = /^#{2,6}\s+(table of contents|contents)\s*$/i;

export function hasTableOfContents(text: string): boolean {
  const lines = text.split(/\r?\n/);
  const firstSection = lines.findIndex((l) => /^#{2,6}\s/.test(l));
  if (firstSection >= 0 && TOC_HEADING.test(lines[firstSection])) return true;
  const head = firstSection >= 0 ? lines.slice(0, firstSection) : lines;
  let run = 0;
  for (const l of head) {
    run = /\]\(#[^)]+\)/.test(l) ? run + 1 : 0;
    if (run >= 3) return true;
  }
  return false;
}

export const struct03: Check = {
  practice: "STRUCT-03",
  run(ctx) {
    const limit = numParam(ctx, "STRUCT-03", "toc_required_when_lines_exceed");
    const long = referenceFiles(ctx.skill.files, ctx.skill.refs, ctx.skill.skillFileName).filter((f) => f.lines > limit);
    if (long.length === 0) return { kind: "not_applicable", reason: `no linked reference file is longer than ${limit} lines` };
    return ran(
      long
        .filter((f) => !hasTableOfContents(f.text as string))
        .map((f) => at("STRUCT-03", `${f.path} has ${f.lines} lines (more than ${limit}) and no table of contents at the top`, f.path, 1, null)),
    );
  },
};

const WINDOWS_PATH = /^[\w.-]+(?:\\[\w. -]+)+\.[A-Za-z0-9]{1,5}$/;

export const struct06: Check = {
  practice: "STRUCT-06",
  run(ctx) {
    const out: Finding[] = [];
    for (const f of ctx.skill.files) {
      if (f.kind !== "text" || f.text === null || !/\.(md|markdown)$/i.test(f.path)) continue;
      for (const { line, text, inFence } of proseLines(f.text)) {
        if (inFence) continue;
        for (const m of text.matchAll(LINK)) if ((m[1] as string).includes("\\")) out.push(at("STRUCT-06", "a link path uses backslashes", f.path, line, m[1] as string));
        for (const m of text.matchAll(INLINE_CODE)) if (WINDOWS_PATH.test(m[1] as string)) out.push(at("STRUCT-06", "a file path uses backslashes", f.path, line, m[1] as string));
      }
    }
    return ran(out);
  },
};

export const struct07: Check = {
  practice: "STRUCT-07",
  run(ctx) {
    const readme = ctx.skill.files.find((f) => f.path.toLowerCase() === "readme.md");
    return ran(readme ? [at("STRUCT-07", "the skill folder contains a README.md", readme.path, null, readme.path)] : []);
  },
};

export const struct10: Check = {
  practice: "STRUCT-10",
  run(ctx) {
    const checked = ctx.skill.refs.filter((r) => r.kind !== "code");
    if (checked.length === 0) return { kind: "not_applicable", reason: "the Markdown files contain no relative links or skill-folder paths" };
    const out: Finding[] = [];
    for (const r of checked) {
      if (r.exists) continue;
      out.push(at("STRUCT-10", r.escapes ? `${r.target} points outside the skill folder` : `${r.target} does not exist in the skill folder`, r.from, r.line, r.target));
    }
    return ran(out);
  },
};
