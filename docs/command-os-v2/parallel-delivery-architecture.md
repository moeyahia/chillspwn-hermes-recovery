# Parallel delivery architecture

Decision status: accepted for implementation foundation, 2026-07-16. Cutover is explicitly not approved.

## Decision

Build Command OS V2 at `chillspwn/plugin/command-os-v2` as a sibling to the protected `chillspwn/plugin/webapp`. During preview, the applications have separate browser, process, API, event, database, artifact, queue, and telemetry identities. The existing UI remains the default until the complete release gate and explicit human approval.

```text
browser legacy ── existing origin/path ── legacy server/routes ── legacy files + kanban.db

browser V2 ── separate origin or /command-os-v2/
             ├── /api/v2 gateway ── V2 services ── data/command-os-v2.sqlite
             ├── /api/v2/events ── durable outbox/replay
             ├── V2 workers/quotas ── provider + MCP adapters
             └── V2 artifact root / Vault projection

legacy sources ── one-way, hashed, resumable importer ──> V2 imported records
```

## Isolation contract

| Concern | Legacy | V2 preview |
| --- | --- | --- |
| Source root | `chillspwn/plugin/webapp` | `chillspwn/plugin/command-os-v2` |
| UI root/router | existing `App.tsx`, page switcher/hash behavior | independent React root and explicit router |
| CSS/tokens | legacy `src/index.css` and globals | V2-only CSS variables/Tailwind layers under V2 root |
| Static output | existing `dist/` | independent V2 output directory |
| Browser storage | existing keys | `chillspwn.command-os.v2.*` prefix |
| IndexedDB | existing/none as applicable | `chillspwn-command-os-v2` |
| Cache/service worker | existing app namespace | `chillspwn-command-os-v2-*` |
| Broadcast channel | existing/none | `chillspwn-command-os-v2-events` |
| HTTP API | existing `/api/*` | additive `/api/v2/*` |
| Live channel | existing `/ws` and SSE endpoints | versioned multiplexed V2 stream |
| Database | legacy files and `/root/.hermes/kanban.db` | `data/command-os-v2.sqlite` |
| Artifacts | legacy runtime/engagement paths | V2 namespaced artifact root |
| Telemetry | legacy logs/identity | `command_os_v2` service and trace identity |
| Runtime ownership | implicit legacy | explicit `control_plane=command_os_v2` |

The logo is the sole approved visual asset shared initially. A build-time copy/serve step must verify SHA-256 `0a3dfd69f74a00d41bb0cb20d6af1097dffa265d4c1e54c9228fe4b55f85c955` before making the original SVG available to V2.

## Process topology

Prefer a separate V2 server process during preview. It gets an independent port, database connection, event bus, worker pool, graceful-shutdown path, and kill switch. A reverse proxy may expose it at `/command-os-v2/`, but that must not alter legacy route ownership.

If deployment constraints later require mounting V2 under the existing server, the V2 module must still have a lifecycle boundary: it may fail readiness or be killed without changing legacy handlers, WebSocket semantics, file paths, or startup. Mounting is contingent on compatibility, failure-injection, and resource-isolation tests.

## Service layers

```text
api-v2 / events-v2
  -> application services (missions, plans, runs, decisions, intelligence)
  -> runtime services (agents, policy compiler, supervisor, checkpoints)
  -> knowledge services (BrainContextService, memory graph, Vault sync, learning)
  -> research services (bounded lab orchestration and immutable evaluation)
  -> repositories / outbox / artifact metadata
  -> dedicated SQLite + namespaced artifact store
```

HTTP handlers validate, authenticate, authorize, add request/trace IDs, and delegate. They do not own long-running work or business rules. Mutations use idempotency keys and optimistic versions. Every mutation rechecks control-plane ownership on the server.

## Data ownership and migration

Preview is one-way:

1. Discover configured legacy sources without assuming every path exists.
2. Back up applicable sources and record path, hash, classification, timestamp, and importer version.
3. Dry-run deterministic parsers and report malformed/secret-bearing records.
4. Import into a dedicated V2 database with `Imported` provenance; preserve originals.
5. Resume from checkpoints and deduplicate by stable ID plus source hash.
6. Reconcile counts and links; never create a V2 href from a missing relation.

