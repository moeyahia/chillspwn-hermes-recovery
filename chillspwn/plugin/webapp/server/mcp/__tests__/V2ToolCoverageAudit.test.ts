import { describe, expect, test } from "bun:test";
import {
  auditV2ProviderCoverage,
  auditV2ToolCoverage,
  toolInputSchemaSha256,
  type RegisteredV2Tool,
  type V2ToolCoverageEvidence,
} from "../V2ToolCoverageAudit";

const schema = {
  type: "object",
  properties: {
    query: { type: "string", minLength: 1 },
  },
  required: ["query"],
  additionalProperties: false,
} as const;

const tool: RegisteredV2Tool = {
  serverName: "fixture-intelligence",
  toolName: "safe_lookup",
  agentIds: ["FixtureAnalyst"],
  inputSchema: schema,
};

const complete: V2ToolCoverageEvidence = {
  serverName: tool.serverName,
  toolName: tool.toolName,
  schemaValidation: {
    testId: "fixture validates exact safe_lookup schema",
    schemaSha256: toolInputSchemaSha256(schema),
  },
  successPath: {
    testId: "fixture executes safe_lookup against a local no-network adapter",
    fixtureKind: "local_no_network",
    implementationLevel: "vendor_adapter",
  },
  failurePath: {
    testId: "fixture classifies safe_lookup input and deterministic failures",
    invalidInputCategory: "invalid_input",
    executionFailureCategory: "deterministic_tool_error",
  },
};

