import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type { SkillFile } from "./files.ts";
import { countLines, MAX_TEXT_BYTES, walkSkill } from "./files.ts";
import type { Frontmatter } from "./frontmatter.ts";
import { parseFrontmatter } from "./frontmatter.ts";
import type { Reference } from "./references.ts";
import { extractReferences } from "./references.ts";

export class SkillLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillLoadError";
  }
}

export type PluginMode = "auto" | "yes" | "no";

export interface SkillModel {
  root: string;
  dirName: string;
  /** The file name as it exists on disk, for example SKILL.md or skill.md. */
  skillFileName: string;
  /** The skill is a single Markdown file that is not inside a skill folder of its own (research LB-08). */
  looseFile: boolean;
  /**
   * Whether the skill belongs to a plugin. Claude Code's naming rules differ inside a plugin (LB-02, LB-05).
   * "auto" looks for .claude-plugin/plugin.json in the folder or any parent; "yes" and "no" override that.
   */
  inPlugin: boolean;
  raw: string;
  lineCount: number;
  frontmatter: Frontmatter;
  files: SkillFile[];
  /** Files over MAX_TEXT_BYTES: they are listed but never read, so no check can look inside them (SKM-2). */
  skippedFiles: { path: string; bytes: number }[];
  dirs: string[];
  refs: Reference[];
}

export function isInPlugin(start: string): boolean {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(resolve(dir, ".claude-plugin", "plugin.json"))) return true;
    if (dirname(dir) === dir) return false;
  }
}

export function loadSkill(path: string, opts: { plugin?: PluginMode } = {}): SkillModel {
  const given = resolve(path);
  let st;
  try {
    // lstat first: a symlinked loose file would be read through to its target (SKM-30).
    if (lstatSync(given).isSymbolicLink() && statSync(given).isFile()) throw new SkillLoadError(`${path}: is a symlink; pass the real file`);
    st = statSync(given);
  } catch (e) {
    if (e instanceof SkillLoadError) throw e;
    if (existsSync(given) === false && lstatSync(given, { throwIfNoEntry: false })?.isSymbolicLink()) throw new SkillLoadError(`${path}: broken symlink`);
    throw new SkillLoadError(`${path}: no such folder`);
  }
  // A path to the skill file itself (SKILL.md in any letter case) means its folder, not a loose file.
  const isSkillFile = st.isFile() && basename(given).toLowerCase() === "skill.md";
  const loose = st.isFile() && !isSkillFile && /\.md$/i.test(given);
  if (!st.isDirectory() && !isSkillFile && !loose) throw new SkillLoadError(`${path}: not a folder (pass the skill folder, or a single .md skill file)`);
  const root = st.isDirectory() ? given : dirname(given);
  const mode = opts.plugin ?? "auto";
  const inPlugin = mode === "yes" ? true : mode === "no" ? false : isInPlugin(root);
  let skillFileName: string;
  let files: SkillFile[];
  let dirs: string[];
  if (loose) {
    skillFileName = basename(given);
    if (st.size > MAX_TEXT_BYTES) throw new SkillLoadError(`${path}: file is over ${MAX_TEXT_BYTES / 1_048_576} MB and was not read`);
    const text = readFileSync(given, "utf8");
    files = [{ path: skillFileName, bytes: Buffer.byteLength(text), kind: "text", text, lines: countLines(text) }];
    dirs = [];
  } else {
    const names = readdirSync(root).sort();
    const found = names.includes("SKILL.md") ? "SKILL.md" : names.find((n) => n.toLowerCase() === "skill.md");
    if (!found) throw new SkillLoadError(`${path}: no SKILL.md in this folder`);
    skillFileName = found;
    ({ files, dirs } = walkSkill(root));
  }
  const main = files.find((f) => f.path === skillFileName);
  if (!main || main.kind !== "text" || main.text === null) throw new SkillLoadError(`${path}/${skillFileName}: cannot be read as text`);
  return {
    root,
    dirName: basename(root),
    skillFileName,
    looseFile: loose,
    inPlugin,
    raw: main.text,
    lineCount: countLines(main.text),
    frontmatter: parseFrontmatter(main.text),
    files,
    skippedFiles: files.filter((f) => f.kind === "large").map((f) => ({ path: f.path, bytes: f.bytes })),
    dirs,
    refs: extractReferences(files, dirs),
  };
}
