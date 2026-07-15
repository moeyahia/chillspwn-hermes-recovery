# Run supervisor

The RunSupervisor is deterministic infrastructure, not a prompt convention.

## Responsibilities

- validate journey-aware state transitions;
- claim and renew run/assignment/action leases;
- checkpoint durable transitions and material results;
- calculate action fingerprints and progress signatures;
- detect repetition, alternating cycles, equivalent replans, lost heartbeat, ignored results, and no-progress windows;
- classify errors and apply bounded retry/backoff;
- enforce time, token, cost, tool, retry, replan, storage, and concurrency budgets;
- operate provider/tool/worker circuit breakers;
- choose bounded recovery, reassignment, or safe stop;
- propagate cancellation and verify child cleanup;
- recover nonterminal runs deterministically after restart.

## Default bounds

Defaults are configurable by action class and contract. A safe baseline is two transient retries, three materially identical fingerprints in a rolling window, two automatic replans, and evaluation after three completed actions without progress.

Authorization/policy denials, operator rejection, invalid unchanged arguments, deterministic missing dependencies, destructive ambiguity, and identical failed plans are not retried.

## Journey behavior

Autonomous recovers inside contract or safe-stops. It never enters `waiting_guided_decision` after launch. Guided explains failure, proposes one recovery and alternatives, then waits on one explicit durable decision.

## Isolated restart/resume acceptance — 2026-07-15

The current source was synced to the disposable candidate at
`/opt/chillspwn-command-os-live-gate-20260715T200938Z/webapp` and exercised as
the unprivileged `chillspwn` user on `127.0.0.1:43132`. The Guided prelude
created one exact decision and then cancelled cleanly. The Autonomous run was
observed in `planning`, entered `running`, was interrupted by SIGKILL, resumed
from exactly one recovery checkpoint after restart, and completed without ever
entering `waiting_guided_decision` after launch.

The terminal state contained exactly one action, one tool call, one verified
evidence record, and one evaluation. No run, assignment, action, or tool call
remained ghost-active. The execution used the reviewed no-network asset only
through `sechub-reconnaissance.quick_scan`; its root ownership, non-writable
path, exact SHA-256, closed config, and deterministic input template were
attested before projection. Production remained running at the same PID, with
zero restarts, HTTP 200, and the same release symlink. This was an isolated
source-candidate acceptance gate, not a deployment or promotion.

## Execution-authority boundary

Autonomous authority is checked at more than plan creation:

1. Plan admission requires both normalized `actionType` and `actionClass` to be
   present in the confirmed contract allowlist and absent from its prohibited
   list. The target and assigned specialist must match the signed boundary, and
   a destructive action is admitted only under the exact `contract_only`
   policy.
2. Immediately before MCP dispatch, the runtime resolves the action's canonical
   assignment and re-evaluates the current specialist/tool policy. Autonomous
   accepts only `allow`; `require_approval` and `deny` fail closed before an MCP
   call, tool result, or evidence side effect.
3. Retry and restart recovery re-check current mission authorization, contract
   identity/version/state, action type and class, destructive policy, target,
   assignment-to-step ownership, signed specialist, MCP server/tool binding,
   specialist routing map, and current tool decision. Historical authority is
   never sufficient to resume an action after policy drift.

Guided approval-gated MCP execution is also outside prompt discretion. The
runtime derives an expiring attestation only from a resolved canonical decision
for the exact running action. It binds run, step, action, specialist, server,
tool, canonical argument hash, operator, decision time, and expiry. The bridge
atomically consumes the claim once; changed arguments, replay, expiry, or
missing provenance fail closed.

## Durable mutation fencing

Guided provider-backed commands reserve their idempotency key in the canonical
database before Context Pack creation, evidence ingestion, provider turns,
events, or conversation writes. The reservation has an owner token, bounded
lease, heartbeat, expired-owner takeover, and owner-fenced completion/release.
Two processes therefore cannot both perform one Guided request, while a crashed
owner can be recovered without leaving the key permanently stuck.

Persisted Context Packs validate their complete canonical linkage inside one
immediate transaction. Mission, run, plan/step, action, message, scope-policy,
and journey relationships must agree; a failed link check leaves no partial
pack or item rows. This keeps restart/recovery context from crossing run or
engagement boundaries.

## Durable transition continuations

Every database commit that requires later work writes a deduplicated
`runtime_continuations` row in the same immediate transaction. This covers plan
dispatch, exact Guided approval dispatch, successful action/manual-result
advance, bounded Autonomous retry dispatch, Guided failure recovery, final
evaluation, cancellation finalization, and operator resume. A continuation is
claimed with an owner token and lease;
`processing` work is reclaimable only after lease expiry, and completion is
owner-fenced.

Startup repairs legacy commit gaps from canonical mission/run/plan/action state,
replays cancellation before ordinary work, drains committed continuations, and
then classifies any genuinely in-flight action. A running action is never
redispatched by the continuation queue: only the coordinator may resume it,
after idempotency, destructive-risk, authorization, contract, assignment, and
current MCP/tool-policy checks all pass.

A retry never redispatches the failed action. The failed-result transaction
first revalidates its canonical current contract, plan, step, assignment, agent,
scope, and tool policy, then requeues only that assignment and step and records
a delayed continuation. At the persisted `notBefore` time, the continuation
creates a new action linked through `parent_action_id`; that reservation still
passes the ordinary action-time and final pre-dispatch boundaries. Restart
replay can therefore distinguish a retry that was not yet reserved from one
that was reserved but lost its worker before dispatch.

Cancellation records its continuation before external cleanup. Once cleanup is
confirmed, run state, mission projection, plans, steps, assignments, actions,
tool calls, Guided decisions, approvals, terminal evaluation, audit, event, and
checkpoint state are reconciled without leaving ghost-active children. Pause
and resume commit run state, mission projection, checkpoint/event, and audit in
one transaction; a recovery resume also writes its continuation atomically.
