---
name: yii-rce-inetutils-telnetd-root-oneshot
description: One-shot clean Yii unique-log RCE to in-memory GNU Inetutils telnetd CVE-2026-24061 root proof with strict HTTP/Telnet accounting.
---

# Yii RCE to Inetutils telnetd root, one shot

Use only on an authorized host where a clean Yii FileTarget writer -> PhpManager include pair is already proven and GNU Inetutils telnetd 1.9.3-2.7 runs as root on localhost.

## Safety bounds
- Construct and measure both complete HTTP POSTs before sending either.
- Use one fresh unique `/tmp/cpwn_<nonce>/app.log`, preserving Yii default `logVars`.
- Hard cap: one writer POST and one include POST.
- Remote payload opens exactly one TCP connection to `127.0.0.1:23`, sends one malformed `USER` environment frame, sends one fixed proof command, closes in `finally`, and never retries.
- No reverse shell, listener, uploaded/target exploit script, old log/session channel, persistence, credentials, or unrelated reads.

## Telnet protocol
Constants: `IAC=255,DONT=254,DO=253,WONT=252,WILL=251,SB=250,SE=240,NEW_ENVIRON=39,IS=0,VAR=0,VALUE=1`.
- `IAC DO NEW_ENVIRON` -> `IAC WILL NEW_ENVIRON` and set a negotiated guard.
- Other `DO` -> `WONT`; every `WILL` -> `DO`.
- Use a state machine across `recv()` boundaries for IAC options and `SB ... IAC SE`.
- Only after NEW_ENVIRON was negotiated and requested, send once: `[255,250,39,0,0] + b'USER' + [1] + b'-f root' + [255,240]` (hex `fffa27000055534552012d6620726f6f74fff0`).
- A second NEW_ENVIRON subnegotiation must not resend the environment payload.

## In-memory transport
Build the Python source locally, syntax-test it, then compare direct base64, gzip+base64, and zlib+base64 transports; choose the shortest verified representation for the target. Execute from the include query through a compact quote-free PHP payload such as `system(base64_decode(end($_GET)))`; this avoids putting the large command in the logged Cookie header. Marker-wrap output, then best-effort `unlink(__FILE__)` and `rmdir(dirname(__FILE__))` before the end marker. Never persist the query payload or cookies in evidence.

## Header gate
Measure the exact prepared writer and include requests. Require single header line <=6000 bytes, request line <=4096, and request line plus headers <=8192. Abort before exploit POSTs if either fails.

## Remote client requirements
- One `socket.create_connection(('127.0.0.1',23),5)` only.
- Fixed overall receive deadline (20 seconds) and fixed cap (64 KiB).
- Log only sanitized direction/event labels plus hex for Telnet control frames.
- Strip ANSI and CR normalization; escape remaining non-printable bytes.
- Wait for shell prompt after the malformed USER frame, send the exact fixed proof command once, and stop on the actual line-delimited end marker.
- Print counters for TCP attempts, environment payload sends, proof command sends, received bytes, truncation, and socket closure.

## Offline tests
Test exact payload hex, fragmented `IAC DO NEW_ENVIRON`, fragmented subnegotiation terminator, duplicate subnegotiation one-send guard, subnegotiation-before-negotiation no-send guard, other DO/WILL replies, escaped IAC, transport round trips, quote-safe self-cleaning Yii PHP, and strict identity/flag parsing.

## Evidence and success
Store the evidence directory mode 0700 and artifacts 0600. Persist no CSRF or Cookie values. Success requires:
- exactly one writer and one include POST;
- exactly one TCP attempt and one exact environment payload;
- exactly one proof command and a socket-closed counter;
- transcript `uid=0(root)`;
- each flag accepted only as exactly 32 hex immediately after its expected `stat` path line.
Cleanup remains best-effort unless independently verified; do not send another request solely to check it.

Validation record: capture writer/include header bounds, response size, connection and payload counts, authorized proof markers, socket closure, and confirmation that no persistence remains. Keep engagement identifiers and target outcomes only in the engagement evidence store.
