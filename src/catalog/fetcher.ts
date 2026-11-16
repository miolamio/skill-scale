export type Fetcher = (url: string) => Promise<string>;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "\u2019", lsquo: "\u2018", rdquo: "\u201D", ldquo: "\u201C" };

/**
 * Tag separator rule. Block and unknown tags become a space. Inline tags become nothing, so
 * `wor<b>d</b>` stays `word` and punctuation after a tag gets no stray space. One exception:
 * a closing inline tag that directly touches the next opening inline tag (`<b>one</b><b>two</b>`)
 * becomes a space, because those are separate words. `span` is left out of that exception since
 * syntax highlighters split code into touching spans (`<span>foo</span><span>(</span>`).
 * A word styled in two touching pieces (`<b>wor</b><i>d</i>`) is split; that can only give a
 * false "changed", which a person then reviews.
 */
const WORD_INLINE = "a|code|em|strong|b|i|u|mark|kbd|abbr|sub|sup";

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(new RegExp(`</(?:${WORD_INLINE})\\b[^>]*>(?=<(?:${WORD_INLINE})\\b)`, "gi"), " ")
    .replace(/<\/?(a|code|em|strong|b|i|u|span|mark|kbd|abbr|sub|sup)\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[ \t\r\f\v]+/g, " ");
}

/** Implementation safeguards, not rules about skills. */
const TIMEOUT_MS = 30_000;
const MIN_TEXT_CHARS = 200;

export const httpFetcher: Fetcher = async (url) => {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "user-agent": "skill-scale-catalog-verify", accept: "text/html,text/markdown,text/plain" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.text();
  const type = res.headers.get("content-type") ?? "";
  const text = type.includes("html") ? htmlToText(body) : body;
  if (text.trim().length < MIN_TEXT_CHARS) throw new Error("no readable text (page may need a browser to render)");
  return text;
};
