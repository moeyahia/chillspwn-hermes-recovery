# Test evidence

This file records checks that were actually run. Test files that exist but were
not included in the final local aggregate gate are listed separately and are
not treated as passes. The release decision and acceptance traceability are in
[`completion-gap-audit.md`](completion-gap-audit.md).

## Phase 0 baseline (historical)

These results characterize the pre-V2 starting point. They are preserved for
comparison and do not supersede the latest candidate gate below.

| Check | Result |
| --- | --- |
| Server Bun tests | 562 passed, 0 failed |
| Frontend utility Bun tests | 31 passed, 0 failed |
| Server TypeScript | passed |
| Client TypeScript | passed |
| Vite production build | passed |
| Logo SHA-256 | matched required invariant |

## V2.1 evidence log

Implementation milestones append the exact command, result, elapsed time where measured, and relevant artifact. A check is recorded as passed only when actually executed.

Required gates include database/migration, journey invariants, supervisor bounds, event replay, restart/resume, cancellation, memory isolation/forgetting, Obsidian round-trip/conflict, browser journeys, accessibility, responsive screenshots, and performance/load fixtures.

### Final unpromoted worktree gate — 2026-07-15

This is the final measured gate for the current shared worktree. It validates
the source candidate only: production remained on the promoted schema-7
release, and none of these results authorizes a deployment, migration, or
promotion.

| Check | Command | Result |
| --- | --- | --- |
| Complete aggregate | `bun run check` | passed: server entry bundled 203 modules; server, client, and E2E TypeScript passed; 1,114 Bun tests passed with 0 failures and 6,194 expectations across 154 files; Python authorization gate 34/34; packaged board integration 17/17; Vite transformed 105 modules |
| Complete browser journeys | `bun run test:e2e` | passed 31/31 in 1.2 minutes |
| Strict performance aggregate | `bun run performance:check` | passed bundle, canonical runtime, representative missions, and enforced browser budgets: initial JavaScript 101,843 bytes gzip; largest deferred chunk 27,739 bytes gzip; FCP p75 80 ms; LCP p75 400 ms; CLS 0.00072; no long task over 50 ms |
| Canonical runtime profile | `bun run performance:runtime` | passed: memory search p95 0.499 ms; local 250-node graph p95 92.84 ms; local 500-node graph p95 111.15 ms; event append 10,658.5/s; replay 213,971/s |
| 50,000-node Brain browser profile | `bun run test:e2e:brain-scale` | passed: summary API 262.06 ms; graph API 134.61 ms; initial interactivity 660.29 ms; off-segment search 5.98 ms; no browser errors |
| 100,000-event Observability browser profile | `bun run test:e2e:observability-scale` | passed: event pages 270.49/234.73 ms and trace pages 707.08/676.80 ms; no browser errors |
| Exact physical 50,000-note Obsidian profile | `CHILLSPWN_OBSIDIAN_SCALE_CONFIRM=isolated-temporary-obsidian-scale-50000 bun run test:acceptance:obsidian-scale` | passed: export 41,019.51 ms; reconciliation 2,452.93 ms; native watcher available (`nativeWatchUnavailable=false`), 14 raw events, 0 watcher errors, and cleanup passed |
| Android debug package | `bun run mobile:build:android` | `BUILD SUCCESSFUL`; 93 tasks total |
| Database compatibility rehearsals | schema 7→8→9 release rehearsal plus schema-9 boundary rehearsal | passed; current identities and protected evidence are recorded below and in [`schema-7-to-9-release-rehearsal.md`](schema-7-to-9-release-rehearsal.md) |
| Repository snapshot and invariant | snapshot verifier plus `sha256sum public/Logo.svg` | passed after generated ignored Android assets were removed; logo remained `0a3dfd69f74a00d41bb0cb20d6af1097dffa265d4c1e54c9228fe4b55f85c955` |
| Dependency and secret checks | Bun audit, Gitleaks, and TruffleHog | ChillsPwn webapp production and all-dependency audits reported 0 advisories; Gitleaks worktree/history reported 0 findings; TruffleHog verified filesystem/history reported 0 verified secrets |
| Static fallback review | offline Semgrep fallback plus representative manual triage | scanned 361 tracked application files with 84 heuristic matches: 82 prepared/repository-owned SQL sites and two escaped `dangerouslySetInnerHTML` sites; representative triage found no actionable sink; 0 `eval`, dynamic-shell, `shell:true`, or TLS-disable sites. Semgrep exited 1 in heuristic/error mode, emitted one parser-coverage warning, and could not run registry-backed rules offline, so this is not claimed as a clean Semgrep scan. |
| Documentation, size, and whitespace hygiene | changed/untracked documentation link check, large-file inventory, and patch checks | 34 changed/untracked Markdown files and 71 links had 0 missing targets; the whole-repository baseline still has eight pre-existing missing links; no file exceeded 100 MiB; patch whitespace passed |

The schema rehearsal evidence root is
`/root/chillspwn-schema8-rehearsal/20260715T222555Z`; its bridge archive
SHA-256 is
`7f247c6cecee09c504ffae0c5d1865147544c187df1ececd6ec9df2f0a3ac36f`.
The candidate source/built identities are respectively
`821953911bcf88704af2075035a31797bed30f30d2c7bd2fcc4fe2c5c4427388`
and `a4e7c7f7868c58322115a1c9e65aabd3659b3be4b583eb7692b0002e1cf43281`.
Both evidence checksum files passed. The rehearsal used isolated ports `48516`,
`36689`, `48821`, `39482`, `51844`, `53369`, and `35642`; every listener was
gone afterward and production remained unchanged.

### Historical unpromoted worktree interim gate — 2026-07-15

