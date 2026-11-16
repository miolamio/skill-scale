import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { loadCatalogue } from "../../src/catalog/load.ts";
import { CHECKS_BY_PRACTICE } from "../../src/checks/index.ts";
import { loadSkill } from "../../src/loader/skill.ts";
import { buildRecords } from "../../src/score/score.ts";
import type { CriterionRecord } from "../../src/score/score.ts";
import { adviseSkill, lowScoreRecords, NOTE_BAD_PATH, NOTE_UNVERIFIED, readSiblings, validateAdvice } from "../../src/advisor/advisor.ts";
import { fakeRunner, infra, ok } from "../helpers/fake-runner.ts";
import { GOOD_DIR, GOOD_FILES, tempDir, writeSkill } from "../helpers/skills.ts";

const SHIPPED = new URL("../../catalog/", import.meta.url).pathname;
const cat = loadCatalogue(SHIPPED);
const tmp = tempDir();
after(() => tmp.cleanup());
const dir = writeSkill(tmp.path, GOOD_DIR, GOOD_FILES);
const skill = loadSkill(dir);
const base = buildRecords(cat, skill, "claude-code", CHECKS_BY_PRACTICE, { judge: true });
const withQuotes = base.filter((r) => r.quotes.length >= 2).slice(0, 4);
const [A, B, C, D] = withQuotes.map((r) => r.id) as [string, string, string, string];

/** Four records scored low, with the catalogue's real quotes. */
const records: CriterionRecord[] = base.map((r) =>
  [A, B, C, D].includes(r.id) ? { ...r, status: "scored" as const, score: r.id === A ? 0 : 1, reason: null } : r,
);
const sent = lowScoreRecords(records, new Set());
const skillLine = skill.raw.split("\n")[0] as string;

const v = (raw: unknown) => validateAdvice(raw, { sent, skill }) as NonNullable<ReturnType<typeof validateAdvice>>;
const rec = (o: Record<string, unknown> = {}) => ({
  title: "A title",
  priority: "high",
  practice_ids: [A],
  problem: "A problem.",
  lines: [{ file: "SKILL.md", start: 1, end: 2 }],
  change: null,
  note: null,
  ...o,
});

describe("lowScoreRecords", () => {
  it("keeps scored practices below 3: blockers first, then score, then id", () => {
    const got = lowScoreRecords(records, new Set([C]));
    assert.equal(got[0]?.id, C);
    assert.deepEqual(got.map((r) => r.id).slice(1), [A, ...[B, D].sort()]);
  });
});

