# Command OS V2.4 browser test matrix

Status: **current-source archived static gates and focused implementation checkpoints — not release complete**
Evidence date: `2026-07-17` UTC.

The Playwright configuration declares 13 retry-free projects. Current archived
gates now cover the rendered static/initial manifest state and the complete
static-route/generated-href contract in every configured project. A separate
bounded accessibility gate covers Chromium, Firefox, and WebKit. These are
current-source checkpoints, but the exact final source has not yet passed one
complete all-spec 13-project release run.

## Latest archived cross-project gates

| Gate | Projects and result | Duration | Archived report |
|---|---|---:|---|
| Rendered manifest/static initial state | **13/13** configured projects; 0 unexpected, skipped, or flaky; retries 0 | **119,691.24 ms** | `test-results/results/manifest-current-authority-brain-static-restart-20260717.json` (SHA-256 `0ce34a6fc091d29a5f12ce0f70d69295a729964e835c5ddb998ed233b3d3b21e`) |
| Static routes and generated internal hrefs | **390/390** tests: 30 per project across all 13 projects; 0 unexpected, skipped, or flaky; retries 0 | **406,441.99 ms** | `test-results/results/route-href-crawl-current-20260717.json` (SHA-256 `7f80e40eecdcc4679f5cdffa5f5832fb3c67630dc9370dd0f6bf744b0e1c5493`) |
| Bounded automated accessibility | **81/81** tests across Chromium, Firefox, and WebKit; **84 axe scans**, 0 automated A/AA violations, 0 unexpected, skipped, or flaky; retries 0 | **115,689.921 ms** | `test-results/results/axe-expanded-all3-20260717-r1.json` (SHA-256 `aec4b7adbf9a3ac73dae22bcfb6b86c33954a789c65e182b8dca68c7059cbf22`) |

The manifest report proves rendered-control accounting only in the crawler's
bounded initial state. The route report proves the 29 static/alias route cases
and one generated-href crawl in each project. Neither opens every material
dialog, drawer, menu, degraded/error/recovery state, or activates every grouped
option. The accessibility report covers 12 primary initial states and 16
bounded material states on the three desktop engines; it retains 84 gradient
contrast and 15 ARIA-support determinations for manual review. It is not mobile,
native-zoom, screen-reader, or manual assistive-technology certification.

## Project matrix

| Project | Engine/profile | Viewport | Executed evidence | Current disposition |
|---|---|---:|---|---|
| `chromium-1440` | Playwright Chromium | 1440×900 | Current manifest 1/1; route/href 30/30; bounded accessibility 27/27 | All three current gates pass; complete all-spec release run remains open. |
| `firefox-1440` | Playwright Firefox | 1440×900 | Current manifest 1/1; route/href 30/30; bounded accessibility 27/27 | Firefox is installed and directly runnable; complete all-spec release run remains open. |
| `webkit-1440` | Playwright WebKit | 1440×900 | Current manifest 1/1; route/href 30/30; bounded accessibility 27/27 | Host WebKit uses environment-only compatibility libraries; complete all-spec release run remains open. |
| `chromium-enterprise-1440` | Chromium enterprise emulation | 1440×900 | Current manifest 1/1; route/href 30/30 | Current static gates pass; this is not an actual Microsoft Edge binary/profile. |
| `android-chromium-390` | Chromium mobile/touch emulation | 390×844 | Current manifest 1/1; route/href 30/30 | Current static gates pass; bounded accessibility did not include this project and physical Android remains untested. |
| `iphone-webkit-390` | WebKit mobile/touch emulation | 390×844 | Current manifest 1/1; route/href 30/30 | Current static gates pass; bounded accessibility did not include this project and physical iPhone remains untested. |
| `tablet-chromium-768` | Chromium mobile/touch emulation | 768×1024 | Current manifest 1/1; route/href 30/30 | Current static gates pass; complete material-state and accessibility execution remains open. |
| `chromium-360` | Chromium compact/touch emulation | 360×800 | Current manifest 1/1; route/href 30/30 | Current static gates pass; complete material-state and accessibility execution remains open. |
| `chromium-1024` | Chromium desktop | 1024×768 | Current manifest 1/1; route/href 30/30 | Current static gates pass; complete material-state execution remains open. |
| `chromium-1280` | Chromium desktop | 1280×800 | Current manifest 1/1; route/href 30/30 | Current static gates pass; complete material-state execution remains open. |
| `chromium-1920` | Chromium desktop | 1920×1080 | Current manifest 1/1; route/href 30/30 | Current static gates pass; complete material-state execution remains open. |
| `chromium-2560` | Chromium desktop | 2560×1440 | Current manifest 1/1; route/href 30/30 | Current static gates pass; complete material-state execution remains open. |
| `chromium-200-percent-zoom` | Chromium geometry emulation | 720×450 CSS at DPR 2 | Current manifest 1/1; route/href 30/30 | Current static gates pass; this models reflow and is not native browser-chrome zoom. |

