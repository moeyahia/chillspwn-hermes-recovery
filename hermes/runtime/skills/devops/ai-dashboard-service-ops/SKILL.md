---
name: ai-dashboard-service-ops
description: "Operate and harden custom local AI dashboards/webapps as long-running services: start/restart, systemd autostart, health checks, log paths, and mobile/Tailscale reachability verification."
---

# AI Dashboard Service Operations

Use this skill when the user asks to start, restart, keep alive, autostart, or troubleshoot a custom AI dashboard or local web application such as ChillsPwn, Hermes-adjacent dashboards, Claude/Codex wrappers, or other locally hosted agent UIs.

## Core approach

1. **Act directly and verify results.** Mr. Wong prefers execution + concrete status, not instructions. Start/restart the service, install persistence if requested, then report verified endpoints and service state.
2. **Preserve the app's known run semantics.** For dashboards that wrap agent subprocesses, use the exact known startup flags. Do not substitute hot-reload/dev wrappers if the app has documented process-survival requirements.
3. **Use a real process manager for boot persistence.** Prefer `systemd` for machine restart survival over shell backgrounding, `nohup`, or terminal-managed background sessions.
4. **Verify at three layers before finalizing:**
   - process manager: `systemctl is-enabled` and `systemctl is-active`
   - process/listener: expected command is running and expected port is listening
   - application: health endpoint or UI route returns success locally and, if relevant, over Tailscale/VPN
5. **Keep logs predictable.** Route stdout/stderr to a durable log path under the app's state directory so future debugging starts from one known file.

## Systemd deployment pattern

For a local dashboard service:

1. Stop any stale/manual process for the same app before handing ownership to systemd.
2. Create `/etc/systemd/system/<app>.service` with:
   - `WorkingDirectory=` set to the app root
   - explicit `Environment=PATH=...` for non-system runtimes like Bun/Node installed under `/root`
   - `ExecStart=` containing the exact production command
   - `Restart=always` and a small `RestartSec=`
   - `After=network-online.target` and `Wants=network-online.target` when network reachability matters
   - append logs to the app's durable log file if supported by the installed systemd
3. Run `systemctl daemon-reload`, `systemctl enable <app>`, and `systemctl restart <app>`.
4. Verify enabled, active, health, listener, and remote/VPN endpoint if applicable.

## Pitfalls

- **Do not leave the app owned by a terminal background job** if the user asked for restart persistence. A background tool session is fine only as a temporary bring-up before installing systemd.
- **Do not use Bun hot reload for process-wrapping dashboards** unless the app explicitly supports it. Hot reload can terminate detached child agent processes.
- **Do not stop at `systemctl active`.** A service can be active while the app is broken. Always hit the health endpoint or UI route.
- **Do not report a mobile/VPN URL as working unless you actually checked that address or clearly label it unverified.**
- **Writing under `/etc/systemd/system` may require terminal/sudo** even when file-write tools refuse sensitive paths. Use terminal with a heredoc only for this system config case, then verify.
- **Do not assume WebSocket disconnects are app crashes.** For dashboard UIs accessed over Tailscale/VPN, correlate WebSocket logs with `journalctl -k`, `journalctl -u tailscaled`, and CPU load. VM scheduling stalls and Tailscale time jumps can drop browser WebSockets while the Bun service and health endpoint remain healthy.
- **When asked if a dependency is "up," answer from live evidence.** Check service enablement/activity, process presence, interfaces/routes, and the app health endpoint as applicable; return concise status instead of commands.

## ChillsPwn quick reference

See `references/chillspwn-systemd.md` for the known-good ChillsPwn service recipe, paths, health checks, and verification outputs from the session that installed boot autostart.

See `references/chillspwn-connectivity-troubleshooting.md` for fast probes to answer whether ChillsPwn, Tailscale, OpenVPN, or the Claude subprocess are up, plus the diagnostic workflow for WebSocket disconnects caused by VM stalls/Tailscale time jumps rather than app crashes.
