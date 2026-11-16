import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { parseFrontmatter } from "../../src/loader/frontmatter.ts";
import { MAX_TEXT_BYTES } from "../../src/loader/files.ts";
import { loadSkill, SkillLoadError } from "../../src/loader/skill.ts";
import { GOOD_DIR, GOOD_FILES, tempDir, writeSkill } from "../helpers/skills.ts";

const tmp = tempDir();
after(() => tmp.cleanup());

describe("parseFrontmatter", () => {
  it("reads fields and the line of each key", () => {
    const fm = parseFrontmatter("---\nname: a\ndescription: b\n---\nbody\n");
    assert.equal(fm.status, "ok");
    assert.deepEqual(fm.data, { name: "a", description: "b" });
    assert.deepEqual(fm.keyLines, { name: 2, description: 3 });
  });
  it("reports a file without frontmatter as absent", () => assert.equal(parseFrontmatter("# Title\n").status, "absent"));
  it("reports YAML that does not parse as invalid", () => {
    const fm = parseFrontmatter("---\ndescription: [oops\n---\n");
    assert.equal(fm.status, "invalid");
    assert.match(fm.error ?? "", /./);
  });
  it("reports duplicate keys as invalid", () => assert.equal(parseFrontmatter("---\nname: a\nname: b\n---\n").status, "invalid"));
  it("reports a block that is never closed as invalid", () => assert.equal(parseFrontmatter("---\nname: a\n").status, "invalid"));
  it("reports an opening marker that is not on line 1 as misplaced", () => assert.equal(parseFrontmatter("\n---\nname: a\n---\n").status, "misplaced"));
  it("accepts an empty block", () => assert.deepEqual(parseFrontmatter("---\n---\n").data, {}));
  it("rejects a block that is not a mapping", () => assert.equal(parseFrontmatter("---\n- a\n---\n").status, "invalid"));
  it("says why a frontmatter cannot be read: yaml, duplicate key, unclosed, not a mapping, misplaced", () => {
    assert.equal(parseFrontmatter("---\ndescription: [oops\n---\n").cause, "yaml");
    assert.equal(parseFrontmatter("---\nname: a\nname: b\n---\n").cause, "duplicate-key");
    assert.equal(parseFrontmatter("---\nname: a\n").cause, "unclosed");
    assert.equal(parseFrontmatter("---\n- a\n---\n").cause, "not-mapping");
    assert.equal(parseFrontmatter("\n---\nname: a\n---\n").cause, "misplaced");
    assert.equal(parseFrontmatter("---\nname: a\n---\n").cause, null);
  });
  it("ignores a byte order mark", () => assert.equal(parseFrontmatter("\uFEFF---\nname: a\n---\n").status, "ok"));
});

