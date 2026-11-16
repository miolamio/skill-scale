import assert from "node:assert/strict";
import { loadCatalogue } from "../../src/catalog/load.ts";
import { paramsFor } from "../../src/catalog/params.ts";
import type { ProfileId } from "../../src/catalog/types.ts";
import { CHECKS } from "../../src/checks/index.ts";
import type { Finding } from "../../src/checks/types.ts";
import { join } from "node:path";
import { loadSkill } from "../../src/loader/skill.ts";
import type { PluginMode } from "../../src/loader/skill.ts";
import { tempDir, writeSkill } from "./skills.ts";
import type { FileMap } from "./skills.ts";

export const cat = loadCatalogue(new URL("../../catalog/", import.meta.url).pathname);
export const tmp = tempDir();
let n = 0;

/** Runs every registered check that applies to the profile on a skill built from `files`. */
export function runAll(dirName: string, files: FileMap, profile: ProfileId, opts: { entry?: string; plugin?: PluginMode } = {}) {
  const root = writeSkill(tmp.path, `${n++}/${dirName}`, files);
  const skill = loadSkill(opts.entry ? join(root, opts.entry) : root, opts.plugin ? { plugin: opts.plugin } : {});
  const findings: Record<string, Finding[]> = {};
  const kinds: Record<string, string> = {};
  for (const check of CHECKS) {
    const practice = cat.practices.find((p) => p.id === check.practice);
    assert.ok(practice, `${check.practice} is in the catalogue`);
    if (!practice.profiles.includes(profile)) continue;
    const out = check.run({ skill, profile, params: paramsFor(practice, profile) });
    kinds[check.practice] = out.kind;
    if (out.kind === "ran" && out.findings.length > 0) findings[check.practice] = out.findings;
  }
  return { findings, kinds };
}
