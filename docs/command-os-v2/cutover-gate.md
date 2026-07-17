# Command OS V2 cutover gate

Formal decision: **closed — the complete release gate is not satisfied**.

Operational override: on 2026-07-17 the operator explicitly authorized the
latest integrated V2.4 candidate to become the live default without the
parallel-isolation or preview-wait requirement. The deployment must still use
a checksum-verified offline database/Vault backup, an immutable release path,
an atomic pointer swap, health validation, and a rehearsed rollback. This
override is not recorded as completion of the soak, full browser matrix, or
human visual-approval requirements below.

## Evidence available

- authoritative ChillsPwn and Autoresearch source pins;
- isolated V2 application, API, database, assets, storage namespaces, and kill
  switch;
- unchanged canonical logo hashes in both applications: legacy and V2
  `public/Logo.svg` each remain
  `0a3dfd69f74a00d41bb0cb20d6af1097dffa265d4c1e54c9228fe4b55f85c955`;
- registry-backed two-journey intake and focused Chromium mission paths;
- canonical operational truth, run intelligence, CVE applicability, direct
  versioned plan proposals, Second Brain/Vault, learning, and Research Lab
  fail-closed foundations;
- focused unit/integration/E2E checkpoints and successful legacy baseline runs;
- exact-source crash-safe run-control replay, cancellation cleanup, and stale
  recovery proof: 30/30 across six browser profiles, with zero unexpected,
  flaky, or skipped tests;
- final V2 `bun run check` package gate: **685/685** tests, 10,050 assertions
  across 128 files; an independent JUnit run completed in 30.50
  seconds, plus browser/server and E2E type checks, logo and isolation checks,
  and a successful production build in 2.42 seconds;
- current 479-group enforced initial-state interaction-manifest inventory:
  **13/13 configured projects** in 119,691.24 ms, with zero skipped,
  unexpected, or flaky results. The archived JSON is
  `/root/chillspwn-command-os-v24/chillspwn/plugin/command-os-v2/test-results/results/manifest-current-authority-brain-static-restart-20260717.json`
  (SHA-256
  `0ce34a6fc091d29a5f12ce0f70d69295a729964e835c5ddb998ed233b3d3b21e`);
- current route and generated-href crawl: `tests/e2e/route-smoke.spec.ts`
  passed **390/390** across all **13 configured projects** in **406,441.99 ms**,
  with zero skipped, unexpected, or flaky results. Each project covered 29
  static routes plus its generated internal href contract, with no generated
  404, console, required-network, or layout failures. JSON:
  `test-results/results/route-href-crawl-current-20260717.json` (SHA-256
  `7f80e40eecdcc4679f5cdffa5f5832fb3c67630dc9370dd0f6bf744b0e1c5493`);
  HTML:
  `test-results/html/route-href-crawl-current-20260717/index.html`;
- protected legacy `bun run check` package gate: **644/644** aggregate tests
  (593 Bun, 34 portable Python gate tests, and 17 board-MCP tests), type checks,
  and a successful production build in 2.16 seconds, with no legacy source
  diff;
- disposable database backup/restore/integrity proof.
- bounded immutable V2 static-artifact handoff proof: 7/7 focused store/CLI
  tests with 47 assertions plus 1/1 real-process test with 12 assertions. The
  running server stayed pinned to release A after the pointer activated B,
  pinned B only after restart, and refused startup when active B was tampered.
  This is a V2 static-pointer primitive, not full service/data cutover rollback;
- exact popup/download/direct-request/browser-lifecycle audit: 18/18 positive
  and negative canaries plus 12/12 impacted paths across Chromium, Firefox, and
  WebKit, with bounded hung-request finalization and zero skipped/flaky tests;
- the final combined strict managed-static `chromium-1440` project passed
  **180/180** in 601,955.963 ms with one worker, retries disabled, required-API
  and manifest enforcement, zero unexpected results, zero skipped tests, and
  zero flaky classifications. JSON:
  `test-results/results/release-current-chromium1440-20260717-r4.json`
  (SHA-256
  `c59afe69238d71aac7619dba91feb9c21dbdd685c22096943f52e2fe3f622e8a`).
  This closes the combined Chromium-project gate, not the 13-project release
  matrix;
- one real Obsidian Vault connected to the existing integrated schema-2.1
  service at `/var/lib/chillspwn/brain-vaults/ChillsPwn-Brain`; the 2026-07-17
  05:48 UTC read-only readback reported exactly one connected connection, three
  synchronized projections, zero sync errors, zero review rows, zero conflicts,
  and five Context Packs. The fresh rendered evidence is
  `docs/command-os-v2/evidence/obsidian-vault-live-20260717.png` (SHA-256
  `9006445488e2c73f126f382d15d8839b70081dadb615fe3de378d3d29aeea77e`).
  This does not deploy or authorize the isolated schema-11 V2.4 application;
- focused V2.4 Vault lifecycle coverage: 18/18 retry-free tests, six each in
  Chromium, Firefox, and WebKit. The connected-state UI places the named
  `Active Obsidian Vaults` region above `Connect another local vault` and the
  focused journey asserts that order. All six accumulated Brain Vault
  material-state journeys also passed together inside the final strict
  Chromium project;
- bounded critical-surface axe evidence: **15/15** (five each in
  `chromium-1440`, `firefox-1440`, and `webkit-1440`) in 35,995.719 ms, with
  zero skips, retries, or flaky tests. The archived JSON is
  `/root/chillspwn-command-os-v24/chillspwn/plugin/command-os-v2/test-results/results/axe-critical-all3-final-20260717.json`
  (SHA-256 `003b373d2c3f8f461314a866a7e37bcd92b6422c0c5822ec9a36df59225b8a88`)
  and the HTML report is
  `/root/chillspwn-command-os-v24/chillspwn/plugin/command-os-v2/test-results/html/axe-critical-all3-final-20260717/index.html`;
