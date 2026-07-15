import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import {
  createCommandOsApplication,
  createRuntimeReadinessProviders,
  type CommandOsApplication,
  type RuntimeReadinessSnapshot,
} from "../../app";
import type { MissionRuntimeEngine } from "../../command-runtime";
import { createGuidedCommanderRouter, type GuidedCommanderPort } from "../../guided-commander";
import { createSecondBrainRouter } from "../../memory/SecondBrainRouter";
import { createMissionRuntimeV2Router } from "../../routes/missionRuntimeV2Routes";
import { createOperationsRouter } from "../../routes/operationsRoutes";
import { v2JsonBodyError, v2NotFound, v2RequestContext } from "../ApiErrorContract";

const servers: Server[] = [];
const commandOsApplications: CommandOsApplication[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
  await Promise.all(commandOsApplications.splice(0).map((application) => application.stop()));
});

const readiness: RuntimeReadinessSnapshot = {
  actionBoundaryActive: true,
  delegationEnforced: true,
  noHandsCommanderEnforced: true,
  directCommanderToolsDenied: true,
  specialistAssignmentRequired: true,
  specialistsConfigured: 1,
  providers: [],
  mcp: {
    enabled: true,
    executionMode: "enabled",
    startPermitted: true,
    configuredServers: 1,
    runnableServers: 1,
    missingDependencies: 0,
    missingSecrets: 0,
  },
  eventStream: "healthy",
  secondBrain: "healthy",
  legacyExecutionEnabled: false,
};

const guidedPort: GuidedCommanderPort = {
  kind: "planning_only",
  supportsToolExecution: false,
  providerId: "error-contract-fixture",
  async respond() {
    throw new Error("The validation-only fixture must never invoke its provider");
  },
};

const memoryPolicy = {
  enabled: true,
  personalPreferencePolicy: "candidate_only",
  operationalMemoryEnabled: true,
  engagementIsolation: true,
  defaultRetentionDays: 365,
  autonomousUse: true,
  guidedUse: true,
  obsidianSyncScope: "confirmed_and_verified",
  secretsNeverRetained: true,
};

