import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadCatalogue } from "../../src/catalog/load.ts";
import { PROFILES } from "../../src/catalog/types.ts";
import { paramsFor, render } from "../../src/catalog/params.ts";

const cat = loadCatalogue(new URL("../../catalog/", import.meta.url).pathname);

describe("profile rules", () => {
  it("fills every placeholder of every authored text for every profile the practice applies to", () => {
    for (const p of cat.practices)
      for (const profile of PROFILES) {
        if (!p.profiles.includes(profile)) continue;
        const params = paramsFor(p, profile);
        for (const text of [...Object.values(p.anchors ?? {}), p.fix_hint ?? ""]) assert.doesNotMatch(render(text, params), /\{[a-z_]+\}/, `${p.id} ${profile}`);
      }
  });
  it("makes exactly the six portable MUST practices capable of blocking by strength, and none for claude-code", () => {
    const capable = cat.practices.flatMap((p) => PROFILES.filter((pr) => p.profiles.includes(pr) && (p.profile_rules?.[pr]?.strength ?? p.strength) === "must").map((pr) => `${p.id}:${pr}`));
    assert.deepEqual(capable.sort(), ["DESC-01:portable", "DESC-02:portable", "DESC-10:portable", "META-01:portable", "META-02:portable", "META-03:portable"]);
  });
});

describe("render", () => {
  it("replaces known placeholders, joins lists, and leaves unknown ones as written", () => {
    assert.equal(render("a {x} b {y}", { x: 5 }), "a 5 b {y}");
    assert.equal(render("{l}", { l: ["p", "q"] }), "p, q");
  });
});
