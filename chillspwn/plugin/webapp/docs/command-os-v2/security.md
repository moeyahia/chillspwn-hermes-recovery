# Security review and target controls

Review date: 2026-07-15

Scope: the V2.1 recovery worktree, final immutable release, canonical migration,
and promoted service boundary. No secret values or user payloads are included.

## Release assessment

The promoted candidate materially strengthens action enforcement, memory privacy,
database integrity, path handling, evidence review, event redaction, and
diagnostic logging. The tracked deployment boundary now reflects the hardened
two-service `/opt` plus `/var/lib/chillspwn` layout. Canonical migration,
deployed permissions, secret scans, provider smoke, process restart/resume, and
exact application rollback/return were verified. Residual risk is explicit:
the current actor remains single-operator, sensitive canonical data relies on
host/storage encryption, providers share one constrained service uid, and the
retained Hermes snapshot has open dependency alerts.

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
- prepared SQL and request schema validation;
- idempotency keys and optimistic concurrency;
- immutable policy/audit records and evidence hashes;
- request/trace IDs, secure headers, CSRF/session hardening where applicable;
- upload limits, content-type validation, output encoding, path sandboxing;
- secret redaction before logs/events/memory;
- memory sensitivity, engagement isolation, retention, correction, and forgetting;
- vault root sandbox, atomic sync, and conflict review;
- cancellation propagation and orphan detection.
- default-off legacy execution compatibility: unversioned writes, `/proxy`,
  legacy chat/terminal WebSocket commands, queued-board dispatch, OSINT
  rehydration, and legacy startup writers remain inert unless a rollback-only
  opt-in is enabled; compatibility reads remain available for reconciliation.

Provider paths that cannot enforce scope/tool/delegation boundaries remain advisory or Guided-only. A preference can never weaken authorization, evidence, or policy requirements.

## Candidate controls verified by source and focused tests

- Canonical SQL uses prepared statements and repository-owned transactions;
  migrations enable foreign keys, WAL, a busy timeout, integrity checks, and
  append-only guards for evidence/audit/version records.
- Autonomous actions are checked against a versioned contract and exact scope;
  Guided actions consume one fingerprint-bound decision.
- MCP execution is specialist-bound, allowlisted, cancellation-aware, and
  receives an explicit minimal child environment.
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
- The live OAuth smoke remained on the refreshable Grok OAuth path with xAI API
  keys excluded, and both Guided exact-decision and Autonomous specialist
  boundaries passed.
- The exact rollback rehearsal activated the verified previous immutable
  release, observed it healthy, returned to the final release, and observed the
  final service healthy with zero restarts.
- Final Gitleaks worktree/history and TruffleHog verified-only
  worktree/history scans reported zero findings; unverified TruffleHog
  candidates were confined to documentation, fixtures, and redaction tests.
- Patch and staged-patch whitespace checks pass, no publishable file exceeds
  50 MiB, and no actual environment, auth, private-key, or certificate file is
  selected. The root ignore policy includes preventive \`**/credentials.json\`.

## Open findings

| Severity | Finding | Evidence | Required remediation |
| --- | --- | --- | --- |
| High | Retained Hermes dependency snapshots have open alerts | GitHub reports 119 open Dependabot alerts across retained Hermes lockfiles: 2 critical, 30 high, 57 medium, and 30 low; 109 are runtime-scoped in their source manifests | Triage and remediate each retained component in separately tested dependency updates. Do not describe the whole repository as dependency-clean. The deployed ChillsPwn webapp audit is separately clean. |
| Medium | V2 actor/role model is single-operator and hard-coded after host authentication | V2 routes resolve `operator:local`; Operations resolves an admin actor | Before multi-user exposure, bind actor/role/engagement scope to an authenticated principal and test operator/reviewer/admin separation. |
| Medium | Sensitive canonical state is not application-encrypted at rest | SQLite and artifacts rely on filesystem controls | Require encrypted host/storage and encrypted backups now; define field/artifact encryption and key rotation if the threat model requires protection from host-volume disclosure. |
| Medium | Same-UID provider isolation is intentionally limited | Dashboard, gateway, and provider children use the `chillspwn` identity and provider-specific state below `/var/lib/chillspwn` | Keep child environment allowlists and narrow file modes; use separate provider UIDs plus a credential broker if the threat model requires provider-to-provider isolation. |
| Medium | Physical large-vault and external-ingress behavior remain partially measured | Isolated vault acceptance and promoted loopback checks pass, but a 50,000-note physical vault and external private-ingress Web Vitals have not been measured | Keep vault sync opt-in and local-first; complete the documented scale, accessibility, and ingress measurements before expanding exposure. |

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
- retain the protected migration/rollback evidence outside the repository;
- record future acceptance results in [`test-evidence.md`](test-evidence.md)
  without sensitive values.
