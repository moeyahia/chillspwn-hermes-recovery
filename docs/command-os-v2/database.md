# Command OS V2 database

Status: implementation audit of the dedicated V2 SQLite layer as of 2026-07-18. This document distinguishes durable behavior present in code from schema-only preparation and release work that remains.

## Canonical-store boundary

Command OS V2 uses a dedicated SQLite database, normally `data/command-os-v2.sqlite`, as the transactional source of truth for V2-native missions. Large binaries remain in a namespaced artifact store; their identity, hash, provenance, sensitivity, and relationships belong in SQLite. The legacy stores are import sources during preview, not a second writer for V2 runs.

The principal implementation is under:

- `server/db/connection.ts` and `server/db/transaction.ts`;
- `server/db/migrations/001_core.ts` through `014_runtime_mutation_receipts.ts`;
- domain repositories under `server/**`;
- `server/db/backup.ts` and database health helpers;
- migration/import services under `server/migration/`.

The Node runtime uses `better-sqlite3`. A Bun 1.3 adapter uses `bun:sqlite` while preserving the same repository interface.

## Connection and durability settings

Writable file databases are configured with:

| Setting | Implemented behavior |
|---|---|
| Foreign keys | `PRAGMA foreign_keys = ON` on every connection. |
| Journal | `PRAGMA journal_mode = WAL` for writable file databases. |
| Synchronization | `PRAGMA synchronous = NORMAL`. |
| Busy handling | Configurable `busy_timeout`; default 5,000 ms and bounded to 120,000 ms. |
| File permissions | Parent directory is restricted to `0700`; the database is restricted to `0600`. |
| Transactions | Domain services use nested-safe `BEGIN IMMEDIATE` transactions. |
| Health | Database health can execute `PRAGMA quick_check` and report journal/foreign-key state. |

`createDatabaseConnection` performs an integrity check when opening with `fileMustExist`. The application now detects an existing canonical file and opens it with that gate before migrations, projections, event streams, or mutation routers are constructed. A focused restart test reopens a valid store and rejects a corrupt existing image. New stores are created normally and become integrity-checked on every subsequent start. Nonterminal-run lease/checkpoint recovery remains a separate startup gap.

## Migration contract

Migrations are ordered, additive, and checksummed. Applied versions are recorded in `schema_migrations`; an applied checksum mismatch or an unknown future version fails closed. Each migration is applied in its own `IMMEDIATE` transaction.

The current chain creates 102 ordinary tables plus six FTS5 virtual tables, excluding FTS5 internal tables and including the application tables introduced across the following versions:

| Version | Durable model introduced |
|---|---|
| `001_core` | Missions, targets, constraints, runs, plans, steps, agents, assignments, actions, tool calls, Guided decisions, approvals, events/outbox, evidence, findings, artifacts, checkpoints, evaluations, conversations/messages, provider turns, MCP and health records, notifications, audit, settings, and structured logs. |
| `002_brain_vault_learning` | Memory graph, sources, versions, candidates, embeddings, Context Packs, suppressions, preferences, Vault connection/sync/conflict state, lessons, lesson evidence, and usage. |
| `003_search` | FTS5 indexes and synchronization triggers for messages, evidence, findings, lessons, memory text, and logs. |
| `004_evidence_integrity` | Immutable chain-of-custody behavior and uniqueness for Guided manual evidence linked to an action. |
| `005_attack_chains` | Normalized attack-chain details, items, sources, and verification gates. |
| `006_run_comparisons` | Immutable run-comparison snapshots. |
| `007_journey_integrity` | Journey attribution on artifacts, checkpoints, and audit records, with same-journey enforcement. |
| `008_runtime_continuity` | Immutable run Context Pack selections, contract version/hash binding, contract snapshots, branches, runtime continuations, notification receipts, and supporting indexes. |
| `009_guided_decision_uniqueness` | Fail-closed cleanup of duplicate pending legacy decisions and a partial unique index allowing one pending Guided decision per run. |
| `010_v24_operational_truth` | Control-plane ownership, operational truth, attack attempts and metrics, recon digital twin and OSI observations, CVE applicability, plan changes, script/page-capture records, model assignments, disclosure receipts, and Research Lab schema. |
| `011_memory_edge_scope_identity` | Complete mission/engagement identity on scoped Brain edges, with conservative normalization of older rows. |
| `012_planning_retry_continuation` | A dedicated owner-fenced continuation kind for delayed provider-planning retries; the expand migration preserves every schema-eleven continuation row and lease field. |
| `013_imported_legacy_control_plane` | Conservatively reclassifies only importer-provenance legacy missions/runs as legacy-owned and expires any imported V2 lease; V2-native records are not inferred or changed. |
| `014_runtime_mutation_receipts` | Durable, fenced idempotency receipts for runtime mutations, including owner/expiry, canonical boundary, replayable success or sanitized failure, and conservative import of earlier settings-backed receipts. |

