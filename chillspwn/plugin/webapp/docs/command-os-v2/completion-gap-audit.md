# Command OS V2.1 completion gap audit

Date: 2026-07-15

Candidate branch: `feat/command-os-v2`

Audited base commit: `343f6ac5a05f7286a0d66aee8c5dbd6e78a41aee` plus the uncommitted V2.1 worktree

Scope: repository implementation, automated tests, documentation, local migration evidence, and the installed `chillspwn.service` deployment boundary

This document began as the Phase 0 completion-gap audit. Phase 0 host and
migration observations are retained as historical snapshots where they explain
risk; the current evidence updates below supersede stale test counts,
screenshot status, Second Brain acceptance, security-scan status, migration,
and promoted-service observations.

## Executive decision

**The hardened candidate is promoted, operational, and rollback-rehearsed, but the complete V2.1 product definition of done remains partial.**

That statement describes the currently promoted schema-7 release. The present
unpromoted worktree adds migration 8 for immutable follow-up Context selection
and branch/snapshot state. It must not be promoted directly while
`plugin.previous` knows only schema 7: the migration runner correctly rejects
unknown higher schemas. The earlier schema-8 bridge was built against an older
migration-008 checksum and is now **superseded and unusable**. A fresh immutable
bridge was built from the exact live schema-7 release plus the final 008 and
passed the full isolated schema 7 → bridge → schema-9 candidate,
restart/rollback, integrity, and production non-interference rehearsal against
the final measured source identity. It is not promoted; any different release
identity must repeat the gate before an approved maintenance-window bake. See
`rollback.md`.

The repository now has a real routed Command Center, exactly two public
journeys, a canonical WAL SQLite model, durable events, a supervised mission
runtime, exact Guided decisions, MCP specialist execution, evidence-gated
learning, a user-controlled memory graph, and an Obsidian-compatible bridge.
Those are implemented modules rather than mock dashboard data. The current
unpromoted worktree additionally closes the previously identified Autonomous
action-class/specialist/destructive/tool-policy bypass and makes Guided
approval and provider-side idempotency durable across process boundaries.

Current release disposition and residual work:

1. The immutable release is promoted and healthy, its live Grok OAuth Guided and Autonomous smoke passed, and an exact application rollback to the retained healthy release and return to the final candidate passed.
2. The backup-first canonical import, checksum reconciliation, controlled cutover, and non-production database restore rehearsal passed. The protected raw reports remain outside the repository.
3. The current unpromoted source candidate passed an isolated service-user Grok
   OAuth SIGKILL/restart gate: Guided created one exact decision and cancelled
   cleanly; Autonomous resumed from one durable recovery checkpoint and
   completed exactly one action/tool call without a user-wait state or ghosts.
   Production was not restarted or changed. Populated browser acceptance now
   covers the complete Guided manual-result loop and bounded recovery/loop truth
   in both journeys. Later live-provider behavior after memory
   correction/forgetting remains unproved.
4. A real terminal Completion Review, scoped metadata-only export, canonical
   comparable-run record, immutable same-contract follow-up creation, selective
   verified-lesson eligibility, representative synthetic mission regression
   suite, complete Mission Workspace tabs, server-backed mission search/cursor
   paging, browser-saved views, compact board mode, checked API contract,
   Android packaging, and worker-based graph layout now exist. Exact candidate
   memory preview, plan/action/report Context Pack disclosures, broad graph
   controls, and a passing 50,000-node browser profile are implemented. The
   explicit Autonomous branch/amendment flow is also implemented with immutable
   contract lineage and focused service/API evidence. Its populated browser
   journey and the remaining manual mobile/screenshot acceptance remain open.
5. Secret scans and publishable-file review are complete with no unresolved secret finding. The live least-privilege identity, sensitive-file modes, security headers, and migration backup boundary were verified. The ChillsPwn webapp dependency audit is clean, but the retained Hermes snapshot has 119 open Dependabot alerts that require separate triage and prevent a repository-wide clean-dependency claim.

## Candidate gates closed since the initial audit

- The currently promoted schema-7 candidate was accepted with 868 Bun tests,
  3,762 expectations across 120 files, 34/34 Python authorization checks, 17/17
  packaged board MCP checks, all three TypeScript gates, a 171-module
  server-entry bundle, a 97-module production build, bundle budgets, 19/19
  browser tests, and a clean ChillsPwn-webapp dependency audit.
- The final unpromoted worktree passed `bun run check`: 203 server modules,
  all server/client/E2E TypeScript gates, 1,114 Bun tests with 0 failures and
  6,194 expectations across 154 files, 34/34 authorization checks, 17/17 board
  integration checks, and a 105-module Vite build. Browser acceptance passed
  31/31 in 1.2 minutes; strict performance, 50,000-node Brain, 100,000-event
  Observability, native 50,000-note Obsidian, Android (93 tasks), snapshot,
  logo, dependency, secret, link, size, and whitespace gates also passed.
- The current worktree requires both Autonomous action fields, exact signed
  target/specialist, and explicit destructive authorization at plan admission;
  rechecks live specialist/tool policy before MCP dispatch; and repeats the
  full current-policy check before retry/resume. Approval-required or denied
  Autonomous tools cannot execute using historical authority.
