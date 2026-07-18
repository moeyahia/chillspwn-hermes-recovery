# ADR 0002: dedicated V2 canonical store and one-way legacy import

- Status: accepted
- Date: 2026-07-16

## Decision

Use a dedicated SQLite database (`data/command-os-v2.sqlite` by default) and
V2-namespaced artifact paths during preview. SQLite uses WAL, foreign keys,
busy timeout, migrations, prepared statements, transactions, integrity checks,
and backups. Legacy sources are discovered and copied read-only through a
hash-addressed, resumable importer.

Do not dual-write active mission state. Every mission/run records one
`control_plane`: `legacy` or `command_os_v2`. Historical legacy records imported
for search remain provenance-marked and read-only until explicit transfer.

## Consequences

Preview cannot corrupt legacy stores and rollback does not require converting
new V2 state into fragile files. Transfer and cutover require reconciliation;
storage duplication during the rollback window is deliberate.
