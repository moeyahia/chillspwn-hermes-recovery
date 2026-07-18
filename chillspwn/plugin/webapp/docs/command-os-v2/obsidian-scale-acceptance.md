# Physical 50,000-note Obsidian acceptance

Status on 2026-07-15: **passed for isolated first-time projection,
reconciliation, bounded cancellation, and incremental conflict behavior**.

This is an opt-in engineering profile, not production data. It creates a fresh
`/tmp/chillspwn-obsidian-scale-*` workspace, a new canonical SQLite database,
and a new vault. It never reads deployment configuration, production SQLite,
an operator vault, or credentials; it opens no port. The database is closed and
the validated workspace is removed on success, failure, `SIGINT`, or `SIGTERM`.

Run it explicitly:

```bash
CHILLSPWN_OBSIDIAN_SCALE_CONFIRM=isolated-temporary-obsidian-scale-50000 \
  bun run test:acceptance:obsidian-scale
```

`CHILLSPWN_OBSIDIAN_SCALE_NOTES` may reduce the fixture to 4–50,000 notes for
development, but only the default 50,000-note run is release evidence. Exact
opt-in, path, cleanup, batching, and cancellation gates are covered by the
vault safety and bulk-export tests.

## Exact accepted run

The accepted run contained 50,000 canonical nodes, 50,000 immutable versions,
50,000 FTS rows, and 50,000 real Markdown files across all 26 node types. The
Markdown payload was 32,330,808 bytes. SQLite plus WAL was 264,553,432 bytes at
measurement time.

The initial tree was produced by `ObsidianVaultBridge.exportNodes`, the same
bounded bulk path used by the CLI. It did not use prepared files or synthetic
sync-state rows. Each note was rendered from canonical SQLite, individually
fsynced, published with no-clobber atomic link semantics, directory-fsynced,
and followed by a durable sync-state update. Sixteen writes were allowed in
flight; no unbounded rendering or result queue was materialized.

| Measurement | Result | Gate | Status |
| --- | ---: | ---: | --- |
| Canonical seed and FTS index | 4,375.75 ms | informational | measured |
| Exact 50,000-note bridge export | 41,019.51 ms | 600,000 ms | pass |
| Exact export throughput | 1,218.93 notes/s | informational | measured |
| Full 50,000-file hash reconciliation | 2,452.93 ms | 300,000 ms | pass |
| FTS sentinel lookup | 0.37 ms | 300 ms | pass |
| FTS lookup after operator edit | 0.24 ms | 300 ms | pass |
| Five-write operator edit | 197.48 ms | 10,000 ms | pass |
| New inbox candidate import | 113.22 ms | 10,000 ms | pass |
| Concurrent edit detection and merged resolution | 6.82 ms | 10,000 ms | pass |
| Cancellation request dispatch | 0.45 ms | 2,000 ms | pass |
| Cancellation observation after dispatch | 3.40 ms | 2,000 ms | pass |
| Maximum heartbeat gap during exact export | 164.29 ms | 2,000 ms | pass |
| Peak RSS | 200,650,752 bytes | 1,610,612,736 bytes | pass |

All 50,000 results were `synced`: zero skips, database-ahead notes,
vault-ahead notes, conflicts, quarantines, or failures. A complete physical
hash scan reconciled every file with both tracked database and vault hashes.
The final workspace cleanup check passed.

One untouched note retained this projection SHA-256 before and after the
watcher, conflict, and cancellation checks:

```text
022153860b0b5a6966516e90e905e1c599fd2d61471da5c5bfa134d7f79d6162
```

## Durability, cancellation, and conflict safety

Bulk progress is not an in-memory cursor. Each successfully published note has
its canonical version and hashes committed to `vault_sync_state`; a rerun after
abort or process loss revalidates and skips that version. The schema-8
candidate adds the partial `(connection_id, node_id)` index required to keep
this lookup linear at 50,000 notes.

The publication primitive never overwrites the public note name after a hash
check. It captures the expected destination in a guard, verifies the captured
bytes, and hard-links the fsynced temporary file into the now-empty name. A
note recreated by an editor wins with `EEXIST`; the bridge preserves the edit
and returns conflict/ahead state. File and containing-directory fsyncs remain
part of the contract. Focused tests inject edits after capture for async bulk,
synchronous export, canonical-version races, and conflict resolution.

The profile also exercised cooperative cancellation against real bridge work.
The request was observed after complete note boundaries, with no partial note.
Unit coverage separately closes and reopens SQLite after cancellation, then
proves completed rows are skipped and the remaining notes finish.

## Native watcher acceptance boundary

Native recursive `fs.watch` started in the final run
(`nativeWatchUnavailable=false`). The bounded incremental fixture delivered 14
raw events with zero watcher errors, produced the expected version/candidate
state, and completed cleanup without a full 50,000-file watcher rescan.

This proves native debounce and bounded incremental bridge behavior, but it is
not a sustained multi-day watcher or production-vault claim.

## Historical failed attempt and correction

Before the durable bulk path and lookup index, an exact attempt was stopped at
18,818/50,000 after 565,279.88 ms (33.29 notes/s). The cause was a missing
`(connection_id, node_id)` index: every per-note state lookup scanned the
growing sync table, making the run O(n²). That failed result was not used as
acceptance evidence. The final run above uses the corrected exact path.

## Honest remaining checks

- sustain changes over a multi-hour watcher/heap profile;
- exercise native Obsidian desktop rendering and graph discovery manually;
- rehearse a production-vault backup and rollback;
- test a full 50,000-note portable ZIP separately when that explicitly
  requested maintenance action is in scope.