Full-run reports:

- Chromium 1440 + Firefox 1440: `full-host-isolated-20260716T135627Z.json`, 146/146;
- WebKit 1440: `full-webkit-20260716T135917Z.json`, 73/73;
- iPhone WebKit: `iphone-full-final2-20260716.json`, 73/73;
- enterprise Chromium: `enterprise-full-20260716.json`, 73/73;
- compact diagnostic: `full-compact-chromium-20260716T140503Z.json`, 215/219;
- additional viewports diagnostic: `chromium-viewports-20260716T140527Z.json`, 363/365.

Current-source repair reports:

- compact direct-plan controls: all three direct-plan tests passed within
  `repaired-compact-focused-mouse-20260716T142159Z.json`;
- compact route generation: `repaired-route-generation-20260716T142645Z.json`,
  3/3 with zero non-SSE aborts;
- additional Chromium routes: `route-generation-rerun-20260716T142653Z.json`,
  5/5 with zero non-SSE aborts.

Additional focused exact-source slices, all retry-free, passed Brain, Decisions,
and Intelligence **168/168**, Brain-node lifecycle **12/12**, and verified
artifact delivery **12/12** across Chromium, Firefox, WebKit, Android Chromium,
iPhone WebKit, and tablet Chromium.

The final exact-source run intervention/recovery matrix passed **30/30** across
those same six projects. Each project exercised control-plane rejection, exact
pause/resume replay, cancel-without-ghost-work, stale replan followed by bounded
replan, and reassignment followed by graceful termination. The retry-free JSON
report is
`test-results/results/run-intervention-final-six-20260716-1900z-51c9.json`:
30 expected, zero unexpected, zero flaky, zero skipped, 84,446.919 ms.

This clean run follows and does not erase earlier diagnostics that found an
unavailable-runtime 503 and a missing replacement assignment ID. Those defects
were fixed and the complete six-project slice was rerun against a unique V2
database.

## Shared runner contract

The development runner enforces:

- `fullyParallel: true`, `forbidOnly: true`, and retries `0`;
- run-specific HTML, JSON, trace/video/screenshot, database, auth, artifact, and
  server namespaces;
- locale `en-US`, UTC, dark mode, and declared reduced-motion state;
- real local-session setup against the V2 API;
- screenshots only on failure and trace/video retained on failure;
- an optional external-server mode used to pin one immutable production build,
  one origin, and one isolated database for a run;
- required-network mode that rejects unexpected V2 failures;
- a 300,000 ms projection interval for deterministic browser fixtures without
  disabling the real projector.

The runner now has an exact `release` profile in addition to development and
explicit degraded profiles. Release mode refuses to start unless required API
auditing and manifest enforcement both equal `1`, server mode is
`playwright-managed-static`, external servers equal `false`, and UI/API use one
credential-free loopback HTTP origin. It builds once, starts one V2 process that
serves the production `dist` and `/api/v2` on that origin, disables server reuse,
uses one worker, and keeps retries at zero. The JSON report embeds an immutable
negative attestation: `immutableSourceAttested: false` and
`releaseCandidateEligible: false`. This local profile prevents a split Vite/API
development run from being mislabeled as release evidence; it does not attest
an immutable source/build or satisfy soak, preview, rollback, or human approval.

The first managed-static smoke used the same-origin release contract on an
isolated loopback port and passed the Overview route **1/1** in 5.7 seconds. Its
retry-free report is
`test-results/results/release-static-smoke-20260716.json`; metadata records one
worker, strict API/manifest enforcement, managed-static mode, and the ineligible
local attestation above. A full 13-project run in this profile remains required.

