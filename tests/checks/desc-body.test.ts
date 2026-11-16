import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { runAll, tmp } from "../helpers/run-checks.ts";
import { GOOD_DIR, GOOD_FILES, variant } from "../helpers/skills.ts";

after(() => tmp.cleanup());

const withDescription = (d: string, extra = "") => variant({ "SKILL.md": `---\nname: good-skill\ndescription: ${d}\n${extra}---\n# x\n` });

describe("DESC-02", () => {
  it("accepts exactly 1,024 characters under portable and refuses 1,025", () => {
    assert.equal("DESC-02" in runAll(GOOD_DIR, withDescription("x".repeat(1024)), "portable").findings, false);
    assert.equal("DESC-02" in runAll(GOOD_DIR, withDescription("x".repeat(1025)), "portable").findings, true);
  });
  it("accepts exactly 1,536 characters under claude-code and refuses 1,537", () => {
    assert.equal("DESC-02" in runAll(GOOD_DIR, withDescription("x".repeat(1536)), "claude-code").findings, false);
    assert.equal("DESC-02" in runAll(GOOD_DIR, withDescription("x".repeat(1537)), "claude-code").findings, true);
  });
  it("counts when_to_use together with the description under claude-code only", () => {
    const files = withDescription("Summarises sales files. Use when asked.", `when_to_use: ${"w".repeat(1540)}\n`);
    assert.ok("DESC-02" in runAll(GOOD_DIR, files, "claude-code").findings);
    assert.equal("DESC-02" in runAll(GOOD_DIR, files, "portable").findings, false);
  });
});

describe("DESC-01 and DESC-10", () => {
  it("refuses a description that is only whitespace", () => {
    assert.ok("DESC-01" in runAll(GOOD_DIR, withDescription('"   "'), "claude-code").findings);
  });
  it("does not take a comparison for an XML tag", () => {
    assert.equal("DESC-10" in runAll(GOOD_DIR, withDescription("Flags rows where a < b and b > c. Use when asked."), "portable").findings, false);
  });
});

describe("BODY-02", () => {
  const total = (n: number) => {
    const head = (GOOD_FILES["SKILL.md"] as string).split("\n").length - 1;
    return variant({ "SKILL.md": `${GOOD_FILES["SKILL.md"]}${Array.from({ length: n - head }, (_, i) => `Filler ${i}`).join("\n")}\n` });
  };
  it("accepts 499 lines and refuses 500, under both profiles", () => {
    for (const profile of ["claude-code", "portable"] as const) {
      assert.equal("BODY-02" in runAll(GOOD_DIR, total(499), profile).findings, false, `${profile} 499`);
      assert.equal("BODY-02" in runAll(GOOD_DIR, total(500), profile).findings, true, `${profile} 500`);
    }
  });
});
