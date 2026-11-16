/** Inline stylesheet of the HTML report (from the approved prototype). No script; the only external resource is the Google Fonts stylesheet, with system fallbacks. */
export const REPORT_CSS = `
:root {
  --paper: #f5f6f4; --sheet: #ffffff; --ink: #1d2422; --ink-2: #56605c; --rule: #d9ddd9; --accent: #1f6f66;
  --s0: #b8432f; --s0-bg: #f6dfd8; --s1: #a8690f; --s1-bg: #f6e8cf; --s2: #5f7a2a; --s2-bg: #e6eed4; --s3: #1f6f66; --s3-bg: #d5ebe7;
  --add: #e3f1ec; --add-ink: #17594f; --del: #f8e4df; --del-ink: #8f3322; --hl: #fbf1d4; --target: #f3d98b;
  --f-head: "IBM Plex Sans Condensed", "Arial Narrow", system-ui, sans-serif;
  --f-body: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --f-mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --paper: #131817; --sheet: #1a201f; --ink: #e3e8e5; --ink-2: #9aa6a1; --rule: #2e3735; --accent: #5fbfb2;
    --s0: #ef8a74; --s0-bg: #43231c; --s1: #e2ad55; --s1-bg: #3f3018; --s2: #a9c46a; --s2-bg: #2c3519; --s3: #5fbfb2; --s3-bg: #17352f;
    --add: #15322c; --add-ink: #8fd6c8; --del: #3a201a; --del-ink: #f0a08e; --hl: #2f2a17; --target: #5a4a17;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --paper: #131817; --sheet: #1a201f; --ink: #e3e8e5; --ink-2: #9aa6a1; --rule: #2e3735; --accent: #5fbfb2;
  --s0: #ef8a74; --s0-bg: #43231c; --s1: #e2ad55; --s1-bg: #3f3018; --s2: #a9c46a; --s2-bg: #2c3519; --s3: #5fbfb2; --s3-bg: #17352f;
  --add: #15322c; --add-ink: #8fd6c8; --del: #3a201a; --del-ink: #f0a08e; --hl: #2f2a17; --target: #5a4a17;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { background: var(--paper); color: var(--ink); font: 15px/1.55 var(--f-body);
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.wrap { max-width: 1240px; margin: 0 auto; padding-block: 36px 64px; display: grid; gap: 32px; }
h1, h2, h3 { font-family: var(--f-head); text-wrap: balance; margin: 0; }
h1 { font-size: 2.1rem; font-weight: 700; line-height: 1.1; }
h2 { font-size: 1.3rem; font-weight: 600; }
h3 { font-size: 1.08rem; font-weight: 600; }
p { margin: 0; max-width: 70ch; }
a { color: var(--accent); }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.label { font: 600 0.7rem/1.2 var(--f-head); text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-2); }
.mono { font-family: var(--f-mono); font-size: 0.82rem; }
header { display: grid; gap: 12px; }
.facts { display: flex; flex-wrap: wrap; gap: 6px 24px; font-size: 0.88rem; color: var(--ink-2); }
.facts b { color: var(--ink); font-weight: 500; font-variant-numeric: tabular-nums; }
.cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 440px); gap: 28px; align-items: start; }
.main { display: grid; gap: 22px; min-width: 0; }
aside { position: sticky; top: calc(env(safe-area-inset-top, 0px) + 12px); max-height: calc(100vh - 24px); display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 8px; min-width: 0; }
.summary { width: 100%; border-collapse: collapse; background: var(--sheet); border: 1px solid var(--rule); font-size: 0.9rem; }
.summary td { padding: 8px 10px; border-bottom: 1px solid var(--rule); vertical-align: baseline; }
.pri { display: inline-block; font: 600 0.68rem/1 var(--f-head); text-transform: uppercase; letter-spacing: 0.06em; padding: 4px 6px; border-radius: 3px; white-space: nowrap; }
.p-high { background: var(--s0-bg); color: var(--s0); }
.p-medium { background: var(--s1-bg); color: var(--s1); }
.p-low { background: var(--s2-bg); color: var(--s2); }
.rec, .rej { background: var(--sheet); border: 1px solid var(--rule); padding: 18px 20px; display: grid; gap: 10px; min-width: 0; }
.rhead { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.chip { font: 500 0.76rem/1 var(--f-mono); padding: 4px 7px; border-radius: 3px; cursor: help; }
.chip b { font-weight: 600; margin-right: 2px; }
.s0 { background: var(--s0-bg); color: var(--s0); } .s1 { background: var(--s1-bg); color: var(--s1); }
.s2 { background: var(--s2-bg); color: var(--s2); } .s3 { background: var(--s3-bg); color: var(--s3); }
.code { display: grid; grid-template-columns: 3ch minmax(0, 1fr); column-gap: 12px; background: var(--paper); border: 1px solid var(--rule); padding: 8px 10px; font: 0.78rem/1.6 var(--f-mono); overflow-x: auto; }
.code code, .full code { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
.ln { color: var(--ink-2); text-align: right; text-decoration: none; font-variant-numeric: tabular-nums; }
.ln:hover { color: var(--accent); }
blockquote { margin: 0; padding: 8px 12px; border-left: 3px solid var(--accent); background: var(--paper); display: grid; gap: 4px; }
blockquote p { font-size: 0.92rem; }
blockquote cite { font-style: normal; font-size: 0.8rem; }
blockquote .sec { color: var(--ink-2); }
.diff, .file { margin: 0; padding: 8px 0; background: var(--paper); border: 1px solid var(--rule); font: 0.78rem/1.6 var(--f-mono); overflow-x: auto; }
.diff span { display: block; padding: 0 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
.diff i { font-style: normal; display: inline-block; width: 1.4ch; color: var(--ink-2); user-select: none; }
.da { background: var(--add); color: var(--add-ink); }
.dr { background: var(--del); color: var(--del-ink); text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--del-ink) 45%, transparent); }
.dc { color: var(--ink-2); }
.file { padding: 10px 12px; white-space: pre; }
.where { font-size: 0.82rem; color: var(--ink-2); }
.where code { font-family: var(--f-mono); }
.note { font-size: 0.86rem; color: var(--ink-2); }
.full-wrap { background: var(--sheet); border: 1px solid var(--rule); overflow: auto; min-height: 0; }
.full { display: grid; grid-template-columns: 3.5ch minmax(0, 1fr); column-gap: 10px; padding: 8px 10px; font: 0.74rem/1.55 var(--f-mono); }
.full .hl { background: var(--hl); }
.full .ln { scroll-margin-top: 80px; }
.full .ln:target, .full .ln:target + code { background: var(--target); }
.aside-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.rejs { display: grid; gap: 14px; }
.foot { font-size: 0.86rem; color: var(--ink-2); display: grid; gap: 6px; }
@media (max-width: 900px) {
  .cols { grid-template-columns: minmax(0, 1fr); }
  aside { position: static; max-height: none; }
  .full-wrap { max-height: 70vh; }
}
@media (max-width: 520px) { h1 { font-size: 1.65rem; } .rec, .rej { padding: 14px; } }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
.others { margin: 0; padding-left: 1.2em; display: grid; gap: 6px; font-size: 0.9rem; }
.others .chip { margin-right: 6px; }
.warn { border-left: 3px solid var(--s1); padding: 6px 10px; background: var(--s1-bg); color: var(--ink); max-width: none; }
.foot a { width: fit-content; }
`;