The release profile deliberately overrides development parallelism with
`fullyParallel: false` and one worker so one managed production-static process,
one database, and one event sequence define the entire run.

### Exact browser-lifecycle audit

The current audit no longer grants popup, download, direct-request, or document
teardown exceptions from broad URL or timing patterns. It requires:

- a prospective popup declaration bound to the opener, exact URL, popup page,
  and initial request identity;
- a prospective download declaration bound to the page plus the exact
  Playwright `Download` identity, canonical API path or generated filename, and
  verified result;
- exact IDs and same-origin receipts for every direct audited API request;
- a sealed finalization boundary that rejects late work and waits only a bounded
  100–1000 ms for already-started requests before recording a hung-request
  defect;
- exact pre-navigation request identities for document teardown, and exact
  page/URL lifecycle receipts for EventSource close and page close.

Positive and self-failing negative canaries pass **18/18** across Chromium,
Firefox, and WebKit. Impacted verified artifact downloads, generated mission
exports, CVE source popups, and System contract popups pass **12/12** across the
same engines. Unit policy/ledger/AST checks pass **18/18 with 134 assertions**;
the static boundary follows aliases, assignments, destructuring, and same-file
helper parameters. Evidence:
`browser-audit-p1-canaries-r3-chromium-20260716.json`,
`browser-audit-p1-canaries-r3-crossbrowser-20260716.json`, and
`browser-audit-p1-impacted-r2-20260716.json`.

#### Verified artifact-download identity repair

The Chromium 1440 failure in
`test-results/results/release-local-all13-final-20260716.json` was reproduced
without a retry in
`test-results/results/artifact-download-request-identity-repro-20260717.json`.
Its preserved trace records the exact Playwright `Download` event for the
native `<a download>` transfer but no Playwright `Request` or network-resource
identity for the attachment. The original trace remains at
`test-results/playwright/release-local-all13-final-20260716/artifact-delivery-e2e-inte-d6369-rowser-attachment-and-audit-chromium-1440/trace.zip`;
the isolated reproduction trace remains under the matching
`artifact-download-request-identity-repro-20260717` Playwright run directory.

The repaired receipt keeps two explicit identity modes. Firefox exposes and
requires the prospective page, exact navigation `Request`, exact `Download`
object, and exact canonical origin/path (`request-and-download`). Chromium and
WebKit do not expose that request for this native transfer, so they require the
prospective page, exact `Download` object, and exact canonical origin/path and
record `download-event` plus `requestIdentityUnavailable: true`. The artifact
journey additionally proves the exact suggested filename, retained bytes, byte
length, and SHA-256. The download-event mode cannot authorize a failed request,
HTTP response, or EventSource cancellation; all such exceptions still require
the exact Playwright `Request` identity.

The exact managed-static release-profile rerun passed **9/9** across Chromium
1440, Firefox 1440, and WebKit 1440 with retries disabled: three verified
artifact deliveries, three successful undeclared-download negative canaries,
and three successful same-exact-URL/wrong-page negative canaries. The latter
uses the real authenticated artifact endpoint and requires a completed browser
download, proving that URL equality cannot replace page-bound authority. The
report is
`test-results/results/artifact-download-release-plus-canaries-final-20260717.json`
(nine expected; zero unexpected, flaky, or skipped; 16,744.401 ms). The focused
E2E TypeScript check passed, and the browser-audit policy/static-boundary unit
slice passed **11/11 with 99 assertions**.

This focused repair closes only the reproduced artifact-download audit defect.
It does not change the incomplete full-matrix, immutable-source, visual,
accessibility, soak, preview, rollback, or human-approval gates below and does
not authorize release or cutover.

#### Strict history-traversal boundary repair

The Chromium 1440 `brain-graph` deep-link/history failure in
`test-results/results/release-local-all13-final-20260716.json` was reproduced
without a retry in
`test-results/results/brain-history-repro-20260717.json`. The failed operation
was a real SPA history traversal: `history.pushState`/`popstate` changed the
main-frame URL without issuing a top-level document request. Treating every
`page.goBack()` or `page.goForward()` as a document navigation made the audit
reject valid product history behavior.

