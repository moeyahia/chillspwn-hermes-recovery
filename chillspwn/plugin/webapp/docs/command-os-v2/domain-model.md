# Domain model

## Aggregate roots

- **Mission** owns objective, journey, authorization, targets, constraints, success criteria, retention, and continuity.
- **Run** owns one attempt, lifecycle, plan version, budgets, lease, heartbeat, checkpoint, and terminal evaluation.
- **Memory Node** owns one versioned unit of user-controlled knowledge and its lifecycle.

## Execution records

Plan versions contain ordered Steps. Assignment binds a Step to an Agent. Action records a provider turn, tool call, delegation, Guided decision, or operator intervention. Evidence and Artifacts are immutable outputs. Findings require linked Evidence or a separately audited override.

## Decision records

- Autonomous Mission Contract: pre-launch authorization and operating bounds.
- Guided Decision: exact represented action plus normalized parameters, risk, rationale, actor, and expiry.
- Administrative Approval: future policy/configuration decision, never a substitute for Autonomous preflight.

## Knowledge records

Memory Nodes and typed directed Edges form the Second Brain. Context Packs persist retrieval and use. Lessons remain evidence-gated and separate from personal preference confirmation. Evidence is linked by immutable ID and does not become general memory.

## Identifiers and concurrency

Identifiers are stable prefixed UUIDs. Mutable aggregates carry integer versions for optimistic concurrency. Timestamps are UTC ISO-8601 at API boundaries and integer milliseconds/ISO text consistently within repositories. Every event carries Mission, Run, journey, sequence, schema version, actor, and trace correlation where applicable.
