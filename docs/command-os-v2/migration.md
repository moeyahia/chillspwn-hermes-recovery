# Legacy data migration

Status: backup-first, hash-addressed discovery/import, dry run, resume,
deduplication, quarantine, reconciliation, and checksum-gated database restore
are implemented. A production-source reconciliation has not been authorized.

## Source discovery

The importer accepts explicitly configured roots and recognizes runtime run
JSON, event/raw-LLM JSONL, session JSON/JSONL, dashboard logs, memory and
training JSON, artifact directories, Kanban SQLite, and Hermes state SQLite.
Missing roots are reported. Symlinks, generated/build/cache trees, backups,
credential/secret/key filenames, request dumps, and private-key content are
excluded.

Every included file is real-path checked, timestamped, sized, and SHA-256
hashed. A source that changes during backup is retried only within a fixed
bound. SQLite sources with a live non-empty WAL are rejected until quiesced and
checkpointed.

## Migration transaction and provenance

Dry run performs discovery, hashing, and reconciliation only. A live import:

1. integrity-checks or creates the dedicated V2 database;
2. creates a timestamped canonical database backup;
3. copies and verifies immutable source backups before importing a row;
4. records source hashes, paths, timestamps, type, and checkpoints;
5. imports deterministically with stable IDs and source provenance;
6. deduplicates by hash/identity and quarantines malformed or secret-bearing
   candidates;
7. keeps historical nonterminal runs blocked rather than resuming them;
8. runs quick check and foreign-key reconciliation;
9. writes a machine-readable reconciliation report.

Resume validates the same database, output path, roots, and complete registered
inventory. Rollback requires the V2 service stopped and a checksum-matching
backup; original legacy sources are never rewritten.

## Command surface

The package exposes `db:migrate:legacy`, `db:reconcile`, `db:verify`,
`db:backup`, and `db:restore`. A disposable database backup/restore/verify cycle
has passed. Obsidian import/export has separate Vault commands.

## Release gaps

No production engagement directories have been migrated in this worktree.
Required before cutover: authorized roots, dry-run review, random sample
verification, duplicate second run, interrupted resume, screenshots/artifact
links, no-404 route crawl, Vault link reconciliation, secret review, legacy
source non-mutation proof, and signed rollback rehearsal.
