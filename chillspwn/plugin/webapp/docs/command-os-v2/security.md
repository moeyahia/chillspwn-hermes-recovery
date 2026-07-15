# Security review and target controls

Review date: 2026-07-15

Scope: the V2.1 recovery worktree, final immutable release, canonical migration,
and promoted service boundary. No secret values or user payloads are included.

## Release assessment

The promoted schema-7 release materially strengthens memory privacy, database
integrity, path handling, evidence review, event redaction, and diagnostic
logging. The tracked deployment boundary reflects the hardened two-service
`/opt` plus `/var/lib/chillspwn` layout. Canonical migration, deployed
permissions, secret scans, provider smoke, process restart/resume, and exact
application rollback/return were verified.

The current **unpromoted** worktree adds a stricter Autonomous execution
boundary, durable exact-step Guided MCP approval, cross-process Guided mutation
idempotency, Context Pack linkage validation, explicit lesson-use consent,
immutable Autonomous branch/amendment lineage, a canonical Decisions inbox,
actor-scoped in-app notifications, and current-authorization rechecks for cached
Second Brain mutations and portable archive delivery. Those changes have source,
focused, interim aggregate, and browser evidence recorded in
[`test-evidence.md`](test-evidence.md), but they are not attributed to the live
service. The same unpromoted source also passed an isolated Grok OAuth
SIGKILL/restart gate under the `chillspwn` uid, with a root-owned hash-pinned
no-network asset and no API key; that gate did not deploy or promote the source.
Production intentionally remains on schema 7. A current-checksum
schema-8 bridge has now been rebuilt from the exact live schema-7 release and
passed the complete isolated schema 7 → bridge → schema-9 candidate,
restart/rollback, and production non-interference rehearsal. It has not been
promoted or baked, and the gate must be repeated from the final reviewed commit
before approval. The prior schema-8 bridge artifact still predates the current
migration checksum and remains superseded; it must not be executed or promoted.

Residual risk is explicit: the current actor remains single-operator,
sensitive canonical data relies on host/storage encryption, providers share one
constrained service uid, and the retained Hermes snapshot has open dependency
alerts.

## Preserved foundations

- visible authorization and target scope;
- no-hands commander with specialist execution;
- deterministic tool risk classification;
- Grok ACP commander tool-surface attestation;
- target/path validation and symlink defenses;
- secret and target-identity filtering for reusable memory;
- evidence-gated lessons;
- provider child environment allowlists;
- canonical SQLite memory with engagement/sensitivity policy and a controlled
  Obsidian-compatible projection; no root memory-broker runtime dependency.

## V2.1 controls

- versioned Autonomous Mission Contract enforced at action time;
- exact normalized Guided decision fingerprints;
- exact, durable, single-use Guided MCP approval attestations;
- prepared SQL and request schema validation;
- idempotency keys and optimistic concurrency;
- durable cross-process reservations around Guided provider side effects;
- immutable policy/audit records and evidence hashes;
- request/trace IDs, secure headers, CSRF/session hardening where applicable;
- upload limits, content-type validation, output encoding, path sandboxing;
- secret redaction before logs/events/memory;
- memory sensitivity, engagement isolation, retention, correction, and forgetting;
- vault root sandbox, atomic sync, and conflict review;
- versioned Autonomous branching only after the source reaches a safe boundary;
- canonical scoped/redacted Guided, Autonomous exception, contract, and
  administrative decision records;
- transactional redacted in-app notification projection with actor-scoped read
  receipts;
- authorization-bound idempotent Second Brain replay and portable archive
  download validation;
- cancellation propagation and orphan detection;
- default-off legacy execution compatibility: unversioned writes, `/proxy`,
  legacy chat/terminal WebSocket commands, queued-board dispatch, OSINT
  rehydration, and legacy startup writers remain inert unless a rollback-only
  opt-in is enabled; compatibility reads remain available for reconciliation.

Provider paths that cannot enforce scope/tool/delegation boundaries remain advisory or Guided-only. A preference can never weaken authorization, evidence, or policy requirements.

## Candidate controls verified by source and focused tests

- Canonical SQL uses prepared statements and repository-owned transactions;
  migrations enable foreign keys, WAL, a busy timeout, integrity checks, and
  append-only guards for evidence/audit/version records.
