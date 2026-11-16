import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { loadCatalogue } from "../../src/catalog/load.ts";
import { paramsFor } from "../../src/catalog/params.ts";
import type { ProfileId } from "../../src/catalog/types.ts";

const dir = new URL("../../catalog/", import.meta.url).pathname;
const cat = loadCatalogue(dir);
const byId = new Map(cat.practices.map((p) => [p.id, p]));

const RESERVED_METADATA_KEYS = [
  "name", "description", "when_to_use", "argument-hint", "arguments", "disable-model-invocation", "user-invocable", "allowed-tools",
  "disallowed-tools", "model", "effort", "context", "agent", "background", "hooks", "paths", "shell", "metadata", "license", "compatibility",
];
const SIX_FIELDS = ["name", "description", "license", "compatibility", "metadata", "allowed-tools"];

/** Every sourced parameter, per profile. Values were checked against research revision 5 (and the Claude Code docs for META-06). */
const PARAMS: Array<[string, ProfileId, Record<string, unknown>]> = [
  ["META-01", "claude-code", { name_max_chars: 256, name_charset: "any", name_required: false }],
  ["META-01", "portable", { name_max_chars: 64, name_charset: "lowercase-alnum-hyphen", name_required: true }],
  ["META-03", "portable", { reserved_words: ["anthropic", "claude"] }],
  ["META-05", "portable", { allowed_fields: SIX_FIELDS }],
  ["META-06", "claude-code", { reserved_metadata_keys: RESERVED_METADATA_KEYS }],
  ["META-06", "portable", { reserved_metadata_keys: RESERVED_METADATA_KEYS }],
  ["DESC-02", "claude-code", { description_max_chars: 1536, count_when_to_use: true }],
  ["DESC-02", "portable", { description_max_chars: 1024 }],
  ["BODY-02", "claude-code", { lines_must_be_under: 500 }],
  ["BODY-02", "portable", { lines_must_be_under: 500 }],
  ["STRUCT-03", "claude-code", { toc_required_when_lines_exceed: 100 }],
  ["STRUCT-03", "portable", { toc_required_when_lines_exceed: 100 }],
  ["TEST-02", "claude-code", { min_eval_cases: 3 }],
  ["TEST-02", "portable", { min_eval_cases: 3 }],
  ["TEST-07", "claude-code", { repeat_runs: 3 }],
  ["TEST-07", "portable", { repeat_runs: 3 }],
  ["TEST-18", "claude-code", { min_trigger_queries: 10 }],
  ["TEST-18", "portable", { min_trigger_queries: 10 }],
];

describe("pinned parameters", () => {
  for (const [id, profile, want] of PARAMS)
    it(`${id} ${profile}`, () => {
      assert.deepEqual(paramsFor(byId.get(id)!, profile), want);
    });
  it("no practice carries a parameter that is not pinned above", () => {
    const pinned = new Set(PARAMS.map(([id, pr]) => `${id}:${pr}`));
    for (const p of cat.practices)
      for (const [pr, rule] of Object.entries(p.profile_rules ?? {}))
        if (rule.params) assert.ok(pinned.has(`${p.id}:${pr}`), `${p.id}:${pr} has unpinned params`);
  });
});

type S = { strength: string; word: string; source: string };
const s = (strength: string, word: string, source: string): S => ({ strength, word, source });

/** Base strength per practice that has profile_rules or is one of the six portable MUST entries. */
const BASE: Record<string, S> = {
  "META-01": s("statement", "at most 256 characters", "CL"),
  "META-02": s("statement", "also invokes", "CC"),
  "META-03": s("statement", "doesn't load", "CC"),
  "META-05": s("statement", "reads the frontmatter only when", "CC"),
  "META-06": s("statement", "do not need", "SPEC"),
  "DESC-01": s("suggestion", "optional", "CC"),
  "DESC-02": s("directive", "Put the key use case first", "CC"),
  "DESC-10": s("statement", "displays", "CC"),
  "BODY-02": s("directive", "Keep", "CC"),
  "STRUCT-03": s("directive", "include", "BP"),
  "TEST-02": s("statement", "At least three", "BP"),
  "TEST-07": s("statement", "runs three times by default", "PE"),
  "TEST-18": s("statement", "triggers on 90%", "PDF"),
};
/** Portable overrides. The first six are the portable MUST practices. */
const PORTABLE: Record<string, S | null> = {
  "META-01": s("must", "Must", "SPEC"),
  "META-02": s("must", "Must", "SPEC"),
  "META-03": s("must", "Cannot", "BP"),
  "DESC-01": s("must", "Must", "BP"),
  "DESC-02": s("must", "Maximum", "BP"),
  "DESC-10": s("must", "Cannot", "BP"),
  "META-05": s("statement", "avoids the unexpected-key error", "CC"),
  "META-06": null, "BODY-02": null, "STRUCT-03": null, "TEST-02": null, "TEST-07": null, "TEST-18": null,
};
const MUST = ["META-01", "META-02", "META-03", "DESC-01", "DESC-02", "DESC-10"];

describe("pinned strength by id", () => {
  for (const [id, want] of Object.entries(BASE))
    it(`${id} base`, () => {
      const p = byId.get(id)!;
      assert.deepEqual(s(p.strength, p.strength_word, p.strength_source), want);
    });
  for (const [id, want] of Object.entries(PORTABLE))
    it(`${id} portable`, () => {
      const r = byId.get(id)!.profile_rules?.portable;
      if (want === null) assert.equal(r?.strength, undefined);
      else assert.deepEqual(s(r!.strength!, r!.strength_word!, r!.strength_source!), want);
    });
  it("claude-code never overrides strength", () => {
    for (const p of cat.practices) assert.equal(p.profile_rules?.["claude-code"]?.strength, undefined, p.id);
  });
  it("the portable MUST set is exactly the six", () => {
    const got = cat.practices.filter((p) => p.profile_rules?.portable?.strength === "must").map((p) => p.id);
    assert.deepEqual(got.sort(), [...MUST].sort());
  });
  it("only the pinned practices have profile_rules", () => {
    assert.deepEqual(cat.practices.filter((p) => p.profile_rules).map((p) => p.id).sort(), Object.keys(BASE).concat("META-05").filter((v, i, a) => a.indexOf(v) === i).sort());
  });
});

describe("generated data", () => {
  it("catalog/practices.yaml matches the committed SHA-256 (regenerate with npm run catalog:build)", () => {
    const want = readFileSync(dir + "practices.sha256", "utf8").trim();
    const got = createHash("sha256").update(readFileSync(dir + "practices.yaml")).digest("hex");
    assert.equal(got, want, "practices.yaml was edited by hand or the hash is stale");
  });
});