V2-native missions write only to V2. Legacy runs remain legacy-controlled. An optional ownership transfer must be explicit, idempotent, versioned, and revoke the old mutation path before enabling the new one. There is no dual-write phase.

SQLite is configured with WAL, foreign keys, a busy timeout, prepared statements, explicit transactions, migrations, integrity checks, and online backups. The optional Obsidian Vault is a versioned Markdown projection/import surface; it cannot mutate canonical run state through a partial file write.

## Control-plane lease

Every mutable mission/run record carries `control_plane`, version, lease owner, lease epoch, and expiry. Mutation middleware rejects commands from the wrong interface even if a client bypasses disabled controls. Transfer requires:

- current-owner authorization;
- a durable checkpoint;
- classification of in-flight work;
- no unsafe non-idempotent action running;
- lease epoch increment;
- an immutable audit/event record.

The non-owner interface may display an imported, clearly labeled read-only projection.

## Runtime and event isolation

V2 has independent worker and provider/MCP budgets: concurrency, queue depth, tokens/cost, tool calls, timeouts, and storage. Backpressure rejects or queues preview work before it can starve legacy. Resource acceptance requires concurrent-load measurement showing no more than the approved 5% legacy regression.

State changes and event-outbox writes share a transaction. The event stream provides per-run monotonic sequences, replay, gap repair, deduplication, heartbeat, schema versions, bounded subscriber queues, and low-frequency polling fallback. V2 resume tokens are namespaced and never consumed by legacy.

## Brain and provider boundary

All agents request minimum relevant context through a local `BrainContextService`; agents do not read the Vault filesystem directly. Context Packs record selected/rejected IDs, scope and sensitivity checks, disclosure classification, freshness, budget, influence summary, and corrections. Public providers receive only policy-sanitized typed context and a `ProviderExposureReceipt`. Credentials, raw confidential payloads, unrestricted transcripts, and cross-engagement memory never enter reusable/public context.

## Feature flags and shutdown

The initial flags are `COMMAND_OS_V2_PREVIEW`, `DATABASE_V2`, `EVENT_STREAM_V2`, `SECOND_BRAIN_V2`, and `OBSIDIAN_SYNC_V2`. Defaults are off outside the V2 process. The global V2 kill switch must:

- reject new V2 launches and mutations;
- cooperatively cancel or checkpoint V2 workers according to action safety;
- close V2 event subscribers;
- drain/cancel Vault sync and indexing;
- flush/close the V2 database;
- leave legacy services, routes, queues, and files untouched.

## Shared-code policy

Start with no runtime dependency on legacy UI code. Share only audited UI-agnostic contracts through explicit packages when duplication would otherwise create correctness risk. A shared package requires schema/contract tests against both clients and must not move or reinterpret legacy code merely for V2 convenience.

Registry adapters may read stable legacy source manifests during the transition, but V2 will expose versioned normalized contracts. The runtime/tool/MCP/provider sources remain authoritative; React components never maintain parallel hand-written capability lists.

## Delivery gates

- **Phase -1/0:** pin source; characterize legacy; create compatibility, browser, performance, and interaction baselines.
- **Phase 1:** scaffold independent V2 app/process, namespaces, `/api/v2`, database health, kill switch, and side-by-side smoke tests.
- **Phase 2:** durable database, outbox/event replay, importer, control plane, supervisor, checkpoints, and failure diagnosis.
- **Phase 3/4:** design system and real-data vertical slices for exactly Autonomous and Guided.
- **Phase 5:** active Brain, Context Packs, Vault bridge, evaluation/learning, then bounded Research Lab.
- **Phase 6/7:** 100% interaction manifest, browser/visual/a11y/performance coverage, 72-hour soak, seven-day preview acceptance.
- **Phase 8:** only after sign-off, rehearsed backup/migration/cutover with one-command rollback.

Visual assets, historical migration, V2 browser matrix, soak, preview acceptance, cutover rehearsal, and release sign-off have not yet been performed. They remain explicit gates, not implied future success.
