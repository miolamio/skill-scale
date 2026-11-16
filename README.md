# skill-scale

skill-scale checks a Claude Code Agent Skill (a folder with a `SKILL.md`) against a catalogue of 123 practices taken from Anthropic's published guidance. Each practice is scored one criterion at a time. Every result carries the evidence from your files, the quotes behind the rule (with their source) and a hint for fixing it. By default it runs offline and deterministically: no model is called and nothing is sent anywhere. An opt-in `--judge` layer has a model (through your own `claude` CLI login) score the practices that a file scan cannot decide, and `--format html` writes a self-contained review page. With `--judge --format html`, one more model call (the advisor) turns the low scores into proposed edits.

There is no overall score. The report gives a mean per area with its coverage ("2 of 11 scored"), so a high mean on two criteria is not mistaken for a verdict on the skill.

Contents: [Install](#install) | [Quick start](#quick-start) | [Examples](#examples) | [Options](#options) | [Exit codes](#exit-codes) | [What is checked](#what-is-checked) | [Catalogue](#the-catalogue) | [Judge](#judge---judge) | [HTML report and advisor](#html-report---format-html) | [Privacy](#privacy) | [Requirements](#requirements) | [Development](#development) | [License](#license)

## Install

Requires Node 24 or later. The package is not on the npm registry yet (publishing is planned), so install from a release tarball or from source.

From a tarball (`skill-scale-0.4.0.tgz`). The `yaml` dependency is bundled, so this works with no network:

    npm install -g ./skill-scale-0.4.0.tgz
    skill-scale --version

or run it without installing:

    npx ./skill-scale-0.4.0.tgz ./path/to/my-skill

From source:

    git clone https://github.com/miolamio/skill-scale.git
    cd skill-scale
    npm ci
    npm run build
    node dist/bin.js --version

`npm pack` builds the project and writes `skill-scale-<version>.tgz`.

## Quick start

Point it at the folder that contains `SKILL.md`:

    skill-scale ./path/to/my-skill                          # offline console report
    skill-scale ./path/to/my-skill --format json --out report.json
    skill-scale ./path/to/my-skill --format html            # writes ./<skill-name>.skill-scale.html
    skill-scale ./path/to/my-skill --judge                  # adds model scoring; billed, see below

From a source checkout, replace `skill-scale` with `node dist/bin.js`. The tool only reads the skill folder.

## Examples

The outputs below come from real runs of version 0.4.0 (catalogue revision 5) on a public skill folder, copied to `./pr`. Only the `Skill:` path line is shortened.

### Console report (default)

    $ skill-scale ./pr
    skill-scale 0.4.0 | catalogue r5 | profile claude-code
    Skill: ./pr

    Scored 12 of 123 practices (mechanical only). Not a full assessment: the judgement and live layers did not run.

    Areas (mean of scored criteria, 0 to 3)
      META   ###############      3.00   5 of 6 scored
      DESC   ###############      3.00   2 of 11 scored
      TRIG   ---------------  no score   0 of 7 scored, 2 for the checklist
      BODY   ###############      3.00   1 of 23 scored
      STRUCT ###############      3.00   2 of 7 scored
      SCRIPT ---------------  no score   0 of 10 scored
      SAFE   ###############      3.00   1 of 4 scored, 2 for the checklist
      TEST   ...............      0.00   1 of 16 scored, 5 for the checklist
      PROC   ---------------  no score   0 of 0 scored, 9 for the checklist
      MAINT  ---------------  no score   0 of 5 scored, 3 for the checklist
      FIT    ---------------  no score   0 of 4 scored, 2 for the checklist

    Blockers
      No blockers.

    Lowest scores
      0 TEST-02 Ship an eval suite of at least three cases
          found 0 eval cases under evals/; at least 3 are expected
          Fix: Add eval cases under evals/ until there are at least 3, with prompts that should and should not trigger the skill.

    Not scored: 79 not run, 2 contested, 7 not applicable, 23 process items for the checklist.
    Stale, unconfirmed: 1 of the scored practices (STRUCT-07).
    (anchors and fix hints are our inference, not Anthropic's words)

Exit code 0: no blockers and something scored. A skill with a blocker lists it, with file and line. This skill is named `Bad_Skill` and checked against the stricter profile:

    $ skill-scale ./Bad_Skill --profile portable
    ...
    Blockers
      META-01 Name length and characters: the name may only use lowercase letters, digits and single hyphens, with no hyphen at either end  [SKILL.md:2]
    ...

Exit code 1.

### JSON (`--format json`)

    skill-scale ./pr --format json --out report.json

The top-level keys are `schema_version`, `tool`, `catalogue`, `profile`, `model`, `layers`, `skill`, `exit_code`, `summary`, `sources` and `records`. `records` has one entry per practice (123), whatever its state. `summary` holds the counts (`total`, `scored`, `not_run`, `contested`, `process`, `not_applicable`, `experimental`), the per-area means and coverage, and the blockers. Trimmed output for this skill:

    "summary": { "total": 123, "scored": 12, "experimental": 0, "scored_by": ["mechanical"],
                 "layers_not_run": ["judgement", "live"], "not_run": 79, "not_applicable": 7,
                 "contested": 2, "process": 23, "areas": [ { "area": "META", "mean": 3, "scored": 5, "assessable": 6, ... }, ... ] }

    one record:
    { "id": "META-01", "area": "META", "title": "Name length and characters",
      "strength": "statement", "status": "scored", "score": 3,
      "anchors": { "0": "The name is longer than 256 characters, ...", "3": "The name is present where required, ..." },
      "fix_hint": "Shorten the name to at most 256 characters; ...",
      "quotes": [ { "text": "Must be 1-64 characters", "source": "SPEC", "section": "name field", "older": false }, ... ],
      "evidence": [] }

### HTML review page (`--format html`)

    skill-scale ./pr --format html --out report.html

This writes one file (26 KB for this skill). It has no JavaScript and all CSS is inline. Recommendations are on the left; the full `SKILL.md` is pinned on the right with line anchors, and the lines cited by a finding are highlighted. Without `--out`, the page is written to `./<skill-name>.skill-scale.html` and the path is printed. See [HTML report](#html-report---format-html) for details.

### With the judge and the advisor

    skill-scale ./my-skill --judge --repeat 3
    skill-scale ./my-skill --judge --format html --out report.html

These call a model and cost money, so they are not run in the examples above. See [Judge](#judge---judge).

## Options

    skill-scale <skill-folder> [options]
    skill-scale catalog verify [--source ID] [--json]
    skill-scale --version | --help

| Option | Values | Default | Meaning |
|---|---|---|---|
| `--profile` | `claude-code`, `portable` | `claude-code` | Which limits and rules apply (see below). The report prints it on the first line. |
| `--format` | `console`, `json`, `html` | `console` | Report format. |
| `--out FILE` | path | none | Write the report to a file. For `console` and `json` the file holds JSON and stdout output is unchanged; for `html` it holds the page and nothing is printed. With `--format html` and no `--out`, the page goes to `./<skill-name>.skill-scale.html`. |
| `--plugin` | `auto`, `yes`, `no` | `auto` | Whether naming rules for plugin skills apply. `auto` treats the skill as a plugin skill when `.claude-plugin/plugin.json` exists in the skill folder or any parent. |
| `--judge` | flag | off | Have a model score the judgement practices through the `claude` CLI. Billed. |
| `--repeat N` | 1 to 5 | 1 | Number of judge calls, run in parallel. The median score is used; a spread of 2 or more marks the practice `unstable`. Needs `--judge`. |
| `--model ID` | model id | `claude-sonnet-5-5` | Model for the judge and advisor. Model ids containing "haiku" are refused. Needs `--judge`. |
| `--version`, `--help` | | | Print the version or the usage text. |

`catalog verify` has its own options: `--source ID` limits the check to one source, `--json` prints JSON.

Profiles:

- `claude-code`: the limits and rules of Claude Code, for example a description listing of 1,536 characters.
- `portable`: the Agent Skills specification and Anthropic's authoring guide, for example at most 1,024 characters for the description, a name of at most 64 characters, and a name that matches the folder name.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | No blockers, and at least one practice scored. |
| 1 | At least one blocker: a finding with a stated effect on loading, a `must` practice for the active profile scoring 0 (a judged 0 blocks like any other), or a security finding. |
| 2 | Bad arguments, unknown profile or format, missing folder or `SKILL.md`, a loose `.md` file that is a symlink or over 1 MB (refused, never read), invalid catalogue, or nothing scored. Also a refused model id, `--repeat` or `--model` without `--judge`, or `--judge` where no call produced a usable answer (for example `claude` is not installed or not logged in). A partial infrastructure failure is reported as `not_run` rows, not exit 2. |

`catalog verify` uses its own codes: 0 every checked quote is still an exact substring of its source; 1 at least one quote changed; 2 a source could not be fetched or was only partly fetched, or nothing was verified (2 wins over 1).

## What is checked

Practices are grouped into 11 areas: META (name and frontmatter), DESC (description), TRIG (triggering), BODY (SKILL.md body), STRUCT (file layout and references), SCRIPT (bundled scripts), SAFE (safety), TEST (evaluation), PROC (process), MAINT (maintenance) and FIT (fit for purpose).

Every practice gets exactly one record in every report, in one of these states: `scored`, `not_run`, `process`, `contested` or `not_applicable`. Nothing is dropped.

- **Mechanical practices (17)** are decided by scanning the folder: name rules, frontmatter, description presence and length, `SKILL.md` length, reference depth and links, a table of contents on long reference files, a stray README, hardcoded credentials, and eval cases. They are scored 0 or 3, never 1 or 2. Per profile, 12 to 17 apply to a given skill. This is all that runs without `--judge`.
- **Judgement practices** need reading and understanding, such as whether a description says when to use the skill. They are `not_run` unless `--judge` is given. With `--judge`, the qualified ones (not experimental, not contested, applicable to the profile; 36 catalogue-wide, fewer per profile) are scored 0 to 3 by a model.
- **Live practices** need a run of the skill with a model. They are always `not_run`. The live layer is not built.
- **Process practices (23)** describe how a skill is developed, and appear as a checklist.
- **Contested practices** are ones on which official sources disagree. They are shown with the conflicting quotes and not scored.
- **Experimental practices (23)**: their authored anchors failed an agreement test on real skills. They are shown but not counted in the scored total, in area means or in blockers, and they are not scored with or without `--judge`.

Anchors (what a 0 and a 3 look like) and fix hints are the authors' inference, not Anthropic's words, and the report says so. Quotes and their sources are Anthropic's, unless the source is one of the few third-party ones listed in `catalog/sources.yaml`.

### Security findings

A check marked `security` with a named risk blocks in every profile, whatever the practice's strength, unless the practice is experimental. Today that is SAFE-02, hardcoded credentials (risk `credential_exposure`). It matches vendor token formats (AWS, GitHub, Anthropic, OpenAI-style, Slack token and webhook, GCP, Stripe live, HuggingFace, npm, GitLab, SendGrid) and PEM private keys. A token body must pass an entropy check and must not be a placeholder (a repeated character, a run of `x` or `0`, or words such as EXAMPLE, your, here). A private key counts only when the BEGIN header is followed by at least 64 base64 characters. A matched secret is never printed. The console lists these under "Security blockers" and JSON under `summary.security_blockers`.

To mark a deliberate test fixture, put `skill-scale: ignore SAFE-02` in a comment on the same line or the line above (any comment syntax, for example `<!-- skill-scale: ignore SAFE-02 -->`). The marker covers that line and the next and must name the whole rule ID. A suppressed finding does not block, but it is listed, in the console under "Suppressed security findings" and in JSON under `summary.suppressed_security`.

### Known gaps

- SAFE-02 uses public token formats that we chose; no source lists patterns.
- The 5,000-token body advice is not checked (no tokenizer).
- Enterprise install locations are not detected.
- Judge scores are not validated against human labels. Treat them as an opinion.
- The live layer, published validation and a wrapper skill are not built.

## The catalogue

The catalogue lives in `catalog/` and ships in the package. It records, for each practice: an id, area, strength, anchors for what a 0 and a 3 look like, a fix hint, which layer assesses it, and the quotes behind it, each with its source, section and whether newer guidance has superseded it. It was built from a research file of Anthropic's authoring guide, the Agent Skills specification, Claude Code documentation and changelog, and a few engineering posts and papers. Sources are listed with their URLs in `catalog/sources.yaml`. This repository is revision 5.

`catalog/practices.yaml`, `sources.yaml`, `meta.yaml` and `load-facts.yaml` are generated; do not edit them by hand. Authored anchors, fix hints and overrides are in `catalog/authored/`.

### Keeping quotes honest: `catalog verify`

    skill-scale catalog verify [--source ID] [--json]

Fetches each source over HTTP and checks that every catalogue quote is still an exact substring of the page (after folding typographic quotes, Markdown markup and whitespace). It prints one line per source (`OK`, `PARTIAL`, `FAILED`, `SKIPPED`), then the quotes that changed, then a count. It never edits the catalogue; a person decides what a changed quote means. This is the only command that uses the network without `--judge`.

Last full run (2026-11-06): 292 quotes verified, 1 changed, 39 skipped, 0 unverified. Skipped: the PDF source (no text extraction) and two repository sources (quotes come from single files in repository trees). The changed quote (PROC-01) is on the full text of a paper but no longer on its abstract page.

## Judge (`--judge`)

    skill-scale ./my-skill --judge [--repeat 3] [--model claude-opus-5-5]

Requirements: the `claude` CLI (Claude Code) on `PATH` and logged in. skill-scale runs `claude -p` and uses your login; it does not read an API key itself. If `claude` is missing or not logged in, and no call gives a usable answer, the exit code is 2.

One call per skill per repeat scores every qualified judgement practice. The call is isolated: no tools, its own system prompt, strict MCP config, no slash commands, no session persistence, and a fresh empty temporary directory that is removed afterwards.

- **Cost and time.** In the M2 spike on Sonnet, one call cost $0.08 to $0.23 and took 18 to 24 seconds per skill. Opus costs about 2.5 times as much. Skills over 150 KB were not measured; a timeout becomes `not_run`.
- **`--repeat N`** runs N calls in parallel and takes the median. A spread of 2 or more marks the practice `unstable`. Use `--repeat 3` when the result gates anything: a single run differed from the 3-run median on 7% of scores. With one run the report says stability was not measured.
- **Evidence is checked.** Every judged practice carries a verbatim quote, file, line and reason. The code checks that the quote occurs on the cited line or within 2 lines. A practice that fails is retried once, then becomes `not_run` with a reason: `unsupported` (no verified evidence) or `infra` (the call failed, or the answer had no result for it). A failure is never scored as 0.
- **Prompt injection.** A skill that tries to instruct the judge is listed under "Judge notes" in the console and in `judge.injection` in the JSON. It is not a blocker.
- **Limit.** A quote is checked to exist near the cited line, not to support the score.

## HTML report (`--format html`)

One file, no JavaScript, all CSS inline. The only external resource is a Google Fonts stylesheet; offline, the page falls back to system fonts. All skill, judge and advisor text is HTML-escaped. Exit codes are the same as for the other formats.

- **Without `--judge`**: a "Findings" list, one card per practice that scored 0 to 2, blockers first. Each card has the finding, an excerpt of the cited line, up to two Anthropic quotes with a link to the source page, and the fix hint. No model is called.
- **With `--judge`**: after the judge, one more isolated call (the advisor) runs through the same runner and model. It gets the skill files, every practice that scored 0 to 2, and the name and description of up to 30 sibling skills in the parent folder. It returns grouped recommendations with proposed text, and findings it sets aside with a reason. It costs about $0.10 extra on Sonnet.
- **The advisor's answer is verified in code.** Unknown practice ids and out-of-file line ranges are dropped. A diff whose removed lines are not in the file keeps its recommendation but loses the change ("Proposed text failed verification against the file"). A new file path must be relative, without `..`, and must not already exist. Quotes on a recommendation come only from the catalogue; the model never supplies quote text.
- If the advisor call fails, the page shows the findings with the judge scores and says proposed changes are unavailable. The exit code does not change.
- The JSON report does not include the advisor output.

## Privacy

- Without `--judge`, nothing leaves your machine. `catalog verify` is the only command that fetches pages (the public documentation sources).
- With `--judge`, the text files of the skill folder are sent to Anthropic through your `claude` CLI login, under the terms of that account.
- With `--judge --format html`, the advisor call also sends the name and description (frontmatter only) of up to 30 sibling skills found in the parent folder of the skill. If the parent folder holds private skills, their names and descriptions are included.
- Opening the HTML page makes your browser request fonts from Google Fonts. Remove the `<link>` tags from the page if you do not want that; it still renders with system fonts.
- The `claude` child process inherits your environment unchanged; skill-scale does not modify your auth variables.

## Requirements

- Node 24 or later (`engines` in `package.json`; `.nvmrc` says 24).
- For `--judge` and the advisor: the `claude` CLI on `PATH`, logged in.
- Runtime dependency: `yaml` (bundled in the tarball).

## Development

    npm ci
    npm run typecheck
    npm test                 # offline, no model calls
    npm run build
    npm run catalog:build    # regenerate catalog/*.yaml from the research file (maintainers only)
    npm run catalog:check    # confirm the committed catalogue is current (maintainers only)
    npm run judge:smoke -- <skill-a> <skill-b>   # manual, spends money: runs the real claude runner

`catalog:build` and `catalog:check` read `.dev/research/anthropic-best-practices.md`, which is not in the repository, so they do not run in a fresh clone. Tests and the CLI never read it.

Further reading: the design spec in [`docs/design.md`](docs/design.md).

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT, see [LICENSE](LICENSE).

Catalogue quotes are short excerpts from the sources named in `catalog/sources.yaml`, kept for attribution and verification; they remain the property of their authors.
