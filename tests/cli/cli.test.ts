import assert from "node:assert/strict";
import { cpSync, existsSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { parse, stringify } from "yaml";
import type { Fetcher } from "../../src/catalog/fetcher.ts";
import { main } from "../../src/cli.ts";
import type { CliIo } from "../../src/cli.ts";
import { CHECKS_BY_PRACTICE } from "../../src/checks/index.ts";
import type { Check } from "../../src/checks/types.ts";
import { BAD_FIXTURES } from "../helpers/bad-fixtures.ts";
import { GOOD_DIR, GOOD_FILES, tempDir, writeSkill } from "../helpers/skills.ts";
import type { FileMap } from "../helpers/skills.ts";

const SHIPPED = new URL("../../catalog/", import.meta.url).pathname;
const tmp = tempDir();
after(() => tmp.cleanup());
let n = 0;

function setup(opts: { catalogDir?: string; fetcher?: Fetcher } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    stdout: (s) => void out.push(s),
    stderr: (s) => void err.push(s),
    fetcher: opts.fetcher ?? (async () => { throw new Error("the network must not be used in tests"); }),
    catalogDir: opts.catalogDir ?? SHIPPED,
    version: "9.9.9",
  };
  return { io, stdout: () => out.join(""), stderr: () => err.join("") };
}
const skill = (dir: string, files: FileMap): string => writeSkill(join(tmp.path, `cli${n++}`), dir, files);
const fixture = (label: string) => BAD_FIXTURES.find((b) => b.label === label) as (typeof BAD_FIXTURES)[number];

/** A copy of the shipped catalogue that a test may change. */
function catalogueCopy(edit: (practices: Record<string, unknown>[], sources: Record<string, unknown>[]) => void): string {
  const dir = join(tmp.path, `cat${n++}`);
  cpSync(SHIPPED, dir, { recursive: true });
  const practices = parse(readFileSync(join(dir, "practices.yaml"), "utf8")) as Record<string, unknown>[];
  const sources = parse(readFileSync(join(dir, "sources.yaml"), "utf8")) as Record<string, unknown>[];
  edit(practices, sources);
  writeFileSync(join(dir, "practices.yaml"), stringify(practices));
  writeFileSync(join(dir, "sources.yaml"), stringify(sources));
  return dir;
}

describe("basic commands", () => {
  it("prints the version and help with exit 0", async () => {
    const a = setup();
    assert.equal(await main(["--version"], a.io), 0);
    assert.equal(a.stdout(), "9.9.9\n");
    const b = setup();
    assert.equal(await main(["--help"], b.io), 0);
    assert.match(b.stdout(), /Exit codes/);
  });
  it("exits 2 with usage when called with no arguments", async () => {
    const a = setup();
    assert.equal(await main([], a.io), 2);
    assert.match(a.stderr(), /Usage/);
  });
  it("exits 2 for an unknown option, profile or format, and for two folders", async () => {
    const dir = skill(GOOD_DIR, GOOD_FILES);
    for (const argv of [[dir, "--bogus"], [dir, "--profile", "bogus"], [dir, "--format", "xml"], [dir, dir]]) {
      const a = setup();
      assert.equal(await main(argv, a.io), 2, argv.join(" "));
      assert.match(a.stderr(), /Error:/);
    }
  });
  it("exits 2 when the folder is missing or holds no SKILL.md", async () => {
    const a = setup();
    assert.equal(await main([join(tmp.path, "nowhere")], a.io), 2);
    const empty = writeSkill(tmp.path, `cli${n++}`, { "notes.txt": "x" });
    assert.equal(await main([empty], setup().io), 2);
  });
});

