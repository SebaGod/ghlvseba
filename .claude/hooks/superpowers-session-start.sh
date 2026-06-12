#!/usr/bin/env bash
# SessionStart hook for vendored Superpowers skills.
#
# Recreates the upstream superpowers behavior (https://github.com/obra/superpowers)
# for a repo-vendored install: on session start it injects the full
# "using-superpowers" skill so the agent proactively reaches for skills.
#
# Unlike the upstream plugin hook, this resolves the skills directory relative
# to the project so it works when superpowers is committed into the repo and
# reloaded fresh each session (e.g. Claude Code on the web).

set -euo pipefail

# Resolve project root. Claude Code sets CLAUDE_PROJECT_DIR for hooks; fall back
# to the directory two levels up from this script (.claude/hooks/ -> repo root).
if [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
    PROJECT_DIR="$CLAUDE_PROJECT_DIR"
else
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
fi

SKILL_FILE="${PROJECT_DIR}/.claude/skills/using-superpowers/SKILL.md"

# If the entry skill is missing, exit quietly so the session is unaffected.
if [ ! -f "$SKILL_FILE" ]; then
    exit 0
fi

using_superpowers_content="$(cat "$SKILL_FILE")"

# Escape a string for embedding inside a JSON string value. Each ${s//old/new}
# is a single C-level pass.
escape_for_json() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    printf '%s' "$s"
}

using_superpowers_escaped="$(escape_for_json "$using_superpowers_content")"

session_context="<EXTREMELY_IMPORTANT>\nYou have superpowers.\n\n**Below is the full content of your 'using-superpowers' skill - your introduction to using skills. For all other skills, use the 'Skill' tool:**\n\n${using_superpowers_escaped}\n</EXTREMELY_IMPORTANT>"

# Claude Code reads hookSpecificOutput.additionalContext for SessionStart.
# printf (not heredoc) avoids the bash 5.3+ heredoc hang noted upstream.
printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": "%s"\n  }\n}\n' "$session_context"

exit 0
