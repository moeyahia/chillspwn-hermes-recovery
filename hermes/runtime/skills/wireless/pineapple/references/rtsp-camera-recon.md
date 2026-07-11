# RTSP Camera & IoT Reconnaissance

Methodology for probing IP cameras, RTSP relays, and IoT hubs discovered during LAN scanning.

## Camera RTSP Probing

### Step 1: OPTIONS (no auth needed)
```
echo -e "OPTIONS rtsp://<IP>:554/ RTSP/1.0\r\nCSeq: 1\r\n\r\n" | nc -w 3 <IP> 554
```
- Returns supported methods (DESCRIBE, SETUP, PLAY, etc.)
- May reveal Server header (e.g., "GStreamer RTSP server")
- No authentication required

### Step 2: DESCRIBE (may need auth)
```
echo -e "DESCRIBE rtsp://<IP>:554/ RTSP/1.0\r\nCSeq: 2\r\n\r\n" | nc -w 3 <IP> 554
```
- **401 Unauthorized** → camera has password (good)
- **200 OK** → stream is open (bad)
- **404 Not Found** → wrong path or no active stream
- **Digest auth** (WWW-Authenticate: Digest) → stronger than Basic
- **Basic auth** → cleartext passwords, easier to crack

### Step 3: Brute Force
RTSP Digest auth is slow. Hydra manages ~4-16 attempts/sec:
```
hydra -l admin -P /path/to/wordlist.txt <IP> rtsp -s 554 -t 4
```
Try ISP/manufacturer default patterns first:
- `admin:admin`, `admin:12345`, `admin:password`
- `admin:<ISP name>` (telus, bell, rogers)
- `admin:<camera brand>` (hikvision, dahua, axis)

### ONVIF Discovery
Many IP cameras expose ONVIF on port 80/8080/8899:
```
curl -s http://<IP>:8080/onvif/device_service
```

## MAC OUI Identification

Use MAC prefix to identify device manufacturer:
```
grep -i "<OUI>" /usr/share/nmap/nmap-mac-prefixes
# Or: curl -s "https://api.macvendors.com/<OUI>"
```

Key OUIs for security/IoT:
- `50:40:74` — Alarm.com (security panels, smart home hubs)
- `00:13:37` — Hak5 (Pineapple)

## Alarm.com Hub Fingerprint

TELUS SmartHome Security runs on Alarm.com's platform. Hub characteristics:
- Ports: 554 (RTSP relay), 6443 (HTTPS), 40928 (UPnP), 41928 (internal)
- RTSP server: GStreamer-based, accepts ANNOUNCE but returns 404 for unknown paths
- UPnP port 40928: returns 401 for all credentials (locked down)
- Reverse DNS: shows MAC address formatted as hostname
- The hub acts as a camera relay — cameras stream to it, it proxies to Alarm.com cloud

## Common False Positives

1. **Port 9000 "Service not available"** — Returns 200 OK for every HTTP request regardless of auth. Hydra reports EVERYTHING as cracked. Verify with `curl -u test:test` manually.
2. **Alarm.com 401 XML** — The UPnP 401 page starts with `<?xml version="1.0"`. Don't mistake this for a valid UPnP device description.
3. **SMB port 445 open but refusing connections** — Some gateways show port 445 as open in port scans but refuse actual SMB connections.
