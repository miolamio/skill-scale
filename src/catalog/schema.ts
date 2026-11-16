import type { Practice, Source } from "./types.ts";
import {
  AREAS,
  ASSESSABLE_FROM,
  ASSESS_KINDS,
  FRESHNESS,
  PROFILES,
  SOURCE_TIERS,
  STRENGTHS,
  isMechanicalOnly,
} from "./types.ts";

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function oneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

function subsetOf(list: readonly string[], v: unknown): boolean {
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && list.includes(x));
}

export function validateSources(raw: unknown): string[] {
  const errors: string[] = [];
  if (!Array.isArray(raw)) return ["sources: must be a list"];
  const seen = new Set<string>();
  raw.forEach((s, i) => {
    const at = `sources[${i}]`;
    if (!isObj(s)) return void errors.push(`${at}: must be a mapping`);
    const id = s.id;
    if (typeof id !== "string" || id === "") errors.push(`${at}: id must be a non-empty string`);
    else if (seen.has(id)) errors.push(`${at}: duplicate id ${id}`);
    else seen.add(id);
    if (!oneOf(SOURCE_TIERS, s.tier)) errors.push(`${at}: tier must be one of ${SOURCE_TIERS.join(", ")}`);
    if (!Array.isArray(s.urls) || !s.urls.every((u) => typeof u === "string" && /^https?:\/\//.test(u)))
      errors.push(`${at}: urls must be a list of http(s) URLs`);
    if (s.verify !== "auto" && s.verify !== "skip") errors.push(`${at}: verify must be auto or skip`);
    if (s.verify === "auto" && Array.isArray(s.urls) && s.urls.length === 0) errors.push(`${at}: verify auto needs at least one URL`);
    if (s.verify === "skip" && (typeof s.skip_reason !== "string" || s.skip_reason === ""))
      errors.push(`${at}: verify skip needs skip_reason`);
    if (typeof s.title !== "string") errors.push(`${at}: title must be a string`);
    if (typeof s.version_evidence !== "string") errors.push(`${at}: version_evidence must be a string`);
  });
  return errors;
}

function validateParams(at: string, params: unknown, errors: string[]): void {
  if (!isObj(params)) return void errors.push(`${at}: params must be a mapping`);
  for (const [k, v] of Object.entries(params)) {
    const ok = typeof v === "number" || typeof v === "string" || typeof v === "boolean" || (Array.isArray(v) && v.every((x) => typeof x === "string"));
    if (!ok) errors.push(`${at}.${k}: must be a number, string, boolean or list of strings`);
  }
}

export function validatePractices(raw: unknown, sourceIds: Set<string>): string[] {
  const errors: string[] = [];
  if (!Array.isArray(raw)) return ["practices: must be a list"];
  const seen = new Set<string>();
  raw.forEach((p, i) => {
    if (!isObj(p)) return void errors.push(`practices[${i}]: must be a mapping`);
    const id = typeof p.id === "string" ? p.id : `#${i}`;
    const at = `practice ${id}`;
    if (!/^[A-Z]+-\d{2}$/.test(id)) errors.push(`${at}: id must look like AREA-NN`);
    if (seen.has(id)) errors.push(`${at}: duplicate id`);
    seen.add(id);
    if (!oneOf(AREAS, p.area) || !id.startsWith(`${String(p.area)}-`)) errors.push(`${at}: area must be one of ${AREAS.join(", ")} and match the id prefix`);
    if (typeof p.title !== "string" || p.title === "") errors.push(`${at}: title must be a non-empty string`);
    if (!oneOf(STRENGTHS, p.strength)) errors.push(`${at}: strength must be one of ${STRENGTHS.join(", ")}`);
    if (typeof p.strength_word !== "string" || p.strength_word === "") errors.push(`${at}: strength_word must name the deciding word of the quote`);
    if (typeof p.strength_source !== "string" || p.strength_source === "" || !sourceIds.has(p.strength_source)) errors.push(`${at}: strength_source must be a source in sources.yaml`);
    if (!subsetOf(PROFILES, p.profiles)) errors.push(`${at}: profiles must be a non-empty subset of ${PROFILES.join(", ")}`);
    if (!subsetOf(ASSESS_KINDS, p.assess)) errors.push(`${at}: assess must be a non-empty subset of ${ASSESS_KINDS.join(", ")}`);
    if (!oneOf(ASSESSABLE_FROM, p.assessable_from)) errors.push(`${at}: assessable_from must be one of ${ASSESSABLE_FROM.join(", ")}`);
    if (!oneOf(FRESHNESS, p.freshness)) errors.push(`${at}: freshness must be one of ${FRESHNESS.join(", ")}`);
    if (typeof p.contested !== "boolean") errors.push(`${at}: contested must be a boolean`);
    if (typeof p.experimental !== "boolean") errors.push(`${at}: experimental must be a boolean`);
    else {
      for (const k of ["experimental_reason", "experimental_source"] as const) {
        const has = typeof p[k] === "string" && p[k] !== "";
        if (p.experimental && !has) errors.push(`${at}: an experimental practice needs ${k}`);
        if (!p.experimental && p[k] !== undefined) errors.push(`${at}: ${k} is set but the practice is not experimental`);
      }
    }
    if (!Array.isArray(p.quotes) || p.quotes.length === 0) errors.push(`${at}: needs at least one quote`);
    else
      p.quotes.forEach((q, j) => {
        const qa = `${at} quote ${j}`;
        if (!isObj(q)) return void errors.push(`${qa}: must be a mapping`);
        if (typeof q.text !== "string" || q.text.length < 8) errors.push(`${qa}: text must be a string of at least 8 characters`);
        if (typeof q.source !== "string" || !sourceIds.has(q.source)) errors.push(`${qa}: source ${String(q.source)} is not in sources.yaml`);
        if (typeof q.section !== "string") errors.push(`${qa}: section must be a string`);
      });
    if (p.profile_rules !== undefined) {
      if (!isObj(p.profile_rules)) errors.push(`${at}: profile_rules must be a mapping`);
      else
        for (const [prof, rule] of Object.entries(p.profile_rules)) {
          if (!(PROFILES as readonly string[]).includes(prof)) errors.push(`${at}: profile_rules key ${prof} is not a profile`);
          else if (Array.isArray(p.profiles) && !p.profiles.includes(prof)) errors.push(`${at}: profile_rules for ${prof}, which is not in profiles`);
          if (!isObj(rule)) errors.push(`${at}: profile_rules.${prof} must be a mapping`);
          else {
            if (rule.strength !== undefined && !oneOf(STRENGTHS, rule.strength)) errors.push(`${at}: profile_rules.${prof}.strength is invalid`);
            if (rule.strength !== undefined && (typeof rule.strength_word !== "string" || typeof rule.strength_source !== "string")) errors.push(`${at}: profile_rules.${prof}.strength needs strength_word and strength_source`);
            if (rule.params !== undefined) validateParams(`${at}: profile_rules.${prof}.params`, rule.params, errors);
          }
        }
    }
    if (p.anchors !== undefined) {
      if (!isObj(p.anchors)) errors.push(`${at}: anchors must be a mapping`);
      else
        for (const [k, v] of Object.entries(p.anchors)) {
          if (!["0", "1", "2", "3"].includes(k)) errors.push(`${at}: anchor key ${k} must be 0, 1, 2 or 3`);
          if (typeof v !== "string" || v.trim() === "") errors.push(`${at}: anchor ${k} must be a non-empty string`);
        }
    }
    if (p.fix_hint !== undefined && (typeof p.fix_hint !== "string" || p.fix_hint.trim() === "")) errors.push(`${at}: fix_hint must be a non-empty string`);
    if ((p.anchors !== undefined || p.fix_hint !== undefined) && p.inferred !== true) errors.push(`${at}: anchors and fix_hint are our inference, so inferred must be true`);
  });
  return errors;
}

const VAGUE_WORDS = ["good", "poor", "adequate", "somewhat", "decent", "reasonable", "appropriate", "fine"];
const SHINGLE = 9;

function words(s: string): string[] {
  return s.toLowerCase().replace(/[^\p{L}\p{N}{}_\s'-]/gu, " ").split(/\s+/).filter(Boolean);
}

function shingles(s: string, n: number): Set<string> {
  const w = words(s);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

/** Authoring rules: every practice carries the anchors and fix hint its kind requires. */
export function validateAuthored(practices: Practice[]): string[] {
  const errors: string[] = [];
  for (const p of practices) {
    const at = `practice ${p.id}`;
    if (p.inferred !== true) errors.push(`${at}: inferred must be true`);
    const hint = p.fix_hint;
    if (!hint) errors.push(`${at}: fix_hint is missing`);
    else {
      if (hint.length < 20 || hint.length > 200) errors.push(`${at}: fix_hint must be 20 to 200 characters (is ${hint.length})`);
      if (!hint.endsWith(".")) errors.push(`${at}: fix_hint must end with a full stop`);
      if (/\b(TODO|TBD|FIXME)\b/.test(hint)) errors.push(`${at}: fix_hint contains a placeholder`);
    }
    const keys = Object.keys(p.anchors ?? {}).sort().join("");
    const expected = p.assessable_from === "process" ? "" : isMechanicalOnly(p) ? "03" : "0123";
    if (keys !== expected) errors.push(`${at}: anchors must have keys [${expected.split("").join(",")}] but has [${keys.split("").join(",")}]`);
    const anchors = Object.entries(p.anchors ?? {});
    const distinct = new Set(anchors.map(([, v]) => v.trim().toLowerCase()));
    if (distinct.size !== anchors.length) errors.push(`${at}: anchors must be distinct`);
    const quoteShingles = new Set(p.quotes.flatMap((q) => [...shingles(q.text, SHINGLE)]));
    const params = new Set(Object.values(p.profile_rules ?? {}).flatMap((r) => Object.keys(r?.params ?? {})));
    for (const [k, v] of anchors) {
      const n = words(v).length;
      if (n < 6 || n > 30) errors.push(`${at}: anchor ${k} must be 6 to 30 words (is ${n})`);
      for (const w of VAGUE_WORDS) if (words(v).includes(w)) errors.push(`${at}: anchor ${k} uses the vague word "${w}"`);
      for (const s of shingles(v, SHINGLE)) if (quoteShingles.has(s)) errors.push(`${at}: anchor ${k} copies ${SHINGLE} or more consecutive words from a quote`);
    }
    for (const text of [...anchors.map(([, v]) => v), hint ?? ""])
      for (const m of text.matchAll(/\{([a-z_]+)\}/g)) if (!params.has(m[1] as string)) errors.push(`${at}: placeholder {${m[1]}} is not a param in profile_rules`);
  }
  return errors;
}


export function validateLoadFacts(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) return ["load-facts.yaml: must be a non-empty list"];
  const errors: string[] = [];
  raw.forEach((f, i) => {
    if (!isObj(f) || !/^LB-\d{2}$/.test(String(f.id))) return void errors.push(`load_facts[${i}]: id must look like LB-NN`);
    for (const k of ["condition", "quote", "source", "stops"]) if (typeof f[k] !== "string" || f[k] === "") errors.push(`${String(f.id)}: ${k} must be a non-empty string`);
  });
  return errors;
}
