import { at, numParam, ran } from "./helpers.ts";
import type { Check } from "./types.ts";

/** Counts eval cases under evals/: entries of evals/evals.json plus folders holding a case.yaml or prompt.md. */
export function countEvalCases(files: { path: string; text: string | null }[]): number {
  let n = 0;
  const caseDirs = new Set<string>();
  for (const f of files) {
    if (!f.path.startsWith("evals/")) continue;
    if (f.path === "evals/evals.json" && f.text !== null) {
      try {
        const doc = JSON.parse(f.text) as { evals?: unknown };
        if (Array.isArray(doc.evals)) n += doc.evals.length;
      } catch {
        /* unreadable JSON counts as no cases */
      }
    }
    const m = /^(evals\/.+)\/(case\.ya?ml|prompt\.md)$/.exec(f.path);
    if (m) caseDirs.add(m[1] as string);
  }
  return n + caseDirs.size;
}

export const test02: Check = {
  practice: "TEST-02",
  run(ctx) {
    if (ctx.skill.looseFile) return { kind: "not_applicable", reason: "the skill is a single file, so it has no folder to hold evals" };
    const min = numParam(ctx, "TEST-02", "min_eval_cases");
    const n = countEvalCases(ctx.skill.files);
    if (n >= min) return ran([]);
    return ran([at("TEST-02", `found ${n} eval case${n === 1 ? "" : "s"} under evals/; at least ${min} are expected`, null, null, null)]);
  },
};
