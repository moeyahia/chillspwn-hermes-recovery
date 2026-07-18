# Command OS V2.1 documentation

This directory is the implementation and verification record for ChillsPwn Command OS V2.1. Documents describe one of three different things:

- **Baseline** — observations made before the V2.1 implementation began.
- **Design or contract** — the intended architecture and invariants.
- **Evidence** — checks that were actually run against the current candidate.

Design documents are not proof that a feature passed acceptance. Start with the completion audit and test evidence before making a deployment decision.

## Release and verification

- [Completion gap audit](completion-gap-audit.md) — acceptance traceability, release blockers, and prioritized remaining work.
- [Test evidence](test-evidence.md) — commands and results that have actually been recorded.
- [Performance evidence](performance.md) — measured bundle, browser, database, graph, and event results plus unmeasured targets.
- [Accessibility evidence](accessibility.md) — automated coverage and required manual verification.
- [Security review](security.md) — implemented controls, verified deployment findings, and unresolved risks.
- [Deployment guide](deployment.md) — candidate promotion gates and the current live/candidate distinction.
- [Platform support](platform-support.md) — web and Android packaging boundaries and validation commands.
- [Rollback guide](rollback.md) — application, database, migration, and vault recovery boundaries.
- [Schema-8 bridge rehearsal](schema-8-bridge-rehearsal.md) — supersession status and the required fresh final-checksum compatibility rehearsal. The prior bridge artifact/commands are unusable and must not be executed.
- [Schema-7 to schema-9 release rehearsal](schema-7-to-9-release-rehearsal.md) — current-checksum immutable bridge/candidate, backup, rollback, restart, integrity, and production non-interference evidence.
- [Schema-9 Guided boundary rehearsal](schema-9-guided-decision-rehearsal.md) — disposable schema-8→9 database evidence for fail-closed duplicate cleanup, exact pending-decision uniqueness, backup integrity, idempotence, and rollback compatibility.

## Product and interaction model

- [Product principles](product-principles.md)
- [Journey model](journey-model.md)
- [Information architecture](information-architecture.md)
- [Visual direction](visual-direction.md)
- [Design system](design-system.md)
- [Reference analysis](reference-analysis.md)

## Architecture and data

- [Baseline current-state audit](current-state-audit.md) — a pre-implementation characterization snapshot, not the current completion status.
- [Architecture map](architecture-map.md)
- [Architecture decision records](adr/README.md)
- [Domain model](domain-model.md)
- [Canonical database](database.md)
- [Event model](event-model.md)
- [API contract](api-contract.md)
- [Run supervisor](run-supervisor.md)
- [Learning system](learning-system.md)
- [Second Brain](second-brain.md)
- [Memory privacy](memory-privacy.md)
- [Obsidian bridge](obsidian-bridge.md)
- [Legacy migration](migration.md)
- [Baseline performance](baseline-performance.md)

## Evidence artifacts

- The pre-redesign screenshot is [`screenshots/before-command-center.png`](screenshots/before-command-center.png). It is a reproducible empty-state capture from baseline commit `343f6ac`, not a live mission screenshot.
- The current Overview capture is [`screenshots/after-overview-desktop.png`](screenshots/after-overview-desktop.png). It uses the explicitly labelled canonical E2E fixture in an isolated temporary database with provider credentials and live state disabled.
- The graph and accessible-list captures use that same isolated fixture and show eight canonical memory nodes, five persisted relationships, lifecycle/scope metadata, and the real node inspector; they are not decorative graph data.
- Generated-asset provenance is in [`../../public/brand-v2/manifest.json`](../../public/brand-v2/manifest.json).
- The remaining post-redesign desktop and mobile captures are stored alongside the Overview capture in [`screenshots/`](screenshots/); release validation must keep every capture free of live target and operator data.
- Local Playwright reports and migration backups are operational evidence, not source-controlled release artifacts. Their exact commands and safe summaries belong in [test evidence](test-evidence.md).

## Documentation rules

1. Never convert an intended contract into a pass claim without a recorded check.
2. Keep live deployment state distinct from the recovery-worktree candidate.
3. Do not place credentials, tokens, private paths containing user data, raw evidence, or unredacted logs in documentation.
4. Re-run relative-link validation after moving or renaming files.