- the visual registry maps 15/479 manifest groups to 11 deterministic Chromium
  baselines; 464 groups remain unmapped and `humanReleaseApproval` remains
  `false`;
- all 13 typed Brain lifecycle hooks now have concrete runtime seams, including
  PlanChange `replan` packs with Autonomous fail-closed and Guided degraded
  behavior; provider-backed all-agent context-consumption proof remains open;
- the mutation-authority audit reconciles 77 unique inventory records with 89
  Express mutation declarations and reports zero unclassified declarations,
  stale records, implementation-source mismatches, or `policyScopedGaps`. The
  four formerly open boundaries are now lease-fenced:
  `POST /api/v2/missions/:missionId/autonomous-branches/preflight`,
  `POST /api/v2/missions/:missionId/autonomous-branches`,
  `POST /api/v2/missions/bulk/archive`, and
  `POST /api/v2/operations/runs/:runId/follow-up`. Each establishes trusted
  current authority before idempotent replay and rechecks it inside the atomic
  replay/write transaction;
- an atomic local source/artifact digest receipt that fails immutable-source
  attestation on the current untracked V2 tree and always keeps local evidence
  `releaseCandidateEligible:false` without signing and the remaining gates;
  the current receipt hashes to
  `77f260d94f80346cdb0ffd36c0e421d62cfc967cf752b90b30f9b71c53c1f0a2`.

## Blocking evidence

- strict Chromium negative progression remains archived: r2 completed 160
  passes with 12 failures and 8 skipped in 583,977.809 ms (SHA-256
  `69af028860715f4acc352ccc50a977fab78bdcef9cbe2bba5bddaf3031feb4a8`),
  and r3 completed 175 passes with 3 failures and 2 skipped in 602,699.813 ms
  (SHA-256
  `3fb5732651b8e728a43d2cb96223df1058a9379209e8ec512eec6206112dc110`).
  Both had zero flaky classifications and no retries. The subsequent r4
  180/180 result closes that single-project gate without converting these
  negative artifacts into passes. The retained receipts are
  `test-results/results/release-current-chromium1440-20260717-r2.json` and
  `test-results/results/release-current-chromium1440-20260717-r3.json`;

- the green 13-project 479-group manifest crawl and 390/390 route/href crawl are
  **initial/static representative-state evidence only**. They do not click all
  479 material interactions, traverse every dynamic hidden/error/imported/
  archived/blocked/evidence-reconciliation state, or provide assertion-level
  option receipts. Only 15/479 groups map to 11 Chromium baselines; 464
  mappings, cross-browser baselines, and human visual approval remain open;
- one frozen exact-source retry-free run across all 13 configured projects;
  the strict Chromium 1440 project is green, but the remaining configured
  browser and viewport projects have not yet passed as one final matrix;
  uniformly strict required-API behavior, actual Edge certification if retained,
  native 200% zoom, visual approval, full WCAG/assistive-technology review
  beyond the bounded 15/15 axe gate,
  copy/alignment approval, and dynamic route-state coverage beyond the green
  representative initial/static crawl;
- provider-backed Autonomous and Guided completion, all-agent mandatory Brain
  lifecycle proof, remaining Vault deployment, restart/process-kill, long-sync,
  and native-activation flows, and browser review
  of administrative, finding, lesson, live plan-amendment, compare, and rollback
  surfaces;
- signed deployment handoff and full service/data rollback remain open. The
  lease-fenced mutation inventory and bounded static-pointer process proof do
  not establish reverse-proxy cutover, worker/data rollback, or release sign-off;
- a committed clean V2 revision plus signed immutable handoff; the current
  digest intentionally reports that the V2 application is absent from pinned
  HEAD and differs from it;
- production legacy import/reconciliation plus migration, backup, restart,
  cutover, and one-command rollback rehearsal;
- a schema-compatible V2.4 Vault deployment path: port 3131 is the protected
  integrated schema-2.1/schema-7 service and must not be replaced or migrated
  in place by the standalone schema-11 V2.4 app;
- the protected live schema-2.1 projection contains one dangling native
  `[[wikilink]]` to a candidate lesson excluded by the active projection
  policy. Current V2.4 source filters excluded lifecycle targets, but that fix
  is not deployed to or reverified against the protected service;
- native Obsidian launch acceptance remains unavailable on this headless host:
  no Obsidian desktop executable or registered `obsidian://` handler is
  installed. Browser tests verify sanitized targets, not native application
  launch;
- browser-rendered large-graph frame-rate/layout-cancellation, large Vault,
  Web Vitals/Lighthouse, long-session memory, and concurrent legacy/V2 resource
  non-regression proof. Canonical 50,000-node search, local expansion, and
  progressive graph-shell query budgets are measured and green, but do not
  satisfy the remaining browser/Vault-scale gate;
- complete Research Lab benchmark, hidden-holdout, human review, shadow, bounded
  canary, and rollback lifecycle proof;
- Higgsfield production asset generation, which remains blocked on external
  OAuth rather than being represented by substitutes;
- 72-hour soak and seven-day preview;
- zero release-scope defects;
- explicit human release sign-off.

No route redirect, legacy removal, production migration, or default-entry switch
is authorized until every blocker is closed and its artifacts are archived.