describe("loadSkill", () => {
  it("loads the good fixture with references resolved", () => {
    const skill = loadSkill(writeSkill(tmp.path, "load1/" + GOOD_DIR, GOOD_FILES));
    assert.equal(skill.dirName, GOOD_DIR);
    assert.equal(skill.skillFileName, "SKILL.md");
    assert.equal(skill.frontmatter.status, "ok");
    const targets = skill.refs.map((r) => `${r.kind}:${r.resolved}:${r.exists}`);
    assert.deepEqual(targets, ["link:reference/data-guide.md:true", "link:assets/report-template.md:true"]);
  });
  it("counts lines without the final newline", () => {
    const skill = loadSkill(writeSkill(tmp.path, "load2/s", { "SKILL.md": "a\nb\nc\n" }));
    assert.equal(skill.lineCount, 3);
  });
  it("fails when the folder does not exist, is a file, or has no SKILL.md", () => {
    assert.throws(() => loadSkill(join(tmp.path, "missing")), SkillLoadError);
    const root = writeSkill(tmp.path, "load3/empty", { "notes.txt": "x" });
    assert.throws(() => loadSkill(root), /no SKILL.md/);
    assert.throws(() => loadSkill(join(root, "notes.txt")), /not a folder/);
  });
  it("does not follow symlinks and marks binary files", () => {
    const root = writeSkill(tmp.path, "load4/s", { "SKILL.md": "x\n" });
    symlinkSync("/etc/hosts", join(root, "hosts-link"));
    writeFileSync(join(root, "blob.bin"), Buffer.from([1, 0, 2]));
    const kinds = Object.fromEntries(loadSkill(root).files.map((f) => [f.path, f.kind]));
    assert.equal(kinds["hosts-link"], "symlink");
    assert.equal(kinds["blob.bin"], "binary");
  });
  it("loads a single Markdown file as a loose skill, reading nothing else from its folder", () => {
    const root = writeSkill(tmp.path, "load6/skills", { "one.md": "---\nname: one\n---\nBody\n", "other.md": "x" });
    const skill = loadSkill(join(root, "one.md"));
    assert.deepEqual([skill.looseFile, skill.skillFileName, skill.files.map((f) => f.path)], [true, "one.md", ["one.md"]]);
  });
  it("refuses a symlinked loose file without reading its target (SKM-30)", () => {
    const root = writeSkill(tmp.path, "load30a/skills", { "real.md": "SECRET-CONTENT\n" });
    symlinkSync(join(root, "real.md"), join(root, "x.md"));
    assert.throws(() => loadSkill(join(root, "x.md")), (e: Error) => e instanceof SkillLoadError && /symlink/.test(e.message) && !e.message.includes("SECRET"));
  });
  it("refuses an oversized loose file (SKM-30)", () => {
    const root = writeSkill(tmp.path, "load30b/skills", { "big.md": "a".repeat(MAX_TEXT_BYTES + 1) });
    assert.throws(() => loadSkill(join(root, "big.md")), (e: Error) => e instanceof SkillLoadError && /1 MB/.test(e.message));
  });
  it("accepts a loose file of exactly MAX_TEXT_BYTES (SKM-30)", () => {
    const root = writeSkill(tmp.path, "load30c/skills", { "edge.md": "a".repeat(MAX_TEXT_BYTES) });
    assert.equal(loadSkill(join(root, "edge.md")).files[0]?.bytes, MAX_TEXT_BYTES);
  });
  it("treats a path to SKILL.md as its folder, not as a loose file (SKM-1)", () => {
    const root = writeSkill(tmp.path, "load10/s", { "SKILL.md": "x\n", "ref.md": "y\n" });
    const skill = loadSkill(join(root, "SKILL.md"));
    assert.deepEqual([skill.looseFile, skill.root, skill.dirName, skill.files.map((f) => f.path)], [false, root, "s", ["SKILL.md", "ref.md"]]);
  });
  it("finds a plugin from a manifest in the folder or a parent, and lets the caller override it", () => {
    const root = writeSkill(tmp.path, "load7/plugin", { ".claude-plugin/plugin.json": "{}", "skills/s/SKILL.md": "x\n" });
    const inner = join(root, "skills/s");
    assert.equal(loadSkill(inner).inPlugin, true);
    assert.equal(loadSkill(inner, { plugin: "no" }).inPlugin, false);
    assert.equal(loadSkill(writeSkill(tmp.path, "load8/s", { "SKILL.md": "x\n" }), { plugin: "yes" }).inPlugin, true);
    assert.equal(loadSkill(writeSkill(tmp.path, "load9/s", { "SKILL.md": "x\n" })).inPlugin, false);
  });
  it("ignores .git and node_modules", () => {
    const root = writeSkill(tmp.path, "load5/s", { "SKILL.md": "x\n", ".git/config": "x", "node_modules/m/index.js": "x" });
    mkdirSync(join(root, "scripts"));
    assert.deepEqual(loadSkill(root).files.map((f) => f.path), ["SKILL.md"]);
  });
});

describe("references", () => {
  const refs = (md: string, extra: Record<string, string> = {}) => loadSkill(writeSkill(tmp.path, `refs${Math.random().toString(36).slice(2)}/s`, { "SKILL.md": md, ...extra })).refs;
  it("finds links, skill-dir paths and inline code paths that exist", () => {
    const r = refs("[a](a.md) `b.md` and ${CLAUDE_SKILL_DIR}/scripts/run.sh\n", { "a.md": "x", "b.md": "x", "scripts/run.sh": "x" });
    assert.deepEqual(r.map((x) => x.kind + ":" + x.resolved), ["skill-dir:scripts/run.sh", "link:a.md", "code:b.md"]);
  });
  it("ignores URLs, anchors, absolute paths, templates and links inside code fences", () => {
    const r = refs("[x](https://e.com) [y](#top) [z](/abs) [t]({baseDir}/x.md)\n```\n[c](c.md)\n```\n");
    assert.deepEqual(r, []);
  });
  it("marks a missing file and a path that leaves the folder", () => {
    const r = refs("[m](missing.md) [o](../outside.md)\n");
    assert.deepEqual(r.map((x) => [x.exists, x.escapes]), [[false, false], [false, true]]);
  });
  it("resolves a link relative to the file it is in, then to the skill root", () => {
    const r = refs("[a](ref/a.md)\n", { "ref/a.md": "[b](b.md) [c](ref/c.md)", "ref/b.md": "x", "ref/c.md": "x" });
    assert.deepEqual(r.filter((x) => x.from === "ref/a.md").map((x) => [x.resolved, x.exists]), [["ref/b.md", true], ["ref/c.md", true]]);
  });
  it("is case sensitive about file names", () => {
    const r = refs("[a](Readme.md)\n", { "README.md": "x" });
    assert.equal(r[0]?.exists, false);
  });
});
