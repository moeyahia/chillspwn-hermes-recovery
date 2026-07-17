# Command OS V2 event model

Status: implementation audit of the V2 event log, transactional outbox, SSE transport, and browser reconciliation path as of 2026-07-16.

## Purpose and authority

Events are the append-only operational history of a run. Materialized tables make current-state reads fast, but a state mutation is not considered durably observable until its event and outbox record are committed in the same database transaction.

An event is not automatically a log, observation, or evidence item:

```text
Event
  records a state change or attributable observation

Engagement log record
  preserves technical chronology and raw output

Observation
  parses an attributable claim from logs or structured results

Evidence candidate
  marks a potentially useful observation/artifact

Verified evidence
  immutable support that passed its required validation
```

The event system transports state. It does not confer evidentiary status on a payload.

## Canonical envelope

The typed `RunEvent` contract includes:

| Field | Meaning |
|---|---|
| `id` | Stable event ID used for delivery deduplication and SSE resume. |
| `missionId`, `runId` | Required run correlation. |
| `sequence` | Monotonic sequence allocated independently per run. |
| `eventType` | Versioned semantic event name. |
| `occurredAt`, `createdAt` | Source occurrence and persistence timestamps. |
| `actor.type`, `actor.id` | Operator, agent, worker, system, or integration identity. |
| `summary` | Human-readable semantic statement suitable for the primary activity feed. |
| `payload` | Structured technical/domain data, not primary UI copy. |
| `schemaVersion` | Payload schema version. |
| `journey` | `autonomous` or `guided`, checked against the canonical run. |
| `traceId`, `spanId` | Optional distributed-operation correlation. |
| `sensitivity`, `redaction` | Disclosure classification and applied redaction metadata. |
| `contextPackId` | Optional attribution to the memory context that influenced the operation. |

The repository validates mission and journey from the canonical run rather than trusting caller-supplied correlation.

## Append transaction

`EventRepository.append` performs the following in one nested-safe `IMMEDIATE` transaction:

1. load and validate the run and mission;
2. allocate the next value in `run_event_sequences`;
3. insert the immutable event;
4. insert one pending outbox delivery row;
5. update notification projections where applicable;
6. return the canonical event.

When called inside a mission, transition, action, or checkpoint transaction, it participates in the caller's transaction. This prevents a materialized state from committing without its event, or an event from announcing state that rolled back.

The public ordering guarantee is per-run sequence. Global replay uses stable database insertion order and stable event IDs; there is no explicit public global sequence number.

## Transactional outbox

The outbox has explicit states:

- `pending`;
- `delivering`;
- `delivered`;
- `failed`.

The delivery pump claims bounded batches, fences updates by expected state, releases stale claims, and retries failures with exponential backoff and jitter. Default service values are:

| Parameter | Default |
|---|---:|
| Pump interval | 100 ms |
| Batch size | 100 |
| Replay page | 250 events |
| Subscriber queue | 500 events |
| Stale delivery claim | 30 seconds |
| Retry base / cap | 250 ms / 30 seconds |
| Jitter | 20% |

Delivery is intentionally at least once. A process can broadcast an event and crash before marking its outbox row delivered, so clients must deduplicate by stable event ID.

## Server stream and replay

The V2 server exposes one multiplexed SSE path under `/api/v2/events`:

- `/stream` for live events and initial replay;
- `/replay` for cursor/run-sequence replay;
- `/gap` for explicit missing run-sequence repair.

The stream supports:

- run-scoped resume after a sequence;
- global resume after a stable event ID;
- `Last-Event-ID` handling;
- heartbeat frames, defaulting to 20 seconds;
- bounded subscriber queues and overflow closure;
- server-side sensitivity/redaction policy;
- graceful subscriber shutdown;
- replay pages capped by the router at 500 records.

The main server protects these endpoints with its V2 authentication middleware. The stream service redacts configured paths and recognized secret-key names before delivery. This is defense in depth; producers must still avoid storing secrets in event payloads.

## Backpressure and failure semantics

Each subscriber receives a bounded queue. A slow consumer that exceeds the bound is disconnected rather than allowing unbounded server memory growth. It reconnects and replays from its last acknowledged event.

Outbox delivery failure does not roll back the already committed domain state. The pending/failed delivery remains durable and retryable. Stream unavailability therefore degrades freshness, not database truth.

No event should be considered acknowledged merely because it was written to a socket. Client reconciliation and stable IDs are part of the delivery contract.

## Browser event client

