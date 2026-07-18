# Command OS V2.4 test evidence

Status: **implementation validation snapshot — not a release candidate or cutover approval**
Evidence date: `2026-07-18` UTC
Source authority: candidate work evolved from committed base
`66c7f176a7cfbc421a1903be5d15deb80c663125` on
`deploy/command-os-v24-live`. The exact resulting source revision is captured
by the subsequent Git commit and immutable staging manifest; no dirty source
may be deployed. Exact-run artifacts in this validation snapshot are identified
by their own paths and hashes. This report is not an immutable release
attestation.

This report records executed checks and preserved artifacts. Configured projects,
unexecuted fixtures, failure-only screenshots, and a prior-source pass are never
presented as current release proof.

## 2026-07-18 operational-truth update

The most recent completed rerun of the registry-driven executable-tool gate passed
**18/18 exposed bindings** across four exact servers. It used these bound
receipts:

- NVD: `nvd_canary_78502c6b667e30d0158ab217179c0ac6` (2 exposed);
- VulnIntel CVE:
  `vulnintel_cve_canary_fca6382af68fc1efef73f7628c5ff1bb` (8 exposed);
- Pentest Recon:
  `pentest_recon_canary_6ca0bf23292ad7c176865b0fe33be149` (8 exposed).

The V2-only trusted recon directory passed its root-run installation check. It
contains the reviewed capability-free Nmap copy and no-update `httpx-toolkit`
wrapper and is absent from the legacy and preview-global PATH. The separate
Pentest diagnostic receipt
`pentest_recon_canary_b66bd012dd2e8c38aa850152c6152df5` recorded 12/12 exact
schemas, 10/12 diagnostic successes, 12/12 deterministic failures, and 8/8
exposed bindings passing. `runHashcat`, `subfinderEnum`, `httpxProbe`, and
`nucleiScan` are suppressed, not counted as passes. Binary analysis remains
32/32 schema-attested but 0 exposed because all bindings are suppressed.

The current inventory is 19 configured MCP servers/134 configured bindings,
4 enabled servers/56 enabled bindings, 87 total/18 enabled policy mappings,
38 suppressed, 9 unmapped/0 enabled, 4 exact servers/18 exposed, and 18/18
exposed bindings fully covered. The one callable provider
route remains 1/1 covered. These canaries used no engagement target and no
public LLM.

Migration `014_runtime_mutation_receipts` adds a dedicated durable receipt
table for fenced runtime mutations. It represents `in_progress`, `succeeded`,
and sanitized `failed` outcomes, owner tokens and expiry, canonical boundary,
replayable response/error, and timestamps. It conservatively imports older
settings-backed receipts: completed responses remain replayable, while
interrupted reservations enter expired and require canonical reconciliation
instead of a fabricated success.

The isolated standalone V2 package gate completed **723 tests, 10,637
assertions, and 0 failures**, including type checks and production build. The
latest hybrid package gate then completed **1,361 Bun tests with 0 failures**,
plus 34/34 runtime-gate integration checks, 20/20 Mission Board MCP checks, all
TypeScript projects, and the production build. The hybrid gate recorded
**8,566 assertions**. An immutable full-log archive remains pending; it is not
inferred here. These
gates do not replace the still-required complete browser matrix, visual
approval, migration/restore rehearsal, soak, preview acceptance, or release
sign-off.

The clean critical Chromium aggregate then completed **129/129 tests** with 0
failures, 0 skipped tests, and 0 flaky results using one worker. It covered the
active Vault/Brain lifecycle, accessibility, intake, operational truth,
recovery, interaction-manifest coverage, and the complete route/internal-link
crawl. Run ID: `critical-chromium-20260718T041319Z`; isolated UI/API ports:
`43470`/`43471`. The run did not touch live ports `3131` or `3132`. This is the
current critical Chromium gate, not the still-pending full release browser
matrix.

Passing the tool and package gates does **not** open the cutover gate. The
legacy application remains the default, and no release-candidate or human
approval is implied.

## Runtime evidence bridge — published, final live consumption pending

The tool audit can now publish its passing receipts through the explicit
`--write-runtime-evidence` option. Publication occurs only when the aggregate
tool and provider audit is releasable. The writer creates a same-directory
temporary file, flushes it, changes it to root ownership with read-only service
group access (`0640` in production), atomically renames it, and flushes the
parent directory. The configured production path is:

`/var/lib/chillspwn-attestations/command-os-v2-tool-evidence.json`

The runtime does not trust the existence of that file alone. Before using any
receipt it verifies the root-controlled non-symlink parent, regular-file type,
owner, exact `0600`/`0640` mode and service group, bounded size, bundle ID and
content integrity, seven-day freshness with a small clock-skew allowance, and
each canary receipt's own verifier. It independently hashes the currently
installed MCP server assets and active registry configuration and accepts only
receipt records whose hashes match an enabled, live-attested route. Receipts
for disabled routes are ignored rather than treated as authority.

Missing, malformed, edited, stale, future-dated, weakly permissioned,
symlinked, owner-mismatched, asset-drifted, or configuration-drifted evidence
produces no executable coverage. Readiness remains fail-closed and explains
that runtime tool evidence is unavailable or invalid. A five-second keyed
validation cache avoids repeatedly hashing unchanged assets while invalidating
on evidence-file identity/mtime or route-attestation changes.

The startup path now schedules bounded provider and eligible MCP live
attestations before the first readiness request. This warm-up is nonblocking
and does not grant execution authority merely because a probe was scheduled.
Readiness reports `probing`/initialization state until a fresh attestation
actually succeeds, and reports unavailable while scheduling or probing cannot
establish authority.

Focused negative coverage exercises atomic publication, private production
mode, missing evidence, weak permissions, untrusted ownership/parent,
symlinks, edited JSON, stale/future receipts, asset/configuration drift, and
disabled-route isolation. Startup tests prove probes begin without granting
authority and scheduling failure remains nonblocking and fail-closed. These
tests are included in the green 1,361-test hybrid gate above. A subsequent
client-contract test and build retained the exact MCP probing and Guided tool-
execution fields; that focused check passed 1/1 after the full hybrid gate.

