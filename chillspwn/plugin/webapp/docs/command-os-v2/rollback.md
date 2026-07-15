# Command OS V2.1 rollback

This runbook covers the hardened two-service release. See
[`deployment.md`](deployment.md) for promotion and [`migration.md`](migration.md)
for database commands.

## Required rollback record

Before promotion, record without secret values:

- candidate and prior immutable release paths and commit/build IDs;
- `/opt/chillspwn/plugin` symlink target;
- Bun, Python, Hermes, Claude, Codex, and Grok versions;
- installed service, mount, and drop-in file hashes;
- service load/active/enabled states;
- environment-file paths and key names only;
- database backup path, size, SHA-256, schema version, and integrity result;
- vault/artifact/provider-state backup manifests and hashes;
- workspace source/target mount mapping and ACL backup;
- ownership/mode inventory for `/opt/chillspwn*`, `/var/lib/chillspwn`, and
  `/var/log/chillspwn`;
- the last accepted event sequence and any nonterminal run/checkpoint IDs.

Backups containing provider or engagement state require restrictive permissions
and encryption. They do not belong in GitHub.

## Fast application rollback

Use this path only when the prior release supports the current canonical schema.

1. Block new launches and pause or cancel in-flight work through the supervisor.
2. Drain event subscribers and vault sync, then create a fresh online database
   backup and artifact/vault manifests so rollback cannot erase the only copy of
   new evidence.
3. Stop both writers:

   ```bash
   systemctl stop chillspwn.service hermes-gateway.service
   ```

4. Verify both units and their child process groups are inactive. Check for
   nonempty SQLite WAL/SHM state before any offline copy.
5. Atomically repoint `/opt/chillspwn/plugin` to the recorded prior immutable
   release. Do not modify either release tree.
6. Restore the matching prior unit/environment configuration only if its hashes
   match the rollback record. Keep both services unprivileged, with empty
   supplementary groups and no capabilities.
7. Run `systemd-analyze verify`, database integrity/readiness checks, and the
   source-level compatibility gate before starting Hermes and then ChillsPwn.
8. Verify health, mounted workspace roots, provider readiness, event sequence,
   checkpoint truth, and absence of ghost-active work.

Do not use `git reset`, a mutable worktree, or an unrecorded build as a release
rollback mechanism.

## Database rollback

If the prior release cannot read the current schema, keep both services stopped:

1. Preserve the current database, `-wal`, and `-shm` files as a separately
   checksummed incident/reconciliation set.
2. Verify the selected pre-migration backup's recorded SHA-256 and SQLite
   integrity.
3. Restore into a temporary non-production path first and run the matching
   release's verifier.
4. Restore the verified backup to the canonical path using the migration
   restore command and explicit stopped-service gate. Never reverse-transform
   into legacy JSON.
5. Reapply `chillspwn:chillspwn` ownership and mode `0600` to the database and
   sidecars before start.
6. Reconcile artifacts, vault projections, and events created after the backup;
   never silently discard newer immutable evidence or audit records.

Legacy source files remain untouched throughout the migration rollback window.

## Workspace mount rollback

The V2 service allowlist points at:

```text
/var/lib/chillspwn/workspaces/htb/boxes
/var/lib/chillspwn/workspaces/engagements
```

The tracked `.mount` units map existing `/root/htb/boxes` and
`/root/engagements` data to those paths. Leave the mounts enabled for any prior
release that supports configurable workspace roots. To remove them, first stop
both application services, verify no process has an open file below either
target, unmount/disable the units, and restore the recorded target-directory
ownership. Removing a bind mount never authorizes deletion of its source data.

Do not restore broad `/root` traversal ACLs, `root`/`adm`/`sudo` group membership,
passwordless sudo, or Docker access merely because a legacy release depended on
them. Such a release is not a safe rollback target; safe-stop and adapt it to the
V2 filesystem contract first.

## OAuth, vault, and state rollback

- Refreshable OAuth remains in its dedicated service-owned `0700` directory
  with files mode `0600`; never copy it into a release or Git archive.
- Preserve provider state by provider and timestamp. Do not merge OAuth stores
  from different service identities or accounts.
- Stop vault sync before restoring a vault. Back up both sides of every conflict
  and never modify `.obsidian` settings during application rollback.
- Keep the SQLite database authoritative. Vault notes are a synchronized
  projection/import surface, not a substitute transaction log.
- Restore `/etc/chillspwn/chillspwn.env` and `/etc/hermes-gateway.env` only from
  the restricted rollback bundle and validate owner/mode without printing them.

## Rehearsal required before promotion

On isolated copies:

1. start the candidate against a copied canonical database and vault;
2. create one harmless nonterminal run and one vault note;
3. stop cleanly and back up database, artifacts, provider-state metadata, and
   vault;
4. switch to the prior release and restore only its compatible database;
5. verify health, integrity, mounts, and truthful run/lease state;
6. return to the candidate and verify forward recovery;
7. record checksums, elapsed time, unit state, and outcomes without user content.

## Abort conditions

Abort rollback and preserve every copy when:

- release/database compatibility is unknown;
- any checksum or SQLite integrity check fails;
- a writer, vault watcher, migration, or event worker remains active;
- restore would overwrite the only copy of newer evidence or audit data;
- the selected release requires privileged groups, passwordless sudo, Docker
  socket access, a root HOME, or direct root-memory access;
- source/target workspace identity is ambiguous;
- OAuth ownership does not match the service identity.

Escalate to manual reconciliation instead of weakening the hardened boundary.
