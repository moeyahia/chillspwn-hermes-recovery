# Command OS V2 run supervisor

Status: implementation audit of the pure supervisory policy and durable orchestration coordinator as of 2026-07-17. The repository contains substantial deterministic safety logic and one true standalone process-boundary recovery proof. The standalone preview composition still does not wire a production execution runtime, so this is not an end-to-end autonomy claim.

## Responsibility boundary

The supervisor exists to turn a Mission/Run contract into bounded, observable, recoverable execution. It is not an LLM prompt convention.

The implementation is split across:

- pure policy under `server/supervisor/`;
- durable coordination under `server/orchestration/`;
- scheduling/dispatch under `server/command-runtime/`;
- persistence in V2 repositories, events/outbox, checkpoints, and continuations;
- mission/runtime routers and the standalone composition in `server/app/CommandOsApplication.ts` and `server/index.ts`.

The Commander plans, routes, supervises, evaluates, and synthesizes. Domain specialists execute. Any direct Commander execution must be an explicit, policy-bound exception.

## Run state machine

The public states are exactly:

- `queued`;
- `planning`;
- `awaiting_contract_confirmation`;
- `running`;
- `waiting_guided_decision`;
- `blocked`;
- `recovering`;
- `completed`;
- `failed`;
- `cancelled`.

Terminal states have no outgoing transitions. The core transition graph is:

```text
queued
  └─ planning
       ├─ awaiting_contract_confirmation  (Autonomous pre-launch only)
       ├─ running
       ├─ blocked
       ├─ failed
       └─ cancelled

running
  ├─ waiting_guided_decision              (Guided only)
  ├─ recovering
  ├─ blocked
  ├─ completed
  ├─ failed
  └─ cancelled

waiting_guided_decision
  ├─ running
  ├─ recovering
  ├─ blocked
  ├─ failed
  └─ cancelled

blocked
  ├─ running
  ├─ waiting_guided_decision              (Guided only)
  ├─ recovering
  ├─ failed
  └─ cancelled

recovering
  ├─ planning
  ├─ running
  ├─ waiting_guided_decision              (Guided only)
  ├─ blocked
  ├─ failed
  └─ cancelled
```

The implementation also permits direct terminal failure/cancellation from earlier states where shutdown or preflight failure requires it. Every transition requires a human-readable reason. The durable coordinator applies optimistic run-version checks, updates state, appends the event/outbox record, and persists the checkpoint in one transaction.

## Journey invariants

### Autonomous

- Contract authority must be versioned, immutable, hash-bound to the run, and confirmed before launch.
- `awaiting_contract_confirmation` is legal only before launch.
- `waiting_guided_decision` is illegal after launch.
- An action must match the exact authorized target, action type and class, destructive policy, plan/step/assignment, agent, and allowed tool policy.
- An out-of-contract action is not converted into an approval prompt. The run persists a safe-stop diagnosis/event and dispatch does not occur.
- Retry/recovery/replan are bounded by policy and budget. When no safe in-contract path exists, the run safe-stops or fails safely.

### Guided

- Each consequential action requires one visible, unexpired, unused decision for the exact normalized action and parameters.
- The decision fingerprint is consumed atomically with action reservation.
- Parameter substitution or material action change requires another decision.
- A failure is explained and represented as a recovery decision; the runtime does not silently retry a consequential step.
- Durable mission, plan, evidence, and decision state survive independently of the conversation transcript.

The selected journey is stored on Mission and Run and repeated on events, checkpoints, artifacts, and scoped audit records. Journey-changing work must branch or amend explicitly; it cannot be an implicit state transition.

## Action authorization and fingerprinting

`JourneyActionBoundary` creates a SHA-256 action fingerprint from:

- action/tool type;
- normalized arguments;
- scoped target;
- mission, run, step, and plan version;
- relevant preceding state.

Volatile request, trace, and timestamp-shaped values are removed so retries cannot evade repetition detection. Values that make the action materially different remain.

`RunRepository.authorizeAutonomousIntent` then performs the durable, stronger check against:

- verified mission authorization;
- exact signed contract version and hash;
- allowed action type and action class;
- destructive-action policy;
- normalized target scope;
- current plan/step/assignment;
- assigned agent;
- tool policy and availability.

Authorization is checked inside the reservation transaction and again immediately before asynchronous dispatch. A UI button or earlier planner response is not authority.

