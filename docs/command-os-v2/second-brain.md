# Second Brain architecture

Status: canonical graph records, lifecycle services, hybrid local retrieval,
Context Packs, graph/inbox/node/control UI, Vault projection, and typed local
runtime hooks at all 13 named lifecycle seams are present. Provider-backed
all-agent execution coverage and 50,000-node performance approval remain
release blockers.

## Canonical model

SQLite is the transactional source of truth. Memory nodes and typed directed
edges carry stable IDs, type, title, summary/body, scope, sensitivity,
confidence, lifecycle, confirmation, provenance, author, version, timestamps,
retention, and expiry. Mission facts/evidence remain distinct from personal
preferences and immutable evidence remains under its own retention policy.

Lifecycle states are candidate, confirmed, verified, disputed, stale,
superseded, and forgotten. Contradictions coexist until reviewed. Preferences
are candidate-only by default; agents cannot silently promote them.

## Retrieval and Context Packs

`MemoryRetrievalService` combines exact IDs, FTS5 lexical results, bounded
indexed graph-neighborhood expansion, recency, pinning, and confidence. It
enforces journey, engagement/mission scope, sensitivity, lifecycle, expiry,
explicit exclusions, and a hard context budget at every retrieval signal.
Only confirmed or verified nodes can enter an executable Context Pack.

Persisted Context Packs record purpose, mission/run/phase, selected and rejected
nodes, policy reasons, relevance/freshness, disclosure classification, context
budget, influence summary, corrections, latency, and quality. The UI exposes
Context used and graph paths without exposing hidden chain-of-thought.

## Operator experience

The Brain surfaces include home/health, graph, inbox, node detail, privacy
control, and Vault status. The graph uses a worker-backed canvas layout, bounded
queries, filters, saved views, local/global/mission modes, inspector, and a
non-canvas list alternative. Node actions include confirm, correct, dispute,
pin, expire, export, and forget where policy permits.

## Runtime contract and remaining proof

`BrainContextService` now defines 13 typed lifecycle hooks: intake, planning,
assignment acceptance, tool selection, attack attempt, phase transition,
failure, replan, finding validation, reporting, lesson proposal, evaluation,
and closeout. Each hook has a bounded node-type, sensitivity, graph-depth,
result-count, and context-budget policy. The service validates canonical
mission/run/step/action linkage, journey, V2 control-plane ownership, and
engagement isolation before delegating retrieval and Context Pack persistence
to the existing Second Brain service.

Every invocation writes a hash-chained audit receipt without raw query or memory
content. `required` hooks fail closed if Brain use or the audit receipt is
unavailable; `degraded_allowed` hooks persist an explicit empty degraded Context
Pack. `no relevant memory found` is also durable and distinct from degradation.
Coverage queries expose invoked and missing hooks per mission/run.

Current runtime implementations invoke the registry at mission intake,
Autonomous/Guided planning, assignment acceptance, tool selection, represented
attack-attempt start, material phase transition, failure/recovery, bounded
replan, finding validation, reporting, lesson proposal, evaluation, and
closeout. Guided result interpretation refreshes `phase_transition` context
before explaining a material result; planning and outcome-evaluation provider
boundaries receive disclosure-filtered Context Pack envelopes.

Operator plan amendments now participate in the same contract. PlanChange
`propose`, `edit`, and `apply` each retrieve and persist a `replan` Context Pack
after trusted lease authorization and before idempotency replay. The response
links the exact pack ID while the structured operator diff remains authoritative.
Required-memory Autonomous amendments fail closed before mutation when the
Brain is unavailable and leave a durable `blocked` hook audit receipt; no plan
change is created. Guided amendments may continue under policy with an explicit
empty degraded Context Pack whose retrieval metrics retain the dependency code.

Retrieval is not represented as influence merely because a hook ran. At local
deterministic boundaries that consult memory for readiness or audit but do not
consume a retrieved item—intake defaults, plan amendments, assignment/tool
gates, attack-attempt start, phase transition, failure/recovery, bounded replan,
finding validation, fixed-format reporting, terminal evaluation, lesson
proposal, and closeout—the service records an explicit `used = false`
disposition and bounded `ignored_reason`. The reason states which canonical
policy or represented input remained authoritative; influence summaries remain
null. This makes non-use inspectable without hidden reasoning or a false claim
that memory changed an action.

The remaining release work is provider-backed proof that every commander and
specialist consumes the appropriate minimum context at its real execution seam,
plus complete telemetry coverage and Autonomous/Guided unavailable/degraded E2E
paths. Existing hook presence and truthful non-use receipts do not by themselves
establish 100% all-agent Brain use.

No statement that “all agents use the Brain” is release-valid until those
integration tests and telemetry coverage reach 100%.