This earlier checkpoint includes the
Autonomous execution-boundary closure, durable exact Guided approval,
cross-process Guided idempotency, Context Pack linkage validation, explicit
lesson-use consent, portfolio/workspace completion, trace projection, and the
50,000-node browser profile. It is retained as historical evidence and is
superseded by the final unpromoted worktree gate above.
Autonomous branch/amendment, canonical Decisions, in-app notifications,
Completion Review mutations/pagination truth, and portable-archive authorization
changed after these aggregate commands. Their focused evidence is recorded
below. The installed schema-7 service was not changed.

| Check | Command | Result |
| --- | --- | --- |
| Recorded interim aggregate before the last parallel UI changes | `bun run check` | passed: server entry bundled 179 modules; server, client, and E2E TypeScript passed; 929 Bun tests passed with 0 failures and 4,365 expectations across 132 files; Python authorization gate 34/34; board MCP integration 17/17; Vite build transformed 100 modules |
| Recorded interim browser aggregate before the last parallel UI changes | `bun run test:e2e` | passed 24/24 in 47.4 s after a production build: 15 foundation/empty-state cases and nine populated canonical cases |
| Strict interim performance gate | `bun run performance:check` | passed bundle, canonical runtime, synthetic mission, and five enforced browser-budget cases; current measurements are in [`performance.md`](performance.md) |
| 50,000-node canonical browser profile | `bun run test:e2e:brain-scale` | passed 1/1; the default empty-state browser smoke also passed 1/1, E2E TypeScript and production build passed, and `git diff --check` was clean at that checkpoint |
| Android debug package | `bun run mobile:build:android` | passed Capacitor production sync and Gradle `assembleDebug`; `BUILD SUCCESSFUL`, 93 tasks total, 27 executed |
| Current web dependency audit | `bun audit --production` | passed; no vulnerability reported in the ChillsPwn webapp package scope |
| Current secret rescan | Gitleaks worktree plus TruffleHog verified Git-history scan | zero findings / zero verified secrets |

The 50,000-node browser fixture created a real temporary SQLite/FTS graph with
50,000 nodes and 49,999 edges in 4,446 ms. Summary/global APIs returned in
224/138 ms; initial graph interactivity was 673 ms; progressive 250 → 500 node
loading was 303 ms; the off-segment FTS sentinel search was 4.96 ms; its local
two-hop API/UI loaded in 6.31/405 ms; and pan/zoom/focus plus the accessible
table completed in 519 ms. The rendered view stayed bounded at 295 DOM
elements, one canvas, and 500 loaded nodes, with no browser errors. The attached
Playwright artifact is `e2e-only-second-brain-50000-node-evidence.json`.

Focused and aggregate evidence for the security closure proves:

- plan admission checks both signed action fields, target, destructive policy,
  and exact signed specialist before Autonomous work is accepted;
- the live specialist/tool decision is re-evaluated immediately before MCP
  dispatch, and Autonomous `require_approval`/`deny` paths produce no tool or
  evidence side effect;
- restart/retry checks current authorization, contract version, action,
  assignment, specialist, MCP binding, mapping, and tool policy rather than
  trusting historical authority;
- a Guided approval-gated tool call requires a canonical, expiring,
  argument-bound, atomically one-time attestation; changed/replayed claims fail;
- two Guided service instances sharing one WAL database produce only one
  provider call, Context Pack, provider turn, semantic event, and completed
  conversation exchange for one idempotency key;
- Context Pack cross-scope, missing-link, plan/step, and journey mismatches fail
  transactionally; canonical node mission/engagement, lifecycle, version,
  sensitivity, and journey permission are also revalidated at persistence,
  while valid correlated and intentionally global packs work;
- a verified lesson without an explicit journey-use retention flag is
  ineligible for a follow-up run.

No result in this section is attributed to the live schema-7 deployment.

### Post-interim convergence — focused historical evidence, 2026-07-15

These checks ran after the 929-test/24-browser checkpoint. They remain direct
historical evidence for the named slices; the final aggregate above now
includes the converged implementation.

| Check | Command | Result |
| --- | --- | --- |
| Autonomous branch/amendment and canonical Decisions | `bun test server/missions/__tests__/AutonomousBranchService.test.ts server/routes/__tests__/commandOsRoutes.test.ts server/operations/__tests__/DecisionInboxRouter.test.ts src/lib/__tests__/decisionInbox.test.tsx` | 16 passed, 0 failed; 139 expectations. The active source cannot branch, the terminal source creates one idempotent separate run under unchanged or successor authority, and the canonical inbox includes scoped/redacted Guided decisions, contracts, Autonomous exceptions, and administrative records. |
| In-app notification repository and client | `bun test server/notifications/__tests__ src/lib/__tests__/notifications.test.tsx` | 9 passed, 0 failed; 94 expectations. Actor-scoped receipts, human-only mutations, access-bound replay, cursor paging, journey allowlists, live invalidation, and a 1,105-record bounded mark-all case pass. |
| In-app notification browser journeys | `bun x playwright test tests/e2e/command-os.spec.ts tests/e2e/populated-journeys.spec.ts --grep 'notification'` | 2 passed in 5.7 s. Empty and populated panels prove focus entry/restoration, 20→25 cursor loading, persisted read state, semantic deep links, and explicit in-app-only language. |
| Completion Review review gates and page truth | `bun test server/operations/__tests__/OperationsRouter.test.ts src/lib/__tests__/completionReview.test.ts src/lib/__tests__/completionReviewActions.test.tsx` | 20 passed, 0 failed; 160 expectations. Exact-run finding/lesson/memory review support and capped-page partial semantics pass. |
| Completion Review populated mutation journey | `PATH=/opt/chillspwn-runtime/bin:$PATH bun x playwright test tests/e2e/populated-journeys.spec.ts --project=populated-journeys --grep "Completion Review presents measured budgets"` | 1 passed in 3.8 s. The browser exercised measured budget truth and canonical finding, lesson, and memory-candidate mutations. |
| Second Brain replay and portable archive authorization | `bun test server/memory/__tests__ server/vault/__tests__` | 60 passed, 0 failed; 495 expectations. Cached mutations reauthorize current actor/access; portable replay/download is owner-, scope-, connection-, node-, size-, and SHA-256-bound, including revoked and tampered denials. |
| Archive hardening type/entry gates | `bun run typecheck && bun run check:server-entry` | passed. |

