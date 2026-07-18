# ADR-002: SQLite plus a transactional outbox is canonical

Status: Accepted
Date: 2026-07-15

## Context

Mission state was divided across JSON, JSONL, text logs, artifacts, and a legacy
board database. File polling could observe partial transitions and could not
atomically connect state with emitted events.

## Decision

Command OS uses `better-sqlite3` with WAL, foreign keys, busy timeout, prepared
statements, migrations, explicit transactions, append-only events, and an event
outbox. Relational projections serve current UI state. Large artifact bodies may
remain outside SQLite, but hashes, provenance, scope, and lifecycle remain in it.

## Consequences

- State changes and their publishable events commit together.
- Legacy sources require backup-first, idempotent import and reconciliation.
- Files remain export, backup, artifact, or temporary compatibility surfaces.
- Database backup, integrity verification, and rollback are release gates.
