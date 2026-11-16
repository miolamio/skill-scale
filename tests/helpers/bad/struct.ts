import type { BadFixture } from "../skills.ts";
import { bad, GOOD_FILES, lines, variant } from "../skills.ts";

export default [
  bad("STRUCT-02", "claude-code", "reference file links to another reference file", variant({ "reference/data-guide.md": `${GOOD_FILES["reference/data-guide.md"]}\nSee [regions](regions.md).\n`, "reference/regions.md": "# Regions\n\nNorth, south.\n" })),
  bad("STRUCT-03", "claude-code", "101-line reference file without contents", variant({ "reference/data-guide.md": `# Data guide\n\n${lines(99, "Column note")}\n` })),
  bad("STRUCT-06", "claude-code", "backslash path in inline code", variant({ "SKILL.md": `${GOOD_FILES["SKILL.md"]}\nRun \`assets\\report-template.md\` first.\n` })),
  bad("STRUCT-07", "claude-code", "README.md in the folder", variant({ "README.md": "# Good skill\n" })),
  bad("STRUCT-10", "claude-code", "link to a missing file", variant({ "SKILL.md": `${GOOD_FILES["SKILL.md"]}\nAlso read [the notes](reference/notes.md).\n` })),
] satisfies BadFixture[];