Final production evidence fields are intentionally left open until the exact
aggregate is rerun, the candidate is deployed, and `/api/v2/health` is queried
after startup:

| Field | Final value |
|---|---|
| Aggregate result | **PASS — 18/18 exposed tools, 1/1 provider route, 0 route/config blockers** |
| Runtime evidence bundle ID | `runtime_tool_evidence_b502fc8be05cf1c182e766aae93b7de4` |
| Runtime evidence SHA-256 | `451c84db23174eb24ca719f1d9c4d8d484ebf9c6533493ede8aa369f363bc0d5` |
| Runtime evidence owner/mode | `root:chillspwn`, `0640`, 53,685 bytes |
| Accepted runtime routes/tools | **PENDING — live readiness verification** |
| Runtime validation blockers | **PENDING — must be zero for execution readiness** |
| Provider/MCP startup state | **PENDING — post-warm-up live health** |

No placeholder above is release evidence and none may be replaced from an
earlier canary receipt or a fixture-only response.

## Historical complete package gate (2026-07-17)

The then-current source tree completed `bun run check` after the run-recovery,
browser-lifecycle, Brain intake/reporting, accessibility, and visual-manifest
hardening. This was a source/build regression gate,
not a release-candidate browser, visual, accessibility, performance, migration,
soak, or sign-off gate.

| Gate | Result |
|---|---|
| Logo verification | Exact required SHA-256 |
| V2 application boundary | Pass, with one operator-authorized Recovery Panel compatibility mirror in `plugin/webapp`; fresh webapp gate passed 1,233/1,233 |
| Browser and server TypeScript | Pass |
| E2E TypeScript | Pass |
| Unit/integration tests | **702 passed, 0 failed, 10,423 assertions, 131 files** |
| Production Vite build | Pass |
| Dependency audit | Separate prior `bun audit` checkpoint; not part of `bun run check` |

Logo verification, the V2 application boundary, browser/server TypeScript, E2E
TypeScript, and the production Vite build also passed in the same full check.
That V2 check predates the authorized `plugin/webapp` compatibility mirror. A
separate fresh webapp package gate is recorded under Legacy compatibility
evidence below.
The older local log
`/tmp/v2-check-obsidian-final-20260717T0353Z.log` (SHA-256
`ba42fa7de32dbde54ee4f824b89da7e3d52d4b11c4415c17ac28bc2779f9f1a4`)
predates this 702-test gate and is retained only as historical evidence. That
full check still needed a run-specific immutable archive before release
candidacy.

That emitted build measured:

| Asset | Raw | Gzip |
|---|---:|---:|
| Main application | 362.80 kB | 105.76 kB |
| React vendor | 11.73 kB | 4.20 kB |
| Minimum initial JavaScript | 374.53 kB | 109.96 kB |
| Global V2 CSS | 137.18 kB | 19.63 kB |
| Run Workspace route | 278.94 kB | 69.15 kB |
| Lazy Artifact Intelligence route | 36.79 kB | 9.17 kB |

The main entry and Run Workspace remain below their practical gzip budgets;
this is transfer-size evidence, not Web Vitals proof.

This source gate does not invoke Playwright and does not substitute for browser,
visual, accessibility, performance, migration, soak, or release-signoff proof.

## Local immutable-source attestation

An earlier `bun run release:attest:local` completed before the historical 702-test
package gate and wrote
`chillspwn/plugin/command-os-v2/test-results/attestations/command-os-v2-release-attestation.json`
(SHA-256
`77f260d94f80346cdb0ffd36c0e421d62cfc967cf752b90b30f9b71c53c1f0a2`).
The receipt records source manifest
`492c708672be230f7c8f09c4a430e40f982fe9c536fc5e30dd236ad3c3d6db8d`
and artifact manifest
`a40da8e612b504d584cc3dc2593dadbd637846d449c614b39e90bc008803fb37`,
but correctly sets `immutableSourceAttested:false` and
`releaseCandidateEligible:false`. The V2 package is absent from pinned HEAD,
the worktree differs from that revision, and the local receipt is unsigned and
does not include soak, preview, rollback, or human approval. This fail-closed
result is expected and preserves the closed cutover gate.

## Browser evidence

All listed Playwright executions used retries `0`. Required-network runs reject
unexpected V2 request failures; the long-lived SSE stream is the only explicit
navigation-teardown exception.

### Expanded automated accessibility gate

The machine-readable gate now covers **12 primary-route initial states** and
**16 material states**. The primary routes are Overview, Missions, Live,
Guided, Decisions, Intelligence, Agents, Second Brain, Learning, Observability,
Reports, and System Connections. Material coverage includes the command
palette; both intake journeys; versioned Plan; Guided waiting decision;
Evidence and Finding review; Brain canvas and accessible table; a connected
Obsidian Vault after a real filesystem round trip; structured recovery;
Research; trace and report review; and System Policies and Settings.

The current gate pins direct `axe-core` 4.12.1, preloads `axe.min.js` before
document initialization, and passes only a compact, version-checked scan
function through `page.evaluate`. A browser canary rejects an evaluated
function larger than 64 KiB and the policy test rejects the prior oversized
runtime-source transport, `AxeBuilder`, rule disabling, and exclusions. Each
project now runs **28 serial tests** and emits **29 axe receipts**: the added
transport canary scans Overview, and one Brain test scans both canvas and table.

The current direct-preload implementation completed **84/84** across
`chromium-1440`, `firefox-1440`, and `webkit-1440` in 195,950.758 ms,
producing **87 scans** with zero automated A/AA violations, zero unexpected,
skipped, or flaky results, and retries disabled. JSON:
`test-results/results/accessibility-direct-all3-20260717-r1.json`
(SHA-256
`646380edb1001873e027203b308f2f2565305f4c66404b2817bcee493e96d223`).
HTML:
`test-results/html/accessibility-direct-all3-20260717-r1/index.html`
(SHA-256
`7abec0c4b83b4c2326f629ac68225a83df6a5d8cf940f3ca4930552ff5bb7599`).

