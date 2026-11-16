import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { BAD_FIXTURES } from "../helpers/bad-fixtures.ts";
import { cat, runAll, tmp } from "../helpers/run-checks.ts";
import { GOOD_DIR, GOOD_FILES } from "../helpers/skills.ts";

after(() => tmp.cleanup());

/** The mapping the team lead fixed for research section 2.12: only these LB IDs produce an effect. */
const MAPPING: Record<string, "not_loaded" | "fields_ignored"> = {
  "LB-01": "not_loaded", "LB-02": "not_loaded", "LB-05": "not_loaded", "LB-06": "not_loaded", "LB-08": "not_loaded",
  "LB-03": "fields_ignored", "LB-04": "fields_ignored", "LB-09": "fields_ignored",
};

describe("effects", () => {
  it("cover every mapped LB ID with a fixture, and no other LB ID", () => {
    const cited = new Set(BAD_FIXTURES.flatMap((f) => f.effect?.lb ?? []));
    assert.deepEqual([...cited].sort(), Object.keys(MAPPING).sort());
  });
  it("use the effect the mapping gives each LB ID", () => {
    for (const f of BAD_FIXTURES) for (const lb of f.effect?.lb ?? []) assert.equal(MAPPING[lb], f.effect?.effect, `${f.label} ${lb}`);
  });
  it("cite LB IDs that exist in the catalogue's load facts", () => {
    const ids = new Set(cat.load_facts.map((f) => f.id));
    for (const lb of Object.keys(MAPPING)) assert.ok(ids.has(lb), lb);
  });
  it("leave a good skill inside a plugin without any finding", () => {
    const files = { ...GOOD_FILES, ".claude-plugin/plugin.json": "{}" };
    assert.deepEqual(runAll(GOOD_DIR, files, "claude-code").findings, {});
  });
  it("treat a refused character in the folder name as no defect inside a plugin, and as not_loaded outside", () => {
    assert.deepEqual(runAll("good\u200bskill", GOOD_FILES, "claude-code", { plugin: "yes" }).findings, {});
    const out = runAll("good\u200bskill", GOOD_FILES, "claude-code", { plugin: "no" }).findings["META-03"] ?? [];
    assert.deepEqual(out.map((f) => [f.effect, f.lb]), [["not_loaded", ["LB-01", "LB-02"]]]);
  });
});
