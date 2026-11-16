import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateAnswer } from "../../src/judge/validate.ts";

const files = [
  { path: "SKILL.md", text: "line one here\nIt’s the second line\nthird   line with `code` word\nfourth line\nfifth line\nsixth line\nseventh line\n" },
  { path: "reference/a.md", text: "ref one\nref two\n" },
];
const ids = ["BODY-01", "DESC-03", "META-04"];
const mk = (id: string, o: Record<string, unknown> = {}) => ({ practice_id: id, status: "scored", score: 2, quote: "line one here", file: "SKILL.md", line: 1, reason: "r", ...o });
const good = () => ({ results: ids.map((i) => mk(i)), injection: null });
const kinds = (a: unknown) => validateAnswer(a, ids, files).failing.map((f) => `${f.id}:${f.kind}`);

describe("validateAnswer", () => {
  it("accepts a good answer", () => {
    const v = validateAnswer(good(), ids, files);
    assert.deepEqual(v.failing, []);
    assert.deepEqual([...v.accepted.keys()], ids);
    assert.equal(v.accepted.get("BODY-01")?.kind, "scored");
  });
  it("reports a missing id and keeps the others", () => {
    const a = good();
    a.results = a.results.filter((r) => r.practice_id !== "DESC-03");
    const v = validateAnswer(a, ids, files);
    assert.deepEqual(v.failing.map((f) => [f.id, f.kind]), [["DESC-03", "missing"]]);
    assert.equal(v.accepted.size, 2);
  });
  it("drops both copies of a duplicate", () => {
    const a = good();
    a.results.push(mk("META-04"));
    const v = validateAnswer(a, ids, files);
    assert.deepEqual(v.failing.map((f) => [f.id, f.kind]), [["META-04", "duplicate"]]);
    assert.ok(!v.accepted.has("META-04"));
  });
  it("ignores an id that was not sent", () => {
    const a = good();
    a.results.push(mk("ZZZ-99"));
    const v = validateAnswer(a, ids, files);
    assert.deepEqual(v.failing, []);
    assert.equal(v.accepted.size, 3);
  });
  it("treats unreadable entries as unsupported or missing, and never throws", () => {
    assert.deepEqual(kinds(null), ids.map((i) => `${i}:missing`));
    assert.deepEqual(kinds([]), ids.map((i) => `${i}:missing`));
    assert.deepEqual(kinds("x"), ids.map((i) => `${i}:missing`));
    assert.deepEqual(kinds({ results: "nope" }), ids.map((i) => `${i}:missing`));
    assert.deepEqual(kinds({ results: [null, 3, "x", mk("BODY-01"), mk("DESC-03"), mk("META-04")] }), []);
    assert.deepEqual(kinds({ results: [{ practice_id: "BODY-01" }, mk("DESC-03"), mk("META-04")] }), ["BODY-01:unsupported"]);
    assert.deepEqual(kinds({ results: [mk("BODY-01", { line: "1" }), mk("DESC-03", { quote: 5 }), mk("META-04", { reason: null })] }), ids.map((i) => `${i}:unsupported`));
  });
  it("checks status and score consistency", () => {
    for (const bad of [{ score: null }, { score: 4 }, { score: -1 }, { score: 1.5 }, { score: "2" }, { status: "other" }, { status: "not_applicable", score: 2 }]) {
      const a = { results: [mk("BODY-01", bad), mk("DESC-03"), mk("META-04")] };
      assert.deepEqual(kinds(a), ["BODY-01:unsupported"], JSON.stringify(bad));
    }
    const na = { results: [mk("BODY-01", { status: "not_applicable", score: null }), mk("DESC-03"), mk("META-04")] };
    const v = validateAnswer(na, ids, files);
    assert.deepEqual(v.failing, []);
    assert.equal(v.accepted.get("BODY-01")?.kind, "not_applicable");
  });
  describe("evidence", () => {
    const one = (o: Record<string, unknown>) => validateAnswer({ results: [mk("BODY-01", o), mk("DESC-03"), mk("META-04")] }, ids, files).failing.map((f) => f.kind);
    it("accepts the cited line and one or two lines off, rejects three", () => {
      assert.deepEqual(one({ quote: "fourth line", line: 4 }), []);
      assert.deepEqual(one({ quote: "fourth line", line: 3 }), []);
      assert.deepEqual(one({ quote: "fourth line", line: 5 }), []);
      assert.deepEqual(one({ quote: "fourth line", line: 2 }), []);
      assert.deepEqual(one({ quote: "fourth line", line: 6 }), []);
      assert.deepEqual(one({ quote: "fourth line", line: 1 }), ["unsupported"]);
      assert.deepEqual(one({ quote: "seventh line", line: 3 }), ["unsupported"]);
    });
    it("rejects an absent, empty, over-long or multi-line quote", () => {
      assert.deepEqual(one({ quote: "nothing like it" }), ["unsupported"]);
      assert.deepEqual(one({ quote: "   " }), ["unsupported"]);
      assert.deepEqual(one({ quote: "" }), ["unsupported"]);
      assert.deepEqual(one({ quote: "line one here\nIt’s the second line", line: 1 }), ["unsupported"]);
      assert.deepEqual(one({ quote: "line one here It’s the second line", line: 1 }), ["unsupported"]);
      assert.deepEqual(one({ quote: "x".repeat(201) }), ["unsupported"]);
    });
    it("rejects an unknown file and a line outside the file", () => {
      assert.deepEqual(one({ file: "other.md" }), ["unsupported"]);
      assert.deepEqual(one({ line: 0 }), ["unsupported"]);
      assert.deepEqual(one({ line: 8 }), ["unsupported"]);
      assert.deepEqual(one({ file: "reference/a.md", quote: "ref two", line: 2 }), []);
      assert.deepEqual(one({ file: "reference/a.md", quote: "ref two", line: 3 }), ["unsupported"]);
    });
    it("normalises apostrophes, whitespace and backticks, but not wording", () => {
      assert.deepEqual(one({ quote: "It's the second line", line: 2 }), []);
      assert.deepEqual(one({ quote: "third line with code word", line: 3 }), []);
      assert.deepEqual(one({ quote: "third   line with `code` word", line: 3 }), []);
      assert.deepEqual(one({ quote: "`third` line with code word", line: 3 }), []);
      assert.deepEqual(one({ quote: "third line with other word", line: 3 }), ["unsupported"]);
    });
    it("applies to not_applicable answers as well", () => {
      assert.deepEqual(one({ status: "not_applicable", score: null, quote: "made up" }), ["unsupported"]);
    });
    it("keeps the detail short", () => {
      const v = validateAnswer({ results: [mk("BODY-01", { quote: "y".repeat(150) }), mk("DESC-03"), mk("META-04")] }, ids, files);
      assert.ok((v.failing[0]?.detail.length ?? 999) < 200);
    });
  });
});
