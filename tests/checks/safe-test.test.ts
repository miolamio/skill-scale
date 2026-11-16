import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { CREDENTIAL_PATTERNS, isPlaceholder, shannon } from "../../src/checks/safe.ts";
import { countEvalCases } from "../../src/checks/test.ts";
import { runAll, tmp } from "../helpers/run-checks.ts";
import { GOOD_DIR, variant } from "../helpers/skills.ts";

after(() => tmp.cleanup());

// Built at run time so that no secret-shaped string sits in the repository. Fakes have realistic entropy.
const MIX = "aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bD2fH4jL6xR8cV0MqZ7x9Lm2Kp4Rt8Vw3Yb6Nc1H";
const mix = (n: number): string => MIX.slice(0, n);
const body = (n: number): string => (MIX + MIX).slice(0, n);

const scan = (text: string) => runAll(GOOD_DIR, variant({ "scripts/run.sh": text }), "claude-code").findings["SAFE-02"] ?? [];

/** One true positive and its placeholders per rule. The placeholders must not be flagged. */
const cases: Record<string, { tp: string; placeholders: string[] }> = {
  "AWS access key ID": { tp: "AKIA" + "Z7Q2LMNB4XK9TR3P", placeholders: ["AKIAIOSFODNN7EXAMPLE", "ASIAIOSFODNN7EXAMPLE", "AKIA" + "A".repeat(16), "AKIA123"] },
  "GitHub token": { tp: "ghp_" + mix(36), placeholders: ["ghp_" + "a".repeat(36), "ghp_" + "x1".repeat(18), "ghp_short"] },
  "GitHub fine-grained token": { tp: "github_pat_" + mix(30) + "_" + mix(20), placeholders: ["github_pat_" + "X".repeat(30), "github_pat_YOUR_TOKEN_GOES_HERE_1234"] },
  "Anthropic API key": { tp: "sk-ant-api03-" + MIX + "-" + mix(20), placeholders: ["sk-ant-" + "x".repeat(24), "sk-ant-api03-" + "c".repeat(30), "sk-ant-your-key-goes-here-abcdefg"] },
  "OpenAI-style secret key": { tp: "sk-" + mix(48), placeholders: ["sk-" + "d".repeat(40), "sk-learn-is-a-python-library-for-ml-things", "sk-your-api-key-here-replace-me-1234567890", "sk-proj-" + "0".repeat(40)] },
  "Slack token": { tp: "xoxb-" + "8123456789-" + mix(24), placeholders: ["xoxb-your-token-here-1234", "xoxb-" + "1".repeat(20)] },
  "Slack webhook URL": { tp: "https://hooks.slack.com/services/T01234567/B01234567/" + mix(24), placeholders: ["https://hooks.slack.com/services/T00000000/B00000000/" + "X".repeat(24), "https://hooks.slack.com/services/T000/B000/XXXX"] },
  "GCP API key": { tp: "AIzaSy" + MIX.slice(0, 33), placeholders: ["AIzaSy" + "X".repeat(33), "YOUR_API_KEY", "AIzaSy..."] },
  "Stripe live key": { tp: "sk_live_" + "Zq7x9Lm2Kp4Rt8Vw3Yb6Nc1H", placeholders: ["sk_live_" + "x".repeat(24), "sk_" + "test_Zq7x9Lm2Kp4Rt8Vw3Yb6Nc1H"] },
  "HuggingFace token": { tp: "hf_" + "aBcDeFgHiJkLmNoPqRsTuVwXyZaBcDeFgH", placeholders: ["hf_" + "x".repeat(34), "hf_xxxx", "hf_YOUR_TOKEN"] },
  "npm token": { tp: "npm_" + mix(36), placeholders: ["npm_" + "x".repeat(36), "npm_TOKEN"] },
  "GitLab personal access token": { tp: "glpat-" + mix(20), placeholders: ["glpat-" + "x".repeat(20), "glpat-<token>"] },
  "SendGrid API key": { tp: "SG." + mix(22) + "." + MIX.slice(10, 53), placeholders: ["SG." + "x".repeat(22) + "." + "x".repeat(43), "SG.xxxx"] },
};

