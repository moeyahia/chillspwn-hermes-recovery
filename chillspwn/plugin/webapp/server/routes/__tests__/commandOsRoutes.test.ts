import { afterEach, describe, expect, test } from "bun:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { createDatabaseConnection, migrateDatabase } from "../../db";
import type { AutonomousMissionRequest, GuidedMissionRequest, ReadinessCheckProvider } from "../../missions";
import { createCommandOsRouter } from "../commandOsRoutes";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

function provider(status: "pass" | "fail"): ReadinessCheckProvider {
  return {
    id: "enforcing-runtime",
    label: "Enforcing runtime",
    journeys: ["autonomous", "guided"],
    evaluate: () => ({
      id: "enforcing-runtime",
      label: "Enforcing runtime",
      status,
      journeys: ["autonomous", "guided"],
      impact: status === "pass" ? "Execution boundary is available." : "Execution boundary is unavailable.",
      remediation: status === "fail" ? "Restore the enforcing runtime." : undefined,
    }),
  };
}

async function application(status: "pass" | "fail" = "pass") {
  const database = createDatabaseConnection({ filename: ":memory:" });
  migrateDatabase(database);
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.use(
    createCommandOsRouter({
      database,
      readinessProviders: [provider(status)],
      resolveActor: () => "operator-route-test",
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  return { database, url: `http://127.0.0.1:${port}` };
}

const autonomous: AutonomousMissionRequest = {
  journey: "autonomous",
  launch: true,
  title: "Route readiness test",
  objective: "Validate the authorized lab boundary",
  successCriteria: ["Evidence is retained"],
  authorization: {
    allowedTargets: ["lab.internal"],
    prohibitedTargets: [],
    authorizationConfirmed: true,
  },
  contract: {
    allowedActionClasses: ["reconnaissance"],
    prohibitedActionClasses: [],
    destructivePolicy: "prohibited",
    evidenceRequirements: [],
    timeBudgetMinutes: 30,
    retryBudget: 2,
    replanBudget: 2,
    concurrencyLimit: 2,
    evidenceStorageBudgetBytes: 64 * 1024 * 1024,
    artifactStorageBudgetBytes: 256 * 1024 * 1024,
    notificationPolicy: "in_app_only",
    reportingFormat: "command_os_json",
    dataHandlingPolicy: "local_private",
    retentionPolicy: "operator_managed",
    providerPolicy: "automatic_enforcing_only",
    toolPolicy: "contract_allowlist",
    memoryScopes: ["verified_lessons"],
    contextNodeIds: [],
    safeStopConditions: ["Scope conflict"],
    deliverables: ["Report"],
  },
};

const guided: GuidedMissionRequest = {
  journey: "guided",
  launch: true,
  authorizationConfirmed: true,
  title: "Guided route test",
  objective: "Explain one authorized step at a time",
  target: "lab.internal",
  explanationDepth: "balanced",
  executionPreference: "manual",
  evidenceExpectations: [],
};

describe("Command OS V2 routes", () => {
  test("issues a server contract digest and rejects a stale reviewed digest", async () => {
    const { database, url } = await application("pass");
    try {
      const preflight = await fetch(`${url}/api/v2/missions/autonomous/preflight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(autonomous),
      });
      expect(preflight.status).toBe(200);
      const reviewed = (await preflight.json()) as {
        contract: { version: 1; hash: string };
        readiness: { status: string };
        policySummary: { provider: string; tools: string };
      };
      expect(reviewed.readiness.status).toBe("ready");
      expect(reviewed.contract.hash).toMatch(/^[a-f0-9]{64}$/u);
      expect(reviewed.policySummary.provider).toContain("enforceable Autonomous boundary");
      expect(reviewed.policySummary.tools).toContain("allowlists");

      const stale = await fetch(`${url}/api/v2/missions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "stale-contract-review-0001",
        },
        body: JSON.stringify({
          ...autonomous,
          objective: `${autonomous.objective} after review changed`,
          contractReview: reviewed.contract,
        }),
      });
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({
        error: {
          code: "autonomous_readiness_blocked",
          details: { checks: [{ id: "contract_review_integrity", status: "fail" }] },
        },
      });
      expect(database.prepare("SELECT COUNT(*) AS count FROM missions").get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  test("returns a structured 409 and persists nothing when Autonomous readiness fails", async () => {
    const { database, url } = await application("fail");
    try {
      const response = await fetch(`${url}/api/v2/missions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "blocked-route-request-001",
          "X-Request-ID": "route-trace-1",
        },
        body: JSON.stringify(autonomous),
      });
      expect(response.status).toBe(409);
      expect(response.headers.get("x-request-id")).toBe("route-trace-1");
      const body = (await response.json()) as { error: Record<string, unknown> };
      expect(body.error).toMatchObject({
        code: "autonomous_readiness_blocked",
        category: "dependency_missing",
        retryable: false,
        traceId: "route-trace-1",
      });
      expect(body.error.details).toMatchObject({ status: "blocked" });
      expect(
        database.prepare("SELECT COUNT(*) AS count FROM missions").get(),
      ).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  test("requires idempotency, creates Guided state, and exposes overview plus cursor pagination", async () => {
    const { database, url } = await application("pass");
    try {
      const missingKey = await fetch(`${url}/api/v2/missions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(guided),
      });
      expect(missingKey.status).toBe(400);
      expect((await missingKey.json()) as object).toMatchObject({
        error: { code: "invalid_mission_request" },
      });

      const first = await fetch(`${url}/api/v2/missions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "guided-route-request-0001",
        },
        body: JSON.stringify(guided),
      });
      expect(first.status).toBe(201);
      const created = (await first.json()) as {
        mission: { id: string; journey: string };
        run: { id: string; status: string; journey: string };
        nextUrl: string;
      };
      expect(created).toMatchObject({
        mission: { journey: "guided" },
        run: { status: "planning", journey: "guided" },
      });
      expect(created.nextUrl).toBe(`/guided/${created.mission.id}`);
      expect(first.headers.get("location")).toBe(created.nextUrl);

      const replay = await fetch(`${url}/api/v2/missions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "guided-route-request-0001",
        },
        body: JSON.stringify(guided),
      });
      expect(await replay.json()).toEqual(created);

      const overview = await fetch(`${url}/api/v2/overview`);
      expect(overview.status).toBe(200);
      expect(await overview.json()).toMatchObject({
        schemaVersion: "2.1",
        readiness: { status: "ready", score: 100 },
        summary: { activeMissions: 1 },
        missions: [{ id: created.mission.id, journey: "guided", status: "planning" }],
      });

      const page = await fetch(`${url}/api/v2/missions?limit=1&journey=guided`);
      expect(await page.json()).toMatchObject({
        schemaVersion: "2.1",
        items: [{ id: created.mission.id, journey: "guided" }],
        nextCursor: null,
      });
    } finally {
      database.close();
    }
  });
});
