import type { AssessKind, CatalogueMeta, LoadFact, Practice, ProfileId, Quote, Source, Strength } from "../../src/catalog/types.ts";
import { AREAS } from "../../src/catalog/types.ts";
import { parseCountsTable, parsePractices, parseSources, parseLoadFacts } from "./parse-research.ts";
import type { RawPractice, RawQuote, StrengthLine } from "./parse-research.ts";

export interface Authored {
  anchors?: Record<string, string>;
  fix_hint?: string;
  profile_rules?: Practice["profile_rules"];
  scope_note?: string;
}

export interface Overlays {
  overrides: Record<string, { profiles?: ProfileId[]; assess?: AssessKind[]; reason: string }>;
  /** Quotes the parser cannot extract, added by hand and copied verbatim from the research file. */
  quotes: Record<string, Quote[]>;
  /** Practices that failed the agreement test: shown, but kept out of area means and blockers. */
  experimental?: Record<string, { source: string; reason: string }>;
  sources: Record<string, { urls?: string[]; verify?: "skip"; skip_reason?: string }>;
  practices: Record<string, Authored>;
}

export class BuildError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`catalogue build failed:\n  ${problems.join("\n  ")}`);
    this.name = "BuildError";
    this.problems = problems;
  }
}

/** Profiles from the entry's Scope line: CC alone means claude-code; spec, API or claude.ai alone means portable. */
export function deriveProfiles(tokens: string[]): ProfileId[] {
  if (tokens.length === 0) return ["claude-code", "portable"];
  const cc = tokens.includes("CC") || tokens.includes("ALL");
  const portable = ["SPEC", "API", "AI", "ALL"].some((t) => tokens.includes(t));
  return [...(cc ? (["claude-code"] as const) : []), ...(portable ? (["portable"] as const) : [])];
}

/** M, J and X in the research file become mechanical, judgement and live. With no Assess line, the kind follows assessable_from. */
export function deriveAssess(codes: string[], assessableFrom: string): AssessKind[] {
  const map: Record<string, AssessKind | undefined> = { M: "mechanical", J: "judgement", X: "live", run: "live" };
  const kinds = [...new Set(codes.map((c) => map[c]).filter((k): k is AssessKind => k !== undefined))];
  if (kinds.length > 0) return kinds;
  return assessableFrom === "run" ? ["live"] : assessableFrom === "process" ? ["judgement"] : ["judgement"];
}

function sortKey(id: string): number {
  const [area, n] = id.split("-");
  return AREAS.indexOf(area as (typeof AREAS)[number]) * 100 + Number(n);
}

function toQuote(q: RawQuote): Quote {
  return { text: q.text, source: q.source, section: q.section, ...(q.older ? { older: true } : {}) };
}

/** The Strength line that applies to a profile: its own line, else the plain line; portable also accepts the upload-surfaces line. */
export function strengthFor(lines: StrengthLine[], profile: ProfileId): StrengthLine | undefined {
  return lines.find((l) => l.scope === profile) ?? lines.find((l) => l.scope === "all");
}

export interface BuildResult {
  meta: CatalogueMeta;
  sources: Source[];
  practices: Practice[];
  load_facts: LoadFact[];
  warnings: string[];
}

