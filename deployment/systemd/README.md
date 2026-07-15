# Hardened systemd deployment

These units describe the Command OS V2.1 host contract. They contain paths and
safe defaults only; credentials are injected from root-owned mode-`0600`
environment files outside the repository.

## Active unit set

- `chillspwn.service` runs the dashboard and runtime as `chillspwn`.
- `hermes-gateway.service` runs Hermes adapters and scheduling as `chillspwn`.
- `var-lib-chillspwn-workspaces-htb-boxes.mount` bind-mounts the existing HTB
  workspace into the service namespace.
- `var-lib-chillspwn-workspaces-engagements.mount` does the same for engagement
  workspaces.

The pre-V2 memory broker is retained only under `deployment/legacy/` and is not
part of the V2.1 unit dependency graph. Command OS memory is canonical in
`/var/lib/chillspwn/command-os-v2.sqlite`; Obsidian-compatible projections live
under `/var/lib/chillspwn/brain-vaults`.

## Filesystem contract

Root-controlled, non-service-writable paths:

- `/opt/chillspwn/releases/<release-id>` and the atomic
  `/opt/chillspwn/plugin` symlink;
- `/opt/chillspwn-runtime/bin/bun`;
- `/opt/chillspwn-runtime/hermes-venv`;
- `/opt/chillspwn/report-template`;
- `/opt/chillspwn/bin/grok`;
- `/etc/systemd/system/*.service` and `*.mount`.

Service-owned mode-`0700` state roots:

- `/var/lib/chillspwn/state`;
- `/var/lib/chillspwn/hermes`;
- `/var/lib/chillspwn/claude`;
- `/var/lib/chillspwn/codex`;
- `/var/lib/chillspwn/grok-home`;
- `/var/lib/chillspwn/grok-auth`;
- `/var/lib/chillspwn/brain-vaults`;
- `/var/lib/chillspwn/workspaces`.

The canonical SQLite file and refreshable OAuth files are service-owned mode
`0600`. Logs are under service-owned `/var/log/chillspwn` with restrictive
permissions. API secrets remain in `/etc/chillspwn/chillspwn.env` and
`/etc/hermes-gateway.env`, owned by root and mode `0600`; do not put live values
in a unit or repository file.

## Release staging

Never copy the plugin with an ad hoc `rsync -aL`. The plugin contains reviewed
repository-relative aliases to shared Hermes skills, and release materialization
must not follow mutable user-home or runtime paths. Use the fail-closed stager
from a root-owned checkout:

```bash
install -d -o root -g root -m 0755 /opt/chillspwn/releases/<release-id>
./scripts/stage-chillspwn-release.sh \
  --destination /opt/chillspwn/releases/<release-id>/plugin \
  --dry-run
./scripts/stage-chillspwn-release.sh \
  --destination /opt/chillspwn/releases/<release-id>/plugin \
  --build
```

The destination must not already exist. `--build` is deliberate: only that
option installs the locked Bun dependencies and creates the client build inside
the isolated staging directory. The stager rejects unknown or external
symlinks, unsafe filenames, mutable state, oversized files, writable output,
and a changed logo before atomically moving the completed tree into place.
Recheck a staged tree without changing it with:

```bash
./scripts/stage-chillspwn-release.sh \
  --destination /opt/chillspwn/releases/<release-id>/plugin \
  --verify-only
```

Promotion of `/opt/chillspwn/plugin` remains a separate, explicit operation
after validation; the staging script never changes the active symlink or a
service.

## Installation order

1. Create the source and target workspace directories. The mount unit names are
   derived from their `Where=` paths and must not be renamed.
2. Install and enable the two `.mount` units before either application service.
3. Install the two service units and validate all four units with
   `systemd-analyze verify`.
4. Confirm `id chillspwn` lists only its primary group and that passwordless
   `sudo` is unavailable.
5. Start `hermes-gateway.service`, then `chillspwn.service`.
6. Verify both health endpoints, provider readiness, database integrity, vault
   scope, mount identity, and the no-hands action boundary.

The shipped service units explicitly clear supplementary groups, capabilities,
and ambient capabilities. Docker MCP execution is disabled because membership
in the Docker group or access to its socket is root-equivalent. Enable no
additional group, device, socket, or write path without a separate threat-model
review.

See the [deployment gate](../../chillspwn/plugin/webapp/docs/command-os-v2/deployment.md)
and [rollback runbook](../../chillspwn/plugin/webapp/docs/command-os-v2/rollback.md)
before promotion.
