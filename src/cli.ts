import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadCatalogue, CatalogueError } from "./catalog/load.ts";
import type { Fetcher } from "./catalog/fetcher.ts";
import { verifyCatalogue } from "./catalog/verify.ts";
import type { VerifyReport } from "./catalog/verify.ts";
import { AREAS, PROFILES } from "./catalog/types.ts";
import type { ProfileId } from "./catalog/types.ts";
import { CHECKS_BY_PRACTICE } from "./checks/index.ts";
import { ContractError } from "./checks/types.ts";
import { loadSkill, SkillLoadError } from "./loader/skill.ts";
import { renderConsole } from "./report/console.ts";
import { buildJson } from "./report/json.ts";
import { renderHtml } from "./report/html.ts";
import type { AdvisorState } from "./report/html.ts";
import { adviseSkill, lowScoreRecords } from "./advisor/advisor.ts";
import { STRINGS_EN, t } from "./report/strings.ts";
import { buildRecords, EXIT, exitCodeFor, summarise } from "./score/score.ts";
import { applyJudge } from "./judge/apply.ts";
import { judgeSkill } from "./judge/judge.ts";
import { qualifiedFor } from "./judge/qualify.ts";
import { claudeRunner } from "./judge/runner.ts";
import type { JudgeOutcome, JudgeRunner } from "./judge/types.ts";

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
  fetcher: Fetcher;
  catalogDir: string;
  version: string;
  /** Tests pass a fake. Production leaves it out and the CLI uses the real `claude` runner. */
  judgeRunner?: JudgeRunner;
  /** Where `--format html` writes its default file. Production leaves it out: the current directory. */
  cwd?: string;
}

const DEFAULT_MODEL = "claude-sonnet-5-5";

const USAGE = `Usage:
  skill-scale <skill-folder> [--profile claude-code|portable] [--format console|json|html] [--out report.json|report.html]
                      [--plugin auto|yes|no]   (naming rules differ inside a plugin; auto looks for .claude-plugin/plugin.json in the folder or a parent)
                      [--judge [--repeat 1-5] [--model ID]]   (opt-in: a model scores the judgement practices through the claude CLI; default model ${DEFAULT_MODEL}; with --format html one more call proposes changes)
  skill-scale catalog verify [--source ID] [--json]
  skill-scale --version | --help

Exit codes: 0 no blockers and something scored; 1 at least one blocker (including a security finding); 2 failure, bad input, nothing scored, or --judge got no usable answer.
`;

function fail(io: CliIo, message: string): number {
  io.stderr(`${t(STRINGS_EN, "failure", { message })}\n`);
  return EXIT.FAILURE;
}

function renderVerify(report: VerifyReport): string {
  const lines: string[] = [];
  for (const s of report.sources) lines.push(`${s.status.toUpperCase().padEnd(8)}${s.id}${s.errors.length ? `  (${s.errors.join("; ")})` : ""}`);
  for (const q of report.quotes.filter((x) => x.status === "changed" || x.status === "unverified"))
    lines.push(`${q.status.toUpperCase()} ${q.practice} [${q.source}, ${q.section}]: "${q.text.slice(0, 100)}"`);
  const c = report.counts;
  lines.push(`quotes: ${c.ok} ok, ${c.changed} changed, ${c.unverified} unverified, ${c.skipped} skipped. Exit ${report.exitCode}.`);
  return `${lines.join("\n")}\n`;
}

async function catalogVerify(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({ args, options: { source: { type: "string" }, json: { type: "boolean" } }, strict: true });
  const cat = loadCatalogue(io.catalogDir);
  if (values.source && !cat.sources.some((s) => s.id === values.source)) return fail(io, `unknown source ${values.source}`);
  const report = await verifyCatalogue(cat, io.fetcher, values.source ? { only: values.source } : {});
  io.stdout(values.json ? `${JSON.stringify(report, null, 2)}\n` : renderVerify(report));
  return report.exitCode;
}

