# Legacy compatibility contract

Status: initial protection contract for authoritative `main` at `343f6ac5a05f7286a0d66aee8c5dbd6e78a41aee`.

## Purpose

The existing `chillspwn/plugin/webapp` remains the production baseline throughout parallel V2 development. A V2 change is unacceptable if it changes a legacy route, payload, interaction, file path, storage key, runtime mode, provider/MCP behavior, Android packaging behavior, or resource budget without a separately reviewed compatibility change.

This contract is additive: it does not promise that every current behavior is ideal. It promises that V2 will not silently destabilize it.

## Protected source and build boundary

The following are legacy-owned and outside the V2 dependency graph:

- `src/App.tsx`, all `src/pages/*`, legacy components, `src/index.css`, and legacy global variables;
- `server/index.ts`, existing `server/routes/*`, `/ws`, existing SSE endpoints, and provider/session process protocol;
- `package.json`, `bun.lock`, Vite output, PWA/service-worker behavior, and Capacitor Android sources;
- `public/Logo.svg`, whose SHA-256 must remain `0a3dfd69f74a00d41bb0cb20d6af1097dffa265d4c1e54c9228fe4b55f85c955`.

V2 must not import legacy page modules or CSS. It may consume audited domain contracts through an explicit shared package only after dual-client contract tests exist.

## Protected runtime behavior

The following remain available and retain current request/response or wire behavior during preview:

- authentication middleware and secure configuration startup;
- `/api/health`, persona/configuration, live-session, session restore/list/rename/delete, and provider catalog APIs;
- board/Kanban APIs and Mission Board agent views;
- runtime run, plan-preview, approval-mode, approval, evidence, report, memory, lesson, agent, MCP, asset, and artifact APIs;
- engagement, files, logs, LLM/API events, system, reports, OSINT, Council, cron, skills, and delegation APIs;
- shared legacy `/ws` chat/terminal protocol and current SSE streams;
- provider selection and current enforce/observe labeling;
- process-tree shutdown, allowed-workspace enforcement, root memory broker, secret redaction, and no-hands commander boundary.

V2 routes live under `/api/v2`; V2 events use a separately versioned endpoint. No legacy wildcard route or static handler may swallow a V2 API error and return HTML as apparent success.

## Protected data and filesystem behavior

V2 preview may read through a bounded importer but may not rewrite, rename, delete, or dual-write:

- `/root/.hermes/chillspwn/sessions`;
- `/root/.hermes/chillspwn/runtime`;
- `/root/.hermes/chillspwn/session-logs`, logs, and LLM logs;
- `/root/.hermes/kanban.db` or live WAL/SHM files;
- `/root/.hermes/memories` or its broker contract;
- `/root/htb/boxes`, `/root/engagements`, report templates, provider auth state, or MCP vendor/config roots.

The importer records source hashes and timestamps, operates idempotently, quarantines malformed records, and preserves originals. V2-native state goes only to its dedicated database and artifact roots.

## Browser behavior to retain

The compatibility suite must prove at least:

1. legacy shell loads at its unchanged entry route and exposes all 21 registered applications;
2. a session can be created, restored, opened, renamed, and deleted with its current confirmation behavior;
3. persona switching and provider/model selection still resolve to current backend behavior;
4. primary chat sends, reconnects, restores, and reports live/idle state;
5. existing approval and managed/observe labels remain accurate;
6. Mission Board, cockpit, engagements, evidence/artifacts, reports, logs, and system views load;
7. terminal and chat WebSocket behavior still works;
8. direct hash navigation used by existing report/cockpit links remains valid;
9. refresh/resume does not lose the current legacy session;
10. phone navigation, grouped drawer, and Capacitor build inputs remain unchanged;
11. V2 preview storage, caches, service worker, route state, and event tokens are absent from the legacy namespace;
12. a V2 crash or kill-switch operation does not reload, redirect, or disable legacy.

## API characterization strategy

Before a shared/backend change merges, capture and compare:

- method, route, status code, content type, and stable payload shape for each existing API;
- legacy WebSocket client/server message schemas and close/reconnect behavior;
- SSE event names, data envelopes, heartbeat behavior, and disconnect cleanup;
- startup/readiness and graceful-shutdown behavior;
- authorization/scope denial envelopes;
- artifact/report content disposition and path-safety behavior;
- representative imported legacy records and missing-record responses.

Fixtures must redact credentials and client data. Snapshot only stable contract fields; dynamic timestamps/IDs are validated by schema rather than frozen values.

## Mandatory check sequence

The authoritative-main baseline passes:

```text
bun run check:server-entry
bun run typecheck
bun run typecheck:client
bun test ./server ./src/lib
python3 integration/test_or_gate_client.py
python3 integration/test_board_mcp_server.py
bun run build
```

Observed results were 593/593 Bun tests, 34/34 OpenRouter gate cases, 17/17 Mission Board MCP cases, and a successful 66-module Vite build. The repository currently has no Playwright/Cypress project; therefore this source-level baseline is necessary but not sufficient.

For every V2 backend, database, provider, MCP, or shared-package change, the merge gate is:

1. source/type/unit/integration checks above;
2. legacy API contract suite;
3. legacy browser critical-journey suite in Chromium, Firefox, and WebKit, with mobile coverage where relevant;
4. console/network/accessibility assertions;
5. legacy performance and concurrent-load comparison.

No automatic retry may mask an intermittent release failure.

## Performance and resource contract

The initial build baseline is recorded in `baseline-performance.md`. A preview workload may not regress approved legacy p75 latency, CPU, memory, provider/MCP capacity, event throughput, or startup by more than 5%. Legacy must not download V2 bundles and V2 must not download legacy bundles.

V2 has separate concurrency, queue, provider-token, MCP-call, storage, and subscriber limits. When capacity is exhausted, V2 queues/rejects preview work without consuming legacy-reserved capacity.

## Compatibility exceptions

An exception requires:

- a specific legacy defect or security reason;
- affected routes, clients, files, and data identified;
- before/after contract diff;
- migration and rollback procedure;
- legacy browser/API tests updated in the same change;
- explicit review separate from ordinary V2 work.

V2 does not receive authority to clean up legacy code, polling, styling, route names, or storage during parallel development.

## Current evidence gaps

Versioned API snapshots, browser traces/screenshots, Web Vitals, accessibility baselines, live-provider checks, and concurrent V2/legacy resource measurements are not present at authoritative HEAD and have not been claimed here. Creating and approving them is required before any shared backend change or cutover.