The most recent complete three-engine artifact is retained as **archived
pre-direct-transport evidence**. Its `chromium-1440`, `firefox-1440`, and
`webkit-1440` matrix completed **81/81 in 115,689.921 ms**, producing **84 axe
scans with 0 WCAG A/AA violations**, **0 failed, 0 skipped, and 0 retries**.
JSON:
`/root/chillspwn-command-os-v24/chillspwn/plugin/command-os-v2/test-results/results/axe-expanded-all3-20260717-r1.json`
(SHA-256
`aec4b7adbf9a3ac73dae22bcfb6b86c33954a789c65e182b8dca68c7059cbf22`).
HTML:
`/root/chillspwn-command-os-v24/chillspwn/plugin/command-os-v2/test-results/html/axe-expanded-all3-20260717-r1/index.html`
(SHA-256
`f050dfdf24fb9d95bc77794d5b7007e82343b2ae9563ecee7f20aa2d7b44429a`).

The archived 81/81 result remains historical and is not relabeled as proof of
the new transport; the current 84/84 artifact above is authoritative for that
boundary.

No A/AA rule was disabled or excluded. The archived report retains **84 incomplete
gradient color-contrast determinations** and **15 incomplete ARIA-support
determinations** for manual review; they are neither suppressed nor claimed as
passes. The gate found and closed two frontend defects before the final run:
roleless labeled Live progress tracks now use real progressbar semantics, and a
4.49:1 critical status pill on a selected Finding row now uses an AA-gated
semantic text token. This is bounded automated desktop-engine evidence, not
full mobile/native-zoom/manual-assistive-technology certification or human
accessibility approval.

### Honest same-origin production-static profile

The exact `release` runner contract now rejects relaxed API or manifest gates,
external/pre-existing servers, split UI/API origins, non-loopback hosts, URL
credentials, and non-HTTP managed origins. It builds the Vite distribution and
serves both that production-static UI and the real V2 API from one Playwright-
managed process with one worker, no server reuse, and no retries. Every report
records `immutableSourceAttested: false` and
`releaseCandidateEligible: false`, because this local execution does not attest
an immutable revision/artifact and cannot replace soak, preview acceptance,
rollback rehearsal, or human sign-off.

The first isolated smoke passed Overview **1/1** in 5.7 seconds. Evidence:
`test-results/results/release-static-smoke-20260716.json`. Its report records
strict API and manifest enforcement, `playwright-managed-static`, one actual
worker, and the explicit ineligible attestation. The complete cross-browser
product suite has not yet run in this profile; the bounded current manifest
crawl has now run across all 13 configured projects as recorded below.

### Initial route and generated-href crawl

`tests/e2e/route-smoke.spec.ts` completed **390/390** checks across all **13
configured projects** in **406,441.99 ms**, with zero skipped, unexpected, or
flaky results. Each project covered 29 static routes plus its generated internal
href contract. The audit reported no generated 404, console, required-network,
or layout failure.

Artifacts:
`test-results/results/route-href-crawl-current-20260717.json` (SHA-256
`7f80e40eecdcc4679f5cdffa5f5832fb3c67630dc9370dd0f6bf744b0e1c5493`) and
`test-results/html/route-href-crawl-current-20260717/index.html`.

This closes the stale absence of a current route/href crawl for the
representative initial/static state. It does not exercise dynamic imported,
archived, blocked, or evidence-reconciliation states and does not execute all
489 material interactions. It is therefore not full route-state, interaction,
or cutover proof.

The current route-readiness and command-palette settlement boundaries also
completed a repeat-five Firefox stress slice: **150/150** passed in 235,569.658
ms, with zero unexpected, skipped, or flaky results and retries disabled. Each
repeat exercised all 29 static route cases plus canonical mission/run/agent/
evidence palette navigation. JSON:
`test-results/results/firefox-route-palette-stress-r1.json` (SHA-256
`ca21a8c12e8a5121afee2eac87e3d7ba510326d5386aa4e4eeb7238b0f4207d2`).
HTML:
`test-results/html/firefox-route-palette-stress-r1/index.html` (SHA-256
`95dd992b3987fc81e442a77c6d443fe49bff68841d16bbf6c7467421c0a38464`).
This is a bounded Firefox stability receipt, not a replacement for the final
all-spec, all-project matrix.

### Exact browser-lifecycle and request audit

Popup permission is now prospective and bound to the opener, exact URL, popup
page, and initial request identity. Successful downloads require prospective
page-bound declarations and the exact Playwright `Download` identity. Direct
API requests carry exact IDs and same-origin receipts; sealing rejects new work,
and finalization uses a bounded 100–1000 ms drain before emitting an explicit
hung-request defect. Document and EventSource teardown are correlated to exact
pre-existing request/page/URL/lifecycle receipts rather than a broad timing
exception.

The previous retry-free validation artifacts are retained below as historical
checkpoints. A new cross-document receipt-isolation negative canary expands the
current suite; its replacement all-engine result is not yet verified, so this
snapshot does not claim a current aggregate canary count. The earlier artifacts
are:
`test-results/results/browser-audit-p1-canaries-r3-chromium-20260716.json`,
`test-results/results/browser-audit-p1-canaries-r3-crossbrowser-20260716.json`,
and `test-results/results/browser-audit-p1-impacted-r2-20260716.json`.

#### Focused verified artifact-download repair

The release-profile Chromium 1440 artifact-delivery failure was reproduced
retry-free in
`test-results/results/artifact-download-request-identity-repro-20260717.json`.
The preserved trace shows an exact Playwright `Download` identity for the
native `<a download>` transfer but no Playwright `Request` or network-resource
identity for that attachment. The predecessor release report remains
`test-results/results/release-local-all13-final-20260716.json`; its failing
trace remains at
`test-results/playwright/release-local-all13-final-20260716/artifact-delivery-e2e-inte-d6369-rowser-attachment-and-audit-chromium-1440/trace.zip`.

The repaired audit reports the available identity without weakening the
boundary:

