# Command OS V2 security review

Status: preview security boundaries are implemented and tested in focused
suites. A final independent review and release hardening sign-off remain open.

## Isolation and authority

- V2 has its own process, port, database, artifacts, API namespace, browser
  storage namespace, cache namespace, event resume keys, and telemetry label.
- The standalone server rejects memory databases and known legacy paths.
- Legacy import is one-way and source-preserving; no preview dual-write exists.
- `runs.control_plane` and `missions.control_plane` record ownership. The
  control-plane lease service stores only a token digest. Wiring this lease
  assertion through every remaining mutation surface is still a release gap.
- The kill switch serves only a fail-closed V2 error and does not stop legacy.

## HTTP and session boundary

The standalone API binds to loopback by default. Operational routes require a
24-byte-or-longer operator token or signed local session. Unsafe cookie-based
requests require a V2-specific CSRF header. The server emits CSP, frame denial,
content-type, referrer, resource/opener, and restrictive permissions headers.
CORS allows one configured V2 UI origin. JSON bodies are bounded to 1 MiB.

The isolated V2 dependency graph now reports `No vulnerabilities found` from
`bun audit`. The remediation upgraded V2-only Express to 5.2.1, removed the
unused direct `ws` dependency, and replaced the `concurrently` shell launcher
with a signal-aware Bun process supervisor; no protected legacy dependency was
changed. Express 5 route grammar is covered by a focused regression test, and
the standalone static preview has passed real browser startup and deep-link
navigation. This is a point-in-time advisory result, not an SBOM, license, or
independent supply-chain sign-off.

Every V2 error uses a request/trace identifier and a bounded error envelope.
Mutations that can duplicate harm require idempotency keys and mutable records
use expected versions where implemented.

## Mutation-authority inventory and CI guard

The V2 mutation surface now has a bounded, machine-readable source of truth in
`chillspwn/plugin/command-os-v2/server/security/MutationAuthorityInventory.ts`.
It classifies all **75 unique** `POST`, `PUT`, `PATCH`, and `DELETE` routes under
`/api/v2` by authority class, owning service, authentication, cookie-session
CSRF requirement, idempotency, optimistic-concurrency boundary, and
control-plane enforcement. The source contains **89 Express declarations**:
the additional 14 are explicitly inventoried active-runtime/fail-closed
alternatives for Guided Commander, exact Guided decisions, and run controls.
They are not silently accepted duplicates.

`scripts/lib/discoverV2MutationRoutes.ts` parses production router sources
without importing routers or opening a database. The focused CI test fails for:

- an unevaluable or unclassified V2 mutation route;
- a stale inventory record;
- a duplicate inventory key;
- an added, removed, or moved route implementation source;
- incomplete auth, CSRF, idempotency, concurrency, service-owner, or
  control-plane classification metadata.

Only four bounded routes do not require an idempotency key: local session
creation/deletion and the two read-like POST resolvers for intake defaults and
Autonomous preflight. Protected unsafe requests always require operator
session-or-bearer authentication; cookie-session requests also require the V2
double-submit CSRF proof. A bearer request has no ambient cookie authority and
therefore does not use the cookie CSRF proof.

The audit deliberately reports rather than conceals **31 policy-scoped
control-plane gaps**. Existing role/scope, idempotency, and version checks stay
active, but these surfaces do not yet share `ControlPlaneLeaseService` or an
equivalent complete V2 ownership fence:

- Autonomous branch preflight/create (2) and terminal mission bulk archive (1);
- active Guided Commander contextual actions (6; standalone preview remains
  fail-closed when its provider runtime is absent);
- operational-truth ingestion/review/finding/failure mutations (10);
- CVE applicability (1) and topology/OSI mutations (3);
- follow-up run creation (1).

Already fenced surfaces are recorded distinctly: Mission Runtime run/decision
commands use the control-plane lease; page captures and script artifacts assert
V2 mission/run ownership; recovery mutations assert V2 ownership plus exact
run/plan/step/checkpoint state and a durable worker lease; mission creation is a
pre-creation boundary; imported mission metadata export is intentionally
read-only across control planes. Deterministic run-metrics recomputation now
requires V2 mission/run ownership without taking an execution lease. Plan
proposal/edit/apply/reject and attack-attempt create/transition now require a
current proof from the server-side runtime lease holder; raw HTTP headers cannot
supply that proof, and idempotency replay is not an authorization cache. This
report is an authority map, not a claim that the remaining 24 release gaps are
closed.

Focused inventory validation on 2026-07-16: 5 tests passed, 0 failed, 772
assertions, including exact reconciliation with all live and deferred V2 API
contracts. The guarded plan/intelligence/application slice passes 29/29 with
1,066 assertions; the real Chromium plan flows pass 6/6.

## Execution and policy

- The standalone preview advertises providers and MCP execution as unavailable
  unless an enforcing runtime adapter is actually present.
- Autonomous launch readiness fails closed when authorization, scope,
  enforcement, required providers/MCP, budgets, or Brain policy cannot be
  enforced.
- Guided execution binds approval to an action fingerprint and canonical exact
  parameters; changed parameters require a new decision.
- Plan amendments are proposal-only until an exact diff passes dependency,
  scope, action-class, specialist, readiness, and in-flight checks.
- Raw logs are not promoted to verified evidence merely because text matches a
  claim.

## Data and public-provider boundary

Prepared statements are used for user-controlled values. SQLite uses foreign
keys, WAL, busy timeout, migrations, and startup integrity checks. Evidence and
critical audit records have hashes/provenance. Secret-like reusable memory is
rejected or quarantined, and forgetting removes retrievable content while
retaining only a content-free audit/suppression record.

The Research Lab public-model contract is proposal-only. It excludes raw
evidence, credentials, transcripts, packet/HTTP bodies, unrestricted source,
and the full Brain. Candidates cannot alter authorization, evaluator,
benchmark, disclosure policy, allowlists, or production code. Experiment
execution remains blocked until the local immutable harness and signer exist.

## Open release blockers

- close the 24 inventoried policy-scoped control-plane gaps and reduce the
  machine-audited gap count to zero;
- production-grade encrypted sensitive-value storage and key management review;
- upload/content sniffing and artifact path review across every future artifact
  and page-capture endpoint;
- archived release-candidate dependency/SBOM/license review and advisory scan;
- final CSP validation for every optimized media and worker path;
- cross-engagement, prompt-injection, and public-exposure full integration
  suite across the eventual execution adapter;
- independent security sign-off.