The Autonomous branch surface has focused service/API coverage and is wired into
the Mission Settings UI. A populated browser journey through pause/cancel,
unchanged-contract branching, and successor-contract confirmation remains a
separate acceptance item. External notification delivery also remains absent by
design; these checks cover the in-app channel only.

### Focused observability trace slice — 2026-07-15

| Check | Command | Result |
| --- | --- | --- |
| Scoped trace router and 100,000-event fixture | `bun test server/observability/__tests__/TraceRouter.test.ts server/observability/__tests__/TraceScale.test.ts` | 2 passed, 0 failed; 28 expectations; latest first/next 50-record pages 558.3/560.1 ms |
| Trace schemas, waterfall markup, checked V2 catalog | `bun test src/lib/__tests__/observabilityTrace.test.tsx server/contracts/__tests__/v2Contract.test.ts` | 7 passed, 0 failed; 35 expectations |
| Server/client TypeScript | `bun run typecheck && bun run typecheck:client` | passed |
| Server entry graph | `bun run check:server-entry` | passed; 177 modules bundled |
| Production client build | `bun run build` | passed; 100 modules transformed; Observability route 3.14 kB gzip |
| 100,000-event browser profile | `bun run test:e2e:observability-scale` | passed 1/1 in 11.5 s including isolated server lifecycle; production build passed with 101 modules transformed |

The trace tests use isolated databases and do not touch the installed service.
They prove per-source scope and sensitivity filtering, cross-engagement trace-ID
isolation, secret redaction, exclusion of normalized arguments, semantic search,
opaque cursor pagination, exact correlation of events/logs/actions/tool calls,
and bounded retrieval from a 100,000-event trace. The opt-in browser profile
then seeded 100,000 canonical events and four indexed logs in 1,396 ms and
rendered the real Observability route. First/next event API pages completed in
282.90/272.49 ms; first/next trace pages in 676.82/690.41 ms; semantic trace
search in 723.27 ms; and log FTS search in 4.30 ms. Both cursor pairs contained
100 unique IDs. The rendered event page stayed bounded at 50 rows, 1,016 DOM
elements, and 59,427 HTML bytes; event/log filters, waterfall pagination, and
full-page scrolling passed. Chromium recorded four long tasks with a 78 ms
maximum and no page or console errors. The attachment is
`e2e-only-observability-100000-event-evidence.json`. Network packet-loss and a
multi-hour heap soak remain explicit gaps.

### Last promoted-candidate aggregate gate — 2026-07-15

The latest local candidate gate was executed after the Guided preference,
completion review/export, command-palette, cancellation-cleanup, provider
bridge, logging, and browser-header changes had landed in the shared worktree.
It did not exercise the installed production service.

| Check | Command | Result |
| --- | --- | --- |
| Locked dependency install | `bun install --frozen-lockfile` | passed; lockfile unchanged |
| Patch whitespace | `git diff --check` | passed |
| Server entry graph | `bun run check:server-entry` | passed; 171 modules bundled |
| Server TypeScript | `bun run typecheck` | passed |
| Client TypeScript | `bun run typecheck:client` | passed |
| Browser-test TypeScript | `bun run typecheck:e2e` | passed |
| Server and client unit/integration suites | `bun test ./server ./src/lib` | 868 passed, 0 failed; 3,762 expectations across 120 files |
| Python authorization gate | `python3 integration/test_or_gate_client.py` | 34/34 passed |
| Packaged board MCP integration | `python3 integration/test_board_mcp_server.py` | 17/17 checks passed |
| Production bundle | `bun run build` | passed; 97 modules transformed |
| Bundle budgets | `bun run performance:bundle` | passed; 90,880-byte initial JavaScript and 17,621-byte largest deferred chunk, gzip |
| Canonical runtime budgets | `bun run performance:runtime` | passed on the final quiet candidate; detailed metrics are recorded in `performance.md` |
| Browser journeys/accessibility/performance | `bun run test:e2e:run` | 19 passed, 0 failed in 38.5 seconds: 14 foundation cases plus 5 populated canonical cases |
| ChillsPwn webapp dependency audit | `bun audit --production` | passed; no vulnerabilities found in this package scope |

This historical aggregate gate supported the currently promoted schema-7
candidate. It remains deployment evidence but is superseded for current
worktree test counts by the interim section above. Migration, production
deployment, service-account isolation, promoted Grok, restart/resume, and
application rollback are separate acceptance records below.

### Browser foundation — 2026-07-15

| Check | Command | Result |
| --- | --- | --- |
| Browser test TypeScript | `bun run typecheck:e2e` | passed |
| Production client bundle | `bun run build` | passed |
| Command OS browser journeys | `bun run test:e2e:run` | 19 passed, 0 failed in 38.5 seconds |

The browser run used Chromium 148 from the installed Kali executable. CI installs
Playwright-managed Chromium when a compatible system executable is unavailable.
The test server used a fresh temporary canonical SQLite database, empty legacy
compatibility schema, isolated HOME/runtime/vault paths, no inherited operator
credentials, secure feature defaults, and graceful shutdown cleanup.

