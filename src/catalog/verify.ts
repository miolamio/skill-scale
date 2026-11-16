import type { Catalogue, Source } from "./types.ts";
import type { Fetcher } from "./fetcher.ts";
import { normaliseForMatch } from "./normalise.ts";

export type QuoteStatus = "ok" | "changed" | "unverified" | "skipped";
export type SourceStatus = "ok" | "partial" | "failed" | "skipped";

export interface QuoteResult {
  practice: string;
  source: string;
  section: string;
  text: string;
  status: QuoteStatus;
}

export interface SourceResult {
  id: string;
  status: SourceStatus;
  errors: string[];
}

export interface VerifyReport {
  sources: SourceResult[];
  quotes: QuoteResult[];
  counts: Record<QuoteStatus, number>;
  exitCode: 0 | 1 | 2;
}

/** Implementation safeguard: how many pages are fetched at once. */
const FETCH_CONCURRENCY = 6;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

interface Fetched {
  source: Source;
  text: string;
  errors: string[];
  okUrls: number;
}

async function fetchSource(source: Source, fetcher: Fetcher): Promise<Fetched> {
  const texts: string[] = [];
  const errors: string[] = [];
  for (const url of source.urls) {
    try {
      texts.push(normaliseForMatch(await fetcher(url)));
    } catch (e) {
      errors.push(`${url}: ${(e as Error).message}`);
    }
  }
  return { source, text: texts.join(" "), errors, okUrls: texts.length };
}

/**
 * Re-check every catalogue quote against its source. A quote that is no longer an exact
 * substring is reported as "changed" and never rewritten: a person decides what a doc change means.
 * Exit code: 2 when any source could not be fetched or nothing was verified, else 1 when a quote changed, else 0.
 */
export async function verifyCatalogue(cat: Catalogue, fetcher: Fetcher, opts: { only?: string } = {}): Promise<VerifyReport> {
  const wanted = cat.sources.filter((s) => !opts.only || s.id === opts.only);
  const used = new Set(cat.practices.flatMap((p) => p.quotes.map((q) => q.source)));
  const toFetch = wanted.filter((s) => s.verify === "auto" && used.has(s.id));
  const fetched = new Map<string, Fetched>();
  for (const f of await mapLimit(toFetch, FETCH_CONCURRENCY, (s) => fetchSource(s, fetcher))) fetched.set(f.source.id, f);

  const sources: SourceResult[] = wanted
    .filter((s) => used.has(s.id))
    .map((s) => {
      const f = fetched.get(s.id);
      if (!f) return { id: s.id, status: "skipped", errors: s.skip_reason ? [s.skip_reason] : [] };
      const status: SourceStatus = f.errors.length === 0 ? "ok" : f.okUrls === 0 ? "failed" : "partial";
      return { id: s.id, status, errors: f.errors };
    });

  const quotes: QuoteResult[] = [];
  for (const p of cat.practices)
    for (const q of p.quotes) {
      if (opts.only && q.source !== opts.only) continue;
      const f = fetched.get(q.source);
      let status: QuoteStatus;
      if (!f) status = "skipped";
      else if (f.text.includes(normaliseForMatch(q.text))) status = "ok";
      else status = f.errors.length > 0 ? "unverified" : "changed";
      quotes.push({ practice: p.id, source: q.source, section: q.section, text: q.text, status });
    }

  const counts: Record<QuoteStatus, number> = { ok: 0, changed: 0, unverified: 0, skipped: 0 };
  for (const q of quotes) counts[q.status]++;
  const infra = sources.some((s) => s.status === "failed" || s.status === "partial") || counts.ok + counts.changed === 0;
  const exitCode = infra ? 2 : counts.changed > 0 ? 1 : 0;
  return { sources, quotes, counts, exitCode };
}