## Leases and fencing

Active runs use database-backed leases with:

- owner identity;
- acquisition and heartbeat times;
- expiry;
- fencing/version data;
- release behavior.

The default run lease is 30 seconds. Heartbeats extend only the current fenced owner. An expired owner cannot commit work as though it still owns the run.

There is also a `ControlPlaneLeaseService` for the `legacy` versus
`command_os_v2` ownership boundary. It hashes lease tokens, checks plane
identity, versions leases, and bounds TTL from one second to five minutes. The
live `MissionRuntimeEngine` now acquires this fence before planning,
continuations, Guided control mutations, and execution-result commits; active
heartbeats renew both the control-plane and run leases, graceful shutdown
releases the fence, and restart takeover is explicit. Five service tests plus
the live scheduler/restart integration cover this path. Mutation surfaces
outside the runtime engine have not all been routed through the same authority,
so server-wide enforcement remains a release gap.

## Meaningful progress

Raw command output is not progress. `ProgressEvaluator` recognizes deltas in twelve dimensions:

1. step state;
2. unique evidence;
3. finding creation/strengthening;
4. unique scoped entity discovery;
5. dependency resolution;
6. Guided decision resolution;
7. Autonomous contract milestone;
8. artifact production;
9. verified worker result;
10. measurable uncertainty reduction;
11. materially different plan change;
12. success-criterion advancement.

The result produces a progress signature used by loop detection, checkpoints, metrics, and recovery. Repeated stdout without a delta remains only a log.

## Loop and stagnation detection

Default pure-policy bounds are configurable and currently include:

| Detection | Default threshold |
|---|---:|
| History window | 50 actions |
| Identical fingerprint without progress | 3 occurrences |
| Alternating A/B cycle | 2 cycles / 4 actions |
| Completed actions without progress | 3 |
| Same error category | 3 |
| Materially equivalent replan | 2 |

The detector also represents Commander/specialist routing violations and exposes delegation-cycle analysis. These pure functions are well covered by unit tests.

Durable integration is partial:

- completed actions feed fingerprints, progress, errors, and budget state into the coordinator;
- equivalent-plan, routing-violation, and delegation-cycle facts are not all proven to be emitted by the mounted runtime path;
- there is no continuously active action-type-aware stagnation watchdog independent of runtime activity. Lease expiry catches lost owners, and wall-clock budgets are checked during coordination, but a living worker that emits no progress needs stronger time-based supervision.

## Retry policy

Automatic retries are limited to transient categories, including network failure, rate limit, provider/MCP unavailability, timeout, lost worker, and process crash where replay is safe.

Defaults:

| Parameter | Default |
|---|---:|
| Automatic retries | 2 |
| Backoff base | 500 ms |
| Backoff cap | 30 seconds |
| Jitter | 20% |

Provider `Retry-After` guidance is honored within policy. Invalid arguments, authorization/policy denial, scope conflict, operator rejection, deterministic missing dependency, destructive ambiguity, and an identical failed plan are nonretryable without a material change.

Provider-planning failures now use the same bounded policy without an in-memory sleep. For Autonomous runs, a retryable transient failure atomically accounts the failed provider turn and retry, persists category/count/eligibility in an event and checkpoint, and enqueues one exact `planning_retry_to_dispatch` continuation. The normal runnable-run scan excludes a run while that continuation is pending or owner-claimed. Its eligibility is exponential with jitter and honors bounded `Retry-After`; the signed retry, provider-turn, and wall-clock budgets can veto scheduling. The default maximum is two retries, after which Autonomous safe-stops with an explicit exhaustion reason. Guided planning does not silently use this Autonomous recovery path. Nonretryable failures still fail closed immediately.

An action is eligible for automatic resumption only when it is idempotent, non-destructive, still authorized, and fenced to the current run owner.

## Budgets and circuit breakers

The budget model covers:

- wall-clock time;
- provider tokens and estimated cost;
- tool calls and provider turns;
- retries and replans;
- concurrency;
- evidence bytes;
- artifact bytes.

Budget exhaustion produces a persisted diagnosis and visible state transition; it is not merely a UI warning.

Circuit-breaker policy has defaults of three failures before opening, 60 seconds before half-open, one half-open request, and one success to close. The coordinator records results, but start-action gating does not consistently call the breaker `allowRequest` path. Breaker enforcement is therefore not yet complete end to end.

