import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  COMMAND_OS_JOURNEYS,
  COMMAND_OS_RUN_STATES,
  COMMAND_OS_V2_DEFERRED_ENDPOINTS,
  COMMAND_OS_V2_ENDPOINTS,
  createCommandOsOpenApiDocument,
  operationalEventJsonSchema,
} from "../v2Contract";
import { toOperationalEventEnvelope } from "../../events/EventStreamService";
import type { RunEvent } from "../../events/types";

function dynamicPrefixFor(file: string): string | null {
  if (file.endsWith("OperationalTruthRouter.ts")) return "/api/v2/operational-truth";
  if (file.endsWith("GuidedCommanderRouter.ts")) return "/api/v2/guided/:missionId/commander";
  if ([
    "RunIntelligenceRouter.ts",
    "CveApplicabilityRouter.ts",
    "PageCaptureRouter.ts",
    "ScriptArtifactRouter.ts",
    "PlanChangeRouter.ts",
  ].some((name) => file.endsWith(name))) return "/api/v2";
  return null;
}

function implementationPath(file: string, sourcePath: string): string {
  const dynamicPrefix = dynamicPrefixFor(file);
  return dynamicPrefix && sourcePath.startsWith("${prefix}/")
    ? sourcePath.replace("${prefix}", dynamicPrefix)
    : sourcePath;
}

