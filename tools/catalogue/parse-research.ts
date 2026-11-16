// Parses the research file (catalogue revision 5) into raw practice and source records.
// Only tools/build-catalogue.ts may call this: the research file lives in the gitignored .dev/.

export interface RawQuote {
  text: string;
  source: string;
  section: string;
  older: boolean;
}

export interface RawPractice {
  id: string;
  area: string;
  title: string;
  contested: boolean;
  /** Every "Strength:" line of the entry, in order. */
  strengths: StrengthLine[];
  assessCodes: string[]; // subset of M, J, X, process, run
  assessableFrom: string;
  freshness: string;
  scopeTokens: string[];
  singleSource: boolean;
  basis: string;
  quotes: RawQuote[];
}

export interface StrengthLine {
  scope: "all" | "claude-code" | "portable";
  cls: "MUST" | "DIRECTIVE" | "SUGGESTION" | "STATEMENT";
  word: string;
  source: string;
}

export interface RawSource {
  id: string;
  tier: "A" | "B-recent" | "B-older" | "C";
  urls: string[];
  title: string;
  versionEvidence: string;
}

export interface CountsRow {
  area: string;
  practices: number;
  must: number;
  directive: number;
  suggestion: number;
  statement: number;
  artifact: number;
  run: number;
  process: number;
  recent: number;
  undatedLive: number;
  staleUnconfirmed: number;
}

const HEADER = /^\*\*([A-Z]+-\d{2}) (.+?)\*\*(.*)$/;
const CITATION = /\(([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)(?=[ ,)])([^)]*)\)/g;
const QUOTE = /"([^"\n]+)"/g;
const GAP_CONNECTORS = /(?:\b(?:and|or)\b|[,;.:]|\.\.\.|…)/g;
const MIN_QUOTE_LENGTH = 8;

function normaliseQuotes(line: string): string {
  return line.replace(/[“”]/g, '"');
}

export function parseSources(md: string): RawSource[] {
  const lines = md.split("\n");
  const out: RawSource[] = [];
  let tier: RawSource["tier"] | null = null;
  for (const line of lines) {
    if (line.startsWith("### 1.1 ")) tier = "A";
    else if (line.startsWith("### 1.2 ")) tier = "B-recent";
    else if (line.startsWith("### 1.3 ")) tier = "B-older";
    else if (line.startsWith("### 1.4 ")) tier = "C";
    else if (line.startsWith("## ") && !line.startsWith("## 1.")) tier = null;
    if (!tier || !line.startsWith("| ")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    const id = cells[0];
    if (!id || id === "ID" || /^-+$/.test(id)) continue;
    const urls = [...(cells[1] ?? "").matchAll(/https?:\/\/[^\s;)|,]+/g)].map((m) => m[0].replace(/[.,]+$/, ""));
    out.push({ id, tier, urls: [...new Set(urls)], title: cells[2] ?? "", versionEvidence: cells[cells.length - 1] ?? "" });
  }
  return out;
}

function parseAssess(entry: string): string[] {
  const m = /Assess: ([^\n]*?)(?:\.(?:\s|$)|$)/.exec(entry);
  if (!m) return [];
  const text = m[1];
  const codes: string[] = [];
  for (const t of text.matchAll(/\b(M|J|X)\b|\b(process|run)\b/g)) codes.push(t[1] ?? t[2]);
  return [...new Set(codes)];
}

const STRENGTH_LINE = /^(?:(Claude Code|Portable\/API|Upload surfaces \([^)]*\)): )?Strength: (MUST|DIRECTIVE|SUGGESTION|STATEMENT); word: "([^"]*)"; source: ([A-Za-z0-9-]+)\s*$/;

function parseStrengths(entry: string): StrengthLine[] {
  const out: StrengthLine[] = [];
  for (const line of entry.split("\n")) {
    const m = STRENGTH_LINE.exec(line);
    if (!m) continue;
    const scope = m[1] === undefined ? "all" : m[1] === "Claude Code" ? "claude-code" : "portable";
    out.push({ scope, cls: m[2] as StrengthLine["cls"], word: m[3] as string, source: m[4] as string });
  }
  return out;
}

