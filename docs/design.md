# Skill Scale: design

Status: draft for user review. Date: 2026-11-05. Working name: `skill-scale`.

## 1. Goal

Take any Claude Code skill, score it on each best practice separately, and show where it is weak and why. Each score carries its evidence and a hint for fixing it.

Automatic fixing comes after this version, once the scale has shown that it finds real problems.

## 2. Decisions already made

| Decision | Choice |
|---|---|
| Architecture | Deterministic CLI core plus a thin Claude Code skill wrapper |
| Score | 0 to 3 per criterion |
| Layers | Reading the skill by default; live runs only with an explicit flag |
| Recency | The latest version of an official artefact counts as current unless superseded. The 2026-05-05 cutoff applies to independent sources and to official posts that have been replaced |
| Precedence | Claude Code docs and changelog (newest first) > Claude platform docs > Agent Skills spec > other Anthropic material > independent sources. Independent sources never override official ones |
| Base | Not a skillgrade fork. Reuse selected ideas and MIT code only |
| Language | English is primary; the system is multilingual |

Evidence lives in `.dev/research/`: `anthropic-best-practices.md` (catalogue revision 4), `skillgrade-core.md`, `skillgrade-prs.md`, `skillgrade-forks.md`, `official-landscape.md`, `script-read-100-lines.md`.

## 3. Architecture

```
skill folder ──> loader ──> mechanical checks ─┐
                    │                          │
catalogue ──> profile filter ──> judge (claude -p) ──> scorer ──> console / HTML / JSON
                    │                          │
                    └──> live runner (--live) ─┘
```

| Unit | Purpose | Depends on |
|---|---|---|
| `catalog` | Load and validate practice data; verify quotes against sources | YAML files only |
| `loader` | Read a skill folder into a model: frontmatter, body with line numbers, files, references | Filesystem |
| `checks` | One pure function per mechanical check: skill model in, findings out | `loader` |
| `judge` | Ask a model to score judgement criteria; verify the evidence | `claude` CLI |
| `live` | Trigger and outcome runs; parse `stream-json`; statistics | `claude` CLI |
| `scorer` | Turn check, judge and live results into criterion records and area profiles | None |
| `report` | Console, HTML and JSON output, with localised strings | `scorer` output |
| `skills/skill-scale/` | Skill that runs the CLI and walks the user through the result | CLI |

Stack: TypeScript on Node 24, with a committed lockfile and `tsc` and tests in CI. skillgrade's build broke through dependency drift without a lockfile, so the lockfile is required.

## 4. Catalogue

`catalog/practices.yaml` is built from revision 4 of the research file. Rules are data, so adding a practice needs no core change, unless it needs a new mechanical check.

```yaml
- id: DESC-03
  area: DESC
  title: Say what the skill does and when to use it
  strength: directive          # must | directive | suggestion | statement, as worded by the source
  profiles: [claude-code, portable]
  assess: [mechanical, judgement]
  assessable_from: artifact    # artifact | run | process
  freshness: recent            # recent | undated-live | stale-unconfirmed
  contested: false
  quotes:
    - text: "..."              # verbatim
      source: BP
      section: Writing effective descriptions
  anchors:                     # our own inference; never presented as Anthropic's words
    0: No description of capability or trigger
    1: Capability only
    2: Capability and a vague trigger
    3: Capability and a trigger naming user situations
  fix_hint: Add a "Use when ..." sentence naming what the user would say.
```

- `strength` is derived from the primary quote and recorded with the deciding word. `profile_rules` overrides it where a practice differs by profile, as DESC-01, DESC-02 and META-05 do.
- `catalog/sources.yaml` holds the source register: URL, tier, version evidence.
- `skill-scale catalog verify` re-fetches sources and reports quotes that are no longer exact substrings. A changed quote is reported, never auto-updated, so a person decides what a doc change means. This keeps the catalogue on the latest sources over time.
- Quotes stay short and always cite their URL. Nothing is copied from `mgechev/skills-best-practices`, which has no licence.