describe("V2 exact tool coverage release gate", () => {
  test("passes only when the exact schema, safe success path, and failure categories are covered", () => {
    expect(auditV2ToolCoverage([tool], [complete])).toEqual({
      registeredTools: 1,
      toolsWithInputSchemas: 1,
      schemaValidationCovered: 1,
      safeSuccessPathCovered: 1,
      failureClassificationCovered: 1,
      fullyCovered: 1,
      blockers: [],
      releasable: true,
    });
  });

  test("fails a newly registered tool with no evidence instead of inheriting generic bridge coverage", () => {
    const report = auditV2ToolCoverage([tool], []);
    expect(report.releasable).toBe(false);
    expect(report.fullyCovered).toBe(0);
    expect(report.blockers.map(({ code }) => code)).toEqual([
      "missing_schema_validation_test",
      "missing_safe_success_path_test",
      "missing_failure_classification_test",
    ]);
  });

  test("rejects stale schema tests and dispatcher-only mocks", () => {
    const report = auditV2ToolCoverage([tool], [{
      ...complete,
      schemaValidation: { ...complete.schemaValidation!, schemaSha256: "0".repeat(64) },
      successPath: { ...complete.successPath!, implementationLevel: "dispatcher_only" },
    }]);
    expect(report.releasable).toBe(false);
    expect(report.blockers.map(({ code }) => code)).toContain("schema_test_is_stale");
    expect(report.blockers.map(({ code }) => code)).toContain("dispatcher_only_success_test");
  });

  test("retains a verified implementation blocker instead of converting vendor-only proof into release success", () => {
    const report = auditV2ToolCoverage([tool], [{
      ...complete,
      successPath: undefined,
      implementationBlocker: {
        receiptId: `sechub_binary_receipt_${"a".repeat(64)}`,
        message: "The production executor loses the open binary between stateful calls.",
      },
    }]);
    expect(report.releasable).toBe(false);
    expect(report.fullyCovered).toBe(0);
    expect(report.blockers).toContainEqual({
      toolKey: "fixture-intelligence::safe_lookup",
      code: "implementation_blocked",
      message: "The production executor loses the open binary between stateful calls.",
    });
  });

  test("does not obscure one exact implementation blocker with generic missing-evidence noise", () => {
    const report = auditV2ToolCoverage([tool], [{
      serverName: tool.serverName,
      toolName: tool.toolName,
      schemaValidation: complete.schemaValidation,
      implementationBlocker: {
        receiptId: `fixture_receipt_${"a".repeat(64)}`,
        message: "The exact vendor implementation erases its dependency failure before the adapter can classify it.",
      },
    }]);
    expect(report.blockers).toEqual([{
      toolKey: "fixture-intelligence::safe_lookup",
      code: "implementation_blocked",
      message: "The exact vendor implementation erases its dependency failure before the adapter can classify it.",
    }]);
  });

  test("requires a hash-bound loopback receipt for a runtime-attested local implementation", () => {
    const attestedTool: RegisteredV2Tool = {
      ...tool,
      runtimeAttestation: {
        serverAssetSha256: "a".repeat(64),
        registryConfigSha256: "b".repeat(64),
      },
    };
    const withReceipt: V2ToolCoverageEvidence = {
      ...complete,
      successPath: {
        ...complete.successPath!,
        fixtureKind: "disposable_local_lab",
        implementationLevel: "vendor_implementation",
        localReceipt: {
          receiptId: `pentest_recon_canary_${"c".repeat(32)}`,
          observedAt: "2026-07-18T00:00:00.000Z",
          schemaSha256: toolInputSchemaSha256(schema),
          serverAssetSha256: "a".repeat(64),
          registryConfigSha256: "b".repeat(64),
          resultSha256: "d".repeat(64),
          invalidInputProofSha256: "e".repeat(64),
          deterministicFailureProofSha256: "f".repeat(64),
          fixtureKind: "disposable_local_lab",
          loopbackOnly: true,
          serviceUid: 1001,
          serviceGid: 1002,
          noNewPrivileges: true,
          publicRequests: 0,
          publicLlmCalls: 0,
          clientTargetsContacted: 0,
        },
      },
    };

    expect(auditV2ToolCoverage([attestedTool], [withReceipt])).toMatchObject({
      safeSuccessPathCovered: 1,
      fullyCovered: 1,
      releasable: true,
    });
    expect(auditV2ToolCoverage([attestedTool], [{
      ...withReceipt,
      successPath: {
        ...withReceipt.successPath!,
        localReceipt: {
          ...withReceipt.successPath!.localReceipt!,
          serverAssetSha256: "0".repeat(64),
        },
      },
    }]).blockers.map(({ code }) => code)).toContain("stale_server_asset");
  });

  test("keeps the gate closed when a safe fixture also exposes an implementation defect", () => {
    const report = auditV2ToolCoverage([tool], [{
      ...complete,
      implementationBlocker: {
        receiptId: `pentest_recon_canary_${"a".repeat(32)}`,
        message: "The vendor implementation reports a nonzero command exit as a successful MCP result.",
      },
    }]);
    expect(report.safeSuccessPathCovered).toBe(1);
    expect(report.fullyCovered).toBe(0);
    expect(report.releasable).toBe(false);
    expect(report.blockers).toContainEqual(expect.objectContaining({
      code: "implementation_blocked",
      message: expect.stringContaining("nonzero command exit"),
    }));
  });

  test("provider routes require success plus rate-limit, availability, and authentication failures", () => {
    const failed = auditV2ProviderCoverage([{ routeId: "grok-acp", exposed: true }], [{
      routeId: "grok-acp",
      successTestId: "provider success",
      failureTestIds: { rate_limit: "provider 429" },
    }]);
    expect(failed.releasable).toBe(false);
    expect(failed.blockers).toHaveLength(2);

    const passed = auditV2ProviderCoverage([{ routeId: "grok-acp", exposed: true }], [{
      routeId: "grok-acp",
      successTestId: "provider success",
      failureTestIds: {
        rate_limit: "provider 429",
        provider_unavailable: "provider unavailable",
        authentication_missing: "provider auth missing",
      },
    }]);
    expect(passed).toMatchObject({ exposedRoutes: 1, fullyCovered: 1, releasable: true });
  });
});
