import type { BadFixture } from "../skills.ts";
import { bad, GOOD_FILES, lines, variant } from "../skills.ts";

export default [
  bad("BODY-02", "claude-code", "SKILL.md with 500 lines", variant({ "SKILL.md": `${GOOD_FILES["SKILL.md"]}${lines(500 - (GOOD_FILES["SKILL.md"] as string).split("\n").length + 1, "Filler line")}\n` })),
] satisfies BadFixture[];
