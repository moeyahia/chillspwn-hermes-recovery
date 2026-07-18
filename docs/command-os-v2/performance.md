# Command OS V2 performance status

Status: current production-build transfer measurements, canonical 50,000-node
Second Brain query measurements, and architectural controls are recorded.
Field Web Vitals, browser-rendered graph frame-rate/layout cancellation,
large-Vault sync, legacy-coexistence measurements, and soak approval remain
open release gates.

## Current build checkpoint

The latest production build recorded in
`/tmp/v2-check-obsidian-final-20260717T0353Z.log` was emitted on 2026-07-17:

| Asset | Raw | Gzip | Budget interpretation |
|---|---:|---:|---|
| Main application | 362.18 kB | 105.56 kB | Entry application code |
| React vendor | 11.73 kB | 4.20 kB | Loaded on the entry path |
| Minimum initial JavaScript | 373.91 kB | 109.76 kB | Main plus React, before route chunks |
| Global V2 CSS | 136.86 kB | 19.57 kB | Independently scoped; no legacy CSS import |
| Run Workspace route | 271.16 kB | 67.26 kB | Below the 150 kB gzip route target |
| Lazy Artifact Intelligence route | 36.79 kB | 9.17 kB | Script and page-capture detail remains off the entry path |

The minimum initial JavaScript remains below the practical 250 kB gzip target.
These are emitted transfer-size observations, not p75 FCP, LCP, INP, CLS, CPU,
memory, or long-task proof.

The current package gate passed 645 tests with 9,206 assertions across 121 files,
after independently verifying the logo, application isolation, browser/server
TypeScript, E2E TypeScript, and the production build. Vite transformed 142
modules and completed the recorded build in 2.39 seconds. This is package and
build evidence; Playwright remains a separate browser gate.

## 50,000-node canonical Brain checkpoint

`server/memory/__tests__/SecondBrainScale.test.ts` creates a migrated SQLite
database with exactly 50,000 canonical memory nodes, live FTS triggers, and 999
root-neighborhood edges within a 49,999-edge graph. Twenty warm samples per
indexed operation produced:

| Operation | Measured result | Contract |
|---|---:|---:|
| FTS memory search p95 | 2.1 ms | less than 300 ms |
| Local graph neighborhood p95 | 90.2 ms | less than 200 ms |
| Progressive global graph shell | 147.7 ms | less than 1,500 ms |

The benchmark initially exposed a 4,144.3 ms correlated edge-degree query in
the real graph router. Replacing the per-node correlated count with one
materialized live-edge degree aggregation reduced the measured graph shell to
147.7 ms on the final 49,999-edge fixture while preserving access filtering and
lifecycle rules. The focused Brain suite passes 23/23 with 392 assertions.

This proves server-side indexed search, local expansion, and progressive shell
selection against canonical records. It does **not** prove canvas/WebGL frame
rate, worker cancellation, browser memory behavior, or Obsidian filesystem sync
at that scale.

## Implemented performance controls

- every primary feature route is lazy-loaded;
- query caching avoids whole-dashboard refetches for small changes;
- live events use one resumable SSE stream with sequence reconciliation and a
  low-frequency fallback;
- mission, evidence, event, agent, and memory APIs use bounded cursor pages;
- SQLite repositories use prepared statements and indexed canonical tables;
- graph layout runs in a worker with bounded neighborhood queries;
- optional brand media is lazy and noncritical;
- hidden/reduced-motion states avoid decorative continuous work;
- E2E uses a unique database per invocation to avoid cross-run contention;
- Playwright outputs are namespaced by run ID so one browser project cannot
  overwrite another project's performance or failure evidence.

## Release measurements still required

- desktop and mid-tier-mobile p75 FCP, LCP, INP, and CLS;
- bundle budgets after every remaining production slice;
- 100,000-event scroll/search and reconnect-storm UI measurements;
- browser-rendered 50,000-node progressive loading, layout cancellation, and
  60-fps active-neighborhood proof (indexed search and server expansion are now
  measured above);
- Context Pack retrieval p95 under representative policy and disclosure loads;
- large incremental Obsidian sync without runtime starvation;
- database query benchmark report;
- concurrent legacy/V2 CPU, memory, latency, provider, MCP, and event throughput
  proving no more than 5% approved legacy regression;
- memory-leak and 72-hour automated soak evidence;
- the default seven-day preview acceptance window and human performance review.

Until those measurements exist, performance remains a release gate rather than
an inferred success from bundle size.