There are no down migrations. Rollback is therefore backup-and-restore or application-version rollback against a compatible database copy, not destructive schema reversal.

## Transaction boundaries

The central invariant is that state and the event announcing that state are committed together.

Examples implemented in domain services include:

- Mission creation writes the mission, normalized targets, constraints, optional Autonomous contract, initial run, events/outbox records, audit record, and idempotency response atomically.
- A run transition updates the versioned run state, appends its event and outbox row, and writes the checkpoint in one transaction.
- Action start revalidates journey authority and scope inside the transaction before reserving execution, changing plan/assignment state, appending the event, and checkpointing.
- Guided decision consumption and exact action authorization occur atomically, preventing replay or parameter substitution.
- Evidence verification and finding verification are constrained by database triggers and repository policy rather than by UI state alone.

Nested domain calls reuse the enclosing transaction. HTTP handlers are not intended to own business transactions directly.

## Append-only and immutable records

Database triggers protect records whose mutation would undermine auditability. The implemented immutable classes include events, audit records, evidence, evidence-chain entries, memory versions, immutable Context Pack selections, Autonomous contract snapshots, run branches, and run-comparison snapshots. Research services add content hashes and immutable version identities for strategies, benchmark snapshots, metrics, and integrity receipts.

Not every table is append-only: materialized current state such as missions, runs, plans, assignments, health, and sync status is intentionally mutable through optimistic versioning or scoped repository operations. Canonical history remains in append-only events/audit/version records.

## Index and query design

The migration chain contains the required common-path indexes for mission and run status/time, run event sequence, step status/order, decisions, evidence, findings, memory adjacency and scope, Vault sync, logs, health, operational truth, topology, CVEs, plan changes, model assignments, and Research Lab records.

FTS5 is available for:

- messages;
- evidence text;
- findings;
- lessons;
- memory-note text;
- structured log text.

Graph traversal uses indexed relational adjacency in `memory_edges` and topology edges rather than requiring an external graph database. Embeddings are optional and represented behind memory-provider abstractions; the local indexed product does not require a hosted vector service.

## V2.4 operational-truth schema status

Migration `010` deliberately contains both shipped vertical slices and future-safe schema. Table existence must not be presented as feature completion.

| Area | Database status | Service/runtime status |
|---|---|---|
| Control plane | `control_plane` on Mission/Run and `control_plane_leases`. | V2 runtime mutation authority is asserted through the control-plane lease service; imported legacy ownership is repaired conservatively by migration 013. |
| Mutation idempotency | `runtime_mutation_receipts` with state/lease/boundary/response/error fields and an expiry index. | Runtime reservations are owner-fenced and replay completed success or sanitized failure; expired ambiguous work requires canonical reconciliation instead of blind repetition. |
| Logs to evidence | Logs, observations, log sources, candidates, evidence, and diagnoses. | Mounted service/router/UI establishes the semantic ladder. |
| Attack/run intelligence | Attack attempts, evidence joins, metric snapshots. | Mounted read/write services and mission views. |
| Topology/OSI/CVE | Nodes, edges, evidence links, layer observations, CVE applicability. | Mounted topology/OSI and CVE services with evidence/scope checks. |
| Plan amendments | Change requests and step versions. | Mounted service; UI currently covers a narrower strategy-summary amendment path. |
| Scripts and captures | `script_artifacts`, `page_captures`. | Schema only; no mounted author/test/execute IDE or capture/gallery pipeline. |
| Models and disclosure | Model configurations, agent assignments, provider-exposure receipts. | Partial references and Research reads; no complete live-catalog assignment/pinning service or universal receipt writer. |
| Research Lab | Twenty campaign, strategy, benchmark, experiment, receipt, promotion, deployment, rollback, and context tables. | Campaign lifecycle and trusted primitives exist. Experiment execution is intentionally blocked pending a real isolated lab and signer. |

