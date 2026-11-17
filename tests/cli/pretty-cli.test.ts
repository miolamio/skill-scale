import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { main } from "../../src/cli.ts";
import type { CliIo } from "../../src/cli.ts";
import { LOGO } from "../../src/report/logo.ts";
import { stripAnsi, visibleWidth } from "../../src/report/term.ts";
import { GOOD_DIR, GOOD_FILES, tempDir, writeSkill } from "../helpers/skills.ts";

const SHIPPED = new URL("../../catalog/", import.meta.url).pathname;
const BIN = new URL("../../src/bin.ts", import.meta.url).pathname;
const tmp = tempDir();
after(() => tmp.cleanup());

function setup(term?: CliIo["term"]) {
  const out: string[] = [];
  const io: CliIo = {
    stdout: (s) => void out.push(s),
    stderr: () => {},
    fetcher: async () => { throw new Error("no network in tests"); },
    catalogDir: SHIPPED,
    version: "9.9.9",
    ...(term ? { term } : {}),
  };
  return { io, stdout: () => out.join("") };
}

describe("pretty mode in the CLI", () => {
  it("prints the logo above --version and --help only in pretty mode", async () => {
    const plain = setup({ env: {}, isTTY: false });
    await main(["--version"], plain.io);
    assert.equal(plain.stdout(), "9.9.9\n");
    const v = setup({ env: { FORCE_COLOR: "1" } });
    assert.equal(await main(["--version"], v.io), 0);
    assert.ok(stripAnsi(v.stdout()).startsWith(`${LOGO}\n\n`));
    assert.ok(stripAnsi(v.stdout()).endsWith("\n\n9.9.9\n"));
    const h = setup({ env: { FORCE_COLOR: "1" } });
    await main(["--help"], h.io);
    assert.ok(stripAnsi(h.stdout()).startsWith(`${LOGO}\n\nUsage:`));
    const hp = setup({ env: {}, isTTY: false });
    await main(["--help"], hp.io);
    assert.ok(hp.stdout().startsWith("Usage:"));
  });
  it("renders the pretty console report when forced, within the terminal width, and the plain one otherwise", async () => {
    const dir = writeSkill(join(tmp.path, "pc"), GOOD_DIR, GOOD_FILES);
    const pretty = setup({ env: { FORCE_COLOR: "1" }, columns: 70, home: "/nowhere" });
    await main([dir], pretty.io);
    assert.match(pretty.stdout(), /^\x1b\[36m◢◤/);
    for (const l of pretty.stdout().split("\n")) assert.ok(visibleWidth(l) <= 70);
    const plain = setup({ env: {}, isTTY: false });
    await main([dir], plain.io);
    assert.match(plain.stdout(), /^skill-scale 9\.9\.9 \| catalogue r\d+ \| profile claude-code\n/);
    assert.ok(!plain.stdout().includes("\x1b"));
  });
  it("leaves json untouched in pretty mode", async () => {
    const dir = writeSkill(join(tmp.path, "pj"), GOOD_DIR, GOOD_FILES);
    const a = setup({ env: { FORCE_COLOR: "1" } });
    await main([dir, "--format", "json"], a.io);
    assert.ok(!a.stdout().includes("\x1b"));
    JSON.parse(a.stdout());
  });
  it("real binary: --version is the bare version through a pipe and has the logo with FORCE_COLOR=1", () => {
    const base = { ...process.env };
    delete base.FORCE_COLOR;
    delete base.NO_COLOR;
    const piped = spawnSync(process.execPath, [BIN, "--version"], { env: base, encoding: "utf8" });
    assert.match(piped.stdout, /^\d+\.\d+\.\d+\n$/);
    const forced = spawnSync(process.execPath, [BIN, "--version"], { env: { ...base, FORCE_COLOR: "1" }, encoding: "utf8" });
    assert.ok(stripAnsi(forced.stdout).startsWith(`${LOGO}\n\n`));
    assert.ok(stripAnsi(forced.stdout).endsWith(`\n\n${piped.stdout}`));
  });
});
