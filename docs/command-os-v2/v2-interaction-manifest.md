# V2 interaction manifest

Status: incremental executable inventory at the pinned V2.4 implementation
source. This is not release sign-off.

The executable manifest is `chillspwn/plugin/command-os-v2/tests/interaction-manifest.json`. Its schema and runtime validator live beside it, and the browser coverage audit is `tests/e2e/manifest-coverage-audit.spec.ts`.

## Current audited inventory

The manifest contains **479** unique control groups:

| Surface | Groups | Fixture ownership |
|---|---:|---|
| Authentication, shell, journey entry, and both four-step intake journeys | 83 | Static/non-fixture traversal |
| Mission truth, plan, CVE, script/page capture, operational truth, and failure diagnosis | 126 | Dedicated fixture IDs |
| Decisions and Intelligence | 39 | Dedicated fixture IDs |
| Second Brain home, inbox, graph, node lifecycle, controls, and Vault lifecycle | 121 | 119 dedicated fixture groups plus 2 initial static groups |
| System connections, policy, contract, and MCP retry | 13 | 10 dedicated fixture groups plus 3 initial static groups |
| Overview shortcuts and Mission Portfolio | 33 | Dedicated fixture IDs |
| Run intervention and recovery | 12 | Dedicated fixture IDs |
| Guided/Live entry, Agents, Learning, Observability, Reports, and User Manual routes | 28 | 8 dedicated dynamic-record families plus 20 initial rendered-state groups |
| Global command palette search, records, run controls, and memory candidate flow | 22 | Dedicated fixture IDs |
| Vault repair and reindex recovery | 2 | Dedicated fixture IDs |

Of the 479 groups, **371** have a canonical parameterized route and a
`requiredState` beginning with `Fixture required:`. All 371 name dedicated test
IDs in source; the validator has exact family assertions for the run-control and
Brain-node, Vault-lifecycle, journey-row, agent-row, trace-row, and report-row
additions. This closes generic source ownership, not execution or
assertion-level option coverage.

The latest complete enforced initial-state crawl covers the current 479-group
inventory and is archived at
`test-results/results/manifest-current-479-all13-enforced-20260717-r2.json`
(SHA-256
`840616394a5b875c1791315bd6f38eb2ed37099c7c7e3330a1ea1241c73524a7`):

| Measure | Result |
|---|---:|
| Manifest groups | 479 |
| Persistent-navigation projects | 8; 478 applicable groups; 868/868 rendered controls matched per project |
| Compact/reflow projects | 5; 479 applicable groups; 582/582 rendered controls matched per project |
| Rendered controls missing from the manifest | 0 |
| Unresolved fixture groups | 0 |
| Stale static manifest groups | 0 |
| Browser-audit/API degradation | 0 unexpected; 0 degraded API responses |

The current 479-group crawl used the development E2E profile with strict
manifest enforcement and required-API mode, with BrowserAudit active before
the first navigation. It validates
the visible initial state of the static routes plus both
four-step intake journeys and the rendered dynamic-record families. It does not
render most dialogs, drawers, every connected-Vault state, or every fixture-only
operational state, and it does not activate every option in grouped entries.

The crawl passed 13/13 in 117,245.316 ms with retries disabled and recorded zero
skipped, flaky, or unexpected results. The dynamic journey, agent, trace, and
report record families also passed 12/12 across Chromium, Firefox, and WebKit in
`test-results/results/dynamic-record-families-three-engine-final-20260717.json`
(SHA-256
`d040c45fdf59d29553a4f202a5646c478ae7f27446afaa0a0c5e990d24f427af`).
Full option/state receipts and material-state traversal remain open. This is a
bounded initial-state crawl only: it does not render every hidden, degraded,
error, dialog, drawer, connected-Vault, or fixture-only operational state and
does not activate every grouped option.

## Coverage accounting contract

The coverage audit treats a parameterized manifest route as a route pattern. It matches each `:missionId` or `:runId` segment only when a browser fixture actually visits a concrete route and renders a matching accessible control. Query requirements such as `tab=plan` and `tab=evidence` must also match.

Unrendered static entries still assigned to the generic audit remain
`staleManifestEntries`. Fixture-required entries still assigned to the generic
audit are instead reported as:

- `unresolvedFixtureEntryCount`
- `unresolvedFixtureEntries`

Fixture-required entries with dedicated IDs are excluded from both buckets in
this initial crawl; their coverage remains open until current-run receipts
exist. This distinction does not grant coverage. Strict crawl enforcement
covers rendered missing controls, generic unresolved fixtures, and stale static
entries; release separately requires receipts for every dedicated group.