describe("SAFE-02 rules", () => {
  it("has a test case for every rule", () => {
    assert.deepEqual(Object.keys(cases).sort(), CREDENTIAL_PATTERNS.map((p) => p.name).sort());
  });
  for (const [name, c] of Object.entries(cases))
    it(`flags a ${name} and nothing in its placeholders`, () => {
      const f = scan(`token = "${c.tp}"\n`);
      assert.equal(f.length, 1);
      assert.match(f[0]?.message ?? "", new RegExp(name));
      assert.ok(!JSON.stringify(f).includes(c.tp), "the token must not appear in the finding");
      for (const ph of c.placeholders) assert.deepEqual(scan(`token = "${ph}"\n`), [], ph);
    });
  it("does not flag look-alikes in prose", () => {
    assert.deepEqual(scan("see the skill-creator and sk-learn docs, ghp_short, AKIA123\n"), []);
  });
  it("shannon entropy and placeholder filters behave", () => {
    assert.equal(shannon("aaaa"), 0);
    assert.equal(shannon("abcd"), 2);
    assert.equal(isPlaceholder("aaaaaaaa"), true);
    assert.equal(isPlaceholder("Z7Q2LMNB4XK9TR3P"), false);
    assert.equal(isPlaceholder("Zq7x0000Lm2Kp4"), true);
    assert.equal(isPlaceholder("abc-YOUR-def"), true);
  });
  it("tightens the OpenAI rule: a digit is required and at most two hyphens", () => {
    assert.equal(scan("sk-" + "abcdefghij".repeat(3) + "klm\n").length, 0, "no digit");
    assert.equal(scan("sk-" + mix(12) + "-" + mix(12) + "-" + mix(12) + "-" + mix(12) + "\n").length, 0, "three hyphens");
    assert.equal(scan("sk-" + mix(12) + "-" + mix(12) + "-" + mix(12) + "\n").length, 1, "two hyphens still match");
  });
  it("finds a secret in SKILL.md as well as in scripts, and reports its line", () => {
    const files = variant({ "SKILL.md": `---\nname: good-skill\ndescription: Summarises sales files. Use when asked.\n---\nKey: ${cases["Anthropic API key"]?.tp}\n` });
    const f = runAll(GOOD_DIR, files, "claude-code").findings["SAFE-02"] ?? [];
    assert.deepEqual(f.map((x) => [x.file, x.line]), [["SKILL.md", 5]]);
  });
  it("does not flag the AWS documentation placeholder but flags a realistic key shape (SKM-3)", () => {
    assert.deepEqual(scan("export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\n"), []);
    assert.equal(scan("AKIAIOSFODNN7EXAMPLE and AKIA" + "Z7Q2LMNB4XK9TR3P\n").length, 1);
  });
  it("does not flag placeholders in prose", () => {
    assert.deepEqual(scan("export API_KEY=your-key-here\nexport TOKEN=$TOKEN\n"), []);
  });
});

