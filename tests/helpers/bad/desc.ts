import type { BadFixture } from "../skills.ts";
import { bad, FM_NAME, skillMd, variant } from "../skills.ts";

export default [
  bad("DESC-01", "claude-code", "no description", variant({ "SKILL.md": skillMd(FM_NAME) })),
  bad("DESC-02", "claude-code", "description over 1,536 characters", variant({ "SKILL.md": skillMd(`${FM_NAME}\ndescription: Summarises sales files. Use when asked. ${"word ".repeat(310)}`) })),
  bad("DESC-02", "portable", "description over 1,024 characters", variant({ "SKILL.md": skillMd(`${FM_NAME}\ndescription: Summarises sales files. Use when asked. ${"word ".repeat(205)}`) })),
  bad("DESC-10", "portable", "XML tag in description", variant({ "SKILL.md": skillMd(`${FM_NAME}\ndescription: Summarises sales files. Use <b>when</b> asked.`) })),
] satisfies BadFixture[];
