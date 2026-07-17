# Memory privacy and operator control

Status: mandatory isolation and secret-exclusion invariants, consent controls,
forget/suppression behavior, and audit records are implemented in the canonical
memory service.

## Non-switchable invariants

- engagement isolation is always enabled;
- secrets are never retained as reusable memory;
- a preference cannot broaden scope, permission, evidence policy, or safety;
- operator verification and public-provider disclosure are separate decisions;
- evidence content is linked by stable ID rather than copied into preference
  memory;
- forgotten content is unavailable to retrieval, embeddings/projections, and
  synchronized notes; only a content-free audit event and optional suppression
  fingerprint remain.

## Operator policy

The Memory Control Center exposes global enablement, preference candidate
learning, operational memory, retention, Autonomous and Guided use, and
Obsidian sync scope. Updates require an expected version and create a
hash-chained audit record. The safety invariants above cannot be toggled off.

The inbox provides source-backed confirmation, edit/confirm, scoping, expiry,
sensitivity, merge/reject, and reject-with-suppression paths. Agent-authored
content retains agent authorship and is not represented as an operator fact.

## Retrieval and disclosure

Scope policy is applied before ranking and again on graph expansion. Global
personal preferences enter unrelated missions only when explicitly global and
permitted. Context Pack telemetry records selected/rejected IDs and policy
reason categories, not private reasoning traces.

Public-provider sanitization and exposure receipts are mandatory for the final
execution and Research Lab adapters. Focused reusable-memory tests exist, but a
full red-team prompt-injection/exfiltration review over the eventual provider
adapter remains a release blocker.
