#!/bin/bash
set -u

MONITOR_SCRIPT="${PINEAPPLE_MONITOR_SCRIPT:-}"
DEFENSE_SCRIPT="${PINEAPPLE_DEFENSE_SCRIPT:-}"

if [ -z "$MONITOR_SCRIPT" ] || [ ! -x "$MONITOR_SCRIPT" ]; then
  echo "PINEAPPLE_MONITOR_SCRIPT must name an executable monitor script." >&2
  exit 2
fi
if [ -z "$DEFENSE_SCRIPT" ] || [ ! -x "$DEFENSE_SCRIPT" ]; then
  echo "PINEAPPLE_DEFENSE_SCRIPT must name an executable defense script." >&2
  exit 2
fi

TS="$(date '+%a %b %d %I:%M:%S %p %Z %Y')"
TMP1="$(mktemp)"
TMP2="$(mktemp)"
trap 'rm -f "$TMP1" "$TMP2"' EXIT

# Run monitors. Never let one failed check suppress the heartbeat.
timeout 90 "$MONITOR_SCRIPT" >"$TMP1" 2>&1 || true
timeout 120 "$DEFENSE_SCRIPT" >"$TMP2" 2>&1 || true

PINE_OUT="$(cat "$TMP1")"
DEF_OUT="$(cat "$TMP2")"

NEW_DEVICES="NO"
HANDSHAKES="NO"
DEFENSE="NO"

if echo "$PINE_OUT" | grep -Eq '🔴 NEW VICTIM CONNECTED|📶 CLIENT ASSOCIATED|📡 NEW SSID CAPTURED'; then
  NEW_DEVICES="YES"
fi
if echo "$PINE_OUT" | grep -Eq '🔑 NEW HANDSHAKE CAPTURED'; then
  HANDSHAKES="YES"
fi
if [ -n "$(echo "$DEF_OUT" | sed '/^[[:space:]]*$/d')" ]; then
  DEFENSE="YES"
fi

# Detailed findings first, but suppress the generic old one-line completion from pineapple_monitor.sh.
DETAILS="$(printf '%s\n%s\n' "$PINE_OUT" "$DEF_OUT" \
  | grep -v '^✅ Monitor check completed' \
  | sed '/^[[:space:]]*$/d')"

if [ -n "$DETAILS" ]; then
  echo "$DETAILS"
  echo
fi

cat <<EOF
Pineapple Monitor Heartbeat — $TS
- New devices/victims found: $NEW_DEVICES
- New handshakes captured: $HANDSHAKES
- Defense alerts: $DEFENSE
EOF
