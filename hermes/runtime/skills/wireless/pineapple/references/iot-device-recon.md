# IoT Device Reconnaissance

Use these techniques only for devices inside the active engagement scope. Supply targets from the engagement inventory; never use a remembered residential address, hostname, SSID, BSSID, or vendor deployment.

## Target contract

```bash
: "${AUTHORIZED_IOT_TARGET:?set an in-scope host or address}"
```

For documentation and tests, use RFC 5737 addresses such as `192.0.2.10`, `198.51.100.20`, or `203.0.113.30`. Do not substitute real infrastructure in committed examples.

## RTSP capability discovery

```bash
printf 'OPTIONS rtsp://%s:554/ RTSP/1.0\r\nCSeq: 1\r\n\r\n' "$AUTHORIZED_IOT_TARGET" \
  | nc -w 3 "$AUTHORIZED_IOT_TARGET" 554

printf 'DESCRIBE rtsp://%s:554/ RTSP/1.0\r\nCSeq: 2\r\n\r\n' "$AUTHORIZED_IOT_TARGET" \
  | nc -w 3 "$AUTHORIZED_IOT_TARGET" 554
```

- `200`: the requested path is readable without authentication.
- `401`: inspect the authentication scheme without recording credentials.
- `404`: the service exists but the mount path is unavailable.

Prefer focused, authorized credential auditing and rate limits approved in the rules of engagement. Do not store candidate credentials or successful secrets in this repository.

## Device fingerprinting

Use the first three bytes of an observed MAC only after confirming collection is authorized:

```bash
AUTHORIZED_OUI='00:00:5e'
grep -i -- "$AUTHORIZED_OUI" /usr/share/nmap/nmap-mac-prefixes
```

`00:00:5e:00:53:01` is an IANA documentation MAC address suitable for examples. A real OUI or MAC belongs in engagement evidence, not durable skill memory.

## Service discovery

```bash
nmap -sV -p 80,443,554,1900,5000,6443,8080,8899 "$AUTHORIZED_IOT_TARGET"
nmap --script upnp-info -p 1900,5000 "$AUTHORIZED_IOT_TARGET"
```

Interpretation:

- XML device descriptions may reveal a model, manufacturer, or friendly name.
- HTTP `401` indicates an authentication boundary, not a vulnerability.
- A generic HTTP `200` can be a false positive; compare response bodies and behavior.
- RTSP `ANNOUNCE` support does not prove unauthenticated publishing is accepted.

## Wireless defense pattern

Maintain protected identifiers outside Git:

```bash
: "${PINEAPPLE_PROTECTED_SSID:?set the authorized protected SSID}"
: "${PINEAPPLE_KNOWN_BSSIDS_FILE:?set the approved BSSID allowlist file}"
```

Scan results should be compared by exact SSID and exact BSSID. Do not embed household names, router defaults, personal device MACs, or survey results in scripts or documentation.
