# Performance evidence

Current acceptance status: **local automated gates passed; production and
manual measurements remain partial**. The final unpromoted worktree meets the
local bundle, browser paint, canonical database,
event, retrieval, bounded-graph, 50,000-node graph, and 100,000-event
Observability browser budgets. Promoted loopback endpoint latency is also
recorded below.
External-network, INP, physical mobile, and long-session targets remain
unverified. The exact first-time 50,000-note physical Obsidian bridge export
and full reconciliation now pass their release budgets; the result is recorded in
[`obsidian-scale-acceptance.md`](obsidian-scale-acceptance.md).

Measured on 2026-07-15 on the local Linux x64 host with Bun 1.3.14, Chromium
148, a production Vite build, and isolated canonical SQLite fixtures. These are
repeatable engineering measurements, not simulated dashboard values.

## Repeatable gates

| Gate | Command |
| --- | --- |
| Production bundle and gzip budgets | `bun run build && bun run performance:bundle` |
| Canonical DB, memory, graph, event, and replay load | `bun run performance:runtime` |
| Representative Autonomous/Guided evaluation comparisons | `bun run performance:missions` |
| Isolated 50,000-node canonical browser profile | `bun run test:e2e:brain-scale` |
| Isolated 100,000-event canonical Observability profile | `bun run test:e2e:observability-scale` |
| Isolated physical 50,000-note exact bridge-export profile | `CHILLSPWN_OBSIDIAN_SCALE_CONFIRM=isolated-temporary-obsidian-scale-50000 bun run test:acceptance:obsidian-scale` |
| Browser paint, CLS, reduced motion, keyboard, and mobile reflow | `playwright test tests/e2e/performance-accessibility.spec.ts` |
| Strict aggregate gate | `bun run performance:check` |

`performance:check` enables the specified browser budgets. The ordinary E2E
suite still records the same browser metrics but uses only a generous safety
ceiling, because a shared/oversubscribed runner is not a controlled Web Vitals
lab. Bundle, canonical-runtime, and representative-mission regression budgets
are always enforced.

The mission benchmark is an isolated regression fixture, not live performance
telemetry. It currently contains one Autonomous and one Guided before/after
pair and fails unless every declared favorable canonical metric moves in the
expected direction without an unexpected unfavorable movement. On the latest
run both fixtures passed: the Autonomous fixture had 16 favorable measured
directions and the Guided fixture had 14, with zero unfavorable directions.
The output deliberately retains the warning that this does not establish
real-world improvement.

The current GitHub workflow runs `performance:bundle`, `performance:missions`,
and the ordinary browser suite. It does not run `performance:runtime` or set
`COMMAND_OS_ENFORCE_BROWSER_BUDGETS=true`. CI therefore catches major browser
regressions but is not yet the strict aggregate performance gate described by
`performance:check`.

## Production bundle

Measured with `node:zlib` gzip level 9 against the generated `dist/index.html`
and every emitted JavaScript/CSS asset.

| Metric | Result | Budget | Status |
| --- | ---: | ---: | --- |
| Initial JavaScript | 101,843 bytes gzip | 256,000 bytes | pass |
| Largest deferred route chunk | 27,739 bytes gzip | 153,600 bytes | pass |

Boot logic remains an external asset so the global CSP can keep
`script-src 'self'`. Deferred route chunks are not on the initial operational path. CI runs
`performance:bundle` after the production build.

## Local browser measurements

Five production-shell navigations were captured through `PerformanceObserver`
and Navigation Timing. The isolated server used a fresh database and inherited
no operator credentials.

| Metric | p75 | Target | Status |
| --- | ---: | ---: | --- |
| First Contentful Paint | 80 ms | 1,000 ms | pass |
| Largest Contentful Paint | 400 ms | 1,800 ms | pass |
| Cumulative Layout Shift | 0.00072 | 0.05 | pass |

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

The table below is the final controlled run after migration quiesced.
The fixture seeded in 4,010 ms. An earlier run while the host was saturated by
migration observed local-graph p95 around 222 ms, above the 200 ms gate. That
contended sample remains an environmental warning and was not substituted for
the controlled result.

| Metric | Result | Budget | Status |
| --- | ---: | ---: | --- |
| Hybrid FTS/graph memory retrieval p95 (50 rounds) | 0.499 ms | 300 ms | pass |
| Local graph, 250 nodes/249 edges p95 | 92.84 ms | 200 ms | pass |
| Expanded graph, 500 nodes/499 edges p95 | 111.15 ms | measured | pass |
| Global graph, 250 nodes p95 | 99.571 ms | 1,500 ms | pass |
| Canvas layout, bounded 500-node segment p95 | 0.313 ms | 50 ms | pass |
| Event append throughput | 10,658.5 events/s | 200 events/s | pass |
| Event replay | 5,000/5,000, final sequence 5,000 | no gaps | pass |
| Event replay throughput | 213,971 events/s | 1,000 events/s | pass |
| Outbox delivery | 5,000/5,000 at 23,725 events/s | no loss | pass |

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

## 50,000-node browser interaction

The opt-in Playwright profile writes the real canonical schema to a fresh
temporary SQLite database, including 50,000 FTS-indexed nodes and 49,999 typed
edges. No production route imports or exposes the fixture. The final recorded
profile seeded that database in 4,446 ms and passed one-for-one with these local
measurements:

