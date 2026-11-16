import { at, charCount, clip, flagParam, fmLine, fmString, frontmatterUnreadable, numParam, ran } from "./helpers.ts";
import type { Check } from "./types.ts";

export const desc01: Check = {
  practice: "DESC-01",
  run(ctx) {
    const bad = frontmatterUnreadable(ctx);
    if (bad) return bad;
    const d = fmString(ctx, "description");
    if (d !== undefined && d.trim() !== "") return ran([]);
    return ran([at("DESC-01", "the skill has no description", ctx.skill.skillFileName, fmLine(ctx, "description"))]);
  },
};

export const desc02: Check = {
  practice: "DESC-02",
  run(ctx) {
    const bad = frontmatterUnreadable(ctx);
    if (bad) return bad;
    const d = fmString(ctx, "description");
    if (d === undefined || d.trim() === "") return { kind: "not_applicable", reason: "the skill has no description (see DESC-01)" };
    const max = numParam(ctx, "DESC-02", "description_max_chars");
    const extra = flagParam(ctx, "count_when_to_use") ? charCount(fmString(ctx, "when_to_use") ?? "") : 0;
    const total = charCount(d) + extra;
    if (total <= max) return ran([]);
    return ran([at("DESC-02", `the description${extra > 0 ? " and when_to_use" : ""} total ${total} characters; the limit is ${max}`, ctx.skill.skillFileName, fmLine(ctx, "description"), clip(d))]);
  },
};

const XML_TAG = /<\/?[A-Za-z][^>]*>/;

export const desc10: Check = {
  practice: "DESC-10",
  run(ctx) {
    const bad = frontmatterUnreadable(ctx);
    if (bad) return bad;
    const d = fmString(ctx, "description");
    if (d === undefined) return { kind: "not_applicable", reason: "the skill has no description (see DESC-01)" };
    const m = XML_TAG.exec(d);
    if (!m) return ran([]);
    return ran([at("DESC-10", "the description contains an XML tag", ctx.skill.skillFileName, fmLine(ctx, "description"), m[0])]);
  },
};
