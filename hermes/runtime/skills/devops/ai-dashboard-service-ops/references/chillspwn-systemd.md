# ChillsPwn systemd Service Pattern

This reference describes a conventional deployment without encoding the current server's account, home directory, log path, or private endpoint.

## Filesystem layout

- application: `/opt/chillspwn/webapp`
- protected environment: `/etc/chillspwn/chillspwn.env`
- service unit: `/etc/systemd/system/chillspwn.service`
- logs: journald, unless the deployment explicitly configures a protected state directory

These paths are recommendations for a fresh install. On an existing server, inspect `systemctl cat chillspwn.service` and preserve its reviewed layout.

## Environment file

Create the environment file mode `0600`, owned by root. Define deployment-specific bind and integration values there. Do not add it to Git.

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3131
```

The loopback value is safe for a host-local deployment. To expose the dashboard, use an authenticated reverse proxy or verified private overlay; do not commit its address.

## Unit

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

The `--no-hot` flag preserves detached or supervised agent subprocesses. Confirm it remains the application's documented production mode before deployment.

## Deployment and verification

```bash
systemctl daemon-reload
systemctl enable --now chillspwn.service
systemctl is-enabled chillspwn.service
systemctl is-active chillspwn.service
systemctl status chillspwn.service --no-pager -l
systemctl show chillspwn.service -p MainPID -p ExecMainStatus
ss -ltnp
```

Set health URLs from the deployed configuration instead of recording them here:

```bash
: "${CHILLSPWN_LOCAL_HEALTH_URL:?set the local health URL}"
curl -fsS --max-time 5 "$CHILLSPWN_LOCAL_HEALTH_URL"

if [ -n "${CHILLSPWN_PRIVATE_HEALTH_URL:-}" ]; then
  curl -fsS --connect-timeout 3 --max-time 5 "$CHILLSPWN_PRIVATE_HEALTH_URL"
fi
```

Expected evidence is an enabled and active unit, a nonzero main PID, a successful application health response, and the intended listener. Do not print protected environment values while reporting that evidence.