**Size.** 123 practices: 81 assessable from the skill's files, 18 only from a run, 24 only from the author's process.

## 5. Scoring

Every practice that applies to the profile yields exactly one record:

| State | Meaning | Counts in area score |
|---|---|---|
| `0`–`3` | Scored against the anchors | Yes, unless `experimental` |
| `not_run` | Needs a layer that did not run, or the layer failed | No |
| `not_applicable` | The practice has no subject here, such as script rules for a skill with no scripts | No |
| `contested` | Official sources disagree; both quotes shown; a score may be shown for information | No |
| `process` | Concerns authoring, invisible in a skill; goes to the checklist | No |

Rules:

- **Purely mechanical checks** give 0 or 3 only. A partial mechanical score must have anchors explaining it.
- **Infrastructure failure is `not_run`, never 0.** skillgrade scored 0 on infrastructure errors, which is a defect to avoid.
- **Area score** is the unweighted mean of scored criteria, always shown with coverage ("7 of 12 scored"). There are no weights in this version because no official source ties any practice to measured outcomes.
- **There is no overall score.** A high total could hide a skill that never triggers.
- **`stale-unconfirmed` practices** are scored and carry an age marker.
- **Blockers** are listed above the profile. There are four kinds: a score of 0 on a practice marked `must` for the active profile; a mechanical finding with an `effect`; a security finding; and trigger failures in a live run (section 8).
- **Security findings** block in every profile, whatever the source's wording, by owner decision on 2026-11-06. A hardcoded credential (SAFE-02) is the first case. A finding is a security finding only when its check is marked `security: true` and names the risk. The report shows these separately from `effect` blockers.
- **`effect`** on a finding records what Claude Code does with the defect, as its docs or changelog state (research section 2.12). `not_loaded`: the skill is absent (LB-01, LB-02, LB-05, LB-06, LB-08). `fields_ignored`: the skill loads, but the author's frontmatter or `name` is silently dropped (LB-03, LB-04, LB-09). Each finding cites its LB ID. It belongs on the finding, not the practice, because one practice can fail in ways with different effects. The Claude Code profile has no `must` practices (catalogue revision 5), so without this a broken skill would pass.
- **Effect blockers and practice flags (SKM-31).** `summarise` drops findings of experimental practices and the blocker rules read only scored mechanical results, so an effect on a contested, experimental or non-mechanical practice would vanish and a skill that cannot load would pass. We chose an invariant over making effect blockers independent of those flags. Each check that can emit an effect declares the LB IDs in `Check.effects`. Two guards enforce it. (1) A runtime guard in `buildRecords` runs right after a check returns, before any contested, experimental or mechanical-only decision: a finding with an `effect` or `lb` whose LB ID the check does not declare throws a `ContractError` naming the check and LB ID. The CLI already maps that error to exit 2 (an infrastructure failure, never a score of 0), so an undeclared effect cannot be dropped silently, on any branch, however the finding was built. (2) Tests in `tests/checks/catalogue-link.test.ts` fail when a declaring check sits on a practice that is contested, experimental, not purely mechanical or not assessable from the artifact, and, over the bad fixtures, when the declared LB IDs differ from those actually emitted, so a declaration cannot be stale or empty. There is no source-text scan, because the runtime guard makes it redundant. Reason: the standing rule is that an effect is a fact from the docs about one defect, which only a mechanical practice can state; an effect on a contested practice is a catalogue error to fix, not a case to score around.
- LB-07 no longer applies since CLI 2.1.283. LB-10 to LB-20 depend on the author's intent, the environment or other skills, so they never produce a blocker. Where one is relevant it may appear as a note.

Exit codes for CI:

| Code | Meaning |
|---|---|
| 0 | No blockers, and at least one criterion scored |
| 1 | At least one blocker |
| 2 | Infrastructure or contract failure, or nothing scored |

Nothing scored must never pass. skillgrade's `--ci` passes a failing task with `--trials=0`, and this rule exists to prevent that.

## 6. Profiles

