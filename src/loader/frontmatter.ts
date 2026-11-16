import { isMap, isScalar, parseDocument } from "yaml";

export type FrontmatterCause = "unclosed" | "yaml" | "duplicate-key" | "not-mapping" | "misplaced";

export type FrontmatterStatus = "ok" | "absent" | "invalid" | "misplaced";

export interface Frontmatter {
  status: FrontmatterStatus;
  data: Record<string, unknown>;
  /** 1-based file line of each top-level key. */
  keyLines: Record<string, number>;
  error: string | null;
  /** Why the frontmatter cannot be read. Only "yaml" and "misplaced" are cases the docs state (research LB-09). */
  cause: FrontmatterCause | null;
  /** 1-based line of the opening marker, 0 when there is none. */
  openLine: number;
}

const MARKER = /^---[ \t]*$/;
const CLOSER = /^(---|\.\.\.)[ \t]*$/;

function empty(status: FrontmatterStatus, error: string | null, openLine = 0, cause: FrontmatterCause | null = null): Frontmatter {
  return { status, data: {}, keyLines: {}, error, cause, openLine };
}

/** Claude Code reads the frontmatter only when the opening marker is the first line of the file. */
export function parseFrontmatter(raw: string): Frontmatter {
  const lines = raw.replace(/^\uFEFF/, "").split(/\r?\n/);
  const first = lines.findIndex((l) => l.trim() !== "");
  if (first < 0 || !MARKER.test(lines[first])) return empty("absent", null);
  const close = lines.findIndex((l, i) => i > first && CLOSER.test(l));
  if (close < 0) return first === 0 ? empty("invalid", "the frontmatter block is never closed", first + 1, "unclosed") : empty("misplaced", "the frontmatter block is never closed", first + 1, "misplaced");
  if (first > 0) return empty("misplaced", `the opening --- is on line ${first + 1}, not line 1`, first + 1, "misplaced");

  const text = lines.slice(first + 1, close).join("\n");
  const doc = parseDocument(text, { prettyErrors: false });
  if (doc.errors.length > 0) return empty("invalid", doc.errors[0].message.split("\n")[0], first + 1, doc.errors.every((e) => e.code === "DUPLICATE_KEY") ? "duplicate-key" : "yaml");
  if (doc.contents === null) return { status: "ok", data: {}, keyLines: {}, error: null, cause: null, openLine: first + 1 };
  if (!isMap(doc.contents)) return empty("invalid", "the frontmatter must be a mapping of fields", first + 1, "not-mapping");

  const keyLines: Record<string, number> = {};
  for (const pair of doc.contents.items) {
    if (!isScalar(pair.key) || !pair.key.range) continue;
    const before = text.slice(0, pair.key.range[0]);
    keyLines[String(pair.key.value)] = first + 2 + (before.match(/\n/g)?.length ?? 0);
  }
  return { status: "ok", data: (doc.toJS() ?? {}) as Record<string, unknown>, keyLines, error: null, cause: null, openLine: first + 1 };
}
