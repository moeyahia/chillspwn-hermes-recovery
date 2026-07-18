# Command OS V2.1 deployment gate

This is the release gate for the hardened V2.1 host. Repository-wide context is
in [`../deployment.md`](../deployment.md), migration details are in
[`migration.md`](migration.md), and rollback is in [`rollback.md`](rollback.md).

## Deployment boundary

A source checkout or successful local build does not prove the installed
service. V2.1 is accepted only when a reviewed immutable release is promoted,
the canonical database is reconciled, and the deployed smoke suite passes.

The target boundary is:

- immutable, root-controlled release:
  `/opt/chillspwn/releases/<release-id>`;
- atomic current-release symlink: `/opt/chillspwn/plugin`;
- root-controlled Bun: `/opt/chillspwn-runtime/bin/bun`;
- root-controlled Hermes virtual environment:
  `/opt/chillspwn-runtime/hermes-venv`;
- root-controlled report tree: `/opt/chillspwn/report-template`;
- service-owned state root: `/var/lib/chillspwn`;
- canonical database: `/var/lib/chillspwn/command-os-v2.sqlite`;
- Obsidian-compatible vault root: `/var/lib/chillspwn/brain-vaults`;
- service logs: `/var/log/chillspwn`;
- only two application services: `chillspwn.service` and
  `hermes-gateway.service`, both running as `chillspwn` with no supplementary
  groups or capabilities.

The V2.1 services have no `chillspwn-memory.service` dependency. Canonical
memory is in SQLite and its controlled vault projection. Docker MCP is disabled
and the service account must not receive Docker-group/socket access.

## Pre-deployment release gate

From the reviewed webapp checkout:

```bash
bun install --frozen-lockfile
bun run check:server-entry
bun run typecheck
bun run typecheck:client
bun run typecheck:e2e
bun test ./server ./src/lib --timeout 30000
python3 integration/test_or_gate_client.py
python3 integration/test_board_mcp_server.py
bun run build
bun run performance:bundle
bun run performance:runtime
bun run test:e2e:run
bun audit
```

Also require:

- `git diff --check`;
- final secret and reviewed static-analysis scans;
- `sha256sum public/Logo.svg` equals
  `0a3dfd69f74a00d41bb0cb20d6af1097dffa265d4c1e54c9228fe4b55f85c955`;
- all P0 items in the [completion gap audit](completion-gap-audit.md) closed or
  explicitly deferred by the operator;
- an intentional candidate commit rather than an uncommitted worktree;
- successful validation of the root-controlled Bun and Hermes interpreter as
  the service identity.

`bun run check` does not replace browser, live-provider, migration,
restart/resume, or deployed security acceptance.

## Filesystem and identity preparation

Before changing a running service:

1. Record the current release target, units/drop-ins, runtime versions,
   environment-key names, database/vault paths, and checksums without recording
   secret values.
2. Stop new mission launches and quiesce dashboard, gateway, migration, vault,
   and legacy writers.
3. Back up the current release, databases, provider state, artifacts, vault,
   unit files, environment files, and filesystem ACLs into a restricted
   encrypted recovery location.
4. Verify `chillspwn` belongs only to its primary group and has neither
   passwordless sudo nor Docker-socket access.
5. Install the candidate at a unique root-owned release directory. The service
   must not be able to write the release, Bun, Hermes venv, Grok executable, or
   report template.
6. Create service-owned mode-`0700` state directories for `state`, `hermes`,
   `claude`, `codex`, `grok-home`, `grok-auth`, `brain-vaults`, and `workspaces`.
   Keep SQLite and OAuth files mode `0600`.
7. Create `/var/log/chillspwn` as service-owned mode `0700` and configure log
   rotation without broadening access.
8. Keep `/etc/chillspwn/chillspwn.env` and `/etc/hermes-gateway.env` root-owned
   mode `0600`; systemd injects values before the user transition. Never copy
   those files into a release or backup intended for GitHub.

