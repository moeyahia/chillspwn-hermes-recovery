import { afterEach, describe, expect, test } from "bun:test";
import express from "express";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LiveAttestationCache,
  type LiveAttestationResult,
} from "../../runtime/LiveAttestationCache";
import {
  createCommandOsApplication,
  type CommandOsApplication,
} from "../CommandOsApplication";
import type { RuntimeReadinessSnapshot } from "../RuntimeReadiness";

const applications: CommandOsApplication[] = [];
const servers: Server[] = [];
const directories: string[] = [];
const stopCaches: Array<() => void> = [];

afterEach(async () => {
  stopCaches.splice(0).forEach((stop) => stop());
  await Promise.all(applications.splice(0).map((application) => application.stop()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
  directories.splice(0).forEach((directory) => {
    rmSync(directory, { recursive: true, force: true });
  });
});

describe("Command OS live-attestation refresh readiness", () => {
  test("keeps consecutive health samples ready during refresh and fails closed after hard expiry", async () => {
    interface RouteValue {
      readonly tools: readonly string[];
    }

    let now = new Date("2026-07-18T03:00:00.000Z");
    let calls = 0;
    let releaseRefresh!: (value: LiveAttestationResult<RouteValue>) => void;
    const attestations = new LiveAttestationCache<string, RouteValue>({
      probe: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            ok: true,
            value: { tools: ["fixture_read"] },
            reason: "Initial live MCP tools/list surface attested",
          };
        }
        return new Promise<LiveAttestationResult<RouteValue>>((resolve) => {
          releaseRefresh = resolve;
        });
      },
      clock: () => now,
      successTtlMs: 1_000,
      failureTtlMs: 1_000,
      maximumFailureBackoffMs: 4_000,
      timeoutMs: 500,
      describeKey: () => "MCP route fixture",
    });
    stopCaches.push(() => attestations.stop());
    await attestations.refreshNow("fixture");

    const runtimeReadiness = (): RuntimeReadinessSnapshot => {
      attestations.refreshIfDue("fixture");
      const attestation = attestations.snapshot("fixture");
      const ready = attestation.verified;
      return {
        actionBoundaryActive: ready,
        delegationEnforced: true,
        noHandsCommanderEnforced: true,
        directCommanderToolsDenied: true,
        specialistAssignmentRequired: true,
        specialistsConfigured: ready ? 1 : 0,
        providers: [{
          id: "provider-fixture",
          health: ready ? "healthy" : "degraded",
          authenticated: ready,
          callable: ready,
          supportsGuided: true,
          enforcesAutonomousBoundary: ready,
          reportsExactTokenUsage: true,
          reportsExactCostUsage: true,
          reason: attestation.reason,
        }],
        mcp: {
          enabled: true,
          executionMode: "enabled",
          startPermitted: true,
          configuredServers: 1,
          runnableServers: ready ? 1 : 0,
          missingDependencies: 0,
          missingSecrets: 0,
        },
        eventStream: "healthy",
        secondBrain: "healthy",
        legacyExecutionEnabled: false,
      };
    };

    const directory = mkdtempSync(join(tmpdir(), "command-os-attestation-refresh-"));
    directories.push(directory);
    const commandOs = createCommandOsApplication({
      databasePath: join(directory, "command-os.sqlite"),
      readinessProviders: () => [],
      runtimeProjection: () => ({
        readiness: runtimeReadiness(),
        agents: [],
        mcpServers: [],
      }),
      runtimeToolValidation: () => ({
        registeredTools: 1,
        toolsWithInputSchemas: 1,
        schemaValidationCovered: 1,
        safeSuccessPathCovered: 1,
        failureClassificationCovered: 1,
        fullyCovered: 1,
        blockers: [],
        releasable: true,
      }),
      resolveActor: () => "operator:test",
      projectionIntervalMs: 60_000,
    });
    applications.push(commandOs);

    const app = express();
    app.use(commandOs.router);
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind");
    commandOs.start();

    const readHealth = async () => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/v2/health`);
      expect(response.status).toBe(200);
      return response.json() as Promise<{
        readonly status: "healthy" | "degraded";
        readonly execution: {
          readonly autonomous: "ready" | "unavailable";
          readonly guided: "ready" | "unavailable";
        };
        readonly dependencies: {
          readonly mcp: { readonly runnableServers: number };
          readonly specialists: { readonly configured: number };
        };
      }>;
    };

    expect(await readHealth()).toMatchObject({
      status: "healthy",
      execution: { autonomous: "ready", guided: "ready" },
    });

    now = new Date("2026-07-18T03:00:00.500Z");
    const firstRefreshSample = await readHealth();
    const secondRefreshSample = await readHealth();
    expect(calls).toBe(2);
    expect(firstRefreshSample).toMatchObject({
      status: "healthy",
      execution: { autonomous: "ready", guided: "ready" },
      dependencies: {
        mcp: { runnableServers: 1 },
        specialists: { configured: 1 },
      },
    });
    expect(secondRefreshSample).toMatchObject({
      status: "healthy",
      execution: { autonomous: "ready", guided: "ready" },
    });

    now = new Date("2026-07-18T03:00:01.001Z");
    expect(await readHealth()).toMatchObject({
      status: "degraded",
      execution: { autonomous: "unavailable", guided: "unavailable" },
      dependencies: {
        mcp: { runnableServers: 0 },
        specialists: { configured: 0 },
      },
    });

    releaseRefresh({
      ok: true,
      value: { tools: ["fixture_read"] },
      reason: "Refreshed live MCP tools/list surface attested",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await readHealth()).toMatchObject({
      status: "healthy",
      execution: { autonomous: "ready", guided: "ready" },
    });
    expect(await readHealth()).toMatchObject({
      status: "healthy",
      execution: { autonomous: "ready", guided: "ready" },
    });
  });
});