async function scan(argv: string[], io: CliIo): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      profile: { type: "string" },
      format: { type: "string" },
      plugin: { type: "string" },
      out: { type: "string" },
      judge: { type: "boolean" },
      repeat: { type: "string" },
      model: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean" },
    },
    allowPositionals: true,
    strict: true,
  });
  if (values.help) return io.stdout(USAGE), EXIT.OK;
  if (values.version) return io.stdout(`${io.version}\n`), EXIT.OK;
  if (positionals.length === 0) return io.stderr(USAGE), EXIT.FAILURE;
  if (positionals.length > 1) return fail(io, `expected one skill folder, got ${positionals.length}`);
  const path = positionals[0] as string;
  const profile = (values.profile ?? "claude-code") as ProfileId;
  if (!PROFILES.includes(profile)) return fail(io, `unknown profile "${values.profile}" (use ${PROFILES.join(" or ")})`);
  const format = values.format ?? "console";
  if (format !== "console" && format !== "json" && format !== "html") return fail(io, `unknown format "${format}" (use console, json or html)`);

  const plugin = values.plugin ?? "auto";
  if (plugin !== "auto" && plugin !== "yes" && plugin !== "no") return fail(io, `unknown --plugin "${plugin}" (use auto, yes or no)`);
  const judgeOn = values.judge === true;
  if (values.model !== undefined && /haiku/i.test(values.model)) return fail(io, `model "${values.model}" is refused: haiku models are unusable as a judge (less exact quotes and a larger spread in the M2 spike)`);
  if (!judgeOn && values.repeat !== undefined) return fail(io, "--repeat needs --judge");
  if (!judgeOn && values.model !== undefined) return fail(io, "--model needs --judge");
  if (values.repeat !== undefined && !/^[1-5]$/.test(values.repeat)) return fail(io, `bad --repeat "${values.repeat}" (use a whole number from 1 to 5)`);
  const repeats = values.repeat === undefined ? 1 : Number(values.repeat);
  const model = values.model ?? DEFAULT_MODEL;

  const cat = loadCatalogue(io.catalogDir);
  const skill = loadSkill(path, { plugin });
  let records = buildRecords(cat, skill, profile, CHECKS_BY_PRACTICE, { judge: judgeOn });
  let outcome: JudgeOutcome | undefined;
  if (judgeOn) {
    const practices = qualifiedFor(cat, records, profile);
    if (practices.length === 0) io.stderr("Nothing to judge for this profile.\n");
    else {
      io.stderr(`Judging ${practices.length} practices ... \n`);
      outcome = await judgeSkill({ skill, practices, runner: io.judgeRunner ?? claudeRunner(), model, repeats });
      records = applyJudge(records, outcome);
    }
  }
  const summary = summarise(records, AREAS);
  const skillName = typeof skill.frontmatter.data.name === "string" && skill.frontmatter.data.name.trim() !== "" ? skill.frontmatter.data.name.trim() : skill.dirName;
  if (outcome) {
    summary.judge = {
      model: outcome.model,
      repeats: outcome.repeats,
      calls: outcome.calls,
      cost_usd: Math.round(outcome.costUsd * 10000) / 10000,
      duration_ms: outcome.durationMs,
      stability_measured: outcome.practices.some((p) => p.stability_measured),
      unstable: outcome.practices.filter((p) => p.unstable).map((p) => p.id),
      injection: outcome.injection,
    };
  }
  // The advisor never changes the exit code: it only adds its cost and time to the judge summary.
  let advisor: AdvisorState | undefined;
  if (format === "html" && outcome && !outcome.allInfra && summary.judge) {
    const blockerIds = new Set([...summary.blockers.map((b) => b.id), ...summary.security_blockers.map((b) => b.id)]);
    if (lowScoreRecords(records, blockerIds).length > 0) {
      io.stderr("Proposing changes ... \n");
      const res = await adviseSkill({ skill, records, blockerIds, runner: io.judgeRunner ?? claudeRunner(), model });
      summary.judge.cost_usd = Math.round((summary.judge.cost_usd + res.costUsd) * 10000) / 10000;
      summary.judge.duration_ms += res.durationMs;
      advisor = res.ok ? { state: "ok", advice: res.advice } : { state: "failed", reason: res.reason };
    }
  }
  const exitCode = outcome?.allInfra ? EXIT.FAILURE : exitCodeFor(summary);
  const json = buildJson({
    version: io.version,
    cat,
    profile,
    skillPath: skill.root,
    skillName: typeof skill.frontmatter.data.name === "string" ? skill.frontmatter.data.name : null,
    frontmatterStatus: skill.frontmatter.status,
    skippedFiles: skill.skippedFiles,
    records,
    summary,
    exitCode,
    judged: outcome !== undefined && !outcome.allInfra,
  });
  // The report file is written before the exit code is decided, so a failing run still leaves its report.
  if (format === "html") {
    const html = renderHtml({
      version: io.version,
      revision: cat.meta.revision,
      profile,
      skillPath: skill.root,
      skillName,
      skill,
      records,
      summary,
      sources: Object.fromEntries(cat.sources.flatMap((s) => (s.urls[0] ? [[s.id, { title: s.title, url: s.urls[0] }]] : []))),
      ...(advisor ? { advisor } : {}),
    });
    if (values.out) writeFileSync(values.out, html);
    else {
      const file = `${skillName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+/, "").slice(0, 80) || "skill"}.skill-scale.html`;
      writeFileSync(resolve(io.cwd ?? process.cwd(), file), html);
      io.stdout(`./${file}\n`);
    }
  } else if (values.out) writeFileSync(values.out, `${JSON.stringify(json, null, 2)}\n`);
  if (format === "json") io.stdout(`${JSON.stringify(json, null, 2)}\n`);
  else if (format === "console") io.stdout(renderConsole({ version: io.version, revision: cat.meta.revision, profile, skillPath: skill.root, skippedFiles: skill.skippedFiles }, records, summary, STRINGS_EN));
  if (outcome?.allInfra) io.stderr(`Error: the judge produced no usable answer (${firstInfraReason(outcome)})\n`);
  return exitCode;
}

function firstInfraReason(o: JudgeOutcome): string {
  return o.practices.find((p) => p.reason)?.reason ?? "no reason given";
}

export async function main(argv: string[], io: CliIo): Promise<number> {
  try {
    if (argv[0] === "catalog") {
      if (argv[1] !== "verify") return fail(io, "the only catalog command is: catalog verify");
      return await catalogVerify(argv.slice(2), io);
    }
    return await scan(argv, io);
  } catch (e) {
    if (e instanceof CatalogueError || e instanceof SkillLoadError || e instanceof ContractError) return fail(io, e.message);
    if ((e as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) return fail(io, (e as Error).message);
    return fail(io, `internal error: ${(e as Error).stack ?? String(e)}`);
  }
}
