import { describe, expect, test } from "bun:test";
import type { RuntimeSourceManifests } from "../../domain";
import type { AutonomousMissionRequest } from "../../missions";
import {
  toolInputSchemaSha256,
  type V2ToolCoverageEvidence,
  type V2ToolCoverageReport,
} from "../../mcp/V2ToolCoverageAudit";
import {
  createRuntimeToolValidationReadinessProvider,
  evaluateRuntimeToolValidation,
  registeredV2ToolsFromAttestedRoutes,
} from "../RuntimeToolValidation";

const blocked: V2ToolCoverageReport = {
  registeredTools: 1,
  toolsWithInputSchemas: 1,
  schemaValidationCovered: 0,
  safeSuccessPathCovered: 0,
  failureClassificationCovered: 0,
  fullyCovered: 0,
  blockers: [{ toolKey: "fixture::read", code: "missing_schema_validation_test", message: "Exact test is missing." }],
  releasable: false,
};

const objectSchema = {
  type: "object",
  properties: { id: { type: "string" } },
  required: ["id"],
} as const;

function validatedEvidence(toolName: string): V2ToolCoverageEvidence {
  return {
    serverName: "fixture",
    toolName,
    schemaValidation: {
      testId: `fixture:${toolName}:schema`,
      schemaSha256: toolInputSchemaSha256(objectSchema),
    },
    successPath: {
      testId: `fixture:${toolName}:success`,
      fixtureKind: "local_no_network",
      implementationLevel: "vendor_adapter",
    },
    failurePath: {
      testId: `fixture:${toolName}:failure`,
      invalidInputCategory: "invalid_input",
      executionFailureCategory: "deterministic_tool_error",
    },
  };
}

function autonomousRequest(
  allowedActionClasses: readonly string[] = ["passive_intelligence_osint"],
  specialistAgentIds: readonly string[] = ["agent-required"],
): AutonomousMissionRequest {
  return {
    journey: "autonomous",
    launch: true,
    title: "Scoped validation fixture",
    objective: "Assess the authorized local fixture.",
    successCriteria: ["Record one attributable result."],
    authorization: {
      allowedTargets: ["lab:fixture"],
      prohibitedTargets: [],
      authorizationConfirmed: true,
    },
    contract: {
      allowedActionClasses,
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
      specialistAgentIds,
      memoryScopes: [],
      contextNodeIds: [],
      safeStopConditions: [],
      deliverables: [],
    },
  };
}

function manifests(input: {
  readonly requiredActionIds?: readonly string[];
  readonly includeRequiredSibling?: boolean;
} = {}): RuntimeSourceManifests {
  const requiredActionIds = input.requiredActionIds ?? ["passive_intelligence_osint"];
  const tools = [
    {
      id: "tool:mcp:fixture:read",
      label: "read · fixture",
      available: true,
      locallyPolicyEnforced: true,
      requiresModel: true,
      actionClassIds: requiredActionIds,
      evidenceTypeIds: [],
      riskClassIds: ["read-only"],
      mcpServerId: "mcp:fixture",
    },
    {
      id: "tool:mcp:fixture:unrelated",
      label: "unrelated · fixture",
      available: true,
      locallyPolicyEnforced: true,
      requiresModel: true,
      actionClassIds: ["reverse_engineering_binary_analysis"],
      evidenceTypeIds: [],
      riskClassIds: ["read-only"],
      mcpServerId: "mcp:fixture",
    },
    ...(input.includeRequiredSibling ? [{
      id: "tool:mcp:fixture:sibling",
      label: "sibling · fixture",
      available: true,
      locallyPolicyEnforced: true,
      requiresModel: true,
      actionClassIds: requiredActionIds,
      evidenceTypeIds: [],
      riskClassIds: ["read-only"],
      mcpServerId: "mcp:fixture",
    }] : []),
  ];
  return {
    riskClasses: [],
    evidenceKinds: [],
    capabilities: [],
    tools,
    mcpServers: [{
      id: "mcp:fixture",
      label: "fixture",
      status: "healthy",
      toolIds: tools.map(({ id }) => id),
    }],
    agents: [
      {
        id: "agent-required",
        label: "Required specialist",
        available: true,
        capabilityIds: [],
        actionClassIds: requiredActionIds,
        toolIds: tools.filter(({ id }) => id !== "tool:mcp:fixture:unrelated").map(({ id }) => id),
        modelRefs: [],
      },
      {
        id: "agent-unrelated",
        label: "Unrelated specialist",
        available: true,
        capabilityIds: [],
        actionClassIds: ["reverse_engineering_binary_analysis"],
        toolIds: ["tool:mcp:fixture:unrelated"],
        modelRefs: [],
      },
    ],
    providers: [],
  };
}

function attestedTools(toolNames: readonly string[]) {
  return [{
    name: "fixture",
    verified: true,
    tools: toolNames,
    toolSchemas: Object.fromEntries(toolNames.map((name) => [name, objectSchema])),
    assignedAgentIds: ["agent-required", "agent-unrelated"],
    attestedAt: "2026-07-17T16:00:00.000Z",
    expiresAt: "2026-07-17T16:02:00.000Z",
    reason: "Exact fixture attestation",
  }];
}

