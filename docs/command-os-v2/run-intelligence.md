# Run intelligence, attack attempts, and recon digital twin

Status: canonical V2.4 services, migrations, authenticated HTTP routes, and read-only mission workspace surfaces are mounted in the isolated preview. Mutation routes remain local-policy gated and idempotent.

## Run metrics

`RunMetricsService` recomputes durable snapshots from canonical records. Each metric includes:

- a stable key, label, category, unit, value, and measurement quality;
- one or more drill-down references describing the canonical resource, aggregation, and filters;
- the event sequence through which it was computed;
- source-record counts;
- a recomputation hash and metric-schema version.

The service covers objective/plan progress, orchestration, attack attempts, discovery, evidence quality, reliability, provider resources, Context Packs, and verified lesson usage. Missing information is represented as partial or not observed, never as a decorative zero.

## Attack attempts

`AttackAttempt` is separate from a process or tool call. It records intent, target asset/service, technique, prerequisites, action class, normalized parameters, assigned agent/model, status, outcome, failure diagnosis, and evidence. A tool-process failure emits a signal but does not automatically classify the attack as failed. A successful attack attempt requires verified supporting or outcome evidence.

## Recon digital twin

Topology nodes and edges are mission/run scoped and require canonical evidence plus attributable agent/tool provenance. They retain confidence, verification state, sensitivity, first/last seen times, scope/lifecycle state, and conflicting observations. Cross-run edges and cross-mission evidence are rejected.

Every asset has a complete seven-layer OSI projection. An unobserved layer is returned as `not_observed`; it is never fabricated. Version observations retain derivation (`observed`, `actively_verified`, `inferred`, or `user_supplied`), evidence, confidence, time, and conflict group.

## CVE applicability

`CveApplicabilityService` stores version-aware applicability separately from service discovery. Records are scoped to a canonical asset or service/application topology node and preserve detected version, affected range, CPE/package match, confidence, concise reasoning, CVSS/CWE/EPSS/KEV metadata, source retrieval time/version, discovery agent, and authoritative source links.

The evidence gate is deliberately asymmetric:

- `possible`, `likely`, and `insufficient_evidence` may preserve a bounded hypothesis without overstating certainty;
- `confirmed` and `not_applicable` require both a detected-version comparison and a verified version-bearing evidence record;
- one banner-derived observation cannot confirm applicability unless another attributable source corroborates it or the version was actively verified;
- NVD, CVE.org, and MITRE URLs must use their official HTTPS origins and reference the same CVE ID;
- private, credentialed, local, or malformed source URLs are rejected before persistence and again at the browser schema boundary.

The selected asset/service inspector shows the canonical records, confidence, version comparison, evidence link, source freshness, and external authoritative sources. An empty inspector says that no evidence-backed mapping exists; it does not infer candidates from a product name.

## Verification evidence

- Run-intelligence router and foundation: 13 tests, 438 assertions before central composition.
- Metrics are recomputed twice in tests and compared by deterministic hash.
- Topology tests cover unknown layers, verified/corroborated/conflicting states, provenance, and scope rejection.
- Attempt tests prove tool failure is not attack failure and success is evidence-gated.
- CVE tests prove banner-only confirmation fails, source/record mismatches fail, topology target types are enforced, optimistic updates are required, and unsafe source origins never reach the UI.

The centrally mounted truth-layer checkpoint (run intelligence, operational truth, application composition, and API contract) passes 36 tests and 634 assertions.
