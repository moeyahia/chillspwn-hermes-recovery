# V2 route and internal-link crawl

Status: retry-free Chromium, Firefox, and WebKit route
checkpoints have passed on 2026-07-16. Dynamic-state completeness and the full
release browser matrix remain open.

The route contract contains 29 static routes/aliases and nine dynamic resource
patterns. The browser suite verifies that every static route returns the V2
document, renders a named main surface, avoids the V2 not-found view, emits no
unexpected browser/network error, and has no unplanned horizontal overflow.

The generated-link audit visits every static surface, inventories every
rendered `href`, rejects empty/`undefined`/`null` links, rejects internal paths
outside the route contract, then directly navigates every generated internal
route. A document must resolve as HTTP 200 or a cache-valid 304, render a named
main surface, and avoid the Command OS not-found view. The crawl attachment is
`generated-internal-href-crawl.json` in the Playwright result.

## Executed checkpoints

- Chromium 1440: the complete 30-case route file passed as part of the
  retry-free required-network browser checkpoint;
- Firefox 1440 against the development server: 30/30 passed;
- Firefox 1440 against the production build: 30/30 passed;
- WebKit 1440 in the official Playwright 1.61.1 Noble image: 30/30 passed.

Each route file contains 29 static/alias cases plus one generated-href crawl.
Retries were disabled. The crawl has an explicit 120-second wall-clock bound
because it serially navigates every static surface and every discovered internal
link; individual assertions remain strict.

Firefox is installed and directly runnable. WebKit is now runnable on the host
through environment-only Ubuntu Noble compatibility libraries, with the
official Playwright container retained as a reproducible fallback. No
repository source or application dependency changed for this host setup. An
actual Microsoft Edge run is still not represented by the
enterprise-Chromium emulation project.

A strict iPhone full run first reached 72/73 and exposed a generated-link
crawler race: WebKit cancelled a real Evidence-detail request when the crawler
navigated away. A fresh isolated rerun passed 73/73 in 275,851.723 ms, with zero
skips, unexpected results, flaky results, or retries. Its report is
`test-results/results/iphone-full-final2-20260716.json`.

Later retry-free matrix expansion reproduced a second, narrower race in
notification queries: compact Chromium failed four of 219 tests and the five
additional Chromium viewports failed two of 365 tests because navigation
cancelled a notification-list/unread-count pair. The crawler now activates its
request generation only when the corresponding main-document request actually
begins, requires both shell query paths for that document, waits for all bounded
V2 requests, and then requires a 400 ms quiet boundary. It does not allowlist
notification cancellations; only the long-lived SSE teardown remains an
explicit navigation cancellation.

Current-source focused proof after that correction is:

- Android 390, tablet 768, and Chromium 360: 3/3 generated-href crawls passed
  in 105,146 ms, with no non-SSE abort, HTTP 500, retry, skip, unexpected, or
  flaky result. Report:
  `test-results/results/repaired-route-generation-20260716T142645Z.json`.
- Chromium 1024, 1280, 1920, 2560, and the 200%-geometry project: 5/5 passed
  in 166,268.5 ms under the same required-network contract, with no non-SSE
  abort, retry, skip, unexpected, or flaky result. Report:
  `test-results/results/route-generation-rerun-20260716T142653Z.json`.

A concurrent diagnostic briefly returned two static-document HTTP 500s while a
separate process was replacing the shared `dist` directory during a production
build. A frozen-build rerun preserved server output and produced no HTTP 500 or
internal-error entry. This validates the test diagnosis; release deployment
still needs an immutable/atomic artifact handoff rather than an in-place build
against a serving directory.

Official-container WebKit subprocesses also produced large core files during
earlier teardown despite a passing Playwright result. The dumps were removed,
`core` and `core.*` are ignored, and both the clean iPhone and full desktop
WebKit reruns used `--ulimit core=0` and left no dump files. Core suppression
prevents workspace exhaustion but does not by itself prove the underlying
runner-shutdown diagnostic is resolved; the functional passes are not
release-clean visual or soak proof.

## Remaining route gate

These passes prove the static route and generated-link contract for the visited
states. The generation-bound correction still needs a current-source focused
Firefox, desktop/iPhone WebKit, enterprise-profile, and 1440 Chromium checkpoint.
The crawler also does not yet cover all nine dynamic patterns under every
required state, including new/imported/archived/blocked missions, evidence
candidates and verified evidence, missing or quarantined artifacts,
reconciliation errors, and copied deep links after refresh/back/forward. The
current source adds dedicated missing-run and cross-mission-run Evidence
fixtures which require both run and export links to be absent; raw `runId`
values and URL filters can no longer construct an Evidence export URL without
an agreeing repository-verified same-mission projection. That focused browser
case still requires execution across the current release matrix. The remaining
dynamic states, expired/offline/reconnect behavior, archived run-specific
reports, and the zero-404 release crawl remain required.
