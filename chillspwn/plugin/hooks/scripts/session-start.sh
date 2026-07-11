#!/usr/bin/env bash
set -euo pipefail

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
    DETECTED=$(printf '%s' "$INPUT" | python3 -c 'import sys,json
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

MEMORY_DIR="$HOME/.hermes/memories"
CONTEXT=""

# Load USER.md preferences
if [ -f "$MEMORY_DIR/USER.md" ]; then
  USER_PREFS=$(cat "$MEMORY_DIR/USER.md")
  CONTEXT="$CONTEXT\n\n## USER PREFERENCES (MANDATORY)\n$USER_PREFS"
fi

# Load MEMORY.md knowledge base
if [ -f "$MEMORY_DIR/MEMORY.md" ]; then
  MEMORY=$(cat "$MEMORY_DIR/MEMORY.md")
  CONTEXT="$CONTEXT\n\n## PERSISTENT MEMORY\n$MEMORY"
fi

# Detect project and load project-specific memory
CWD=$(pwd)
PROJECT_SLUG=$(echo "$CWD" | sed 's|/|-|g' | sed 's|^-||')
if [ -f "$MEMORY_DIR/projects/$PROJECT_SLUG.md" ]; then
  PROJ_MEM=$(cat "$MEMORY_DIR/projects/$PROJECT_SLUG.md")
  CONTEXT="$CONTEXT\n\n## PROJECT MEMORY ($CWD)\n$PROJ_MEM"
fi

# Council state — ChillsPwn relies on the GLOBAL council state. Inject the live
# snapshot so it knows which engagements have a council running / awaiting review /
# completed, and HARD-PAUSES on any manual run that is awaiting_review.
COUNCIL_SCRIPT="$HOME/.hermes/skills/red-teaming/council-of-ais/scripts/council_state.py"
if [ -f "$COUNCIL_SCRIPT" ]; then
  COUNCIL_SUMMARY=$(python3 "$COUNCIL_SCRIPT" 2>/dev/null || true)
  if [ -n "$COUNCIL_SUMMARY" ] && ! printf '%s' "$COUNCIL_SUMMARY" | grep -q "No council runs recorded"; then
    CONTEXT="$CONTEXT\n\n## COUNCIL STATE (authoritative — rely on this)\n$COUNCIL_SUMMARY\n\nRULES:\n- A run that is 'awaiting_review' (manual completion) is a HARD PAUSE: do NOT act on that engagement's council recommendations until its status becomes 'completed' (operator presses Complete, or auto-completion fires).\n- For a 'completed' run, READ ALL lane assessments in <dir>/council/ and decide yourself — there is no synthesis step; you weigh all members' input directly.\n- Before acting on any council recommendation, re-check current state with: python3 $COUNCIL_SCRIPT"
  fi
fi

if [ -n "$CONTEXT" ]; then
  ESCAPED=$(printf '%s' "$CONTEXT" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')
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