The 14 foundation cases cover exactly two Overview and Command Palette journey
entries, legacy route compatibility, ranked and bounded palette search,
keyboard focus restoration, Autonomous readiness fail-closed in both UI and API
with zero persisted missions, an empty and accessible Second Brain/graph
surface, bounded event-stream fallback and recovery, structural accessibility,
reduced motion, local paint/CLS capture, and intentional mobile reflow/touch
targets.

The five populated cases use an explicitly labeled fixture written only to the
fresh E2E database. They prove a real canonical Overview, a completed
Autonomous Completion Review with evidence/evaluation/report and Context Pack,
an out-of-contract safe stop with a durable checkpoint and no dispatched
action, an explained Guided step whose altered exact parameters fail closed,
and an eight-node/five-edge Second Brain in which versioned correction and
forgetting remove the memory from both retrieval and the graph. These fixtures
exercise production code paths; they are not production dashboard data and do
not claim a deployed mission run.

A separate 390-by-844 focused Guided browser check passed after the mobile
navigation stacking fix. It establishes that the populated Guided workspace and
navigation remain reachable at that viewport, not that every populated mobile
journey has completed acceptance.

### Promoted live Grok OAuth and specialist smoke — 2026-07-15

`bun run test:live:grok-oauth` was run through the promoted loopback service at
`/opt/chillspwn/releases/20260715T132305Z-candidate/plugin`, using service-owned
OAuth state, no xAI API key, and the reviewed no-network
`local-selftest.quick_scan` MCP capability. No credential values or raw provider
content were recorded in this document.

The subsequent restart-harness hardening keeps the same pinned no-network
asset and SHA-256 but exposes it under the roster-approved
`sechub-reconnaissance.quick_scan` route. Deterministic `{}` compilation is now
available only after an exact child opt-in plus an independent server-side
root-owner, non-writable, no-symlink, one-server config and asset attestation.

| Journey | Result |
| --- | --- |
| Guided | Grok OAuth produced a persisted plan and exact Guided decision, transitioned `planning` to `waiting_guided_decision`, and reported `executionPerformed=false`; the Commander remained planning-only. |
| Autonomous | Grok OAuth planned and delegated to `ReconScout`; the authorized local self-test ran, produced verified evidence and a run evaluation, and transitioned `planning` to `running` to `completed` without routine input. |

The provider boundary documents the exact risk enum and normalizes only a small
controlled synonym set before the existing action, target, destructive, MCP,
and contract checks. Provider-schema repair and the Grok Commander SOUL contract
were strengthened before the final run. The final smoke did not need the repair
fallback. A superseded failed smoke was explicitly cancelled and left no
nonterminal run.

### Isolated unpromoted Grok OAuth restart/resume gate — 2026-07-15

The authoritative worktree was synced to the disposable candidate at
`/opt/chillspwn-command-os-live-gate-20260715T200938Z/webapp`. The opt-in gate
ran that candidate as the unprivileged `chillspwn` service user on
`127.0.0.1:43132` with a fresh canonical database. It used the service-owned
opaque Grok OAuth state path at `/var/lib/chillspwn/grok-auth/auth.json` and no
xAI API key. The file was treated as opaque and was not read into test output.
Grok ran as `grok-4.5` with reasoning effort `high`; no credential value or raw
provider content was captured in the evidence.

Execution was limited to the root-owned, non-writable, hash-pinned no-network
asset `/opt/chillspwn-mcp-arsenal/local-selftest-mcp.mjs`, SHA-256
`ecc77ab562c9cabf5f68297ede9df563935d1720ead341dff4c307363da8a215`, exposed
only through the roster-approved `sechub-reconnaissance.quick_scan` binding.
The child-only opt-in, closed one-server configuration, asset identity, empty
deterministic input template, and specialist binding were independently
attested before projection.

| Gate | Observed result |
| --- | --- |
| Focused source checks | 88 tests passed with 0 failures; server TypeScript and the server-entry graph passed. |
| Guided boundary | Grok created one exact Guided decision; no consequential execution occurred, and cancellation closed the run cleanly. |
| Process-loss recovery | The harness SIGKILLed the isolated server after Autonomous entered `running`, restarted it, and resumed from exactly one durable recovery checkpoint. |
| Autonomous lifecycle | The observed lifecycle was `planning` → `running` → `completed`, with no `waiting_guided_decision` after launch. |
| Durable outcome | Exactly one action and one tool call completed, producing one verified evidence record and one evaluation; no ghost-active run, assignment, action, or tool call remained. |
| Production non-interference | Production remained PID `1425345`, `NRestarts=0`, HTTP 200, with `/opt/chillspwn/plugin` still resolving to `/opt/chillspwn/releases/20260715T132305Z-candidate/plugin`. |

This is acceptance evidence for the current source candidate. It is not a
promotion, deployment, production restart, or authorization to change the live
release.

### Promoted service, SSE, and rollback acceptance — 2026-07-15

- `/opt/chillspwn/plugin` resolves to
  `/opt/chillspwn/releases/20260715T132305Z-candidate/plugin`;
- both services are active with `NRestarts=0`, only the `chillspwn` uid/gid,
  `NoNewPrivileges=yes`, and an empty capability bounding set;
- production SSE connected;
- health reports SQLite integrity `[ok]`, WAL, foreign keys enabled, migration
  7, and zero pending outbox rows;
- Overview reports readiness 93/degraded only because no mission engagement or
  scope is selected and four of 19 optional MCP servers are runnable; provider
  enforcement, 12-specialist fleet, exact-step/no-hands, event, database,
  memory, and legacy-gate checks pass, with zero active or attention-required
  operations;
- health endpoints return 200 in approximately 2–3 ms locally and Overview in
  approximately 49 ms;