describe("validateAdvice", () => {
  it("drops unknown practice ids, and a recommendation left with none", () => {
    const a = v({ recommendations: [rec({ practice_ids: [A, "NOPE-99"] }), rec({ practice_ids: ["NOPE-99"] })], set_aside: [] });
    assert.equal(a.recommendations.length, 1);
    assert.deepEqual(a.recommendations[0]?.practice_ids, [A]);
  });

  it("uses every sent practice at most once across recommendations and set-asides", () => {
    const a = v({
      recommendations: [rec({ practice_ids: [A, B] }), rec({ title: "Second", practice_ids: [B] }), rec({ title: "Third", practice_ids: [B, C] })],
      set_aside: [{ practice_id: C, reason: "x" }, { practice_id: D, reason: "y" }, { practice_id: D, reason: "again" }],
    });
    assert.deepEqual(a.recommendations.map((r) => r.practice_ids), [[A, B], [C]]);
    assert.deepEqual(a.set_aside, [{ practice_id: D, reason: "y" }]);
    assert.deepEqual(a.other, []);
  });

  it("lists practices that were neither recommended nor set aside", () => {
    const a = v({ recommendations: [rec()], set_aside: [] });
    assert.deepEqual(a.other, sent.map((r) => r.id).filter((id) => id !== A));
  });

  it("drops line ranges outside the file or in an unknown file", () => {
    const n = skill.raw.split("\n").length;
    const a = v({
      recommendations: [rec({ lines: [{ file: "SKILL.md", start: 1, end: 2 }, { file: "SKILL.md", start: 1, end: n + 5 }, { file: "SKILL.md", start: 0, end: 1 }, { file: "nope.md", start: 1, end: 1 }, { file: "SKILL.md", start: 3, end: 2 }] })],
      set_aside: [],
    });
    assert.deepEqual(a.recommendations[0]?.lines, [{ file: "SKILL.md", start: 1, end: 2 }]);
  });

  it("keeps a diff whose remove lines occur in the file (trailing whitespace ignored)", () => {
    const a = v({ recommendations: [rec({ change: { kind: "diff", file: "SKILL.md", remove: [`${skillLine}   `], add: ["new"] } })], set_aside: [] });
    assert.equal(a.recommendations[0]?.change?.kind, "diff");
    assert.equal(a.recommendations[0]?.note, null);
  });

  const diffOf = (remove: string[], extra: Record<string, unknown> = {}, sk = skill) =>
    validateAdvice({ recommendations: [rec({ ...extra, change: { kind: "diff", file: "SKILL.md", remove, add: ["x"] } })], set_aside: [] }, { sent, skill: sk })?.recommendations[0];
  const H = "# Good skill";
  const S = "Summarise a sales CSV in three steps.";

  it("keeps a contiguous, ordered remove block (blank line inside, trailing space ignored) and records its start line", () => {
    const r = diffOf([`${H}  `, "", S]);
    assert.equal(r?.change?.kind, "diff");
    assert.equal(r?.change?.line, 8);
    assert.equal(r?.note, null);
  });

  it("rejects remove lines that all exist but are not adjacent", () => {
    const r = diffOf(["name: good-skill", "## Gotchas"]);
    assert.equal(r?.change, null);
    assert.match(r?.note ?? "", new RegExp(NOTE_UNVERIFIED));
  });

  it("rejects remove lines that are in the file but out of order", () => {
    const r = diffOf([S, H]);
    assert.equal(r?.change, null);
    assert.match(r?.note ?? "", new RegExp(NOTE_UNVERIFIED));
  });

  it("does not let an empty string, or only blank lines, verify a change", () => {
    assert.equal(diffOf([""])?.change, null);
    assert.equal(diffOf(["", "  "])?.change, null);
  });

  it("with several matches, takes the one inside the cited lines, else the first", () => {
    const dupDir = writeSkill(tmp.path, "dup-skill", { ...GOOD_FILES, "SKILL.md": GOOD_FILES["SKILL.md"] + "\n## Again\n\n- Amounts in the export are in cents, not dollars.\n" });
    const dup = loadSkill(dupDir);
    const block = ["- Amounts in the export are in cents, not dollars."];
    assert.equal(diffOf(block, { lines: [] }, dup)?.change?.line, 18);
    assert.equal(diffOf(block, { lines: [{ file: "SKILL.md", start: 20, end: 22 }] }, dup)?.change?.line, 22);
  });

  it("replaces a diff whose remove line is not in the file with null and a note", () => {
    const a = v({ recommendations: [rec({ note: "Mine.", change: { kind: "diff", file: "SKILL.md", remove: ["this line does not exist"], add: ["x"] } })], set_aside: [] });
    assert.equal(a.recommendations.length, 1);
    assert.equal(a.recommendations[0]?.change, null);
    assert.match(a.recommendations[0]?.note ?? "", new RegExp(NOTE_UNVERIFIED));
    assert.match(a.recommendations[0]?.note ?? "", /Mine\./);
  });

  it("checks after_line for kind add", () => {
    const n = skill.raw.split("\n").length - 1;
    const add = (after_line: number) => v({ recommendations: [rec({ change: { kind: "add", file: "SKILL.md", after_line, remove: [], add: ["x"] } })], set_aside: [] }).recommendations[0];
    assert.equal(add(0)?.change?.after_line, 0);
    assert.equal(add(n)?.change?.after_line, n);
    assert.equal(add(n + 1)?.change, null);
    assert.equal(add(-1)?.change, null);
    assert.match(add(-1)?.note ?? "", new RegExp(NOTE_UNVERIFIED));
  });

  it("rejects new_file paths that escape, are absolute or exist", () => {
    const nf = (file: string) => v({ recommendations: [rec({ change: { kind: "new_file", file, remove: [], add: ["x"] } })], set_aside: [] }).recommendations[0];
    assert.equal(nf("evals/new.json")?.change?.file, "evals/new.json");
    for (const bad of ["../evil.md", "a/../../evil.md", "/etc/passwd", "reference/data-guide.md", "SKILL.md", "reference", "C:/x.md", "a\\b.md", ""]) {
      assert.equal(nf(bad)?.change, null, bad);
      assert.match(nf(bad)?.note ?? "", new RegExp(NOTE_BAD_PATH), bad);
    }
  });

  it("takes quotes only from the catalogue quotes of its practices: at most 3, no duplicates", () => {
    const a = v({ recommendations: [rec({ practice_ids: [A, B, C, D], quotes: [{ text: "Invented by the model" }] })], set_aside: [] });
    const q = a.recommendations[0]?.quotes ?? [];
    assert.ok(q.length >= 1 && q.length <= 3);
    const allowed = new Set(sent.flatMap((r) => r.quotes.map((x) => x.text)));
    for (const x of q) assert.ok(allowed.has(x.text));
    assert.equal(new Set(q.map((x) => x.text)).size, q.length);
    assert.ok(!JSON.stringify(a).includes("Invented by the model"));
  });

  it("caps recommendations at 8, repairs a bad priority and truncates long text", () => {
    const many = Array.from({ length: 12 }, (_, i) => rec({ title: `T${i}`, practice_ids: [`NOPE-${i}`] }));
    assert.equal(v({ recommendations: many, set_aside: [] }).recommendations.length, 0);
    const a = v({ recommendations: [rec({ priority: "urgent", title: "x".repeat(300), problem: "p".repeat(2000) })], set_aside: [] });
    assert.equal(a.recommendations[0]?.priority, "low");
    assert.equal(a.recommendations[0]?.title.length, 90);
    assert.equal(a.recommendations[0]?.problem.length, 600);
  });

  it("returns null for an unusable shape and never throws on junk", () => {
    assert.equal(validateAdvice("nope", { sent, skill }), null);
    assert.equal(validateAdvice({ recommendations: "x" }, { sent, skill }), null);
    const a = v({ recommendations: [null, 7, { practice_ids: [A], title: "t", change: { kind: "diff", remove: 5, add: null }, lines: [null, { file: 3 }] }], set_aside: [null, { practice_id: 4 }] });
    assert.equal(a.recommendations.length, 1);
    assert.equal(a.recommendations[0]?.change, null);
  });
});

