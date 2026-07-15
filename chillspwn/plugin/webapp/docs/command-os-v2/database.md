# Canonical database

The Command OS database uses `better-sqlite3`, WAL, foreign keys, a bounded busy timeout, prepared statements, explicit transactions, ordered migrations, integrity checks, and online backups.

## Design decisions

- SQLite is canonical for mission, run, event, evidence metadata, memory, lesson, audit, and sync state.
- Large artifacts stay in the artifact store with hashes and lifecycle metadata in SQLite.
- Events and current-state updates share a transaction through an outbox.
- Immutable evidence and audit rows are append-only at the service boundary.
- FTS5 indexes searchable text; graph traversal uses indexed adjacency tables.
- Embeddings are optional and provider-abstracted.

## Migration discipline

`schema_migrations` records ordered migration ID, checksum, and application time. A checksum change after application is a fatal error. Migrations run transactionally where SQLite permits and are idempotent on repeated startup.

## Operational checks

- startup quick/integrity check;
- foreign key check;
- migration status;
- WAL checkpoint health;
- writable storage and backup destination;
- prepared query latency sampling;
- periodic online backup and verified restore rehearsal.