`claude-code` is the default, and `portable` follows the Agent Skills spec. They differ in data, such as description limits (1,536 listing characters against 1,024) and whether the name must match the directory. Limits come from the catalogue, resolved by the precedence in section 2. The report prints the profile and catalogue revision.

## 7. Judgement layer

- Opt-in: runs only with `--judge`. Without it, judgement practices are `not_run`, the run is offline and deterministic, and CI never calls a model.
- One `claude -p` call per skill (per repeat) covers every qualified judgement practice: `assess` includes judgement, `assessable_from` is artifact, not experimental, not contested, and applicable to the profile. A spike measured one call per skill at $0.13 and 20 s against $0.59 and 58 s per area, with the same quote accuracy. Experimental judgement practices are not sent.
- Isolation: no tools, `--setting-sources project,local`, own system prompt, strict MCP config, no slash commands, no session persistence, and a fresh empty temporary working directory per call. Leftovers in that directory, a non-zero exit, `is_error`, unparsable output or a timeout are an infrastructure failure: every practice in the call is `not_run`, never 0. Auth environment variables are left as they are.
- The skill is untrusted data. It is passed in nonce-delimited tags, files with 1-based line numbers, and the system prompt is static. A skill that tries to instruct the judge is reported as a judge note (not a blocker) with the file and line the judge gave.
- The answer uses `--json-schema`: practice ID (enum of the IDs sent), status (`scored` or `not_applicable`), score 0 to 3 or null, a quote of at most 200 characters, file, line and reason.
- **Checked in code:** every ID exactly once; status and score consistent; the file is one of the skill's files; the quote, after `normaliseForMatch`, occurs on the cited line or within 2 lines. A practice that fails is retried once (one retry call for all failures); then `not_run` with reason `unsupported`, or `infra` for a missing or duplicate ID. For an absence finding the judge cites the field it inspected. The check proves a quote exists, not that it supports the score, and the report says so.
- `--repeat N` (1 to 5, default 1; parallel) takes the median (the lower of the two middle values) of the numeric scores; a strict majority of `not_applicable` gives `not_applicable`; a spread of 2 or more marks the practice `unstable`. With N=1 the report says stability was not measured. The spike suggests 3 for CI use because a single run differs from the 3-run median on 7% of scores.
- `--model` defaults to `claude-sonnet-5-5`. Any model id containing "haiku" is refused (exit 2): in the spike its quotes were exact 86% of the time and its spread was three times larger. Opus is the documented option for more exact quotes, at 2.5 times the cost.
- Mixed practices (judgement plus mechanical or live): the judge's score is the record's score; a mechanical result stays in the evidence as a signal.
- The report shows the model, the number of runs and calls, the cost (`total_cost_usd` summed over all calls, retries included) and the wall time.

## 8. Live layer (`--live`)

**Preflight.** A canary skill run confirms the `stream-json` contract: `tool_use` with `name: "Skill"` and `input.skill`. This format is observed on CLI 2.1.318 but not documented. If it fails, the run stops with exit 2 and nothing is scored.

**Isolation.** Each run gets a temporary project holding only the skill under test. Personal skills in `~/.claude/skills` could otherwise compete and distort results. How to exclude them while keeping auth is unverified: see risk R1.

**Trigger tests.**
- Positive and negative prompts come from the author's `skill-scale.eval.yaml`. If it is absent, the agent proposes them and the report marks them `generated`, since a tool grading its own questions is weaker evidence.
- `--langs en,ru` runs prompts in those languages against the skill, to test non-English triggering.
- Trigger runs allow no tool other than `Skill`, so no skill script can execute.

**Outcome tests.**
- These need author-supplied tasks and graders in the eval file; otherwise they are `not_run`.
- Each task runs with and without the skill, and the report shows the paired difference.
- They execute the skill's code, so they also require `--allow-exec`.
- Graders live outside the agent's workspace and run after it finishes, so the agent cannot rewrite them, a weakness found in skillgrade.

**Statistics.** Report k of n with a Wilson interval; default n=3. Do not use "pass@k", which skillgrade computes as "at least one success". Low n is stated, and a difference whose interval spans zero is reported as inconclusive.

