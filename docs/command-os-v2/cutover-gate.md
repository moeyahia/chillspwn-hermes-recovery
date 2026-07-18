# Command OS V2 cutover gate

Formal decision: **closed — the complete release gate is not satisfied**.

Operational history: on 2026-07-17 the operator temporarily authorized an
accelerated V2.4 deployment without the parallel-isolation or preview-wait
requirement, then explicitly restored the legacy application as the working
service on port `3131` and moved Command OS V2 to preview port `3132`. The
legacy application is therefore still the default and no cutover is active.
Any later cutover must still use a checksum-verified offline database/Vault
backup, an immutable release path, an atomic pointer swap, health validation,
and a rehearsed rollback. The prior override is not recorded as completion of
the soak, full browser matrix, or human visual-approval requirements below.

## Evidence available

- authoritative ChillsPwn and Autoresearch source pins;
- isolated V2 application, API, database, assets, storage namespaces, and kill
  switch;
- unchanged canonical logo hashes in both applications: legacy and V2
  `public/Logo.svg` each remain
  `0a3dfd69f74a00d41bb0cb20d6af1097dffa265d4c1e54c9228fe4b55f85c955`;
- registry-backed two-journey intake and focused Chromium mission paths;
- a source-validated, fail-closed runtime-evidence bridge that publishes only
  after a releasable exact aggregate, atomically installs a root-owned
  service-group-readable bundle, revalidates receipt freshness/integrity and
  current server/configuration hashes, and grants no authority on missing,
  stale, tampered, permission-invalid, or drifted evidence;
- nonblocking startup provider/MCP attestation warm-up with an explicit
  `probing` readiness state; scheduling a probe does not grant execution
  authority;
- canonical operational truth, run intelligence, CVE applicability, direct
  versioned plan proposals, Second Brain/Vault, learning, and Research Lab
  fail-closed foundations;
- focused unit/integration/E2E checkpoints and successful legacy baseline runs;
- exact-source crash-safe run-control replay, cancellation cleanup, and stale
  recovery proof: 30/30 across six browser profiles, with zero unexpected,
  flaky, or skipped tests;
- current V2 `bun run check` package gate: **702/702** tests, 10,423 assertions
  across 131 files, plus browser/server and E2E type checks, logo and isolation
  checks, and a successful production build in 2.66 seconds;
- archived 479-group enforced initial-state interaction-manifest revision:
  **13/13 configured projects** in 119,691.24 ms, with zero skipped,
  unexpected, or flaky results. The archived JSON is
  `/root/chillspwn-command-os-v24/chillspwn/plugin/command-os-v2/test-results/results/manifest-current-authority-brain-static-restart-20260717.json`
  (SHA-256
  `0ce34a6fc091d29a5f12ce0f70d69295a729964e835c5ddb998ed233b3d3b21e`);
  the current 489-group inventory has not yet completed the same 13-project
  crawl and therefore remains a release blocker;
- current route and generated-href crawl: `tests/e2e/route-smoke.spec.ts`
  passed **390/390** across all **13 configured projects** in **406,441.99 ms**,
  with zero skipped, unexpected, or flaky results. Each project covered 29
  static routes plus its generated internal href contract, with no generated
  404, console, required-network, or layout failures. JSON:
  `test-results/results/route-href-crawl-current-20260717.json` (SHA-256
  `7f80e40eecdcc4679f5cdffa5f5832fb3c67630dc9370dd0f6bf744b0e1c5493`);
  HTML:
  `test-results/html/route-href-crawl-current-20260717/index.html`;
- historical pre-mirror legacy `bun run check` package gate: **644/644**
  aggregate tests (593 Bun, 34 portable Python gate tests, and 17 board-MCP
  tests), type checks, and a successful production build in 2.16 seconds. The
  operator later authorized the identical Recovery Panel terminal-refresh fix
  in `plugin/webapp`. The fresh post-mirror webapp package gate passed
  **1,233/1,233 aggregate tests** (1,182 Bun, 34 portable Python, 17 board-MCP),
  all three TypeScript checks, a 305-module server-entry bundle, and a 142-
  module production build in 2.66 seconds. An immutable log archive for this
  interactive pass remains open;
- disposable database backup/restore/integrity proof.
- bounded immutable V2 static-artifact handoff proof: 7/7 focused store/CLI
  tests with 47 assertions plus 1/1 real-process test with 12 assertions. The
  running server stayed pinned to release A after the pointer activated B,
  pinned B only after restart, and refused startup when active B was tampered.
  This is a V2 static-pointer primitive, not full service/data cutover rollback;
- exact popup/download/direct-request/browser-lifecycle audit implementation
  with bounded hung-request finalization. The current suite adds a cross-
  document receipt-isolation negative canary; its replacement all-engine result
  is not yet verified, so no current aggregate canary count is claimed here;
- the final combined strict managed-static `chromium-1440` project passed
  **180/180** in 601,955.963 ms with one worker, retries disabled, required-API
  and manifest enforcement, zero unexpected results, zero skipped tests, and
  zero flaky classifications. JSON:
  `test-results/results/release-current-chromium1440-20260717-r4.json`
  (SHA-256
  `c59afe69238d71aac7619dba91feb9c21dbdd685c22096943f52e2fe3f622e8a`).
  This closes the combined Chromium-project gate, not the 13-project release
  matrix;
