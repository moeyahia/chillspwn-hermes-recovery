# RTSP Camera and IoT Reconnaissance

Apply this workflow only to an explicitly supplied in-scope target.

```bash
: "${AUTHORIZED_RTSP_TARGET:?set an in-scope host or address}"
```

## Capability and authentication checks

```bash
printf 'OPTIONS rtsp://%s:554/ RTSP/1.0\r\nCSeq: 1\r\n\r\n' "$AUTHORIZED_RTSP_TARGET" \
  | nc -w 3 "$AUTHORIZED_RTSP_TARGET" 554

printf 'DESCRIBE rtsp://%s:554/ RTSP/1.0\r\nCSeq: 2\r\n\r\n' "$AUTHORIZED_RTSP_TARGET" \
  | nc -w 3 "$AUTHORIZED_RTSP_TARGET" 554
```

- `401 Unauthorized`: record the authentication scheme, not credentials.
- `200 OK`: validate whether the stream is truly readable without authentication.
- `404 Not Found`: test only paths justified by the detected vendor or engagement evidence.
- Basic authentication is transport-sensitive; require an approved protected network or TLS tunnel.

## ONVIF and service checks

```bash
curl -fsS --max-time 5 "http://$AUTHORIZED_RTSP_TARGET:8080/onvif/device_service"
nmap -sV -p 80,443,554,8080,8899 "$AUTHORIZED_RTSP_TARGET"
```

Avoid broad password attacks unless the rules of engagement explicitly allow them. Use a rate limit, a focused operator-provided candidate list, and approved evidence storage. Never put successful credentials, real device addresses, or camera paths in durable skill memory.

For examples in tests or documentation, use an RFC 5737 address such as `192.0.2.10`.