describe("scanning a skill", () => {
  it("exits 0 when given the SKILL.md path of a good skill, in any letter case (SKM-1)", async () => {
    for (const name of ["SKILL.md", "skill.md"]) {
      const a = setup();
      const { "SKILL.md": body, ...rest } = GOOD_FILES;
      const dir = skill(GOOD_DIR, { ...rest, [name]: body as string });
      assert.equal(await main([join(dir, name), "--format", "json"], a.io), 0, name);
      assert.deepEqual(JSON.parse(a.stdout()).summary.blockers, []);
    }
  });
  it("reports a file over 1 MB as not scanned for SAFE-02 in console and JSON, and does not call SAFE-02 clean (SKM-2)", async () => {
    const dir = skill(GOOD_DIR, GOOD_FILES);
    writeFileSync(join(dir, "big.txt"), "x".repeat(2 * 1_048_576));
    const j = setup();
    assert.equal(await main([dir, "--format", "json"], j.io), 0);
    const doc = JSON.parse(j.stdout());
    assert.deepEqual(doc.skill.skipped_files, [{ path: "big.txt", bytes: 2 * 1_048_576 }]);
    const rec = doc.records.find((r: { id: string }) => r.id === "SAFE-02");
    assert.equal(rec.status, "not_run");
    assert.equal(rec.score, null);
    assert.match(rec.reason, /big\.txt/);
    const c = setup();
    assert.equal(await main([dir], c.io), 0);
    assert.match(c.stdout(), /Not scanned for secrets \(SAFE-02\), over 1 MB: big\.txt \(2\.0 MB\)/);
  });
  it("still scores SAFE-02 as 0 when a secret is found in a scanned file next to a skipped one (SKM-2)", async () => {
    const dir = skill(GOOD_DIR, { ...GOOD_FILES, "scripts/deploy.sh": `export T=${"ghp_"}${"aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bD2fH4jL6"}\n` });
    writeFileSync(join(dir, "big.txt"), "x".repeat(2 * 1_048_576));
    const a = setup();
    await main([dir, "--format", "json"], a.io);
    const rec = JSON.parse(a.stdout()).records.find((r: { id: string }) => r.id === "SAFE-02");
    assert.deepEqual([rec.status, rec.score], ["scored", 0]);
  });
  it("lists no skipped files for the good skill (SKM-2)", async () => {
    const a = setup();
    await main([skill(GOOD_DIR, GOOD_FILES), "--format", "json"], a.io);
    assert.deepEqual(JSON.parse(a.stdout()).skill.skipped_files, []);
    const c = setup();
    await main([skill(GOOD_DIR, GOOD_FILES)], c.io);
    assert.doesNotMatch(c.stdout(), /Not scanned/);
  });
  it("exits 0 for the good skill and prints the profile and the areas", async () => {
    const a = setup();
    assert.equal(await main([skill(GOOD_DIR, GOOD_FILES)], a.io), 0);
    assert.match(a.stdout(), /profile claude-code/);
    assert.match(a.stdout(), /Areas/);
    assert.match(a.stdout(), /No blockers\./);
  });
  it("exits 1 and names the blocker when a must-practice scores 0", async () => {
    const f = fixture("uppercase name");
    const a = setup();
    assert.equal(await main([skill(f.dirName, f.files), "--profile", "portable"], a.io), 1);
    assert.match(a.stdout(), /Blockers\n\s+META-01 Name length and characters/);
  });
  it("prints JSON with one record per practice", async () => {
    const a = setup();
    assert.equal(await main([skill(GOOD_DIR, GOOD_FILES), "--format", "json", "--profile", "portable"], a.io), 0);
    const doc = JSON.parse(a.stdout());
    assert.equal(doc.schema_version, 1);
    assert.equal(doc.profile, "portable");
    assert.equal(doc.catalogue.revision, 5);
    assert.equal(doc.records.length, 123);
    assert.equal(doc.exit_code, 0);
    assert.deepEqual(doc.layers, { mechanical: true, judgement: false, live: false });
  });
  it("puts the practice totals in the JSON summary, counted from the records", async () => {
    const a = setup();
    assert.equal(await main([skill(GOOD_DIR, GOOD_FILES), "--format", "json"], a.io), 0);
    const doc = JSON.parse(a.stdout());
    assert.equal(doc.schema_version, 1); // the new summary fields only add to the schema
    assert.equal(doc.summary.total, doc.records.length);
    assert.equal(doc.summary.scored, doc.records.filter((r: { status: string; experimental: boolean }) => r.status === "scored" && !r.experimental).length);
    assert.deepEqual(doc.summary.scored_by, ["mechanical"]);
    assert.deepEqual(doc.summary.layers_not_run, ["judgement", "live"]);
    assert.ok(Array.isArray(doc.summary.stale_unconfirmed));
  });
  it("prints the headline on the console too", async () => {
    const a = setup();
    assert.equal(await main([skill(GOOD_DIR, GOOD_FILES)], a.io), 0);
    assert.match(a.stdout(), /^Scored 15 of 123 practices \(mechanical only\)\. Not a full assessment: the judgement and live layers did not run\.$/m);
  });
  it("writes --out even when the run fails", async () => {
    const f = fixture("uppercase name");
    const out = join(tmp.path, `report${n++}.json`);
    const a = setup();
    assert.equal(await main([skill(f.dirName, f.files), "--profile", "portable", "--out", out], a.io), 1);
    assert.ok(existsSync(out));
    assert.equal(JSON.parse(readFileSync(out, "utf8")).exit_code, 1);
  });
  it("never passes when nothing was scored", async () => {
    const dir = catalogueCopy((practices) => {
      practices.splice(0, practices.length, ...practices.filter((p) => p.assessable_from === "process").slice(0, 2));
    });
    const a = setup({ catalogDir: dir });
    assert.equal(await main([skill(GOOD_DIR, GOOD_FILES)], a.io), 2);
    assert.match(a.stdout(), /Nothing was scored/);
  });
  it("exits 2 when the catalogue gives a check no data", async () => {
    const dir = catalogueCopy((practices) => {
      const p = practices.find((x) => x.id === "META-01") as Record<string, unknown>;
      delete p.profile_rules;
    });
    const a = setup({ catalogDir: dir });
    assert.equal(await main([skill(GOOD_DIR, GOOD_FILES)], a.io), 2);
    assert.match(a.stderr(), /META-01: the catalogue has no number "name_max_chars"/);
  });
  it("exits 2, not 0, when a check emits an effect it does not declare (SKM-31)", async () => {
    const checks = CHECKS_BY_PRACTICE as Map<string, Check>;
    const real = checks.get("META-01");
    assert.ok(real);
    checks.set("META-01", { practice: "META-01", run: () => ({ kind: "ran", findings: [{ practice: "META-01", message: "m", file: null, line: null, evidence: null, effect: "not_loaded", lb: ["LB-99"] }] }) });
    try {
      const a = setup();
      assert.equal(await main([skill(GOOD_DIR, GOOD_FILES)], a.io), 2);
      assert.match(a.stderr(), /META-01.*LB-99/);
    } finally {
      checks.set("META-01", real);
    }
  });
  it("exits 2 when the catalogue is invalid", async () => {
    const dir = catalogueCopy((practices) => { (practices[0] as Record<string, unknown>).strength = "loud"; });
    const a = setup({ catalogDir: dir });
    assert.equal(await main([skill(GOOD_DIR, GOOD_FILES)], a.io), 2);
    assert.match(a.stderr(), /strength/);
  });
});

