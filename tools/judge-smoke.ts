// Usage: node tools/judge-smoke.ts <skillA> <skillB> [--model M] [--repeat N]
// Runs the real claude runner against real skills and prints a table. Costs money (about $0.15 per skill).
// Manual only: never run in CI, never imported by tests.
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { httpFetcher } from "../src/catalog/fetcher.ts";
import { main } from "../src/cli.ts";

const args = process.argv.slice(2);
const paths: string[] = [];
const passthrough: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i] as string;
  if (a === "--model" || a === "--repeat") passthrough.push(a, args[++i] ?? "");
  else paths.push(a);
}
if (paths.length === 0) {
  console.error("Usage: node tools/judge-smoke.ts <skillA> <skillB> [--model M] [--repeat N]");
  process.exit(2);
}

const catalogDir = fileURLToPath(new URL("../catalog/", import.meta.url));
let failure: string | null = null;

for (const path of paths) {
  let stdout = "";
  const code = await main([path, "--judge", "--format", "json", ...passthrough], {
    stdout: (s) => void (stdout += s),
    stderr: (s) => void process.stderr.write(s),
    fetcher: httpFetcher,
    catalogDir,
    version: "smoke",
  });
  let report: any;
  try {
    report = JSON.parse(stdout);
  } catch {
    console.log(`${path}: exit ${code}, no JSON report`);
    failure ??= `${path}: no JSON report`;
    continue;
  }
  const judged = (report.records as any[]).filter((r) => r.judge);
  const count = (f: (r: any) => boolean): number => judged.filter(f).length;
  const scored = count((r) => r.status === "scored");
  const na = count((r) => r.status === "not_applicable");
  const notRun = count((r) => r.status === "not_run");
  const infraN = count((r) => r.judge.not_run_code === "infra");
  const unsupported = count((r) => r.judge.not_run_code === "unsupported");
  const files = new Set((report.skill && existsSync(report.skill.path) ? readdirSync(report.skill.path, { recursive: true }) : []).map(String));
  const quotesOk = count((r) => r.judge.quote && r.judge.file && files.has(r.judge.file));
  const usable = scored + na;
  console.log(
    `${path}: exit ${code}; judged ${judged.length}; scored ${scored}, not_applicable ${na}, not_run ${notRun} (infra ${infraN}, unsupported ${unsupported}); ` +
      `injection notes ${report.judge?.injection?.length ?? 0}; cost $${report.judge?.cost_usd ?? 0}; ${report.judge?.duration_ms ?? 0} ms; quotes with an existing file ${quotesOk}/${scored + na}`,
  );
  if (code !== 0 && code !== 1) failure ??= `${path}: exit ${code}`;
  else if (judged.length === 0 || usable / judged.length < 0.8) failure ??= `${path}: fewer than 80% of the qualified practices produced a result`;
}

const leftovers = readdirSync(tmpdir()).filter((n) => n.startsWith("skill-scale-judge-")).length;
console.log(`temp directories left under ${tmpdir()}: ${leftovers} (expected 0)`);
if (leftovers > 0) failure ??= `${leftovers} judge temp directories left behind`;
if (failure) {
  console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log("OK");