`HOME=/home/chillspwn`; provider state is selected explicitly with
`HERMES_HOME`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GROK_HOME`, and
`GROK_AUTH_PATH`. No service path requires traversal of `/root` except the
kernel-managed source side of the two bind mounts.

## Workspace bind mounts

The service allowlist is exactly:

```text
/var/lib/chillspwn/workspaces/htb/boxes
/var/lib/chillspwn/workspaces/engagements
```

The tracked mount units preserve existing data at `/root/htb/boxes` and
`/root/engagements` without granting the service general `/root` traversal.
Create both source and target directories first, install the units with their
exact path-derived names, then enable them:

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

Verify `findmnt` reports the expected source for each target and verify
read/write behavior as `chillspwn`. Never substitute `/root`, a provider-auth
directory, reviewed source, or an unrestricted filesystem root.

## Migration and cutover order

1. Run the legacy migration dry run against the exact production source roots.
2. Review inventory, byte count, disk headroom, source stability, WAL state,
   included/excluded paths, and redaction controls.
3. With all writers stopped, run the backup-first migration.
4. Run `db:verify` and `db:reconcile`; review every quarantine category.
5. Verify representative metadata, timestamps, evidence hashes, memory
   lifecycle, lesson status, engagement isolation, and secret redaction without
   printing user content.
6. Restore the recorded database backup into a non-production copy, verify its
   checksum and integrity, and record the rehearsal.
7. Only then accept SQLite as canonical and stop permanent legacy dual-writing.

Legacy originals remain untouched until the operator accepts cutover and the
rollback window expires.

## Candidate promotion

Install and build the release with the pinned root-controlled Bun, normalize it
to root ownership with no group/other write access, and atomically update
`/opt/chillspwn/plugin`. Preserve the prior symlink target.

Install the tracked service units and validate the complete set before start:

```bash
systemd-analyze verify \
  deployment/systemd/var-lib-chillspwn-workspaces-htb-boxes.mount \
  deployment/systemd/var-lib-chillspwn-workspaces-engagements.mount \
  deployment/systemd/hermes-gateway.service \
  deployment/systemd/chillspwn.service
systemctl daemon-reload
systemctl start hermes-gateway.service
systemctl start chillspwn.service
```

Do not install the legacy memory-broker unit or warm drop-in. Do not add
supplementary groups to compensate for an incorrect path permission; correct
the explicit path boundary instead.

## Post-start smoke and acceptance

Verify without using a real external target:

1. Unit liveness, `/api/health`, `/api/v2/health`, SQLite integrity, event-stream
   readiness, provider readiness, and MCP readiness.
2. The running process resolves to the promoted release and uses the pinned Bun
   and Hermes interpreter.
3. Command Center loads the unchanged logo and exactly two journey entries.
4. SSE reconnect/replay and bounded polling fallback.
5. A harmless Guided mission explains first, authorizes one exact represented
   step, captures bounded evidence, and interprets the result.
6. A harmless Autonomous mission delegates to an enforceable local specialist,
   completes without routine input, and creates a terminal evaluation.
7. Out-of-contract work safe-stops without asking for approval.
8. Cancellation clears child work, leases, sessions, and assignments.
9. A process-level restart resumes or safely blocks nonterminal work from its
   checkpoint without duplicating an unsafe action.
10. Memory retrieval respects journey and engagement scopes; correction and
    forgetting affect the next retrieval.
11. An isolated vault export produces valid YAML/wikilinks, detects a concurrent
    edit conflict, and resolves it explicitly.
12. Docker MCP remains unavailable and the service cannot invoke `sudo` or
    access the Docker socket.

Record trace/record IDs, timestamps, hashes, counts, and status summaries only.
Never include tokens, credentials, raw prompts, or confidential evidence in the
deployment report.

## Cutover acceptance

Cutover is complete only when the running service reports the reviewed build,
the canonical database reconciles, all required smoke tests pass, no ghost work
remains, the rollback rehearsal passed, and the operator explicitly accepts the
release.
