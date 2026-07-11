# ChillsPwn connectivity and WebSocket troubleshooting

Session context: after ChillsPwn was installed as a systemd service, the user asked what caused WebSocket disconnects and later asked for live status checks for Tailscale, OpenVPN, and Claude. The useful durable lesson is the diagnostic sequence and the VM-stall failure mode.

## Fast status probes

Use these when the user asks whether the dashboard, Tailscale, OpenVPN, or Claude is "up".

### ChillsPwn service and health

```bash
systemctl is-enabled chillspwn.service
systemctl is-active chillspwn.service
systemctl status chillspwn.service --no-pager -l | sed -n '1,18p'
curl -fsS --max-time 3 http://localhost:3131/api/health
curl -fsS --connect-timeout 3 --max-time 5 http://100.123.130.61:3131/api/health
```

Good indicators:

- `enabled`
- `active`
- health JSON with `status: ok`
- expected `sessions` count if a live Claude session exists

### Tailscale

```bash
systemctl is-enabled tailscaled
systemctl is-active tailscaled
systemctl status tailscaled --no-pager -l | sed -n '1,18p'
tailscale ip -4
tailscale status --self=false | sed -n '1,12p'
```

Good indicators:

- `tailscaled.service` is `enabled` and `active`
- status line says `Connected`
- expected Kali Tailscale IP is `100.123.130.61`

### OpenVPN / HTB VPN

```bash
systemctl list-units --type=service --all 'openvpn*' --no-pager
systemctl list-unit-files 'openvpn*' --no-pager
ps -eo pid,comm,args | awk '$2=="openvpn" || $2=="openfortivpn" {print}'
ip -brief addr show | grep -E 'tun|tap|wg|tailscale' || true
ip route | grep -E 'tun|tap|openvpn' || true
```

Good indicators for OpenVPN/HTB:

- an `openvpn` process exists
- a `tun0`/`tun*` interface exists
- routes are present through `tun*`

If only `tailscale0` appears and no `tun0`, Tailscale is up but OpenVPN is not connected.

### Claude subprocess inside ChillsPwn

```bash
ps -eo pid,ppid,comm,%cpu,%mem,etime,args --sort=-%cpu | awk '$3=="claude" || $0 ~ /claude -p/ {print}' | head -20
curl -sS --max-time 3 http://localhost:3131/api/health
tail -80 /root/.claude/chillspwn/logs/dashboard.log | grep -Ei 'claude|session|spawn|exit|error|ws|websocket' | tail -30
```

Good indicators:

- a `claude -p ...` process exists with parent `bun`
- health endpoint shows `sessions: 1` or expected active session count
- logs show CLI session resume/follow-up events without exit errors

## Diagnosing WebSocket disconnects

Do not assume WebSocket drops mean the ChillsPwn app crashed. Correlate app logs, system logs, network/tunnel logs, and CPU load.

### Evidence to collect

```bash
# App-side websocket/session timeline
tail -300 /root/.claude/chillspwn/logs/dashboard.log | grep -Ei 'websocket|ws message|connected|disconnect|session|error|exit'

# Service state around the issue
systemctl status chillspwn.service --no-pager -l
journalctl -u chillspwn.service --since '30 minutes ago' --no-pager

# Kernel/system stall evidence
journalctl -k --since '30 minutes ago' --no-pager | grep -Ei 'rcu|stall|watchdog|clocksource|soft lockup|hung|time jump'
journalctl --since '30 minutes ago' --no-pager | grep -Ei 'watchdog|time jump|tailscale|tailscaled|rcu|stall'

# Resource saturation
uptime
top -bn1 | sed -n '1,20p'
ps -eo pid,ppid,comm,%cpu,%mem,etime,args --sort=-%cpu | head -15

# Tailscale/tunnel state
tailscale status
tailscale ip -4
journalctl -u tailscaled --since '30 minutes ago' --no-pager | grep -Ei 'time jump|long-poll|timeout|derp|connected|disco'
```

### VM stall failure mode seen in practice

A real ChillsPwn WebSocket glitch was caused by infrastructure rather than the dashboard:

- dashboard process stayed alive
- health endpoint remained OK after the stall
- both vCPUs were saturated by scanning/VPN work
- kernel logs showed RCU/clocksource stall messages such as `rcu_preempt kthread starved` and `timer wakeup didn't happen`
- systemd watchdog warnings appeared in the same window
- Tailscale logged `time jump detected (slept 4m25s)` and long-poll timeouts
- browser/mobile WebSockets dropped and then auto-reconnected

Interpretation: CPU/VM scheduling stall -> Tailscale/network interruption -> browser WebSocket timeout. This is not primarily a Bun/React bug.

## Reporting style

For Mr. Wong, report concise verified state:

- up/down for each component
- exact evidence: service active/enabled, IP/interface, health JSON, process PID
- if troubleshooting disconnects, give the causal chain and the strongest log lines

Avoid dumping long commands unless asked. He prefers direct execution and results.