- Approval-gated Guided MCP calls now require an exact, expiring, argument-bound,
  durable one-time attestation. Guided provider mutations use a database lease
  and owner fence before any provider/Context Pack/evidence/message side effect,
  and two-process integration proves one winning execution.
- Context Pack persistence now validates mission/run/plan-step/action/message,
  scope-policy, and journey linkage transactionally. Follow-up lesson selection
  now denies a missing `allowAutonomous`/`allowGuided` flag instead of treating
  absence as consent.
- Autonomous Settings now exposes one explicit branch surface: an active source
  must first pause at a durable checkpoint or cancel, while a safely paused or
  terminal source may create a separate run under the unchanged signed contract
  or a fully readiness-checked successor contract. Focused service and HTTP tests prove the
  source run is not mutated in place, immutable contract lineage is retained,
  stale reviews fail, and mutation replay creates only one run.
- The Decisions inbox now reads canonical exact Guided decisions, Autonomous
  contract versions, Autonomous safe-stop/exception events, and administrative
  approvals. Scope/sensitivity filtering, redaction, cursor paging, and the rule
  that an administrative approval cannot unblock a running Autonomous mission
  pass focused tests.
- A transactional semantic-event projection now drives an actor-scoped in-app
  notification center with cursor paging, unread counts, human-only idempotent
  read receipts, live invalidation, and accessible focus restoration. Focused
  browser acceptance passes; email, SMS, webhook, push, and other external
  delivery remain deliberately unimplemented.
- Completion Review now performs exact-run finding, lesson, and memory-candidate
  review mutations, renders measured budget limits/usage without upgrading
  unknown telemetry to exact, and labels capped artifact/finding pages as partial
  rather than claiming totals or an all-clear result.
- Second Brain mutation replay now reauthorizes the current actor and normalized
  access policy before returning a cached result. Portable Obsidian archives are
  owner/access/node bound and revalidate current node visibility, archive size,
  and SHA-256 before an inert same-origin download response.
- The promoted Grok OAuth smoke completed an authorized no-network Autonomous specialist action through `ReconScout` and `local-selftest.quick_scan`, producing verified evidence/evaluation; Guided persisted an exact decision and remained planning-only. The final smoke required no repair fallback.
- The current unpromoted source was synced to
  `/opt/chillspwn-command-os-live-gate-20260715T200938Z/webapp` and passed a
  separate unprivileged `chillspwn` gate on `127.0.0.1:43132`. It used the
  service-owned opaque Grok OAuth path with no API key, `grok-4.5` with
  reasoning effort `high`, and the root-owned hash-pinned no-network asset only
  through `sechub-reconnaissance.quick_scan`. Guided produced one exact decision
  then cancelled cleanly. After SIGKILL, Autonomous recovered from one
  checkpoint and followed `planning` → `running` → `completed` with exactly one
  action/tool call, one verified evidence record, one evaluation, no
  post-launch user-wait state, and no ghost-active work. The focused 88-test
  source slice, server TypeScript, and server-entry graph passed first.
- That isolated gate did not deploy or promote the source. Production remained
  PID `1425345`, `NRestarts=0`, HTTP 200, with the same
  `/opt/chillspwn/plugin` release symlink.
- Migration `migration_9155ae41-1b22-4a91-8e13-0ed9efdd6742` reconciled all 5,964 selected sources, verified every copied-source checksum, passed SQLite integrity/foreign-key checks, and passed an exact non-production restore-and-forward-migration rehearsal.
- Immutable release `/opt/chillspwn/releases/20260715T132305Z-candidate/plugin` is current. Both services are active with zero restarts; the processes use only the `chillspwn` uid/gid, `NoNewPrivileges`, and an empty capability bounding set. Promoted health and security-header checks pass and the logo hash remains unchanged.
- Production SSE connects and database health reports integrity `[ok]`, WAL,
  foreign keys enabled, migration 7, and zero pending outbox rows. Overview
  readiness is 93/degraded only because no mission engagement/scope is selected
  and four of 19 optional MCP servers are runnable; provider enforcement,
  12-specialist fleet, exact-step/no-hands, event, database, memory, and legacy
  gate checks pass, with zero active or attention-required operations. This is a
  pre-mission readiness state, not an outage.
- The exact application rollback activated `20260715T130435Z-candidate`, observed it healthy at 13:32:25Z, returned to `20260715T132305Z-candidate`, and observed the final service healthy at 13:32:43Z with zero restarts. The previous release remains `plugin.previous`.
- The historical immutable schema-8 bridge rehearsal passed against the
  historical migration-008 checksum, while production remained healthy on
  schema 7 with unchanged symlinks and zero restarts. Migration 008 now includes
  additional branch/snapshot tables, so that artifact is superseded and must not
  be run. Its replacement current-checksum bridge and complete isolated
  schema-7→8→9 rehearsal passed with backup/rollback, idempotent restart,
  compatibility refusal, integrity, and unchanged-production evidence; see
  `schema-7-to-9-release-rehearsal.md`. Promotion remains an explicit operator
  decision, and any changed artifact identity must repeat the rehearsal.
