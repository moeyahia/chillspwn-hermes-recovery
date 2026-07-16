# Journey model

## Canonical journey type

Every Mission and Run carries exactly one public journey value:

- `autonomous`
- `guided`

Provider, model, approval strategy, observation state, and execution transport are not journeys.

## Autonomous contract

Autonomous starts only after a versioned contract passes readiness. The contract contains objective, measurable success criteria, authorization, allowed/prohibited targets and actions, destructive policy, evidence/report requirements, data handling, memory scopes, budgets, concurrency, provider/tool policy, notifications, safe-stop conditions, and deliverables.

After launch:

- `waiting_guided_decision` is illegal;
- permissions derive only from the signed contract;
- out-of-contract work selects a safe in-scope alternative or safe-stops;
- optional pause/abort/intervention is audited but never required for normal completion;
- only permitted confirmed memory and verified lessons may be used.

## Guided decision

Guided follows `Explain -> Recommend -> Choose -> Observe -> Interpret -> Record -> Advance`.

An agent-executed Guided decision authorizes only one represented action fingerprint and its normalized parameters. A materially different target, tool, argument, scope, or risk requires a new decision. Every step begins with an explanation and ends with an interpretation.

## Lifecycle

```text
queued
  -> planning
  -> awaiting_contract_confirmation (Autonomous pre-launch only)
  -> running
  -> recovering | blocked | terminal

Guided running
  <-> waiting_guided_decision
  -> recovering | blocked | terminal
```

Terminal states are `completed`, `failed`, and `cancelled`. A safe-stopped Autonomous run is a terminal failed outcome with a precise `outside_contract` reason and exception report; it is never disguised as a pending approval.

## Provider compatibility

A provider path may execute Autonomous work only when its tool, scope, delegation, cancellation, and evidence boundaries are enforceable by the runtime. Otherwise it may plan, advise, critique, summarize, or participate in Guided work. Compatibility is a readiness fact, not a user-facing third mode.
