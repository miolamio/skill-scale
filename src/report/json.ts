import type { Catalogue, ProfileId } from "../catalog/types.ts";
import type { CriterionRecord, Summary } from "../score/score.ts";

export const JSON_SCHEMA_VERSION = 1;

export interface JsonReport {
  schema_version: number;
  tool: { name: string; version: string };
  catalogue: { revision: number };
  profile: ProfileId;
  /** The judge's model when `--judge` ran, else null. */
  model: string | null;
  layers: { mechanical: true; judgement: boolean; live: false };
  skill: { path: string; name: string | null; frontmatter_status: string; skipped_files: { path: string; bytes: number }[] };
  exit_code: number;
  summary: Summary;
  /** Same as `summary.judge`; present only when `--judge` ran. */
  judge?: NonNullable<Summary["judge"]>;
  sources: Record<string, string[]>;
  records: CriterionRecord[];
}

export function buildJson(args: {
  version: string;
  cat: Catalogue;
  profile: ProfileId;
  skillPath: string;
  skillName: string | null;
  frontmatterStatus: string;
  skippedFiles: { path: string; bytes: number }[];
  records: CriterionRecord[];
  summary: Summary;
  exitCode: number;
  /** True when the judge produced at least one usable answer. */
  judged?: boolean;
}): JsonReport {
  return {
    schema_version: JSON_SCHEMA_VERSION,
    tool: { name: "skill-scale", version: args.version },
    catalogue: { revision: args.cat.meta.revision },
    profile: args.profile,
    model: args.summary.judge?.model ?? null,
    layers: { mechanical: true, judgement: args.judged === true, live: false },
    skill: { path: args.skillPath, name: args.skillName, frontmatter_status: args.frontmatterStatus, skipped_files: args.skippedFiles },
    exit_code: args.exitCode,
    summary: args.summary,
    ...(args.summary.judge ? { judge: args.summary.judge } : {}),
    sources: Object.fromEntries(args.cat.sources.map((s) => [s.id, s.urls])),
    records: args.records,
  };
}