describe("SAFE-02 private keys", () => {
  it("flags a header followed by 64 base64 characters, with the header line", () => {
    const f = scan(`echo hi\n-----BEGIN RSA PRIVATE KEY-----\n${body(64)}\n-----END RSA PRIVATE KEY-----\n`);
    assert.deepEqual(f.map((x) => x.line), [2]);
  });
  it("flags a key whose body is spread over several lines", () => {
    assert.equal(scan(`-----BEGIN PRIVATE KEY-----\n${body(32)}\n${body(32)}\n`).length, 1);
  });
  for (const kind of ["ENCRYPTED", "RSA", "EC", "DSA", "OPENSSH"])
    it(`flags the ${kind} variant`, () => {
      assert.equal(scan(`-----BEGIN ${kind} PRIVATE KEY-----\n${body(80)}\n`).length, 1);
    });
  it("flags the PGP variant with armor header lines", () => {
    assert.equal(scan(`-----BEGIN PGP PRIVATE KEY BLOCK-----\nVersion: GnuPG v1\n\n${body(80)}\n`).length, 1);
  });
  it("does not flag the header alone, in a regex literal, in a docs table, or with a short or elided body", () => {
    assert.deepEqual(scan("-----BEGIN RSA PRIVATE KEY-----\n"), []);
    assert.deepEqual(scan("regex=r'-----BEGIN RSA PRIVATE KEY-----', severity='critical'\n"), []);
    assert.deepEqual(scan("| Private key | `-----BEGIN RSA PRIVATE KEY-----` | high |\n"), []);
    assert.deepEqual(scan("-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"), []);
    assert.deepEqual(scan(`-----BEGIN RSA PRIVATE KEY-----\n${body(20)}\n`), []);
    assert.deepEqual(scan(`-----BEGIN CERTIFICATE-----\n${body(80)}\n`), []);
  });
});

describe("SAFE-02 false-negative fixes", () => {
  const U64 = MIX + "_-" + MIX + "-_" + MIX; // base64url alphabet, no hyphen cap
  it("accepts long sk-proj-, sk-svcacct- and sk-admin- bodies with many hyphens, and a T3BlbkFJ marker", () => {
    for (const p of ["proj", "svcacct", "admin"]) assert.equal(scan(`k = sk-${p}-${"aB3-dE5_gH7-jK9_mN1-pQ3_sT5-vW7_yZ9-bD2_fH4-jL6_xR8-cV0_Mq7-".repeat(3)}\n`).length, 1, p);
    assert.equal(scan(`k = sk-proj-${mix(20)}T3BlbkFJ${mix(20)}\n`).length, 1);
    assert.equal(scan("k = sk-proj-" + U64.slice(0, 150) + "\n").length, 1);
  });
  it("still rejects kebab prose after sk- and sk-proj-", () => {
    assert.deepEqual(scan("sk-learn-is-a-python-library-for-ml-things\n"), []);
    assert.deepEqual(scan("sk-proj-is-a-prefix-used-by-openai-project-keys-in-docs\n"), []);
  });
  const key = "-----BEGIN PRIVATE KEY-----";
  const lines = (w: number): string[] => (body(192).match(new RegExp(`.{1,${w}}`, "g")) ?? []);
  it("finds a PEM wrapped in a JSON string with literal \\n or \\r\\n escapes", () => {
    assert.equal(scan(`{"private_key": "${key}\\n${lines(64).join("\\n")}\\n-----END PRIVATE KEY-----\\n"}\n`).length, 1);
    assert.equal(scan(`{"private_key": "${key}\\r\\n${lines(64).join("\\r\\n")}\\r\\n-----END PRIVATE KEY-----"}\n`).length, 1);
  });
  it("finds an indented YAML block and a blockquote, and reports the header's original line", () => {
    const wrap = (prefix: string) => `intro\nprivate_key: |\n${[key, ...lines(64), "-----END PRIVATE KEY-----"].map((l) => prefix + l).join("\n")}\n`;
    assert.deepEqual(scan(wrap("    ")).map((x) => x.line), [3]);
    assert.deepEqual(scan(wrap("> ")).map((x) => x.line), [3]);
    assert.deepEqual(scan(wrap("# ")).map((x) => x.line), [3]);
  });
  it("reports the original line of a header inside an escaped single line", () => {
    const f = scan(`a\nb\n"${key}\\n${lines(64).join("\\n")}\\n-----END PRIVATE KEY-----"\n`);
    assert.deepEqual(f.map((x) => x.line), [3]);
  });
  it("placeholder words match only as whole segments", () => {
    assert.equal(isPlaceholder("abc-YOUR-token"), true);
    assert.equal(isPlaceholder("your_token_here"), true);
    assert.equal(isPlaceholder("Zq7yourK2mP9"), false);
    assert.equal(isPlaceholder("aBhereCd3Ef"), false);
    assert.equal(isPlaceholder("IOSFODNN7EXAMPLE"), true);
  });
  it("does not apply the x/0-run test to the numeric parts of a Slack token", () => {
    assert.equal(scan("xoxb-" + "100000000123-" + "987654321098-" + mix(24) + "\n").length, 1);
  });
  it("matches the suppression marker only as the whole rule ID", () => {
    const k = "ghp_" + mix(36);
    assert.deepEqual(scan(`# skill-scale: ignore SAFE-020\nx = "${k}"\n`).map((x) => x.suppressed === true), [false]);
    assert.deepEqual(scan(`# skill-scale: ignore SAFE-02x\nx = "${k}"\n`).map((x) => x.suppressed === true), [false]);
    assert.deepEqual(scan(`# skill-scale: ignore SAFE-02.\nx = "${k}"\n`).map((x) => x.suppressed === true), [true]);
  });
});