export function buildCatalogue(md: string, ov: Overlays): BuildResult {
  const problems: string[] = [];
  const rawSources = parseSources(md);
  const sourceIds = new Set(rawSources.map((s) => s.id));
  const raws = parsePractices(md, sourceIds);

  const sources: Source[] = rawSources.map((s) => {
    const o = ov.sources[s.id];
    const urls = o?.urls ?? s.urls;
    const verify = o?.verify ?? "auto";
    if (urls.length === 0 && verify === "auto") problems.push(`source ${s.id} has no URL and no overlay marks it skip`);
    return {
      id: s.id,
      tier: s.tier,
      urls,
      title: s.title,
      version_evidence: s.versionEvidence,
      verify,
      ...(verify === "skip" ? { skip_reason: o?.skip_reason ?? "" } : {}),
    };
  });
  for (const id of Object.keys(ov.sources)) if (!sourceIds.has(id)) problems.push(`sources overlay names unknown source ${id}`);

  const known = new Set(raws.map((r) => r.id));
  for (const [name, map] of Object.entries({ overrides: ov.overrides, quotes: ov.quotes, practices: ov.practices, experimental: ov.experimental ?? {} }))
    for (const id of Object.keys(map)) if (!known.has(id)) problems.push(`${name} overlay names unknown practice ${id}`);

  const warnings: string[] = [];
  const load_facts = parseLoadFacts(md);
  if (load_facts.length === 0) problems.push("section 2.12 holds no LB rows");

  const practices: Practice[] = raws
    .slice()
    .sort((a, b) => sortKey(a.id) - sortKey(b.id))
    .map((r: RawPractice): Practice => {
      const ovr = ov.overrides[r.id];
      const cc = strengthFor(r.strengths, "claude-code");
      const port = strengthFor(r.strengths, "portable") ?? cc;
      if (!cc || !port) problems.push(`${r.id}: the research entry has no Strength line`);
      for (const l of r.strengths) if (!sourceIds.has(l.source)) problems.push(`${r.id}: Strength line cites ${l.source}, which is not in the register`);
      const profiles = ovr?.profiles ?? deriveProfiles(r.scopeTokens);
      // The base strength is the claude-code line (the default profile), even for a portable-only practice, so section 2.11 can be reproduced.
      const base = cc ?? port ?? { cls: "STATEMENT", word: "", source: "" };
      const portableOwn = profiles.includes("portable") && r.strengths.some((l) => l.scope === "portable") ? port : undefined;
      const quotes = [...r.quotes.map(toQuote), ...(ov.quotes[r.id] ?? [])];
      for (const q of quotes) if (!sourceIds.has(q.source)) problems.push(`${r.id}: quote source ${q.source} is not in the register`);
      if (quotes.length === 0) problems.push(`${r.id}: no quote could be extracted and quotes.yaml adds none`);
      const a = ov.practices[r.id] ?? {};
      for (const [prof, rule] of Object.entries(a.profile_rules ?? {}))
        if (rule && "strength" in rule) problems.push(`${r.id}: profile_rules.${prof}.strength is authored; it must come from the research file's Strength lines`);
      const profile_rules: NonNullable<Practice["profile_rules"]> = JSON.parse(JSON.stringify(a.profile_rules ?? {}));
      if (portableOwn)
        profile_rules.portable = { strength: portableOwn.cls.toLowerCase() as Strength, strength_word: portableOwn.word, strength_source: portableOwn.source, ...(profile_rules.portable ?? {}) };
      return {
        id: r.id,
        area: r.area as Practice["area"],
        title: r.title,
        strength: base.cls.toLowerCase() as Strength,
        strength_word: base.word,
        strength_source: base.source,
        profiles,
        assess: ovr?.assess ?? deriveAssess(r.assessCodes, r.assessableFrom),
        assessable_from: r.assessableFrom as Practice["assessable_from"],
        freshness: r.freshness as Practice["freshness"],
        contested: r.contested,
        experimental: ov.experimental?.[r.id] !== undefined,
        ...(ov.experimental?.[r.id] ? { experimental_reason: ov.experimental[r.id]!.reason, experimental_source: ov.experimental[r.id]!.source } : {}),
        ...(a.scope_note ? { scope_note: a.scope_note } : {}),
        quotes,
        ...(Object.keys(profile_rules).length > 0 ? { profile_rules } : {}),
        ...(a.anchors ? { anchors: a.anchors as Practice["anchors"] } : {}),
        ...(a.fix_hint ? { fix_hint: a.fix_hint } : {}),
        ...(a.anchors || a.fix_hint ? { inferred: true } : {}),
      };
    });

  // Cross-check against section 2.11: it checks the parser and the builder, nothing else.
  const tables = parseCountsTable(md);
  for (const profile of ["claude-code", "portable"] as const)
    for (const row of tables[profile]) {
      const mine = raws.filter((r) => r.area === row.area);
      const cls = (c: string): number => mine.filter((r) => strengthFor(r.strengths, profile)?.cls === c || (profile === "portable" && !strengthFor(r.strengths, "portable") && strengthFor(r.strengths, "claude-code")?.cls === c)).length;
      const got: Record<string, number> = {
        practices: mine.length,
        must: cls("MUST"), directive: cls("DIRECTIVE"), suggestion: cls("SUGGESTION"), statement: cls("STATEMENT"),
        artifact: mine.filter((p) => p.assessableFrom === "artifact").length,
        run: mine.filter((p) => p.assessableFrom === "run").length,
        process: mine.filter((p) => p.assessableFrom === "process").length,
        recent: mine.filter((p) => p.freshness === "recent").length,
        undatedLive: mine.filter((p) => p.freshness === "undated-live").length,
        staleUnconfirmed: mine.filter((p) => p.freshness === "stale-unconfirmed").length,
      };
      for (const [k, v] of Object.entries(got)) if (v !== (row as unknown as Record<string, number>)[k]) problems.push(`${profile} ${row.area}: ${k} is ${v} but section 2.11 says ${(row as unknown as Record<string, number>)[k]}`);
    }

  const revision = /\(revision (\d+)\)/.exec(md.split("\n")[0] ?? "");
  const date = /Research date: (\d{4}-\d{2}-\d{2})/.exec(md);
  if (!revision || !date) problems.push("the research file's first lines do not name a revision and a research date");
  if (problems.length > 0) throw new BuildError(problems);
  return { meta: { revision: Number(revision?.[1]), research_date: date?.[1] as string }, sources, practices, load_facts, warnings };
}