describe("adviseSkill", () => {
  it("makes one isolated call with the nonce-delimited skill, the low scores and the siblings", async () => {
    const fake = fakeRunner([ok({ recommendations: [rec()], set_aside: [] }, 0.07, 500)]);
    const r = await adviseSkill({ skill, records, blockerIds: new Set(), runner: fake, model: "m-1", nonce: () => "abc123", siblings: [{ name: "neighbour", description: "Does other things." }] });
    assert.equal(fake.calls.length, 1);
    const req = fake.calls[0];
    assert.equal(req?.model, "m-1");
    assert.match(req?.prompt ?? "", /<untrusted-skill-abc123>/);
    assert.match(req?.prompt ?? "", /<\/untrusted-skill-abc123>/);
    assert.match(req?.prompt ?? "", /<untrusted-siblings-abc123>/);
    assert.match(req?.prompt ?? "", /neighbour/);
    for (const x of sent) assert.ok((req?.prompt ?? "").includes(`"id": "${x.id}"`));
    assert.match(req?.prompt ?? "", /^1\t---$/m);
    const props = (req?.schema as any).properties.recommendations.items.properties;
    assert.deepEqual(props.practice_ids.items.enum, sent.map((x) => x.id));
    assert.equal(props.title.maxLength, 90);
    assert.equal(r.ok, true);
    assert.equal(r.costUsd, 0.07);
  });

  it("turns a runner failure into a result", async () => {
    const r = await adviseSkill({ skill, records, blockerIds: new Set(), runner: fakeRunner([infra("boom")]), model: "m", siblings: [] });
    assert.deepEqual([r.ok, r.ok ? "" : r.reason], [false, "boom"]);
  });

  it("turns an unusable answer into a failure result", async () => {
    const r = await adviseSkill({ skill, records, blockerIds: new Set(), runner: fakeRunner([ok({ nope: 1 })]), model: "m", siblings: [] });
    assert.equal(r.ok, false);
  });
});

describe("readSiblings", () => {
  it("reads name and description of sibling skills only", () => {
    const base2 = tempDir();
    try {
      const mk = (name: string, fm: string) => writeSkill(base2.path, name, { "SKILL.md": `---\n${fm}\n---\nbody\n` });
      const me = mk("me", "name: me\ndescription: Mine.");
      mk("one", "name: one\ndescription: First neighbour.");
      mk("two", "description: Second neighbour.");
      mk("broken", "name: [unclosed");
      writeSkill(base2.path, "not-a-skill", { "README.md": "x" });
      const got = readSiblings(loadSkill(me));
      assert.deepEqual(got, [{ name: "one", description: "First neighbour." }, { name: "two", description: "Second neighbour." }]);
    } finally {
      base2.cleanup();
    }
  });

  it("caps at 30 and gives none for a missing parent", () => {
    const base2 = tempDir();
    try {
      for (let i = 0; i < 40; i++) writeSkill(base2.path, `s${String(i).padStart(2, "0")}`, { "SKILL.md": `---\nname: s${i}\ndescription: d\n---\n` });
      assert.equal(readSiblings(loadSkill(`${base2.path}/s00`)).length, 30);
    } finally {
      base2.cleanup();
    }
    assert.deepEqual(readSiblings({ ...skill, root: "/nonexistent/zzz/skill" }), []);
  });
});
