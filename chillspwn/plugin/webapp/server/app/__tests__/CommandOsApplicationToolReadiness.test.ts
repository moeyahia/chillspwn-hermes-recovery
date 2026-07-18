import { afterEach, describe, expect, test } from "bun:test";
import express from "express";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AutonomousMissionRequest } from "../../missions";
import {
  toolInputSchemaSha256,
  type V2ToolCoverageEvidence,
} from "../../mcp/V2ToolCoverageAudit";
import { createCommandOsApplication, type CommandOsApplication } from "../CommandOsApplication";
import {
  createRuntimeToolValidationReadinessProvider,
  evaluateRuntimeToolValidation,
} from "../RuntimeToolValidation";

const applications: CommandOsApplication[] = [];
const servers: Server[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map((application) => application.stop()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe("Command OS audited execution readiness", () => {
  test("reports MCP connectivity separately while incomplete exact tool evidence blocks Autonomous", async () => {
    const directory = mkdtempSync(join(tmpdir(), "command-os-tool-readiness-"));
    directories.push(directory);
    const snapshot = {
      actionBoundaryActive: true,
      delegationEnforced: true,
      noHandsCommanderEnforced: true,
      directCommanderToolsDenied: true,
      specialistAssignmentRequired: true,
      specialistsConfigured: 1,
      providers: [{
        id: "provider-fixture",
        health: "healthy" as const,
        authenticated: true,
        callable: true,
        enforcesAutonomousBoundary: true,
        supportsGuided: true,
        reportsExactTokenUsage: true,
        reportsExactCostUsage: true,
      }],
      mcp: {
        enabled: true,
        executionMode: "enabled" as const,
        startPermitted: true,
        configuredServers: 1,
        runnableServers: 1,
        missingDependencies: 0,
        missingSecrets: 0,
      },
      eventStream: "healthy" as const,
      secondBrain: "healthy" as const,
      legacyExecutionEnabled: false,
    };
    const commandOs = createCommandOsApplication({
      databasePath: join(directory, "command-os.sqlite"),
      readinessProviders: () => [],
      runtimeProjection: () => ({ readiness: snapshot, agents: [], mcpServers: [] }),
      runtimeToolValidation: () => ({
        registeredTools: 1,
        toolsWithInputSchemas: 1,
        schemaValidationCovered: 1,
        safeSuccessPathCovered: 0,
        failureClassificationCovered: 1,
        fullyCovered: 0,
        blockers: [{
          toolKey: "fixture::read",
          code: "missing_safe_success_path_test",
          message: "No safe vendor success canary is attached.",
        }],
        releasable: false,
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

    const response = await fetch(`http://127.0.0.1:${address.port}/api/v2/health`);
    expect(response.status).toBe(200);
    const health = await response.json() as any;
    expect(health.status).toBe("degraded");
    expect(health.execution).toMatchObject({
      autonomous: "unavailable",
      guided: "ready",
      guidedToolExecution: "unavailable",
    });
    expect(health.dependencies.mcp).toMatchObject({
      status: "available",
      configuredServers: 1,
      runnableServers: 1,
      validation: {
        status: "blocked",
        registeredTools: 1,
        fullyCovered: 0,
        blockerCount: 1,
      },
    });
    expect(health.dependencies.mcp.validation.humanMessage).toContain("0 of 1");
    expect(health.dependencies.mcp.validation.blockers[0].code).toBe("missing_safe_success_path_test");

    const overviewResponse = await fetch(`http://127.0.0.1:${address.port}/api/v2/overview`);
    expect(overviewResponse.status).toBe(200);
    const overview = await overviewResponse.json() as {
      readonly readiness: { readonly checks: readonly { readonly id: string; readonly status: string }[] };
    };
    expect(overview.readiness.checks).toContainEqual(expect.objectContaining({
      id: "runtime_tool_validation",
      status: "fail",
    }));
  });

  test("rewires mission preflight to the signed action-class and specialist subset", async () => {
    const directory = mkdtempSync(join(tmpdir(), "command-os-scoped-tool-readiness-"));
    directories.push(directory);
    const schema = {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    } as const;
    const evidence: V2ToolCoverageEvidence = {
      serverName: "fixture",
      toolName: "read",
      schemaValidation: {
        testId: "application-scoped-read-schema",
        schemaSha256: toolInputSchemaSha256(schema),
      },
      successPath: {
        testId: "application-scoped-read-success",
        fixtureKind: "local_no_network",
        implementationLevel: "vendor_adapter",
      },
      failurePath: {
        testId: "application-scoped-read-failure",
        invalidInputCategory: "invalid_input",
        executionFailureCategory: "deterministic_tool_error",
      },
    };
    const report = evaluateRuntimeToolValidation([{
      name: "fixture",
      verified: true,
      tools: ["read", "unrelated"],
      toolSchemas: { read: schema, unrelated: schema },
      assignedAgentIds: ["agent-required", "agent-unrelated"],
      attestedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      reason: "Application scoped readiness fixture",
    }], [evidence]);
    expect(report).toMatchObject({ registeredTools: 2, fullyCovered: 1, releasable: false });

    const snapshot = {
      actionBoundaryActive: true,
      delegationEnforced: true,
      noHandsCommanderEnforced: true,
      directCommanderToolsDenied: true,
      specialistAssignmentRequired: true,
      specialistsConfigured: 1,
      providers: [{
        id: "provider-fixture",
        health: "healthy" as const,
        authenticated: true,
        callable: true,
        attestedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        enforcesAutonomousBoundary: true,
        supportsGuided: true,
        reportsExactTokenUsage: true,
        reportsExactCostUsage: true,
      }],
      mcp: {
        enabled: true,
        executionMode: "enabled" as const,
        startPermitted: true,
        configuredServers: 1,
        runnableServers: 1,
        missingDependencies: 0,
        missingSecrets: 0,
      },
      eventStream: "healthy" as const,
      secondBrain: "healthy" as const,
      legacyExecutionEnabled: false,
    };
    const capabilityManifests = {
      riskClasses: [],
      evidenceKinds: [],
      capabilities: [],
      tools: [{
        id: "tool:mcp:fixture:read",
        label: "read · fixture",
        available: true,
        locallyPolicyEnforced: true,
        requiresModel: true,
        actionClassIds: ["passive_intelligence_osint"],
        evidenceTypeIds: [],
        riskClassIds: ["read-only"],
        mcpServerId: "mcp:fixture",
      }, {
        id: "tool:mcp:fixture:unrelated",
        label: "unrelated · fixture",
        available: true,
        locallyPolicyEnforced: true,
        requiresModel: true,
        actionClassIds: ["reverse_engineering_binary_analysis"],
        evidenceTypeIds: [],
        riskClassIds: ["read-only"],
        mcpServerId: "mcp:fixture",
      }],
      mcpServers: [{
        id: "mcp:fixture",
        label: "fixture",
        status: "healthy" as const,
        toolIds: ["tool:mcp:fixture:read", "tool:mcp:fixture:unrelated"],
      }],
      agents: [{
        id: "agent-required",
        label: "Required specialist",
        available: true,
        capabilityIds: [],
        actionClassIds: ["passive_intelligence_osint"],
        toolIds: ["tool:mcp:fixture:read"],
        modelRefs: [],
      }, {
        id: "agent-unrelated",
        label: "Unrelated specialist",
        available: true,
        capabilityIds: [],
        actionClassIds: ["reverse_engineering_binary_analysis"],
        toolIds: ["tool:mcp:fixture:unrelated"],
        modelRefs: [],
      }],
      providers: [],
    };
    const runtimeProjection = () => ({
      readiness: snapshot,
      agents: [{
        id: "agent-required",
        role: "osint",
        displayName: "Required specialist",
        status: "available" as const,
        providerPolicy: { defaultProvider: "provider-fixture" },
        toolPolicy: {
          allowedTools: ["read"],
          deniedTools: [],
          approvalRequiredTools: [],
        },
        configuration: {},
        version: "fixture",
        capabilities: [{
          name: "read",
          source: "live-route-attestation",
          enabled: true,
          metadata: { validUntil: new Date(Date.now() + 300_000).toISOString() },
        }],
      }],
      mcpServers: [{
        id: "mcp:fixture",
        name: "fixture",
        transport: "test",
        status: "healthy" as const,
        capabilities: ["read", "unrelated"],
        policy: {
          enabled: true,
          assignedAgents: ["agent-required"],
          startPermitted: true,
          riskClass: "read-only",
        },
      }],
      capabilityManifests,
    });
    const commandOs = createCommandOsApplication({
      databasePath: join(directory, "command-os.sqlite"),
      readinessProviders: () => [
        createRuntimeToolValidationReadinessProvider(() => report),
      ],
      runtimeProjection,
      runtimeToolValidation: () => report,
      resolveActor: () => "operator:test",
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
    if (!address || typeof address === "string") throw new Error("Test server did not bind");
    commandOs.start();

    const request: AutonomousMissionRequest = {
      journey: "autonomous",
      launch: true,
      title: "Application scoped validation",
      objective: "Collect authorized public fixture intelligence.",
      successCriteria: ["Record one result."],
      authorization: {
        allowedTargets: ["lab:fixture"],
        prohibitedTargets: [],
        authorizationConfirmed: true,
      },
      contract: {
        allowedActionClasses: ["passive_intelligence_osint"],
        prohibitedActionClasses: [],
        destructivePolicy: "prohibited",
        evidenceRequirements: [],
        timeBudgetMinutes: 10,
        retryBudget: 0,
        replanBudget: 0,
        concurrencyLimit: 1,
        evidenceStorageBudgetBytes: 1_000_000,
        artifactStorageBudgetBytes: 1_000_000,
        notificationPolicy: "in_app_only",
        reportingFormat: "command_os_json",
        dataHandlingPolicy: "local_private",
        retentionPolicy: "operator_managed",
        providerPolicy: "automatic_enforcing_only",
        toolPolicy: "contract_allowlist",
        specialistAgentIds: ["agent-required"],
        memoryScopes: [],
        contextNodeIds: [],
        safeStopConditions: ["stop_on_scope_mismatch"],
        deliverables: ["command_os_json"],
      },
    };
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v2/missions/autonomous/preflight`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      },
    );
    expect(response.status).toBe(200);
    const preflight = await response.json() as {
      readonly readiness: {
        readonly checks: readonly { readonly id: string; readonly status: string; readonly impact: string }[];
      };
    };
    const toolCheck = preflight.readiness.checks.find(({ id }) => id === "runtime_tool_validation");
    expect(toolCheck).toMatchObject({ status: "pass" });
    expect(toolCheck?.impact).toContain("unrelated exposed tools do not block");
  });
});
