import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";

export interface SkillFile {
  /** POSIX path relative to the skill folder. */
  path: string;
  bytes: number;
  kind: "text" | "binary" | "symlink" | "large";
  text: string | null;
  lines: number;
}

/** Implementation safeguards, not rules about skills. */
const IGNORED_DIRS = new Set([".git", "node_modules", "__pycache__"]);
const IGNORED_FILES = new Set([".DS_Store"]);
export const MAX_TEXT_BYTES = 1_048_576;

export function countLines(text: string): number {
  if (text === "") return 0;
  const n = text.split("\n").length;
  return text.endsWith("\n") ? n - 1 : n;
}

export function walkSkill(root: string): { files: SkillFile[]; dirs: string[] } {
  const files: SkillFile[] = [];
  const dirs: string[] = [];
  const visit = (rel: string): void => {
    const names = readdirSync(join(root, rel)).sort();
    for (const name of names) {
      const relPath = rel === "" ? name : posix.join(rel, name);
      const abs = join(root, relPath);
      const st = lstatSync(abs);
      if (st.isSymbolicLink()) files.push({ path: relPath, bytes: 0, kind: "symlink", text: null, lines: 0 });
      else if (st.isDirectory()) {
        if (IGNORED_DIRS.has(name)) continue;
        dirs.push(relPath);
        visit(relPath);
      } else if (st.isFile()) {
        if (IGNORED_FILES.has(name)) continue;
        if (st.size > MAX_TEXT_BYTES) {
          files.push({ path: relPath, bytes: st.size, kind: "large", text: null, lines: 0 });
          continue;
        }
        const buf = readFileSync(abs);
        if (buf.includes(0)) files.push({ path: relPath, bytes: st.size, kind: "binary", text: null, lines: 0 });
        else {
          const text = buf.toString("utf8");
          files.push({ path: relPath, bytes: st.size, kind: "text", text, lines: countLines(text) });
        }
      }
    }
  };
  visit("");
  return { files, dirs };
}
export function megabytes(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function describeSkipped(f: { path: string; bytes: number }): string {
  return `${f.path} (${megabytes(f.bytes)})`;
}
