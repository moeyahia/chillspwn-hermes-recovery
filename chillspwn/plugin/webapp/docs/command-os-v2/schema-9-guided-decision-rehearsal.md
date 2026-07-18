# Schema-9 Guided-decision boundary rehearsal

Rehearsal date: 2026-07-15 UTC

Production changes: **none**

Scope: disposable synthetic schema-8→9 database transition

## Purpose and boundary

Migration 9, `guided_decision_single_pending_boundary`, closes an authority
ambiguity that was possible in schema 8: a Guided run could contain more than
one pending represented decision. Choosing one during migration would silently
grant authority. The migration therefore cancels every ambiguous pending
decision, blocks and unfences affected nonterminal work, and creates a partial
unique index that allows at most one pending decision per run.

This rehearsal is intentionally smaller than the historical schema-8
compatibility-bridge exercise. It creates a current-checksum schema-8 database
from migrations 1–8, inserts only synthetic records, invokes the real database
CLI to apply migration 9, and deletes the random workspace on exit. It does not
read `/opt`, `/var/lib/chillspwn`, environment files, credentials, service
configuration, operator data, or the canonical database. It does not start or
stop a service and is not permission to promote the candidate.

## Commands

```bash
bun run test:rehearsal:schema9:safety
bun run test:rehearsal:schema9
bun test server/db/__tests__/database.test.ts
```

The first command proves that caller-supplied and production-shaped database
paths are refused. The second accepts no arguments and allocates only
`/tmp/chillspwn-schema9-rehearsal.*`. The focused database suite covers the
same boundary through the repository migration API.

## Measured result

The disposable shell rehearsal passed on 2026-07-15 with:

- one schema-8 source database and one mode-`0600` pre-migration backup;
- exactly migration 9 applied on the first CLI invocation;
- no migration reapplied on the second invocation;
- two ambiguous pending decisions cancelled with the migration actor and
  fail-closed reason;
- two affected Guided steps blocked;
- two affected active/queued assignments blocked with lease owner, acquisition,
  heartbeat, and expiry fields cleared;
- the nonterminal ambiguous run blocked and unfenced;
- one legitimate single pending decision and its run preserved;
- multiple non-pending historical decisions preserved;
- a second pending decision for the preserved run rejected by the partial
  unique index;
- SQLite `quick_check` `ok`, zero foreign-key violations, WAL, and schema 9;
- a schema-8 migration set refusing the schema-9 database as an unknown higher
  version;
- migration source and registration hashes unchanged during the rehearsal;
- cleanup of the temporary workspace on exit.

The safety harness passed four negative cases: a path argument to the shell
rehearsal, a helper path outside its randomized `/tmp` namespace, and a
production-shaped canonical database path, plus a matching-looking rehearsal
root implemented as a symlink.

At this checkpoint the migration identities were:

| Item | SHA-256 / value |
| --- | --- |
| `009_guided_decision_boundary.ts` source | `0f52a3e3aea9b776a9f317354110be8d1233cdeff176017cc925124be8dd21fa` |
| Migration-9 SQL checksum in `schema_migrations` | `648c053467249def8c869033099be268bea20d982d9b30f4d83310dc903eaa06` |

These values are evidence for this worktree checkpoint, not a frozen release
identity. Any migration-source change requires rerunning the rehearsal and
updating this record; an already-applied database must reject the changed
checksum.

## Rollback implication

A schema-8 application correctly refuses a schema-9 database. Therefore a
post-migration application-only rollback is safe only to an immutable release
that knows the exact migration-9 name and checksum. Returning to a schema-8
application requires stopping writers and restoring the matching verified
pre-migration database backup while preserving the schema-9 database and
sidecars for reconciliation. Do not delete the migration row or partial index
in place.

## Relationship to schema 8

The superseded historical schema-8 bridge record remains at
[`schema-8-bridge-rehearsal.md`](schema-8-bridge-rehearsal.md). It preserves a
specific earlier schema-7 release and obsolete migration-8 checksum. This
schema-9 rehearsal neither uses nor validates that artifact. A future approved
promotion still needs a fresh schema-7→8 bridge built from the exact live
release and current migration 8, followed by the schema-8→9 candidate boundary
and the full release gate.
