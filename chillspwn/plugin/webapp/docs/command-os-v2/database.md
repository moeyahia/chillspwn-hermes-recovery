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

The current candidate schema is 9. Migration 9,
`guided_decision_single_pending_boundary`, handles legacy runs containing more
than one pending Guided decision fail-closed: all ambiguous decisions are
cancelled, affected nonterminal work is blocked and unfenced, and a partial
unique index then permits at most one pending decision per run. Completed
decision history remains unconstrained.

The portable schema-8→9 rehearsal uses only a generated temporary database:

```bash
bun run test:rehearsal:schema9:safety
bun run test:rehearsal:schema9
```

See
[`schema-9-guided-decision-rehearsal.md`](schema-9-guided-decision-rehearsal.md)
for measured evidence and explicit non-production limits.

## Operational checks

- startup quick/integrity check;
- foreign key check;
- migration status;
- WAL checkpoint health;
- owner-fenced `runtime_continuations` for durable commit-to-next-work replay;
- writable storage and backup destination;
- prepared query latency sampling;
- periodic online backup and verified restore rehearsal.
