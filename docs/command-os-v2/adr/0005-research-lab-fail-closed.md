# ADR 0005: Research Lab remains fail-closed without a trusted evaluator

- Status: accepted
- Date: 2026-07-16

## Decision

Adapt the bounded-experiment principles reviewed from
`karpathy/autoresearch@228791fb499afffb54b46200aca536f79142f117`, but restrict
the mutable surface to schema-validated StrategyBundle patches. A public model
may receive a sanitized brief and propose one experiment; it cannot execute,
score, select holdouts, promote, deploy, or alter safety/evaluator code.

Do not expose experiment execution until an immutable benchmark snapshot,
approved human charter, disposable lab, isolated worker, local metric engine,
and protected integrity signer exist. Promotion cannot skip development,
validation, hidden holdout, human review, shadow, and bounded canary.

## Consequences

The current Research UI truthfully reports blocked readiness. This delays
experimentation but prevents benchmark mutation, client-target experiments,
secret exposure, and autonomous self-deployment.
