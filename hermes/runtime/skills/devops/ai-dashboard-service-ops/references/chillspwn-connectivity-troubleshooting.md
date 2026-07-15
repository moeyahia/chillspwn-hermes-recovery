# ChillsPwn Connectivity and WebSocket Troubleshooting

Discover the deployed service configuration before probing. Never reuse an endpoint, log path, hostname, username, or private-overlay address from a previous host.

## Required runtime inputs

```bash
: "${CHILLSPWN_LOCAL_HEALTH_URL:?set the local health URL from deployment configuration}"
: "${CHILLSPWN_LOG_SOURCE:?set to journal or an approved log-file path}"
```

`CHILLSPWN_PRIVATE_HEALTH_URL` and `CHILLSPWN_OVERLAY_SERVICE` are optional. Supply them only when the deployment actually uses a private overlay.

## Fast status probes

```bash
systemctl is-enabled chillspwn.service
systemctl is-active chillspwn.service
systemctl status chillspwn.service --no-pager -l
curl -fsS --max-time 5 "$CHILLSPWN_LOCAL_HEALTH_URL"
ss -ltnp
```

Optional private path:

```bash
if [ -n "${CHILLSPWN_OVERLAY_SERVICE:-}" ]; then
  systemctl is-active "$CHILLSPWN_OVERLAY_SERVICE"
fi
if [ -n "${CHILLSPWN_PRIVATE_HEALTH_URL:-}" ]; then
  curl -fsS --connect-timeout 3 --max-time 5 "$CHILLSPWN_PRIVATE_HEALTH_URL"
fi
```

Engagement VPN checks should derive interface names from the active routing table rather than assuming a particular lab or tunnel:

```bash
ip -brief address
ip route
systemctl list-units --type=service --all 'openvpn*' --no-pager
ps -eo pid,comm,args | awk '$2=="openvpn" || $2=="openfortivpn" {print}'
```

## Agent subprocess state

Identify child processes from the service's current main PID:

```bash
main_pid="$(systemctl show chillspwn.service -p MainPID --value)"
[[ "$main_pid" =~ ^[1-9][0-9]*$ ]] || exit 1
ps -eo pid,ppid,comm,%cpu,%mem,etime,args --forest \
  | awk -v parent="$main_pid" '$1==parent || $2==parent {print}'
```

Read logs through the configured source without printing protected environment files:

```bash
case "$CHILLSPWN_LOG_SOURCE" in
  journal) journalctl -u chillspwn.service -n 150 --no-pager ;;
  /*) tail -150 -- "$CHILLSPWN_LOG_SOURCE" ;;
  *) echo 'Invalid CHILLSPWN_LOG_SOURCE' >&2; exit 2 ;;
esac
```

## Diagnosing disconnects

Correlate these timelines:

```bash
journalctl -u chillspwn.service --since '30 minutes ago' --no-pager
journalctl -k --since '30 minutes ago' --no-pager \
  | grep -Ei 'rcu|stall|watchdog|clocksource|soft lockup|hung|time jump'
uptime
ps -eo pid,ppid,comm,%cpu,%mem,etime,args --sort=-%cpu | head -15
ip -brief address
ip route
```

A VM scheduling stall can interrupt an overlay or browser connection while the dashboard process survives. The evidence pattern is: service process remains active, CPU saturation or kernel stall appears in the same window, network logs show a timing interruption, and the browser reconnects afterward. Treat this as an inference only when the timestamps align.

## Reporting

Report service state, health result, listener state, subprocess state, and the strongest timestamped causal evidence. Redact private URLs and hostnames from any public issue or repository artifact.