function parseQuotes(entry: string, sourceIds: Set<string>): RawQuote[] {
  const out: RawQuote[] = [];
  const seen = new Set<string>();
  for (const rawLine of entry.split("\n")) {
    const line = normaliseQuotes(rawLine);
    const older = /^\s*-\s*\(older/.test(line);
    const cites = [...line.matchAll(CITATION)].filter((m) => sourceIds.has(m[1]));
    if (cites.length === 0) continue;
    for (const q of line.matchAll(QUOTE)) {
      const text = q[1].trim();
      if (text.length < MIN_QUOTE_LENGTH) continue;
      const qEnd = (q.index ?? 0) + q[0].length;
      const cite = cites.find((c) => (c.index ?? 0) >= qEnd);
      if (!cite) continue;
      const gap = line.slice(qEnd, cite.index ?? 0).replace(QUOTE, "").replace(GAP_CONNECTORS, "").trim();
      if (gap !== "") continue;
      const rest = cite[2].replace(/^[ ,]+/, "");
      const section = rest.split(";")[0].trim();
      const key = `${cite[1]}\u0000${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ text, source: cite[1], section, older });
    }
  }
  return out;
}

export function parsePractices(md: string, sourceIds: Set<string>): RawPractice[] {
  const start = md.indexOf("\n## 2. Practice catalogue");
  const end = md.indexOf("\n### 2.11 ");
  if (start < 0 || end < 0) throw new Error("research file: section 2 boundaries not found");
  const lines = md.slice(start, end).split("\n");
  const entries: { head: RegExpExecArray; body: string[] }[] = [];
  for (const line of lines) {
    if (line.startsWith("### ")) continue;
    const h = HEADER.exec(line);
    if (h) entries.push({ head: h, body: [line] });
    else if (entries.length > 0) entries[entries.length - 1].body.push(line);
  }
  return entries.map(({ head, body }) => {
    const entry = body.join("\n");
    const id = head[1];
    const rawTitle = head[2];
    const qualifier = /\s*\(([^()]*\b(?:restored|new|contested)\b[^()]*)\)\.?$/.exec(rawTitle);
    const title = (qualifier ? rawTitle.slice(0, qualifier.index) : rawTitle).replace(/\.$/, "").trim();
    const fresh = [...entry.matchAll(/freshness: (recent|undated-live|stale-unconfirmed)/g)].pop();
    const assessable = [...entry.matchAll(/assessable_from: (artifact|run|process)/g)].pop();
    if (!fresh || !assessable) throw new Error(`research file: ${id} lacks freshness or assessable_from`);
    const scope = /Scope: ([^\n]*?)(?:\. |\.$|$)/.exec(entry);
    const basis = /Basis: ([^\n]*?)\.?$/m.exec(entry);
    return {
      id,
      area: id.split("-")[0],
      title,
      contested: /contested/i.test(qualifier?.[1] ?? ""),
      strengths: parseStrengths(entry),
      assessCodes: parseAssess(entry),
      assessableFrom: assessable[1],
      freshness: fresh[1],
      scopeTokens: scope ? [...scope[1].matchAll(/\b(CC|API|AI|SPEC|ALL)\b/g)].map((m) => m[1]) : [],
      singleSource: /\*\*Single-source/.test(entry),
      basis: basis ? basis[1].trim() : "",
      quotes: parseQuotes(entry, sourceIds),
    };
  });
}

/** Section 2.11 has one table per profile. Used only as a check on the parser and builder. */
export function parseCountsTable(md: string): Record<"claude-code" | "portable", CountsRow[]> {
  const start = md.indexOf("### 2.11 ");
  if (start < 0) throw new Error("research file: section 2.11 not found");
  const out: Record<"claude-code" | "portable", CountsRow[]> = { "claude-code": [], portable: [] };
  let profile: "claude-code" | "portable" = "claude-code";
  for (const line of md.slice(start).split("\n")) {
    if (line.startsWith("## ") || line.startsWith("#### ")) break;
    if (/^Portable \/ API profile/.test(line)) profile = "portable";
    else if (/^Claude Code profile/.test(line)) profile = "claude-code";
    if (!line.startsWith("| ")) continue;
    const c = line.split("|").slice(1, -1).map((x) => x.trim());
    if (c.length !== 12 || !/^[A-Z]+$/.test(c[0] as string) || c[0] === "Area" || c[0] === "Total" || Number.isNaN(Number(c[1]))) continue;
    const n = c.slice(1).map(Number);
    out[profile].push({
      area: c[0] as string, practices: n[0] as number, must: n[1] as number, directive: n[2] as number, suggestion: n[3] as number, statement: n[4] as number,
      artifact: n[8] as number, run: n[9] as number, process: n[10] as number, recent: n[5] as number, undatedLive: n[6] as number, staleUnconfirmed: n[7] as number,
    });
  }
  return out;
}

/** Section 2.12 is a table of load-blocking facts: ID | Condition | Exact quote | Source and section | Stops | Related. */
export function parseLoadFacts(md: string): { id: string; condition: string; quote: string; source: string; stops: string }[] {
  const start = md.indexOf("\n### 2.12 ");
  if (start < 0) throw new Error("research file: section 2.12 not found");
  const out: { id: string; condition: string; quote: string; source: string; stops: string }[] = [];
  for (const line of md.slice(start + 1).split("\n").slice(1)) {
    if (/^#{2,3} /.test(line)) break;
    const c = line.split("|").slice(1, -1).map((x) => x.trim());
    if (c.length >= 5 && /^LB-\d{2}$/.test(c[0] as string)) out.push({ id: c[0] as string, condition: c[1] as string, quote: c[2] as string, source: c[3] as string, stops: c[4] as string });
  }
  return out;
}
