# Hardened Command OS recovery runbook

This runbook restores the private source snapshot into the Command OS V2.1
two-service host layout. It never restores credentials from Git and never makes
the service account privileged.

> `scripts/restore.sh` documents and automates the earlier three-service
> `/root/.hermes` layout. It is retained for historical validation only and must
> not be used to deploy V2.1 until it is separately rewritten and rehearsed for
> the `/opt` plus `/var/lib/chillspwn` contract below.

## 1. Verify the source snapshot

Clone the private repository on a trusted host and run:

```bash
./scripts/verify-snapshot.sh
git diff --check
```

Review the exact commit, source manifest, dependency locks, and final secret
scan before copying anything to `/opt`. Operational databases, provider OAuth,
API secrets, logs, conversations, engagement artifacts, and private keys must
come from a separate encrypted recovery system.

## 2. Prepare the service identity

Create or verify the dedicated `chillspwn` user and group. It must have:

- primary group `chillspwn`;
- home `/home/chillspwn`;
- no `root`, `adm`, `sudo`, `docker`, or other supplementary group;
- no sudoers grant;
- no Docker socket access.

Both `chillspwn.service` and `hermes-gateway.service` run as this same
unprivileged identity and explicitly clear supplementary groups and
capabilities. Never compensate for an incorrect path by granting a privileged
group.

## 3. Restore immutable runtime and release files

Install the reviewed pinned runtimes as root-owned, non-service-writable files:

```text
/opt/chillspwn-runtime/bin/bun
/opt/chillspwn-runtime/hermes-venv
/opt/chillspwn/bin/grok
/opt/chillspwn/report-template
```

Authenticate no provider while building. Stage the repository's
`chillspwn/plugin` tree with the reviewed release stager. Do not dereference its
skill aliases with a general-purpose copy command: the stager accepts only the
explicit repository-owned source map and never reads live user-home state.

```bash
install -d -o root -g root -m 0755 /opt/chillspwn/releases/<release-id>
./scripts/stage-chillspwn-release.sh \
  --destination /opt/chillspwn/releases/<release-id>/plugin \
  --dry-run
./scripts/stage-chillspwn-release.sh \
  --destination /opt/chillspwn/releases/<release-id>/plugin \
  --build
./scripts/stage-chillspwn-release.sh \
  --destination /opt/chillspwn/releases/<release-id>/plugin \
  --verify-only
```

The destination must not exist before staging. The script excludes provider
state, environment files, logs, databases, JSONL/MCP records, backups,
archives, caches, prior builds, test output, and source `node_modules`; the
explicit `--build` step installs the lockfile-defined dependencies and builds
inside the isolated root-owned tree. It verifies containment, filenames, size,
ownership, permissions, and the canonical logo hash before publishing the new
directory. Only after all release and runtime gates pass should an operator
atomically repoint `/opt/chillspwn/plugin`. Keep the prior release for rollback.

The Grok commander hook must resolve exactly
`/opt/chillspwn-runtime/bin/bun`; the runtime attestation rejects a mutable Bun
or parent path.

## 4. Restore mutable state

Create `/var/lib/chillspwn` and service-owned mode-`0700` children:

```text
state/
hermes/
claude/
codex/
grok-home/
grok-auth/
brain-vaults/
workspaces/
```

Create `/var/log/chillspwn` as service-owned mode `0700`. Keep sensitive state,
OAuth files, database files, and log files mode `0600`. Restore only provider
state belonging to the intended service identity and account.

The canonical V2 database is:

```text
/var/lib/chillspwn/command-os-v2.sqlite
```

The database remains transactional authority for missions, runs, events,
evidence, learning, and the Second Brain. The Obsidian-compatible vault under
`brain-vaults/` is a synchronized projection/import surface, not a database
replacement. V2.1 has no root memory-broker service dependency.

## 5. Restore workspace access

Preserve existing operator data at `/root/htb/boxes` and `/root/engagements`.
Create the corresponding target directories:

```text
/var/lib/chillspwn/workspaces/htb/boxes
/var/lib/chillspwn/workspaces/engagements
```

Install and enable the exact path-derived units:

```bash
install -m 0644 deployment/systemd/var-lib-chillspwn-workspaces-htb-boxes.mount \
  /etc/systemd/system/var-lib-chillspwn-workspaces-htb-boxes.mount
install -m 0644 deployment/systemd/var-lib-chillspwn-workspaces-engagements.mount \
  /etc/systemd/system/var-lib-chillspwn-workspaces-engagements.mount
systemctl daemon-reload
systemctl enable --now \
  var-lib-chillspwn-workspaces-htb-boxes.mount \
  var-lib-chillspwn-workspaces-engagements.mount
```

Confirm both mappings with `findmnt` and verify intended access as
`chillspwn`. The application allowlist contains only the two target paths, not
`/root`.

## 6. Restore protected configuration and OAuth

Create root-owned mode-`0600` environment files from a password manager or
encrypted offline backup:

```text
/etc/chillspwn/chillspwn.env
/etc/hermes-gateway.env
```

Use [`hermes/runtime/runtime.env.example`](hermes/runtime/runtime.env.example)
and [`chillspwn/plugin/webapp/.env.example`](chillspwn/plugin/webapp/.env.example)
for names and safe path defaults only. Never print or copy live values into a
deployment report.

Refreshable OAuth state is service-owned because provider CLIs must update it
atomically. In particular, Grok uses
`/var/lib/chillspwn/grok-auth/auth.json` and OAuth usage rather than xAI API
credits. Reauthenticate interactively as the same service identity when a
stored session cannot be safely restored.

## 7. Migrate and verify data

With every legacy writer stopped:

1. run the V2 migration dry run against the exact source roots;
2. review inventory, hashes, source stability, WAL state, disk headroom,
   exclusions, and redaction;
3. run backup-first migration;
4. run database verification and reconciliation;
5. review quarantine and representative metadata without printing user content;
6. restore the recorded backup to a non-production copy and verify its checksum
   and integrity;
7. retain legacy originals until cutover acceptance and rollback expiry.

Follow the detailed [migration guide](chillspwn/plugin/webapp/docs/command-os-v2/migration.md).

## 8. Install and start the services

Install the two tracked services. Do not install the legacy memory-broker unit
or warm drop-in.

```bash
install -m 0644 deployment/systemd/hermes-gateway.service \
  /etc/systemd/system/hermes-gateway.service
install -m 0644 deployment/systemd/chillspwn.service \
  /etc/systemd/system/chillspwn.service
systemd-analyze verify \
  /etc/systemd/system/var-lib-chillspwn-workspaces-htb-boxes.mount \
  /etc/systemd/system/var-lib-chillspwn-workspaces-engagements.mount \
  /etc/systemd/system/hermes-gateway.service \
  /etc/systemd/system/chillspwn.service
systemctl daemon-reload
systemctl enable hermes-gateway.service chillspwn.service
systemctl start hermes-gateway.service
systemctl start chillspwn.service
```

Docker MCP remains disabled (`MCP_ARSENAL_ALLOW_DOCKER=false`).

## 9. Acceptance

Run the source release gate, then verify the deployed system:

- `/api/health` and `/api/v2/health`;
- expected release, Bun, Python, provider, and MCP readiness;
- process UID/GID, empty supplementary groups/capabilities, sudo denial, and
  Docker-socket denial;
- canonical database integrity and event-stream replay;
- unchanged logo and exactly two journeys;
- harmless Guided exact-step and Autonomous delegated runs;
- safe stop, cancellation cleanup, and process-level restart/resume;
- memory scope, correction, forgetting, vault export, and conflict handling;
- bind-mount identity and workspace containment.

Use no real external target for deployment smoke. Record only identifiers,
hashes, counts, timestamps, and status summaries.

## 10. Rollback

Keep the prior release, matching unit/config hashes, pre-migration database
backup, provider-state/vault/artifact manifests, mount/ACL record, and service
state. Rehearse rollback on copies before promotion. Never restore privileged
groups, passwordless sudo, Docker access, a root HOME, or direct root-memory
access to make an obsolete release run.

Follow the full [rollback runbook](chillspwn/plugin/webapp/docs/command-os-v2/rollback.md).