## Durable action lifecycle

A normal action follows this sequence:

```text
authorize exact intent
  → acquire/fence run ownership
  → reserve action + update plan/assignment state
  → append event/outbox + checkpoint in one transaction
  → recheck authorization
  → dispatch asynchronously
  → normalize result
  → persist result and operational truth
  → evaluate progress, loops, budgets, retry/recovery
  → append next event + checkpoint + durable continuation
```

Runtime continuations close the crash window between committing one state and scheduling its next durable work. Long-running work does not depend on an open HTTP request.

## Failure and recovery

The durable coordinator classifies failure, persists progress made, and chooses a journey-safe outcome.

### Autonomous recovery

1. checkpoint and diagnose;
2. check authorization, idempotency, destructive risk, budgets, and retry category;
3. consult available failed-attempt/lesson context where wired;
4. retry a safe transient action at most within policy;
5. replan only when materially new facts or a different strategy exists and budget remains;
6. choose an in-contract outcome or persist `run.autonomous_safe_stopped`;
7. fail safely when no valid path remains.

The pure `RecoveryPlanner` also represents bounded alternative and reassignment choices. The durable coordinator does not currently receive/integrate those alternative or reassignment identifiers, so that branch is not yet a production capability.

### Guided recovery

1. checkpoint and diagnose;
2. preserve logs, observations, evidence, and artifacts;
3. prepare one represented recovery decision with exact parameters;
4. explain what failed, what was tried, and likely impact;
5. wait durably for the operator;
6. consume the chosen decision once and resume.

Every blocked/failed outcome should link a `FailureDiagnosis`. Operational-truth services implement the structured diagnostic record and Recovery UI; complete diagnosis coverage for every failure source remains part of integration testing.

## Checkpoint model

The coordinator checkpoints after durable transitions and material action results. A checkpoint currently captures or references:

- mission/run identity, journey, state, run version, and reason;
- plan version;
- last event sequence;
- completed action IDs;
- current in-flight action and its idempotent/destructive classification;
- lease identity/expiry;
- budget consumption;
- retry and replan counters;
- circuit, progress, and recovery state;
- a content hash for integrity.

The table permits a `context_pack_id`, but the checkpoint repository path does not currently populate it. The serialized state also does not yet provide a complete snapshot/reference set for all assignments, step states, evidence/artifact links, provider/tool circuit maps, and memory/lesson selections required by the full specification. Reconstruction relies on canonical current records and events for several of these domains.

## Restart and recovery

On startup/recovery, the coordinator scans nonterminal runs with expired leases, fences ownership, inspects the latest checkpoint and in-flight action, then:

- resumes an idempotent, non-destructive, still-authorized action;
- closes/replans interrupted planning turns where safe;
- marks unsafe or ambiguous work recovery-required rather than duplicating it;
- blocks with a precise reason when deterministic resume is unavailable.

One standalone process boundary is now proven by
`server/app/__tests__/StandaloneProcessRestart.test.ts`, exposed through the
stable `bun run test:process-restart` command. The test does not reconstruct
runtime objects twice inside one process. It:

1. starts `server/index.ts` as a child on a random loopback port with a unique
   database, Vault root, and script root under
   `/tmp/chillspwn-command-os-v2-e2e-data/`;
2. authenticates through `/api/v2/auth/session`, creates a real Guided Mission
   and intake Context Pack, completes the Vault write/read/rename/delete health
   check, connects the Vault, and exports an actual Markdown projection;
3. persists one expired run lease, one non-repeatable in-flight action, and one
   checkpoint through the canonical repositories/coordinator;
4. sends `SIGKILL` to the first V2 child and waits for process exit;
5. starts a second standalone V2 child against the same database and Vault;
6. reads the recovered run, checkpoint, Context Pack, Vault connection, sync
   state, events, and outbox through the supported API and canonical store.

The restart runtime is deliberately test-only. `server/index.ts` awaits its
startup recovery pass before listening only when
`COMMAND_OS_V2_TEST_RUN_CONTROL_RUNTIME=true`; the existing guard rejects that
mode unless the database is under the disposable E2E root and an explicit
fixture run ID is present. Normal preview and protected legacy processes cannot
enter this path accidentally.

