#!/usr/bin/env bash
set -euo pipefail

MEMORY_DIR="$HOME/.hermes/memories"
CONTEXT="CRITICAL: Preserve these ChillsPwn agent memories across compaction:\n"

[ -f "$MEMORY_DIR/USER.md" ] && CONTEXT="$CONTEXT\nUSER PREFS: $(head -5 "$MEMORY_DIR/USER.md")"
[ -f "$MEMORY_DIR/MEMORY.md" ] && CONTEXT="$CONTEXT\nMEMORY: $(head -5 "$MEMORY_DIR/MEMORY.md")"

ESCAPED=$(printf '%s' "$CONTEXT" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')
echo "{\"systemMessage\": $ESCAPED}"
exit 0
