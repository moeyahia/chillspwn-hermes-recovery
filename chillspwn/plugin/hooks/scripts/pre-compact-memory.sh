#!/usr/bin/env bash
set -euo pipefail

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
PYTHON="${HERMES_PYTHON:-python3}"
MEMORY_CLI="${CHILLSPWN_MEM_CLI:-$HERMES_HOME/skills/red-teaming/council-of-ais/scripts/chillspwn_mem.py}"
MEMORY_DIR="$HERMES_HOME/memories"
CONTEXT="CRITICAL: Preserve these ChillsPwn agent memories across compaction:\n"

if ! command -v "$PYTHON" >/dev/null 2>&1 || [ ! -f "$MEMORY_CLI" ]; then
  exit 0
fi

USER_PREFS=$("$PYTHON" "$MEMORY_CLI" safe-read --target user --format text 2>/dev/null || true)
MEMORY=$("$PYTHON" "$MEMORY_CLI" safe-read --target memory --format text 2>/dev/null || true)
[ -n "$USER_PREFS" ] && CONTEXT="$CONTEXT\nUSER PREFS: $USER_PREFS"
[ -n "$MEMORY" ] && CONTEXT="$CONTEXT\nMEMORY: $MEMORY"

ESCAPED=$(printf '%s' "$CONTEXT" | "$PYTHON" -c 'import sys,json; print(json.dumps(sys.stdin.read()))')
echo "{\"systemMessage\": $ESCAPED}"
exit 0
