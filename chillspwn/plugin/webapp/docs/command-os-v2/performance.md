# Performance evidence

Current acceptance status: **partial**. The final candidate meets the recorded
local bundle, browser paint, canonical database, event, retrieval, and
bounded-graph budgets after migration quiesced. Promoted loopback endpoint
latency is also recorded below. External-network, INP, physical mobile,
long-session, very-large UI, and 50,000-note physical Obsidian-vault performance
targets remain unverified. The isolated physical-filesystem Obsidian functional
smoke is recorded separately in [`test-evidence.md`](test-evidence.md).

Measured on 2026-07-15 on the local Linux x64 host with Bun 1.3.14, Chromium
148, a production Vite build, and isolated canonical SQLite fixtures. These are
repeatable engineering measurements, not simulated dashboard values.

## Repeatable gates

| Gate | Command |
| --- | --- |
| Production bundle and gzip budgets | `bun run build && bun run performance:bundle` |
| Canonical DB, memory, graph, event, and replay load | `bun run performance:runtime` |
| Browser paint, CLS, reduced motion, keyboard, and mobile reflow | `playwright test tests/e2e/performance-accessibility.spec.ts` |
| Strict aggregate gate | `bun run performance:check` |

`performance:check` enables the specified browser budgets. The ordinary E2E
suite still records the same browser metrics but uses only a generous safety
ceiling, because a shared/oversubscribed runner is not a controlled Web Vitals
lab. Bundle and canonical-runtime budgets are always enforced.

The current GitHub workflow runs `performance:bundle` and the ordinary browser
suite. It does not run `performance:runtime` or set
`COMMAND_OS_ENFORCE_BROWSER_BUDGETS=true`. CI therefore catches major browser
regressions but is not yet the strict aggregate performance gate described by
`performance:check`.

## Production bundle

Measured with `node:zlib` gzip level 9 against the generated `dist/index.html`
and every emitted JavaScript/CSS asset.

| Metric | Result | Budget | Status |
| --- | ---: | ---: | --- |
| Initial JavaScript | 90,880 bytes gzip | 256,000 bytes | pass |
| Largest deferred route chunk | 17,621 bytes gzip | 153,600 bytes | pass |
| All JavaScript | 165,676 bytes gzip | informational | measured |
| All CSS | 28,283 bytes gzip | informational | measured |

Boot logic remains an external asset so the global CSP can keep
`script-src 'self'`. Deferred route chunks are not on the initial operational path. CI runs
`performance:bundle` after the production build.

## Local browser measurements

Five production-shell navigations were captured through `PerformanceObserver`
and Navigation Timing. The isolated server used a fresh database and inherited
no operator credentials.

| Metric | p75 | Target | Status |
| --- | ---: | ---: | --- |
| First Contentful Paint | 120 ms | 1,000 ms | pass |
| Largest Contentful Paint | 408 ms | 1,800 ms | pass |
| Cumulative Layout Shift | 0.000117 | 0.05 | pass |
| DOMContentLoaded | 61.5 ms | informational | measured |

Across the final five-sample run Chromium reported no long tasks over 50 ms.
These values came from the local isolated production-shell browser run and are
not promoted-service or network measurements. INP and real mid-tier mobile
hardware still require a controlled lab run.

## Final quiescent canonical database, event, and 50,000-node graph gate

The load script creates and deletes its own temporary WAL database. The fixture
contains 50,000 canonical memory nodes, 50,000 memory versions, 49,999 typed
edges, one mission/run, and 5,000 append-only events with outbox rows. It never
reads or writes production state. The recorded baseline includes the Memory Control
Center policy lookup performed once per retrieval.

The table below is the final controlled run after migration quiesced. An earlier
run while the host was saturated by migration observed local-graph p95 around
222 ms, above the 200 ms gate. That contended sample remains an environmental
warning and was not substituted for the final controlled result.

| Metric | Result | Budget | Status |
| --- | ---: | ---: | --- |
| Hybrid FTS/graph memory retrieval p95 (50 rounds) | 0.499 ms | 300 ms | pass |
| Local graph, 250 nodes/249 edges p95 | 115.972 ms | 200 ms | pass |
| Expanded graph, 500 nodes/499 edges p95 | 109.505 ms | measured | pass |
| Global graph, 250 nodes p95 | 116.635 ms | 1,500 ms | pass |
| Canvas layout, bounded 500-node segment p95 | 0.439 ms | 50 ms | pass |
| Event append throughput | 10,385 events/s | 200 events/s | pass |
| Event replay | 5,000/5,000, final sequence 5,000 | no gaps | pass |
| Event replay throughput | 259,514.2 events/s | 1,000 events/s | pass |
| Outbox delivery | 5,000/5,000 at 21,455.2 events/s | no loss | pass |

`EXPLAIN QUERY PLAN` confirms that local graph expansion uses both
`idx_memory_edges_source_type_target` and
`idx_memory_edges_target_type_source`. The graph API returns bounded segments
and `truncated: true`; the canvas never attempts to render all 50,000 nodes.

The benchmark exposed and fixed two production defects:

- the UI expanded to 500 nodes while the API rejected requests over 250;
- edge serialization repeatedly traversed the same adjacency list once per
  edge, creating an N+1 path around connected hubs.

The API now accepts bounded progressive segments up to 1,000 nodes and projects
the already-authorized edge rows in one indexed query.

## Controls in the implementation

- route-level splitting and deferred generated media;
- bounded graph neighborhoods, canvas rendering, and cancellable worker layout;
- FTS5 plus indexed adjacency traversal;
- prepared statements, WAL, and transaction batching;
- append-only event replay with bounded subscriber queues;
- reduced-motion CSS and mobile removal of expensive decorative effects;
- cursor pagination and semantic event summaries rather than raw output walls.

## Promoted loopback service

After the final application rollback-and-return rehearsal, the promoted release
served `/api/health`, `/api/v2/health`, and `/api/v2/brain/health` with HTTP 200
in approximately 2–3 ms locally; `/api/v2/overview` returned HTTP 200 in
approximately 49 ms. Both services remained active with zero restarts and
production SSE connected.

The database health endpoint reports SQLite integrity `[ok]`, WAL, foreign keys
enabled, migration 7, and zero pending outbox rows. Full SQLite integrity is
cached for bounded repeated health reads and can be explicitly refreshed; this
avoids the earlier defect where a multi-gigabyte `PRAGMA quick_check` could
block the event loop on every health interval. These are loopback service
measurements, not external private-ingress Web Vitals.

## Remaining measurement work

The following are not claimed by this report: INP under realistic interaction
load, Lighthouse on physical mid-tier mobile hardware, 100,000-event UI
virtualization, reconnect storms under packet loss, a multi-hour heap profile,
incremental sync of a 50,000-note physical Obsidian vault, and external-network
latency. They remain explicit follow-up gates; no result has been fabricated.

Also required before a production performance claim:

- repeat browser measurements against the promoted service through its normal private ingress;
- record INP from representative Command Palette, decision, graph, and mission-control interactions;
- exercise a populated 100,000-event run in the rendered Observability view;
- test reconnect storms and bounded subscriber behavior under packet loss;
- run a multi-hour mission/graph heap and idle-CPU profile;
- measure incremental filesystem watcher/import/export behavior on a physical large vault;
- decide whether strict runtime/browser budgets should block CI, and document any hardware-dependent tolerance rather than silently weakening targets.
