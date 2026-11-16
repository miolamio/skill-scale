export const STRINGS_EN = {
  title: "skill-scale {version} | catalogue r{revision} | profile {profile}",
  skill: "Skill: {path}",
  headline: "Scored {scored} of {total} practices ({layers}).",
  headlineExperimental: "{experimental} more scored as experimental and are not counted.",
  experimentalMarker: "(experimental, not counted)",
  notFull: "Not a full assessment: {missing} did not run.",
  areas: "Areas (mean of scored criteria, 0 to 3)",
  coverage: "{scored} of {assessable} scored",
  areaProcess: "{process} for the checklist",
  noScore: "no score",
  blockers: "Blockers",
  securityBlockers: "Security blockers",
  suppressedSecurity: "Suppressed security findings",
  suppressedReason: "suppressed ({reason}); not counted as a blocker or in the score",
  risk: "risk: {risk}",
  effect: "effect: {effect} ({lb})",
  staleMarker: "(stale, unconfirmed)",
  staleCount: "Stale, unconfirmed: {count} of the scored practices ({ids}).",
  noBlockers: "No blockers.",
  lowest: "Lowest scores",
  noLowest: "Nothing scored below 3.",
  notScored: "Not scored: {not_run} not run, {contested} contested, {not_applicable} not applicable, {process} process items for the checklist.",
  notScanned: "Not scanned for secrets (SAFE-02), over 1 MB: {files}",
  fixPrefix: "Fix:",
  judgeLine: "Judge: {model}, {runs}, {calls}, ${cost}, {seconds} s",
  stabilityNone: "Stability was not measured (1 run).",
  stabilityFew: "Stability was not measured (fewer than 2 runs gave an answer).",
  unstableList: "Unstable (scores spread by 2 or more across runs): {ids}",
  noUnstable: "No practice was unstable across {n} runs.",
  unstableMarker: "(unstable)",
  judgeNotes: "Judge notes",
  judgeNote: "The skill appears to instruct the reviewer ({text}). Scores were kept as given; check the skill.",
  judgeOpinion: "Judge scores come from a model and are an opinion, not a measurement; quotes are checked to exist, not to support the score.",
  inference: "(anchors and fix hints are our inference, not Anthropic's words)",
  nothingScored: "Nothing was scored, so this run cannot pass.",
  failure: "Error: {message}",
} as const;

export type StringKey = keyof typeof STRINGS_EN;
export type Strings = Record<StringKey, string>;

export function t(strings: Strings, key: StringKey, vars: Record<string, string | number> = {}): string {
  return strings[key].replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
