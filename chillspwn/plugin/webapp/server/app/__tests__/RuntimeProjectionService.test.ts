import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabaseConnection, migrateDatabase } from "../../db";
import { RuntimeProjectionService } from "../RuntimeProjectionService";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function database() {
  const directory = mkdtempSync(join(tmpdir(), "command-os-projection-"));
  temporaryDirectories.push(directory);
  const db = createDatabaseConnection({ filename: join(directory, "command-os.sqlite") });
  migrateDatabase(db);
  return db;
}

describe("RuntimeProjectionService", () => {
  test("projects real fleet, MCP, and secret-free health state", () => {
    const db = database();
    const service = new RuntimeProjectionService({
      database: db,
      intervalMs: 60_000,
      clock: () => new Date("2026-07-15T09:00:00.000Z"),
      read: () => ({
        readiness: {
          actionBoundaryActive: true,
          delegationEnforced: true,
          noHandsCommanderEnforced: true,
          directCommanderToolsDenied: true,
          specialistAssignmentRequired: true,
          specialistsConfigured: 1,
          providers: [{
            id: "grok-acp",
            health: "healthy",
            authenticated: true,
            supportsGuided: true,
            enforcesAutonomousBoundary: true,
            reportsExactTokenUsage: true,
            reportsExactCostUsage: false,
            reason: "OAuth state and ACP boundary are available",
          }],
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
        },
        agents: [{
          id: "ReconScout",
          role: "reconnaissance",
          displayName: "Recon Scout",
          status: "available",
          providerPolicy: { defaultProvider: "grok-acp" },
          toolPolicy: { allowed: ["nmap"] },
          configuration: { noHands: true },
          version: "2.1",
          capabilities: [{ name: "nmap", source: "roster", enabled: true }],
        }],
        mcpServers: [{
          id: "recon-mcp",
          name: "Recon MCP",
          transport: "stdio",
          endpointRedacted: "local stdio",
          status: "healthy",
          capabilities: ["nmap"],
          policy: { assignedAgents: ["ReconScout"] },
        }],
      }),
    });

    const result = service.projectNow();
    expect(result).toEqual({
      projectedAt: "2026-07-15T09:00:00.000Z",
      agentCount: 1,
      mcpServerCount: 1,
      healthSnapshotCount: 4,
    });
    expect(db.prepare("SELECT id, status FROM agents").get()).toEqual({
      id: "ReconScout",
      status: "available",
    });
    expect(db.prepare("SELECT capability FROM agent_capabilities").get()).toEqual({
      capability: "nmap",
    });
    expect(db.prepare("SELECT id, status FROM mcp_servers").get()).toEqual({
      id: "recon-mcp",
      status: "healthy",
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM health_snapshots").get()).toEqual({ count: 4 });
    expect(db.prepare(
      "SELECT status, metrics_json FROM health_snapshots WHERE component_type = 'policy' AND component_id = 'legacy-execution'",
    ).get()).toEqual({ status: "healthy", metrics_json: '{"enabled":false}' });
    const metrics = String(
      (db.prepare("SELECT metrics_json FROM health_snapshots WHERE component_type = 'provider'").get() as { metrics_json: string }).metrics_json,
    );
    expect(metrics).not.toContain("token");
    expect(metrics).not.toContain("secret");
    db.close();
  });

  test("rejects duplicate runtime identities atomically", () => {
    const db = database();
    const service = new RuntimeProjectionService({
      database: db,
      read: () => ({
        readiness: {
          actionBoundaryActive: false,
          delegationEnforced: false,
          noHandsCommanderEnforced: true,
          directCommanderToolsDenied: true,
          specialistAssignmentRequired: false,
          specialistsConfigured: 0,
          providers: [],
          mcp: {
            enabled: false,
            executionMode: "disabled",
            startPermitted: false,
            configuredServers: 0,
            runnableServers: 0,
            missingDependencies: 0,
            missingSecrets: 0,
          },
          eventStream: "unknown",
          secondBrain: "healthy",
          legacyExecutionEnabled: false,
        },
        agents: ["first", "second"].map((displayName) => ({
          id: "duplicate",
          role: "test",
          displayName,
          status: "available" as const,
          providerPolicy: {},
          toolPolicy: {},
          configuration: {},
          version: "2.1",
          capabilities: [],
        })),
        mcpServers: [],
      }),
    });

    expect(() => service.projectNow()).toThrow("Duplicate projected agent");
    expect(db.prepare("SELECT COUNT(*) AS count FROM agents").get()).toEqual({ count: 0 });
    db.close();
  });
});
