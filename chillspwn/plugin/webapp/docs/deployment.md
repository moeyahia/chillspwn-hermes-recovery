# Deployment and rollback

## Supported shape

The detected production shape is a Linux systemd service running Bun, serving a prebuilt `dist/`, with external environment/state directories and private network exposure. This repository does not include a public-cloud or container deployment contract.

The example unit at `deploy/systemd/chillspwn.service.example` is sanitized and uses conventional paths. It is a core-dashboard starting point, not a drop-in full Hermes/Grok deployment: several current integrations still expect host-specific paths documented in [Integrations](integrations.md). Review every path, user, capability, HOME, and environment value for the target host before installing it.

## Build a candidate

From a reviewed checkout:

```bash
bun install --frozen-lockfile
bun run check
bun audit
```

`bun run check` parses and bundles the production server entry, runs modular server and client typechecking, the Bun tests, both portable Python regressions, and the production frontend build.

For the combined recovery repository, do not install the standalone example below in place of the reviewed integrated units. Use the root [Recovery runbook](../../../../RECOVERY.md), which restores and coordinates `chillspwn-memory.service`, `chillspwn.service`, and `hermes-gateway.service`, the root-only environment/config validator, the pinned Hermes interpreter, Grok OAuth paths, and the memory broker.

## Host preparation

At minimum:

1. Create a dedicated unprivileged service account.
2. Install the pinned Bun runtime and required system tools.
3. Place reviewed application source under a stable path such as `/opt/chillspwn`.
4. Define an explicit secret-injection design. The integrated recovery units use root-owned mode-`0600` systemd environment files that the service cannot reopen; a standalone unit may use another audited secret manager.
5. Provision external Hermes/persona/provider contracts described in [Integrations](integrations.md).
6. Keep runtime logs, state, engagements, and credential files outside `/opt/chillspwn`.
7. Bind to loopback and expose through an authenticated private proxy or SSH tunnel where possible.

Do not copy the live host's HOME symlink arrangement or root-owned state blindly. Make ownership and access explicit for the service account.

## Install the example service

Review and adapt the example before running these host-level commands:

```bash
sudo install -m 0644 deploy/systemd/chillspwn.service.example /etc/systemd/system/chillspwn.service
sudo systemctl daemon-reload
sudo systemctl enable --now chillspwn.service
sudo systemctl status chillspwn.service
```

The example assumes `/opt/chillspwn`, service user/group and HOME for `chillspwn`, and an optional `/etc/chillspwn/chillspwn.env`. If those assumptions are wrong, edit the installed unit before enabling it. Full integrated operation also requires making the documented Hermes, report, and Grok paths available or making those application paths configurable.

The example is intentionally not equivalent to the combined recovery deployment. It does not install the memory broker or Hermes gateway, does not validate `/root/.hermes/config.yaml`, and does not provision isolated Claude/Codex/Grok state. Do not claim full integrated readiness from this one unit.

## Verify

From the host:

```bash
curl --fail --silent --show-error http://127.0.0.1:3131/api/health
journalctl -u chillspwn.service -n 100 --no-pager
```

Then verify, without executing an engagement:

- authentication from the intended client path;
- persona readiness;
- Mission Board read/write behavior;
- provider readiness for each enabled persona;
- WebSocket connection;
- approval and feature-gate settings;
- log/state locations and permissions.

## Network exposure

Do not bind directly to a public interface. If a non-loopback bind is required, configure a strong `DASHBOARD_TOKEN`, TLS at the private ingress, firewall rules, and access logging. Keep the unsafe no-auth escape hatch disabled.

## Rollback

Before deployment, retain:

- the previous reviewed commit/build;
- a compatible encrypted state/database backup;
- the previous environment/service configuration;
- the exact runtime version.

To roll back code:

1. Stop the service.
2. Restore the prior reviewed checkout/build without using destructive Git commands on an unreviewed worktree.
3. Restore state only if the data format is incompatible and the backup matches that code.
4. Start the service and repeat the verification checklist.

## Automation boundary

GitHub Actions validates source only. Deployment automation should not be added until the target environment, artifact promotion, approvals, secret manager, state migration, and rollback policy are all defined.
