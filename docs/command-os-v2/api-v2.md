# Command OS V2 API contract

Status: source-verified preview contract as of 2026-07-16. This document describes the isolated V2 process in `chillspwn/plugin/command-os-v2/server/index.ts`; it does not describe or change the protected legacy API.

## Contract authority and current bounds

The checked method/path catalog is `COMMAND_OS_V2_ENDPOINTS` in `server/contracts/v2Contract.ts`. The running process publishes its generated OpenAPI 3.1 projection at `GET /api/v2/openapi.json` and its event-delivery contract at `GET /api/v2/contracts/events`.

At this checkpoint the standalone catalog contains 156 operations over 138 unique paths: 96 `GET`, 56 `POST`, two `PUT`, and two `DELETE`. A static contract test compares that catalog with every route in the actual standalone composition. The path/method inventory is therefore checked. The generated document is not yet a complete payload-level API specification: most request and success bodies are generic objects, and the discrepancies listed under [Known contract gaps](#known-contract-gaps) remain release blockers.

The standalone preview is intentionally fail-closed for execution. It starts with providers, MCP execution, and runtime action boundaries unavailable. Durable reads, intake, intelligence, evidence, Brain, Vault, planning proposals, and other bounded local services remain callable when their own readiness and authorization rules permit them. Run controls and Guided execution mutations are not mounted.

## Process and router composition

The standalone process applies these boundaries in order:

1. V2-only security headers, single-origin CORS, request correlation, strict JSON parsing, and a 1 MiB request-body limit.
2. The public local-session router.
3. Authentication for every other `/api/v2` operation except the five public health/contract paths.
4. `CommandOsApplication`, which owns the V2 SQLite connection, migrations, durable event service, and runtime projection.
5. Operations, notification, and Second Brain/Vault routers using the same V2 database.
6. The canonical JSON V2 404 boundary.
7. Optional V2 static files; an unknown API path can never fall through to SPA HTML.

Within `CommandOsApplication`, routers are mounted for the generated API/event contracts, mission intake/portfolio, Research Lab, operational truth, run intelligence/topology, CVE applicability, page captures, optional script artifacts, read-only runtime projections, read-only Guided transcripts, plan changes, SSE events, and process health.

Page-capture routes are always part of `CommandOsApplication`. Script-artifact routes are added only when the embedding process injects a `ScriptSourceStore`. The standalone process does inject `FileScriptSourceStore`, so all four script operations below are live there. An embedded application created without that store has 152 operations and returns 404 for the four script methods.

## Authentication, CSRF, and browser boundary

These paths are public:

- `POST|GET|DELETE /api/v2/auth/session`
- `GET /api/v2/health`
- `GET /api/v2/system/readiness`
- `GET /api/v2/openapi.json`
- `GET /api/v2/contracts/events`

All other V2 paths require either:

- `Authorization: Bearer <COMMAND_OS_V2_OPERATOR_TOKEN>`; or
- the signed, HttpOnly `chillspwn_command_os_v2_session` cookie issued by the session endpoint.

If `COMMAND_OS_V2_OPERATOR_TOKEN` is absent, protected paths return `503 command_os_authentication_unconfigured`. The configured token must contain at least 24 UTF-8 bytes. Browser-session mutations additionally require the double-submit value from `chillspwn_command_os_v2_csrf` in `X-Command-OS-V2-CSRF`; bearer-authenticated requests do not use the CSRF proof. Session cookies are `SameSite=Strict`, are scoped to V2 paths where appropriate, and default to an eight-hour signed lifetime.

The standalone CORS boundary accepts only the configured V2 UI origin (default `http://127.0.0.1:43140`). It admits `Authorization`, `Content-Type`, `Idempotency-Key`, `Last-Event-ID`, `X-Command-OS-V2-CSRF`, and `X-Request-ID`, and exposes `X-Request-ID`, `Content-Disposition`, and `Idempotency-Replayed`.

Every V2 response carries `X-Request-ID`. A caller may provide a correlation value matching `^[A-Za-z0-9._:-]{1,128}$`; invalid values are replaced with a server-generated UUID.

## Idempotency and concurrency

In the generated contract, every mounted `POST`, `PUT`, or domain `DELETE` requires `Idempotency-Key` except:

- `POST|DELETE /api/v2/auth/session`;
- `POST /api/v2/registries/intake/resolve`;
- `POST /api/v2/missions/autonomous/preflight`.

Keys are normally 8–200 safe characters. Domain stores bind a key to the authenticated actor, operation, and normalized input. Reusing a key for materially different input is rejected; a valid replay returns the original result. Where supported, `Idempotency-Replayed: true|false` makes replay state explicit. Optimistic records additionally require an expected version or timestamp in their request body.

The OpenAPI projection exposes the requirement as `x-idempotency-required` and a required header parameter. It does not replace endpoint-specific validation.

## Control-plane ownership

Canonical missions and runs carry `control_plane = legacy | command_os_v2`. Imported legacy state can be read when the actor's scope policy permits it; it is not thereby writable from V2.

The current application composition explicitly enforces V2 ownership for page-capture and script-artifact mutations: the mission must be `command_os_v2`, and a supplied run must belong to that mission and also be `command_os_v2`. The script service repeats this check. Focused application tests change the fixture mission/run to `legacy`, assert `403`, and verify that no record is added.

`MissionRuntimeEngine` fences runtime work with `ControlPlaneLeaseService`, including lease acquisition/renewal and restart takeover. Those runtime mutation routes are not mounted in the standalone preview. The read projection returns `405 runtime_read_method_not_allowed` for attempted writes to its read-only paths.

This is not yet a universal route-level lease guarantee for every mounted non-runtime mutation. Several local intelligence, review, Brain, and operational mutations enforce actor scope, domain policy, idempotency, and optimistic versions but do not all acquire the control-plane lease at the HTTP boundary. The release gate must remain open until every run/mission-scoped mutation is audited and fenced or explicitly proven control-plane independent.

## Success and error envelopes

There is no artificial universal success wrapper. JSON resources generally carry `schemaVersion: "2.4"` plus a domain-specific object or page. Create operations may return 201, idempotent replays may return 200 or the original status depending on the domain, downloads return bounded attachments, and the SSE endpoint returns `text/event-stream`.

Every canonical error has this shape:

```json
{
  "error": {
    "code": "stable_machine_code",
    "message": "diagnostic summary",
    "humanMessage": "operator-readable explanation",
    "retryable": false,
    "category": "invalid_input",
    "details": {},
    "traceId": "request-correlation-id",
    "remediation": "specific next action",
    "timestamp": "2026-07-16T00:00:00.000Z"
  }
}
```

`details` and `remediation` are optional. Invalid JSON, bodies over 1 MiB, and unsupported encodings become the same envelope with status 400, 413, or 415. Unknown V2 paths return `404 command_os_route_not_found`; they do not render the application shell.

## Mounted endpoint inventory

`[I]` means the generated contract requires `Idempotency-Key`. The paths below are the literal Express path patterns; OpenAPI renders `:identifier` as `{identifier}`.

### Session, contracts, health, overview, and intake

```text
POST   /api/v2/auth/session
GET    /api/v2/auth/session
DELETE /api/v2/auth/session
GET    /api/v2/openapi.json
GET    /api/v2/contracts/events
GET    /api/v2/health
GET    /api/v2/system/readiness
GET    /api/v2/overview
GET    /api/v2/registries/intake
POST   /api/v2/registries/intake/resolve
```

### Missions, runtime reads, plan changes, and decisions

```text
GET    /api/v2/missions
GET    /api/v2/missions/saved-views
POST   /api/v2/missions/saved-views                                      [I]
DELETE /api/v2/missions/saved-views/:viewId                              [I]
POST   /api/v2/missions/bulk/archive                                     [I]
POST   /api/v2/missions/bulk/export                                      [I]
POST   /api/v2/missions/autonomous/preflight
POST   /api/v2/missions                                                  [I]
GET    /api/v2/missions/:missionId/runtime
GET    /api/v2/missions/:missionId/autonomous-branches/context
POST   /api/v2/missions/:missionId/autonomous-branches/preflight         [I]
POST   /api/v2/missions/:missionId/autonomous-branches                   [I]
GET    /api/v2/runs
GET    /api/v2/runs/:runId
GET    /api/v2/runs/:runId/plans
GET    /api/v2/runs/:runId/plan-changes
POST   /api/v2/runs/:runId/plan-changes                                 [I]
GET    /api/v2/runs/:runId/plan-changes/:requestId
PUT    /api/v2/runs/:runId/plan-changes/:requestId                      [I]
POST   /api/v2/runs/:runId/plan-changes/:requestId/apply                [I]
POST   /api/v2/runs/:runId/plan-changes/:requestId/reject               [I]
GET    /api/v2/decisions
GET    /api/v2/guided/:missionId/commander/transcript
GET    /api/v2/decision-inbox
POST   /api/v2/administrative-approvals/:approvalId/review              [I]
```

### Durable event stream and notifications

```text
GET  /api/v2/events/stream
GET  /api/v2/events/replay
GET  /api/v2/events/gap
GET  /api/v2/notifications
GET  /api/v2/notifications/unread-count
POST /api/v2/notifications/:notificationId/read                         [I]
POST /api/v2/notifications/read-all                                     [I]
```

### Agent fleet and canonical intelligence

```text
GET  /api/v2/agents
GET  /api/v2/agents/:agentId
GET  /api/v2/agents/:agentId/assignments
GET  /api/v2/intelligence/evidence
GET  /api/v2/intelligence/evidence/:evidenceId
GET  /api/v2/intelligence/evidence/runs/:runId/export
GET  /api/v2/intelligence/findings
GET  /api/v2/intelligence/findings/:findingId
POST /api/v2/intelligence/findings/:findingId/review                    [I]
GET  /api/v2/intelligence/artifacts
GET  /api/v2/intelligence/artifacts/:artifactId
GET  /api/v2/intelligence/artifacts/:artifactId/download
```

### Operational truth and failure diagnosis

```text
GET  /api/v2/operational-truth/missions/:missionId/logs
POST /api/v2/operational-truth/missions/:missionId/logs                 [I]
GET  /api/v2/operational-truth/missions/:missionId/logs/:logId
GET  /api/v2/operational-truth/missions/:missionId/observations
POST /api/v2/operational-truth/missions/:missionId/observations         [I]
GET  /api/v2/operational-truth/missions/:missionId/observations/:observationId
GET  /api/v2/operational-truth/missions/:missionId/evidence-candidates
POST /api/v2/operational-truth/missions/:missionId/evidence-candidates [I]
GET  /api/v2/operational-truth/missions/:missionId/evidence-candidates/:candidateId
POST /api/v2/operational-truth/missions/:missionId/evidence-candidates/:candidateId/promote [I]
POST /api/v2/operational-truth/missions/:missionId/evidence-candidates/:candidateId/reject  [I]
POST /api/v2/operational-truth/missions/:missionId/evidence-candidates/:candidateId/demote  [I]
POST /api/v2/operational-truth/missions/:missionId/evidence-candidates/:candidateId/verify  [I]
GET  /api/v2/operational-truth/missions/:missionId/verified-evidence
GET  /api/v2/operational-truth/missions/:missionId/verified-evidence/:evidenceId
GET  /api/v2/operational-truth/missions/:missionId/findings/:findingId/verification-readiness
POST /api/v2/operational-truth/missions/:missionId/findings/:findingId/verify [I]
GET  /api/v2/operational-truth/missions/:missionId/runs/:runId/failure-diagnoses
POST /api/v2/operational-truth/missions/:missionId/runs/:runId/failure-diagnoses [I]
GET  /api/v2/operational-truth/missions/:missionId/runs/:runId/failure-diagnoses/:diagnosisId
POST /api/v2/operational-truth/missions/:missionId/runs/:runId/failure-diagnoses/:diagnosisId/resolve [I]
```

### Run metrics, attempts, topology, CVEs, captures, and scripts

```text
GET  /api/v2/runs/:runId/intelligence/metrics/snapshots
GET  /api/v2/runs/:runId/intelligence/metrics/snapshots/:snapshotId
POST /api/v2/runs/:runId/intelligence/metrics/recompute                  [I]
GET  /api/v2/runs/:runId/intelligence/attack-attempts
POST /api/v2/runs/:runId/intelligence/attack-attempts                   [I]
GET  /api/v2/runs/:runId/intelligence/attack-attempts/:attemptId
POST /api/v2/runs/:runId/intelligence/attack-attempts/:attemptId/transition [I]
GET  /api/v2/missions/:missionId/intelligence/topology
GET  /api/v2/missions/:missionId/intelligence/topology/nodes
POST /api/v2/missions/:missionId/intelligence/topology/nodes            [I]
GET  /api/v2/missions/:missionId/intelligence/topology/nodes/:nodeId
GET  /api/v2/missions/:missionId/intelligence/topology/edges
POST /api/v2/missions/:missionId/intelligence/topology/edges            [I]
GET  /api/v2/missions/:missionId/intelligence/topology/edges/:edgeId
GET  /api/v2/missions/:missionId/intelligence/topology/assets/:assetNodeId/osi
POST /api/v2/missions/:missionId/intelligence/topology/assets/:assetNodeId/osi [I]
GET  /api/v2/missions/:missionId/intelligence/cves
POST /api/v2/missions/:missionId/intelligence/cves                      [I]
GET  /api/v2/missions/:missionId/intelligence/cves/:recordId
GET  /api/v2/missions/:missionId/intelligence/page-captures
POST /api/v2/missions/:missionId/intelligence/page-captures             [I]
GET  /api/v2/missions/:missionId/intelligence/page-captures/:captureId
GET  /api/v2/missions/:missionId/script-artifacts
POST /api/v2/missions/:missionId/script-artifacts                       [I]
GET  /api/v2/missions/:missionId/script-artifacts/:scriptArtifactId
POST /api/v2/missions/:missionId/script-artifacts/:scriptArtifactId/versions [I]
```

### Operations, observability, learning, reports, research, and system

```text
GET  /api/v2/operations/runs/:runId/recovery
POST /api/v2/operations/runs/:runId/recovery/replan                     [I]
POST /api/v2/operations/runs/:runId/recovery/reassign                   [I]
POST /api/v2/operations/runs/:runId/recovery/provider                   [I]
GET  /api/v2/operations/actions
POST /api/v2/operations/runs/:runId/follow-up                           [I]
GET  /api/v2/observability/traces
GET  /api/v2/observability/traces/:traceId
GET  /api/v2/observability/events
GET  /api/v2/observability/logs
GET  /api/v2/observability/health
GET  /api/v2/observability/audit/runs/:runId/export
GET  /api/v2/learning/evaluations
GET  /api/v2/learning/lessons
GET  /api/v2/learning/lessons/:lessonId
POST /api/v2/learning/lessons/:lessonId/review                          [I]
GET  /api/v2/learning/usage
GET  /api/v2/reports
GET  /api/v2/reports/:artifactId
GET  /api/v2/reports/runs/:runId/export
GET  /api/v2/research
POST /api/v2/research/campaigns                                         [I]
POST /api/v2/research/campaigns/:campaignId/stop                        [I]
GET  /api/v2/system/health
GET  /api/v2/system/mcp
GET  /api/v2/system/providers
GET  /api/v2/system/policies
```

### Second Brain and Obsidian Vault

```text
GET  /api/v2/brain/summary
GET  /api/v2/brain/health
GET  /api/v2/brain/control
PUT  /api/v2/brain/control                                             [I]
GET  /api/v2/brain/nodes
GET  /api/v2/brain/nodes/:nodeId
GET  /api/v2/brain/graph
GET  /api/v2/brain/candidates
GET  /api/v2/brain/context-packs
GET  /api/v2/brain/context-packs/:contextPackId
POST /api/v2/brain/candidates/:candidateId/confirm                      [I]
POST /api/v2/brain/candidates/:candidateId/reject                       [I]
POST /api/v2/brain/nodes/:nodeId/correct                               [I]
POST /api/v2/brain/nodes/:nodeId/dispute                               [I]
POST /api/v2/brain/nodes/:nodeId/pin                                   [I]
POST /api/v2/brain/nodes/:nodeId/expire                                [I]
POST /api/v2/brain/nodes/:nodeId/forget                                [I]
GET  /api/v2/brain/vault
POST /api/v2/brain/vault/connect                                       [I]
POST /api/v2/brain/vault/export                                        [I]
POST /api/v2/brain/vault/import                                        [I]
POST /api/v2/brain/vault/sync                                          [I]
POST /api/v2/brain/vault/portable-export                               [I]
GET  /api/v2/brain/vault/portable-exports/:connectionId/:archiveName
GET  /api/v2/brain/vault/deep-link
GET  /api/v2/brain/vault/conflicts
GET  /api/v2/brain/vault/conflicts/:conflictId
POST /api/v2/brain/vault/conflicts/:conflictId/resolve                 [I]
```

## Page-capture contract

The page-capture service records a result supplied by an authenticated local actor; it does not make an HTTP request or launch a browser. The create body requires a canonical run, HTTP(S) URL, response status, viewport, screenshot artifact/hash, page-content hash, capture agent/tool, sensitivity, redaction state, and timestamp. Optional plan/step, topology asset/service, full-page screenshot, certificate/site metadata, and existing observation/evidence/finding links are validated against canonical scope.

List filters are exactly `runId`, `assetNodeId`, `serviceNodeId`, `redactionState`, `cursor`, and `limit` (1–100). Pending or quarantined captures retain metadata but do not expose a gallery preview artifact. URLs with embedded credentials, fragments, secret-shaped query fields, or known cloud metadata hosts are rejected.

`POST /api/v2/missions/:missionId/intelligence/page-captures` returns 201 for a new record and 200 for a valid replay. Both responses include `Idempotency-Replayed`. There is deliberately no capture or execute subroute.

## Script-artifact contract

Script artifacts are immutable documentation/source versions, not executable actions. The contract requires language, source, layman and technical explanations, parameters, expected-output recognition, prerequisites/dependencies, touched resources, side effects/risk/reversibility, cleanup, secret handling, evidence expectations, validation/tests, provenance, and sensitivity. Secret-bearing reusable material is rejected, and source is limited to 512 KiB.

The standalone store is content-addressed by SHA-256 under a V2-owned absolute root derived from the V2 database or `COMMAND_OS_V2_SCRIPT_SOURCE_ROOT`. User-provided filenames never determine its filesystem path. Reads re-hash stored source before returning it.

The list response and create/version mutation responses omit source. `GET /api/v2/missions/:missionId/script-artifacts/:scriptArtifactId` is the authorized detail endpoint that returns verified source. List filters are exactly `runId`, `planId`, `stepId`, `targetNodeId`, `language`, `name`, and `limit`.

There is no script execution endpoint. `POST .../:scriptArtifactId/execute` is a canonical 404. Creating or versioning source does not claim it was run or tested; validation state and linked test artifacts carry that evidence.

## SSE delivery and replay

The live transport endpoints require normal V2 authentication:

- `GET /api/v2/events/stream` opens SSE. It accepts optional `runId`, `afterSequence`, `lastEventId`, and `Last-Event-ID`.
- `GET /api/v2/events/replay` and `GET /api/v2/events/gap` require `runId` unless a returned cursor supplies it. They accept `afterSequence`, `cursor`, and `limit` (1–500).

SSE IDs are encoded as `v2.<base64url-event-id>`. The server emits `retry: 1000`, heartbeat comments (20 seconds by default), bounded queues, sensitivity filtering, configured-path and secret-key redaction, and at-least-once delivery. Clients must deduplicate by stable event ID and repair per-run sequence gaps. A replay page returns `events`, `runId`, the resulting `afterSequence`, a new opaque `nextCursor`, and `hasMore`.

The actual wire envelope emitted by `EventStreamService` is:

```text
id, sequence, type, timestamp, missionId, runId, journey, summary,
actor { type, id }, payload, schemaVersion (positive integer),
traceId, spanId, sensitivity, redaction, contextPackId
```

The published JSON Schema now uses these exact wire keys, permits nullable actor/correlation values, includes `worker`, and models the payload schema version as a positive integer independent of HTTP API version `2.4`. A contract test converts a durable worker event through `toOperationalEventEnvelope` and asserts exact key equality with the schema's required fields.

## Deliberately unmounted operations

These implemented service-boundary routes are published only in OpenAPI's `x-command-os-deferred-operations`. Calling them on the standalone preview returns the canonical 404:

```text
POST /api/v2/guided-decisions/:decisionId/approve
POST /api/v2/guided-decisions/:decisionId/reject
POST /api/v2/guided-decisions/:decisionId/manual-result
POST /api/v2/guided-decisions/:decisionId/skip
POST /api/v2/guided-decisions/:decisionId/stop
POST /api/v2/runs/:runId/pause
POST /api/v2/runs/:runId/resume
POST /api/v2/runs/:runId/cancel
POST /api/v2/guided/:missionId/commander/explain-more
POST /api/v2/guided/:missionId/commander/show-next-step
POST /api/v2/guided/:missionId/commander/use-another-approach
POST /api/v2/guided/:missionId/commander/interpret-result
POST /api/v2/guided/:missionId/commander/remember
POST /api/v2/guided/:missionId/commander/do-not-remember
```

The first eight require `MissionRuntimeEngine` plus a cooperative `ResultAwareExecutionPort`. The six Commander mutations require a real sanitized `GuidedCommanderPort`. They must not be mounted merely to make a UI control appear functional.

## Request examples without shell credentials

A browser may exchange the locally entered operator token for a signed session, then omit the bearer token from later calls:

```ts
const response = await fetch("http://127.0.0.1:43141/api/v2/auth/session", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ operatorToken }),
});
if (!response.ok) throw await response.json();
```

For a browser-session mutation, read the non-HttpOnly CSRF cookie through the application's cookie helper and send it with a unique idempotency key:

```ts
const response = await fetch(`/api/v2/missions/${missionId}/intelligence/page-captures`, {
  method: "POST",
  credentials: "include",
  headers: {
    "Content-Type": "application/json",
    "Idempotency-Key": crypto.randomUUID(),
    "X-Command-OS-V2-CSRF": csrfToken,
  },
  body: JSON.stringify(validatedSuppliedCapture),
});
```

These examples intentionally omit real tokens, target data, and artifact bodies.

## Known contract gaps

1. Generated OpenAPI success responses are generic and assume 200 except mission creation. Several mounted creates actually return 201, including page captures, scripts, research campaigns, and branch creation. Consumers must use HTTP semantics, not the current generated status table, until response contracts are modeled per operation.
2. Generated request bodies are generic objects. They do not expose the strict runtime schemas, query bounds, optimistic version fields, sensitivity policy, or domain-specific response types.
3. `DELETE /api/v2/missions/saved-views/:viewId` currently reads `expectedVersion` from a JSON body, while the generic OpenAPI helper omits request bodies for every `DELETE` operation.
4. The generated response table omits the intentional 405 returned by read-only runtime and Guided transcript projections.
5. Script operations are present in the standalone OpenAPI because the standalone always injects its V2-only source store. An embedding process that calls `createCommandOsApplication` without a store omits those routes even though the static generated catalog still lists them.
6. The method/path equality test proves route accounting, not that every success body, query parameter, status, authorization branch, or domain mutation is described completely. Payload-level contract coverage, universal control-plane fencing, and end-to-end browser validation remain open release work.

## Verification evidence

The source audit is anchored in:

- `server/index.ts` and `server/app/CommandOsApplication.ts` for actual standalone composition;
- `server/contracts/v2Contract.ts` and `ApiContractRouter.ts` for the generated OpenAPI/event endpoints;
- the concrete route files enumerated by `server/contracts/__tests__/v2Contract.test.ts`;
- `server/app/__tests__/CommandOsArtifactRoutes.test.ts` for conditional script mounting, page/script authorization, replay behavior, control-plane rejection, and absence of execute routes;
- page-capture and script-artifact router/service tests for validation, immutable hashes, provenance, and response behavior;
- event repository/service/router tests for monotonic run ordering, replay, backpressure, redaction, and reconnect behavior.

Passing focused tests support the method/path, event-wire, and artifact/capture claims. They do not close the remaining payload-level OpenAPI gaps, full browser matrix, soak, or cutover gate.
