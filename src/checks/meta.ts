import { NAME_IGNORED_ABOVE, REFUSED_NAME_CHARS, withEffect } from "./effects.ts";
import { at, charCount, clip, flagParam, fmLine, fmString, frontmatterUnreadable, listParam, numParam, ran, strParam } from "./helpers.ts";
import type { Check, Finding } from "./types.ts";

const LOWER_HYPHEN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const meta01: Check = {
  practice: "META-01",
  effects: ["LB-04"],
  run(ctx) {
    const bad = frontmatterUnreadable(ctx);
    if (bad) return bad;
    const max = numParam(ctx, "META-01", "name_max_chars");
    const charset = strParam(ctx, "META-01", "name_charset");
    const raw = ctx.skill.frontmatter.data.name;
    const file = ctx.skill.skillFileName;
    const line = fmLine(ctx, "name");
    const out: Finding[] = [];
    if (raw === undefined || raw === null) {
      if (flagParam(ctx, "name_required")) out.push(at("META-01", "the name field is missing", file, line));
      return ran(out);
    }
    if (typeof raw !== "string") return ran([at("META-01", "the name must be text", file, line, clip(String(raw)))]);
    if (charCount(raw) > NAME_IGNORED_ABOVE)
      out.push(withEffect(at("META-01", `the name has ${charCount(raw)} characters; Claude Code ignores a name over ${NAME_IGNORED_ABOVE}`, file, line, clip(raw)), "fields_ignored", ["LB-04"]));
    if (charCount(raw) > max && max < NAME_IGNORED_ABOVE) out.push(at("META-01", `the name has ${charCount(raw)} characters; the limit is ${max}`, file, line, clip(raw)));
    if (charset === "lowercase-alnum-hyphen" && !LOWER_HYPHEN.test(raw))
      out.push(at("META-01", "the name may only use lowercase letters, digits and single hyphens, with no hyphen at either end", file, line, clip(raw)));
    return ran(out);
  },
};

export const meta02: Check = {
  practice: "META-02",
  run(ctx) {
    if (ctx.skill.looseFile) return { kind: "not_applicable", reason: "the skill is a single file, not a folder (see META-07)" };
    const bad = frontmatterUnreadable(ctx);
    if (bad) return bad;
    const name = fmString(ctx, "name");
    if (name === undefined) return { kind: "not_applicable", reason: "the skill has no name field (see META-01)" };
    if (name === ctx.skill.dirName) return ran([]);
    return ran([at("META-02", `the name "${clip(name)}" does not match the folder name "${ctx.skill.dirName}"`, ctx.skill.skillFileName, fmLine(ctx, "name"), clip(name))]);
  },
};

export const meta03: Check = {
  practice: "META-03",
  effects: ["LB-01", "LB-02", "LB-03", "LB-05", "LB-06"],
  run(ctx) {
    const out: Finding[] = [];
    const file = ctx.skill.skillFileName;
    const dir = ctx.skill.dirName;
    // The folder rules are LB-01, LB-02, LB-05 and LB-06. They apply outside a plugin and to skill folders only.
    if (!ctx.skill.looseFile && !ctx.skill.inPlugin) {
      const folder = (message: string, effectLb: string[]) => withEffect(at("META-03", message, null, null, clip(dir)), "not_loaded", effectLb);
      if (REFUSED_NAME_CHARS.test(dir)) out.push(folder("the folder name has a character Claude Code refuses, so the skill does not load", ["LB-01", "LB-02"]));
      if (dir === "anthropic-skills" || dir.startsWith("anthropic-skills:")) out.push(folder("the folder name is reserved (anthropic-skills), so the skill does not load", ["LB-05"]));
      if (dir.toLowerCase() === "synced") out.push(folder("the folder name is reserved (synced), so the skill does not load", ["LB-06"]));
    }
    const bad = frontmatterUnreadable(ctx);
    if (bad) return out.length > 0 ? ran(out) : bad;
    const name = fmString(ctx, "name");
    if (name !== undefined) {
      const line = fmLine(ctx, "name");
      if (REFUSED_NAME_CHARS.test(name))
        out.push(withEffect(at("META-03", "the name has a character Claude Code refuses, so it ignores the name", file, line, JSON.stringify(clip(name))), "fields_ignored", ["LB-03"]));
      for (const w of listParam(ctx, "reserved_words"))
        if (name.toLowerCase().includes(w.toLowerCase())) out.push(at("META-03", `the name contains the reserved word "${w}"`, file, line, clip(name)));
    }
    return ran(out);
  },
};

export const meta05: Check = {
  practice: "META-05",
  effects: ["LB-09"],
  run(ctx) {
    const fm = ctx.skill.frontmatter;
    const file = ctx.skill.skillFileName;
    // LB-09: opening --- not on line 1, or YAML that does not parse, means the fields are not read. An unclosed block, a duplicate key
    // and a non-mapping are not stated by the docs, so they are findings without an effect.
    const fieldsIgnored = (f: Finding) => withEffect(f, "fields_ignored", ["LB-09"]);
    if (fm.status === "invalid") {
      const f = at("META-05", `the frontmatter does not parse: ${fm.error}`, file, fm.openLine, null);
      return ran([fm.cause === "yaml" ? fieldsIgnored(f) : f]);
    }
    if (fm.status === "misplaced") return ran([fieldsIgnored(at("META-05", `Claude Code ignores the frontmatter: ${fm.error}`, file, fm.openLine, null))]);
    const allowed = listParam(ctx, "allowed_fields");
    if (allowed.length === 0) return ran([]);
    return ran(
      Object.keys(fm.data)
        .filter((k) => !allowed.includes(k))
        .map((k) => at("META-05", `the field "${k}" is not one of ${allowed.join(", ")}`, file, fm.keyLines[k] ?? null, k)),
    );
  },
};

export const meta06: Check = {
  practice: "META-06",
  run(ctx) {
    const bad = frontmatterUnreadable(ctx);
    if (bad) return bad;
    const md = ctx.skill.frontmatter.data.metadata;
    if (typeof md !== "object" || md === null || Array.isArray(md)) return { kind: "not_applicable", reason: "the skill has no metadata field" };
    const reserved = listParam(ctx, "reserved_metadata_keys");
    return ran(
      Object.keys(md)
        .filter((k) => reserved.includes(k))
        .map((k) => at("META-06", `the metadata key "${k}" reuses a frontmatter field name (Claude Code docs say not to reuse such names, giving "paths" as the example; the full list is the docs' frontmatter table)`, ctx.skill.skillFileName, fmLine(ctx, "metadata"), k)),
    );
  },
};

export const meta07: Check = {
  practice: "META-07",
  effects: ["LB-08"],
  run(ctx) {
    const file = ctx.skill.skillFileName;
    if (ctx.skill.looseFile)
      return ran([withEffect(at("META-07", `${file} is a single file; a skill must be a folder holding SKILL.md, or it does not appear in /skills`, file, null, file), "not_loaded", ["LB-08"])]);
    if (file === "SKILL.md") return ran([]);
    return ran([at("META-07", `the skill file is named "${file}"; the name must be exactly SKILL.md`, file, null, file)]);
  },
};