- Confirmed Context Pack presentation preferences now alter Guided prompt depth, terminology, pace, and evidence presentation through an explicit, focused, fail-closed adapter path.
- Runtime cancellation now transactionally closes nonterminal plans, steps, assignments, actions, tool calls, decisions, and approvals; focused cancellation tests cover the stale-assignment defect.
- Terminal runs render a real Completion Review from canonical evidence, findings, artifacts, evaluations, events, lesson usage, and Context Packs, with a terminal-only, scope-checked, redacted, bounded, hashed, audited metadata export.
- Global CSP/frame/referrer/content-type/permissions headers and external boot assets are implemented, and provider/API logging is bounded and metadata/hash based rather than raw-content based.
- Five populated canonical browser cases now prove Completion Review and report Context Packs, visible out-of-contract safe stop/checkpoint behavior, exact Guided parameter mismatch denial, a real eight-node/five-edge graph, versioned correction, and forgetting removal from retrieval and graph state.
- An earlier eight-case populated checkpoint proved the complete Guided
  explain/observe/interpret/record/advance loop across a reload, bounded
  transient and repeated-action recovery truth in both journeys, and immutable
  same-contract follow-up creation with explicit verified-lesson eligibility.
  The recorded interim populated aggregate contained nine cases; newer focused
  notification browser evidence is listed separately and no newer aggregate
  count is claimed. Selection is still not reported as lesson reuse unless a
  later planner actually cites the lesson.
- The current populated browser suite adds inspected Autonomous provider/team/
  memory preflight, canonical mission search, cursor-compatible filtering,
  browser-persisted saved views, compact board mode, and the durable Mission
  Workspace surfaces. The separate real 50,000-node browser profile stayed
  bounded at 295 DOM elements/one canvas and met every API and interaction
  budget with no browser error.
- The isolated physical Obsidian smoke now proves real filesystem projection, canonical attachments, operator-edit import, visible conflict/merge, and synchronized forgetting without touching deployment state.
- Gitleaks and TruffleHog verified scans reported zero secret findings across the worktree/filesystem and Git history; Semgrep findings were reviewed with no unresolved release blocker, subject to documented parser/timeout limitations in the legacy shell.

## Status vocabulary

- **Implemented + tested** — direct code and focused automated evidence exist.
- **Implemented, acceptance unverified** — the capability exists, but the required cross-process, browser, live-provider, or deployment proof does not.
- **Partial** — meaningful implementation exists, but specified behavior or controls are absent.
- **Missing** — no production implementation or credible acceptance evidence was found.

## P0 release-blocker disposition

### P0.1 — Promoted service and application rollback accepted

The initial read-only Phase 0 host inspection on 2026-07-15 showed:

- `chillspwn.service` is active;
- `WorkingDirectory=/root/.claude/plugins/chillspwn/webapp`;
- the V2.1 candidate is under `/root/chillspwn-hermes-recovery/chillspwn/plugin/webapp`;
- only `screenshots/before-command-center.png` is committed under the V2.1 evidence directory.

Those process/path observations are historical. The current symlink resolves to
`/opt/chillspwn/releases/20260715T132305Z-candidate/plugin`; the previous healthy
release is retained at `20260715T130435Z-candidate`. Both production services
are active with zero restarts. Readiness, HTTP health, secure headers, service
identity, Guided planning, Autonomous specialist execution, evidence/evaluation,
and cleanup all passed. The exact rollback rehearsal activated the retained
healthy release and observed it healthy at 13:32:25Z, then returned to the final
candidate and observed it healthy at 13:32:43Z. The final service remained
active with zero restarts and the previous release remains `plugin.previous`.

That accepted production rollback predates schema 8. Production is
intentionally unchanged on schema 7. The prior compatibility package and
rehearsal matched an earlier migration-008 checksum; the current migration now
also contains branch/snapshot tables, so the old bridge is unusable and must not
be promoted. The release gate is to build a fresh bridge from the exact live
schema-7 release plus final migration 008, prove schema 7 → 8 exactly once,
idempotent bridge/candidate restarts, preserved canonical state, application
rollback boundaries, and zero residual listeners, then promote/bake that newly
identified artifact in an approved maintenance window.

### P0.2 — Canonical migration and database restore accepted

The historical dry run remains useful evidence, but it has been superseded by
the accepted backup-first migration
`migration_9155ae41-1b22-4a91-8e13-0ed9efdd6742` into
`/var/lib/chillspwn/command-os-v2.sqlite`. All 5,964 selected sources were copied
and checksum-verified (1,756,365,229 bytes). The cumulative acceptance summary
records 3,888,159 imported items, 16,351 skipped items, and 11 quarantined
malformed/invalid records; no source original was changed or deleted. Schema 7
passes quick-check with zero foreign-key violations. Stored and on-disk report
and database-backup hashes match. A protected non-production rehearsal restored
the exact pre-import database image, validated its migration checksums, migrated
the copy forward to schema 7, and passed full/quick integrity and foreign-key
checks. Canonical reconciliation is pass-scoped on resume; the protected
cumulative acceptance summary is the cross-pass count source.

### P0.3 — The mandatory end-to-end acceptance suite is incomplete