- the required CSP/frame/no-sniff/no-referrer/permissions/cross-origin headers
  are present and the logo SHA-256 is unchanged.

The exact application rollback rehearsal activated the verified previous release
`20260715T130435Z-candidate`, observed healthy service at 13:32:25Z, returned
to `20260715T132305Z-candidate`, and observed healthy service at 13:32:43Z.
The final service remained active with zero restarts and the previous release is
retained as `plugin.previous`.

### Superseded schema-8 compatibility bridge rehearsal — 2026-07-15

An earlier isolated bridge was built from the exact promoted schema-7 release
with the then-current migration 008 and its ordered registration. That
rehearsal passed the checks recorded below, but migration 008 now intentionally
includes the branch/snapshot tables and therefore has a different checksum.
The earlier bridge and its commands are **superseded and unusable** for the
current candidate. They must not be executed or promoted.

Against a synthetic schema-7 canary database, the bridge created a byte-exact
pre-migration backup, applied exactly migration 8 once, and applied nothing on
restart. A full candidate → bridge → full candidate sequence then started
healthy and shut down cleanly on isolated ports against one schema-8 database.
The root-owned read-only package from that historical rehearsal also started
healthy against its matching historical checksum. Migration count, canary
state, WAL, quick check, foreign keys, event stream, and zero residual listeners
passed for that obsolete pair only. Production remained on schema 7 with the
same symlinks, process IDs, active timestamps, and zero restarts.

A fresh replacement was subsequently built from the exact live schema-7
release plus the **final** migration 008, assigned a new immutable identity,
and tested through schema 7 → bridge → schema-9 candidate, restarts, rollback,
health, and residual-listener checks. The historical supersession warning
remains in
[`schema-8-bridge-rehearsal.md`](schema-8-bridge-rehearsal.md); the replacement
evidence follows.

### Current-checksum schema-7→8→9 immutable rehearsal — 2026-07-15

| Check | Command | Result |
| --- | --- | --- |
| Fail-closed harness safety | `bun run test:rehearsal:schema7-to-schema9:safety` | passed confirmation, pinned-output, symlink-root, live-artifact, out-of-root-write, schema-version, source-version, and static production-mutation refusals |
| Bridge and candidate build | full rehearsal internal gate | both copied artifacts passed server/client/E2E type checks and production builds |
| Schema and startup sequence | `bun run test:rehearsal:schema7-to-schema9` | passed schema 7→8→9, bridge/candidate idempotence, seven clean isolated startups, quick/FK/canary checks, and zero residual listeners |
| Backup and rollback | full rehearsal internal gate | mode-`0600` schema-8 backup passed integrity, restored logically identically, served through the bridge, migrated forward to 9, and served through the candidate |
| Fail-closed compatibility | full rehearsal internal gate | schema-8 bridge rejected schema 9 and before/after database dumps matched |
| Evidence seal | `sha256sum --check --quiet CHECKSUMS.sha256` and nested checksum | passed after completion |
| Production non-interference | before/after source/symlink/service comparison | live release tree and symlink unchanged; service remained active/running at PID 1425345 with `NRestarts=0` |

The final protected evidence root is
`/root/chillspwn-schema8-rehearsal/20260715T222555Z`. The immutable bridge
archive SHA-256 is
`7f247c6cecee09c504ffae0c5d1865147544c187df1ececd6ec9df2f0a3ac36f`.
Its source and built candidate tree identities are
`821953911bcf88704af2075035a31797bed30f30d2c7bd2fcc4fe2c5c4427388` and
`a4e7c7f7868c58322115a1c9e65aabd3659b3be4b583eb7692b0002e1cf43281`.
The safety record is
`/root/chillspwn-schema8-rehearsal/safety-test-20260715T222546Z-78059/results.tsv`;
both checksum seals passed. This closes the current-worktree isolated artifact
rehearsal but does not authorize promotion. Full identities and non-claims are in
[`schema-7-to-9-release-rehearsal.md`](schema-7-to-9-release-rehearsal.md).

### Disposable schema-9 Guided-decision boundary rehearsal — 2026-07-15

| Check | Command | Result |
| --- | --- | --- |
| Fail-closed path guards | `bun run test:rehearsal:schema9:safety` | passed four negative cases; path arguments, paths outside the randomized namespace, a production-shaped canonical path, and a symlinked matching-looking rehearsal root were refused; no database was created |
| Schema-8→9 CLI rehearsal | `bun run test:rehearsal:schema9` | passed against one generated temporary schema-8 database; exactly migration 9 applied once, restart applied none, the mode-`0600` schema-8 backup passed quick/FK checks, final schema 9 passed quick/FK/health checks, and the temporary workspace was removed |
| Focused migration/database suite | `bun test server/db/__tests__/database.test.ts` | 13 passed, 0 failed; 94 expectations, including fresh migrations through 9, the schema-8 bridge boundary, fail-closed duplicate Guided decisions and complete lease cleanup, the partial uniqueness constraint, idempotence, backup, integrity, and canonical invariants |
| Server TypeScript | `bun run typecheck` | passed |
| Rehearsal helper bundle | `bun build scripts/command-os-v2/schema9-guided-boundary-rehearsal.ts --target=bun --outfile=/tmp/schema9-guided-boundary-rehearsal-check.js` | passed; 32 modules bundled, 120.59 KB; temporary bundle removed |

The synthetic schema-8 fixture contained two pending decisions for one Guided
run and one legitimate pending decision for another. Migration 9 cancelled the
ambiguous pair, blocked two steps and two assignments, cleared assignment lease
owner/acquisition/heartbeat/expiry fields, and blocked the affected nonterminal
run. It preserved the legitimate
single pending decision and non-pending history, then rejected a second pending
decision through `idx_guided_decisions_one_pending_per_run`. A schema-8
migration set refused the schema-9 database as an unknown higher version, which
records the application rollback boundary rather than treating downgrade as a
supported in-place operation.

