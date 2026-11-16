import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { hasTableOfContents } from "../../src/checks/struct.ts";
import { runAll, tmp } from "../helpers/run-checks.ts";
import { GOOD_DIR, GOOD_FILES, lines, variant } from "../helpers/skills.ts";

after(() => tmp.cleanup());

describe("hasTableOfContents", () => {
  it("accepts a Contents or Table of Contents heading as the first section", () => {
    assert.ok(hasTableOfContents("# T\n\n## Contents\n- a\n\n## A\n"));
    assert.ok(hasTableOfContents("# T\n## Table of contents\n- a\n"));
  });
  it("accepts a run of three anchor links before the first section", () => {
    assert.ok(hasTableOfContents("# T\n\n- [a](#a)\n- [b](#b)\n- [c](#c)\n\n## A\n"));
  });
  it("refuses a Contents heading that comes after another section, and two anchor links", () => {
    assert.equal(hasTableOfContents("# T\n\n## Intro\ntext\n\n## Contents\n- a\n"), false);
    assert.equal(hasTableOfContents("# T\n\n- [a](#a)\n- [b](#b)\n\n## A\n"), false);
  });
});

describe("STRUCT-03", () => {
  const ref = (n: number, toc: boolean) => variant({ "reference/data-guide.md": `# Data guide\n\n${toc ? "## Contents\n- All\n\n## All\n" : ""}${lines(n - (toc ? 6 : 2), "Note")}\n` });
  it("is not applicable at 100 lines and fails at 101 without a table of contents", () => {
    assert.equal(runAll(GOOD_DIR, ref(100, false), "claude-code").kinds["STRUCT-03"], "not_applicable");
    assert.ok("STRUCT-03" in runAll(GOOD_DIR, ref(101, false), "claude-code").findings);
  });
  it("passes at 101 lines with a table of contents", () => {
    assert.equal(runAll(GOOD_DIR, ref(101, true), "claude-code").kinds["STRUCT-03"], "ran");
    assert.equal("STRUCT-03" in runAll(GOOD_DIR, ref(101, true), "claude-code").findings, false);
  });
  it("ignores a long Markdown file that nothing links to", () => {
    const files = variant({ "notes/long.md": `# Long\n\n${lines(150, "Note")}\n` });
    assert.equal("STRUCT-03" in runAll(GOOD_DIR, files, "claude-code").findings, false);
  });
});

describe("STRUCT-02 and STRUCT-10", () => {
  it("lets a reference file link to another file that SKILL.md also links to", () => {
    const files = variant({
      "SKILL.md": `${GOOD_FILES["SKILL.md"]}\nAlso [regions](reference/regions.md).\n`,
      "reference/regions.md": "# Regions\n",
      "reference/data-guide.md": `${GOOD_FILES["reference/data-guide.md"]}\nSee [regions](regions.md).\n`,
    });
    assert.equal("STRUCT-02" in runAll(GOOD_DIR, files, "claude-code").findings, false);
  });
  it("is not applicable when SKILL.md links to nothing", () => {
    const files = variant({ "SKILL.md": "---\nname: good-skill\ndescription: Summarises sales files. Use when asked.\n---\n# x\n" });
    assert.equal(runAll(GOOD_DIR, files, "claude-code").kinds["STRUCT-02"], "not_applicable");
    assert.equal(runAll(GOOD_DIR, files, "claude-code").kinds["STRUCT-10"], "not_applicable");
  });
  it("finds a link that leaves the skill folder and a missing skill-folder script", () => {
    const files = variant({ "SKILL.md": `${GOOD_FILES["SKILL.md"]}\n[x](../outside.md)\nRun \${CLAUDE_SKILL_DIR}/scripts/missing.py\n` });
    const found = runAll(GOOD_DIR, files, "claude-code").findings["STRUCT-10"] ?? [];
    assert.deepEqual(found.map((f) => f.message.replace(/^.* (does not exist|points outside).*$/, "$1")), ["points outside", "does not exist"]);
  });
});
