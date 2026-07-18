# Command OS V2 API contract

The canonical application publishes a checked OpenAPI 3.1 document at
`GET /api/v2/openapi.json` and a focused delivery/schema contract at
`GET /api/v2/contracts/events`.

The contract is generated from the typed endpoint catalog in
`server/contracts/v2Contract.ts`. It covers the canonical mission, runtime,
Guided decision, event, operations, learning, report, and Second Brain routes.
Legacy unversioned compatibility routes are deliberately outside this contract.

## Invariants

- API version `2.1` exposes exactly `autonomous` and `guided` journeys.
- Harmful mutations require an `Idempotency-Key`; Autonomous preflight is the
  sole non-idempotent POST because it performs validation without changing
  canonical state.
- Errors use the shared `error` envelope with a stable code, operator-readable
  message, retry classification, category, trace ID, timestamp, and optional
  remediation.
- Identity is supplied by the authenticated host session. Query and request
  bodies never select an actor identity.
- Operational events are append-only and ordered by a monotonic per-run
  sequence. Delivery is at least once, so clients deduplicate by stable event
  ID and repair sequence gaps through the replay endpoint.
- Every operational event declares journey, sensitivity, redaction state, and
  correlation fields. A Context Pack ID is included when retained memory
  influenced the event.

## Event resumption

The SSE client resumes with `Last-Event-ID`, or with `runId` and
`afterSequence`. `GET /api/v2/events/replay` returns a bounded page and opaque
cursor. `GET /api/v2/events/gap` uses the same contract for sequence repair.

Raw tool/provider output is not the semantic event contract. It remains behind
explicit technical-detail and artifact boundaries with sensitivity enforcement.

## Mission portfolio

`GET /api/v2/missions` applies canonical server-side filters for journey,
status, engagement, target, current owner/team, provider, update range, current
risk, evidence presence, finding severity, Guided decision state, and recovery
state. Its opaque cursor is HMAC-signed and bound to the exact normalized
filter set, so a cursor cannot be replayed after changing filters.

Saved portfolio views are synchronized through
`GET|POST /api/v2/missions/saved-views` and
`DELETE /api/v2/missions/saved-views/:viewId`. They are actor-scoped, bounded,
optimistically versioned, idempotent, and contain filter/layout state only.

`POST /api/v2/missions/bulk/archive` accepts at most 50 exact mission IDs and
requires deliberate confirmation. Only missions whose mission, runs, actions,
and assignments are durably terminal can change to `archived`; every requested
ID receives an auditable outcome. `POST /api/v2/missions/bulk/export` uses the
same bounded exact-selection contract and returns redacted metadata, hashes,
counts, and timestamps. It never returns objectives, target values, evidence
bodies, extracted text, artifacts, or confidential payloads.

## Correlated trace projections

`GET /api/v2/observability/traces` returns cursor-paged summaries assembled
from real canonical events, structured logs, actions, and action-linked tool
calls. It accepts mission, run, status, time, and semantic search filters. The
repository applies request scope and sensitivity policy to every source before
correlation, so a reused trace ID cannot disclose a record from another
engagement.

`GET /api/v2/observability/traces/:traceId` returns the selected summary and a
separately cursor-paged waterfall. Every source query is capped at
`limit + 1` before its records are merged; at most four bounded source pages
enter application memory. The projection exposes semantic summaries and
redacted technical detail. It deliberately excludes action and tool normalized
arguments. Tool calls inherit their canonical trace/span linkage from their
owning action rather than inventing provider correlation.