`src/app/providers/EventStreamProvider.tsx` implements the V2 browser path:

1. open a credentialed `EventSource`;
2. resume from a V2-namespaced stored event ID;
3. deduplicate the latest 2,000 stable IDs in memory;
4. track last sequence by run;
5. detect a sequence jump;
6. request gap repair in pages, currently bounded to 20 pages of 500;
7. invalidate only affected query-cache domains;
8. reconnect with exponential backoff and jitter, capped at 30 seconds;
9. after three consecutive stream failures, enable a low-frequency 30-second query refresh;
10. stop unnecessary work when offline or the document is hidden.

The UI exposes connection/degraded state. Event application is normalized through the query/cache layer rather than forcing a full dashboard refetch after every event.

The resume token, cache keys, telemetry identity, and browser storage use the V2 namespace and do not overlap legacy state.

## Event production boundaries

Implemented producers include mission creation, run transitions, plan/action lifecycle, decisions, evidence and findings, checkpoints, recovery, cancellation, memory/learning operations, plan changes, operational truth, and Research campaign lifecycle where those services are mounted.

Important constraints:

- only run-scoped events receive the public monotonic sequence;
- state transition summaries must contain a reason and journey;
- a memory-influenced event can cite a persisted Context Pack, but the event must not expose hidden reasoning;
- raw stdout/stderr belongs in the technical log/artifact path, with a concise semantic event in the primary feed;
- a provider/model return is untrusted input until normalized and classified.

## Replay and gap-repair examples

### Normal reconnect

```text
browser stores evt_104
  → opens /stream after evt_104
  → server replays evt_105…current
  → browser deduplicates any repeated delivery
  → live stream continues
```

### Run sequence gap

```text
browser holds run sequence 31
  → receives sequence 34
  → pauses canonical application for that run
  → GET /gap?runId=…&afterSequence=31
  → applies 32, 33, then 34 once each
  → resumes live application
```

If the bounded repair cannot close the gap, the client falls back to authoritative query reconciliation and marks the connection degraded. It must not invent the missing state.

## Schema evolution

Every event carries `schemaVersion`, but the current implementation does not provide a complete registered upcaster/downcaster system or client capability negotiation. Additive payload changes are safest during preview. A breaking event change requires:

1. a new schema version;
2. deterministic replay compatibility;
3. producer and consumer contract tests;
4. documented retention boundary;
5. proof that older persisted events still render or reconcile safely.

## Observability and privacy

Event correlation can include mission, run, plan, step, assignment, action, decision, Context Pack, trace, and span identities. Raw technical detail is expandable through its linked records; semantic summaries remain the default UI surface.

The redaction model has two layers:

- producer-side normalization prevents secrets or confidential raw content from becoming ordinary event payloads;
- stream-side redaction removes recognized secret-shaped values and configured sensitive paths before delivery.

Redaction metadata records that transformation. It is not permission to send raw client evidence to a public model or browser consumer.

## Verification present in the repository

Server tests exercise:

- monotonic per-run allocation;
- run isolation;
- stable-ID global resume;
- replay and sequence-gap repair;
- bounded subscriber backpressure;
- outbox retry and stale-claim release;
- redaction;
- SSE event IDs and heartbeat behavior;
- a reconnect-storm case with 64 subscribers and 500 events without observed gaps or duplicates after reconciliation.

These tests support the core durability claim. They do not replace browser-matrix, long-soak, or production-volume evidence.

## Known gaps and release work

1. Add focused browser-client tests for deduplication, 20-page gap exhaustion, hidden-tab behavior, offline transitions, and resume-token corruption.
2. Add a documented retention/archival/compaction policy for events and delivered outbox rows while preserving audit requirements.
3. Add a schema registry and deterministic compatibility/upcast tests before breaking event payload evolution.
4. Decide whether a first-class global sequence is required; today only run sequence is part of the public contract.
5. Prove the 500 ms local visibility objective under concurrent legacy/V2 load and slow consumers.
6. Prove server and browser memory bounds on 100,000-event runs and reconnect storms over the release soak.
7. Ensure every mounted mutation uses the event repository in the same transaction; the incomplete production runtime and globally unwired control-plane lease prevent a blanket claim today.
8. Exercise event replay in Chromium, Firefox, WebKit, mobile offline/reconnect, reverse-proxy buffering, auth expiry, process restart, and database restore scenarios.

Until those gaps are closed, the implemented event path is a strong preview foundation, not a completed release or cutover gate.