**Cost control.** Print the number of model calls before starting and require confirmation or `--yes`. `--max-runs` is a hard cap.

**Live blockers.** A positive trigger rate whose upper interval bound is below 0.5, or a negative trigger rate whose lower bound is above 0.5. These thresholds are ours, not Anthropic's, and the report says so.

## 9. Report

- **Console:** area bars with coverage, then blockers, then the lowest scores with file and line.
- **HTML:** every criterion with score, evidence, quote and link, fix hint, freshness and contested state, plus the process checklist as a separate section.
- **JSON:** versioned schema with catalogue revision, CLI version, model, and one record per criterion. With `--judge` it also carries a `judge` block (model, runs, calls, cost, duration, unstable practices, judge notes) and a `judge` detail on each judged record; these are additive and `schema_version` stays 1.
- `--lang` localises interface strings and fix hints; English and Russian ship first. Source quotes stay in their original language.

## 10. Validating the scale

The scale is not considered working until these pass.

1. **Fixture skills with injected defects.** For each mechanical check, a skill that breaks exactly that rule. Required: every defect detected with no new false findings on the same fixture.
2. **Reference set.** Anthropic's example skills as the good baseline, with defects injected into copies. Anthropic's skills are not treated as perfect: a low score gets read by a person, and may reveal a bad anchor.
3. **Judgement discrimination.** For each judgement criterion, the injected defect must lower the score in at least 4 of 5 runs. A criterion that fails is marked `experimental`: shown, but excluded from area scores until fixed.
   Out of the M2 scope: the discrimination and agreement harness is not built; M2 ships with the judgement practices un-validated against labels, and the report says scores are an opinion.
4. **Self-application.** `skills/skill-scale/` is scored by the tool, and its blockers are fixed.

Results are published in the repository, so the reliability of each criterion can be checked.

## 11. Reuse

| Source | What | How |
|---|---|---|
| skillgrade (MIT) | junit, csv and markdown reporters; eval config ideas; normalised gain concept | Copy with attribution or reimplement |
| skillgrade PRs #10, #11 | `--no-skills` baseline and `tool_usage` grader | Reimplement the idea; the code is stale |
| skillgrade fork `gradzio` | Trajectory capture for locating failing steps | Idea, later |
| skillgrade fork `chrisjowen` | `optimize` loop with train/validation/test | Next stage, for fixing |

Fork licences are checked per fork before any code is copied.

## 12. Out of scope for this version

Automatic rewriting of skills; agents other than Claude Code; the `claude-api` profile; weighted scores; multi-skill overlap across a whole library (only distinctness judged within one skill's description); a hosted service.

## 13. Risks and open questions

| ID | Issue | Handling |
|---|---|---|
| R1 | Isolating personal skills from live runs without breaking auth is unverified | First implementation task is an experiment. If it can't be done, the report prints which other skills were visible |
| R2 | The `stream-json` skill event is undocumented and may change | Preflight in section 8 |
| R3 | Six runs on Haiku don't show how models read long files in practice | No criterion depends on it. The 100-line table of contents rule stays, and only for reference files |
| R4 | Web search coverage was limited, so an official post may be missing | `catalog verify` covers changes to known sources; new-source discovery remains manual |
| R5 | Docs pages have no per-page dates, so `undated-live` is an assumption of currency | The marker is shown in reports |
| R6 | Judge cost across about 10 areas per skill is unmeasured | Measured in the M2 spike: $0.08 to $0.23 and 18 to 24 s per skill per run (Sonnet, one call); about $0.25 to $0.70 for three repeats |
| R7 | The open contradiction C-13b (minimum version for `/skill-doctor`) | No criterion depends on it |

## 14. Done means

- `skill-scale <path>` on any skill folder prints a profile, and every applicable practice has a record, with no silent omissions.
- `--live` runs trigger tests with the preflight and the cost prompt, on the user's real skills.
- Section 10's validation results are published, including failures.
- The skill wrapper runs the tool from inside Claude Code.
