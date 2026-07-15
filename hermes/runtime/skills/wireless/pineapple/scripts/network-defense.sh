#!/usr/bin/env bash
# Monitor an explicitly configured, authorized wireless network from a WiFi Pineapple.
set -euo pipefail

die() {
  printf 'network-defense: %s\n' "$*" >&2
  exit 2
}

PINEAPPLE_SSH_TARGET="${PINEAPPLE_SSH_TARGET:-}"
PINEAPPLE_SSH_KEY="${PINEAPPLE_SSH_KEY:-}"
PINEAPPLE_MONITOR_IFACE="${PINEAPPLE_MONITOR_IFACE:-wlan1}"
PINEAPPLE_UPLINK_IFACE="${PINEAPPLE_UPLINK_IFACE:-wlan2}"
PROTECTED_SSID="${PINEAPPLE_PROTECTED_SSID:-}"
EXPECTED_UPLINK_SSID="${PINEAPPLE_EXPECTED_UPLINK_SSID:-$PROTECTED_SSID}"
KNOWN_BSSIDS_FILE="${PINEAPPLE_KNOWN_BSSIDS_FILE:-}"
NEARBY_AP_ALLOWLIST_FILE="${PINEAPPLE_NEARBY_AP_ALLOWLIST_FILE:-}"
CONNECT_TIMEOUT="${PINEAPPLE_CONNECT_TIMEOUT:-5}"

[[ -n "$PINEAPPLE_SSH_TARGET" ]] || die 'PINEAPPLE_SSH_TARGET is required (user@host).'
[[ "$PINEAPPLE_SSH_TARGET" =~ ^[A-Za-z0-9._-]+@([A-Za-z0-9._-]+|\[[0-9A-Fa-f:]+\])$ ]] || die 'PINEAPPLE_SSH_TARGET must be a user@host destination.'
[[ -r "$PINEAPPLE_SSH_KEY" && -f "$PINEAPPLE_SSH_KEY" ]] || die 'PINEAPPLE_SSH_KEY must name a readable regular file.'
[[ -n "$PROTECTED_SSID" && "$PROTECTED_SSID" != *$'\n'* && "$PROTECTED_SSID" != *$'\r'* ]] || die 'PINEAPPLE_PROTECTED_SSID is required and must be one line.'
[[ "$EXPECTED_UPLINK_SSID" != *$'\n'* && "$EXPECTED_UPLINK_SSID" != *$'\r'* ]] || die 'PINEAPPLE_EXPECTED_UPLINK_SSID must be one line.'
[[ -r "$KNOWN_BSSIDS_FILE" && -f "$KNOWN_BSSIDS_FILE" ]] || die 'PINEAPPLE_KNOWN_BSSIDS_FILE must name a readable regular file.'
[[ "$PINEAPPLE_MONITOR_IFACE" =~ ^[A-Za-z0-9_.:-]+$ ]] || die 'PINEAPPLE_MONITOR_IFACE contains unsupported characters.'
[[ "$PINEAPPLE_UPLINK_IFACE" =~ ^[A-Za-z0-9_.:-]+$ ]] || die 'PINEAPPLE_UPLINK_IFACE contains unsupported characters.'
[[ "$CONNECT_TIMEOUT" =~ ^[0-9]+$ ]] || die 'PINEAPPLE_CONNECT_TIMEOUT must be an integer.'
if [[ -n "$NEARBY_AP_ALLOWLIST_FILE" && ! -r "$NEARBY_AP_ALLOWLIST_FILE" ]]; then
  die 'PINEAPPLE_NEARBY_AP_ALLOWLIST_FILE is set but is not readable.'
fi

