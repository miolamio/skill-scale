import assert from "node:assert/strict";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { loadCatalogue } from "../../src/catalog/load.ts";
import { AREAS } from "../../src/catalog/types.ts";
import { CHECKS_BY_PRACTICE } from "../../src/checks/index.ts";
import { loadSkill } from "../../src/loader/skill.ts";
import { renderConsolePretty } from "../../src/report/console-pretty.ts";
import { STRINGS_EN } from "../../src/report/strings.ts";
import { stripAnsi, visibleWidth } from "../../src/report/term.ts";
import type { CriterionRecord } from "../../src/score/score.ts";
import { buildRecords, summarise } from "../../src/score/score.ts";
import { BAD_FIXTURES } from "../helpers/bad-fixtures.ts";
import { tempDir, writeSkill } from "../helpers/skills.ts";

const cat = loadCatalogue(new URL("../../catalog/", import.meta.url).pathname);
const tmp = tempDir();
after(() => tmp.cleanup());

function render(label: string, profile: "claude-code" | "portable", opts: { width?: number; color?: boolean; home?: string } = {}, tweak: (rs: CriterionRecord[]) => void = () => {}) {
  const f = BAD_FIXTURES.find((b) => b.label === label) as (typeof BAD_FIXTURES)[number];
  const skill = loadSkill(writeSkill(join(tmp.path, f.label.replace(/\W/g, "_")), f.dirName, f.files));
  const records = buildRecords(cat, skill, profile, CHECKS_BY_PRACTICE);
  tweak(records);
  const summary = summarise(records, AREAS);
  return {
    root: skill.root,
    text: renderConsolePretty({ ctx: { version: "1.2.3", revision: 4, profile, skillPath: skill.root, skillName: "demo-skill" }, records, summary, strings: STRINGS_EN }, { width: opts.width ?? 80, home: opts.home ?? "/nonexistent-home", color: opts.color ?? true }),
  };
}

describe("renderConsolePretty", () => {
  it("shows the header, skill line, headline, areas, blockers, lowest scores and footer", () => {
    const { text } = render("uppercase name", "portable");
    const plain = stripAnsi(text);
    assert.match(plain, /^◢◤ skill-scale 1\.2\.3 · r4 · portable\n\n/);
    assert.match(plain, /demo-skill {2}→ {2}…?\//);
    assert.match(plain, /\d+ of \d+ scored · /);
    assert.match(plain, /META {3}[█░]{15} {2}\d\.\d\d +\d+\/\d+/);
    assert.match(plain, /Blockers\n/);
    assert.match(plain, /Lowest scores\n/);
    assert.match(plain, /Not scored: \d+ not run · \d+ contested/);
    assert.match(plain, /our inference/);
  });
  it("has a blank line after the header and never wraps the name and path line", () => {
    for (const width of [60, 80]) {
      const { text, root } = render("uppercase name", "portable", { width });
      const lines = stripAnsi(text).split("\n");
      assert.equal(lines[1], "");
      assert.match(lines[2] as string, /^demo-skill {2}→ {2}/);
      assert.ok(visibleWidth(lines[2] as string) <= width);
      assert.equal(lines[3], "");
      assert.ok(lines[2]!.endsWith(root.split("/").pop() as string), lines[2]);
      assert.match(lines[2] as string, /…\//);
    }
  });
  it("marks a blocker with a red cross and its practice id and title", () => {
    const { text } = render("uppercase name", "portable");
    assert.match(text, /\x1b\[31m✗\x1b\[39m [^\n]*META-01[^\n]*Name length and characters/);
    assert.doesNotMatch(stripAnsi(text), /No blockers/);
  });
  it("says No blockers with a green tick when there is none", () => {
    const { text } = render("README.md in the folder", "claude-code");
    assert.match(text, /\x1b\[32m✓ No blockers\x1b\[39m/);
  });
  it("uses a red cross for a 0 and a yellow triangle for 1 or 2, then the finding and an arrow fix hint", () => {
    const { text } = render("README.md in the folder", "claude-code", {}, (rs) => {
      const r = rs.find((x) => x.status === "scored" && x.score === 3 && !x.experimental);
      assert.ok(r);
      r.score = 1;
    });
    assert.match(text, /\x1b\[31m✗ 0\x1b\[39m /);
    assert.match(text, /\x1b\[33m▲ 1\x1b\[39m /);
    assert.match(stripAnsi(text), /\n {6}→ \S/);
  });
  it("lists the same lowest-scoring ids, in the same order, as the plain report", async () => {
    const { renderConsole } = await import("../../src/report/console.ts");
    const f = BAD_FIXTURES.find((b) => b.label === "uppercase name") as (typeof BAD_FIXTURES)[number];
    const skill = loadSkill(writeSkill(join(tmp.path, "order"), f.dirName, f.files));
    const records = buildRecords(cat, skill, "portable", CHECKS_BY_PRACTICE);
    const summary = summarise(records, AREAS);
    const ctx = { version: "1.2.3", revision: 4, profile: "portable", skillPath: skill.root };
    const ids = (s: string, re: RegExp): string[] => s.split("Lowest scores")[1]!.split("\n").flatMap((l) => (re.exec(l) ? [re.exec(l)![1]!] : []));
    const plainIds = ids(renderConsole(ctx, records, summary, STRINGS_EN), /^ {2}\d ([A-Z]+-\d+) /);
    const prettyIds = ids(stripAnsi(renderConsolePretty({ ctx, records, summary, strings: STRINGS_EN }, { width: 80, home: "/x", color: true })), /^ {2}[✗▲] \d ([A-Z]+-\d+) /);
    assert.ok(plainIds.length > 0);
    assert.deepEqual(prettyIds, plainIds);
  });
  it("colours area bars by mean: green at 3, red below 1, dim with no score", () => {
    const { text } = render("uppercase name", "portable");
    assert.match(text, /\x1b\[32m█{15}\x1b\[39m/);
    assert.match(text, /\x1b\[2m·{15}\x1b\[22m/);
    const low = render("uppercase name", "portable", {}, (rs) => {
      for (const r of rs) if (r.status === "scored") r.score = 0;
    });
    assert.match(low.text, /\x1b\[31m░{15}\x1b\[39m/);
  });
  it("shortens the home directory to ~", () => {
    const f = BAD_FIXTURES.find((b) => b.label === "uppercase name") as (typeof BAD_FIXTURES)[number];
    const dir = join(tmp.path, "uppercase_name");
    const { text } = render("uppercase name", "portable", { home: tmp.path });
    assert.ok(f);
    assert.ok(dir);
    assert.match(stripAnsi(text), /→ {2}~\//);
    assert.doesNotMatch(stripAnsi(text), new RegExp(`→  ${tmp.path}`));
  });
  for (const [label, profile] of [["uppercase name", "portable"], ["README.md in the folder", "claude-code"]] as const)
    for (const width of [60, 80, 100])
      it(`keeps every line within ${width} columns (${label})`, () => {
        const { text } = render(label, profile, { width });
        for (const line of text.split("\n")) assert.ok(visibleWidth(line) <= width, `${visibleWidth(line)} > ${width}: ${stripAnsi(line)}`);
      });
  it("contains no ESC byte with colour off, and the same text as with colour on", () => {
    const off = render("uppercase name", "portable", { color: false }).text;
    const on = render("uppercase name", "portable", { color: true }).text;
    assert.ok(!off.includes("\x1b"));
    assert.equal(off, stripAnsi(on));
  });
});
