export const COMMAND_OS_API_VERSION = "2.1" as const;

export const COMMAND_OS_JOURNEYS = ["autonomous", "guided"] as const;

export const COMMAND_OS_RUN_STATES = [
  "queued",
  "planning",
  "awaiting_contract_confirmation",
  "running",
  "waiting_guided_decision",
  "blocked",
  "recovering",
  "completed",
  "failed",
  "cancelled",
] as const;

export type ContractHttpMethod = "get" | "post" | "put" | "delete";

export interface V2EndpointContract {
  readonly method: ContractHttpMethod;
  readonly path: string;
  readonly summary: string;
  readonly idempotencyRequired: boolean;
}

const read = (path: string, summary: string): V2EndpointContract => ({
  method: "get",
  path,
  summary,
  idempotencyRequired: false,
});

const write = (
  method: "post" | "put" | "delete",
  path: string,
  summary: string,
  idempotencyRequired = true,
): V2EndpointContract => ({ method, path, summary, idempotencyRequired });

/**
 * Checked catalog for the public Command OS V2 surface. Internal compatibility
 * routes are intentionally excluded: they are not part of the V2 contract.
 */
export const COMMAND_OS_V2_ENDPOINTS: readonly V2EndpointContract[] = [
  read("/api/v2/openapi.json", "Read the Command OS OpenAPI contract"),
  read("/api/v2/contracts/events", "Read the durable event contract"),
  read("/api/v2/health", "Read Command OS liveness and database health"),
  read("/api/v2/system/readiness", "Read Command OS process readiness"),
  read("/api/v2/overview", "Read the Command Center overview"),
  read("/api/v2/missions", "Search and page through missions"),
  read("/api/v2/missions/saved-views", "Read synchronized operator mission views"),
  write("post", "/api/v2/missions/saved-views", "Save a versioned operator mission view"),
  write("delete", "/api/v2/missions/saved-views/:viewId", "Delete a versioned operator mission view"),
  write("post", "/api/v2/missions/bulk/archive", "Archive an exact bounded selection of terminal missions"),
  write("post", "/api/v2/missions/bulk/export", "Export exact bounded redacted mission metadata"),
  write("post", "/api/v2/missions/autonomous/preflight", "Validate an Autonomous Mission Contract", false),
  write("post", "/api/v2/missions", "Create a durable mission"),
  read("/api/v2/missions/:missionId/autonomous-branches/context", "Read safe Autonomous branch context"),
  write("post", "/api/v2/missions/:missionId/autonomous-branches/preflight", "Preflight an Autonomous branch or contract amendment"),
  write("post", "/api/v2/missions/:missionId/autonomous-branches", "Create a versioned Autonomous branch"),
  read("/api/v2/missions/:missionId/runtime", "Read a mission runtime projection"),
  read("/api/v2/runs", "Search active and historical runs"),
  read("/api/v2/runs/:runId", "Read a run and its latest checkpoint"),
  read("/api/v2/runs/:runId/plans", "Read versioned plans for a run"),
  write("post", "/api/v2/runs/:runId/pause", "Pause a run at a durable boundary"),
  write("post", "/api/v2/runs/:runId/resume", "Resume a safely paused run"),
  write("post", "/api/v2/runs/:runId/cancel", "Cancel a run and propagate cleanup"),
  read("/api/v2/decisions", "Search Guided decisions"),
  read("/api/v2/decision-inbox", "Read Guided decisions, Autonomous exceptions, and administrative approvals"),
  write("post", "/api/v2/administrative-approvals/:approvalId/review", "Review an administrative approval"),
  write("post", "/api/v2/guided-decisions/:decisionId/approve", "Approve the exact represented Guided step"),
  write("post", "/api/v2/guided-decisions/:decisionId/manual-result", "Submit a manual Guided step result"),
  write("post", "/api/v2/guided-decisions/:decisionId/reject", "Reject the exact represented Guided step"),
  write("post", "/api/v2/guided-decisions/:decisionId/skip", "Skip the exact represented Guided step"),
  write("post", "/api/v2/guided-decisions/:decisionId/stop", "Stop a Guided mission at its checkpoint"),
  read("/api/v2/guided/:missionId/commander/transcript", "Read the contextual Guided transcript"),
  write("post", "/api/v2/guided/:missionId/commander/explain-more", "Request a deeper bounded explanation"),
  write("post", "/api/v2/guided/:missionId/commander/show-next-step", "Request the next Guided step"),
  write("post", "/api/v2/guided/:missionId/commander/use-another-approach", "Request a different Guided approach"),
  write("post", "/api/v2/guided/:missionId/commander/interpret-result", "Interpret and record Guided output"),
  write("post", "/api/v2/guided/:missionId/commander/remember", "Create a reviewable Guided memory candidate"),
  write("post", "/api/v2/guided/:missionId/commander/do-not-remember", "Suppress a Guided memory candidate"),
  read("/api/v2/events/stream", "Subscribe to the resumable semantic event stream"),
  read("/api/v2/events/replay", "Replay durable run events after a sequence"),
  read("/api/v2/events/gap", "Repair a detected run event gap"),
  read("/api/v2/notifications", "Page through scope-authorized semantic notifications with actor-scoped read state"),
  read("/api/v2/notifications/unread-count", "Read the actor-scoped unread count inside the current authorization scope"),
  write("post", "/api/v2/notifications/:notificationId/read", "Record one human actor's authorized in-app read receipt"),
  write("post", "/api/v2/notifications/read-all", "Record human actor read receipts for all currently authorized notifications"),
  read("/api/v2/agents", "Search the agent fleet"),
  read("/api/v2/agents/:agentId", "Read an agent profile"),
  read("/api/v2/agents/:agentId/assignments", "Read an agent assignment history"),
  read("/api/v2/intelligence/evidence", "Search immutable evidence metadata"),
  read("/api/v2/intelligence/evidence/:evidenceId", "Read evidence provenance"),
  read("/api/v2/intelligence/evidence/runs/:runId/export", "Export a bounded redacted run evidence bundle"),
  read("/api/v2/intelligence/findings", "Search evidence-linked findings"),
  read("/api/v2/intelligence/findings/:findingId", "Read a finding"),
  write("post", "/api/v2/intelligence/findings/:findingId/review", "Review an evidence-linked finding"),
  read("/api/v2/intelligence/artifacts", "Search artifact metadata"),
  read("/api/v2/intelligence/artifacts/:artifactId", "Read artifact metadata"),
  read("/api/v2/intelligence/artifacts/:artifactId/download", "Download verified content from an approved canonical artifact store"),
  read("/api/v2/learning/evaluations", "Search run evaluations"),
  read("/api/v2/learning/lessons", "Search reusable lessons"),
  read("/api/v2/learning/lessons/:lessonId", "Read lesson provenance and usage"),
  write("post", "/api/v2/learning/lessons/:lessonId/review", "Review a proposed lesson"),
  read("/api/v2/learning/usage", "Read selective lesson usage"),
  read("/api/v2/observability/traces", "Search scoped correlated trace summaries"),
  read("/api/v2/observability/traces/:traceId", "Read a bounded correlated trace waterfall"),
  read("/api/v2/observability/events", "Search semantic operational events"),
  read("/api/v2/observability/logs", "Search redacted structured logs"),
  read("/api/v2/observability/health", "Read canonical component health"),
  read("/api/v2/observability/audit/runs/:runId/export", "Export a bounded redacted run-scoped audit subset"),
  read("/api/v2/operations/runs/:runId/recovery", "Read run recovery intelligence"),
  write("post", "/api/v2/operations/runs/:runId/recovery/replan", "Request one materially different bounded recovery plan"),
  write("post", "/api/v2/operations/runs/:runId/recovery/reassign", "Reassign the exact stopped step to a healthy declared-capable specialist"),
  write("post", "/api/v2/operations/runs/:runId/recovery/provider", "Version a compatible provider route for the exact stopped step"),
  read("/api/v2/operations/actions", "Search scoped semantic action activity"),
  write("post", "/api/v2/operations/runs/:runId/follow-up", "Create a versioned follow-up run with selective context"),
  read("/api/v2/reports", "Search report artifacts"),
  read("/api/v2/reports/:artifactId", "Read report metadata"),
  read("/api/v2/reports/runs/:runId/export", "Export a bounded terminal-run metadata bundle"),
  read("/api/v2/system/health", "Read paginated system health snapshots"),
  read("/api/v2/system/mcp", "Read MCP connection health"),
  read("/api/v2/system/providers", "Read provider readiness"),
  read("/api/v2/system/policies", "Read active policy posture"),
  read("/api/v2/brain/summary", "Read Second Brain health and growth"),
  read("/api/v2/brain/health", "Read memory database health"),
  read("/api/v2/brain/control", "Read memory consent and retention controls"),
  write("put", "/api/v2/brain/control", "Update memory consent and retention controls"),
  read("/api/v2/brain/nodes", "Search memory nodes"),
  read("/api/v2/brain/nodes/:nodeId", "Read a memory node and provenance"),
  read("/api/v2/brain/graph", "Read a bounded memory graph neighborhood"),
  read("/api/v2/brain/candidates", "Read the memory confirmation inbox"),
  read("/api/v2/brain/context-packs", "Search persisted memory influence packs"),
  read("/api/v2/brain/context-packs/:contextPackId", "Read persisted memory influence"),
  write("post", "/api/v2/brain/candidates/:candidateId/confirm", "Confirm a memory candidate"),
  write("post", "/api/v2/brain/candidates/:candidateId/reject", "Reject a memory candidate"),
  write("post", "/api/v2/brain/nodes/:nodeId/correct", "Correct and version a memory node"),
  write("post", "/api/v2/brain/nodes/:nodeId/dispute", "Dispute a memory node"),
  write("post", "/api/v2/brain/nodes/:nodeId/pin", "Pin or unpin a memory node"),
  write("post", "/api/v2/brain/nodes/:nodeId/expire", "Set memory expiry"),
  write("post", "/api/v2/brain/nodes/:nodeId/forget", "Forget memory and remove derived retrieval state"),
  read("/api/v2/brain/vault", "Read Obsidian vault connections"),
  write("post", "/api/v2/brain/vault/connect", "Connect an allowed Obsidian vault"),
  write("post", "/api/v2/brain/vault/export", "Project memory into an Obsidian vault"),
  write("post", "/api/v2/brain/vault/import", "Import reviewable Obsidian notes"),
  write("post", "/api/v2/brain/vault/sync", "Synchronize an Obsidian vault"),
  write("post", "/api/v2/brain/vault/portable-export", "Create a portable vault archive"),
  read("/api/v2/brain/vault/portable-exports/:connectionId/:archiveName", "Download a portable vault archive"),
  read("/api/v2/brain/vault/deep-link", "Create a safe Obsidian deep link"),
  read("/api/v2/brain/vault/conflicts", "Read vault sync conflicts"),
  read("/api/v2/brain/vault/conflicts/:conflictId", "Read a vault conflict"),
  write("post", "/api/v2/brain/vault/conflicts/:conflictId/resolve", "Resolve a versioned vault conflict"),
] as const;

