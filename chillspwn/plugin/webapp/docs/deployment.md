# Deployment and rollback

The supported production shape is a private Linux host with systemd, a
root-controlled immutable release under `/opt`, and service-owned runtime state
under `/var/lib/chillspwn`. The dashboard binds to loopback and is exposed only
through an authenticated private proxy or SSH tunnel. This repository does not
define a public-cloud or container deployment contract.

Follow the detailed [Command OS V2.1 deployment gate](command-os-v2/deployment.md)
and [rollback runbook](command-os-v2/rollback.md). The sanitized units are under
the repository-level [`deployment/systemd`](../../../../deployment/systemd)
directory; the local [`deploy/systemd/chillspwn.service.example`](../deploy/systemd/chillspwn.service.example)
is a dashboard-only reference.

## Supported host contract

- Both `chillspwn.service` and `hermes-gateway.service` run as the unprivileged
  `chillspwn` identity with an empty supplementary-group set.
- Application releases, Bun, the Hermes virtual environment, Grok executable,
  and report templates are root-owned and non-service-writable below `/opt`.
- Mutable application, provider, OAuth, SQLite, and vault state is narrowly
  service-owned below `/var/lib/chillspwn`.
- Existing `/root/htb/boxes` and `/root/engagements` data is exposed only at the
  configured `/var/lib/chillspwn/workspaces/...` paths through the tracked bind
  mounts.
- Command OS SQLite and the Obsidian-compatible vault replace the legacy root
  memory-broker dependency.
- Docker MCP execution is disabled. Do not grant the service Docker socket or
  Docker-group access.
- Secrets are injected from root-owned mode-`0600` environment files; they are
  never stored in release files or units.

## Build and validate a candidate

From a reviewed checkout:

```bash
bun install --frozen-lockfile
bun run check
bun audit
```

`bun run check` validates the server entry, strict server/client types, unit
tests, portable Python regressions, and production frontend build. The V2 gate
adds browser, migration, provider, restart/resume, performance, secret-scan,
and deployed smoke requirements. Never promote an uncommitted worktree.

## Release promotion

Stage each reviewed candidate at a unique
`/opt/chillspwn/releases/<release-id>` path, install dependencies with the pinned
root-controlled Bun, build it, remove group/other write permission, then update
`/opt/chillspwn/plugin` atomically. Never overwrite the prior release.

Before starting services, create and permission the documented state/log roots,
install the two `.mount` units and two `.service` units, and run:

```bash
systemd-analyze verify \
  /etc/systemd/system/var-lib-chillspwn-workspaces-htb-boxes.mount \
  /etc/systemd/system/var-lib-chillspwn-workspaces-engagements.mount \
  /etc/systemd/system/hermes-gateway.service \
  /etc/systemd/system/chillspwn.service
systemctl daemon-reload
```

Do not start the candidate until the migration backup, verification,
reconciliation, and non-production restore rehearsal pass.

## Verification

```bash
curl --fail --silent --show-error http://127.0.0.1:3131/api/health
curl --fail --silent --show-error http://127.0.0.1:3131/api/v2/health
systemctl status hermes-gateway.service chillspwn.service --no-pager
```

Also verify database integrity, event streaming, exactly two journey entries,
provider/MCP readiness, a harmless Guided exact-step run, a harmless Autonomous
delegated run, cancellation cleanup, restart/resume, memory scope/forgetting,
and Obsidian projection/conflict handling. Record identifiers and status only;
do not copy raw credentials, prompts, or engagement evidence into deployment
reports.

## Network exposure

Do not bind directly to a public interface. For any non-loopback bind, require a
strong `DASHBOARD_TOKEN`, TLS at private ingress, firewall restrictions, and
access logging. Keep the unsafe no-auth escape hatch disabled.

## Automation boundary

GitHub Actions validates source only. Host promotion, migration, OAuth setup,
secret injection, and rollback remain explicit operator-controlled operations.