- Firefox records `identityMode: request-and-download` and
  `requestIdentityUnavailable: false`, requiring the prospective page, exact
  navigation `Request`, exact `Download` object, and canonical origin/path.
- Chromium and WebKit record `identityMode: download-event` and
  `requestIdentityUnavailable: true`, requiring the prospective page, exact
  `Download` object, and canonical origin/path. The artifact assertion also
  verifies the exact suggested filename, retained bytes, byte length, and
  SHA-256.
- Download-event identity grants no authority to suppress failed requests,
  HTTP responses, or EventSource cancellation. Those ledgers continue to
  require the exact Playwright `Request` object.

The final managed-static release-profile evidence is
`test-results/results/artifact-download-release-plus-canaries-final-20260717.json`:
**9/9** across Chromium 1440, Firefox 1440, and WebKit 1440 in 16,744.401 ms,
with retries disabled and zero unexpected, flaky, or skipped tests. Each engine
passed the verified artifact delivery, a successful undeclared blob-download
negative canary, and a successful same-exact-URL/wrong-page negative canary
against the real authenticated artifact endpoint. The latter proves that URL
matching cannot substitute for page-bound authority. The focused E2E
TypeScript check passed; the browser-audit policy and static-boundary unit slice
passed **11/11 with 99 assertions**.

This is focused defect-closure evidence only. It does not attest an immutable
source/build, replace a complete retry-free 13-project release run, or close
visual, accessibility, performance, migration, restart/rollback, soak, preview,
zero-defect, or human-sign-off requirements. The operator-authorized live
promotion is an explicit exception and does not satisfy formal release or
cutover approval.

#### Focused strict history-boundary repair

The Chromium 1440 Brain graph deep-link/history failure from
`test-results/results/release-local-all13-final-20260716.json` was reproduced
retry-free in
`test-results/results/brain-history-repro-20260717.json`. The trace showed a
valid SPA `history.pushState`/`popstate` traversal: the main-frame URL changed,
but no top-level document request existed. The previous document-navigation
boundary therefore rejected valid browser history rather than detecting a
product navigation failure.

The replacement is a separate strict history-traversal boundary:

- every traversal requires an exact main-frame document `Request` or an
  observed main-frame URL transition;
- only the exact document-request receipt may authorize teardown of an exact
  pre-boundary request identity;
- a URL-only SPA/BFCache receipt cannot suppress any failed request;
- when Firefox reports an old EventSource abort immediately before a same-URL
  document request, only the exact pre-boundary `Request` object is staged, and
  it is accepted only after the same boundary observes that document request.

Negative AST canaries reject `history.pushState` plus `goBack()` under the
document boundary, `goForward()` under the document boundary, and `reload()`
under the history boundary. The policy unit separately proves that a URL-only
receipt grants no teardown authority. A repository scan found **zero**
remaining `goBack()`/`goForward()` document-boundary wrappers; the 12 audited
history calls use the dedicated history boundary.

The final managed-static release-profile focused matrix passed **24/24** with
retries disabled: eight affected journeys on Chromium 1440, Firefox 1440, and
WebKit 1440. Evidence:

- JSON:
  `test-results/results/history-boundary-focused-crossbrowser-r2-20260717.json`
  — 24 expected, zero unexpected, zero flaky, zero skipped, 137,214.672 ms;
- HTML:
  `test-results/html/history-boundary-focused-crossbrowser-r2-20260717/`;
- Chromium isolation:
  `test-results/results/brain-history-fix-chromium-r2-20260717.json` — 1/1;
- Firefox/WebKit isolation:
  `test-results/results/brain-history-fix-firefox-webkit-r4-20260717.json` —
  2/2.

The browser-audit policy and static-boundary unit slice passed **11/11 with 100
assertions**. Both `bunx tsc -p tsconfig.e2e.json --noEmit` and
`bunx tsc -p tsconfig.json --noEmit` passed.

This evidence closes only the reproduced history-boundary defect. It does not
attest immutable source or artifacts, replace the full retry-free 13-project
release run, modify any global interaction/gate count, or close visual,
accessibility, performance, migration, restart/rollback, soak, preview,
zero-defect, or human-sign-off requirements. The operator-authorized live
promotion is an explicit exception and does not satisfy formal release or
cutover approval.

### Local source/artifact digest receipt

`release:attest` now builds and writes an atomic private manifest covering every
non-ephemeral V2 source file, every production artifact, the lockfile, package
manifest, canonical logo, database migrations, Bun executable, Git HEAD, branch,
commit time, origin, and application worktree state. It excludes local secrets,
databases, logs, dependencies, generated test evidence, and runtime artifacts
from the source payload. The strict command exits nonzero when the application
is absent from the pinned revision or dirty; `release:attest:local` may write an
explicitly ineligible diagnostic receipt.

The current diagnostic receipt correctly records
`immutableSourceAttested:false`, `releaseCandidateEligible:false`, and
`signed:false` because the entire V2 application remains untracked at pinned
HEAD. It has three focused unit tests with six assertions. This closes neither
immutable deployment handoff nor release signing; it makes the current blocker
machine-readable instead of hiding it.

### Complete project checkpoints before the final route-generation correction

| Projects | Result | Duration | Report |
|---|---:|---:|---|
| Chromium 1440 + Firefox 1440 | 146/146 | 330,965.128 ms | `test-results/results/full-host-isolated-20260716T135627Z.json` |
| WebKit 1440, official Playwright 1.61.1 Noble image | 73/73 | 242,447.104 ms | `test-results/results/full-webkit-20260716T135917Z.json` |
| iPhone WebKit 390 emulation, official image | 73/73 | 275,851.723 ms | `test-results/results/iphone-full-final2-20260716.json` |
| Enterprise Chromium profile | 73/73 | 130,789.311 ms | `test-results/results/enterprise-full-20260716.json` |

These are real functional checkpoints, but they precede the final
generation-bound route-crawler implementation and compact-plan CSS adjustment.
They remain useful regression evidence, not a claim that all 13 projects passed
the exact final source tree.

