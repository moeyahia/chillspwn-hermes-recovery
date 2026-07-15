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

The repository now has a real routed Command Center, exactly two public journeys, a canonical WAL SQLite model, durable events, a supervised mission runtime, exact Guided decisions, MCP specialist execution, evidence-gated learning, a user-controlled memory graph, and an Obsidian-compatible bridge. Those are implemented modules rather than mock dashboard data.

Current release disposition and residual work:

1. The immutable release is promoted and healthy, its live Grok OAuth Guided and Autonomous smoke passed, and an exact application rollback to the retained healthy release and return to the final candidate passed.
2. The backup-first canonical import, checksum reconciliation, controlled cutover, and non-production database restore rehearsal passed. The protected raw reports remain outside the repository.
3. A service-user SIGKILL/restart smoke resumed one Autonomous run from a durable recovery checkpoint and completed exactly one MCP action without ghosts. Browser acceptance still does not cover the complete Guided decision/evidence/interpretation loop, bounded loop recovery, or later live-provider behavior after memory correction/forgetting.
4. A real terminal Completion Review, scoped metadata-only export, canonical comparable-run record, and worker-based graph layout now exist. Several specified product surfaces remain partial: the complete Mission Workspace/tab model and follow-up-run flow, actual memory-item preview in the Autonomous contract, a representative mission benchmark suite, universal `Context used` links, and the full graph control/performance model.
5. Secret scans and publishable-file review are complete with no unresolved secret finding. The live least-privilege identity, sensitive-file modes, security headers, and migration backup boundary were verified. The ChillsPwn webapp dependency audit is clean, but the retained Hermes snapshot has 119 open Dependabot alerts that require separate triage and prevent a repository-wide clean-dependency claim.

## Candidate gates closed since the initial audit

- The latest local aggregate gate is green: 868 Bun tests with 3,762 expectations across 120 files, 34/34 Python authorization checks, 17/17 packaged board MCP checks, all three TypeScript gates, a 171-module server-entry bundle, a 97-module production build, bundle budgets, 19/19 browser tests, and a clean ChillsPwn-webapp dependency audit. The final quiet canonical-runtime benchmark also passed.
- The promoted Grok OAuth smoke completed an authorized no-network Autonomous specialist action through `ReconScout` and `local-selftest.quick_scan`, producing verified evidence/evaluation; Guided persisted an exact decision and remained planning-only. The final smoke required no repair fallback.
- The isolated service-user SIGKILL/restart smoke resumed from one recovery checkpoint and completed with one MCP execution, one verified evidence record, one evaluation, and no ghost-active work.
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
- Confirmed Context Pack presentation preferences now alter Guided prompt depth, terminology, pace, and evidence presentation through an explicit, focused, fail-closed adapter path.
- Runtime cancellation now transactionally closes nonterminal plans, steps, assignments, actions, tool calls, decisions, and approvals; focused cancellation tests cover the stale-assignment defect.
- Terminal runs render a real Completion Review from canonical evidence, findings, artifacts, evaluations, events, lesson usage, and Context Packs, with a terminal-only, scope-checked, redacted, bounded, hashed, audited metadata export.
- Global CSP/frame/referrer/content-type/permissions headers and external boot assets are implemented, and provider/API logging is bounded and metadata/hash based rather than raw-content based.
- Five populated canonical browser cases now prove Completion Review and report Context Packs, visible out-of-contract safe stop/checkpoint behavior, exact Guided parameter mismatch denial, a real eight-node/five-edge graph, versioned correction, and forgetting removal from retrieval and graph state.
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

