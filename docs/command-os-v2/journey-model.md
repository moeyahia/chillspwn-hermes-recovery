# Journey model

## Product invariant

Command OS exposes exactly two mission journeys: **Autonomous** and **Guided**. Provider, model, managed/observe runtime mechanics, approval strategies, Ask, Explain, Direct, and Observe remain internal or secondary controls. They are never a third top-level journey.

Journey is stored on Mission and Run and repeated in every plan, event, checkpoint, decision, evaluation, report, and audit record. A journey change is versioned and explicit; it never happens because a provider changes or a user sends a message.

## Mapping from the current runtime

| Current concept | V2 treatment |
| --- | --- |
| Chat session | optional Conversation linked to durable Mission/Run/Step; never state owner |
| `managed` run | possible execution substrate for Autonomous or exact Guided step only after policy/readiness validation |
| `observe` run | observation/advice substrate; cannot be labeled an Autonomous executor |
| `awaiting_plan_approval` | compatibility-import state; maps to prelaunch contract confirmation or Guided decision, never postlaunch Autonomous wait |
| `awaiting_user_input` | compatibility-import state; maps to `waiting_guided_decision` only for Guided; Autonomous recovers or safe-stops |
| approval mode | administrative/tool-policy mechanism, not a journey |
| provider switch | secondary model assignment amendment; does not change journey |
| Chat/Cockpit/Mission Board | capabilities redistributed into Mission Workspace, Guided Workspace, Live Operations, Decisions, and Agents |

The existing current runtime cannot yet satisfy Autonomous by relabeling a managed chat. It includes plan approval, observe-only paths, and `awaiting_user_input`; it lacks a signed executable contract, readiness proof, durable supervisor, and no-wait invariant.

## Shared minimum intake

A mission may begin with only:

1. journey;
2. explicit authorization acknowledgement;
3. at least one target/environment reference.

Templates and registries derive safe editable defaults for title, objective, success criteria, deliverables, evidence, action policy, budgets, team, model assignments, and optional stops. Authorization is never inferred. Platform safety invariants are mandatory and separate from optional mission preferences.

## Autonomous

Promise: define the authorized objective and boundaries once; ChillsPwn plans, delegates, executes, validates, recovers, reports, evaluates, and closes without routine operator involvement.

### Prelaunch readiness

Launch requires a versioned Autonomous Mission Contract with normalized scope, explicit authorization, fully resolved supported action classes, destructive policy, enforceable provider/tool path, required credentials/dependencies, budgets, data disclosure/retention rules, Brain policy, evidence/finding policy, safe stops, and deliverables.

The gate blocks launch when no safe fallback can satisfy a required capability. An observe-only/advisor provider may plan or critique, but cannot be presented as an enforceable Autonomous executor. The chosen agent/model configuration and contract/context hashes are pinned to the Run.

### Postlaunch invariants

- no routine approval, chat question, or user-wait state;
- all permission comes from the signed contract;
- every action is scope and action-class checked at execution time;
- Brain Context Packs are retrieved at planning, phase change, recovery, reporting, and evaluation;
- progress, fingerprints, heartbeats, budgets, retries, and replans are supervised deterministically;
- out-of-contract work selects a safe in-contract alternative or produces a precise safe stop;
- operator pause/abort is optional and audited, never required for normal completion;
- a material objective/scope/policy amendment pauses and creates a versioned contract change or new run.

Allowed status language is explicit: `Executing autonomously`, `Recovering autonomously`, `Safe-stopped: outside contract`, `Completed autonomously`, or `Failed safely`.

## Guided

Promise: collaborate one consequential step at a time; ChillsPwn explains, recommends, waits, observes, interprets, records, and advances.

### Guided loop

1. **Explain** current phase, objective, prerequisites, risks, expected evidence, and uncertainty.
2. **Recommend** one bounded next step and relevant alternatives.
3. **Choose** through an explicit decision: run this exact step, run manually, explain more, use another approach, skip, or stop.
4. **Observe** uploaded/pasted/tool output as logs/artifacts/observations, not automatic evidence.
5. **Interpret** meaning, confidence, conflicts, and missing context.
6. **Record** the decision, normalized parameters, observations, evidence candidates, and checkpoint.
7. **Advance** only after interpretation or a represented plan change.

An agent-run choice authorizes only the represented action and normalized parameters. A material parameter/tool/target change requires a new decision. The conversation may be the primary collaborative surface, but mission, plan, current step, decision, evidence, and checkpoint persist independently.

### Brain behavior

Before a phase and after a material result, Guided refreshes a scope-safe Context Pack. Confirmed preferences may adapt terminology, depth, pace, examples, manual-versus-single-step execution, tools, and report style. `Context used` explains the exact nodes and influence without exposing hidden chain of thought. If Brain is unavailable, Guided continues with explicit defaults and visible degraded status; it does not claim personalization.

## State machine

Canonical V2 Run states are:

```text
queued -> planning -> awaiting_contract_confirmation -> running
running -> recovering -> running
running -> completed | failed | cancelled
running -> blocked (safe-stop or recoverable dependency diagnosis)

Guided only:
running <-> waiting_guided_decision
```

`awaiting_contract_confirmation` is prelaunch only for Autonomous. Once launched, Autonomous cannot enter `waiting_guided_decision`. Every transition is validated, transactionally persisted with an event, checkpointed when durable, heartbeat/lease updated, and given a human-readable reason.

## Decision taxonomy

- **Guided Decision:** one represented Guided action, exact normalized parameters, rationale, risk, and expiry.
- **Administrative Approval:** a policy/configuration/review decision, distinct from Guided progression.
- **Autonomous safe stop:** an explained outcome when no in-contract path remains, not a request for routine approval.
- **Optional intervention:** pause, abort, or start a versioned amendment; never required for ordinary Autonomous progress.

All appear in one purposeful Decisions area with journey-appropriate language.

## Readiness feasibility at current HEAD

Current source provides valuable foundations: risk classes, tool policy, specialist allowlists, MCP health, provider kinds/catalogs, managed/observe labels, approvals, evidence, memory/lesson gates, and process shutdown. It does not yet prove Autonomous feasibility because:

- Claude and Grok paths are represented as observe-only; OpenRouter enforceability depends on gate configuration;
- current managed flow awaits plan approval and can await user input;
- capability lists are duplicated in parts of the UI;
- no contract compiler resolves all action classes before launch;
- no durable supervisor/lease/checkpoint/recovery stack enforces no-intervention operation;
- no persisted Context Pack lifecycle or Brain availability contract exists.

V2 readiness must derive a per-mission answer from live manifests. It must never globally claim Autonomous support merely because one provider or tool path exists.

## Acceptance tests

- minimal authorized target launches each journey with generated defaults;
- Autonomous readiness blocks ambiguous scope, missing authorization, unenforceable required actions, or required unavailable Brain/MCP/provider;
- a launched Autonomous fixture never produces `waiting_guided_decision`;
- an out-of-contract Autonomous action safe-stops or chooses an in-contract alternative;
- Guided presents one explained action and does not execute until the exact decision exists;
- materially changed Guided parameters are rejected against the earlier decision;
- refresh/restart restores both journey checkpoints independent of conversation;
- Context Packs and memory influence are persisted at required lifecycle points;
- journey conversion creates an audited version/change and never mutates in place silently.