### Defects reproduced by matrix expansion

The first compact matrix run scheduled 219 tests and correctly failed:

- 215 passed, four unexpected, zero skipped/flaky;
- direct-plan pointer geometry failed at Android 390, tablet 768, and Chromium
  360;
- Android also exposed late notification-request cancellation;
- report: `test-results/results/full-compact-chromium-20260716T140503Z.json`.

The five additional Chromium viewport run scheduled 365 tests and also correctly
failed:

- 363 passed, two unexpected, zero skipped/flaky;
- Chromium 1280 and 2560 exposed the same notification cancellation;
- report: `test-results/results/chromium-viewports-20260716T140527Z.json`.

These failures were not retried or waived. Compact mission tabs now leave the
sticky layer on small screens, reorder actions use responsive bounded geometry,
and the test dispatches a normal pointer at a center first proven reachable by
`document.elementFromPoint`. All three compact direct-plan journeys subsequently
passed inside `repaired-compact-focused-mouse-20260716T142159Z.json`.

The request tracker now activates a generation at the actual main-document
request, requires both notification query paths for that document, waits for all
bounded V2 requests, and requires a 400 ms quiet boundary. Current-source focused
results are:

| Projects | Result | Duration | Non-SSE aborts | Report |
|---|---:|---:|---:|---|
| Android 390, tablet 768, Chromium 360 | 3/3 | 105,146 ms | 0 | `test-results/results/repaired-route-generation-20260716T142645Z.json` |
| Chromium 1024, 1280, 1920, 2560, 200%-geometry | 5/5 | 166,268.5 ms | 0 | `test-results/results/route-generation-rerun-20260716T142653Z.json` |

Additional exact-source focused browser evidence, all with retries `0`, is:

- Brain, Decisions, and Intelligence operational slice: **168/168** across
  Chromium, Firefox, WebKit, Android Chromium, iPhone WebKit, and tablet
  Chromium;
- Brain-node lifecycle and privacy erasure: **12/12** across the same six
  projects;
- verified artifact delivery and fail-closed reconciliation: **12/12** across
  the same six projects.
- run intervention and recovery: **30/30** across Chromium 1440, Firefox 1440,
  WebKit 1440, Android Chromium 390, iPhone WebKit 390, and tablet Chromium 768.
  The five journeys cover control-plane rejection, exact pause/resume replay,
  cancellation without ghost work, stale replan followed by a bounded replan,
  and reassignment followed by graceful termination. Report:
  `test-results/results/run-intervention-final-six-20260716-1900z-51c9.json`
  (84,446.919 ms, zero unexpected, zero flaky, zero skipped).

The earlier run-intervention diagnostics that exposed an unavailable-runtime
503 and an incomplete reassignment response remain retained as defect-discovery
evidence. They were followed by the clean six-project rerun above rather than
being retried or waived.

The exact command-control repository and runtime suites also prove:

- pause, resume, and cancel use operator-scoped hashed command identities;
- pause/resume command markers commit atomically with the durable run version,
  checkpoint, and event boundary;
- cancellation replays reconcile both post-terminal and preterminal crashes;
- idempotency claims use heartbeat renewal and owner-token fencing;
- provider turns, assignments, continuations, leases, and other live work are
  closed before the terminal zero-in-flight checkpoint.

The focused production set passed **12/12 tests with 105 assertions**. The
broader recovery/control collection passed **47/47 tests with 497 assertions**.

On WebKit, deliberate repeated top-level navigation can surface an engine-level
`/api/v2/... due to access control checks.` page error while aborting a
same-origin document fetch. Product code now aborts query/event work on
`pagehide`. The browser audit recognizes it only inside an explicit navigation
boundary for exact same-page, same-origin GET request identities that were
already active before the top-level navigation. It does not suppress initial-
load, newly started, cross-origin, mutation, console, CORS, or other API
failures. This qualification must remain visible and must not be generalized
into a network-error waiver.

A superseded focused run briefly returned two static-document HTTP 500s while a
separate production build replaced the shared `dist` directory. The frozen-build
rerun preserved server output and recorded no HTTP 500 or internal-error entry.
Release deployment still needs an immutable/atomic artifact handoff so a serving
directory is never rebuilt in place.

## Interaction-manifest accounting

The executable manifest currently contains **489** unique control groups. All
**381** fixture-required groups are assigned to dedicated E2E test IDs in
source; none remains owned only by the generic audit. Of the **108**
non-fixture groups, 83 name a dedicated E2E ID and 26 are intentionally owned by
the bounded initial-state audit; one shell group is intentionally in both sets.
This is an inventory contract, not proof that every grouped option executed in
every browser.

| Measure | Current value | Release requirement |
|---|---:|---:|
| Manifest groups | 489 | Complete audited inventory |
| Fixture-required groups | 381 | Informational |
| Groups assigned to dedicated fixture IDs | 381 | Every material option/state |
| Fixture-required groups still owned only by generic audit | 0 | 0 |
| Static/non-fixture groups | 108 | Complete executable traversal still required |
| Persistent-navigation projects | Archived 479-group crawl: 8 projects; 478 applicable groups; 868/868 controls matched per project | Rerun current 489 groups, then extend proof to material states and every option |
| Compact/reflow projects | Archived 479-group crawl: 5 projects; 479 applicable groups; 582/582 controls matched per project | Rerun current 489 groups, then extend proof to material states and every option |
| Cross-project initial-state result | Archived 479-group crawl: 13/13; 0 missing, 0 unresolved, 0 stale, 0 unexpected/skipped/flaky | Same result for current 489 groups and across all material states/options |
| Nonempty `screenshotsRequired` arrays | 30/489 | Approved mapping for every required visual |

The latest complete initial-state artifact covers the archived 479-group
revision that preceded the current 489-group inventory:
`test-results/results/manifest-current-479-all13-enforced-20260717-r2.json`
(SHA-256
`840616394a5b875c1791315bd6f38eb2ed37099c7c7e3330a1ea1241c73524a7`):
13/13 in 117,245.316 ms, with retries disabled, manifest enforcement and
required-API mode enabled under the development E2E profile, and a BrowserAudit
active before navigation. It
records zero unexpected, skipped, or flaky results and zero missing, unresolved,
or stale groups. The eight persistent-navigation projects each applied 478
groups and matched 868/868 rendered controls; the five compact/reflow projects
each applied 479 groups and matched 582/582.

