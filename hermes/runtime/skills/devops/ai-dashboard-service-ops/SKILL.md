---
name: ai-dashboard-service-ops
description: "Operate and harden local AI dashboards as long-running services using explicit deployment configuration, health checks, predictable logs, and private-network verification."
---

# AI Dashboard Service Operations

Use this skill to start, restart, persist, or troubleshoot a local AI dashboard such as ChillsPwn. Act on the deployed application only after discovering its configuration from the current host; never reuse a remembered endpoint, username, home-directory path, or private-network address.

## Configuration contract

Before changing service state, locate the installed unit and its protected environment file:

```bash
systemctl cat chillspwn.service
systemctl show chillspwn.service \
  -p User -p Group -p WorkingDirectory -p ExecStart -p EnvironmentFiles
```

The deployment must define its application root, runtime path, bind address, port, state/log directory, and optional private-overlay health URL outside this repository. If a required value cannot be discovered from the service manager or protected configuration, stop instead of substituting a historical default.

## Core approach

1. Verify that the requested host and service are in scope.
2. Preserve the application's documented production flags and process-lifecycle semantics.
3. Use `systemd` for restart and boot persistence.
4. Verify the process manager, listener, and application health endpoint independently.
5. Test optional VPN or overlay reachability only through the endpoint supplied by current configuration.
6. Use journald or a deployment-owned state directory for logs.
7. Report concrete live state without including secret environment values.

## Systemd deployment pattern

Prefer a dedicated service account and a root-owned environment file:

```ini
[Unit]
Description=ChillsPwn Dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=chillspwn
Group=chillspwn
WorkingDirectory=/opt/chillspwn/webapp
EnvironmentFile=/etc/chillspwn/chillspwn.env
ExecStart=/usr/local/bin/bun run --no-hot server/index.ts
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=20
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

The paths above are a conventional deployment layout, not a claim about the current server. Adapt the unit from discovered configuration, and keep credentials out of both the unit and Git.

## Verification

```bash
systemctl is-enabled chillspwn.service
systemctl is-active chillspwn.service
systemctl status chillspwn.service --no-pager -l
systemctl show chillspwn.service -p MainPID -p ExecMainStatus
ss -ltnp
journalctl -u chillspwn.service -n 100 --no-pager
```

Read the local and private health URLs from protected configuration. Do not print the configuration file wholesale:

```bash
: "${CHILLSPWN_LOCAL_HEALTH_URL:?set from the deployed service configuration}"
curl -fsS --max-time 5 "$CHILLSPWN_LOCAL_HEALTH_URL"

if [ -n "${CHILLSPWN_PRIVATE_HEALTH_URL:-}" ]; then
  curl -fsS --connect-timeout 3 --max-time 5 "$CHILLSPWN_PRIVATE_HEALTH_URL"
fi
```

## Pitfalls

- An active unit does not prove application health.
- Hot reload can terminate subprocesses owned by process-wrapping dashboards.
- A WebSocket disconnect does not prove an application crash; correlate service, kernel, resource, and private-network logs.
- A private-network URL is unverified until it has been tested from the intended client path.
- Do not use broad process-kill patterns until the unit's process tree and ownership are known.
- Do not paste environment files, access URLs, tokens, or agent prompts into issues or recovery documentation.

See `references/chillspwn-systemd.md` and `references/chillspwn-connectivity-troubleshooting.md` for deployable patterns that contain no private infrastructure defaults.