- Autonomous plan admission requires both normalized action type and action
  class to be signed and not prohibited, exact target membership, assignment to
  the signed specialist pool, and `contract_only` authorization for every
  destructive action. A mismatch safe-stops before dispatch.
- Immediately before an MCP call, the runtime re-evaluates the current
  specialist/tool policy. Autonomous execution accepts only `allow`;
  `require_approval` and `deny` fail closed without creating an MCP execution,
  tool result, or evidence record.
- Autonomous retry and restart recovery re-check current mission authorization,
  contract identity/version/state, both action fields, destructive policy,
  target, action-to-assignment ownership, signed specialist, exact MCP
  server/tool binding, specialist mapping, and current `allow` policy. A policy
  drift to `require_approval` or `deny` cannot be resumed from historical
  authority.
- Approval-gated Guided MCP execution requires a durable exact-step attestation
  derived from the approved canonical Guided decision. It binds run, step,
  action, specialist, server, tool, canonical argument hash, actor, resolution
  time, and expiry, and is atomically consumed once. Changed parameters,
  replay, expiry, or missing provenance fail closed. The legacy execution route
  uses the same exact-binding and one-time-consumption principle through its
  compatibility claim.
- Guided provider-backed mutations reserve the idempotency key in SQLite before
  Context Pack, provider-turn, evidence, event, or conversation side effects.
  Owner fencing, bounded lease renewal, expired-owner takeover, and replay of
  the winning completion prevent two service processes from duplicating work.
- Memory node creation, correction, and candidate ingestion validate canonical
  mission-to-engagement ownership. Retrieval rejects malformed/imported rows
  whose engagement conflicts with their mission. Context Pack persistence then
  validates every optional mission, run, plan/step, action, message,
  scope-policy, and journey link plus every selected node's canonical scope,
  lifecycle, version, sensitivity, and journey permission transactionally.
  Missing or cross-scope links, malformed rows, and journey mismatches leave no
  partial pack or item rows; an intentionally unlinked global pack remains
  supported.
- Graph scope is derived from canonical mission ownership even when a node's
  human label omits an engagement. Cross-engagement edges and edge scopes whose
  mission/engagement pair conflicts fail closed instead of joining isolated
  memory clusters.
- Follow-up lesson selection requires an independently verified lesson and
  memory node plus an explicit journey permission. A missing
  `allowAutonomous`/`allowGuided` flag is denied rather than treated as consent.
- Autonomous branch creation rejects a running or otherwise unsafe source, stale source version,
  stale contract review, or another active mission run. A terminal source may
  create exactly one idempotent successor under the unchanged contract or a
  fully revalidated draft. The source run/contract binding remains immutable,
  the previous contract is retained as superseded lineage, and the new run starts
  in Autonomous planning without a user-wait state.
- The canonical Decisions repository applies mission scope and event sensitivity
  before returning exact Guided decisions, contract history, Autonomous
  safe-stop/exception records, or administrative approvals. Technical event and
  request payloads are recursively redacted. An administrative review is audited
  but explicitly cannot change runtime state or unblock a running Autonomous run.
- Notification rows are projected transactionally from an explicit event
  allowlist using fixed semantic copy; event summaries, payloads, provider
  output, and tool output are never copied into the notification store. Journey
  mismatches fail closed. List/count/read operations reapply actor, engagement,
  mission, and sensitivity scope, while human-only read mutations use durable
  actor-scoped receipts and authorization-bound idempotency.
- Cached Second Brain mutation responses are not trusted as perpetual authority.
  Replay stores and checks the actor plus a normalized access-policy fingerprint,
  then reruns the route-specific current-resource authorization before returning
  cached content. Revoked access receives the same generic 404 as an absent
  resource.
- Portable Obsidian archive authorization is private server state bound to the
  creating actor, normalized access, vault connection, exact node IDs, archive
  name, byte size, SHA-256, and creation time. Replay/download revalidate owner,
  current access to every live node in bounded SQL batches, connection/file
  identity, size, and a SHA-256 calculated immediately before response streaming.
  Downloads are server-named, no-store,
  same-origin, `application/zip` attachments with CSP sandbox, CORP, no-referrer,
  and no-sniff; unknown, unauthorized, forgotten-node, or tampered archives
  return a generic 404.
- MCP execution is specialist-bound, allowlisted, cancellation-aware, and
  receives an explicit minimal child environment.
