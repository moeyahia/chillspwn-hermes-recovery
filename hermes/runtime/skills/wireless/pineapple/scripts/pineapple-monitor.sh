#!/usr/bin/env bash
# Poll an explicitly configured WiFi Pineapple and emit only newly observed events.
set -euo pipefail

die() {
  printf 'pineapple-monitor: %s\n' "$*" >&2
  exit 2
}

PINEAPPLE_SSH_TARGET="${PINEAPPLE_SSH_TARGET:-}"
PINEAPPLE_SSH_KEY="${PINEAPPLE_SSH_KEY:-}"
PINEAPPLE_MANAGEMENT_IFACE="${PINEAPPLE_MANAGEMENT_IFACE:-wlan0}"
PINEAPPLE_HANDSHAKE_DIR="${PINEAPPLE_HANDSHAKE_DIR:-}"
PINEAPPLE_CONTROL_MAC="${PINEAPPLE_CONTROL_MAC:-}"
IGNORED_SSIDS_FILE="${PINEAPPLE_IGNORED_SSIDS_FILE:-}"
STATE_FILE="${PINEAPPLE_STATE_FILE:-${XDG_STATE_HOME:-$HOME/.local/state}/chillspwn/pineapple-monitor.state}"
CONNECT_TIMEOUT="${PINEAPPLE_CONNECT_TIMEOUT:-5}"

[[ -n "$PINEAPPLE_SSH_TARGET" ]] || die 'PINEAPPLE_SSH_TARGET is required (user@host).'
[[ "$PINEAPPLE_SSH_TARGET" =~ ^[A-Za-z0-9._-]+@([A-Za-z0-9._-]+|\[[0-9A-Fa-f:]+\])$ ]] || die 'PINEAPPLE_SSH_TARGET must be a user@host destination.'
[[ -r "$PINEAPPLE_SSH_KEY" && -f "$PINEAPPLE_SSH_KEY" ]] || die 'PINEAPPLE_SSH_KEY must name a readable regular file.'
[[ "$PINEAPPLE_MANAGEMENT_IFACE" =~ ^[A-Za-z0-9_.:-]+$ ]] || die 'PINEAPPLE_MANAGEMENT_IFACE contains unsupported characters.'
[[ "$PINEAPPLE_HANDSHAKE_DIR" =~ ^/[A-Za-z0-9._/-]+$ ]] || die 'PINEAPPLE_HANDSHAKE_DIR must be an absolute appliance path.'
[[ "$PINEAPPLE_HANDSHAKE_DIR" != *'/../'* && "$PINEAPPLE_HANDSHAKE_DIR" != */.. ]] || die 'PINEAPPLE_HANDSHAKE_DIR cannot traverse parent directories.'
[[ "$CONNECT_TIMEOUT" =~ ^[0-9]+$ ]] || die 'PINEAPPLE_CONNECT_TIMEOUT must be an integer.'
if [[ -n "$PINEAPPLE_CONTROL_MAC" && ! "$PINEAPPLE_CONTROL_MAC" =~ ^([[:xdigit:]]{2}:){5}[[:xdigit:]]{2}$ ]]; then
  die 'PINEAPPLE_CONTROL_MAC is not a valid MAC address.'
fi
if [[ -n "$IGNORED_SSIDS_FILE" && ! -r "$IGNORED_SSIDS_FILE" ]]; then
  die 'PINEAPPLE_IGNORED_SSIDS_FILE is set but is not readable.'
fi

mkdir -p "$(dirname "$STATE_FILE")"
touch "$STATE_FILE"
chmod 600 "$STATE_FILE"

SSH=(
  ssh -i "$PINEAPPLE_SSH_KEY"
  -o BatchMode=yes
  -o ConnectTimeout="$CONNECT_TIMEOUT"
  -o StrictHostKeyChecking=yes
  "$PINEAPPLE_SSH_TARGET"
)

NOW="$(date +%s)"
TMP_STATE="$(mktemp "${STATE_FILE}.tmp.XXXXXX")"
trap 'rm -f "$TMP_STATE"' EXIT

is_control_mac() {
  [[ -n "$PINEAPPLE_CONTROL_MAC" && "${1,,}" == "${PINEAPPLE_CONTROL_MAC,,}" ]]
}

