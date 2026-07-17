# ChillsPwn Autoresearch Lab

Status: bounded campaign registry and human-owned draft lifecycle are implemented. Experiment execution is deliberately blocked until the immutable local harness prerequisites exist.

## Reviewed concept source

The latest remote default-branch HEAD of
`https://github.com/karpathy/autoresearch` was rechecked on `2026-07-16`:

- branch: `master`;
- commit: `228791fb499afffb54b46200aca536f79142f117`;
- commit time: `2026-03-25T17:07:37-07:00`;
- subject: `Merge pull request #342 from kaizen-38/feat/bug-fix`.

This equals the earlier baseline named in the V2.4 specification. It is a
reviewed concept-source pin, not a runtime dependency. Command OS adapts the
immutable-evaluator and bounded-experiment contract; it does not copy the
training implementation or its open-ended loop semantics.

## Implemented first campaigns

1. Repeated/no-progress action reduction.
2. Specialist routing quality.
3. Memory retrieval precision.

Creating a campaign requires an explicit human-owner acknowledgement and persists fixed budgets and registered dimensions transactionally. Duplicate active campaigns are rejected. Stopping a campaign requires the owner, an optimistic version timestamp, a reason, and an idempotency key. Audit records are hash chained.

## Public-model boundary

The published contract is proposal-only:

- no raw client evidence or unrestricted transcripts;
- no direct experiment tools;
- no authoritative scoring;
- no hidden holdout access;
- no automatic promotion.

The required promotion path is fixed as development, validation, hidden holdout, human review, shadow, bounded canary, then verified. No run or promote endpoint is exposed while the local benchmark, approved charter, disposable lab, isolated worker, and integrity signer are unavailable.

## Current readiness

The Research Lab truthfully reports `blocked` with individual remediation checks for:

- immutable benchmark snapshot;
- human-approved research charter;
- disposable local lab;
- isolated experiment worker;
- local integrity signer.

This is a safety property, not a placeholder. The public model can propose nothing executable until the trusted local components are present.

## Verification evidence

- Research suite: 38 tests, 288 assertions.
- Application/contract integration: 7 tests, 67 assertions at the last focused checkpoint.
- Client parser rejects weakened disclosure policy and skipped promotion stages.
- Production build keeps the Research route lazy and within the route-chunk budget.