This is a bounded initial-state manifest crawl only. It does not render every
material hidden, degraded, error, connected-Vault, dialog, or drawer state and
does not activate every grouped option. A checked-in visual registry now maps
**30/489** manifest groups to **13** deterministic Chromium 1440/Linux
baselines; **459** groups remain unmapped and `humanReleaseApproval` remains
`false`. Six baselines cover the connected-Vault lifecycle. Six additional
material screenshots cover minimal Autonomous intake review, structured blocked
recovery, Guided waiting decision, Second Brain canvas/table modes, and targeted
node projection with a sanitized native Obsidian deep link after reload. A
thirteenth baseline covers the complete independent evidence-verification gate
before mutation. The
current 13-baseline registry reverse mapping and file-integrity suite passed
**21/21 with 3,554 assertions**. The earlier five-screenshot focused replay
passed **3/3** in 27,940.205 ms, and its archived registry revision passed
**21/21 with 3,486 assertions**. JSON for that archived run:
`test-results/results/59786-1784264454738.json` (SHA-256
`fc72e41f27b524cb3591825ccc29339bc3f9e95bd394ed764f40fc9a8371ef6c`).
The targeted node projection baseline additionally passed a strict no-update
Chromium-1440 replay **1/1** in
`test-results/results/brain-node-vault-visual-verify-20260717.json` (SHA-256
`e0ae9315f91d791da5b87dcdc0b95cb5cfd57b89a872e827112f96a7442dbcf7`).
This is partial visual evidence, not cross-browser or human visual approval.

The independent evidence-verification baseline passed its strict no-update
Chromium-1440 replay **1/1** in 9,818.544 ms with zero skipped, unexpected, or
flaky results. JSON:
`test-results/results/visual-operational-truth-evidence-verification-verify-20260717.json`
(SHA-256
`60a474e18b001b4bd06fcac7e84c1f048a6575712841e6890fda0e0a35626d65`).

Stable-ID journey, agent, trace, and report record families separately passed
12/12 across Chromium, Firefox, and WebKit in
`test-results/results/dynamic-record-families-three-engine-final-20260717.json`
(SHA-256
`d040c45fdf59d29553a4f202a5646c478ae7f27446afaa0a0c5e990d24f427af`).
The deterministic empty-Brain Inbox path passed 3/3 across those engines in
`test-results/results/brain-global-empty-three-engine-final-20260717.json`
(SHA-256
`be7051a711c630c278c56a221d7f6e0b72da01391b194d8d451306e3409c54aa`).
The generic audit matches route, accessible role, and accessible name; it does
not yet bind every rendered element to `controlId`. Test-ID occurrence also does
not prove assertion-level ownership of every option. Release enforcement remains
an explicit release-profile invocation; current-run option receipts and the
full material-state/browser matrix are not complete.

The archived 888-visited / 636-matched / 252-missing diagnostic belongs to the
old 208-entry manifest and is not a current denominator. Dedicated fixture IDs
still need complete
assertion-level option ownership, keyboard, refresh/reconnect, error, visual,
and full browser-matrix proof.

## Legacy compatibility evidence

Before the operator-authorized live-surface compatibility mirror, the legacy
application's latest complete baseline was **644/644** aggregate tests:

- `bun run check`: exit 0; server entry bundle 71 modules;
  server/client TypeScript checks passed; **593/593 tests**, 2,138 assertions,
  72 files; production Vite build 66 modules in 2.47 seconds;
- OpenRouter portable integration: **34/34**, zero failures;
- Mission Board MCP portable integration: **17/17**, zero failures.

The legacy server/client type checks and production build also passed.

The historical legacy log is
`/tmp/legacy-check-obsidian-final-20260717T0356Z.log`
(SHA-256
`a5745e95537666b4c28ceed370f5c845b0c4bbc700d65257228ad1f50c1f15cd`).
The operator subsequently authorized the identical Recovery Panel terminal-
refresh fix to be mirrored into `plugin/webapp`, because systemd serves that
live surface. The legacy source diff is therefore intentionally nonempty. A
fresh post-mirror `bun run check` passed: server entry bundle **305 modules**;
server, client, and E2E TypeScript green; **1,182/1,182 Bun tests** with 7,069
expect calls across 162 files; **34/34** OpenRouter portable tests; **17/17** Board
MCP tests; and a **142-module** production build in 2.66 seconds. This is
**1,233/1,233 aggregate tests**. The interactive receipt is current, but an
immutable run log still needs to be archived for release candidacy.

The served webapp's `/missions/new/autonomous` route previously used the stale
free-form contract page. `AutonomousContractPage` now delegates to
`RegistryMissionIntakePage` with `journey="autonomous"`, matching the registry-
backed Guided intake boundary. The package gate above proves compilation and
unit/integration compatibility; focused browser acceptance of the Autonomous
registry checklist and launch path remains pending.

Both `public/Logo.svg` files currently hash to
`0a3dfd69f74a00d41bb0cb20d6af1097dffa265d4c1e54c9228fe4b55f85c955`.
This is a source/build regression baseline. A final candidate must rerun the
protected legacy browser journeys and concurrent legacy/V2 resource-isolation
benchmarks after all shared/backend changes are frozen.

## Active Obsidian Vault evidence

