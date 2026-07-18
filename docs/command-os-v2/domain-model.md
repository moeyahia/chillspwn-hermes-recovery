# Command OS V2 domain model

Status: implemented schema and service boundaries at the current V2.4 preview, audited 2026-07-16. This document describes code that exists under `chillspwn/plugin/command-os-v2`; future requirements are listed separately and are not described as shipped.

## Evidence base

The model below is derived from:

- migrations `001_core.ts` through `010_v24_operational_truth.ts`;
- mission creation in `server/missions/MissionRepository.ts`;
- journey and action guards in `server/supervisor/RunStateMachine.ts`, `JourneyActionBoundary.ts`, and `server/orchestration/RunRepository.ts`;
- durable execution records in `server/orchestration/` and `server/command-runtime/`;
- operational-truth, run-intelligence, CVE, plan-change, Brain, Vault, learning, and Research Lab services;
- the routers actually mounted by `server/app/CommandOsApplication.ts` and `server/index.ts`.

Schema presence is not treated as proof of an operational workflow. The implementation-status tables below identify table-only domains and composition gaps.

## Aggregate map

```text
Mission
  ├─ authorization scope, constraints, targets, journey
  ├─ Autonomous Contract revisions and immutable launch binding
  ├─ Run 1..n
  │   ├─ Plan versions ── Plan steps ── Assignments ── Actions ── Tool calls
  │   ├─ Guided decisions or Autonomous contract authority
  │   ├─ Events + outbox + checkpoints + continuations
  │   ├─ Logs ── Observations ── Evidence candidates ── Verified evidence
  │   ├─ Attack attempts ── Failure diagnoses
  │   └─ Evaluation + metrics + reusable-learning proposals
  ├─ Recon topology ── OSI observations ── CVE applicability
  └─ Artifacts, findings, reports, conversations, and Brain links

Second Brain
  ├─ Memory nodes/edges/sources/versions/candidates
  ├─ Context Packs and actual-use attribution
  ├─ Preferences and verified lessons
  └─ Obsidian projection/sync/conflicts

Research Lab
  ├─ Human-owned campaign/charter
  ├─ Strategy and benchmark versions
  ├─ Experiments, metrics, failures, and near misses
  └─ Integrity/exposure receipts and staged promotion records
```

## Non-negotiable identity invariants

### Exactly two journeys

The only persisted journey values are `autonomous` and `guided`.

- `missions.journey`, `runs.journey`, and `events.journey` use SQLite `CHECK` constraints.
- `run_evaluations.journey` is mandatory. Migration 007 adds and validates journey on artifacts, checkpoints, and mission/run-scoped audit records.
- Plans and steps derive journey through their Run; they do not currently duplicate a journey column.
- `RunStateMachine` excludes `waiting_guided_decision` for Autonomous and excludes `awaiting_contract_confirmation` for Guided.
- An Autonomous run may enter `awaiting_contract_confirmation` only before launch. Launch requires a confirmed contract.
- A Guided wait must name one exact pending decision, and resumption must name the same decision. Migration 009 fail-closes ambiguous historical rows and enforces at most one pending Guided decision per Run.
- An Autonomous action is checked against the bound contract revision, current authorization, exact target, action type/class, destructive policy, specialist assignment, plan, step, agent, and tool policy before dispatch.
- A Guided action is bound to mission, Run, step, expiry, and the SHA-256 fingerprint of its represented action and normalized parameters. A changed action requires a new decision.

The schema also rejects an Autonomous Run row whose status is `waiting_guided_decision`. These are runtime and database invariants, not UI labels.

### One control plane per Run

Migration 010 adds `control_plane = legacy | command_os_v2` to Mission and Run plus `control_plane_leases`. `ControlPlaneLeaseService` verifies that a Run belongs to the requesting plane, stores only a SHA-256 lease-token digest, uses expiry and optimistic versions, and rejects conflicting mutation authority.

Current limitation: this service is unit-tested but is not injected into every mounted mutation router or into `MissionRuntimeEngine`. The columns default to `command_os_v2`, but server-wide control-plane lease enforcement is not yet proven. Until that wiring and integration coverage exist, control-plane isolation is a schema/service foundation rather than a completed release invariant.

