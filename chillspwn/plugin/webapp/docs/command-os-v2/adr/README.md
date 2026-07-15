# Command OS V2 architecture decisions

These records capture choices that are expensive to reverse. They describe the
implemented direction and its consequences; test evidence remains in
[`../test-evidence.md`](../test-evidence.md).

- [ADR-001 — Exactly two user-facing journeys](001-two-user-facing-journeys.md)
- [ADR-002 — SQLite plus transactional outbox is canonical](002-sqlite-transactional-outbox.md)
- [ADR-003 — Reliability is enforced by a deterministic supervisor](003-deterministic-run-supervisor.md)
- [ADR-004 — The Second Brain is canonical in SQLite and projected to Obsidian](004-second-brain-obsidian-projection.md)
- [ADR-005 — Provider execution stays behind the ChillsPwn boundary](005-provider-execution-boundary.md)

Status vocabulary: `Accepted` means the implementation is expected to follow
the decision. It does not claim every acceptance test is complete.
