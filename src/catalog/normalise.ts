/**
 * Normalisation used when comparing a catalogue quote with fetched source text.
 * Fold typographic quotes, reduce links and images to their text, drop Markdown escapes,
 * backticks and emphasis markers, collapse whitespace. Case and wording are never touched.
 *
 * Stars are only removed when they are emphasis markup, so that a real change cannot be hidden:
 *  - a line-leading `* ` is a list bullet and is dropped;
 *  - a run of 1-3 stars that opens a span (next character is not a space) and is closed by an equal run
 *    after non-space content is emphasis and is dropped wherever it sits, also inside a word (`**a**b`);
 *  - every other star is kept: `2*3`, `a * b`, `a ** b`, an unpaired glob such as `**` plus a path.
 * Stars inside inline code and escaped stars (`\*`) are literal. A star after an escaped backslash is markup.
 * Not handled: two globs in plain prose that happen to pair up lose their stars.
 * Underscores are never removed (`snake_case`, `_x_`).
 */
const LITERAL_STAR = "\u0001";

const BULLET = /^[ \t]*\*[ \t]+/gm;
const PAIRED = /(?<!\*)(\*{1,3})(?!\*)(\S|\S[^\n]*?\S)\1(?!\*)/g;

export function normaliseForMatch(s: string): string {
  return s
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/!?\[([^\]]*)\]\([^)\s]*\)/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!>|~"'<])/g, (_, c: string) => (c === "*" ? LITERAL_STAR : c))
    .replace(/`([^`]*)`/g, (_, code: string) => code.replace(/\*/g, LITERAL_STAR))
    .replace(BULLET, "")
    .replace(PAIRED, "$2")
    .replace(/`/g, "")
    .replace(new RegExp(LITERAL_STAR, "g"), "*")
    .replace(/\s+/g, " ")
    .trim();
}