The accepted 19-test browser suite includes 14 foundation cases proving the two journey entry points in Overview and
the Command Palette, fail-closed Autonomous readiness, compatibility routing,
bounded real palette search and focus restoration, an empty Brain, bounded SSE
fallback/recovery, structural accessibility, reduced motion, local paint/CLS,
and mobile shell behavior. Five populated canonical cases additionally prove a
completed Autonomous review/report with Context Pack, visible out-of-contract
safe stop and durable checkpoint, exact Guided parameter mismatch rejection,
and versioned memory correction/forgetting removal from retrieval and graph
state. Separately, the historical promoted live Grok OAuth smoke proved exact
Guided decision creation and an Autonomous no-network specialist completion
with verified evidence/evaluation. The current unpromoted source then passed a
stronger isolated service-user Grok OAuth gate: exact Guided decision and clean
cancellation, followed by an Autonomous SIGKILL/restart, one-checkpoint resume,
and completion with one verified action/tool result and no user-wait state or
ghost work. Production remained unchanged.

The final browser suite is 31-for-31. In addition to the accepted 19-test set, it
proves inspected Autonomous provider/team/memory preflight, canonical mission
search and browser-persisted board views, the complete Guided manual-result loop
and durable reload, bounded transient and repeated-action recovery truth for
Autonomous and Guided, and Completion Review creation of an immutable
same-contract follow-up with explicit verified-lesson eligibility. Focused
repository/integration tests also prove exact selected-lesson planning context
and create lesson usage only when the planner actually cites that lesson.

A separate opt-in browser profile used the real canonical schema with 50,000
nodes and 49,999 edges. It proved bounded 250 → 500 progressive rendering,
off-segment FTS search, a five-node local neighborhood, pan/zoom/focus, and the
accessible table within the documented budgets and without browser errors.

The opt-in disposable physical Obsidian smoke also proves export, operator edit,
conflict, explicit merge, canonical attachment, and synchronized forgetting on
a real filesystem without reading deployment configuration.

It does not yet prove the required populated browser/deployment journeys:

- populated browser exercise of the implemented pause/cancel plus unchanged-
  contract and versioned-amendment new-run paths for a signed Autonomous mission;
- completed comparable follow-up execution that visibly reuses a selected lesson, plus the lesson-review decision;
- correction/forgetting changing a later live-provider response or plan;
- sustained native-inotify physical-vault watcher behavior under a healthy host
  quota and production-vault behavior;
- the remaining populated decisions and core flows on mobile and keyboard, plus
  stable screenshot regression.

Unit and in-process integration tests are valuable but do not substitute for these acceptance journeys.

## P1 product and architecture gaps

### Autonomous contract and readiness

`src/features/missions/AutonomousContractPage.tsx` implements the complete
six-step composer: authorization and targets; action/destructive policy;
time/token/cost/retry/replan/concurrency and evidence/artifact storage budgets;
safe-stop conditions and deliverables; inspected enforcing provider/MCP paths;
an adjustable exact compatible-specialist allowlist; exact eligible confirmed
preference/verified-lesson preview with per-node inclusion; supported
notification/reporting/retention/provider/tool policy summaries; and the issued
contract version and SHA-256 before launch. Unsupported external notifications,
arbitrary providers, report formats, and unenforceable retention promises are
deliberately unavailable instead of being stored as decorative contract text.

The explicit material-change flow now exists. Settings offers audited pause and
cancel controls when the selected source is active, refuses to branch until the
source is safe, and then creates one separate Autonomous run either under the
unchanged version/hash or under a new draft that passes full live readiness and
is deliberately confirmed. The prior contract and source-run binding remain in
immutable lineage; no running contract is edited in place. Service and HTTP
integration tests pass. A populated browser journey through both branch modes is
still required before treating this unpromoted slice as release acceptance.

### Mission portfolio and command surfaces

- `MissionPortfolioPage.tsx` now uses canonical server search, journey/status
  filters, opaque cursor pagination, a table, a compact attention/active/finished
  board, shareable URL state, and bounded browser-owned saved views. Remaining
  portfolio work is the broader engagement/target/agent/provider/date/risk/
  evidence filter set and authorized bulk archive/export. Saved views are local
  to the browser rather than a synchronized server resource.
- The durable Mission Workspace now implements Summary, Plan,
  journey-specific Live/Guide, Evidence, Findings, Conversation, Brain,
  Learning, History, and Settings tabs. The tabs are URL-addressable and map a
  copied Live/Guide URL back to the mission's actual journey rather than
  exposing a hidden mode. Final populated keyboard/mobile acceptance remains.
- The material journey-amendment/new-run workflow is implemented in the Settings
  tab and intentionally cannot mutate a signed active Autonomous contract. Its
  remaining gap is populated browser acceptance, not the execution boundary.
- The decision inbox now exposes first-class canonical exact Guided decisions,
  Autonomous contracts, Autonomous safe stops/post-run exceptions, and
  administrative approvals. Administrative review is future-policy-only and
  cannot change runtime state or unblock an active Autonomous run. Broader
  multi-user role binding remains a deployment/security gap.

