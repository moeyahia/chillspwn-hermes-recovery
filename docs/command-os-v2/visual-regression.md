# Visual regression status

Status: screenshot infrastructure and required viewport projects are configured;
automated deterministic coverage is expanding, but approved release baselines
are incomplete and cutover remains closed.

The Playwright configuration defines 13 projects spanning 360×800, 390×844,
768×1024, 1024×768, 1280×800, 1440×900, 1920×1080, 2560×1440, and a
720×450/DPR-2 reflow project. Engines and profiles include Chromium, Firefox,
WebKit, enterprise-Chromium behavior, Android emulation, iPhone WebKit
emulation, and tablet emulation. Run-ID namespacing prevents one project's HTML,
JSON, and failure artifacts from overwriting another's.

Firefox is installed and runnable directly. WebKit runs on this host through
environment-only Ubuntu Noble compatibility libraries for Playwright's GTK/WPE
runtime; repository source and application dependencies were not changed. The
historical desktop and iPhone 73/73 runs remain functional checkpoints, and
newer focused six-project slices include host WebKit. None is complete
cross-browser screenshot approval or a complete exact-source release run.

The current enforced manifest crawl passed 13/13 configured projects across the
declared viewport set with zero missing, unresolved, stale, skipped, flaky, or
unexpected results. That artifact validates rendered-control accounting and
reflow smoke behavior. It does not constitute human visual-regression approval.

Release baselines must cover every primary route plus loading, empty, partial,
offline, reconnecting, denied, degraded, error, recovery, safe-stop,
Guided-waiting, graph mode, dialog, drawer, and menu state. Review must detect
spacing/baseline drift, clipping, wrapping, overlap, contrast, focus-ring loss,
column drift, graph-control occlusion, safe-area errors, and layout shift.

## Current deterministic baseline registry

`tests/interaction-manifest/visual-baselines.json` currently maps **30 of 489
manifest groups** to **13 checked-in Chromium-1440/Linux baselines**. The other
**459 groups remain explicitly unmapped**, cross-browser baseline coverage is
incomplete, and the registry retains `humanReleaseApproval: false`.

The six original connected-Vault baselines cover:

1. verified connection after a real round trip;
2. bounded path denial;
3. open two-sided conflict review;
4. repair receipt;
5. reindex receipt;
6. degraded-to-connected recovery.

Seven additional material screenshots now cover:

1. minimal Autonomous intake review with resolved defaults and fail-closed
   runtime readiness;
2. the complete independent evidence-verification gate, including canonical
   sources, provenance, custody, additional requirements, human attestation,
   and the enabled verification action before mutation;
3. structured blocked recovery diagnosis and bounded proposal;
4. resumed Guided waiting-for-decision status;
5. deterministic Second Brain graph canvas;
6. the same Brain projection in its accessible table mode;
7. a targeted memory export after browser reload with its selected verified
   Vault and sanitized native Obsidian deep link visible together.

The baseline PNGs live beside their owning specs under:

- `tests/e2e/brain-vault.spec.ts-snapshots/`;
- `tests/e2e/mission-intake.spec.ts-snapshots/`;
- `tests/e2e/operational-truth.spec.ts-snapshots/`;
- `tests/e2e/run-intervention-recovery.spec.ts-snapshots/`;
- `tests/e2e/brain-graph.spec.ts-snapshots/`;
- `tests/e2e/brain-node-vault.spec.ts-snapshots/`.

The registry records each baseline's interaction IDs, owning test ID, project,
viewport, platform, pixel dimensions, byte size, normalization fields, and
SHA-256 hash. Reverse mapping, file integrity, dimensions, hashes, and explicit
unmapped accounting for the current 13-baseline registry passed **21/21 tests
with 3,554 assertions**. The earlier archived registry receipt recorded 3,486
assertions before the evidence-verification baseline was added.

The targeted node-level Vault baseline then passed a strict no-update
Chromium-1440 replay **1/1**. JSON:
`test-results/results/brain-node-vault-visual-verify-20260717.json` (SHA-256
`e0ae9315f91d791da5b87dcdc0b95cb5cfd57b89a872e827112f96a7442dbcf7`).
HTML:
`test-results/html/brain-node-vault-visual-verify-20260717/index.html`
(SHA-256
`7fc71c6fb2a475a14cae2a4e8aa9c8e8e1724e2ec4ca82edd60534fa7fd70a0a`).

The independent evidence-verification baseline also passed a strict no-update
Chromium-1440 replay **1/1** in **9,818.544 ms**, with zero skipped, unexpected,
or flaky results. JSON:
`test-results/results/visual-operational-truth-evidence-verification-verify-20260717.json`
(SHA-256
`60a474e18b001b4bd06fcac7e84c1f048a6575712841e6890fda0e0a35626d65`).
HTML:
`test-results/html/visual-operational-truth-evidence-verification-verify-20260717/index.html`
(SHA-256
`0412a3b9a826114b6e500abba562626a128913ee00b1f8331c207a0a5da4713b`).

The earlier five-screenshot focused Chromium replay passed **3/3 tests** in
**27,940.205 ms** with zero failures or skips and exercised those five material
screenshots.
JSON:
`/root/chillspwn-command-os-v24/chillspwn/plugin/command-os-v2/test-results/results/59786-1784264454738.json`
(SHA-256
`fc72e41f27b524cb3591825ccc29339bc3f9e95bd394ed764f40fc9a8371ef6c`).
HTML:
`/root/chillspwn-command-os-v24/chillspwn/plugin/command-os-v2/test-results/html/59786-1784264454738/index.html`
(SHA-256
`1ff770d6a04b46843b172595ea3ab3889faf2b0a3cfb95aa31403bc5f05948fd`).
E2E TypeScript also passed.

These receipts protect deterministic drift in the named states. They do not
turn the images into human-approved release baselines and do not cover the
remaining routes, states, browsers, viewports, or copy/alignment review.

## Current gaps

- **459 of 489** manifest groups have no checked-in visual mapping;
- all 13 baselines are Chromium-1440/Linux only;
- screenshot, trace, and video capture outside these assertions remains
  failure-oriented, so diagnostic images are not success-path approvals;
- the 720×450/DPR-2 project models reflow but does not prove native browser
  200% zoom;
- complete-product cross-browser screenshots, an actual Edge run where
  required, long-copy stress, reduced motion, dark-theme contrast, native 200%
  zoom, mobile safe areas, and human design/copy approval remain open;
- the automated accessibility gate's retained gradient-contrast determinations
  still require human review where screenshot backgrounds are visually complex.

Visual coverage is therefore materially improved but still incomplete. No
visual release approval or cutover authorization is implied.
