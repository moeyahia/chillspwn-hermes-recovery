#!/bin/bash
set -u

TS="$(date '+%a %b %d %I:%M:%S %p %Z %Y')"
TMP1="$(mktemp)"
TMP2="$(mktemp)"
trap 'rm -f "$TMP1" "$TMP2"' EXIT

# Run monitors. Never let one failed check suppress the heartbeat.
timeout 90 /root/pineapple_monitor.sh >"$TMP1" 2>&1 || true
timeout 120 /root/ghossein_defense.sh >"$TMP2" 2>&1 || true

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
