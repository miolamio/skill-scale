import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { loadCatalogue } from "../../src/catalog/load.ts";
import { CHECKS } from "../../src/checks/index.ts";
import { BAD_FIXTURES } from "../helpers/bad-fixtures.ts";
import { runAll, tmp } from "../helpers/run-checks.ts";

const cat = loadCatalogue(new URL("../../catalog/", import.meta.url).pathname);

after(() => tmp.cleanup());

describe("checks and catalogue", () => {
  it("gives every check a practice that is purely mechanical and assessable from the artifact", () => {
    for (const c of CHECKS) {
      const p = cat.practices.find((x) => x.id === c.practice);
      assert.ok(p, c.practice);
      assert.deepEqual(p.assess, ["mechanical"], c.practice);
      assert.equal(p.assessable_from, "artifact", c.practice);
    }
  });
  it("names the six purely mechanical practices that have no check in this version", () => {
    const withCheck = new Set(CHECKS.map((c) => c.practice));
    const pending = cat.practices
      .filter((p) => p.assessable_from === "artifact" && p.assess.length === 1 && p.assess[0] === "mechanical" && !withCheck.has(p.id))
      .map((p) => p.id);
    assert.deepEqual(pending, ["META-08", "TRIG-05", "TRIG-06", "SCRIPT-08", "SAFE-04", "MAINT-07"]);
  });
  it("registers each check once", () => {
    assert.equal(new Set(CHECKS.map((c) => c.practice)).size, CHECKS.length);
    assert.equal(CHECKS.length, 17);
  });
  it("lets a security check sit only on a practice that is neither contested nor experimental (SKM-31, SKM-34)", () => {
    const secured = CHECKS.filter((c) => c.security);
    assert.deepEqual(secured.map((c) => c.practice), ["SAFE-02"]);
    for (const c of secured) {
      const p = cat.practices.find((x) => x.id === c.practice);
      assert.ok(p, c.practice);
      assert.equal(p.contested, false, `${c.practice} is contested but its check is marked security`);
      assert.equal(p.experimental, false, `${c.practice} is experimental but its check is marked security`);
      assert.match(c.security?.risk ?? "", /\S/, `${c.practice} needs a named risk`);
    }
  });
});

describe("effect declarations (SKM-31)", () => {
  const declared = CHECKS.filter((c) => c.effects !== undefined);
  it("declares effects on exactly the checks that can emit one", () => {
    assert.deepEqual(declared.map((c) => c.practice), ["META-01", "META-03", "META-05", "META-07"]);
    for (const c of declared) assert.ok((c.effects ?? []).length > 0, `${c.practice} declares an empty effects list`);
  });
  it("lets an effect check sit only on a practice that is mechanical, not contested and not experimental", () => {
    for (const c of declared) {
      const p = cat.practices.find((x) => x.id === c.practice);
      assert.ok(p, c.practice);
      assert.equal(p.contested, false, `${c.practice} is contested but its check can emit an effect`);
      assert.equal(p.experimental, false, `${c.practice} is experimental but its check can emit an effect`);
      assert.deepEqual(p.assess, ["mechanical"], `${c.practice} is not purely mechanical but its check can emit an effect`);
      assert.equal(p.assessable_from, "artifact", `${c.practice} is not assessable from the artifact but its check can emit an effect`);
    }
  });
  it("matches the declarations to the effects the checks actually emit", () => {
    const emitted = new Map<string, Set<string>>();
    for (const f of BAD_FIXTURES) {
      const out = runAll(f.dirName, f.files, f.profile, f.entry ? { entry: f.entry } : {});
      for (const [practice, fs] of Object.entries(out.findings)) {
        const set = emitted.get(practice) ?? new Set<string>();
        for (const x of fs) if (x.effect !== undefined) for (const lb of x.lb ?? []) set.add(lb);
        if (set.size > 0) emitted.set(practice, set);
      }
    }
    for (const [practice, lbs] of emitted) {
      const check = CHECKS.find((c) => c.practice === practice);
      for (const lb of lbs) assert.ok(check?.effects?.includes(lb), `${practice} emits ${lb} but does not declare it`);
    }
    for (const c of declared) for (const lb of c.effects ?? []) assert.ok(emitted.get(c.practice)?.has(lb), `${c.practice} declares ${lb} but no fixture makes it emit`);
  });
});
