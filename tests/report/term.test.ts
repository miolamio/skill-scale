import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ellipsizePath, bold, cyan, detectPretty, dim, green, red, stripAnsi, termWidth, visibleWidth, wrap, yellow } from "../../src/report/term.ts";

describe("styles", () => {
  it("wrap in ANSI when colour is on and return the text untouched when off", () => {
    for (const f of [bold, dim, red, green, yellow, cyan]) {
      assert.equal(f("x", false), "x");
      assert.match(f("x", true), /^\x1b\[\d+mx\x1b\[\d+m$/);
    }
    assert.equal(red("x", true), "\x1b[31mx\x1b[39m");
    assert.equal(bold("x", true), "\x1b[1mx\x1b[22m");
  });
  it("stripAnsi and visibleWidth ignore escapes and count code points", () => {
    assert.equal(stripAnsi(red(bold("ab", true), true)), "ab");
    assert.equal(visibleWidth(green("█░✗", true)), 3);
    assert.equal(visibleWidth("◢◤ x"), 4);
  });
});

describe("detectPretty", () => {
  const tty = { isTTY: true };
  const pipe = { isTTY: false };
  const cases: [string, Record<string, string>, { isTTY?: boolean }, boolean][] = [
    ["tty", {}, tty, true],
    ["pipe", {}, pipe, false],
    ["unknown tty state", {}, {}, false],
    ["NO_COLOR on a tty", { NO_COLOR: "1" }, tty, false],
    ["empty NO_COLOR on a tty", { NO_COLOR: "" }, tty, true],
    ["TERM=dumb on a tty", { TERM: "dumb" }, tty, false],
    ["FORCE_COLOR=1 on a pipe", { FORCE_COLOR: "1" }, pipe, true],
    ["FORCE_COLOR=0 on a pipe", { FORCE_COLOR: "0" }, pipe, false],
    ["FORCE_COLOR=0 on a tty falls back to the tty rule", { FORCE_COLOR: "0" }, tty, true],
    ["empty FORCE_COLOR on a pipe", { FORCE_COLOR: "" }, pipe, false],
    ["FORCE_COLOR beats NO_COLOR", { FORCE_COLOR: "1", NO_COLOR: "1" }, tty, true],
    ["FORCE_COLOR beats TERM=dumb", { FORCE_COLOR: "true", TERM: "dumb" }, pipe, true],
  ];
  for (const [label, env, stream, want] of cases) it(label, () => assert.equal(detectPretty(env, stream), want));
});

describe("termWidth", () => {
  it("clamps to 60..100 and defaults to 80", () => {
    assert.equal(termWidth({}), 80);
    assert.equal(termWidth({ columns: 0 }), 80);
    assert.equal(termWidth({ columns: 40 }), 60);
    assert.equal(termWidth({ columns: 72 }), 72);
    assert.equal(termWidth({ columns: 200 }), 100);
  });
});

describe("wrap", () => {
  it("breaks at word boundaries within the width", () => {
    const lines = wrap("one two three four five six seven", 12, 0);
    assert.deepEqual(lines, ["one two", "three four", "five six", "seven"]);
  });
  it("indents every line by the hanging indent, first line included, within the width", () => {
    const lines = wrap("alpha beta gamma delta epsilon", 14, 4);
    assert.deepEqual(lines, ["    alpha beta", "    gamma", "    delta", "    epsilon"]);
    for (const l of lines) assert.ok(visibleWidth(l) <= 14);
  });
  it("uses a first-line prefix, and indents later lines under the text start", () => {
    const lines = wrap("alpha beta gamma delta", 14, 4, "  x ");
    assert.deepEqual(lines, ["  x alpha beta", "    gamma", "    delta"]);
  });
  it("hard-breaks words longer than the available width", () => {
    const lines = wrap("abcdefghijklmnop", 8, 2);
    assert.deepEqual(lines, ["  abcdef", "  ghijkl", "  mnop"]);
  });
  it("keeps explicit text on one line when it fits and returns one empty-indent line for empty text", () => {
    assert.deepEqual(wrap("short", 20, 0), ["short"]);
    assert.deepEqual(wrap("", 20, 2), ["  "]);
  });
});

describe("ellipsizePath", () => {
  it("keeps a path that fits", () => assert.equal(ellipsizePath("~/a/b", 10), "~/a/b"));
  it("replaces the front with an ellipsis at a / boundary, keeping the tail", () => {
    assert.equal(ellipsizePath("/very/long/path/to/pretty/in/pr", 16), "…/pretty/in/pr");
    assert.equal(ellipsizePath("/very/long/path/to/pretty/in/pr", 9), "…/in/pr");
  });
  it("ellipsizes the last segment when even it does not fit", () => {
    const r = ellipsizePath("/a/b/abcdefghijkl", 6);
    assert.equal(r, "…hijkl");
    assert.equal(visibleWidth(r), 6);
  });
});
