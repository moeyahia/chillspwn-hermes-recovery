# Operational truth and evidence semantics

Status: implemented as an additive V2.4 service boundary and rendered as a mission-scoped engagement log, observation, candidate, verified-evidence, and failure-diagnosis experience in the isolated Command OS process.

## Canonical ladder

Command OS does not treat tool output as evidence. The durable progression is:

1. **Engagement log record** — a chronological, redacted technical record. Raw command output stays here by default.
2. **Observation** — a parser-attributed statement linked to one or more canonical log records.
3. **Evidence candidate** — an explicitly proposed item with validation requirements and a human review state.
4. **Verified evidence** — an immutable item with a content hash, normalized target, acquisition time, attributable provenance, and chain of custody.
5. **Finding** — a conclusion that may be verified only when its evidence gate is sufficient.

No transition is implicit. A matching string in command output cannot verify evidence or a finding.

## Service boundary

`server/intelligence-v24/OperationalTruthRouter.ts` provides authenticated, mission-scoped routes for logs, observations, candidates, verified evidence, finding readiness, and failure diagnoses. All mutations require an idempotency key. Evidence and finding review requires a human operator identity. An agent cannot attribute a record to another agent.

The composition root accepts explicit actor and authorization hooks. The isolated single-operator preview defaults to its authenticated local operator and may be replaced with engagement-aware authorization without changing the router.

## Failure truth

`FailureDiagnosis` records the affected subject, human reason, category/code, originating component, last successful event, failed dependency or component, retry history, progress already made, preserved evidence/artifacts, retryability, bounded automatic recovery, remediation, valid operator actions, and objective impact. Resolution is explicit and audited.

## Verification evidence

- Focused operational-truth tests: 16 tests, 120 assertions.
- Mounted application, contract, and operational-truth checkpoint: 23 tests, 187 assertions.
- Raw command-output fixture proves zero automatic evidence-like records.
- Insufficient and contradictory evidence fixtures prove finding verification fails closed.
- Cross-mission source linkage and resource disclosure fail without partial writes.

## Remaining release work

The global Evidence Vault remains the canonical verified-evidence browser while the mission workspace exposes the complete truth ladder. Release is still blocked on current-run receipts for every dynamic fixture and material state, every generated-link crawl, cross-browser visual baselines, and soak acceptance; mounted UI alone is not treated as release proof.