The 19-test browser suite includes 14 foundation cases proving the two journey entry points in Overview and
the Command Palette, fail-closed Autonomous readiness, compatibility routing,
bounded real palette search and focus restoration, an empty Brain, bounded SSE
fallback/recovery, structural accessibility, reduced motion, local paint/CLS,
and mobile shell behavior. Five populated canonical cases additionally prove a
completed Autonomous review/report with Context Pack, visible out-of-contract
safe stop and durable checkpoint, exact Guided parameter mismatch rejection,
and versioned memory correction/forgetting removal from retrieval and graph
state. Separately, the promoted live Grok OAuth smoke proved exact Guided
decision creation and an Autonomous no-network specialist completion with
verified evidence/evaluation. An isolated service-user SIGKILL/restart smoke
also proved process-loss recovery and deterministic resume from checkpoint.

The opt-in disposable physical Obsidian smoke also proves export, operator edit,
conflict, explicit merge, canonical attachment, and synchronized forgetting on
a real filesystem without reading deployment configuration.

It does not yet prove the required populated browser/deployment journeys:

- Guided explanation, exact authorization, manual upload, interpretation, evidence, and next checkpoint;
- transient recovery and repeated-action recovery in both journeys;
- Completion Review follow-up creation, lesson review, and selective reuse;
- correction/forgetting changing a later live-provider response or plan;
- large physical-vault incremental sync and watcher behavior;
- populated decisions, recovery, and remaining core flows on mobile and keyboard.

Unit and in-process integration tests are valuable but do not substitute for these acceptance journeys.

## P1 product and architecture gaps

### Autonomous contract and readiness

`src/features/missions/AutonomousContractPage.tsx` implements six steps, authorization, targets, action classes, evidence requirements, time/token/cost/retry/replan/concurrency budgets, safe-stop conditions, deliverables, readiness, and memory-scope toggles. Remaining specified fields or interactions include:

- notification policy;
- explicit provider/tool policy inspection or override;
- evidence storage/artifact-size budget;
- reporting format and retention policy;
- actual candidate Context Pack preview with per-memory exclusion;
- explicit contract hash/version display before launch;
- specialist assignment adjustment and compatibility explanation.

### Mission portfolio and command surfaces

- `MissionPortfolioPage.tsx` is a real table backed by Overview, but lacks server search, cursor pagination, saved views, compact board mode, most required filters, and bulk archive/export.
- The Mission Workspace has no Summary/Plan/Live-or-Guide/Evidence/Findings/Conversation/Brain/Learning/History/Settings tab model.
- There is no journey-amendment/new-run UI for material changes to a signed Autonomous contract.
- The decision inbox exposes exact Guided decisions and inferred Autonomous attention items, but Autonomous contracts, post-run exceptions, and administrative approvals do not have a first-class canonical inbox record.

Terminal runs now expose a canonical Completion Review with success criteria,
evaluation, evidence coverage, findings, artifacts, recovery/policy counts,
verified lesson usage, Context Pack inspection, and unresolved work. Its export is
terminal-only, scope-checked, metadata-only, redacted, bounded to 1,000 records
per domain with truncation disclosure, SHA-256 hashed, and audit recorded.
Remaining completion gaps are a browser acceptance journey, explicit
time/token/cost budget comparison, representative comparable-mission fixtures,
finding/memory review actions in-place, follow-up mission/run creation, and authorized delivery
of underlying report/evidence artifacts rather than only the safe metadata
bundle.

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

The coordinator and supervisor have strong focused tests for fingerprints, progress, retry taxonomy, leases, budgets, circuit breakers, recovery, restart decisions, and cancellation. The UI Recovery Panel remains abbreviated: it does not consistently show detection evidence, attempts, retry budget used, alternative strategies, impact, related failed-attempt memories, reassignment/provider options, and exception report detail.

### Second Brain graph and transparency

Implemented: canonical nodes/edges/provenance/lifecycle, hybrid retrieval, context packs, corrections, forgetting/suppression, engagement isolation, graph/table views, bounded progressive API loading, canvas pan/zoom, local/global/mission/operator views, and node inspection.

Still partial relative to the specification:

- no attack-path or lesson/failure graph view;
- no edge-type, engagement, scope, date, or confidence controls;
- no date slider, cluster collapse, label-density control, saved named views, or shareable filter deep links;
- layout work runs in a dedicated worker and stale layout requests are superseded; positions are not persistently pinned;
- `Context used` is visible for Guided Commander responses, memory history, and terminal Completion Reviews, but not universally from Autonomous decisions, every action card, and every report;
- a populated browser fixture now renders eight canonical nodes/five edges and proves correction/forgetting removal, and the physical disposable-vault lifecycle smoke passes;
- 50,000-node database queries were benchmarked, but a populated 50,000-node browser interaction and physical 50,000-note incremental vault sync were not.

### Learning and measurable improvement

Run evaluations, evidence-gated candidates, author self-approval denial, failed-attempt lessons, safe parameterized attack-chain projection, lesson usage, review UI, and a scope-aware comparable-run selection/record exist. A representative mission benchmark fixture suite does not. The product can report measured deltas when comparable prior evaluations exist, but it cannot yet claim broad improvement across completion rate, evidence time, duplicate actions, recovery, cost, and corrections.

### Observability and operations

Canonical events, outbox, structured logs, health snapshots, replay/gap repair, cursor APIs, redaction, and semantic UI exist. Remaining operational gaps include:

- no dedicated trace waterfall/span view;
- no demonstrated 100,000-event virtualized UI;
- no tested reconnect-storm or multi-hour memory-leak profile;
- legacy domains still contain file/log writers, but their HTTP/WS mutations and
  background executors are default-off behind the explicit rollback gate;
- no notification delivery service despite the canonical table;
- no optional OTLP exporter or documented stable observability contract;
- terminal-run metadata export is implemented and audited, but authorized delivery of underlying report/evidence artifacts and a general audit export are not complete V2 APIs.

### API and maintainability

The V2 endpoints use typed client schemas, request IDs, idempotency on harmful mutations, scoped repositories, and consistent errors in the mission runtime. Remaining work:

- publish a V2 API/event contract (OpenAPI or an equivalent checked schema document);
- make error envelopes consistent across every V2 domain;
- remove retained legacy route implementations after reconciliation; the shared
  default-off mutation boundary and read/V2 passthrough are compatibility-tested;
- decompose the remaining 10,000-line `server/index.ts` compatibility shell further;
- document Android/Capacitor validation or any supported-platform limitation.

## P1 security and privacy gaps

See `security.md` for the full review. Release-relevant findings are:

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
- INP, real mid-tier mobile, 100,000-event UI, reconnect storm, long-session heap, and physical large-vault measurements remain outstanding.
- Architecture decisions are described across topic documents, but no explicit ADR set records the irreversible choices and alternatives.
- The root API documentation now distinguishes canonical `/api/v2` from the
  default-read-only unversioned compatibility surface.
- The safe migration summary is recorded here and in `test-evidence.md`; raw reconciliation reports, source manifests, backups, and user data remain protected outside the repository.

## Definition-of-done traceability