const operationId = (endpoint: V2EndpointContract): string => {
  const resource = endpoint.path
    .replace(/^\/api\/v2\//u, "")
    .replace(/:([A-Za-z0-9_]+)/gu, "by_$1")
    .replace(/[^A-Za-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return `${endpoint.method}_${resource}`;
};

const tagFor = (path: string): string => path.split("/")[3] || "system";

const openApiPath = (path: string): string => path.replace(/:([A-Za-z0-9_]+)/gu, "{$1}");

const pathParameters = (path: string): readonly Record<string, unknown>[] =>
  [...path.matchAll(/:([A-Za-z0-9_]+)/gu)].map((match) => ({
    name: match[1],
    in: "path",
    required: true,
    schema: { type: "string", minLength: 1, maxLength: 240 },
  }));

export function createCommandOsOpenApiDocument(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const endpoint of COMMAND_OS_V2_ENDPOINTS) {
    const path = openApiPath(endpoint.path);
    const parameters = [...pathParameters(endpoint.path)];
    parameters.push({
      name: "X-Request-ID",
      in: "header",
      required: false,
      description: "Optional caller correlation ID. Invalid values are replaced with a server-generated ID.",
      schema: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
    });
    if (endpoint.idempotencyRequired) {
      parameters.push({
        name: "Idempotency-Key",
        in: "header",
        required: true,
        schema: { type: "string", minLength: 8, maxLength: 200 },
      });
    }
    const isEventStream = endpoint.path === "/api/v2/events/stream";
    const isArtifactDownload = endpoint.path === "/api/v2/intelligence/artifacts/:artifactId/download";
    const successStatus = endpoint.path === "/api/v2/missions" && endpoint.method === "post"
      ? "201"
      : "200";
    paths[path] ??= {};
    paths[path]![endpoint.method] = {
      operationId: operationId(endpoint),
      summary: endpoint.summary,
      tags: [tagFor(endpoint.path)],
      security: [{ bearerToken: [] }, { dashboardHeader: [] }, { dashboardCookie: [] }],
      parameters,
      ...(endpoint.method === "get" ? {} : {
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object" } } },
        },
      }),
      responses: {
        [successStatus]: isEventStream
          ? {
              description: "Resumable Server-Sent Events stream",
              headers: { "X-Request-ID": { $ref: "#/components/headers/RequestId" } },
              content: { "text/event-stream": { schema: { type: "string" } } },
              "x-event-schema": "#/components/schemas/OperationalEvent",
            }
          : isArtifactDownload
            ? {
                description: "Integrity-verified inert artifact attachment",
                headers: {
                  "X-Request-ID": { $ref: "#/components/headers/RequestId" },
                  "Content-Disposition": { schema: { type: "string" } },
                  "Content-Length": { schema: { type: "integer", minimum: 0 } },
                  "X-Content-Type-Options": { schema: { type: "string", const: "nosniff" } },
                },
                content: {
                  "application/octet-stream": {
                    schema: { type: "string", format: "binary" },
                  },
                },
              }
          : {
              description: "Successful Command OS response",
              headers: { "X-Request-ID": { $ref: "#/components/headers/RequestId" } },
              content: { "application/json": { schema: { type: "object" } } },
            },
        "400": { $ref: "#/components/responses/CommandOsError" },
        "401": { $ref: "#/components/responses/CommandOsError" },
        "403": { $ref: "#/components/responses/CommandOsError" },
        "404": { $ref: "#/components/responses/CommandOsError" },
        "409": { $ref: "#/components/responses/CommandOsError" },
        "413": { $ref: "#/components/responses/CommandOsError" },
        "415": { $ref: "#/components/responses/CommandOsError" },
        "422": { $ref: "#/components/responses/CommandOsError" },
        "500": { $ref: "#/components/responses/CommandOsError" },
        "502": { $ref: "#/components/responses/CommandOsError" },
        "503": { $ref: "#/components/responses/CommandOsError" },
      },
      "x-idempotency-required": endpoint.idempotencyRequired,
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "ChillsPwn Command OS API",
      version: COMMAND_OS_API_VERSION,
      description: "Canonical mission, runtime, evidence, learning, observability, and user-owned Second Brain contract.",
    },
    servers: [{ url: "/", description: "Authenticated ChillsPwn host" }],
    paths,
    components: {
      headers: {
        RequestId: {
          description: "Stable correlation ID shared by the response header and any error envelope traceId.",
          schema: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
        },
      },
      securitySchemes: {
        bearerToken: {
          type: "http",
          scheme: "bearer",
          description: "DASHBOARD_TOKEN supplied as an Authorization bearer token.",
        },
        dashboardHeader: {
          type: "apiKey",
          in: "header",
          name: "X-Dashboard-Token",
        },
        dashboardCookie: {
          type: "apiKey",
          in: "cookie",
          name: "chillspwn_token",
          description: "HttpOnly cookie established by the one-time root bootstrap. Direct loopback requests are trusted by the deployment boundary.",
        },
      },
      responses: {
        CommandOsError: {
          description: "Stable Command OS error envelope",
          headers: { "X-Request-ID": { $ref: "#/components/headers/RequestId" } },
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } },
          },
        },
      },
      schemas: {
        Journey: { type: "string", enum: [...COMMAND_OS_JOURNEYS] },
        RunState: { type: "string", enum: [...COMMAND_OS_RUN_STATES] },
        ErrorResponse: {
          type: "object",
          required: ["error"],
          properties: { error: { $ref: "#/components/schemas/ErrorEnvelope" } },
        },
        ErrorEnvelope: {
          type: "object",
          additionalProperties: false,
          required: ["code", "message", "humanMessage", "retryable", "category", "traceId", "timestamp"],
          properties: {
            code: { type: "string" },
            message: { type: "string" },
            humanMessage: { type: "string" },
            retryable: { type: "boolean" },
            category: { type: "string" },
            details: {},
            traceId: { type: "string" },
            remediation: { type: "string" },
            timestamp: { type: "string", format: "date-time" },
          },
        },
        OperationalEvent: operationalEventJsonSchema(),
      },
    },
  };
}