The represented action is non-idempotent, has unknown completion after the
crash, and therefore cannot be repeated safely. Startup classifies it
`review_required`, clears the expired lease, moves the run to `blocked`, and
appends exactly one `run.recovery_blocked` event, one matching outbox record,
and one recovery checkpoint. The original action ID remains singular. Event
IDs and monotonic sequences remain unique, and the outbox event IDs remain an
exact one-to-one match with the run events. A subsequent bounded readback
window produces no second recovery record.

The focused execution passed **1/1 test with 44 assertions**. The same run also
proved that the Context Pack remained readable, the Vault stayed `connected`,
its canonical sync state survived, and the projected Markdown bytes were
unchanged after restart. The already-running protected legacy
`GET /api/health` returned `status: ok` before and after the V2 crash/restart.
Cleanup left no child V2 process and no `process-restart-*` temporary root.

This closes one fail-safe, non-repeatable-action restart boundary. It does not
prove a production provider/MCP runtime, safe idempotent action resumption,
every durable crash point, concurrent Vault sync, cancellation during real
child execution, or release soak.

## Cancellation

Cancellation uses a durable reservation plus cooperative `AbortController` propagation. The runtime must confirm child cleanup. The coordinator then closes or cancels child tool/action/decision/approval/step/assignment/plan records, releases the lease, writes the terminal event and checkpoint, and prevents a ghost-active run.

If cleanup cannot be confirmed, the run does not falsely report clean cancellation; it blocks or fails with preserved diagnosis.

## Standalone composition reality

The most important implementation boundary is at composition, not in the pure modules:

- `server/index.ts` constructs an unavailable provider/MCP/action runtime for the standalone preview;
- `CommandOsApplication` mounts runtime read routes but does not instantiate and mount `MissionRuntimeEngine` with production `MissionPlannerPort` and `ResultAwareExecutionPort` implementations;
- Guided Commander mutation routes are tested separately but the standalone composition mounts transcript reads rather than that mutation control plane;
- provider/MCP readiness therefore fail-closes real action dispatch.

This is the correct safe behavior for missing dependencies, but it means Autonomous end-to-end execution and the full Guided step loop are not shipped by the standalone preview.

## Verification present in the repository

Pure supervisor tests cover valid and invalid transitions, journey rules, action fingerprint normalization, exact Guided authorization, progress evaluation, identical and alternating loops, error taxonomy, retry/backoff bounds, budget and circuit policy, leases, recovery choice, and cancellation primitives.

Durable integration tests cover important transaction, out-of-contract safe-stop, checkpoint/continuation, replay-safe action, Guided decision, worker loss, and cancellation paths. The planning-retry suite additionally covers Retry-After, jitter bounds, two-retry exhaustion, signed provider-turn budget denial, nonretryable policy denial, Guided non-autonomy, and file-backed process restart after the exact retry was claimed without duplicating the next provider call. The standalone process-boundary suite additionally passed **1/1 with 44 assertions** across a real `SIGKILL`, server restart, fail-safe recovery, and Vault/Context Pack readback.

These tests support the individual safety mechanisms. They do not prove the missing production composition, every failure category, all-agent Brain hooks, browser controls, crash matrix, or release soak.

## Release-blocking gaps

1. Wire a real production `MissionRuntimeEngine`, planner, provider/MCP adapters, result-aware executor, and Guided Commander mutation surface into the isolated V2 process.
2. Extend the runtime's `ControlPlaneLeaseService` fence to every remaining V2
   mutation and prove legacy/V2 command conflict rejection at each route.
3. Gate action start with circuit-breaker `allowRequest`, not only record outcomes.
4. Integrate alternative/reassignment recovery, delegation-cycle detection, equivalent-replan detection, and routing-violation facts into the durable path.
5. Add an active, action-type-aware stagnation watchdog for living-but-not-progressing work.
6. Populate checkpoint Context Pack attribution and complete the required reference set or formally document deterministic reconstruction for each omitted domain.
7. Prove mandatory Brain retrieval at every commander/specialist lifecycle hook without allowing memory to override policy.
8. Expand the proven non-repeatable-action `SIGKILL` boundary to every durable boundary, safe idempotent resume, provider/MCP outage, cancellation cleanup, and concurrent control-plane contention.
9. Exercise all pause, resume, retry, reassign, replan, safe-stop, and cancellation controls through real browser E2E paths.
10. Complete the release soak and prove there are no indefinite transitional states or orphan processes.

No release or cutover claim is valid until the production composition and these integration gaps are closed.