This evidence used no deployment state and is not a service-artifact or
production migration rehearsal. Full provenance, hashes, safety construction,
and non-claims are in
[`schema-9-guided-decision-rehearsal.md`](schema-9-guided-decision-rehearsal.md).

### Physical Obsidian bridge acceptance — 2026-07-15

The opt-in acceptance command was run against a disposable, freshly created
workspace beneath `/tmp`; it did not read deployment configuration or an
operator vault and removed the workspace after closing SQLite.

```text
CHILLSPWN_OBSIDIAN_SMOKE_CONFIRM=isolated-temporary-obsidian-bridge bun run test:acceptance:obsidian
```

The smoke exported 10 heterogeneous nodes and eight edges as 10 YAML/
`[[wikilink]]` notes, plus a canonical content-addressed attachment. It imported
an operator edit across versions 1/2, surfaced and explicitly merged a conflict
across versions 1/2/3, then forgot a node and verified retrieval changed from
one match to zero and its projection was removed. Cleanup passed. The focused
vault run reported 14 passing tests and the relevant type checks passed. This is
functional physical-filesystem acceptance for the isolated bridge; it is not a
50,000-note sync performance result or evidence about a production vault.

### Exact physical 50,000-note Obsidian profile — 2026-07-15

| Check | Command | Result |
| --- | --- | --- |
| First-time exact bridge export and reconciliation | `CHILLSPWN_OBSIDIAN_SCALE_CONFIRM=isolated-temporary-obsidian-scale-50000 bun run test:acceptance:obsidian-scale` | passed: the real `exportNodes` path projected 50,000 canonical Markdown/YAML notes in 41,019.51 ms and reconciled them in 2,452.93 ms. Native watch was available (`nativeWatchUnavailable=false`), emitted 14 raw events with 0 errors, and cleanup passed. Incremental operator edit, candidate import, conflict/merge, source-hash invariants, and cancellation also passed. |

The profile used an isolated temporary physical vault and did not read production
configuration. Native recursive watch started for the final run and processed
the bounded incremental fixture without errors. Therefore the 50,000-note
export/reconciliation and bounded native-watch gates pass, while a sustained
multi-hour watcher profile, production-vault rollback, native Obsidian
application rendering, and a
50,000-note portable ZIP remain unclaimed. Full measurements and provenance are
in [`obsidian-scale-acceptance.md`](obsidian-scale-acceptance.md).

### Security and publishability scans — 2026-07-15