## Backup, verification, and recovery

`server/db/backup.ts` performs an online SQLite backup into a temporary file, opens that copy read-only, runs an integrity check, applies restricted permissions, and atomically renames it into place. This is a sound primitive for pre-migration and release backup.

The package command surfaces now route to implemented commands: schema migration uses the database CLI, while `db:verify`, `db:backup`, and `db:restore` use the migration CLI's integrity-checked implementations. On 2026-07-16 a disposable database was migrated, verified with zero foreign-key violations, backed up through SQLite's online backup API, restored by an explicit service-stopped/checksum-gated command, and verified again successfully. The backup contained 405 pages.

That implementation check proves command wiring and checksum/integrity behavior on a disposable database. It is not a production-sized cutover rehearsal, and `db:reconcile` still requires a real completed import identifier rather than a synthetic empty-database exercise.

## Security and privacy boundaries

- Repositories bind values through prepared statements; user-controlled data is not interpolated into SQL.
- Scope, journey, evidence, lesson, and cross-record integrity receive database checks in addition to service checks.
- Secrets are references, not reusable memory content; redaction and provider-disclosure policy are separate concerns from whether a memory is verified.
- Engagement isolation is represented on mission, memory, context, and research records and must also be enforced by every repository query.
- The Obsidian Vault is never the transaction coordinator. A partial filesystem write cannot become canonical mission state.

## Legacy import and coexistence

The intended preview flow is one-way and idempotent:

1. hash and inventory a legacy source;
2. create a backup and import checkpoint;
3. parse deterministic records into V2 with imported provenance;
4. quarantine malformed or secret-bearing reusable-memory candidates;
5. reconcile source and destination counts/links;
6. leave the source unmodified;
7. keep a single explicit control plane for each run.

The schema and migration services contain much of this foundation, but complete historical-source discovery, sampled reconciliation evidence, every-link validation, rollback rehearsal, and proof that running the full importer twice creates no duplicates remain release work.

## Verification present in the repository

Database tests cover the complete migration sequence through version 14, WAL and foreign-key settings, busy timeout, core schema presence, constraints/triggers, transaction behavior, and backup primitives. Domain integration tests additionally exercise mission and runtime-mutation idempotency, expired-receipt recovery, event/outbox atomicity, evidence gates, Guided decision uniqueness, runtime continuity, and parts of the Brain/Vault model.

This is meaningful implementation evidence, not the final release gate. The release still requires migration interruption/resume, production-sized import, corruption recovery, backup/restore rehearsal, concurrent legacy/V2 contention, query benchmarks, and long-running soak evidence.

## Release-blocking gaps

1. Archive a release-bound restart/continuation receipt for nonterminal work and
   verify every mutation surface uses the control-plane and durable-receipt
   boundaries; focused implementation tests are not a production rehearsal.
2. Prove `db:reconcile` against completed and interrupted historical imports,
   then archive a production-sized migrate/verify/backup/restore receipt.
3. Complete and reconcile the historical importer without mutating legacy
   sources.
4. Add operational services for schema-only script, page-capture,
   model-assignment, and provider-exposure domains before claiming those
   features.
5. Prove bounded retention/compaction for high-volume events, logs, outbox,
   telemetry, and raw payloads.
6. Publish measured query plans and latency for large runs, evidence sets,
   topology graphs, and 50,000-node Brain data.
7. Rehearse backup, restore, preview rollback, and cutover rollback with
   archived evidence.

No database cutover should be approved until these gaps and the complete release gate are closed.