LEASES="$("${SSH[@]}" 'cat /tmp/dhcp.leases 2>/dev/null' || true)"
while IFS= read -r line; do
  [[ -n "$line" ]] || continue
  read -r _lease_epoch mac ip hostname _rest <<< "$line"
  [[ -n "${mac:-}" ]] || continue
  [[ "$mac" =~ ^([[:xdigit:]]{2}:){5}[[:xdigit:]]{2}$ ]] || continue
  is_control_mac "$mac" && continue
  fingerprint="lease|${mac}|${ip:-}|${hostname:-}"
  if ! grep -Fqx -- "$fingerprint" "$STATE_FILE"; then
    printf '%s\n' "$fingerprint" >> "$STATE_FILE"
    vendor="$("${SSH[@]}" "grep -i '${mac:0:8}' /etc/pineapple/ouis 2>/dev/null | head -1" || true)"
    printf 'New DHCP client: %s (%s) — %s — %s\n' "$mac" "${ip:-unknown IP}" "${hostname:-unknown host}" "${vendor:-unknown vendor}"
  fi
done <<< "$LEASES"

HANDSHAKES="$("${SSH[@]}" "find '$PINEAPPLE_HANDSHAKE_DIR' -type f -name '*.pcap' -print 2>/dev/null" || true)"
while IFS= read -r remote_file; do
  [[ -n "$remote_file" ]] || continue
  fingerprint="handshake|${remote_file}"
  if ! grep -Fqx -- "$fingerprint" "$STATE_FILE"; then
    printf '%s\n' "$fingerprint" >> "$STATE_FILE"
    size="$("${SSH[@]}" sh -s -- "$remote_file" <<'REMOTE' || true
file=$1
if command -v stat >/dev/null 2>&1; then
  stat -c '%s' -- "$file" 2>/dev/null
else
  wc -c < "$file" 2>/dev/null
fi
REMOTE
)"
    printf 'New handshake capture: %s (%s bytes)\n' "$remote_file" "${size:-unknown}"
  fi
done <<< "$HANDSHAKES"

SSIDS="$("${SSH[@]}" "sqlite3 /etc/pineapple/pineapple.db 'SELECT ssid FROM ssids ORDER BY rowid DESC LIMIT 20;' 2>/dev/null" || true)"
while IFS= read -r ssid; do
  [[ -n "$ssid" ]] || continue
  if [[ -n "$IGNORED_SSIDS_FILE" ]] && grep -Fqx -- "$ssid" "$IGNORED_SSIDS_FILE"; then
    continue
  fi
  fingerprint="ssid|${ssid}"
  if ! grep -Fqx -- "$fingerprint" "$STATE_FILE"; then
    printf '%s\n' "$fingerprint" >> "$STATE_FILE"
    printf 'New captured SSID: %s\n' "$ssid"
  fi
done <<< "$SSIDS"

CLIENTS="$("${SSH[@]}" "iw dev '$PINEAPPLE_MANAGEMENT_IFACE' station dump 2>/dev/null | awk '/^Station/ {print \$2}'" || true)"
while IFS= read -r client_mac; do
  [[ -n "$client_mac" ]] || continue
  [[ "$client_mac" =~ ^([[:xdigit:]]{2}:){5}[[:xdigit:]]{2}$ ]] || continue
  is_control_mac "$client_mac" && continue
  if ! grep -Fq -- "client|${client_mac}|" "$STATE_FILE"; then
    printf 'client|%s|%s\n' "$client_mac" "$NOW" >> "$STATE_FILE"
    signal="$("${SSH[@]}" "iw dev '$PINEAPPLE_MANAGEMENT_IFACE' station get '$client_mac' 2>/dev/null | awk '/signal:/ {print \$2; exit}'" || true)"
    printf 'New associated client: %s — signal: %s dBm\n' "$client_mac" "${signal:-unknown}"
  fi
done <<< "$CLIENTS"

grep -v '^client|' "$STATE_FILE" > "$TMP_STATE" || true
while IFS='|' read -r kind mac seen_at; do
  [[ "$kind" == client && "$seen_at" =~ ^[0-9]+$ ]] || continue
  if (( NOW - seen_at < 86400 )); then
    printf 'client|%s|%s\n' "$mac" "$seen_at" >> "$TMP_STATE"
  fi
done < "$STATE_FILE"
chmod 600 "$TMP_STATE"
mv -f "$TMP_STATE" "$STATE_FILE"
trap - EXIT