| Check | Result |
| --- | --- |
| Gitleaks worktree and Git history | 0 findings |
| TruffleHog verified-only filesystem and Git history | 0 verified secrets |
| Bun audit in the ChillsPwn webapp | 0 advisories in production-only and all-dependency scopes |
| Offline static fallback | 361 tracked application files reviewed; 84 heuristics (82 SQL and two escaped `dangerouslySetInnerHTML` sites), with no actionable sink in representative triage and 0 `eval`, dynamic-shell, `shell:true`, or TLS-disable sites. Semgrep exit 1 reflected heuristic/error mode, one parser warning, and unavailable offline registry rules; it is not a clean Semgrep claim. |
| Patch and staged-patch whitespace | \`git diff --check\` and \`git diff --cached --check\` passed |
| Publishable large-file review | no file exceeded 100 MiB |
| Sensitive-filename inventory | no actual environment, auth, private-key, or certificate files selected for publication |
| Semgrep review | 7 reported patterns reviewed; all were false positives or intentional bounded paths, with no unresolved release blocker |
| ChillsPwn webapp production dependency audit | clean in the webapp package scope |
| Retained Hermes dependency alerts | 121 open GitHub Dependabot alerts: 3 critical, 30 high, 58 moderate, 30 low |

The Semgrep run also reported parser/timeout limitations against the legacy
compatibility shell. The Hermes alerts are distributed across retained Python,
website, web, TUI, and WhatsApp lockfiles and are not findings in the deployed
ChillsPwn webapp package. They still prevent a repository-wide clean-dependency
claim and require separate, tested remediation. TruffleHog's unverified
candidates were confined to documentation, fixtures, and redaction tests; no
verified secret was found. The root ignore policy also prevents future
\`**/credentials.json\` files from being selected. No secret values were written
to this report.

### Focused regressions added after the audit baseline — 2026-07-15

| Area | Result |
| --- | --- |
| Confirmed Guided presentation preferences | 8 focused Guided Commander tests passed; only confirmed Context Pack preferences affect depth, terminology, pace, and evidence presentation. |
| Runtime cancellation cleanup | 11 focused Mission Runtime Engine tests passed; cancelling a waiting Guided run closes nonterminal decisions, approvals, assignments, steps, actions, tool calls, and plans. |
| Completion Review and scoped export | The latest focused Completion Review/operations slice passed 20/20 with 160 expectations, and its populated mutation browser case passed 1/1. Exact-run finding/lesson/memory-candidate review, measured budget telemetry, and capped-page partial truth are covered; exports remain terminal-only, scope-checked, metadata-only, redacted, bounded, hashed, and audited. |
| Proxy/API logging hardening | 11 focused proxy tests with 39 expectations passed; logs retain metadata/hashes rather than raw provider content and enforce bounded secure writes. |
| Guided exact-decision terminal semantics | 40 focused tests passed for exact complete, manual, skip, and stop behavior without parameter drift or unintended dispatch. |
| Reusable-memory secret denial and canonical vault attachments | Focused memory/vault suites passed; secret-like reusable content fails closed and attachment references must pass the canonical mission-artifact lifecycle. |
| Event-stream control-byte hardening | 11 focused event tests passed; summaries reject literal control bytes while preserving replay and delivery behavior. |
| Legacy migration batching | 7 migration tests passed, including a 2,105-line dashboard log, transactional batching, resume, and idempotency. |
| Release staging | Shell syntax and the staging acceptance harness passed; the final immutable release verified 11,144 files totaling 243,729,599 bytes. |
| WhatsApp media path boundary | 15/15 bridge tests passed for canonical-root containment, symlink/regular-file validation, and generic failure reporting. |
| Grok plan schema/SOUL boundary | Focused provider regressions plus the promoted live smoke passed; the final provider response validated without invoking repair fallback. |
| Database health cache | Focused regression proves repeated health reads reuse the bounded integrity result while an explicit refresh performs a new SQLite integrity check. |
| Canonical mission comparison metrics | 8 learning/comparison tests passed with 101 assertions. Terminal evaluations now measure time to first verified evidence, no-progress actions, recovery success, intervention count, tool success, memory precision, and preference correction. |
| Representative mission benchmark | `bun run performance:missions` passed two explicitly synthetic isolated fixtures: Autonomous had 16 favorable/0 unfavorable directions and Guided had 14 favorable/0 unfavorable directions. This is a regression gate, not a claim of live improvement. |
| Event reconnect burst | 12 focused event tests passed with 229 assertions. Sixty-four concurrent reconnects replayed different cursors through 500 events without gaps/duplicates and released every subscription; packet-loss and multi-hour heap testing remain separate. |
| Autonomous live tool and recovery boundary | Focused runtime, adapter, MCP bridge, route, and orchestration tests prove both signed action fields, destructive policy, signed specialist, current-policy dispatch, and current-policy restart/retry checks. Approval-required or denied Autonomous tools fail before MCP/tool/evidence side effects. |
| Exact Guided MCP approval | `bun test server/app/__tests__/CommandOsRuntimeAdapters.test.ts server/mcp/__tests__/CommandOsGuidedApproval.test.ts` passed 12/12 with 118 expectations. The canonical claim binds exact run/step/action/specialist/server/tool/arguments/actor/expiry and is consumed once. |
| Durable Guided provider idempotency | Guided Commander integration includes two independent service instances and WAL connections, owner fencing, lease heartbeat, expired-owner takeover, conflicting-key rejection, and winner replay with one provider/context/turn/event/exchange side-effect set. |
| Context Pack persistence linkage | `bun test server/memory/__tests__/second-brain.test.ts` passed 23/23 with 188 expectations. Missing and cross-scope mission/run/plan-step/action/message links and journey mismatch fail without partial writes; a valid unlinked global pack remains supported. |
| Canonical memory/Context Pack/graph isolation hardening | The focused memory-router, canonical-memory, and Obsidian-vault slice passed 33/33 with 247 expectations, and server TypeScript passed. Node create/correct/candidate operations validate mission-to-engagement ownership, retrieval rejects conflicting malformed/import rows, Context Pack scope-policy/exact-node/version/lifecycle/sensitivity/journey mismatches fail with zero partial writes, canonical mission ownership supplies omitted engagement labels, and cross-engagement or mismatched mission/engagement edges fail closed. |
| Explicit lesson-use consent | `bun test server/operations/__tests__/FollowUpRunRouter.test.ts` passed 4/4. Verified lessons missing the exact `allowAutonomous`/`allowGuided` retention flag are ineligible rather than implicitly allowed. |
| Autonomous branch/amendment | The latest branch/route/Decisions slice passed 16/16 with 139 expectations. An active source must stop first; unchanged authority or a readiness-checked successor contract creates one separate idempotent run and preserves immutable lineage. Populated browser acceptance remains open. |
| Canonical Decisions inbox | The same focused slice proves scoped/redacted cursor records for exact Guided decisions, Autonomous contracts, Autonomous safe-stop/exception events, and administrative approvals. Administrative review cannot mutate or unblock an active Autonomous run. |
| In-app notifications | Repository/client tests passed 9/9 with 94 expectations and focused browser acceptance passed 2/2. Semantic event projection, actor-scoped receipts, cursor paging, live invalidation, focus restoration, and in-app-only disclosure are covered; no external channel is claimed. |
| Second Brain idempotency and portable archive delivery | The memory/vault suites passed 60/60 with 495 expectations. Replays reauthorize current actor/access, and portable archive replay/download revalidates owner, normalized access, exact live nodes, connection, byte size, and SHA-256 before an inert same-origin ZIP response. |

### Canonical migration dry run — 2026-07-15

The real legacy paths were inventoried with a read-only dry run. The report is
stored outside the repository at:

```text
/var/backups/chillspwn/command-os-v2-migration/dry_run_2c98e30e-6db1-4265-a0a8-471ee462cf65/reconciliation.json
```

| Measurement | Result |
| --- | ---: |
| Selected sources | 5,964 |
| Selected bytes | 1,761,333,769 |
| Excluded entries | 3,301 |
| Canonical rows written | 0 |
| Canonical database created | no |

Selected types were 3,782 session JSON files, 2,090 raw LLM JSONL files, 77 run
documents, seven dashboard logs, three artifacts, one runtime event stream, one
memory file, one lesson file, and the two legacy SQLite stores. Of the excluded
entries, 3,286 matched the sensitive/generated/backup filename deny rules, 13
were symlinks, and two disappeared during discovery.

The disappearing sources are an expected warning on an active system and prove
that the real migration must run with every writer quiesced. This was not a
migration pass or cutover rehearsal: dry run deliberately created no protected
source backup and imported no records. It is retained as historical Phase 0
evidence. The accepted backup-first migration is recorded below.

### Canonical migration, reconciliation, and restore acceptance — 2026-07-15

Migration `migration_9155ae41-1b22-4a91-8e13-0ed9efdd6742` imported into
`/var/lib/chillspwn/command-os-v2.sqlite` after writers were quiesced.

| Measurement | Accepted result |
| --- | ---: |
| Selected and checksum-verified sources | 5,964 / 5,964 |
| Verified protected source-backup bytes | 1,756,365,229 |
| Cumulative imported items | 3,888,159 |
| Cumulative skipped items | 16,351 |
| Cumulative quarantined items | 11 |
| Final schema | 7 |
| SQLite quick-check | passed |
| Foreign-key violations | 0 |

The 11 quarantined records comprise four invalid Kanban tasks and seven
malformed JSONL records; no content is reproduced here. The final resumed pass
itself imported 990,669 items, deduplicated 2,913,852, and added no quarantine
or skip. Reconciliation reports are pass-scoped, so the protected cumulative
acceptance summary is the authoritative cross-pass count source. All copied
source checksums validated, stored/on-disk report hashes matched, and the
recorded database-backup hash matched.

The non-production restore rehearsal restored the exact pre-import image,
verified its schema-5 migration checksums, migrated a copy forward through all
seven migrations, and passed full/quick integrity and foreign-key checks. Raw
reports, source manifests, backups, and user data remain outside the repository.

### Performance and accessibility slices — 2026-07-15

Measured browser, bundle, database, event, memory, graph, and structural
accessibility results are recorded in [`performance.md`](performance.md) and
[`accessibility.md`](accessibility.md). Those reports explicitly list the
unmeasured performance targets and manual accessibility work; they are not a
claim of complete WCAG or production-performance acceptance.

### Visual evidence — 2026-07-15

The repository contains the original
[`before-command-center.png`](screenshots/before-command-center.png) plus seven
after captures: desktop Overview, Autonomous contract, Guided creation, Guided
workspace, populated Second Brain graph, accessible Second Brain list, and
mobile Overview. The graph captures use the real populated canonical E2E
fixture rather than decorative graph data. These images are review evidence;
automated pixel-diff regression remains a separate follow-up.

### Documentation path validation — 2026-07-15

A read-only link check walked the changed and untracked documentation selected
for this candidate and reported:

```text
validated 34 Markdown documents and 71 relative links: 0 missing
```

External URLs and absolute operational paths were deliberately excluded from
that filesystem check. A separate whole-repository baseline found eight
pre-existing missing relative links outside this candidate's changed/untracked
documentation set; those are not represented as newly introduced failures.

## Focused automated coverage present in the candidate

The following focused suites are direct evidence sources for the implementation
and are included in the final 1,114-test aggregate unless separately listed as
Python, browser, or opt-in acceptance checks above.

| Domain | Direct coverage |
| --- | --- |
| Database | ordered/checksummed migrations, WAL health, canonical tables, invariants, immutability, FTS5, online backup |
| Events | atomic event/outbox write, monotonic sequence, replay, global resume, backpressure, delivery retry, heartbeat, redaction, gap API |
| Journeys/runtime | Autonomous no-wait, exact Guided decision, out-of-contract safe stop, versioned Autonomous branch/amendment, manual result, evidence validation, recovery, cancellation evaluation |
| Supervisor | state machine, fingerprints, progress, loops/cycles, retry taxonomy/backoff, budgets, circuit breakers, leases, recovery decisions |
| Restart/cancel | safe-idempotent recovery classification, persisted supervisor snapshots, child cancellation, lease cleanup |
| Intelligence/learning | immutable evidence, finding evidence gate, reviewer self-approval denial, run evaluation, failed-attempt and safe attack-chain lessons |
| Second Brain | validation, hybrid retrieval, engagement isolation, consent, context packs, correction, forgetting/suppression, Memory Control policy |
| Obsidian | YAML/wikilink round-trip, sandboxing, conflict detection, malformed-note quarantine, forgotten projection removal |
| Decisions/notifications | canonical Guided/Autonomous/administrative inbox records, in-app semantic projection, actor-scoped read receipts, cursor paging, redacted deep links, accessible focus behavior |
| UI contracts | strict V2 schemas, no third journey, Guided semantic rendering, Completion Review mutation/page truth, safe links, graph utilities, event fallback policy |

Representative files:

- `server/command-runtime/__tests__/MissionRuntimeEngine.test.ts`
- `server/orchestration/__tests__/DurableRunCoordinator.test.ts`
- `server/supervisor/__tests__/`
- `server/events/__tests__/`
- `server/memory/__tests__/`
- `server/vault/__tests__/obsidian-vault.test.ts`
- `server/migration/__tests__/LegacyMigrationService.test.ts`
- `server/learning/__tests__/`
- `server/operations/__tests__/OperationsRouter.test.ts`
- `tests/e2e/`

## Acceptance tests still missing

Before completion, add or record tests for:

- populated browser acceptance for the implemented versioned Autonomous
  journey-amendment/new-run flow, including pause/cancel, unchanged-contract and
  successor-contract paths; focused tests already prove an active signed run
  cannot be mutated in place;
- a completed comparable follow-up that actually cites and visibly reuses one
  selected verified lesson, plus the lesson-review decision;
- confirmed preference correction and forgetting changing later provider
  wording or plan selection, beyond the tested retrieval removal;
- the remaining populated decision, recovery, graph, and mission paths on
  mobile and keyboard, plus stable screenshot regression;
- sustained multi-hour physical-vault watcher behavior; the exact 50,000-note
  initial bridge export and bounded native-watch fixture now pass and are recorded in
  [`obsidian-scale-acceptance.md`](obsidian-scale-acceptance.md);
- physical Android-device behavior, live-provider memory adaptation, and a
  production-vault rollback rehearsal;
