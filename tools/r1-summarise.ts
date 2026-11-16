// Summarises one `claude -p --output-format stream-json` run for the R1 experiment.
// Usage: node tools/r1-summarise.ts <run.jsonl> <personal-skill-names.txt> <label>
import { readFileSync } from "node:fs";

const [file, personalFile, label] = process.argv.slice(2);
const personal = new Set(readFileSync(personalFile as string, "utf8").split("\n").filter(Boolean));
const events = readFileSync(file as string, "utf8")
  .split("\n")
  .filter((l) => l.trim().startsWith("{"))
  .flatMap((l) => {
    try {
      return [JSON.parse(l) as Record<string, any>];
    } catch {
      return [];
    }
  });

const bare = (s: string): string => s.replace(/^.*:/, "");
const init = events.find((e) => e.type === "system" && e.subtype === "init");
const initSkills: string[] | null = Array.isArray(init?.skills) ? init.skills.map(String) : null;
const blocks = events.filter((e) => e.type === "assistant").flatMap((e) => (e.message?.content ?? []) as Record<string, any>[]);
const text = blocks.filter((b) => b.type === "text").map((b) => String(b.text)).join("\n");
const skillCalls = blocks.filter((b) => b.type === "tool_use" && b.name === "Skill");
const result = events.find((e) => e.type === "result");
const words = new Set(text.split(/[^A-Za-z0-9_.:-]+/).filter(Boolean));

const lines: [string, unknown][] = [
  ["label", label],
  ["events", events.length],
  ["init_event_keys", init ? Object.keys(init).join(",") : "none"],
  ["init_has_skills_field", initSkills !== null],
  ["init_personal_visible", initSkills ? initSkills.filter((s) => personal.has(bare(s))).length : "n/a"],
  ["init_probe_visible", initSkills ? initSkills.some((s) => bare(s) === "r1-probe-skill") : "n/a"],
  ["init_other_visible", initSkills ? initSkills.filter((s) => !personal.has(bare(s)) && bare(s) !== "r1-probe-skill").length : "n/a"],
  ["answer_personal_mentioned (weak: common words)", [...personal].filter((n) => words.has(n)).length],
  ["answer_probe_mentioned", words.has("r1-probe-skill")],
  ["skill_tool_use_count", skillCalls.length],
  ["is_error", result?.is_error ?? "no result event"],
  ["result_head", String(result?.result ?? "").replace(/\s+/g, " ").slice(0, 160)],
];
console.log("--- R1 summary ---");
for (const [k, v] of lines) console.log(`${k}=${v}`);
if (skillCalls[0]) console.log(`first_skill_tool_use=${JSON.stringify(skillCalls[0])}`);
