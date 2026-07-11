---
name: lab-vpn
description: Durably bring up an authorized lab/HTB OpenVPN tunnel as SessionRunner. Use when a mission needs VPN connectivity to a lab range (10.129.x / 10.10.x) and a .ovpn profile is provided. Solves the "workers can't keep OpenVPN running" problem.
---

# lab-vpn — durable lab VPN bring-up (SessionRunner)

## Why this skill exists
OpenVPN run in the FOREGROUND blocks for the whole connection, so the agent runtime's per-tool
watchdog (~180s) abandons the call and the tunnel dies. NEVER launch `openvpn` directly in the
foreground from a tool call. Use the daemonized launcher, which detaches so the tool returns in ~1s
and the tunnel persists independently of any agent turn.

## Steps
1. Confirm you have the profile path (e.g. `/root/htb/<box>/lab.ovpn`) and the lab is AUTHORIZED.
2. Check current state:  `terminal: vpn-status`
3. Bring it up (daemonized, split-tunnel-safe):
   `terminal: vpn-up /path/to/profile.ovpn`
   - It REFUSES a full-tunnel profile (redirect-gateway) by default to protect SSH/Tailscale
     management to this box. Only if the operator confirms a full tunnel is required:
     `terminal: vpn-up /path/to/profile.ovpn --allow-full-tunnel`
   - If the profile needs a username/password (`auth-user-pass`), pass `--auth=/path/creds.txt`
     (line 1 = user, line 2 = pass).
4. Verify connectivity:  `terminal: vpn-status`  then a single reachability check to the assigned
   lab gateway (e.g. `terminal: ping -c1 -W2 <gateway>`). Do NOT scan the target yet.
5. Report tun0 IP + that the lab is reachable, then hand back so ChillsPwn can route the actual
   recon/attack steps to the right specialists.
6. To tear down at end of engagement:  `terminal: vpn-down`

## Rules
- This is CONNECTIVITY infrastructure, not an attack — it is SessionRunner's job, not ChillsPwn's.
- Bring the tunnel up ONCE; every specialist then inherits lab reachability over the same tun device.
- Never disable the no-hands rule or run scans/exploits to "test" the VPN — a single ping is enough.
