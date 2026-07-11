# ChillsPwn systemd service recipe

Session context: user asked to start the ChillsPwn application and ensure it starts on every machine restart. The working solution was to run it under systemd rather than a terminal background process.

## Known paths

- App root: `/root/.claude/plugins/chillspwn/webapp`
- Server entrypoint: `server/index.ts`
- Bun binary: `/root/.bun/bin/bun`
- Durable log: `/root/.claude/chillspwn/logs/dashboard.log`
- Service unit: `/etc/systemd/system/chillspwn.service`
- Local URL: `http://localhost:3131`
- Tailscale/mobile URL: `http://100.123.130.61:3131`
- Health endpoint: `/api/health`

## Important runtime note

Always start with `bun run --no-hot server/index.ts`. The `--no-hot` flag is important because Bun hot reload can kill detached Claude subprocesses spawned by the dashboard.

## Known-good unit

```ini
[Unit]
Description=ChillsPwn Dashboard
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/.claude/plugins/chillspwn/webapp
Environment=PATH=/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=NODE_ENV=production
ExecStart=/root/.bun/bin/bun run --no-hot server/index.ts
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=20
StandardOutput=append:/root/.claude/chillspwn/logs/dashboard.log
StandardError=append:/root/.claude/chillspwn/logs/dashboard.log

[Install]
WantedBy=multi-user.target
```

## Deployment sequence

```bash
mkdir -p /root/.claude/chillspwn/logs
pkill -f 'bun.*server/index.ts' || true

# write /etc/systemd/system/chillspwn.service with the unit above
systemctl daemon-reload
systemctl enable chillspwn.service
systemctl restart chillspwn.service
```

## Verification sequence

```bash
systemctl is-enabled chillspwn.service
systemctl is-active chillspwn.service
pgrep -af 'bun.*server/index.ts'
curl -fsS http://localhost:3131/api/health
curl -fsS --connect-timeout 3 http://100.123.130.61:3131/api/health
ss -ltnp '( sport = :3131 )'
```

Expected good indicators from the original install:

- `systemctl is-enabled` → `enabled`
- `systemctl is-active` → `active`
- health JSON like `{"status":"ok","uptime":...,"sessions":0}`
- listener on `0.0.0.0:3131` owned by `bun`

## Reporting style for Mr. Wong

Return concrete status, not setup instructions. Example:

- `chillspwn.service`: active + enabled
- local health: OK
- Tailscale health: OK
- access URLs: local and Tailscale/mobile