| Interaction | Result | Budget | Status |
| --- | ---: | ---: | --- |
| Brain summary API | 262.06 ms | 1,000 ms | pass |
| Global 250-node graph API | 134.61 ms | 1,000 ms | pass |
| Initial graph interactive | 660.29 ms | 1,500 ms | pass |
| Progressive 250 → 500 load and layout | 303 ms | 1,500 ms | pass |
| FTS sentinel outside the initial segment | 5.98 ms | 300 ms | pass |
| Local two-hop graph API | 6.31 ms | 200 ms | pass |
| Local graph interactive | 405 ms | 1,500 ms | pass |
| Pan/zoom/focus and accessible-table interaction | 519 ms | 1,500 ms | pass |

The page held 295 DOM elements, one canvas, no table rows until the accessible
alternative was requested, and at most 500 loaded nodes. The searched sentinel
was absent from the first segment, found through canonical FTS, then opened as a
real five-node/four-edge local neighborhood. There were no page or console
errors. The Playwright attachment is
`e2e-only-second-brain-50000-node-evidence.json`.

## Exact physical 50,000-note Obsidian bridge profile

The opt-in isolated profile exercised the production `exportNodes` path against
a fresh physical temporary vault. It projected and fully reconciled exactly
50,000 canonical Markdown/YAML notes in 41,019.51 ms and reconciled them in
2,452.93 ms, below both gates,
with zero failures or conflicts. Incremental operator edit, candidate import,
conflict/merge, source-hash invariants, bounded cancellation, and cleanup also
passed. The fixture never read production vault configuration.

Native recursive watch was available (`nativeWatchUnavailable=false`) and the
bounded incremental fixture produced 14 raw events with zero watcher errors.
This result proves first-export/reconciliation and bounded native-watch
behavior, not a sustained multi-hour watcher profile,
production-vault behavior, native Obsidian application rendering, or a
50,000-note portable ZIP. The full command, fixture contract, measurements, and
failure history are in
[`obsidian-scale-acceptance.md`](obsidian-scale-acceptance.md).

## Controls in the implementation

- route-level splitting and deferred generated media;
- bounded graph neighborhoods, canvas rendering, and cancellable worker layout;
- FTS5 plus indexed adjacency traversal;
- prepared statements, WAL, and transaction batching;
- append-only event replay with bounded subscriber queues;
- notification reads use indexed 20-record cursor pages, and actor-scoped
  mark-all uses one scope-checked `INSERT ... SELECT`; the focused 1,105-record
  case completes without materializing an unbounded `IN` list;
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

## Reconnect burst regression

An isolated in-process reconnect burst now opens 64 concurrent run-scoped
subscriptions at different acknowledged sequences over 500 durable events. All
subscribers replayed to sequence 500 without a gap or duplicate, and closing
them returned the service subscription count to zero. The focused event slice
passed 12 tests with 229 assertions. This proves bounded replay cleanup under a
local reconnect burst; it does not replace packet-loss testing or a multi-hour
heap profile.

## 100,000-event browser Observability profile

The opt-in Playwright profile persisted 100,000 ordered append-only events and
four FTS-indexed structured logs under one trace in a fresh temporary canonical
database. The isolated server inherited no operator credentials, and no
production path imports or exposes the fixture. Seeding completed in 1,396 ms.

| Interaction | Result | Budget | Status |
| --- | ---: | ---: | --- |
| Events API, first 50 | 270.49 ms | 1,000 ms | pass |
| Events API, next 50 | 234.73 ms | 1,000 ms | pass |
| Trace semantic search | 723.27 ms | 3,000 ms | pass |
| Trace detail, first 50 | 707.08 ms | 3,000 ms | pass |
| Trace detail, next 50 | 676.80 ms | 3,000 ms | pass |
| Structured-log FTS search | 4.30 ms | 500 ms | pass |
| Trace search-to-waterfall interaction | 2,368.89 ms | 5,000 ms | pass |
| Trace next-page interaction | 904.56 ms | 5,000 ms | pass |
| Event next-page interaction | 211.31 ms | 3,000 ms | pass |
| Event exact-type/journey filter | 419.64 ms | 3,000 ms | pass |
| Structured-log search/severity filter | 128.50 ms | 3,000 ms | pass |
| Two animation frames after full-page scroll | 30.60 ms | 500 ms | pass |

Both the event and correlated trace pages returned 50 records per page with
zero duplicate IDs across the first two pages. Payloads remained bounded at
37,734 bytes for the event page and 48,136 bytes for the trace page. The
rendered event view held 1,016 DOM elements and exactly 50 semantic rows despite
the 100,000-record database. Chromium recorded four long tasks totaling 268 ms,
with a 78 ms maximum, and no page or console errors. Real event and log records
were visible together in the trace waterfall; exact event filtering and FTS
log search were exercised through the UI. The Playwright attachment is
`e2e-only-observability-100000-event-evidence.json`.

Every event/log/action/tool source query remains independently capped before
the trace repository merges a page, so response memory and rendered DOM are
bounded independently of trace size.

## Remaining measurement work

The following are not claimed by this report: INP under realistic interaction
load, Lighthouse on physical mid-tier mobile hardware, reconnect storms under
network packet loss, a multi-hour heap and native-watcher profile, a
production-vault rollback, a 50,000-note portable ZIP, and
external-network latency. They remain explicit
follow-up gates; no result has been fabricated.

Also required before a production performance claim:

- repeat browser measurements against the promoted service through its normal private ingress;
- record INP from representative Command Palette, decision, graph, and mission-control interactions;
- test reconnect storms and bounded subscriber behavior under packet loss;
- run a multi-hour mission/graph heap and idle-CPU profile;
- run a sustained physical-vault watcher profile;
- decide whether strict runtime/browser budgets should block CI, and document any hardware-dependent tolerance rather than silently weakening targets.
