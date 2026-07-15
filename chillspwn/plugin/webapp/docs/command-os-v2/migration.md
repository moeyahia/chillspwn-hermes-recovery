# Legacy-data migration and rollback

The implemented migration is backup-first, resumable, hash-addressed, idempotent, and reversible. It is deliberately conservative: uncertain authorization, engagement correlation, or memory scope is never guessed.

Implementation entry point: `server/migration/cli.ts`.

## Supported inputs

Discovery is allowlist-based and accepts only:

- runtime run JSON under `runtime/runs/`;
- dashboard session JSON, excluding `request_dump_*`;
- runtime event JSONL;
- raw LLM/session JSONL;
- dashboard text/JSON logs;
- structured memory `runtime/memory/items.json`;
- training lessons `runtime/training/lessons.json`;
- artifact files below an artifact directory;
- legacy `kanban.db`;
- Hermes `state.db` sessions/messages.

Authentication files, `.env` files, credentials, keys, tokens, request dumps, shell snapshots, backups, caches, build output, symlinks, and unrelated files are not selected. Never point the migration at an untrusted filesystem tree.

## Safety model

Before the first canonical import, the migrator:

1. applies the current canonical schema;
2. creates and integrity-checks a timestamped database backup;
3. copies every selected source into a mode-`0600` source backup;
4. verifies every copied file by byte size and SHA-256;
5. records source path, type, hash, timestamp, and backup path;
6. imports each item transactionally with deterministic IDs;
7. records malformed or unsafe items in quarantine without retaining raw secret values there;
8. runs SQLite quick-check and foreign-key reconciliation;
9. writes `source-manifest.tsv`, `reconciliation.json`, and rollback metadata.

Original source files are never modified or deleted. A source that changes while being copied is retried only within a small bound and then rejected. A SQLite source with a non-empty WAL is rejected: stop its writer and perform the application's normal checkpoint before migration so the protected database copy is complete.

Raw confidential content remains in the protected backup. Canonical messages, evidence previews, logs, candidates, and lessons are recursively redacted. Private provider reasoning payloads are omitted from displayable messages. Private keys, credentials, tokens, flags, and hashes do not enter reusable memory. Target-specific or HTB-box-specific lessons are quarantined rather than generalized automatically.

Legacy missions are imported as `guided`, authorization-unverified records. A nonterminal legacy run becomes `blocked` and is never resumed automatically. Preferences remain memory candidates and lessons remain `proposed`, even if a legacy file claimed they were verified.

## Preflight and dry run

Stop or quiesce the dashboard, runtime workers, Hermes session writer, and Kanban dispatcher before a real migration. Discover the active paths from service configuration rather than assuming them.

The output directory must be outside every source root; this prevents a later run from rediscovering its own protected backups.

```bash
bun run server/migration/cli.ts migrate \
  --db /path/to/command-os.sqlite \
  --source /path/to/chillspwn-state \
  --source /path/to/hermes-state \
  --output /path/to/migration-backups \
  --dry-run
```

Dry run performs allowlisted discovery, source hashing, and read-only database validation. It creates only a reconciliation report under the output directory; it does not create migration metadata, a database backup, or canonical rows.

Review:

- every included and excluded path;
- total bytes and hashes;
- available disk space for both backups;
- whether selected SQLite stores are quiescent;
- whether the canonical database path is correct.

## Migration

```bash
bun run server/migration/cli.ts migrate \
  --db /path/to/command-os.sqlite \
  --source /path/to/chillspwn-state \
  --source /path/to/hermes-state \
  --output /path/to/migration-backups
```

The command returns only the migration ID, report path, and counts. It does not print source content.

## Resume

If the process stops after a migration run was created, use the original database, source roots, and output directory:

```bash
bun run server/migration/cli.ts migrate \
  --db /path/to/command-os.sqlite \
  --source /path/to/chillspwn-state \
  --source /path/to/hermes-state \
  --output /path/to/migration-backups \
  --resume migration_UUID
```

Resume refuses mismatched paths. Completed items are recognized by source SHA-256, stable item key, item hash, and importer version; they are not written twice. Failed or incomplete sources continue from their durable migration metadata.

## Verification and reconciliation

```bash
bun run server/migration/cli.ts verify --db /path/to/command-os.sqlite

bun run server/migration/cli.ts reconcile \
  --db /path/to/command-os.sqlite \
  --migration-id migration_UUID
```

The reconciliation report includes source and target counts, deduplication, quarantine, skipped items, source hashes, backup paths, quick-check output, foreign-key violations, and operational warnings. Quarantine review must precede cutover.

## Rollback

Rollback replaces the database image, so the ChillsPwn server and all workers must be stopped first. Use the exact path and SHA-256 from `reconciliation.json`:

```bash
bun run server/migration/cli.ts restore \
  --db /path/to/command-os.sqlite \
  --backup /path/to/pre-legacy-import-TIMESTAMP.sqlite \
  --sha256 HASH_FROM_RECONCILIATION \
  --service-stopped
```

The restore verifies the backup integrity and checksum, preserves the current database and sidecars as a mode-`0600` pre-rollback safety copy, removes stale WAL/SHM sidecars, and atomically installs the backup. Start the service only after `verify` succeeds.

## Package scripts

The migration commands are exposed through `package.json`; pass the documented
arguments after `--`, for example `bun run db:verify -- --db /path/to/command-os.sqlite`:

```json
{
  "db:migrate:legacy": "bun run server/migration/cli.ts migrate",
  "db:verify": "bun run server/migration/cli.ts verify",
  "db:backup": "bun run server/migration/cli.ts backup",
  "db:reconcile": "bun run server/migration/cli.ts reconcile",
  "db:restore": "bun run server/migration/cli.ts restore"
}
```

## Cutover gate

Do not stop compatibility reads or remove original files until:

- all copied source checksums match;
- quick-check and foreign-key reconciliation pass;
- quarantine is reviewed;
- representative missions, conversations, evidence metadata, lesson candidates, and timestamps are checked;
- engagement isolation and secret redaction are checked;
- the rollback command has been tested on a non-production copy;
- the operator explicitly approves cutover.

After cutover, stop legacy dual-writing. Keep the timestamped source bundle, pre-import database, reconciliation report, and rollback instructions for the documented acceptance window.
