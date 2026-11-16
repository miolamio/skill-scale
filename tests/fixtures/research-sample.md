# Anthropic's recommendations on creating skills: evidence base (revision 5)

Research date: 2026-11-05. A small excerpt shaped like the real research file, used only by the generator tests.

## 1. Source register

### 1.1 Tier A: Anthropic normative docs

| ID | URL | Title | Publisher | Version evidence |
|---|---|---|---|---|
| BP | https://example.test/bp | Skill authoring best practices | Anthropic platform docs | no date; 42,405 bytes |
| CC | https://example.test/cc ; /other | Extend Claude with skills | Anthropic Claude Code docs | deploy time |

### 1.2 Tier B, current (dated on or after 2026-05-05)

| ID | URL | Title | Publisher | Date evidence |
|---|---|---|---|---|
| THQ | https://example.test/thq (308 to elsewhere) | Lessons | Anthropic | PUBLISHED Jun 03, 2026 |

### 1.3 Tier B, older official material

| ID | URL | Title | Publisher | Date evidence | Flag |
|---|---|---|---|---|---|
| PDF | https://example.test/guide.pdf | The Guide | Anthropic | 2026-01-26 | older official |

### 1.4 Tier C

| ID | URL | Title | Publisher | Status and date evidence |
|---|---|---|---|---|
| SB | https://example.test/sb | SkillsBench | Li et al. | current |

## 2. Practice catalogue (current sources only)

### 2.1 META: name, frontmatter, portability

**META-01 Name length and characters.**
- Claude Code: "Names longer than 256 characters are ignored" (CC, Frontmatter).
- Portable: "Must be 1-64 characters" (BP, name field) and "Maximum 64 characters" and "Must contain only lowercase letters" (BP, Skill structure note).
- Avoid "I can help you" and my own words with no citation after them.
- Nested "using "MUST filter" instead" (BP).
- (older) "Use kebab-case: notion-project-setup" (PDF p.10).
- Scope: CC 256; API, AI, SPEC 64. Assess: M. Resolution: C-03.
- freshness: recent; assessable_from: artifact. Basis: CC; BP.
Claude Code: Strength: STATEMENT; word: "are ignored"; source: CC
Portable/API: Strength: MUST; word: "Must"; source: BP

### 2.2 DESC: description

**DESC-06 Phrase the description as an instruction (restored; contested).**
- "Use imperative phrasing." (THQ, Writing descriptions).
- freshness: stale-unconfirmed; assessable_from: artifact. Basis: THQ.
Strength: DIRECTIVE; word: "Use"; source: THQ

### 2.9 PROC and MAINT: authoring process and maintenance

**PROC-01 Ground the skill in a real task.** Assess: J.
- "Self-generated Skills land below the no-Skills baseline" (SB, section 4).
- freshness: undated-live; assessable_from: process. Basis: BP.
Strength: STATEMENT; word: "land below"; source: SB

### 2.11 Counts by area, strength, freshness and assessability

Claude Code profile:

| Area | Practices | MUST | DIRECTIVE | SUGGESTION | STATEMENT | recent | undated-live | stale-unconfirmed | artifact | run | process |
|---|---|---|---|---|---|---|---|---|---|---|---|
| META | 1 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | 1 | 0 | 0 |
| DESC | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 0 |
| PROC | 1 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 1 |
| Total | 3 | 0 | 1 | 0 | 2 | 1 | 1 | 1 | 2 | 0 | 1 |

Portable / API profile (only entries with a separate portable line change):

| Area | Practices | MUST | DIRECTIVE | SUGGESTION | STATEMENT | recent | undated-live | stale-unconfirmed | artifact | run | process |
|---|---|---|---|---|---|---|---|---|---|---|---|
| META | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 0 | 0 |
| DESC | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 0 |
| PROC | 1 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 1 |
| Total | 3 | 1 | 1 | 0 | 2 | 1 | 1 | 1 | 2 | 0 | 1 |

### 2.12 Load-blocking facts

| ID | Condition | Exact quote | Source and section | Stops (as stated) | Related |
|---|---|---|---|---|---|
| LB-01 | Directory or file name has a refused character | "A custom command or skill doesn't load when Claude Code refuses its directory or file name." | CC, Characters a skill name can't hold | load | META-03 |
| LB-09 | Frontmatter does not start on line 1, or YAML does not parse | "the skill still loads with no fields set" | CC, Frontmatter reference | nothing stops loading; fields are not read | META-05 |

## 3. Contradictions and resolutions