describe("runtime tool validation truth", () => {
  test("never registers reviewed canary-blocked CVE or binary bindings as executable V2 tools", () => {
    const routes = [
      {
        name: "vulnintel-cve-mcp",
        verified: true,
        tools: ["lookup_cve", "get_cve_summary", "calculate_risk_score"],
        toolSchemas: {
          lookup_cve: objectSchema,
          get_cve_summary: objectSchema,
          calculate_risk_score: objectSchema,
        },
        assignedAgentIds: ["VulnIntel"],
        attestedAt: "2026-07-18T00:00:00.000Z",
        expiresAt: "2026-07-18T00:02:00.000Z",
        reason: "Exact reviewed fixture attestation",
      },
      {
        name: "sechub-binary-analysis",
        verified: true,
        tools: ["open_file", "analyze", "decompile_function"],
        toolSchemas: {
          open_file: objectSchema,
          analyze: objectSchema,
          decompile_function: objectSchema,
        },
        assignedAgentIds: ["ReverseSage"],
        attestedAt: "2026-07-18T00:00:00.000Z",
        expiresAt: "2026-07-18T00:02:00.000Z",
        reason: "Exact reviewed fixture attestation",
      },
    ];

    expect(registeredV2ToolsFromAttestedRoutes(routes)).toEqual([{
      serverName: "vulnintel-cve-mcp",
      toolName: "lookup_cve",
      agentIds: ["VulnIntel"],
      inputSchema: objectSchema,
    }]);
  });

  test("registers exact live-attested bindings and keeps missing evidence release-blocking", () => {
    const routes = [{
      name: "fixture",
      verified: true,
      tools: ["read"],
      toolSchemas: { read: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
      assignedAgentIds: ["agent-fixture"],
      attestedAt: "2026-07-17T16:00:00.000Z",
      expiresAt: "2026-07-17T16:02:00.000Z",
      reason: "Exact fixture attestation",
    }];
    const registered = registeredV2ToolsFromAttestedRoutes(routes);
    expect(registered).toEqual([{
      serverName: "fixture",
      toolName: "read",
      agentIds: ["agent-fixture"],
      inputSchema: routes[0]!.toolSchemas.read,
    }]);
    const report = evaluateRuntimeToolValidation(routes);
    expect(report).toMatchObject({ registeredTools: 1, fullyCovered: 0, releasable: false });
    expect(report.blockers.map((item) => item.code)).toEqual([
      "missing_schema_validation_test",
      "missing_safe_success_path_test",
      "missing_failure_classification_test",
    ]);
  });

  test("blocks Autonomous preflight while preserving a truthful Guided manual path", async () => {
    const provider = createRuntimeToolValidationReadinessProvider(() => blocked);
    const autonomous = await provider.evaluate({ journey: "autonomous" });
    const guided = await provider.evaluate({ journey: "guided" });
    expect(autonomous).toMatchObject({ status: "fail", label: "Audited tool execution" });
    expect((autonomous as { impact: string }).impact).toContain("Autonomous launch is blocked");
    expect(guided).toMatchObject({ status: "warn", label: "Audited tool execution" });
    expect((guided as { impact: string }).impact).toContain("Guided may continue with manual steps");
  });

  test("does not let an unrelated unvalidated tool block a signed Autonomous contract", async () => {
    const report = evaluateRuntimeToolValidation(
      attestedTools(["read", "unrelated"]),
      [validatedEvidence("read")],
    );
    expect(report).toMatchObject({ registeredTools: 2, fullyCovered: 1, releasable: false });
    const provider = createRuntimeToolValidationReadinessProvider(
      () => report,
      () => manifests(),
    );
    const result = await provider.evaluate({
      journey: "autonomous",
      request: autonomousRequest(),
    });
    expect(result).toMatchObject({ status: "pass", journeys: ["autonomous"] });
    expect((result as { impact: string }).impact).toContain("unrelated exposed tools do not block");
  });

  test("still blocks every unvalidated binding dispatchable inside the signed action/team intersection", async () => {
    const report = evaluateRuntimeToolValidation(
      attestedTools(["read", "sibling", "unrelated"]),
      [validatedEvidence("read")],
    );
    const provider = createRuntimeToolValidationReadinessProvider(
      () => report,
      () => manifests({ includeRequiredSibling: true }),
    );
    const result = await provider.evaluate({
      journey: "autonomous",
      request: autonomousRequest(),
    });
    expect(result).toMatchObject({ status: "fail", journeys: ["autonomous"] });
    expect((result as { impact: string }).impact).toContain("1 of 2");
    expect((result as { impact: string }).impact).toContain("fixture::sibling");
  });

  test("fails closed when action/tool ownership cannot be proven from canonical manifests", async () => {
    const report = evaluateRuntimeToolValidation(
      attestedTools(["read"]),
      [validatedEvidence("read")],
    );
    const missingManifests = createRuntimeToolValidationReadinessProvider(() => report);
    const unavailable = await missingManifests.evaluate({
      journey: "autonomous",
      request: autonomousRequest(),
    });
    expect(unavailable).toMatchObject({ status: "fail" });
    expect((unavailable as { impact: string }).impact).toContain("cannot prove which live tool bindings");

    const unmappedAction = createRuntimeToolValidationReadinessProvider(
      () => report,
      () => manifests(),
    );
    const unmapped = await unmappedAction.evaluate({
      journey: "autonomous",
      request: autonomousRequest(["port_service_enumeration"]),
    });
    expect(unmapped).toMatchObject({ status: "fail" });
    expect((unmapped as { impact: string }).impact).toContain("has no tool mapped");
  });
});
