import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("runtime", () => {
  it("runs on Node 24 or later", () => {
    assert.ok(Number(process.versions.node.split(".")[0]) >= 24);
  });
});