| # | Acceptance statement | Status | Evidence and remaining proof |
| ---: | --- | --- | --- |
| 1 | Home is Command Center | Implemented + tested | `src/App.tsx`, `OverviewPage.tsx`, browser journey. |
| 2 | Two primary entry actions | Implemented + tested | Browser asserts `Go Autonomous` and `Start Guided Mission`. |
| 3 | No third public journey | Implemented + tested | V2 schemas accept only two journeys; the public `/legacy` route is removed and unversioned execution is default-off. |
| 4 | Mission creation hides provider modes | Implemented + tested | Both creation forms are journey/mission focused. |
| 5 | Autonomous completes without routine input | Implemented + tested (promoted live) | Runtime tests plus the promoted Grok OAuth/no-network MCP completion through `ReconScout`; populated browser provider proof remains. |
| 6 | Autonomous preflight fails closed | Implemented + tested | Browser and `RuntimeReadiness.test.ts`. |
| 7 | Out-of-contract Autonomous safe-stops | Implemented + tested | Runtime tests plus populated canonical browser proof show visible safe stop, immutable event, durable checkpoint, and no dispatched action; promoted-service proof remains. |
| 8 | Guided starts with an explanation | Implemented + tested (promoted live) | Runtime/Commander tests and promoted Grok OAuth planning reached an exact decision while Commander remained planning-only; no populated real-provider browser journey. |
| 9 | Guided pauses and interprets every consequential step | Implemented, acceptance unverified | Exact decision and recovery tests; full UI loop missing. |
| 10 | Guided state is independent of transcript | Implemented, acceptance unverified | Canonical mission/run/checkpoint storage; process-return browser proof missing. |
| 11 | Visible state/owner/heartbeat/progress/next | Implemented, acceptance unverified | Live and run workspace projections; no populated browser assertion. |
| 12 | Semantic action plus raw detail | Partial | Semantic event cards and terminal review exist; universal action-card coverage is not proven. |
| 13 | Guided decisions and Autonomous safe stops in one inbox | Partial | Guided decisions are canonical; Autonomous attention is inferred from Overview rather than a complete exception model. |
| 14 | No primary eight-second polling | Implemented + tested | SSE, replay/gap repair, bounded 30-second degraded fallback. |
| 15 | Canonical state is SQLite | Partial | V2 domains are canonical; legacy production state and compatibility domains remain. |
| 16 | Idempotent migration and reconciliation | Implemented + tested | All 5,964 sources copied/checksummed, cumulative reconciliation accepted, schema 7 integrity clean, and exact restore/forward-migration rehearsal passed. |
| 17 | Forced server restart resumes deterministically | Implemented + tested (isolated process) | A service-user SIGKILL/restart smoke resumed from one checkpoint, completed exactly one MCP execution/evidence/evaluation, and left no ghosts. |
| 18 | Repeated no-progress action bounded | Implemented + tested | Supervisor and durable coordinator tests. |
| 19 | Budgets enforced | Implemented + tested | Budget/reliability/runtime tests; live cost/token provider accounting still needs acceptance proof. |
| 20 | Blocked run explains resolution | Partial | Status reason/checkpoint UI exists; full Recovery Panel does not. |
| 21 | Cancellation leaves no ghost work | Implemented + tested | Runtime/coordinator/MCP tests assert nonterminal work is closed; the superseded failed promoted smoke was cancelled, and the restart/resume smoke left no ghost-active work. |
| 22 | Terminal run evaluation | Implemented + tested | `RunLearningService.test.ts` and runtime cancellation evaluation. |
| 23 | Lessons cannot self-approve | Implemented + tested | Operations review integration test. |
| 24 | Verified lessons selectively retrieved and visible | Partial | Planner/retrieval tests and usage UI; comparable second mission proof missing. |
| 25 | Measurable comparison to similar missions | Partial | Scope-aware canonical comparison records and Completion Review rendering exist; a representative benchmark fixture suite and broad comparative evidence remain missing. |
| 26 | Real heterogeneous Second Brain graph | Partial | Real schema/API/UI plus an eight-node/five-edge populated browser fixture pass; migrated operator graph and large-scale browser acceptance remain. |
| 27 | Node/edge provenance, scope, sensitivity, confidence, lifecycle | Implemented + tested | Database and memory validation tests. |
| 28 | Memory influence visible from plan/action/explanation/report | Partial | Guided/context history, Completion Review, and populated report Context Packs are supported; Autonomous actions and universal report coverage remain incomplete. |
| 29 | Confirm/correct/scope/expire/export/forget | Partial | Most controls exist; per-node export and some scoped bulk controls are absent. |
| 30 | Forget removes retrieval and projections | Implemented + tested | Memory/vault tests, populated browser Context Pack/graph removal, and physical-vault synchronized forgetting pass. |
| 31 | Guided adapts to confirmed preferences | Implemented, acceptance unverified | Confirmed Context Pack preferences drive depth, terminology, pace, and evidence-presentation prompts in focused tests; browser retrieval correction/forgetting passes, while later live-provider wording/plan adaptation remains unproved. |
| 32 | Autonomous uses permitted confirmed memory/verified lessons only | Implemented + tested | Runtime adapter/retrieval tests. |
| 33 | No cross-engagement memory leak | Implemented + tested | Router and retrieval isolation tests. |
| 34 | Preference candidates require consent | Implemented + tested | Candidate/control policy tests. |
| 35 | Obsidian export produces valid linked notes | Implemented + tested | Unit round-trip plus isolated physical-filesystem Markdown/YAML/wikilink and canonical-attachment smoke pass. |
| 36 | Two-way edits are versioned and conflicts visible | Implemented + tested | The isolated physical bridge smoke proves operator edit versioning, durable conflict detection, explicit merge, and synchronized forgetting; sustained/large-vault watcher acceptance remains. |
| 37 | 50,000-node graph remains usable | Partial | DB/API benchmark passes; browser and physical vault scale tests missing. |
| 38 | Correlated/searchable observability and context use | Partial | Canonical event/log/health APIs exist; not every legacy/action record is canonical or trace-complete. |
| 39 | Raw command spam is secondary | Implemented | V2 surfaces default to semantic records with expandable details. |
| 40 | WCAG 2.2 AA | Partial | Structural browser checks pass; manual and independent audit remains. |
| 41 | Performance budgets measured and substantially met | Partial | Bundle/browser/DB/graph metrics recorded; INP/mobile/large-event/long-run gaps remain. |
| 42 | Intentional mobile experience | Implemented, acceptance unverified | Shell/route reflow tests and a focused populated Guided 390-by-844 check pass; the remaining populated core journeys are not fully accepted on mobile. |
| 43 | Logo hash unchanged | Implemented + tested | Hash remains `0a3dfd69...5f85c955`. |
| 44 | No fake production data | Implemented | Production pages query APIs; test fixtures use isolated paths. |
| 45 | Critical safety controls retained | Implemented + tested | Existing policy, provider, target, delegation, lesson, and runtime tests. |
| 46 | Build, types, unit, integration, E2E pass | Implemented + tested | Latest local gate: all TypeScript checks, 868 Bun tests/3,762 expectations across 120 files, 34/34 authorization checks, 17/17 board MCP checks, build, bundle budgets, 19/19 E2E, and the quiet runtime benchmark pass. |
| 47 | Before/after screenshots and performance evidence | Implemented + tested | One before and seven after screenshots are present, with local bundle/browser/runtime evidence and promoted loopback health timings. Automated visual diff and private-ingress Web Vitals remain follow-up work. |
| 48 | Database/memory/vault/app rollback documented and tested | Partial | Exact database restore/forward migration and deployed application rollback/return pass; memory/vault lifecycle recovery passes, while a production-vault rollback rehearsal remains outstanding. |

## Ordered closure plan

1. Stabilize and review the worktree; the after screenshots and final repository security scans now exist, while automated visual-diff coverage remains follow-up work.
2. Add the remaining populated browser journeys for complete Guided evidence/interpretation, recovery/loop handling, learning reuse, and later-provider memory adaptation; Autonomous safe stop, process restart/resume, retrieval forgetting, and disposable-vault conflict are now covered.
3. Complete the remaining Mission Workspace/follow-up flow, contract Context Pack preview, universal memory-context entry points, graph controls, and comparable-run benchmark surfaces.
4. Triage the retained Hermes dependency alerts independently of the clean ChillsPwn webapp audit; do not merge broad dependency changes into the verified runtime without their own tests.
5. Commit/push only reviewed files, verify GitHub Actions, then record the deployed commit and residual manual settings.