The live schema-14 V2 preview service has one real, sandboxed Vault connection:
`ChillsPwn Second Brain` at
`/var/lib/chillspwn/brain-vaults/ChillsPwn-Brain` (connection
`vault_b1bfa728-3271-4ad1-8e4a-220096e56a73`). The current verified readback
reports **64,697 tracked Vault notes** and **zero conflicts**. The canonical V2
database contains **73,523 memory nodes** and **73,431 memory edges**. A real
filesystem write/read/rename/delete round trip is green, left no health residue,
and did not change `.obsidian`. Full receipts and historical screenshots are
recorded in
[obsidian-vault-connection-evidence.md](obsidian-vault-connection-evidence.md).
The 05:48 UTC rendered capture below records the earlier three-projection/five-
Context-Pack bootstrap state and is retained as historical evidence, not current
Vault cardinality:
`docs/command-os-v2/evidence/obsidian-vault-live-20260717.png` (SHA-256
`9006445488e2c73f126f382d15d8839b70081dadb615fe3de378d3d29aeea77e`).

The earlier schema-2.1 projector snapshot exposed one unresolved link from a
verified run evaluation to a candidate lesson excluded by projection policy.
The schema-14 V2.4 implementation has an exact regression for that record pair,
enforces live lifecycle and connection scope on links, preserves existing
compact sync-state paths, and creates the complete V2.4 taxonomy for new notes.
Persisted paths and managed headings,
aliases, and relationship explanations also reject or encode Markdown/control
delimiters so imported filenames or memory text cannot inject links,
relationship markers, comments, or lines. The current standalone package gate
passes **723/723** with 10,637 assertions, plus
browser/server and E2E TypeScript checks, logo/isolation checks, and the
production build, while the hardened
Vault lifecycle passes **18/18** retry-free browser journeys, six each in
Chromium, Firefox, and WebKit. Candidate base `66c7f176a7cf` is running on V2
preview port `3132` with the connected `ChillsPwn-Brain` Vault; the legacy
application remains the working service on port `3131`. The exact current
preview source is recorded by its immutable deployment manifest; the later
test/audit receipts in this document do not themselves claim formal release
approval. Complete matrix, visual approval, soak, and cutover evidence remain
open.

The mounted repair/reindex journey first exposed and closed a React Strict Mode
query-cache suspension defect. Subsequent adversarial review drove durable
intent/reconciliation, no-follow path and content revalidation, exact-byte
quarantine copies, duplicate-ID detachment, bounded FTS refresh, and explicit
offline/permission/concurrent-change diagnoses. The replacement six-journey
suite is the 18/18 three-engine result above.

The final combined strict Chromium run also executed all six accumulated
`brain-vault.spec.ts` material-state journeys together: round-trip connection
and reload, bounded path denial and safe retry, projection export/import/sync/
download, concurrent conflict resolution, repair/reindex with symlink and
offline fail-closed behavior, and degraded-connection recovery. All six passed
inside the complete Chromium project. This is browser evidence against a
disposable V2 fixture service. The committed `66c7f176a7cf` schema-14 preview
application and connected Vault are deployed on port `3132` under a separate
verified backup boundary; these fixture journeys still do not prove native
Obsidian desktop activation on this headless host.

The isolated standalone process boundary now has focused restart/Vault
persistence evidence in
`server/app/__tests__/StandaloneProcessRestart.test.ts`: **1/1 test with 44
assertions** via `bun run test:process-restart`. A first standalone V2 child used
a random loopback port and unique database, Vault, and script roots, authenticated
through the supported session API, created a real Guided Mission and Context
Pack, passed the Vault filesystem round trip, connected the Vault, and exported
an actual Markdown note. The fixture then persisted an expired lease, one
non-repeatable in-flight action, and a checkpoint before sending `SIGKILL`.
The restarted standalone process used the same database/Vault and the guarded
test-only runtime startup path. Before accepting traffic it classified the
unknown-completion, non-idempotent action `review_required`, blocked the run,
cleared the stale lease, and created exactly one recovery event/outbox/checkpoint
without duplicating the action or any prior event/outbox record. The Context
Pack remained readable, the Vault remained `connected`, its sync state was
preserved, and the projected Markdown bytes were unchanged. The protected
legacy `GET /api/health` remained `status: ok` before and after; cleanup left no
orphan V2 child and no `process-restart-*` temporary root. The test-only runtime
is enabled only for a database below the disposable E2E root plus an explicit
fixture run ID; it is not a production executor claim. Long-running concurrent
sync, native-desktop activation, protected-live dangling-link reconciliation,
the remaining restart matrix, and release soak remain open.

## Brain runtime and mutation-authority evidence

The local V2.4 runtime now has a typed 13-point `BrainContextService` hook
registry, canonical scope/journey/control-plane checks, bounded sensitivity and
context policies, explicit required-versus-degraded behavior, persisted empty
packs, and hash-chained coverage receipts. Mission intake, terminal reporting,
and Guided material-result phase-transition refreshes are integrated with
persisted Context Packs. Focused Brain/Guided checks pass **17/17**; the broad
Brain, memory, and Guided collection passes **62/62 with 567 assertions**.
Provider-backed production execution and all-agent lifecycle proof remain open.

A static mutation-authority source of truth inventories **75 unique** V2
mutation routes and **89 Express declarations**, including 14 explicit
runtime/fail-closed alternatives. It fails for unclassified, stale, duplicated,
unresolved, or moved declarations and records auth, CSRF, idempotency,
concurrency, ownership, and control-plane classification. Validation passes
**5/5 with 772 assertions**. Seven formerly policy-scoped routes are now proven:
deterministic metrics recomputation is V2-ownership-fenced, while plan
proposal/edit/apply/reject and attack-attempt create/transition are
lease-fenced through a trusted server callback. Missing, expired, wrong-token,
wrong-fence, legacy-owned, and valid-V2 cases are covered, and replay is
reauthorized before lookup. The guarded plan/intelligence/application slice
passes **29/29 with 1,066 assertions**; Chromium browser plan activation,
rejection, strict retry, and direct proposal/edit flows pass **6/6**. The audit
now exposes exactly **four** policy-scoped control-plane gaps: Autonomous-branch
preflight, Autonomous-branch creation, bulk mission archive, and run follow-up
creation. It does not present inventory as complete enforcement.

## Open release gates

The strict release-profile Chromium progression is preserved rather than
overwriting negative evidence:

