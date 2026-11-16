import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { CHECKS } from "../../src/checks/index.ts";
import type { Finding } from "../../src/checks/types.ts";
import { BAD_FIXTURES } from "../helpers/bad-fixtures.ts";
import { runAll, tmp } from "../helpers/run-checks.ts";
import { GOOD_DIR, GOOD_FILES } from "../helpers/skills.ts";

after(() => tmp.cleanup());

describe("good fixture", () => {
  for (const profile of ["claude-code", "portable"] as const)
    it(`triggers no finding, and no registered check is skipped (${profile})`, () => {
      const { findings, kinds } = runAll(GOOD_DIR, GOOD_FILES, profile);
      assert.deepEqual(findings, {});
      assert.deepEqual(Object.entries(kinds).filter(([, k]) => k !== "ran").map(([id]) => id), []);
    });
});

describe("one bad fixture per defect", () => {
  it("has a bad fixture for every registered check, and none for an unregistered one", () => {
    assert.deepEqual([...new Set(BAD_FIXTURES.map((f) => f.practice))].sort(), CHECKS.map((c) => c.practice).sort());
  });
  for (const f of BAD_FIXTURES)
    it(`${f.practice} (${f.profile}): ${f.label} is found, and nothing else is`, () => {
      const { findings } = runAll(f.dirName, f.files, f.profile, f.entry ? { entry: f.entry } : {});
      assert.deepEqual(Object.keys(findings), [f.practice]);
      const own = findings[f.practice] as Finding[];
      assert.ok((own[0] as Finding).message.length > 0);
      if (f.effect) assert.deepEqual(own.filter((x) => x.effect).map((x) => [x.effect, x.lb]), [[f.effect.effect, f.effect.lb]]);
      else assert.deepEqual(own.filter((x) => x.effect), [], "a defect with no stated effect must not carry one");
    });
});
