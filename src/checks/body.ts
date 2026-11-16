import { at, numParam, ran } from "./helpers.ts";
import type { Check } from "./types.ts";

export const body02: Check = {
  practice: "BODY-02",
  run(ctx) {
    const limit = numParam(ctx, "BODY-02", "lines_must_be_under");
    const n = ctx.skill.lineCount;
    if (n < limit) return ran([]);
    return ran([at("BODY-02", `${ctx.skill.skillFileName} has ${n} lines; it must be under ${limit}`, ctx.skill.skillFileName, limit, null)]);
  },
};