function routeIds(files: readonly string[]): string[] {
  const identities = new Set<string>();
  const route = /router\.(get|post|put|patch|delete)\(\s*(["'`])([^"'`]+)\2/gu;
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(route)) {
      const method = match[1]!;
      const sourcePath = match[3]!;
      const path = implementationPath(file, sourcePath);
      if (!path.startsWith("/api/v2/")) continue;
      if (path === "/api/v2/runs/:runId/${command}") {
        for (const command of ["pause", "resume", "cancel"]) identities.add(`${method}:/api/v2/runs/:runId/${command}`);
      } else {
        identities.add(`${method}:${path}`);
      }
    }
  }
  return [...identities].sort();
}

function mountedImplementationRouteIds(): string[] {
  const serverRoot = resolve(import.meta.dir, "../..");
  return routeIds([
    resolve(serverRoot, "app/CommandOsApplication.ts"),
    resolve(serverRoot, "contracts/ApiContractRouter.ts"),
    resolve(serverRoot, "events/EventStreamRouter.ts"),
    resolve(serverRoot, "guided-commander/GuidedTranscriptReadRouter.ts"),
    resolve(serverRoot, "guided-commander/GuidedMemoryCandidateRouter.ts"),
    resolve(serverRoot, "guided-commander/GuidedCommanderRouter.ts"),
    resolve(serverRoot, "memory/SecondBrainRouter.ts"),
    resolve(serverRoot, "notifications/NotificationRouter.ts"),
    resolve(serverRoot, "plan-changes/PlanChangeRouter.ts"),
    resolve(serverRoot, "cve-intelligence/CveApplicabilityRouter.ts"),
    resolve(serverRoot, "page-captures/PageCaptureRouter.ts"),
    resolve(serverRoot, "script-artifacts/ScriptArtifactRouter.ts"),
    resolve(serverRoot, "intelligence-v24/OperationalTruthRouter.ts"),
    resolve(serverRoot, "run-intelligence/RunIntelligenceRouter.ts"),
    resolve(serverRoot, "research/ResearchLabRouter.ts"),
    resolve(serverRoot, "routes/MissionRuntimeReadRouter.ts"),
    resolve(serverRoot, "routes/missionRuntimeV2Routes.ts"),
    resolve(serverRoot, "routes/commandOsRoutes.ts"),
    resolve(serverRoot, "routes/operationsRoutes.ts"),
  ]);
}

describe("Command OS V2 contract", () => {
  test("publishes exactly the Autonomous and Guided journeys", () => {
    expect(COMMAND_OS_JOURNEYS).toEqual(["autonomous", "guided"]);
    expect(COMMAND_OS_RUN_STATES).toContain("awaiting_contract_confirmation");
    expect(COMMAND_OS_RUN_STATES).toContain("waiting_guided_decision");
    expect(COMMAND_OS_RUN_STATES).not.toContain("waiting_input");
    expect(COMMAND_OS_RUN_STATES).not.toContain("awaiting_plan_approval");
  });

  test("has stable unique operations and idempotency on harmful mutations", () => {
    const identities = COMMAND_OS_V2_ENDPOINTS.map((endpoint) => `${endpoint.method}:${endpoint.path}`);
    expect(new Set(identities).size).toBe(identities.length);

    const unsafeWithoutKey = COMMAND_OS_V2_ENDPOINTS.filter((endpoint) =>
      endpoint.method !== "get"
      && !endpoint.idempotencyRequired
      && endpoint.path !== "/api/v2/missions/autonomous/preflight"
      && endpoint.path !== "/api/v2/registries/intake/resolve"
    );
    expect(unsafeWithoutKey).toEqual([]);
  });

  test("expands dynamic router prefixes without losing Guided mission parameters", () => {
    expect(implementationPath(
      "/tmp/GuidedCommanderRouter.ts",
      "${prefix}/explain-more",
    )).toBe("/api/v2/guided/:missionId/commander/explain-more");
    expect(implementationPath(
      "/tmp/OperationalTruthRouter.ts",
      "${prefix}/missions/:missionId/logs",
    )).toBe("/api/v2/operational-truth/missions/:missionId/logs");
  });

  test("documents every route mounted by the live V2 hybrid process", () => {
    const catalog = COMMAND_OS_V2_ENDPOINTS
      .map((endpoint) => `${endpoint.method}:${endpoint.path}`)
      .sort();
    expect(catalog).toEqual(mountedImplementationRouteIds());
  });

  test("publishes no deferred route after the real runtime adapters are mounted", () => {
    expect(COMMAND_OS_V2_DEFERRED_ENDPOINTS).toEqual([]);
  });

  test("emits a valid OpenAPI 3.1 document with shared errors", () => {
    const document = createCommandOsOpenApiDocument() as {
      openapi: string;
      paths: Record<string, Record<string, unknown>>;
      components: {
        schemas: Record<string, unknown>;
        securitySchemes: Record<string, { name?: string; description?: string }>;
      };
      "x-command-os-deferred-operations": readonly { path: string }[];
    };
    expect(document.openapi).toBe("3.1.0");
    // Browser authentication remains owned by the existing host boundary; V2
    // must not advertise or mount a second competing local-session system.
    expect(document.paths["/api/v2/auth/session"]).toBeUndefined();
    expect(document.paths["/api/v2/missions"]?.post).toBeDefined();
    expect(document.paths["/api/v2/missions/{missionId}/runtime"]?.get).toBeDefined();
    expect(document.paths["/api/v2/runs"]?.get).toBeDefined();
    expect(document.paths["/api/v2/runs/{runId}"]?.get).toBeDefined();
    expect(document.paths["/api/v2/runs/{runId}/plans"]?.get).toBeDefined();
    expect(document.paths["/api/v2/decisions"]?.get).toBeDefined();
    expect(document.paths["/api/v2/guided/{missionId}/commander/transcript"]?.get).toBeDefined();
    expect(document.paths["/api/v2/missions/{missionId}/intelligence/cves"]?.get).toBeDefined();
    expect(document.paths["/api/v2/missions/{missionId}/intelligence/cves"]?.post).toBeDefined();
    expect(document.paths["/api/v2/missions/{missionId}/intelligence/page-captures"]?.get).toBeDefined();
    expect(document.paths["/api/v2/missions/{missionId}/intelligence/page-captures"]?.post).toBeDefined();
    expect(document.paths["/api/v2/missions/{missionId}/script-artifacts"]?.get).toBeDefined();
    expect(document.paths["/api/v2/missions/{missionId}/script-artifacts/{scriptArtifactId}/versions"]?.post).toBeDefined();
    const failureResolution = document.paths[
      "/api/v2/operational-truth/missions/{missionId}/runs/{runId}/failure-diagnoses/{diagnosisId}/resolve"
    ]?.post as { requestBody?: { content?: Record<string, { schema?: unknown }> } };
    expect(failureResolution.requestBody?.content?.["application/json"]?.schema).toEqual({
      $ref: "#/components/schemas/FailureDiagnosisResolutionRequest",
    });
    expect(document.components.schemas.FailureDiagnosisResolutionRequest).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["actionKind", "verifiedOutcome", "confirmed"],
      properties: {
        actionKind: {
          type: "string",
          enum: [
            "test_connection", "configure_dependency", "use_compatible_fallback", "retry_bounded",
            "resume_checkpoint", "reassign", "amend_plan", "skip", "start_new_run", "terminate_gracefully",
          ],
        },
        verifiedOutcome: { type: "string", minLength: 16, maxLength: 4_000 },
        confirmed: { type: "boolean", const: true },
      },
    });
    expect(document.paths["/api/v2/guided/{missionId}/commander/explain-more"]?.post).toBeDefined();
    expect(document.paths["/api/v2/runs/{runId}/cancel"]?.post).toBeDefined();
    expect(document["x-command-os-deferred-operations"]).toEqual([]);
    expect(document.paths["/api/v2/events/stream"]?.get).toBeDefined();
    expect(document.paths["/api/v2/brain/graph"]?.get).toBeDefined();
    expect(document.components.schemas.ErrorEnvelope).toBeDefined();
    expect(document.components.securitySchemes.localSessionCookie).toBeUndefined();
    expect(document.components.securitySchemes.dashboardHeader?.name).toBe("X-Dashboard-Token");
    expect(document.components.securitySchemes.dashboardCookie?.name).toBe("chillspwn_token");
    expect(document.components.securitySchemes.bearerToken?.description).toContain("DASHBOARD_TOKEN");
    const missionCreate = document.paths["/api/v2/missions"]?.post as {
      security?: readonly Record<string, readonly string[]>[];
      parameters?: readonly { name?: string }[];
    };
    expect(missionCreate.security).toEqual([
      { bearerToken: [] },
      { dashboardHeader: [] },
      { dashboardCookie: [] },
    ]);
    expect(missionCreate.parameters?.some((parameter) =>
      parameter.name === "X-Command-OS-V2-CSRF"
    )).toBe(false);
  });

  test("publishes the exact durable event-stream wire envelope", () => {
    const schema = operationalEventJsonSchema() as {
      required: string[];
      properties: Record<string, { type?: unknown; enum?: readonly string[] }>;
    };
    const durableEvent: RunEvent = {
      id: "evt_contract_1",
      missionId: "mission_contract_1",
      runId: "run_contract_1",
      sequence: 1,
      eventType: "assignment.heartbeat",
      occurredAt: "2026-07-16T00:00:00.000Z",
      actorType: "worker",
      actorId: null,
      summary: "Worker heartbeat retained",
      payload: { progress: true },
      schemaVersion: 1,
      journey: "autonomous",
      traceId: null,
      spanId: null,
      sensitivity: "internal",
      redaction: { paths: [] },
      contextPackId: null,
      createdAt: "2026-07-16T00:00:00.000Z",
    };
    const wireEnvelope = toOperationalEventEnvelope(durableEvent, "restricted");
    for (const field of [
      "id", "sequence", "type", "timestamp", "missionId", "runId", "actor", "summary",
      "payload", "schemaVersion", "journey", "sensitivity", "redaction", "contextPackId",
    ]) {
      expect(schema.required).toContain(field);
    }
    expect(schema.required).not.toContain("eventType");
    expect(schema.required).not.toContain("redacted");
    expect(schema.properties.eventType).toBeUndefined();
    expect(schema.properties.redacted).toBeUndefined();
    expect(schema.properties.schemaVersion?.type).toBe("integer");
    expect(schema.properties.actor).toBeDefined();
    expect(Object.keys(wireEnvelope).sort()).toEqual([...schema.required].sort());
    expect(wireEnvelope.type).toBe(durableEvent.eventType);
    expect(wireEnvelope.timestamp).toBe(durableEvent.occurredAt);
    expect(wireEnvelope.schemaVersion).toBe(1);
    expect(wireEnvelope.actor.type).toBe("worker");
  });
});
