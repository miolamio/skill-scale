#!/usr/bin/env bash
# R1 experiment: can a `claude -p` run be isolated from ~/.claude/skills while keeping auth?
#
#   tools/r1-probe.sh setup
#   tools/r1-probe.sh run baseline | sources | overrides | confirm-sources | confirm-overrides | configdir
#   tools/r1-probe.sh teardown
#
# Hard cap: 4 model runs in total, all at --model haiku, all started from a temporary project folder.
# This script only READS ~/.claude/skills (to list names). It never writes to ~/.claude, never edits settings,
# and passes isolation settings only through flags and a file inside the temporary folder.
set -euo pipefail

R1="${R1_DIR:-${TMPDIR:-/tmp}/skill-scale-r1}"
CAP=4
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIST_PROMPT='Reply with only the names of the skills that are listed as available to you, one per line. If you cannot see such a list, reply NONE.'
CONFIRM_PROMPT='R1-PROBE-TRIGGER-7731: use the matching skill, then reply with the single word DONE.'

die() { echo "r1-probe: $*" >&2; exit "${2:-1}"; }

case "${1:-}" in
  setup)
    [ -e "$R1" ] && die "$R1 already exists; run teardown first"
    "$CLAUDE_BIN" auth status --json | grep -q '"loggedIn": *true' || die "claude is not logged in; nothing to test"
    mkdir -p "$R1/project/.claude/skills/r1-probe-skill" "$R1/out"
    cat > "$R1/project/.claude/skills/r1-probe-skill/SKILL.md" <<'SKILL'
---
name: r1-probe-skill
description: Marker skill for the skill-scale R1 isolation experiment. Use when the user message contains R1-PROBE-TRIGGER-7731.
---

Reply with the single word DONE.
SKILL
    ls -1 "$HOME/.claude/skills" > "$R1/personal.txt" 2>/dev/null || true
    [ -s "$R1/personal.txt" ] || die "~/.claude/skills holds no skills, so isolation cannot be observed; R1 stays open" 
    node -e '
      const fs = require("node:fs");
      const names = fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean);
      fs.writeFileSync(process.argv[2], JSON.stringify({ skillOverrides: Object.fromEntries(names.map((n) => [n, "off"])) }));
    ' "$R1/personal.txt" "$R1/overrides.json"
    echo 0 > "$R1/count"
    echo "setup done in $R1 ($(wc -l < "$R1/personal.txt" | tr -d ' ') personal skills listed)"
    ;;
  run)
    label="${2:-}"
    [ -d "$R1" ] || die "run setup first"
    count="$(cat "$R1/count")"
    [ "$count" -lt "$CAP" ] || die "cap of $CAP runs reached; write the note now" 3
    echo $((count + 1)) > "$R1/count"
    extra=(); prompt="$LIST_PROMPT"; envs=()
    case "$label" in
      baseline) ;;
      sources) extra=(--setting-sources project,local) ;;
      overrides) extra=(--settings "$R1/overrides.json") ;;
      confirm-sources) extra=(--setting-sources project,local --allowedTools Skill); prompt="$CONFIRM_PROMPT" ;;
      confirm-overrides) extra=(--settings "$R1/overrides.json" --allowedTools Skill); prompt="$CONFIRM_PROMPT" ;;
      configdir) mkdir -p "$R1/cfg"; envs=(CLAUDE_CONFIG_DIR="$R1/cfg") ;;
      *) echo $count > "$R1/count"; die "unknown label $label" ;;
    esac
    wrap=(); if command -v timeout >/dev/null; then wrap=(timeout 180); elif command -v gtimeout >/dev/null; then wrap=(gtimeout 180); fi
    out="$R1/out/$((count + 1))-$label"
    echo "run $((count + 1)) of $CAP: $label"
    ( cd "$R1/project" && env "${envs[@]+"${envs[@]}"}" "${wrap[@]+"${wrap[@]}"}" "$CLAUDE_BIN" -p "$prompt" --model haiku \
        --output-format stream-json --verbose --max-turns 2 --no-session-persistence \
        "${extra[@]+"${extra[@]}"}" > "$out.jsonl" 2> "$out.err" ) || echo "(claude exited with a non-zero status; see $out.err)"
    node "$HERE/r1-summarise.ts" "$out.jsonl" "$R1/personal.txt" "$label"
    ;;
  teardown)
    [ -d "$R1" ] || die "nothing to remove"
    rm -rf "$R1"
    echo "removed $R1"
    ;;
  *)
    die "usage: r1-probe.sh setup | run <label> | teardown" 2
    ;;
esac
