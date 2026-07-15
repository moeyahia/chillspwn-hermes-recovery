import { afterEach, describe, expect, test } from "bun:test";
import express from "express";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATABASE_MIGRATIONS } from "../../db";
import { createRuntimeReadinessProviders } from "../RuntimeReadiness";
import { createCommandOsApplication, type CommandOsApplication } from "../CommandOsApplication";

const temporaryDirectories: string[] = [];
const servers: Server[] = [];
const applications: CommandOsApplication[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map((application) => application.stop()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("CommandOsApplication", () => {
  test("migrates, starts, serves real health, and stops cleanly", async () => {
    const directory = mkdtempSync(join(tmpdir(), "command-os-app-"));
    temporaryDirectories.push(directory);
    const snapshot = {
      actionBoundaryActive: false,
      delegationEnforced: false,
      noHandsCommanderEnforced: true,
      directCommanderToolsDenied: true,
      specialistAssignmentRequired: false,
      specialistsConfigured: 0,
      providers: [],
      mcp: {
        enabled: false,
        executionMode: "disabled" as const,
        startPermitted: false,
        configuredServers: 0,
        runnableServers: 0,
        missingDependencies: 0,
        missingSecrets: 0,
      },
      eventStream: "healthy" as const,
      secondBrain: "healthy" as const,
      legacyExecutionEnabled: false,
    };
    const commandOs = createCommandOsApplication({
      databasePath: join(directory, "command-os.sqlite"),
      readinessProviders: () => createRuntimeReadinessProviders(() => snapshot),
      runtimeProjection: () => ({ readiness: snapshot, agents: [], mcpServers: [] }),
      resolveActor: () => "operator",
      projectionIntervalMs: 60_000,
    });
    applications.push(commandOs);
    const app = express();
    app.use(express.json());
    app.use(commandOs.router);
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server has no TCP address");

    commandOs.start();
    expect(commandOs.started).toBe(true);
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v2/system/readiness`);
    expect(response.status).toBe(200);
    const health = await response.json() as any;
    expect(health.status).toBe("healthy");
    expect(health.database.currentMigration).toBe(DATABASE_MIGRATIONS.at(-1)?.version);
    expect(health.eventStream.status).toBe("healthy");

    const overview = await fetch(`http://127.0.0.1:${address.port}/api/v2/overview`);
    expect(overview.status).toBe(200);
    const body = await overview.json() as any;
    expect(body.schemaVersion).toBe("2.1");
    expect(body.readiness.status).toBe("blocked");

    const openApiResponse = await fetch(`http://127.0.0.1:${address.port}/api/v2/openapi.json`);
    expect(openApiResponse.status).toBe(200);
    const openApi = await openApiResponse.json() as any;
    expect(openApi.openapi).toBe("3.1.0");
    expect(openApi.components.schemas.Journey.enum).toEqual(["autonomous", "guided"]);

    const eventContractResponse = await fetch(`http://127.0.0.1:${address.port}/api/v2/contracts/events`);
    expect(eventContractResponse.status).toBe(200);
    const eventContract = await eventContractResponse.json() as any;
    expect(eventContract.schemaVersion).toBe("2.1");
    expect(eventContract.resume.replayEndpoint).toBe("/api/v2/events/replay");
  });
});