- The isolated live-gate tool projection is doubly opt-in and identity-bound:
  the child receives an exact one-purpose attestation token, while the server
  independently requires a closed one-server configuration, root-owned
  non-writable regular files with no symlink traversal, the exact pinned asset
  SHA-256, the roster-approved `ReconScout`/
  `sechub-reconnaissance.quick_scan` binding, and the attested deterministic
  input-template hash. Internal template and attestation data are not exposed
  to the provider prompt.
- V2 mutations use request IDs and require idempotency keys where replay would
  be harmful.
- Evidence is content-addressed and finding verification is evidence-gated;
  an operator override is separately audited.
- Lesson verification denies author self-approval and unsafe target/credential
  material is rejected from reusable attack-chain projections.
- Second Brain retrieval enforces journey, engagement, sensitivity, lifecycle,
  expiry, and operator-control policy. Forgetting removes reusable content and
  leaves content-free audit/suppression state.
- Vault roots are sandboxed, symlinks/traversal are denied, writes are atomic,
  and conflicts require explicit resolution.
- The candidate diagnostic path summarizes Anthropic request/response/SSE
  payloads rather than retaining raw bodies, recursively redacts diagnostic
  values, bounds captured data, and creates new sensitive session/proxy logs
  with mode `0600`.
- The unchanged logo remains content-addressed by the required SHA-256.
- The tracked systemd units run both application processes as `chillspwn`,
  explicitly clear supplementary groups/capabilities, use root-controlled Bun,
  Hermes venv, releases, and report templates, and keep mutable state below
  `/var/lib/chillspwn`.
- Existing operator workspaces are exposed at two exact allowlisted service
  paths by tracked bind-mount units; the service does not need general `/root`
  traversal.
- Docker MCP is explicitly disabled and Docker socket/group access is outside
  the supported deployment contract.
- The promoted processes have only the `chillspwn` uid/gid,
  `NoNewPrivileges=yes`, an empty capability bounding set, no sudo grant, and no
  general root-home traversal.
- Sensitive deployed state and logs are within the reviewed `0700` directory /
  `0600` file boundary.
- Production responses include the required CSP, frame denial, no-sniff,
  no-referrer, permissions policy, and cross-origin opener policy.
- The historical promoted OAuth smoke remained on the refreshable Grok OAuth
  path with xAI API keys excluded. The current source separately passed an
  isolated unprivileged gate using the service-owned opaque OAuth path at
  `/var/lib/chillspwn/grok-auth/auth.json`, no API key, `grok-4.5` with
  reasoning effort `high`, and the hash-pinned no-network route. The OAuth file
  was not read into test evidence. Guided created one exact decision and
  cancelled cleanly; Autonomous
  survived SIGKILL, resumed from one checkpoint, completed exactly one
  action/tool call with verified evidence and evaluation, never entered a
  post-launch user-wait state, and left no ghosts. Production remained PID
  `1425345`, `NRestarts=0`, HTTP 200, and on the same release symlink; this is
  not deployment evidence for the unpromoted source.
- The exact rollback rehearsal activated the verified previous immutable
  release, observed it healthy, returned to the final release, and observed the
  final service healthy with zero restarts.
- Final Gitleaks worktree/history reported zero findings and TruffleHog
  verified filesystem/history reported zero verified secrets. Both production-
  only and all-dependency Bun audits reported zero advisories in the ChillsPwn
  webapp scope.
- The offline Semgrep fallback inspected 361 tracked application files and
  emitted 84 heuristics: 82 prepared/repository-owned SQL sites and two escaped
  `dangerouslySetInnerHTML` sites. Representative triage found no actionable
  sink, and dedicated checks found zero `eval`, dynamic-shell, `shell:true`, or
  TLS-disable sites. Semgrep exited 1 in heuristic/error mode, reported one
  parser-coverage warning, and could not fetch registry rules offline; this is
  therefore not claimed as a clean Semgrep scan.
