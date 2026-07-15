#!/usr/bin/env bash
set -euo pipefail

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
PYTHON="${HERMES_PYTHON:-python3}"
MEMORY_CLI="${CHILLSPWN_MEM_CLI:-$HERMES_HOME/skills/red-teaming/council-of-ais/scripts/chillspwn_mem.py}"

# Memory injection fails closed. Never fall back to cat/head on legacy files.
if ! command -v "$PYTHON" >/dev/null 2>&1 || [ ! -f "$MEMORY_CLI" ]; then
  exit 0
fi

# Claude Code sends JSON on stdin with a "source" field:
#   "startup"  — fresh `claude` launch
#   "resume"   — `claude --resume` or `--continue` (context already has memory)
#   "clear"    — after `/clear` (need to reinject)
#   "compact"  — after compaction (context kept, no need to reinject)
#
# We ONLY want to inject memory on first launch and on /clear. Resume and
# compact already have the memory in the surviving context — re-injecting
# wastes tokens and clutters the chat.

SOURCE="startup"
if [ -t 0 ]; then
  # No stdin (older Claude versions or manual invocation) — assume startup
  :
else
  INPUT=$(cat || true)
  if [ -n "$INPUT" ]; then
    DETECTED=$(printf '%s' "$INPUT" | "$PYTHON" -c 'import sys,json
try:
  d=json.loads(sys.stdin.read())
  print(d.get("source") or "")
except Exception:
  print("")
' 2>/dev/null || echo "")
    if [ -n "$DETECTED" ]; then
      SOURCE="$DETECTED"
    fi
  fi
fi

# Skip injection on resume/compact — context already has the memory
if [ "$SOURCE" = "resume" ] || [ "$SOURCE" = "compact" ]; then
  exit 0
fi

MEMORY_DIR="$HERMES_HOME/memories"
CONTEXT=""

# Load USER.md preferences through the broker. Do not probe the root-only file.
USER_PREFS=$("$PYTHON" "$MEMORY_CLI" safe-read --target user --format text 2>/dev/null || true)
if [ -n "$USER_PREFS" ]; then
  CONTEXT="$CONTEXT\n\n## USER PREFERENCES (MANDATORY)\n$USER_PREFS"
fi

# Load MEMORY.md knowledge base through the broker.
MEMORY=$("$PYTHON" "$MEMORY_CLI" safe-read --target memory --format text 2>/dev/null || true)
if [ -n "$MEMORY" ]; then
  CONTEXT="$CONTEXT\n\n## PERSISTENT MEMORY\n$MEMORY"
fi

# Detect project and load project-specific memory
CWD=$(pwd)
PROJECT_SLUG=$(echo "$CWD" | sed 's|/|-|g' | sed 's|^-||')
PROJ_MEM=$("$PYTHON" "$MEMORY_CLI" safe-read --target memory \
  --path "$MEMORY_DIR/projects/$PROJECT_SLUG.md" --format text 2>/dev/null || true)
if [ -n "$PROJ_MEM" ]; then
  CONTEXT="$CONTEXT\n\n## PROJECT MEMORY ($CWD)\n$PROJ_MEM"
fi

# Council state — ChillsPwn relies on the GLOBAL council state. Inject the live
# snapshot so it knows which engagements have a council running / awaiting review /
# completed, and HARD-PAUSES on any manual run that is awaiting_review.
COUNCIL_SCRIPT="$HERMES_HOME/skills/red-teaming/council-of-ais/scripts/council_state.py"
if [ -f "$COUNCIL_SCRIPT" ]; then
  COUNCIL_SUMMARY=$("$PYTHON" "$COUNCIL_SCRIPT" 2>/dev/null || true)
  if [ -n "$COUNCIL_SUMMARY" ] && ! printf '%s' "$COUNCIL_SUMMARY" | grep -q "No council runs recorded"; then
    CONTEXT="$CONTEXT\n\n## COUNCIL STATE (authoritative — rely on this)\n$COUNCIL_SUMMARY\n\nRULES:\n- A run that is 'awaiting_review' (manual completion) is a HARD PAUSE: do NOT act on that engagement's council recommendations until its status becomes 'completed' (operator presses Complete, or auto-completion fires).\n- For a 'completed' run, READ ALL lane assessments in <dir>/council/ and decide yourself — there is no synthesis step; you weigh all members' input directly.\n- Before acting on any council recommendation, re-check current state with: python3 $COUNCIL_SCRIPT"
  fi
fi

if [ -n "$CONTEXT" ]; then
  ESCAPED=$(printf '%s' "$CONTEXT" | "$PYTHON" -c 'import sys,json; print(json.dumps(sys.stdin.read()))')
  cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": $ESCAPED
  }
}
EOF
fi

exit 0