describe("SAFE-02 corpus regressions (SKM-36)", () => {
  it("does not flag repeated-character fixtures, header-only strings or a detector's pattern list", () => {
    assert.deepEqual(scan("fake = 'ghp_" + "a".repeat(36) + "'\n"), []);
    assert.deepEqual(scan("fake = 'sk-ant-" + "x".repeat(24) + "'\n"), []);
    assert.deepEqual(scan("{'regex': r'-----BEGIN OPENSSH PRIVATE KEY-----', 'name': 'ssh key'}\n"), []);
  });
  it("still flags a realistic key", () => {
    assert.equal(scan("-----BEGIN RSA PRIVATE KEY-----\n" + body(64) + "\n").length, 1);
    assert.equal(scan("AKIA" + "Z7Q2LMNB4XK9TR3P\n").length, 1);
  });
});

describe("SAFE-02 inline suppression", () => {
  const key = "ghp_" + mix(36);
  it("marks a finding on the marker line and on the next line as suppressed, and no further", () => {
    const f = scan(`a=1 # skill-scale: ignore SAFE-02\nx = "${key}"\ny = "${key}"\n`);
    assert.deepEqual(f.map((x) => [x.line, x.suppressed === true]), [[2, true], [3, false]]);
    assert.deepEqual(scan(`x = "${key}" // skill-scale: ignore SAFE-02\n`).map((x) => x.suppressed), [true]);
    assert.deepEqual(scan(`<!-- skill-scale: ignore SAFE-02 -->\nx = "${key}"\n`).map((x) => x.suppressed), [true]);
  });
  it("also covers a private key header", () => {
    const f = scan(`# skill-scale: ignore SAFE-02\n-----BEGIN RSA PRIVATE KEY-----\n${body(64)}\n`);
    assert.deepEqual(f.map((x) => x.suppressed), [true]);
  });
});

describe("countEvalCases", () => {
  const f = (path: string, text: string | null = "") => ({ path, text });
  it("counts evals.json entries and case folders", () => {
    assert.equal(countEvalCases([f("evals/evals.json", JSON.stringify({ evals: [{}, {}] })), f("evals/a/case.yaml"), f("evals/b/prompt.md"), f("evals/b/graders/x.md")]), 4);
  });
  it("counts a folder once even when it holds both case.yaml and prompt.md", () => {
    assert.equal(countEvalCases([f("evals/a/case.yaml"), f("evals/a/prompt.md")]), 1);
  });
  it("counts nothing for unreadable JSON, a missing evals array, or files outside evals/", () => {
    assert.equal(countEvalCases([f("evals/evals.json", "{oops"), f("other/a/case.yaml")]), 0);
    assert.equal(countEvalCases([f("evals/evals.json", "{}")]), 0);
  });
});
