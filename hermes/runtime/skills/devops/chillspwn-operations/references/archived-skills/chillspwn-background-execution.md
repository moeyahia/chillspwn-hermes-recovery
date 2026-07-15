# Archived skill: `chillspwn-background-execution`

Absorbed into `chillspwn-operations` during umbrella-building consolidation. Original SKILL.md body follows.

---

---
name: chillspwn-background-execution
description: "Run long/privileged tools in ChillsPwn background"
---

# Running long / privileged tools in the ChillsPwn harness

## Background a privileged or long-running process
- **Never** background a privileged daemon with shell `&` / `nohup ... &` — the sandbox kills it (Exit code 144, no process, no log). This bit launching `openvpn` twice.
- Instead run the FOREGROUND command with the tool's own `run_in_background: true` (e.g. `sudo openvpn --config x.ovpn --log /path/vpn.log`). It persists and you read the tracked output file.

## Swallowed / buffered output
- nxc (and similar) piped through the auto-backgrounding layer can have stdout swallowed — you see empty output even with `RC=0`. Do NOT conclude the tool is broken or creds failed.
- Fix: write to an explicit file (`... | tee out.txt` or `> out.txt 2>&1`) and read the file, or use `run_in_background: true` and read the tracked task file.

## Waiting for a result
- Chaining short `sleep` calls to poll is BLOCKED by the harness. Use a Monitor until-loop: `until grep -q DONE "$F"; do sleep 2; done` (with run_in_background), or rely on run_in_background completion notifications.

## Bringing up an authorized lab VPN
- No persistent tunnel on this host; 100% packet loss to a 10.129.x.x target mid-engagement = the lab link dropped (route was via LAN gateway, no local tun0), NOT a box failure or bad creds.
- Operator supplies the .ovpn (HTB pack: cert-based, inline `<ca>/<cert>/<key>/<tls-auth>`). Save it, `chmod 600`, then `sudo openvpn --config htb.ovpn --log vpn.log` via run_in_background. Verify: `tun0` appears, log shows `Initialization Sequence Completed`, and `ip route get TARGET` now goes via the tun gateway.
- **Reporting the blocker to the operator:** lead with one plain sentence separating "attack/creds are fine" from "network/VPN is down and the fix is on your side," THEN the technical detail — dense jargon/emoji tables confused him here. See memory on his blocker-reporting preference.