export function operationalEventJsonSchema(): Record<string, unknown> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://chillspwn.local/contracts/v2.1/operational-event.schema.json",
    title: "Command OS Operational Event",
    type: "object",
    additionalProperties: false,
    required: [
      "id", "sequence", "eventType", "timestamp", "actor", "summary",
      "payload", "schemaVersion", "sensitivity", "redacted", "journey",
    ],
    properties: {
      id: { type: "string", minLength: 1 },
      sequence: { type: "integer", minimum: 1 },
      eventType: { type: "string", minLength: 1 },
      timestamp: { type: "string", format: "date-time" },
      missionId: { type: "string" },
      runId: { type: "string" },
      planVersion: { type: "integer", minimum: 1 },
      stepId: { type: "string" },
      actionId: { type: "string" },
      assignmentId: { type: "string" },
      guidedDecisionId: { type: "string" },
      approvalId: { type: "string" },
      contextPackId: { type: "string" },
      traceId: { type: "string" },
      spanId: { type: "string" },
      actor: {
        type: "object",
        additionalProperties: false,
        required: ["type", "id"],
        properties: {
          type: { type: "string", enum: ["operator", "agent", "system", "provider", "tool"] },
          id: { type: "string" },
        },
      },
      summary: { type: "string", minLength: 1 },
      payload: {},
      schemaVersion: { const: COMMAND_OS_API_VERSION },
      sensitivity: { type: "string", enum: ["public", "internal", "private", "restricted"] },
      redacted: { type: "boolean" },
      journey: { type: "string", enum: [...COMMAND_OS_JOURNEYS] },
    },
  };
}

export const COMMAND_OS_EVENT_DELIVERY_CONTRACT = {
  schemaVersion: COMMAND_OS_API_VERSION,
  transport: "server-sent-events",
  contentType: "text/event-stream",
  eventSchema: operationalEventJsonSchema(),
  ordering: "Monotonic sequence per run",
  resume: {
    headers: ["Last-Event-ID"],
    query: ["runId", "afterSequence", "lastEventId"],
    replayEndpoint: "/api/v2/events/replay",
    gapRepairEndpoint: "/api/v2/events/gap",
  },
  delivery: "at-least-once; clients must deduplicate by stable event ID",
  redaction: "Sensitivity is enforced before replay or delivery; payloads carry explicit redaction metadata",
} as const;