Terminal runs now expose a canonical Completion Review with success criteria,
evaluation, evidence coverage, findings, artifacts, measured time/token/cost
budgets, recovery/policy counts, verified lesson usage, Context Pack inspection,
and unresolved work. It performs exact-run finding, independently gated lesson,
and memory-candidate review mutations in place. Capped artifact and finding
pages are explicitly partial: visible counts carry a `+`, report totals remain
unknown, and no all-clear is inferred from an unconsumed cursor. Its export is
terminal-only, scope-checked, metadata-only, redacted, bounded to 1,000 records
per domain with truncation disclosure, SHA-256 hashed, and audit recorded.
Remaining completion gaps are broad live comparable-mission evidence, completed
follow-up lesson-reuse review, in-place loading of later cursor pages, and
authorized delivery of every underlying report/evidence artifact rather than
only supported verified artifacts and safe metadata bundles.

### Guided preference adaptation

The Guided Commander now receives a persisted Context Pack and derives an
explicit presentation profile only from confirmed preference nodes. Focused
tests prove adaptation of explanation depth, terminology, pace, and evidence
presentation while preserving policy boundaries. Remaining acceptance work is
to prove through a later real-provider/browser response that confirmation,
correction, and forgetting change behavior, and to extend the same transparent
preference application to every applicable report/tool choice without allowing
preferences to weaken authorization or safety.

### Recovery presentation

The coordinator and supervisor have strong focused tests for fingerprints,
progress, retry taxonomy, leases, budgets, circuit breakers, recovery, restart
decisions, and cancellation. The canonical Recovery Panel now shows detection
evidence, retained failed actions, retry/replan budget, durable checkpoint,
proposed recovery and time/cost/scope impact, failed-attempt memory, exact Guided
decision linkage, and backend-enforced control availability. Populated browser
fixtures prove transient and repeated-action outcomes for both journeys. The
remaining product gap is executable reassignment/change-provider recovery: the
panel truthfully exposes those paths as unavailable until corresponding bounded
backend commands exist, rather than presenting decorative controls.

### Second Brain graph and transparency

Implemented: canonical nodes/edges/provenance/lifecycle, hybrid retrieval,
Context Packs, corrections, forgetting/suppression, engagement isolation,
graph/table views, bounded progressive API loading, canvas pan/zoom/fit,
local/global/mission/operator and attack-path/lesson-failure presets, node and
edge filters, scope/engagement/lifecycle/sensitivity/confidence/date filters,
label density, compact/cluster layouts, named browser views, shareable URL
state, browser-persisted pinned positions, worker layout, and node inspection.

Still partial relative to the specification:

- the date range uses accessible date inputs rather than a graphical slider, and
  cluster-level collapse/expand, an explicit physics toggle, and arbitrary
  two-node shortest-path selection are not complete;
- named views and pinned positions are browser-owned rather than synchronized
  operator profile records;
- `Context used` is implemented for Guided responses, planning packs, semantic
  run/mission events, canonical action cards, Completion Review, and reports;
  final browser acceptance does not yet exercise every Autonomous action and
  report variant;
- a populated browser fixture now renders eight canonical nodes/five edges and proves correction/forgetting removal, and the physical disposable-vault lifecycle smoke passes;
- the populated 50,000-node browser profile passes with bounded progressive
  rendering and accessible-table fallback, and the exact physical 50,000-note
  first-time vault export/reconciliation profile now passes in isolation.

### Learning and measurable improvement

Run evaluations, evidence-gated candidates, author self-approval denial, failed-attempt lessons, safe parameterized attack-chain projection, lesson usage, review UI, and a scope-aware comparable-run selection/record exist. A repeatable, explicitly synthetic fixture suite now checks Autonomous bounded recovery and Guided exact-step/context correction across objective, evidence, time-to-evidence, no-progress, duplicate-action, retry, recovery, memory, tool, token, and cost metrics. It is a regression gate rather than live comparative evidence; the product therefore still cannot claim broad real-world improvement without comparable completed missions.

### Observability and operations

Canonical events, outbox, structured logs, health snapshots, replay/gap repair, cursor APIs, redaction, and semantic UI exist. Remaining operational gaps include:

- the dedicated trace master-detail view now correlates real scoped events,
  logs, actions, and tool calls into a semantic waterfall with expandable
  redacted detail; source queries are capped before merge and preserve opaque
  cursor pagination;
- an isolated 100,000-event canonical browser profile passes with 50-record
  event/trace pages, duplicate-free cursors, real structured-log FTS, semantic
  waterfall interaction, bounded payload/DOM size, and no browser error; exact
  measurements are recorded in `performance.md` and `test-evidence.md`;
- a 64-client local reconnect burst proves gap-free replay and complete subscriber cleanup, but network packet-loss and multi-hour memory-leak profiles remain untested;
- legacy domains still contain file/log writers, but their HTTP/WS mutations and
  background executors are default-off behind the explicit rollback gate;
- event-backed in-app notifications are implemented with actor/scope/sensitivity
  filtering, cursor paging, unread counts, durable actor-scoped receipts, and
  focused browser acceptance. No email, SMS, webhook, push, or external delivery
  and retry provider exists;
- no optional OTLP exporter; the checked V2 API catalog now documents the
  stable scoped trace summary/detail, event, log, and health surfaces;
- verified supported artifact delivery, exact-run evidence metadata export, and
  restricted run-audit export are implemented and audited. Broader report/
  evidence bundle delivery and a whole-system audit export are not complete V2
  APIs.

### API and maintainability

