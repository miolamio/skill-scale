import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { runAll, tmp } from "../helpers/run-checks.ts";
import { GOOD_DIR, GOOD_FILES, variant } from "../helpers/skills.ts";

after(() => tmp.cleanup());

const named = (name: string) => variant({ "SKILL.md": `---\nname: ${name}\ndescription: Summarises sales files. Use when asked.\n---\n# x\n` });

describe("META-01", () => {
  it("accepts 64 characters and refuses 65 under portable", () => {
    assert.equal("META-01" in runAll("a".repeat(64), named("a".repeat(64)), "portable").findings, false);
    assert.equal("META-01" in runAll("a".repeat(65), named("a".repeat(65)), "portable").findings, true);
  });
  it("accepts 256 characters and refuses 257 under claude-code", () => {
    assert.equal("META-01" in runAll(GOOD_DIR, named("a".repeat(256)), "claude-code").findings, false);
    assert.equal("META-01" in runAll(GOOD_DIR, named("a".repeat(257)), "claude-code").findings, true);
  });
  it("accepts uppercase under claude-code and refuses it under portable", () => {
    const files = variant({ "SKILL.md": (GOOD_FILES["SKILL.md"] as string).replace("name: good-skill", "name: Good-Skill") });
    assert.equal("META-01" in runAll(GOOD_DIR, files, "claude-code").findings, false);
    assert.equal("META-01" in runAll(GOOD_DIR, files, "portable").findings, true);
  });
  it("refuses a double hyphen and a leading hyphen under portable", () => {
    for (const bad of ["pdf--tool", "-pdf", "pdf-"]) assert.ok("META-01" in runAll(bad, named(bad), "portable").findings, bad);
  });
  it("requires a name under portable and not under claude-code", () => {
    const files = variant({ "SKILL.md": "---\ndescription: Summarises sales files. Use when asked.\n---\n# x\n" });
    assert.ok("META-01" in runAll(GOOD_DIR, files, "portable").findings);
    assert.equal("META-01" in runAll(GOOD_DIR, files, "claude-code").findings, false);
  });
});

describe("META-03", () => {
  it("compares reserved folder names without regard to case", () => {
    assert.ok("META-03" in runAll("Synced", GOOD_FILES, "claude-code").findings);
  });
  it("refuses angle brackets in the name under both profiles", () => {
    for (const profile of ["claude-code", "portable"] as const) assert.ok("META-03" in runAll(GOOD_DIR, named('"my<skill>"'), profile).findings, profile);
  });
});

describe("META-05 and META-06", () => {
  it("accepts a skill with no frontmatter at all", () => {
    const files = variant({ "SKILL.md": "# Just a body\n" });
    assert.equal("META-05" in runAll(GOOD_DIR, files, "claude-code").findings, false);
  });
  it("lets metadata keys that are not field names through", () => {
    const files = variant({ "SKILL.md": (GOOD_FILES["SKILL.md"] as string).replace("sales-report-owner", "team") });
    assert.equal("META-06" in runAll(GOOD_DIR, files, "claude-code").findings, false);
  });
});