- current Firefox route-readiness and command-palette settlement stress passed
  **150/150** across five repeats in 235,569.658 ms, with zero unexpected,
  skipped, or flaky results and retries disabled. JSON:
  `test-results/results/firefox-route-palette-stress-r1.json` (SHA-256
  `ca21a8c12e8a5121afee2eac87e3d7ba510326d5386aa4e4eeb7238b0f4207d2`).
  This is bounded stability evidence, not a complete Firefox project run;
- one real Obsidian Vault connected to the live schema-14 preview service at
  `/var/lib/chillspwn/brain-vaults/ChillsPwn-Brain`; current verification reports
  **64,697 tracked notes**, **zero conflicts**, and a canonical Brain graph of
  **73,523 memory nodes** and **73,431 memory edges**. The 2026-07-17 05:48 UTC
  rendered bootstrap capture below showed three projections and five Context
  Packs and is retained only as historical evidence:
  `docs/command-os-v2/evidence/obsidian-vault-live-20260717.png` (SHA-256
  `9006445488e2c73f126f382d15d8839b70081dadb615fe3de378d3d29aeea77e`);
- focused V2.4 Vault lifecycle coverage: 18/18 retry-free tests, six each in
  Chromium, Firefox, and WebKit. The connected-state UI places the named
  `Active Obsidian Vaults` region above `Connect another local vault` and the
  focused journey asserts that order. All six accumulated Brain Vault
  material-state journeys also passed together inside the final strict
  Chromium project;
- current direct-preload axe evidence: **84/84** across `chromium-1440`,
  `firefox-1440`, and `webkit-1440` in 195,950.758 ms, with **87 scans**, zero
  unexpected, skipped, or flaky results, zero automated A/AA violations, and
  retries disabled. The gate preloads pinned
  `axe-core` 4.12.1 before document initialization and evaluates only a compact,
  version-checked scan function under a 64 KiB transport canary. JSON:
  `test-results/results/accessibility-direct-all3-20260717-r1.json`
  (SHA-256
  `646380edb1001873e027203b308f2f2565305f4c66404b2817bcee493e96d223`);
- the most recent complete three-engine accessibility artifact is retained as
  archived pre-direct-transport evidence: **81/81** across Chromium, Firefox,
  and WebKit with **84 scans** and zero automated A/AA violations. JSON:
  `/root/chillspwn-command-os-v24/chillspwn/plugin/command-os-v2/test-results/results/axe-expanded-all3-20260717-r1.json`
  (SHA-256
  `aec4b7adbf9a3ac73dae22bcfb6b86c33954a789c65e182b8dca68c7059cbf22`);
- the visual registry maps 30/489 manifest groups to 13 deterministic Chromium
  baselines; 459 groups remain unmapped and `humanReleaseApproval` remains
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

- the green 13-project representative manifest crawl and 390/390 route/href crawl are
  **initial/static representative-state evidence only**. They do not click all
  489 material interactions, traverse every dynamic hidden/error/imported/
  archived/blocked/evidence-reconciliation state, or provide assertion-level
  option receipts. Only 30/489 groups map to 13 Chromium baselines; 459
  mappings, cross-browser baselines, and human visual approval remain open;
- one frozen exact-source retry-free run across all 13 configured projects;
  the strict Chromium 1440 project is green, but the remaining configured
  browser and viewport projects have not yet passed as one final matrix;
  uniformly strict required-API behavior, actual Edge certification if retained,
  native 200% zoom, visual approval, full WCAG/assistive-technology review
  beyond the bounded current 84/84 direct-preload desktop-engine gate,
  copy/alignment approval, and dynamic route-state coverage beyond the green
  representative initial/static crawl;
- provider-backed Autonomous and Guided completion, all-agent mandatory Brain
  lifecycle proof, Vault long-sync/generated-link/native-activation acceptance,
  restart/process-kill flows, and browser review
  of administrative, finding, lesson, live plan-amendment, compare, and rollback
  surfaces;
- the served webapp Autonomous route is now wired to the registry-backed
  `RegistryMissionIntakePage` instead of the stale free-form contract page, but
  focused browser acceptance of its checklist, defaults, and launch path is
  still required;
- committed candidate base `66c7f176a7cfbc421a1903be5d15deb80c663125`
  is running only on the V2 preview service at port `3132`, alongside the
  untouched legacy service on port `3131`, with schema-14 database backups.
  Deployment of the candidate runtime-evidence bridge, creation/verification
  of the dedicated V2 previous-release pointer, formal service/data rollback
  rehearsal, signed release attestation, and human release sign-off remain
  open;
- final production consumption of the new runtime-evidence bundle remains
  open. Publication passed with bundle
  `runtime_tool_evidence_b502fc8be05cf1c182e766aae93b7de4`, SHA-256
  `451c84db23174eb24ca719f1d9c4d8d484ebf9c6533493ede8aa369f363bc0d5`,
  `root:chillspwn` mode `0640`, 18/18 exposed tool coverage, and zero aggregate
  blockers. Accepted live route count and post-warm-up provider/MCP health must
  still be archived from the deployed service rather than inferred from tests;
- production legacy import/reconciliation is present, but the complete
  migration, restore, process-restart, and one-command rollback matrix still
  needs final archived release evidence;
- the connected live `ChillsPwn-Brain` Vault reports 64,697 tracked notes and
  zero conflicts. Native Obsidian graph/application acceptance and a complete
  generated-link resolution crawl remain open;
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

The prior accelerated-deployment authorization did not close the formal
release gate and was followed by an explicit return to legacy-on-`3131` and
V2-preview-on-`3132`. Legacy code/data and the previous-release pointer must
remain available, and no legacy decommissioning, default-route change, or
rollback-window closure is authorized until every blocker is closed and its
artifacts are archived.