The V2 endpoints use typed client schemas, request IDs, idempotency on harmful
mutations, scoped repositories, and consistent errors in the mission runtime.
A checked OpenAPI 3.1 document is generated from the typed V2 catalog at
`/api/v2/openapi.json`; the event delivery/schema contract is exposed at
`/api/v2/contracts/events`, and scoped trace summary/detail contracts are
included. Remaining work:

- make error envelopes consistent across every V2 domain;
- remove retained legacy route implementations after reconciliation; the shared
  default-off mutation boundary and read/V2 passthrough are compatibility-tested;
- decompose the remaining 10,000-line `server/index.ts` compatibility shell further;
- complete physical-device acceptance and release signing. Android/Capacitor
  boundaries and limitations are documented in `platform-support.md`, and the
  final `mobile:build:android` completed Capacitor sync plus Gradle
  `assembleDebug` successfully.

## P1 security and privacy gaps

See `security.md` for the full review. Release-relevant findings are:

- the current unpromoted candidate closes the Autonomous plan/dispatch/recovery
  bypass by enforcing both signed action fields, destructive policy, exact
  specialist, live tool decision, and exact MCP binding; Guided approval is an
  expiring durable one-time claim rather than an upstream assertion;
- the live `chillspwn` account has only its own uid/gid, no sudo grant, `NoNewPrivileges`, and an empty capability bounding set;
- deployed sensitive state/log files and directories were normalized to the reviewed `0600`/`0700` boundary;
- the promoted service returns the required CSP, frame denial, no-referrer, no-sniff, permissions policy, and cross-origin opener policy;
- provider/API logging stores bounded metadata and hashes instead of raw payloads and uses secure no-follow/exclusive writes;
- canonical sensitive records are not application-encrypted at rest; host/disk encryption and backup encryption remain deployment responsibilities;
- the current single-operator V2 actor is hard-coded as `operator:local`/admin after host authentication, not a multi-role authorization implementation;
- `bun audit --production` is clean for `chillspwn/plugin/webapp`; Gitleaks worktree/history and TruffleHog verified filesystem/history scans reported zero findings, and the seven Semgrep findings were reviewed as false positives or intentional bounded paths. GitHub separately reports 119 open Dependabot alerts in retained Hermes lockfiles (2 critical, 30 high, 57 medium, 30 low), so no repository-wide clean-dependency claim is made. Legacy-shell parser/timeout limitations remain documented, so this is not a claim of whole-program static proof.

## P2 evidence and documentation gaps

- A before screenshot and seven after screenshots are source-controlled, including desktop Overview, Autonomous contract, Guided creation/workspace, real populated Second Brain graph/list, and mobile Overview. Automated screenshot-diff regression remains outstanding.
- Manual NVDA/Firefox, VoiceOver/Safari, 200% zoom, contrast, populated-dialog focus order, physical mobile, and independent accessibility scans remain outstanding.
- INP, real mid-tier mobile, network packet-loss reconnect behavior,
  long-session heap and sustained multi-hour native-watcher behavior,
  quota, and a production-vault rollback remain outstanding. The real
  50,000-node canonical browser profile, 100,000-event rendered Observability
  profile, and exact physical 50,000-note first-export plus full checksum
  reconciliation profile pass in isolated environments. The physical profile
  includes a bounded native watcher run with 14 raw events and zero errors, but
  does not claim sustained watcher coverage.
- The explicit ADR set now records the canonical database, two-journey model,
  durable event/outbox, supervisor, and user-owned memory decisions. New
  irreversible changes must continue using that decision-record process.
- The root API documentation now distinguishes canonical `/api/v2` from the
  default-read-only unversioned compatibility surface, and the checked OpenAPI
  and event contracts are linked from the Command OS documentation index.
- The safe migration summary is recorded here and in `test-evidence.md`; raw reconciliation reports, source manifests, backups, and user data remain protected outside the repository.

## Definition-of-done traceability