describe("blockers from stated effects (research section 2.12)", () => {
  const withEffect = BAD_FIXTURES.filter((f) => f.effect);
  const place = (f: (typeof BAD_FIXTURES)[number]): string => {
    const dir = skill(f.dirName, f.files);
    return f.entry ? join(dir, f.entry) : dir;
  };
  for (const f of withEffect)
    it(`${f.effect?.lb.join("+")} ${f.label}: ${f.effect?.effect} is a blocker and exits 1 under claude-code`, async () => {
      const a = setup();
      assert.equal(await main([place(f), "--format", "json"], a.io), 1);
      const doc = JSON.parse(a.stdout());
      assert.deepEqual(doc.summary.blockers.filter((b: { kind: string }) => b.kind === "effect").map((b: { id: string; effect: string; lb: string[] }) => [b.id, b.effect, b.lb]), [[f.practice, f.effect?.effect, f.effect?.lb]]);
    });
  it("scores a normal loose .md file: exit 1 with a META-07 not_loaded (LB-08) blocker (SKM-30)", async () => {
    const dir = skill("loose", { "one.md": "---\nname: one\ndescription: Summarise a CSV file.\n---\n# One\n\nSummarise a CSV.\n" });
    const a = setup();
    assert.equal(await main([join(dir, "one.md"), "--format", "json"], a.io), 1);
    const blockers = JSON.parse(a.stdout()).summary.blockers.filter((b: { kind: string }) => b.kind === "effect");
    assert.deepEqual(blockers.map((b: { id: string; effect: string; lb: string[] }) => [b.id, b.effect, b.lb]), [["META-07", "not_loaded", ["LB-08"]]]);
  });
  it("exits 2 for a broken symlink given as the skill path (SKM-30)", async () => {
    const dir = skill("loose2", { "real.md": "x\n" });
    symlinkSync(join(dir, "missing.md"), join(dir, "dangling.md"));
    const a = setup();
    assert.equal(await main([join(dir, "dangling.md")], a.io), 2);
    assert.match(a.stderr(), /broken symlink/);
  });
  it("shows the effect and the LB ID in the console report", async () => {
    const f = withEffect.find((x) => x.effect?.lb[0] === "LB-09") as (typeof BAD_FIXTURES)[number];
    const a = setup();
    assert.equal(await main([place(f)], a.io), 1);
    assert.match(a.stdout(), /Blockers\n\s+META-05 [^\n]*\n\s+effect: fields_ignored \(LB-09\)/);
  });
  it("is a blocker under the portable profile too", async () => {
    const f = withEffect.find((x) => x.effect?.lb[0] === "LB-09") as (typeof BAD_FIXTURES)[number];
    assert.equal(await main([place(f), "--profile", "portable"], setup().io), 1);
  });
  it("gives unparsable YAML fields_ignored, never not_loaded", () => {
    const f = withEffect.find((x) => x.label === "YAML does not parse") as (typeof BAD_FIXTURES)[number];
    assert.equal(f.effect?.effect, "fields_ignored");
  });
  it("exits 0 for findings that have no stated effect and no must (unclosed frontmatter, README, two eval cases)", async () => {
    for (const label of ["frontmatter never closed (no stated effect)", "duplicate key (no stated effect)", "README.md in the folder", "two eval cases"]) {
      const f = fixture(label);
      assert.equal(await main([place(f)], setup().io), 0, label);
    }
  });
  it("applies the plugin exceptions: a refused folder name or a reserved name does not block inside a plugin", async () => {
    for (const dirName of ["synced", "anthropic-skills", "good\u200bskill"]) {
      const plugged = skill(dirName, { ...GOOD_FILES, ".claude-plugin/plugin.json": "{}" });
      assert.equal(await main([plugged], setup().io), 0, `${dirName} with a manifest in the folder`);
      assert.equal(await main([skill(dirName, GOOD_FILES), "--plugin", "yes"], setup().io), 0, `${dirName} with --plugin yes`);
      assert.equal(await main([plugged, "--plugin", "no"], setup().io), 1, `${dirName} with --plugin no overrides the manifest`);
    }
  });
  it("still blocks inside a plugin when the frontmatter name has a refused character", async () => {
    const f = fixture("hidden character in name");
    assert.equal(await main([skill(f.dirName, f.files), "--plugin", "yes"], setup().io), 1);
  });
  it("exits 2 for an unknown --plugin value", async () => {
    assert.equal(await main([skill(GOOD_DIR, GOOD_FILES), "--plugin", "maybe"], setup().io), 2);
  });
});