The repaired audit has a distinct history-traversal boundary. A traversal must
produce either an exact main-frame document `Request` or an observed main-frame
URL transition. Only the exact document-request receipt authorizes teardown of
an exact request identity that was already active when that boundary opened. A
URL-only SPA/BFCache receipt authorizes no request-failure waiver. Firefox's
old-document EventSource abort may arrive immediately before its same-URL
document request; the audit stages only the exact pre-boundary `Request` object
and accepts it only after that same boundary observes the document request.

Static negative canaries reject all three boundary inversions:

- `history.pushState` followed by `goBack()` inside a document-navigation
  teardown boundary;
- `goForward()` inside a document-navigation teardown boundary;
- `reload()` inside a history-traversal boundary.

The policy unit also proves that a same-document URL receipt cannot grant
teardown authority. A repository scan reports **zero** remaining
`goBack()`/`goForward()` calls wrapped by the document-navigation teardown
boundary; all 12 audited history wrappers use the dedicated boundary.

The final retry-free managed-static focused matrix passed **24/24**: eight
affected history journeys on Chromium 1440, Firefox 1440, and WebKit 1440. Its
JSON report is
`test-results/results/history-boundary-focused-crossbrowser-r2-20260717.json`
(24 expected; zero unexpected, flaky, or skipped; 137,214.672 ms), with HTML at
`test-results/html/history-boundary-focused-crossbrowser-r2-20260717/`.
Engine-isolation receipts are also retained at
`test-results/results/brain-history-fix-chromium-r2-20260717.json` (1/1) and
`test-results/results/brain-history-fix-firefox-webkit-r4-20260717.json` (2/2).
The browser-audit policy/static-boundary unit slice passed **11/11 with 100
assertions**. Both `bunx tsc -p tsconfig.e2e.json --noEmit` and
`bunx tsc -p tsconfig.json --noEmit` passed.

This is focused defect-closure evidence. It does not alter the local release
profile's `immutableSourceAttested: false` or
`releaseCandidateEligible: false` receipt, replace the complete retry-free
13-project run, or close any visual, accessibility, performance, migration,
restart/rollback, soak, preview, zero-defect, or human-sign-off gate below.

Repeated top-level navigation on WebKit may report a same-origin document-fetch
teardown as `/api/v2/... due to access control checks.` even after product
queries and the event stream are explicitly cancelled on `pagehide`. The audit
accepts this only inside an explicit top-level-navigation boundary and only for
same-page, same-origin GET request identities already in flight before that
navigation. Initial-load, newly started, cross-origin, mutation, console, CORS,
and all other API failures remain unexpected. This is a documented engine
qualification, not a general network-error exclusion.

## Current route and request contract

The route file contains 29 static/alias cases plus one generated-href crawl. It
checks document status, named main content, route recognition, horizontal
overflow, internal href validity, direct navigation, browser errors, and required
network behavior.

The latest request tracker does not permit notification aborts. It binds one
generation to the actual main-document request, observes both notification
queries for that document, waits for every bounded API request, and requires a
400 ms quiet boundary. The current archived route/href crawl passed **390/390**
across all 13 configured projects in 406,441.99 ms, with retries disabled and
zero unexpected, skipped, or flaky results:
`test-results/results/route-href-crawl-current-20260717.json` (SHA-256
`7f80e40eecdcc4679f5cdffa5f5832fb3c67630dc9370dd0f6bf744b0e1c5493`).
This is static-route and generated-href proof, not dynamic material-state,
every-option, or complete all-spec release execution.

## Interaction coverage

The current source inventory reports:

| Measure | Value |
|---|---:|
| Manifest groups | 479 |
| Fixture-required groups | 371 |
| Dedicated source test-ID assignments | 371 |
| Fixture-required groups still owned only by generic audit | 0 |
| Static/non-fixture groups | 108 |
| Latest complete enforced rendered-control crawl | Current 479-group inventory: 13/13 projects; persistent 478 applicable and 868/868 controls; compact/reflow 479 applicable and 582/582 controls; 0 missing, 0 unresolved, 0 stale |