The generic crawler matches by route pattern, accessible role, and accessible
name. It does not bind a rendered element to the manifest's `controlId`.
Likewise, the unit ownership check currently proves that each declared test ID
appears somewhere in E2E source; it does not prove assertion-level ownership of
every option. The 371 dedicated assignments therefore remain an inventory
checkpoint, not a mathematical proof that every option and state was exercised.

A checked-in visual registry now maps **15/479** manifest groups to **11**
deterministic Chromium 1440/Linux baselines. Six cover the connected-Vault
lifecycle; five new material screenshots cover minimal Autonomous intake,
structured blocked recovery, Guided waiting decision, and Second Brain
canvas/table modes. The remaining **464** groups are unmapped, cross-browser
baselines are not complete, and `humanReleaseApproval` remains `false`.

The focused visual replay passed **3/3** in 27,940.205 ms, and registry reverse
mapping plus file-integrity tests passed **21/21 with 3,404 assertions**. JSON:
`test-results/results/59786-1784264454738.json` (SHA-256
`fc72e41f27b524cb3591825ccc29339bc3f9e95bd394ed764f40fc9a8371ef6c`).
These are automated drift receipts, not cross-browser or human visual approval.

## Accessibility state inventory

`tests/accessibility-state-inventory.json` separately defines a bounded
machine-readable accessibility matrix of **12 primary-route initial states**
and **16 material states**. The material set covers the open command palette,
both mission intakes, versioned Plan, Guided waiting decision, Evidence and
Finding review, Brain canvas/table, a genuinely connected Obsidian Vault,
structured recovery, Research, trace/report review, and System
Policies/Settings.

The policy test requires the 12 primary route paths to match
`PRIMARY_NAVIGATION`, requires all 16 named material states, and forbids axe
rule disabling/exclusion. Each browser project runs 27 serial tests and emits
28 state receipts. The Chromium-first pass completed 27/27; the final Chromium,
Firefox, and WebKit matrix completed **81/81 in 115,689.921 ms**, with **84
scans, 0 A/AA violations, 0 failed, 0 skipped, and 0 retries**. JSON:
`test-results/results/axe-expanded-all3-20260717-r1.json` (SHA-256
`aec4b7adbf9a3ac73dae22bcfb6b86c33954a789c65e182b8dca68c7059cbf22`).

The embedded receipts retain 84 gradient color-contrast and 15 ARIA-support
incomplete determinations for manual review. The run closed two frontend
defects: roleless labeled progress tracks and a selected-row critical status
pill measuring 4.49:1. This bounded desktop-engine scan does not certify every
manifest option, mobile layout, native zoom, screen reader, manual assistive
technology, or human accessibility approval.

## Evidence export relationship gate

The `intelligence.evidence.export` entry now treats the export URL as a derived
capability of the repository's canonical same-mission `run` projection. A raw
detail `runId`, a URL filter, or a syntactically valid identifier is not an
export boundary. The dedicated intelligence fixture contains canonical,
missing-run, and cross-mission-run evidence cases; its browser assertions
require the latter two cases to show reconciliation copy with no run link, no
export link, and no export request. The canonical same-mission case continues
to exercise the bounded metadata download.

Focused unit coverage proves the resolver fails closed for a null projection,
an inconsistent projection, and an unverified syntax-only ID. The dedicated
browser case passed the focused six-project Chromium, Firefox, WebKit, Android,
iPhone, and tablet slice. It must still pass the complete retry-free 13-project
release matrix.

## Required coverage work

Source assignment is no longer the primary gap. Release evidence still needs:

1. extend the green current 479-group initial-state crawl and bounded 16-state
   accessibility matrix into every material hidden, dynamic, degraded, error,
   dialog, drawer, and connected-Vault state;
2. assertion-level ownership of every option and material state;
3. complete browser/viewport, keyboard, mobile, error, refresh/reconnect, and
   visual execution;
4. remaining product controls for node-level Vault actions, provider-backed
   mutations, finding/admin/lesson
   review, live in-flight plan amendment, plan comparison/rollback, provider
   recovery, and Research Lab promotion;
5. the remaining 464 screenshot mappings, cross-browser and human visual
   approval, accessibility coverage beyond the bounded 81/81 three-engine axe
   matrix, and a retry-free full 13-project complete-product release matrix
   beyond the bounded manifest crawl.