describe("catalog verify", () => {
  const oneSource = (): string => catalogueCopy((practices, sources) => {
    const keep = sources.find((s) => s.id === "BP") as Record<string, unknown>;
    keep.urls = ["https://bp.test/page"];
    sources.splice(0, sources.length, keep);
    practices.splice(0, practices.length, ...practices.filter((p) => (p.quotes as { source: string }[]).some((q) => q.source === "BP")).slice(0, 1).map((p) => ({ ...p, strength_source: "BP", profile_rules: undefined, quotes: (p.quotes as { source: string }[]).filter((q) => q.source === "BP").slice(0, 1) })));
  });
  const quoteOf = (dir: string): string => ((parse(readFileSync(join(dir, "practices.yaml"), "utf8")) as { quotes: { text: string }[] }[])[0] as { quotes: { text: string }[] }).quotes[0]!.text;

  it("exits 0 when the quote is found", async () => {
    const dir = oneSource();
    const a = setup({ catalogDir: dir, fetcher: async () => `intro ${quoteOf(dir)} outro` });
    assert.equal(await main(["catalog", "verify"], a.io), 0);
    assert.match(a.stdout(), /1 ok, 0 changed/);
  });
  it("exits 1 and names the practice when the quote changed", async () => {
    const dir = oneSource();
    const a = setup({ catalogDir: dir, fetcher: async () => "a page that says something else" });
    assert.equal(await main(["catalog", "verify"], a.io), 1);
    assert.match(a.stdout(), /CHANGED [A-Z]+-\d+ \[BP/);
  });
  it("exits 2 when the page cannot be fetched", async () => {
    const a = setup({ catalogDir: oneSource(), fetcher: async () => { throw new Error("HTTP 503"); } });
    assert.equal(await main(["catalog", "verify", "--json"], a.io), 2);
    assert.equal(JSON.parse(a.stdout()).sources[0].status, "failed");
  });
  it("exits 2 for an unknown source and for an unknown catalog command", async () => {
    assert.equal(await main(["catalog", "verify", "--source", "NOPE"], setup().io), 2);
    assert.equal(await main(["catalog", "bogus"], setup().io), 2);
  });
});

describe("security blockers (SKM-34)", () => {
  const withSkillMd = (extra: string): FileMap => ({ ...GOOD_FILES, "SKILL.md": `${GOOD_FILES["SKILL.md"]}\n${extra}\n` });
  const key = `${"sk-ant-"}api03-${"Zq7x9Lm2Kp4Rt8Vw3Yb6Nc1HaB3dE5gH7jK9mN1pQ3sT5vW7yZ9bD2fH4jL6xR8cV0M"}`;
  for (const args of [[], ["--profile", "portable"]]) {
    const profile = args[1] ?? "claude-code";
    it(`exits 1 under ${profile} for an sk-ant-api03- key in SKILL.md and lists it as a security blocker in JSON`, async () => {
      const dir = skill(GOOD_DIR, withSkillMd(`Use ANTHROPIC_API_KEY=${key} to call the API.`));
      const a = setup();
      assert.equal(await main([dir, ...args, "--format", "json"], a.io), 1);
      const doc = JSON.parse(a.stdout());
      assert.equal(doc.exit_code, 1);
      assert.equal(doc.summary.security_blockers.length, 1);
      const b = doc.summary.security_blockers[0];
      assert.deepEqual([b.id, b.risk, b.file], ["SAFE-02", "credential_exposure", "SKILL.md"]);
      assert.equal(typeof b.line, "number");
      assert.ok(!JSON.stringify(doc).includes(key), "the key must not appear in the report");
      assert.deepEqual(doc.summary.blockers.filter((x: { kind: string }) => x.kind !== "must"), []);
    });
  }
  it("lists the finding under its own heading in the console, apart from effect blockers", async () => {
    const dir = skill(GOOD_DIR, withSkillMd(`key ${key}`));
    const a = setup();
    assert.equal(await main([dir], a.io), 1);
    assert.match(a.stdout(), /Security blockers\n\s+SAFE-02 [^\n]*\[SKILL\.md:\d+\]\n\s+risk: credential_exposure/);
    assert.doesNotMatch(a.stdout(), /No blockers/);
  });
  it("does not block on the AWS ...EXAMPLE placeholder (SKM-3)", async () => {
    const dir = skill(GOOD_DIR, withSkillMd("export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE"));
    for (const args of [[], ["--profile", "portable"]]) {
      const a = setup();
      assert.equal(await main([dir, ...args, "--format", "json"], a.io), 0);
      assert.deepEqual(JSON.parse(a.stdout()).summary.security_blockers, []);
    }
  });
  it("lists an inline-suppressed finding without blocking, in JSON and console, and never prints the secret (SKM-36)", async () => {
    const dir = skill(GOOD_DIR, withSkillMd(`<!-- skill-scale: ignore SAFE-02 -->\nKey: ${key}`));
    const j = setup();
    assert.equal(await main([dir, "--format", "json"], j.io), 0);
    const doc = JSON.parse(j.stdout());
    assert.deepEqual(doc.summary.security_blockers, []);
    assert.equal(doc.summary.suppressed_security.length, 1);
    const s = doc.summary.suppressed_security[0];
    assert.deepEqual([s.id, s.risk, s.file, s.reason], ["SAFE-02", "credential_exposure", "SKILL.md", "inline marker"]);
    assert.equal(typeof s.line, "number");
    assert.equal(doc.records.find((r: { id: string }) => r.id === "SAFE-02").score, 3);
    assert.ok(!JSON.stringify(doc).includes(key));
    const c = setup();
    assert.equal(await main([dir], c.io), 0);
    assert.match(c.stdout(), /Suppressed security findings\n\s+SAFE-02[^\n]*\[SKILL\.md:\d+\][^\n]*inline marker/);
    assert.doesNotMatch(c.stdout(), /Security blockers/);
    assert.ok(!c.stdout().includes(key));
  });
  it("has an empty suppressed_security list when nothing is suppressed (SKM-36)", async () => {
    const a = setup();
    assert.equal(await main([skill(GOOD_DIR, GOOD_FILES), "--format", "json"], a.io), 0);
    assert.deepEqual(JSON.parse(a.stdout()).summary.suppressed_security, []);
  });
  it("gives not_run, not a blocker, for a skipped file over 1 MB with no other secret (SKM-2)", async () => {
    const dir = skill(GOOD_DIR, GOOD_FILES);
    writeFileSync(join(dir, "big.txt"), "x".repeat(2 * 1_048_576));
    const a = setup();
    assert.equal(await main([dir, "--format", "json"], a.io), 0);
    const doc = JSON.parse(a.stdout());
    assert.deepEqual(doc.summary.security_blockers, []);
    assert.equal(doc.records.find((r: { id: string }) => r.id === "SAFE-02").status, "not_run");
  });
});