async function application() {
  const commandOs = createCommandOsApplication({
    databasePath: ":memory:",
    readinessProviders: () => createRuntimeReadinessProviders(() => readiness),
    runtimeProjection: () => ({ readiness, agents: [], mcpServers: [] }),
    resolveActor: () => "operator:error-contract",
    projectionIntervalMs: 60_000,
  });
  commandOsApplications.push(commandOs);
  commandOs.start();

  const runtime = {
    repository: {
      getRunProjection() {
        throw new Error("Bearer raw-internal-secret-must-not-leak"); // gitleaks:allow -- synthetic boundary fixture
      },
    },
  } as unknown as MissionRuntimeEngine;

  const app = express();
  app.use(v2RequestContext);
  app.use(express.json({ limit: "256kb" }));
  app.use(v2JsonBodyError);
  app.use(commandOs.router);
  app.use(createSecondBrainRouter({
    database: commandOs.database,
    resolveActor: () => "operator:error-contract",
    resolveAccess: (request) => {
      if (request.get("X-Test-Brain-Internal") === "1") {
        throw new Error("Private key was not found: brain-secret-must-not-leak"); // gitleaks:allow -- synthetic boundary fixture
      }
      return {
        maximumSensitivity: "private",
        allowGlobal: true,
        engagementIds: ["engagement-a"],
        missionIds: ["mission-a"],
      };
    },
  }));
  app.use(createGuidedCommanderRouter({
    database: commandOs.database,
    port: guidedPort,
    resolveActor: () => "operator:error-contract",
  }));
  app.use(createMissionRuntimeV2Router({
    runtime,
    resolveActor: () => "operator:error-contract",
  }));
  app.use(createOperationsRouter({
    database: commandOs.database,
    resolveActor: () => ({ id: "operator:error-contract", type: "admin" }),
    resolveAccess: () => ({
      maximumSensitivity: "private",
      engagementIds: ["engagement-a"],
      missionIds: ["mission-a"],
      allowUnscopedSystemData: true,
      allowGlobalKnowledge: true,
      canReviewFindings: true,
      canOverrideEvidenceGate: false,
      canReviewLessons: true,
      canReviewAdministrativeApprovals: true,
    }),
  }));
  app.use(v2NotFound);

  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function expectCanonicalError(
  response: Response,
  expected: { status: number; category: string; requestId: string },
): Promise<Record<string, unknown>> {
  expect(response.status).toBe(expected.status);
  expect(response.headers.get("x-request-id")).toBe(expected.requestId);
  expect(response.headers.get("content-type")).toContain("application/json");
  const payload = await response.json() as { error?: Record<string, unknown> };
  expect(payload).toEqual({ error: expect.any(Object) });
  const error = payload.error!;
  for (const field of [
    "code", "message", "humanMessage", "retryable", "category", "traceId", "timestamp",
  ]) {
    expect(Object.hasOwn(error, field)).toBe(true);
  }
  expect(typeof error.code).toBe("string");
  expect(typeof error.message).toBe("string");
  expect(typeof error.humanMessage).toBe("string");
  expect(typeof error.retryable).toBe("boolean");
  expect(error.category).toBe(expected.category);
  expect(error.traceId).toBe(expected.requestId);
  expect(Number.isNaN(Date.parse(String(error.timestamp)))).toBe(false);
  expect(Object.keys(error).every((key) => [
    "code", "message", "humanMessage", "retryable", "category", "details",
    "traceId", "remediation", "timestamp",
  ].includes(key))).toBe(true);
  return error;
}

describe("mounted Command OS V2 request and error contract", () => {
  test("uses one request ID and one complete envelope across every mounted V2 domain", async () => {
    const origin = await application();

    const openApiResponse = await fetch(`${origin}/api/v2/openapi.json`, {
      headers: { "X-Request-ID": "not a valid request id" },
    });
    expect(openApiResponse.status).toBe(200);
    const generatedId = openApiResponse.headers.get("x-request-id");
    expect(generatedId).toMatch(/^[A-Za-z0-9._:-]{1,128}$/u);
    expect(generatedId).not.toBe("not a valid request id");
    const openApi = await openApiResponse.json() as any;
    expect(openApi.components.headers.RequestId).toBeDefined();
    expect(openApi.components.responses.CommandOsError.headers["X-Request-ID"]).toBeDefined();

    const healthRequestId = "health-correlation-0001";
    const health = await fetch(`${origin}/api/v2/system/readiness`, {
      headers: { "X-Request-ID": healthRequestId },
    });
    expect(health.status).toBe(200);
    expect(health.headers.get("x-request-id")).toBe(healthRequestId);

    await expectCanonicalError(
      await fetch(`${origin}/api/v2/missions?limit=0`, {
        headers: { "X-Request-ID": "command-validation-0001" },
      }),
      { status: 400, category: "invalid_input", requestId: "command-validation-0001" },
    );

    await expectCanonicalError(
      await fetch(`${origin}/api/v2/guided/mission-a/commander/explain-more`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "guided-validation-0001",
          "X-Request-ID": "guided-validation-0001",
        },
        body: "{}",
      }),
      { status: 400, category: "invalid_input", requestId: "guided-validation-0001" },
    );

    const internal = await expectCanonicalError(
      await fetch(`${origin}/api/v2/runs/run-internal`, {
        headers: { "X-Request-ID": "runtime-internal-0001" },
      }),
      { status: 500, category: "internal", requestId: "runtime-internal-0001" },
    );
    expect(JSON.stringify(internal)).not.toContain("raw-internal-secret");
    expect(internal.code).toBe("command_runtime_internal_error");

    const brainInternal = await expectCanonicalError(
      await fetch(`${origin}/api/v2/brain/summary`, {
        headers: {
          "X-Request-ID": "brain-internal-0001",
          "X-Test-Brain-Internal": "1",
        },
      }),
      { status: 500, category: "internal", requestId: "brain-internal-0001" },
    );
    expect(JSON.stringify(brainInternal)).not.toContain("brain-secret");
    expect(brainInternal.code).toBe("second_brain_internal_error");

    await expectCanonicalError(
      await fetch(`${origin}/api/v2/agents/missing-agent`, {
        headers: { "X-Request-ID": "operations-not-found-0001" },
      }),
      { status: 404, category: "not_found", requestId: "operations-not-found-0001" },
    );

    await expectCanonicalError(
      await fetch(`${origin}/api/v2/brain/nodes?sensitivity=restricted`, {
        headers: { "X-Request-ID": "brain-policy-denied-0001" },
      }),
      { status: 403, category: "policy_denied", requestId: "brain-policy-denied-0001" },
    );

    await expectCanonicalError(
      await fetch(`${origin}/api/v2/brain/control`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "brain-conflict-0001",
          "X-Request-ID": "brain-conflict-0001",
        },
        body: JSON.stringify({ expectedVersion: 99, policy: memoryPolicy }),
      }),
      { status: 409, category: "conflict", requestId: "brain-conflict-0001" },
    );

    await expectCanonicalError(
      await fetch(`${origin}/api/v2/events/replay?runId=run-a&limit=0`, {
        headers: { "X-Request-ID": "events-validation-0001" },
      }),
      { status: 400, category: "invalid_input", requestId: "events-validation-0001" },
    );

    const malformed = await expectCanonicalError(
      await fetch(`${origin}/api/v2/guided/mission-a/commander/explain-more`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": "json-parser-validation-0001",
        },
        body: "{not valid JSON",
      }),
      { status: 400, category: "invalid_input", requestId: "json-parser-validation-0001" },
    );
    expect(malformed.code).toBe("invalid_json_body");

    const missingRoute = await expectCanonicalError(
      await fetch(`${origin}/api/v2/not-a-real-route`, {
        headers: { "X-Request-ID": "route-not-found-0001" },
      }),
      { status: 404, category: "not_found", requestId: "route-not-found-0001" },
    );
    expect(missingRoute.code).toBe("command_os_route_not_found");
  });
});