| # | Acceptance statement | Status | Evidence and remaining proof |
| ---: | --- | --- | --- |
| 1 | Home is Command Center | Implemented + tested | `src/App.tsx`, `OverviewPage.tsx`, browser journey. |
| 2 | Two primary entry actions | Implemented + tested | Browser asserts `Go Autonomous` and `Start Guided Mission`. |
| 3 | No third public journey | Implemented + tested | V2 schemas accept only two journeys; the public `/legacy` route is removed and unversioned execution is default-off. |
| 4 | Mission creation hides provider modes | Implemented + tested | Both creation forms are journey/mission focused. |
| 5 | Autonomous completes without routine input | Implemented + tested (promoted historical and isolated current candidate) | Runtime tests, the historical promoted smoke, and the current isolated Grok OAuth/no-network completion through `ReconScout` pass. The current candidate observed `planning` → `running` → `completed` with no `waiting_guided_decision` after launch; populated browser provider proof remains. |
| 6 | Autonomous preflight fails closed | Implemented + tested | Browser and `RuntimeReadiness.test.ts`. |
| 7 | Out-of-contract Autonomous safe-stops | Implemented + tested | Runtime and populated browser proof show visible safe stop, immutable event, durable checkpoint, and no dispatch. Current focused tests additionally deny action-type/class, destructive, specialist, and live-tool-policy drift before side effects; the strengthened boundary is not yet promoted. |
| 8 | Guided starts with an explanation | Implemented + tested (promoted live) | Runtime/Commander tests and promoted Grok OAuth planning reached an exact decision while Commander remained planning-only; no populated real-provider browser journey. |
| 9 | Guided pauses and interprets every consequential step | Implemented + tested | The populated browser flow explains first, rejects altered parameters, interprets manual output without advancing, requires a deliberate acceptance, records evidence, and creates the next exact step. |
| 10 | Guided state is independent of transcript | Implemented + tested | Canonical mission/run/checkpoint storage plus a browser reload reconstructs the interpreted-result gate before the operator advances. |
| 11 | Visible state/owner/heartbeat/progress/next | Implemented, acceptance unverified | Live and run workspace projections; no populated browser assertion. |
| 12 | Semantic action plus raw detail | Implemented, acceptance unverified | Canonical action cards and semantic event timelines expose concise purpose/result/evidence/context with expandable redacted technical detail; exhaustive populated-browser coverage remains pending. |
| 13 | Guided decisions and Autonomous safe stops in one inbox | Implemented + tested | The canonical inbox unifies exact Guided decisions, Autonomous contracts, safe-stop/exception events, and administrative approvals with scoped/redacted cursor paging. Focused tests prove an administrative review never unblocks an active Autonomous run; exhaustive populated-browser coverage remains pending. |
| 14 | No primary eight-second polling | Implemented + tested | SSE, replay/gap repair, bounded 30-second degraded fallback. |
| 15 | Canonical state is SQLite | Partial | V2 domains are canonical; legacy production state and compatibility domains remain. |
| 16 | Idempotent migration and reconciliation | Partial | All 5,964 sources copied/checksummed, cumulative reconciliation accepted, schema-7 integrity clean, and exact restore/forward migration passed. The historical bridge remains superseded; its current-checksum replacement passed the complete isolated schema-7→8→9, idempotent restart, backup/rollback, and compatibility-boundary rehearsal. Canonical cutover remains pending. |
| 17 | Forced server restart resumes deterministically | Implemented + tested (isolated current candidate) | The unpromoted source candidate ran as `chillspwn`, survived SIGKILL, resumed from exactly one checkpoint, completed one action/tool call with one verified evidence record and evaluation, and left no ghosts. Production was unchanged. |
| 18 | Repeated no-progress action bounded | Implemented + tested | Supervisor and durable coordinator tests. |
| 19 | Budgets enforced | Implemented + tested | Budget/reliability/runtime tests plus Completion Review exact/estimated/unknown telemetry presentation; live cost/token provider accounting still needs acceptance proof. |
| 20 | Blocked run explains resolution | Implemented + tested | The canonical Recovery Panel exposes diagnosis, immutable evidence, checkpoint, attempts, bounded budgets, impact, avoidance memory, exact Guided decision or Autonomous safe stop, and honest backend control availability; populated browser fixtures cover transient and repeated-action outcomes in both journeys. |
| 21 | Cancellation leaves no ghost work | Implemented + tested | Runtime/coordinator/MCP tests assert nonterminal work is closed; the current isolated Guided run cancelled cleanly, and its subsequent Autonomous restart/resume left no ghost-active work. |
| 22 | Terminal run evaluation | Implemented + tested | `RunLearningService.test.ts` and runtime cancellation evaluation. |
| 23 | Lessons cannot self-approve | Implemented + tested | Operations review integration requires independently visible, same-context support and denies author self-review; Completion Review exposes only the server-supported candidate lifecycle. |
| 24 | Verified lessons selectively retrieved and visible | Implemented + tested | Follow-up selection is immutable and visible, requires an explicit journey-use retention flag, Autonomous planning retrieves only the exact eligible selection, and usage/event attribution occurs only after an actual planner citation. A completed comparable second-run benchmark remains tracked under item 25. |
| 25 | Measurable comparison to similar missions | Partial | Scope-aware canonical comparison records, Completion Review rendering, and a two-journey synthetic regression suite exist; broad live comparative evidence remains missing. |
| 26 | Real heterogeneous Second Brain graph | Implemented + tested | Real schema/API/UI, an eight-node/five-edge mission fixture, and a heterogeneous 50,000-node/49,999-edge canonical browser profile pass; no fake production graph path is used. Physical large-vault sync is tracked separately. |
| 27 | Node/edge provenance, scope, sensitivity, confidence, lifecycle | Implemented + tested | Database/memory/vault validation tests; canonical mission ownership supplies engagement scope, while cross-engagement and mismatched mission/engagement edges fail closed. |
| 28 | Memory influence visible from plan/action/explanation/report | Implemented, acceptance unverified | Planning packs, Guided responses, semantic events, canonical action cards, Completion Review, and reports expose persisted `Context used` disclosures and memory-path links. The populated browser proves report/Completion Review use; exhaustive Autonomous action/report variants remain pending. |
| 29 | Confirm/correct/scope/expire/export/forget | Implemented, acceptance unverified | Candidate confirmation, versioned correction/scope, expiry, per-node Obsidian export, and complete forgetting controls are real and backed by scoped APIs. Focused lifecycle/vault tests pass; exhaustive populated-browser and homogeneous bulk-review acceptance remains pending. |
| 30 | Forget removes retrieval and projections | Implemented + tested | Memory/vault tests, populated browser Context Pack/graph removal, and physical-vault synchronized forgetting pass. |
| 31 | Guided adapts to confirmed preferences | Implemented, acceptance unverified | Confirmed Context Pack preferences drive depth, terminology, pace, and evidence-presentation prompts in focused tests; browser retrieval correction/forgetting passes, while later live-provider wording/plan adaptation remains unproved. |
| 32 | Autonomous uses permitted confirmed memory/verified lessons only | Implemented + tested | Runtime adapter/retrieval tests. |
| 33 | No cross-engagement memory leak | Implemented + tested | The 33-test memory/router/vault slice validates canonical mission/engagement ownership at node create/correct/candidate time, rejects conflicting imported rows and graph edges, and transactionally rejects Context Pack policy/link/item mismatches with zero partial writes. |
| 34 | Preference candidates require consent | Implemented + tested | Candidate/control policy tests. |
| 35 | Obsidian export produces valid linked notes | Implemented + tested | Unit round-trip plus isolated physical-filesystem Markdown/YAML/wikilink and canonical-attachment smoke pass. |
| 36 | Two-way edits are versioned and conflicts visible | Implemented + tested | The isolated physical bridge smoke proves operator edit versioning, durable conflict detection, explicit merge, and synchronized forgetting; sustained/large-vault watcher acceptance remains. |
| 37 | 50,000-node graph remains usable | Implemented + tested | DB/API/worker benchmarks and the isolated real canonical browser profile pass: bounded 250→500 rendering, FTS search, local expansion, pan/zoom/focus, table fallback, 295 DOM elements, and no browser errors. The separate exact physical 50,000-note bridge export/reconciliation profile also passes. |
| 38 | Correlated/searchable observability and context use | Partial | Canonical trace/event/log/action/tool/health projections, semantic waterfall, redacted detail, cursor pagination, and an isolated real-schema 100,000-event browser profile pass; retained legacy records are not universally trace-complete and network/long-session soak remains. |
| 39 | Raw command spam is secondary | Implemented | V2 surfaces default to semantic records with expandable details. |
| 40 | WCAG 2.2 AA | Partial | Structural browser checks pass; manual and independent audit remains. |
| 41 | Performance budgets measured and substantially met | Implemented + tested locally | The final strict bundle/browser/DB/event/50,000-node Brain and 100,000-event Observability gates pass. INP, physical mobile, private-ingress, and long-run profiles remain manual/external gaps. |
| 42 | Intentional mobile experience | Implemented, acceptance unverified | Shell/route reflow tests and a focused populated Guided 390-by-844 check pass; the remaining populated core journeys are not fully accepted on mobile. |
| 43 | Logo hash unchanged | Implemented + tested | Hash remains `0a3dfd69...5f85c955`. |
| 44 | No fake production data | Implemented | Production pages query APIs; test fixtures use isolated paths. |
| 45 | Critical safety controls retained | Implemented + tested | Existing policy, provider, target, delegation, lesson, and runtime tests. |
| 46 | Build, types, unit, integration, E2E pass | Implemented + tested | The final unpromoted gate passes every TypeScript check, 1,114 Bun tests/6,194 expectations across 154 files, 34/34 authorization checks, 17/17 board checks, a 105-module build, 31/31 E2E, strict performance, both large browser profiles, native 50,000-note Obsidian, Android debug build, and package audits. |
| 47 | Before/after screenshots and performance evidence | Implemented + tested | One before and seven after screenshots are present, with local bundle/browser/runtime evidence and promoted loopback health timings. Automated visual diff and private-ingress Web Vitals remain follow-up work. |
| 48 | Database/memory/vault/app rollback documented and tested | Partial | Exact database restore/forward migration and deployed schema-7 application rollback/return pass; memory/vault lifecycle recovery passes. The old schema-8 bridge is unusable, while its current-checksum replacement passed isolated bridge/candidate restore-and-forward rehearsal. Promotion, a final committed-candidate repeat, and production-vault rollback rehearsal remain outstanding. |

