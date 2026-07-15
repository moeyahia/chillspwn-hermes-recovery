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

### Latest aggregate candidate gate — 2026-07-15

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

This aggregate gate proves the local candidate is internally buildable and its
checked contracts are green. Migration, production deployment, service-account
isolation, promoted Grok, restart/resume, and application rollback are separate
acceptance records below.

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

### SIGKILL restart/resume smoke — 2026-07-15

The opt-in restart smoke ran the promoted release code as the `chillspwn`
service user on an isolated loopback port and fresh canonical database. It
SIGKILLed the server after the Autonomous run entered `running`, restarted the
process, recovered from one durable checkpoint, and completed the run.

The final state contained exactly one MCP execution, one verified evidence
record, one evaluation, and no ghost-active run, assignment, action, or tool
call. This proves process-loss recovery without mutating the production
database.

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

### Security and publishability scans — 2026-07-15

| Check | Result |
| --- | --- |
| Gitleaks worktree and Git history | 0 findings |
| TruffleHog verified-only filesystem and Git history | 0 verified secrets |
| Patch and staged-patch whitespace | \`git diff --check\` and \`git diff --cached --check\` passed |
| Publishable large-file review | no file exceeded 50 MiB |
| Sensitive-filename inventory | no actual environment, auth, private-key, or certificate files selected for publication |
| Semgrep review | 7 reported patterns reviewed; all were false positives or intentional bounded paths, with no unresolved release blocker |
| ChillsPwn webapp production dependency audit | clean in the webapp package scope |
| Retained Hermes dependency alerts | 119 open GitHub Dependabot alerts: 2 critical, 30 high, 57 medium, 30 low |

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
| Completion Review and scoped export | 9 completion helper tests and the 70-test operations/client slice passed; exports are terminal-only, scope-checked, metadata-only, redacted, bounded, hashed, and audited. |
| Proxy/API logging hardening | 11 focused proxy tests with 39 expectations passed; logs retain metadata/hashes rather than raw provider content and enforce bounded secure writes. |
| Guided exact-decision terminal semantics | 40 focused tests passed for exact complete, manual, skip, and stop behavior without parameter drift or unintended dispatch. |
| Reusable-memory secret denial and canonical vault attachments | Focused memory/vault suites passed; secret-like reusable content fails closed and attachment references must pass the canonical mission-artifact lifecycle. |
| Event-stream control-byte hardening | 11 focused event tests passed; summaries reject literal control bytes while preserving replay and delivery behavior. |
| Legacy migration batching | 7 migration tests passed, including a 2,105-line dashboard log, transactional batching, resume, and idempotency. |
| Release staging | Shell syntax and the staging acceptance harness passed; the final immutable release verified 11,144 files totaling 243,729,599 bytes. |
| WhatsApp media path boundary | 15/15 bridge tests passed for canonical-root containment, symlink/regular-file validation, and generic failure reporting. |
| Grok plan schema/SOUL boundary | Focused provider regressions plus the promoted live smoke passed; the final provider response validated without invoking repair fallback. |
| Database health cache | Focused regression proves repeated health reads reuse the bounded integrity result while an explicit refresh performs a new SQLite integrity check. |

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

A read-only Bun link check walked all 27 Markdown documents then present under
`docs/command-os-v2`, resolved every relative Markdown link against its source
document, and reported:

```text
validated 27 Markdown documents: all relative link targets exist
```

External URLs and absolute operational paths were deliberately excluded from
that filesystem check. They require their own network/deployment validation.

## Focused automated coverage present in the candidate

The following focused suites are direct evidence sources for the implementation
and were included in the latest 868-test aggregate run unless separately listed
as Python or browser checks above.

| Domain | Direct coverage |
| --- | --- |
| Database | ordered/checksummed migrations, WAL health, canonical tables, invariants, immutability, FTS5, online backup |
| Events | atomic event/outbox write, monotonic sequence, replay, global resume, backpressure, delivery retry, heartbeat, redaction, gap API |
| Journeys/runtime | Autonomous no-wait, exact Guided decision, out-of-contract safe stop, manual result, evidence validation, recovery, cancellation evaluation |
| Supervisor | state machine, fingerprints, progress, loops/cycles, retry taxonomy/backoff, budgets, circuit breakers, leases, recovery decisions |
| Restart/cancel | safe-idempotent recovery classification, persisted supervisor snapshots, child cancellation, lease cleanup |
| Intelligence/learning | immutable evidence, finding evidence gate, reviewer self-approval denial, run evaluation, failed-attempt and safe attack-chain lessons |
| Second Brain | validation, hybrid retrieval, engagement isolation, consent, context packs, correction, forgetting/suppression, Memory Control policy |
| Obsidian | YAML/wikilink round-trip, sandboxing, conflict detection, malformed-note quarantine, forgotten projection removal |
| UI contracts | strict V2 schemas, no third journey, Guided semantic rendering, safe links, graph utilities, event fallback policy |

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

- a complete populated Guided explain/decide/manual-or-agent/evidence/interpret loop;
- populated browser recovery, loop stop, and child-process cancellation;
- Completion Review, report/evidence export, and follow-up mission flow;
- confirmed preference correction and forgetting changing later provider wording or plan selection, beyond the now-tested retrieval removal;
- populated recovery and the remaining core journeys on mobile and keyboard;
- large physical-vault incremental-sync performance and conflict behavior under sustained watcher activity;
- live-provider memory correction/adaptation and a production-vault rollback rehearsal.