while IFS= read -r bssid; do
  [[ -z "$bssid" || "$bssid" == \#* ]] && continue
  [[ "$bssid" =~ ^([[:xdigit:]]{2}:){5}[[:xdigit:]]{2}$ ]] || die 'Known-BSSID file contains an invalid entry.'
done < "$KNOWN_BSSIDS_FILE"

SSH=(
  ssh -i "$PINEAPPLE_SSH_KEY"
  -o BatchMode=yes
  -o ConnectTimeout="$CONNECT_TIMEOUT"
  -o StrictHostKeyChecking=yes
  "$PINEAPPLE_SSH_TARGET"
)

remote_timed_count() {
  local seconds="$1"
  local command="$2"
  "${SSH[@]}" "tmp=/tmp/chillspwn-monitor.\$\$; ($command) >\"\$tmp\" 2>/dev/null & pid=\$!; sleep $seconds; kill \"\$pid\" 2>/dev/null || true; wait \"\$pid\" 2>/dev/null || true; wc -l <\"\$tmp\"; rm -f \"\$tmp\""
}

scan_access_points() {
  "${SSH[@]}" "base=/tmp/chillspwn-ap-scan.\$\$; rm -f \"\${base}\"-*; airodump-ng '$PINEAPPLE_MONITOR_IFACE' --band abg -w \"\$base\" --output-format csv >/dev/null 2>&1 & pid=\$!; sleep 20; kill \"\$pid\" 2>/dev/null || true; wait \"\$pid\" 2>/dev/null || true; cat \"\${base}-01.csv\" 2>/dev/null; rm -f \"\${base}\"-*"
}

OUTPUT=""
NOW="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

DEAUTH_COUNT="$(remote_timed_count 15 "tcpdump -i '$PINEAPPLE_MONITOR_IFACE' -nn -c 500 'type mgt subtype deauth'")"
if [[ "$DEAUTH_COUNT" =~ ^[0-9]+$ ]] && (( DEAUTH_COUNT > 10 )); then
  OUTPUT+=$'\nDeauthentication flood detected: '"$DEAUTH_COUNT"$' frames in 15 seconds.'
fi

WPS_ATTEMPTS="$(remote_timed_count 10 "tcpdump -i '$PINEAPPLE_MONITOR_IFACE' -nn -c 200 'wlan.fc.type_subtype == 0x0004 and wlan.fixed.reason_code == 2'")"
if [[ "$WPS_ATTEMPTS" =~ ^[0-9]+$ ]] && (( WPS_ATTEMPTS > 5 )); then
  OUTPUT+=$'\nRepeated authentication activity detected: '"$WPS_ATTEMPTS"$' matching frames in 10 seconds.'
fi

AP_CSV="$(scan_access_points)"
while IFS=$'\t' read -r bssid row; do
  [[ -n "$bssid" ]] || continue
  if ! grep -Fxiq -- "$bssid" "$KNOWN_BSSIDS_FILE"; then
    OUTPUT+=$'\nRogue AP detected for the protected SSID: '"$row"
  fi
done < <(
  awk -F, -v protected="$PROTECTED_SSID" '
    {
      bssid=$1; ssid=$14
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", bssid)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", ssid)
      if (ssid == protected && bssid ~ /^([[:xdigit:]]{2}:){5}[[:xdigit:]]{2}$/) {
        print bssid "\t" $0
      }
    }
  ' <<< "$AP_CSV"
)

if [[ -n "$NEARBY_AP_ALLOWLIST_FILE" ]]; then
  while IFS=$'\t' read -r bssid row; do
    [[ -n "$bssid" ]] || continue
    if ! grep -Fxiq -- "$bssid" "$NEARBY_AP_ALLOWLIST_FILE"; then
      OUTPUT+=$'\nNearby AP not present in the configured allowlist: '"$row"
    fi
  done < <(
    awk -F, '
      {
        bssid=$1
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", bssid)
        if (bssid ~ /^([[:xdigit:]]{2}:){5}[[:xdigit:]]{2}$/) print bssid "\t" $0
      }
    ' <<< "$AP_CSV"
  )
fi

UPLINK_STATUS="$("${SSH[@]}" "iw dev '$PINEAPPLE_UPLINK_IFACE' link 2>/dev/null" || true)"
if [[ -n "$EXPECTED_UPLINK_SSID" ]] && ! grep -Fq -- "SSID: $EXPECTED_UPLINK_SSID" <<< "$UPLINK_STATUS"; then
  OUTPUT+=$'\nPineapple uplink is not associated with the configured SSID.'
fi

if [[ -n "$OUTPUT" ]]; then
  printf 'Wireless defense report — %s\n%s\n' "$NOW" "$OUTPUT"
fi
