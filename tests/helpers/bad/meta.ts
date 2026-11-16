import type { BadFixture } from "../skills.ts";
import { bad, GOOD_DIR, FM_DESC, FM_NAME, GOOD_FILES, skillMd, variant } from "../skills.ts";

export default [
  bad("META-01", "portable", "uppercase name", variant({ "SKILL.md": skillMd(`name: Good_Skill\n${FM_DESC}`) }), "Good_Skill"),
  bad("META-01", "claude-code", "name longer than 256 characters", variant({ "SKILL.md": skillMd(`name: ${"a".repeat(257)}\n${FM_DESC}`) }), GOOD_DIR, { effect: { effect: "fields_ignored", lb: ["LB-04"] } }),
  bad("META-02", "portable", "name differs from folder", variant({ "SKILL.md": skillMd(`name: other-skill\n${FM_DESC}`) })),
  bad("META-03", "claude-code", "reserved folder name synced", GOOD_FILES, "synced", { effect: { effect: "not_loaded", lb: ["LB-06"] } }),
  bad("META-03", "claude-code", "reserved folder name anthropic-skills", GOOD_FILES, "anthropic-skills", { effect: { effect: "not_loaded", lb: ["LB-05"] } }),
  bad("META-03", "claude-code", "refused character in the folder name", GOOD_FILES, "good\u200bskill", { effect: { effect: "not_loaded", lb: ["LB-01", "LB-02"] } }),
  bad("META-03", "claude-code", "hidden character in name", variant({ "SKILL.md": skillMd(`name: "good\u200b-skill"\n${FM_DESC}`) }), GOOD_DIR, { effect: { effect: "fields_ignored", lb: ["LB-03"] } }),
  bad("META-03", "portable", "reserved word in name", variant({ "SKILL.md": skillMd(`name: claude-helper\n${FM_DESC}`) }), "claude-helper"),
  bad("META-05", "claude-code", "YAML does not parse", variant({ "SKILL.md": skillMd(`${FM_NAME}\ndescription: [unclosed`) }), GOOD_DIR, { effect: { effect: "fields_ignored", lb: ["LB-09"] } }),
  bad("META-05", "claude-code", "opening --- is not line 1", variant({ "SKILL.md": `\n${skillMd(`${FM_NAME}\n${FM_DESC}`)}` }), GOOD_DIR, { effect: { effect: "fields_ignored", lb: ["LB-09"] } }),
  bad("META-05", "claude-code", "frontmatter never closed (no stated effect)", variant({ "SKILL.md": `---\n${FM_NAME}\n${FM_DESC}\n\n# Good skill\n` })),
  bad("META-05", "claude-code", "duplicate key (no stated effect)", variant({ "SKILL.md": skillMd(`${FM_NAME}\n${FM_DESC}\n${FM_NAME}`) })),
  bad("META-05", "portable", "field outside the spec", variant({ "SKILL.md": skillMd(`${FM_NAME}\n${FM_DESC}\nmystery-key: 1`) })),
  bad("META-06", "claude-code", "metadata key reuses a field name", variant({ "SKILL.md": skillMd(`${FM_NAME}\n${FM_DESC}\nmetadata:\n  paths: "src/**"`) })),
  bad("META-07", "claude-code", "single file outside a folder", { "good-skill.md": skillMd(`${FM_NAME}\n${FM_DESC}`, "# Good skill\n\nSummarise a CSV.\n") }, GOOD_DIR, { effect: { effect: "not_loaded", lb: ["LB-08"] }, entry: "good-skill.md" }),
  bad("META-07", "claude-code", "file named skill.md", variant({ "skill.md": GOOD_FILES["SKILL.md"] as string }, ["SKILL.md"])),
] satisfies BadFixture[];
