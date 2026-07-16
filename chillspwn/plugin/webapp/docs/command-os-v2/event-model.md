# Event model

Every important state change produces a durable event and outbox row in the same transaction.

Required envelope fields:

- stable event ID;
- monotonic per-run sequence;
- event type and schema version;
- UTC timestamp;
- mission, run, plan, step, assignment, action, decision, and context-pack links where relevant;
- journey;
- actor;
- semantic summary;
- structured payload;
- trace/span correlation;
- sensitivity and redaction metadata.

## Delivery

One multiplexed client stream supports heartbeat, bounded subscriber queues, replay from acknowledged sequence, deduplication, gap detection, missing-range fetch, exponential reconnect with jitter, and low-frequency polling fallback. Clients update normalized state rather than refetching every page after each event.

At-least-once delivery is expected; event IDs and sequences make application idempotent. Slow subscribers are disconnected with a resumable cursor instead of allowing unbounded memory growth.
