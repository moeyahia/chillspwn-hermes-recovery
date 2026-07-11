#!/bin/bash
# Ghossein Network Intrusion Detection — watches for attacks against home network
# Run on Kali, SSHs into Pineapple for monitoring
# Usage: bash ghossein-defense.sh

PINEAPPLE="172.16.42.1"
SSH_KEY="/root/.ssh/id_ed25519"
SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@$PINEAPPLE"

OUTPUT=""
NOW=$(date)

# --- 1. Deauth flood detection ---
DEAUTH_COUNT=$($SSH "timeout 15 tcpdump -i wlan1 -nn -c 500 'type mgt subtype deauth' 2>/dev/null | wc -l" 2>/dev/null)
if [ "$DEAUTH_COUNT" -gt 10 ] 2>/dev/null; then
    OUTPUT="${OUTPUT}
🔴 DEAUTH ATTACK DETECTED: ${DEAUTH_COUNT} deauth frames in 15s (threshold: 10)
   Classic WiFi disconnection attack — someone may be kicking clients off."
fi

# --- 2. Rogue AP detection (spoofed Ghossein SSID) ---
KNOWN_BSSIDS="A2:39:F9:2A:DA:E4|7A:7D:A1:50:06:54|2A:B8:2B:68:8B:86|7A:7D:A1:50:02:3A|76:7D:A1:50:06:54|76:7D:A1:50:02:3A"
ROGUE=$($SSH "timeout 20 airodump-ng wlan1 --band abg -w /tmp/rogue_check --output-format csv 2>/dev/null; sleep 1; cat /tmp/rogue_check-01.csv 2>/dev/null | grep -i 'Ghossein'" 2>/dev/null)
UNKNOWN=$(echo "$ROGUE" | grep -vE "$KNOWN_BSSIDS" | grep -i "Ghossein")
if [ -n "$UNKNOWN" ]; then
    OUTPUT="${OUTPUT}
🔴 ROGUE AP DETECTED — Unknown BSSID broadcasting 'Ghossein':
$(echo "$UNKNOWN" | head -5)"
fi

# --- 3. WPS PIN brute force ---
WPS_ATTEMPTS=$($SSH "timeout 10 tcpdump -i wlan1 -nn -c 200 'wlan.fc.type_subtype == 0x0004 and wlan.fixed.reason_code == 2' 2>/dev/null | wc -l" 2>/dev/null)
if [ "$WPS_ATTEMPTS" -gt 5 ] 2>/dev/null; then
    OUTPUT="${OUTPUT}
🟡 WPS BRUTE FORCE: ${WPS_ATTEMPTS} failed auth attempts — possible WPS PIN attack"
fi

# --- 4. New unknown APs nearby ---
NEW_APS=$($SSH "timeout 15 airodump-ng wlan1 --band abg -w /tmp/ap_check --output-format csv 2>/dev/null; sleep 1; cat /tmp/ap_check-01.csv 2>/dev/null | grep WPA2 | grep -v 'Ghossein\|linksys\|TELUS\|AAMI\|Miles\|Chee\|Rohya'" 2>/dev/null | head -5)
if [ -n "$NEW_APS" ]; then
    OUTPUT="${OUTPUT}
📡 NEW UNKNOWN AP DETECTED:
$(echo "$NEW_APS" | head -3)"
fi

# --- 5. Pineapple uplink health ---
CONN_CHECK=$($SSH "iw dev wlan2 link 2>/dev/null" 2>/dev/null)
if ! echo "$CONN_CHECK" | grep -q "Ghossein"; then
    OUTPUT="${OUTPUT}
⚠️ PINEAPPLE DISCONNECTED FROM GHOSSEIN! Evil twin has no internet uplink."
fi

if [ -n "$OUTPUT" ]; then
    echo "🛡️ GHOSSEIN DEFENSE REPORT — ${NOW}"
    echo "$OUTPUT"
fi
