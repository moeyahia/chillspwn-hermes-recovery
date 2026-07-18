# ADR 0003: durable multiplexed SSE for V2 live state

- Status: accepted
- Date: 2026-07-16

## Decision

Use one versioned Server-Sent Events stream for server-to-client operational
updates, backed by canonical events and an outbox. Events carry stable IDs,
monotonic per-run sequence, schema version, journey, correlation, sensitivity,
and optional Context Pack reference.

Clients persist a V2-only resume sequence, deduplicate, detect gaps, replay
missing events, reconnect with bounded jitter, and fall back to low-frequency
polling only when streaming is unavailable. Bidirectional mission mutations
remain authenticated HTTP requests with idempotency and optimistic versions.

## Consequences

SSE keeps the live path smaller than a bidirectional socket while meeting
resume/replay needs. A future WebSocket may be added only for measured
bidirectional requirements; it must use a separately versioned namespace.