- Changed/untracked documentation validation covered 34 files and 71 links with
  zero missing targets; a whole-repository baseline retains eight pre-existing
  missing links. Patch whitespace and the repository snapshot verifier pass
  after generated ignored Android assets were cleaned. No file exceeds 100 MiB,
  and no actual environment, auth, private-key, or certificate file is selected.
  The root ignore policy includes preventive \`**/credentials.json\`.

## Open findings

| Severity | Finding | Evidence | Required remediation |
| --- | --- | --- | --- |
| Mitigated release gate | The historical schema-8 bridge is checksum-incompatible with final migration 008 | The old bridge remains unusable. The replacement current-checksum isolated schema 7→8→9 rehearsal passed with exact source/artifact identities, backup/rollback, restart, health, integrity, and unchanged production evidence | Do not execute the old archive. Repeat the replacement rehearsal from the final reviewed commit, then require explicit approval before promoting/baking the newly reviewed bridge. |
| High | Retained Hermes dependency snapshots have open alerts | GitHub reports 119 open Dependabot alerts across retained Hermes lockfiles: 2 critical, 30 high, 57 medium, and 30 low; 109 are runtime-scoped in their source manifests | Triage and remediate each retained component in separately tested dependency updates. Do not describe the whole repository as dependency-clean. The deployed ChillsPwn webapp audit is separately clean. |
| Medium | V2 actor/role model is single-operator and hard-coded after host authentication | V2 routes resolve `operator:local`; Operations resolves an admin actor | Before multi-user exposure, bind actor/role/engagement scope to an authenticated principal and test operator/reviewer/admin separation. |
| Medium | Sensitive canonical state is not application-encrypted at rest | SQLite and artifacts rely on filesystem controls | Require encrypted host/storage and encrypted backups now; define field/artifact encryption and key rotation if the threat model requires protection from host-volume disclosure. |
| Medium | Same-UID provider isolation is intentionally limited | Dashboard, gateway, and provider children use the `chillspwn` identity and provider-specific state below `/var/lib/chillspwn` | Keep child environment allowlists and narrow file modes; use separate provider UIDs plus a credential broker if the threat model requires provider-to-provider isolation. |
| Medium | Physical large-vault and external-ingress behavior remain partially measured | The isolated 50,000-node browser and exact 50,000-note physical export/reconciliation profiles pass, including a bounded native watcher run with 14 raw events and zero errors; sustained multi-hour watcher behavior, production-vault rollback, and external private-ingress Web Vitals remain unmeasured | Keep vault sync opt-in and local-first; complete the documented sustained watcher, rollback, accessibility, and ingress measurements before expanding exposure. |
| Low | Portable archive verification has a brief hash-to-stream race window | The route verifies current authorization, size, and SHA-256 immediately before streaming, but no cross-process archive lock prevents a same-UID writer from replacing bytes between verification and the response stream | Keep archives in the server-managed directory and treat them as immutable now. If the same-UID threat is in scope, add a cross-process archive lease or serve a verified immutable file descriptor with post-open identity checks. |

## Authentication and browser boundary

The retained dashboard authentication uses a shared secret with constant-time
comparison, an HttpOnly `SameSite=Lax` cookie for the one-time root bootstrap,
separate WebSocket authorization, and a redirect that removes the bootstrap
token from the URL. Loopback is deliberately trusted unless a forwarded client
is detected. This is appropriate only for the documented single-operator,
loopback/private-ingress deployment.

It is not a general multi-tenant identity system. Do not expose V2 directly to
the public internet or treat the current actor resolver as role-based access
control.

## Logging and redaction regression checklist

For every material provider/logging change, test with synthetic secrets only:

1. send representative regular and streaming provider payloads;
2. confirm logs retain metadata, byte counts, hashes, status, usage, and safe
   event types but not prompts, responses, tool arguments, credentials, or raw
   confidential content;
3. inspect API-event and LLM-log endpoints for recursive redaction;
4. verify new files are `0600` and their parent directories are not broadly
   traversable;
5. verify rotation, backup, and support exports preserve redaction;
6. verify errors remain actionable through trace IDs without secret values.

## Residual security release work

- triage the retained Hermes alerts without mixing unverified dependency changes
  into the promoted runtime;
- rerun secret/static/dependency scans after future source or lockfile changes;
- verify no secrets or real user data are tracked or staged before each commit;
- preserve the current service identity, filesystem permissions, ingress/auth,
  OAuth isolation, database/vault roots, backup destination, and legacy gate;
- preserve current-authorization replay checks and archive owner/node/hash
  validation; close the documented hash-to-stream race if the same-UID threat
  model requires it;
- retain the protected migration/rollback evidence outside the repository;
- record future acceptance results in [`test-evidence.md`](test-evidence.md)
  without sensitive values.