## Ordered closure plan

1. Complete the remaining manual physical-mobile, keyboard/screen-reader,
   screenshot-diff, private-ingress Web Vitals, and long-session soak work.
2. Promote and bake only the exact rehearsed bridge during an approved
   maintenance window; repeat the rehearsal if the selected source/build
   identity changes. Do not use the superseded
   bridge; direct schema-7 application rollback on a schema-8 database remains
   intentionally fail-closed.
3. Add the remaining populated acceptance for completed comparable follow-up lesson reuse/review and later-provider memory adaptation; Guided manual-result persistence, recovery/loop handling, Autonomous safe stop, process restart/resume, retrieval forgetting, and disposable-vault conflict are now covered.
4. Complete the remaining broad portfolio filters/bulk operations, external
   notification delivery if it becomes a product requirement, advanced graph
   cluster/arbitrary-path interactions, error-envelope consistency, and broader
   authorized report/evidence delivery. Keep the canonical Decisions inbox,
   Context Pack disclosures, and completed Mission Workspace covered as these
   surfaces evolve.
5. Triage the retained Hermes dependency alerts independently of the clean ChillsPwn webapp audit; do not merge broad dependency changes into the verified runtime without their own tests.
6. Commit/push only reviewed files, verify GitHub Actions, then record the deployed commit and residual manual settings.