## Core aggregates and ownership

| Aggregate | Canonical records | Implemented ownership rule |
| --- | --- | --- |
| Mission | `missions`, `mission_targets`, `mission_constraints` | Durable objective, authorization, scope, selected journey, retention, and memory policy. A conversation never owns execution state. |
| Autonomous Contract | `mission_contracts`, `mission_contract_snapshots`, Run binding columns | Confirmed contract revisions are hashed. A launched Run is bound to the exact contract ID, version, and hash; migration 008 makes that binding immutable. |
| Run | `runs`, `run_branches`, `control_plane_leases` | One execution attempt within a Mission. State, budget, lease, current Plan/step, owner, progress, and reason survive the UI. Multiple Runs preserve Mission continuity. |
| Plan | `plans`, `plan_steps`, `plan_step_versions`, `plan_change_requests` | Versioned strategy and dependency-ordered steps. Applying a validated change creates a new Plan and step snapshots; it does not mutate an active Plan in place. |
| Assignment and Action | `assignments`, `actions`, `tool_calls` | Specialist ownership is separate from represented work. An Action stores normalized arguments, scoped target, fingerprint, decision/contract basis, context-pack reference, trace IDs, result, and error category. |
| Guided Decision | `guided_decisions` | One represented consequential Guided action. Approval is exact, expiring, single-use authority; it is distinct from an administrative `approval`. |
| Event and Checkpoint | `events`, `event_outbox`, `checkpoints`, `runtime_continuations` | Events are append-only and sequenced per Run. Checkpoints are hashed snapshots. Continuations close commit-to-next-work gaps and can be reclaimed after lease expiry. |
| Evidence and Finding | `evidence`, `evidence_chain_events`, `findings`, `finding_evidence`, `artifacts` | Verified evidence is immutable. A finding cannot become verified without linked evidence unless an explicitly audited operator override is used. |
| Brain and learning | memory, preference, lesson, context-pack, Vault, evaluation tables | Reusable memory is distinct from immutable evidence. Context Packs record retrieved and used nodes. Lesson verification requires independent review and evidence. |

## Operational-truth semantics

The implemented intelligence ladder is deliberately non-equivalent:

1. `engagement_log_records` stores technical chronology, including raw output.
2. `observations` stores parser-attributed statements and links them to log sources.
3. `evidence_candidates` stores proposed material plus validation requirements and review state.
4. `evidence` stores immutable, hash-bearing evidence.
5. `findings` stores conclusions linked through `finding_evidence`.

Raw output does not become evidence merely because it contains a matching string. The mounted `OperationalTruthService` performs explicit promotion/rejection and writes audit records. `FailureDiagnosis` is a separate structured record linked to the failed subject, prior progress, logs, preserved material, retryability, remediation, and valid operator actions.

## Recon and attack intelligence

The implemented Run-intelligence boundary contains:

- `AttackAttempt`, which records objective, target, technique, action class, prerequisites, normalized parameters, assignment/model, outcome, failure, and evidence separately from a process exit;
- a mission-scoped topology of typed nodes and edges, each carrying scope state, confidence, verification, sensitivity, attribution, and first/last seen times;
- evidence links for topology and seven-layer `asset_layer_observations`, including explicit `not_observed` values rather than fabricated layers;
- reproducible `run_metrics_snapshots` with event cutoff, source counts, schema version, drill-down definitions, and recomputation hash;
- version-aware `cve_applicability_records` with authoritative-source validation and an evidence gate for `confirmed` and `not_applicable` states.

These services and read surfaces are mounted. Script and page-capture tables exist, but no corresponding production service/router or IDE/capture pipeline exists yet.

## Migration 010 V2.4 domains

Migration 010 is additive and creates 42 tables. Their actual implementation status is:

| Domain | Tables | Current status |
| --- | --- | --- |
| Control and registries | `control_plane_leases`, `capability_registry_snapshots` | Lease service exists; global mutation wiring is missing. Registry snapshots are schema-only. |
| Operational truth | `engagement_log_records`, `observations`, `observation_log_sources`, `evidence_candidates`, `failure_diagnoses` | Repository/service/router and mission UI are mounted. |
| Attack and metrics | `attack_attempts`, `attack_attempt_evidence`, `run_metrics_snapshots` | Repository/service/router and read UI are mounted. |
| Digital twin and CVEs | `topology_nodes`, `topology_edges`, `topology_evidence_links`, `asset_layer_observations`, `cve_applicability_records` | Topology/OSI and CVE services are mounted with scope/evidence validation. |
| Plan editing | `plan_change_requests`, `plan_step_versions` | Service/router and Plan panel are mounted. Current UI edits the strategy summary; direct node/path/step manipulation, Plan comparison, and rollback UI remain. |
| Generated assets | `script_artifacts`, `page_captures` | Schema only; no production creation, test, capture, gallery, or IDE service is mounted. |
| Models and disclosure | `model_configurations`, `agent_model_assignments`, `provider_exposure_receipts` | Attack attempts validate referenced model assignments; Research reads exposure counts. Live catalog persistence, resolved assignment service/UI, and a universal receipt writer are not complete. |
| Research | `research_campaigns`, `research_charters`, `research_dimensions`, `strategy_versions`, `strategy_patches`, `benchmark_families`, `benchmark_scenarios`, `benchmark_snapshots`, `experiments`, `experiment_runs`, `experiment_metrics`, `experiment_events`, `experiment_failures`, `near_misses`, `integrity_receipts`, `promotion_reviews`, `strategy_deployments`, `strategy_rollbacks`, `research_context_packs`, `research_context_items` | Campaign creation/stop, policy schemas, evaluator, search, integrity, and promotion primitives exist. Experiment execution is intentionally blocked because the approved charter, immutable benchmark snapshot, disposable lab, isolated worker, and signer are unavailable. |

## Memory, evidence, and research remain different data classes

- Evidence is immutable, mission-scoped proof with custody history.
- Operational memory is versioned graph knowledge with scope, sensitivity, confidence, lifecycle, provenance, and retention.
- Preferences require confirmation/consent policy and cannot weaken safety.
- Lessons require review and evidence; an authoring agent cannot verify its own lesson.
- Research candidates are strategy versions evaluated in a separate trust boundary; they cannot alter authorization, evaluator, benchmark, disclosure policy, or production source.
- The Obsidian Vault is a synchronized Markdown projection/import surface. SQLite remains transactional authority.

## Implemented integrity rules

- Mission creation writes Mission, scope, constraints, optional contract, Run, events/outbox rows, audit, and idempotency response in one `IMMEDIATE` transaction.
- Events, evidence, evidence-chain events, audit records, memory versions, immutable context selections, contract snapshots, branches, and evaluation comparisons have database immutability triggers where defined.
- Journey mismatches on artifacts, checkpoints, and scoped audit records are rejected by triggers.
- Foreign keys and JSON validity checks protect relational and structured fields.
- Hashes bind contracts, plans/checkpoints, evidence/artifacts, audit records, metrics, strategy versions, benchmarks, and research receipts in their respective services.

## Explicit implementation gaps

The following requirements are not shipped even though adjacent types or tables exist:

- The standalone server deliberately reports providers/MCP/action boundary unavailable and does not instantiate `MissionRuntimeEngine`, a production `MissionPlannerPort`, or a production `ResultAwareExecutionPort`. It mounts runtime reads, not the runtime mutation router.
- Guided Commander mutation routes are tested in isolation but are not mounted by the standalone composition; only transcript reads are mounted there.
- Control-plane leases are not yet enforced by every mutation endpoint.
- Script Artifact, page capture, live model-catalog assignment, and registry-snapshot writers are not operational services.
- Required Brain hooks are not yet proven for every commander/specialist lifecycle point, even though memory retrieval, Context Packs, and several runtime attribution paths exist.
- Research has no disposable-lab experiment runner and exposes no run/promote endpoint.
- Journey conversion is represented by Run branching/contract amendment records; a complete user-facing conversion workflow is not mounted.
- Full historical reconciliation, every-route crawl, exhaustive browser interaction coverage, cross-browser visual baselines, soak, and cutover approval remain release gates.

These gaps prevent a release or cutover claim.