| Run | Expected passes | Unexpected failures | Did not run/skipped | Flaky | Duration | SHA-256 |
|---|---:|---:|---:|---:|---:|---|
| Initial | 139 | 19 | 22 | 0 | 622.8 s | `355322984a4341ac3af5579c6de3e85476a994aa1ea16f745f9447f401e5fcf2` |
| r2 | 160 | 12 | 8 | 0 | 583,977.809 ms | `69af028860715f4acc352ccc50a977fab78bdcef9cbe2bba5bddaf3031feb4a8` |
| r3 | 175 | 3 | 2 | 0 | 602,699.813 ms | `3fb5732651b8e728a43d2cb96223df1058a9379209e8ec512eec6206112dc110` |
| r4 | **180** | **0** | **0** | **0** | **601,955.963 ms** | `c59afe69238d71aac7619dba91feb9c21dbdd685c22096943f52e2fe3f622e8a` |

The final artifact is
`test-results/results/release-current-chromium1440-20260717-r4.json`. It is a
complete **180/180** one-worker `chromium-1440` pass under the strict managed-
static release profile with retries disabled, required-API and manifest
enforcement, zero unexpected results, zero skipped tests, and zero flaky
classifications. It includes the six accumulated Brain Vault material-state
tests described above. The r2 and r3 artifacts remain negative evidence of the
repair progression at
`test-results/results/release-current-chromium1440-20260717-r2.json` and
`test-results/results/release-current-chromium1440-20260717-r3.json`.

This closes the combined Chromium-project defect gate only. It is not a full
13-project release matrix, immutable signed release attestation, broad visual
approval, soak/preview evidence, or human release approval.

Cutover remains blocked by all of the following:

- the archived 479-group bounded initial-state crawl is green across all 13
  configured projects; the current 489-group revision still needs the same
  all-project crawl, and assertion-level every-option receipts plus material
  hidden, degraded, error, dialog, drawer, and connected-Vault states remain
  incomplete;
- the 390/390 route/href crawl is green across all 13 configured projects for
  29 static routes plus the generated internal href contract per project, but
  dynamic imported, archived, blocked, and evidence-reconciliation states and
  all 489 material interactions remain outside that representative crawl;
- the exact final source has completed the strict retry-free Chromium 1440
  project, but has not completed the corresponding full 13-project matrix;
- required-API enforcement is not yet enabled uniformly for every release
  journey, so focused zero-failure evidence is not a global network claim;
- enterprise Chromium emulation is not actual Microsoft Edge proof;
- the 200% project proves reflow geometry, not native browser-chrome zoom;
- only 30/489 manifest groups map to 13 Chromium baselines; 459 remain
  unmapped, and cross-browser baselines and human visual approval remain absent;
- the current direct-preload axe gate passed 84/84 across Chromium, Firefox,
  and WebKit for 12 primary and 16 material states plus its transport canary;
  the archived pre-direct-transport matrix passed 81/81 and remains historical.
  The evidence retains gradient/ARIA manual-review determinations and does not
  complete mobile, native-zoom, focus-order, screen-reader, or assistive-
  technology approval;
- field Web Vitals, browser-rendered large-graph frame-rate/cancellation, large
  Vault sync, concurrent legacy/V2 resource budgets, and long-session memory
  measurements remain open. Canonical 50,000-node FTS search (2.1 ms p95),
  local expansion (90.2 ms p95), and progressive shell selection (147.7 ms)
  are now measured; these are server/query results, not browser-rendering proof;
- success-path trace/video/network archives and copy/alignment approval are
  incomplete;
- the Higgsfield production-asset workflow remains blocked on external OAuth;
- the full production execution adapter, all-agent Brain lifecycle proof,
  migration reconciliation, restart/rollback rehearsal, 72-hour soak, seven-day
  preview, zero-defect review, and explicit human sign-off remain incomplete.

Accordingly, the evidence supports continued validation, not formal gate
completion. The operator-authorized live promotion and compatibility mirror do
not waive the remaining cutover, rollback, soak, visual, accessibility, or
human-sign-off requirements.

## Autonomous exact full-TCP capability — 2026-07-18

The ReaperTwo full-port software blocker now has a narrow fail-closed path in
source. Every ordinary or direct Nmap request remains capped at 1,024 selected
ports. Only the canonical V2 runtime adapter can issue a one-use exception for
the exact `pentest-mcp-recon.nmapScan` TCP Connect selection covering ports
1–65,535 after final action, scope, plan, assignment, contract, specialist,
non-destructive-policy, target, arguments, and finite-budget validation.

Issuance and consumption use deterministic, hash-chained `audit_records` bound
to the exact Autonomous mission/run/journey. They are serialized with
`BEGIN IMMEDIATE`; existing immutable audit triggers reject UPDATE and DELETE.
The bridge atomically re-reads canonical authority and consumes the exact claim
before applying the narrow port-cap exception. No capability is stored in the
mutable settings table.

Recorded validation:

- webapp TypeScript: pass (`bunx tsc --noEmit`);
- Command OS V2 TypeScript: pass (`bunx tsc --noEmit`);
- runtime/coordinator/Guided approval/full-TCP policy/bridge/mission focused
  regression: **125/125 passed, 0 failed, 894 assertions**;
- focused MCP policy/bridge/claim slice: **41/41 passed, 0 failed,
  206 assertions**;
- V2 mission and intake default/budget propagation slice: **28/28 passed,
  0 failed, 160 assertions**.

Negative evidence covers direct and forged calls, absent durable verifier,
changed arguments and target scope, forged runtime actor/envelope, stale plan
and contract, Guided journey, legacy control plane, missing/changed/exhausted
finite budgets, duplicate issuance, UPDATE/DELETE attempts, concurrent
two-connection consumption, and replay. The positive runtime integration uses
a local MCP fixture only; it performs no target connection.

This is not live promotion evidence. No target command, trusted-tool install,
service restart, database mutation, deployment, or port change was performed.
The release gate remains closed pending root-controlled trusted Nmap staging,
a fresh no-engagement-target live canary, and the broader release gates already
listed above. Pre-existing runs without a signed finite tool-call budget remain
ineligible and must not be silently grandfathered.