The latest complete report covers the current 479-group inventory:
`test-results/results/manifest-current-authority-brain-static-restart-20260717.json`
(SHA-256
`0ce34a6fc091d29a5f12ce0f70d69295a729964e835c5ddb998ed233b3d3b21e`):
**13/13 in 119,691.24 ms**, with retries disabled and zero skipped, flaky, or
unexpected results. It ran under the development E2E profile with strict
manifest and required-API enforcement, so it is not a release-profile run. The
eight persistent-navigation projects each applied 478
groups and matched 868/868 rendered controls; the five compact/reflow projects
each applied all 479 groups and matched 582/582. Missing, unresolved, and stale
counts were all zero.

This artifact proves only the bounded rendered initial state exercised by the
manifest crawler. It is not material-state or every-option execution proof: it
does not open every dialog/drawer or traverse every hidden, degraded, error,
connected-Vault, and fixture-only operational state. The visual registry maps
only 15/479 manifest groups to 11 Chromium-1440/Linux baselines; 464 remain
unmapped, cross-browser and mobile visual approval is incomplete, and human
release approval remains false.

The archived 888/636/252 crawl belongs to the old 208-entry manifest and is not
a current denominator. The release requirement remains zero missing,
unresolved, and stale groups with enforcement enabled. Every option also needs
assertion-level ownership, keyboard/pointer behavior, refresh/reconnect
persistence, error states, and an approved visual mapping.

The stable-ID dynamic journey, agent, trace, and report families separately
passed 12/12 across Chromium, Firefox, and WebKit in
`test-results/results/dynamic-record-families-three-engine-final-20260717.json`
(SHA-256
`d040c45fdf59d29553a4f202a5646c478ae7f27446afaa0a0c5e990d24f427af`).
The canonical empty-Brain Inbox route passed 3/3 across the same engines in
`test-results/results/brain-global-empty-three-engine-final-20260717.json`
(SHA-256
`be7051a711c630c278c56a221d7f6e0b72da01391b194d8d451306e3409c54aa`).

The current-source isolated Vault lifecycle passed all 18 engine-duplicated
focused journeys across Chromium, Firefox, and WebKit: six per engine with
retries disabled. This includes exact portable-ZIP delivery,
import/export/sync, both conflict resolutions, degraded health recovery,
repair/reindex, hardened malformed/duplicate/symlink/concurrent/permission/
offline boundaries, and reload persistence. Reports:
`vault-chromium-20260717-r4.json`, `vault-firefox-20260717-r2.json`, and
`vault-webkit-20260717-r2.json`. A process-kill restart harness, long-running
concurrent sync, protected-live link reconciliation, and installed-native
Obsidian activation remain open.

## Engine and environment qualifications

Firefox is installed and directly runnable. WebKit is now runnable on this host
using environment-only Ubuntu Noble compatibility libraries for Playwright's
GTK/WPE runtime; no repository source or application dependency was changed.
The official Playwright image remains a reproducible fallback. A complete
final-source WebKit release run is still required.

The enterprise project uses Chromium with a controlled user agent and cannot be
substituted for actual Edge certification. Mobile projects emulate viewport,
touch, and device scale; they are not physical-device proof. The zoom project
tests observable reflow geometry but not native headed browser zoom or assistive
technology.

## Release matrix still required

Before release candidacy:

1. freeze the exact source/build and run all 13 projects without retries;
2. enable strict required-network and interaction-manifest enforcement;
3. expand the green current 479-entry initial-state crawl and close every
   material-state and assertion-level option-receipt gap;
4. add actual Edge proof if retained as a support target;
5. extend the green 81/81 bounded desktop-engine accessibility gate to mobile
   material states, native 200% zoom, focus-order and screen-reader assertions,
   manual incomplete-item resolution, and assistive-technology review;
6. approve success-path visual baselines across all required states/viewports;
7. crawl imported, archived, blocked, missing, quarantined, offline,
   reconnecting, and expired-session states;
8. run large event/evidence/graph/Vault, Web Vitals, memory-leak, and concurrent
   legacy/V2 resource tests;
9. rerun protected legacy browser journeys;
10. archive success-path screenshots, traces, videos, network logs, coverage,
    complete visual/copy and accessibility approval, 72-hour soak, seven-day
    preview, and human sign-off.

No current browser artifact authorizes cutover.
