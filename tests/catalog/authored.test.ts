import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadCatalogue } from "../../src/catalog/load.ts";
import { validateAuthored } from "../../src/catalog/schema.ts";
import { AREAS } from "../../src/catalog/types.ts";

const cat = loadCatalogue(new URL("../../catalog/", import.meta.url).pathname);

/**
 * Areas whose non-mechanical practices have not been authored yet. Each authoring task removes its areas from this set.
 * The practices that have a mechanical check are always validated.
 */
const PENDING_AREAS = new Set<string>([]);

describe("anchors and fix hints follow the authoring rules", () => {
  for (const area of AREAS)
    it(`${area}${PENDING_AREAS.has(area) ? " (mechanical practices only)" : ""}`, () => {
      const ps = cat.practices.filter((p) => p.area === area && (!PENDING_AREAS.has(area) || p.inferred === true));
      assert.deepEqual(validateAuthored(ps), []);
    });
  it("leaves no area pending", { todo: PENDING_AREAS.size > 0 }, () => {
    assert.deepEqual([...PENDING_AREAS], []);
    assert.equal(cat.practices.filter((p) => p.inferred !== true).length, 0);
  });
});
