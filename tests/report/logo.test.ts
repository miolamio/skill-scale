import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LOGO, LOGO_LINES } from "../../src/report/logo.ts";

describe("logo", () => {
  it("is pure ASCII, at most 5 lines and 60 columns, with no trailing spaces", () => {
    assert.ok(LOGO_LINES.length >= 1 && LOGO_LINES.length <= 5);
    assert.equal(LOGO, LOGO_LINES.join("\n"));
    for (const l of LOGO_LINES) {
      assert.match(l, /^[\x20-\x7e]*$/);
      assert.ok(l.length <= 60);
      assert.equal(l, l.trimEnd());
    }
  });
});
