# Changelog

## 0.5.0 — 2026-11-17

### Changed
- Console report in a terminal: a compact `◢◤` header, colour, Unicode bars (`█░`), `✗`, `▲` and `✓` marks, and long lines wrapped to the terminal width (60 to 100 columns, 80 when unknown). Same sections, same facts, same order as before.
- `--help` and `--version` show an ASCII logo above their text in a terminal.
- Pretty output is on when stdout is a terminal, `NO_COLOR` is unset or empty and `TERM` is not `dumb`; `FORCE_COLOR` set to anything but empty or `0` turns it on anywhere. Only the 16 basic ANSI colours, bold and dim are used.

### Unchanged
- Output through a pipe, redirection or CI is byte for byte what 0.4.0 printed, including `--version` and `--help`. JSON, HTML, exit codes and scoring are untouched. No new dependencies.

## 0.4.0 — 2026-11-16

### Added
- `--format html`: a self-contained review page (no JavaScript, inline CSS, Google Fonts with system fallbacks). Findings with excerpts, Anthropic quotes with source links and fix hints on the left; the full SKILL.md with line anchors and highlighted cited lines on the right. Written to `--out`, or to `./<skill-name>.skill-scale.html` with the path printed. All skill, judge and advisor text is escaped.
- Advisor call: with `--judge --format html`, one extra isolated call through the same runner and model turns the low scores into grouped recommendations with proposed text, and sets aside findings that would not improve the skill. Sibling skills in the parent folder (name and description, up to 30) give it real neighbours to name. Its answer is checked in code (ids, line ranges, verbatim `remove` lines, new file paths); quotes come only from the catalogue. Its cost and time are added to the judge summary. If it fails, the page falls back to the findings with a note; the exit code is unchanged.
- Footer on every page: `skill-scale` linking to https://github.com/miolamio/ with the version.

### Fixed
- Advisor validation: `remove` lines must match one contiguous, ordered block of the file, and the page labels the change with that block's start line. Before, the lines were checked as a set, so unrelated lines (or any blank line) passed.

### Project
- MIT licence. `package.json` points at https://github.com/miolamio/skill-scale. README rewritten for GitHub. The design spec moved to `docs/design.md`. GitHub Actions CI added.

### Unchanged
- Console and JSON output, exit codes, and the offline default. The JSON does not carry advisor output.


## 0.3.1 — 2026-11-11

### Changed
- Packaged for npm: the package is no longer private, `yaml` is bundled (`bundleDependencies`), and `npm pack` builds first (`prepack`). The resulting `.tgz` runs with no network: `npx ./skill-scale-0.3.1.tgz <skill-folder>`.
- README starts with a quick start (npx, offline tarball, global install).

## 0.3.0 — 2026-11-10

### Added
- `--judge`: scores the qualified judgement practices with one isolated `claude -p` call per skill (SKM-11). Each judged practice carries a verbatim quote, file, line and reason; quotes are checked to occur on or within 2 lines of the cited line, retried once, then `not_run` (`unsupported`). Infrastructure failures are `not_run`, never 0.
- `--repeat N` (1 to 5, default 1): median score, `unstable` when scores spread by 2 or more; `--model` (default `claude-sonnet-5-5`; Haiku models are refused).
- Report: judge model, runs, calls, cost and duration; judge notes for skills that try to instruct the reviewer.
- JSON (schema_version stays 1, all additive): `judge` block, `records[].judge`, `layers.judgement: true` when judged, `model`.
- `npm run judge:smoke`: manual check of the real runner on real skills (not in CI).

### Changed
- Exit code 2 when `--judge` is given and no call produced a usable answer, and for a refused model or `--repeat`/`--model` without `--judge`.
- Spec section 7 describes the shipped design (opt-in, one call per skill).
- The `not_run` reason of a judgement practice reads "needs the judgement layer (run with --judge)".

### Unchanged
- Without `--judge` the output and exit codes are those of 0.2.0, offline and deterministic. Experimental practices are not judged.

### Not included
- SKM-25 script extractor, SKM-26 re-qualification, the discrimination harness of spec 10.3, the live layer and HTML report.

## 0.2.0 — 2026-11-09

### Changed (may break CI that relies on exit codes)
- A security finding now blocks in every profile, whatever the practice's strength (SKM-34). SAFE-02 (hardcoded credentials) is the first such check; a skill with a real-looking key exits 1 under both `claude-code` and `portable`. Experimental practices never block.
- A loose `.md` file that is a symlink or over 1 MB is refused with exit 2 and never read (SKM-30).
- An undeclared `effect` from a check is a contract error and exits 2 instead of being dropped (SKM-31).

### Added
- JSON: `summary.security_blockers` (id, risk, title, reason, file, line), separate from `summary.blockers`; `summary.suppressed_security` for findings silenced inline. `schema_version` stays 1: both fields are additive.
- SAFE-02 rules for GCP API keys, Stripe live keys, HuggingFace, npm, GitLab PATs, SendGrid and Slack webhook URLs, written after gitleaks 5f6ec56 (SKM-37).
- Inline marker `skill-scale: ignore SAFE-02` suppresses a finding on its own line and the next; suppressed findings are listed in the report, never hidden.
- CI on the docker runners (Node 24.22.1): typecheck, tests, build (SKM-10).

### Fixed
- SAFE-02 false positives: header-only private-key strings, placeholder and repeated-character bodies. On 1,466 real public skills it now raises 0 false blockers (was 6) (SKM-36).
- SAFE-02 false negatives: OpenAI `sk-proj-` keys and PEM keys wrapped in JSON (`\n` escapes), YAML or blockquotes are detected.
- Quote verifier normalisation: `*` and backticks are stripped only as markup, `![alt](x)` keeps its alt text, touching inline tags no longer join words (SKM-32).
- A dangling symlink argument reports "broken symlink" instead of "no such folder".

## 0.1.0 — 2026-11-06

First release (M1, offline scale): 17 mechanical practices scored 0–3 against catalogue revision 5, judgement and live practices reported as `not_run`, console and JSON reports, `catalog check` and `catalog verify`.
