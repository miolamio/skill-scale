import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ProfileId } from "../../src/catalog/types.ts";
import type { Effect } from "../../src/catalog/types.ts";

export type FileMap = Record<string, string>;

export const lines = (n: number, prefix: string): string => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}.`).join("\n");

export const GOOD_DIR = "good-skill";

export const GOOD_FILES: FileMap = {
  "SKILL.md": `---
name: good-skill
description: Summarises quarterly sales CSV files into a short report. Use when the user asks for a sales summary, a quarterly report or totals by region from a CSV file.
metadata:
  sales-report-owner: reporting-team
---

# Good skill

Summarise a sales CSV in three steps.

1. Read the columns described in [the data guide](reference/data-guide.md).
2. Total the amounts for each region.
3. Write the report with [the template](assets/report-template.md).

## Gotchas

- Amounts in the export are in cents, not dollars.
`,
  "reference/data-guide.md": `# Data guide

## Contents

- Columns
- Regions

## Columns

${lines(110, "Column note")}
`,
  "assets/report-template.md": "# Sales report\n\nTotal: <fill in>\n",
  "evals/evals.json": JSON.stringify({
    skill_name: "good-skill",
    evals: [
      { id: 1, prompt: "Summarise sales.csv for Q3.", expected_output: "A report with totals by region." },
      { id: 2, prompt: "Which region sold most last quarter?", expected_output: "The name of one region." },
      { id: 3, prompt: "Translate this poem into French.", expected_output: "The skill does not trigger." },
    ],
  }),
};

export function variant(overrides: FileMap, remove: string[] = []): FileMap {
  const files: FileMap = { ...GOOD_FILES, ...overrides };
  for (const r of remove) delete files[r];
  return files;
}

export function skillMd(frontmatter: string, body = "# Good skill\n\nSee [the data guide](reference/data-guide.md).\n"): string {
  return `---\n${frontmatter}\n---\n\n${body}`;
}

export const FM_NAME = "name: good-skill";
export const FM_DESC = "description: Summarises quarterly sales CSV files. Use when the user asks for a sales summary from a CSV file.";

export interface BadFixture {
  /** The one practice this fixture breaks. */
  practice: string;
  profile: ProfileId;
  label: string;
  dirName: string;
  files: FileMap;
  /** Set when the fixture is a defect that research section 2.12 gives an effect. Fixtures without it must produce no effect. */
  effect?: { effect: Effect; lb: string[] };
  /** Path inside the written folder to give the CLI instead of the folder, for a single-file skill. */
  entry?: string;
}

export const bad = (practice: string, profile: ProfileId, label: string, files: FileMap, dirName = GOOD_DIR, extra: Pick<BadFixture, "effect" | "entry"> = {}): BadFixture => ({ practice, profile, label, dirName, files, ...extra });

export function writeSkill(base: string, dirName: string, files: FileMap): string {
  const root = join(base, dirName);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

export function tempDir(): { path: string; cleanup(): void } {
  const path = mkdtempSync(join(tmpdir(), "skill-scale-test-"));
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}
