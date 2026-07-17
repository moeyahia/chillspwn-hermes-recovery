# Evaluation, learning, and Research Lab

Status: evidence-gated run learning, lesson review, run comparison, and a
fail-closed Research Lab campaign registry are implemented. Automatic
experiment execution and promotion are deliberately unavailable.

## Runtime learning boundary

Terminal runs create durable, journey-aware evaluations. Candidate lessons
retain source runs, evidence relationships, confidence, expected benefit,
risk, author, scope, and lifecycle. An authoring agent cannot verify its own
lesson. Retrieval accepts only relevant verified lessons within the mission,
engagement, journey, sensitivity, expiry, and Context Pack budget.

Failed-attempt memory records context, category, attributable evidence, why an
identical retry is unlikely to help, and the changed conditions that could make
a future attempt valid. The recovery path can consult these records before a
retry or replan. Usage is persisted so avoided repetition and outcome deltas
can be evaluated rather than asserted.

## Research Lab boundary

The reviewed concept source is `karpathy/autoresearch` at
`228791fb499afffb54b46200aca536f79142f117`. Command OS adapts its bounded
experiment contract, not its training implementation.

Implemented campaign definitions are:

1. repeated/no-progress action reduction;
2. specialist routing quality;
3. memory retrieval precision.

Campaign creation requires a human-owned charter acknowledgement, fixed
budgets, and registered dimensions. The public-model contract is proposal-only.
The UI reports the lab blocked until immutable benchmark snapshots, an approved
charter, disposable local labs, isolated workers, and an integrity signer exist.

No endpoint can skip the required path:
development, validation, hidden holdout, human review, shadow, bounded canary,
then verified. No candidate may modify authorization, allowlists, destructive
policy, disclosure policy, evidence integrity, evaluator, benchmark, audit
retention, deployment settings, or production code.

## Release gaps

The fixed benchmark families, disposable environment manager, local metric
engine, signed integrity/provider-exposure receipts, hidden holdout, shadow and
canary runners, rollback exercise, and comparative performance report remain
unimplemented. Research therefore cannot execute or claim improvement yet.
