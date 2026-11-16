import type { BadFixture } from "../skills.ts";
import { bad, variant } from "../skills.ts";

export default [
  bad("TEST-02", "claude-code", "two eval cases", variant({ "evals/evals.json": JSON.stringify({ evals: [{ id: 1, prompt: "a" }, { id: 2, prompt: "b" }] }) })),
] satisfies BadFixture[];
