# Command OS V2 operational scripts

## Live Grok restart/resume smoke

`test:live:grok-restart-resume` is an opt-in deployment check, not a portable
CI test. It starts the real server twice against a disposable database, kills
the first process group while a Grok OAuth planning turn is durably in flight,
waits for the lease to expire, and verifies deterministic recovery and exactly
one no-op specialist tool result.

Run it only from a root-controlled installed checkout as the unprivileged
ChillsPwn service account. The account must own its refreshable Grok OAuth file.
Supply the file path, never its contents:

```bash
CHILLSPWN_LIVE_RESTART_CONFIRM=authorized-local-selftest-restart-resume \
CHILLSPWN_LIVE_RESTART_SERVICE_USER=chillspwn \
CHILLSPWN_LIVE_RESTART_PORT=34131 \
GROK_AUTH_PATH=/absolute/service-owned/path/to/grok-auth.json \
bun run test:live:grok-restart-resume
```

The harness rejects UID 0, port 3131, occupied ports, relative authentication
paths, writable/unreviewed assets, and MCP configurations containing anything
other than `local-selftest.quick_scan`. It does not read or print OAuth content.
The temporary HOME, state directory, SQLite database, vault, sessions, and
workspace are removed after graceful shutdown, including failure cleanup.

The portable safety checks are:

```bash
bun test server/command-runtime/__tests__/LiveGrokRestartSmokeSafety.test.ts
```
