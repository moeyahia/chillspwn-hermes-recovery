import { describe, expect, test } from "bun:test";
import {
  SECHUB_BINARY_ANALYSIS_TOOLS,
  sechubBinaryToolAssetSha256,
  sechubBinaryToolSurfaceSha256,
  sealSechubBinaryAnalysisCanaryReceipt,
  sechubBinaryReceiptCoverageEvidence,
  verifySechubBinaryAnalysisCanaryReceipt,
  type SechubBinaryAnalysisCanaryReceipt,
} from "../SechubBinaryAnalysisCanary";
import { toolInputSchemaSha256 } from "../V2ToolCoverageAudit";

const hash = "a".repeat(64);

function receipt(): SechubBinaryAnalysisCanaryReceipt {
  const inputSchema = { type: "object", properties: {} } as const;
  const tools = SECHUB_BINARY_ANALYSIS_TOOLS.map((toolName) => ({
    serverName: "sechub-binary-analysis" as const,
    toolName,
    inputSchema,
    inputSchemaSha256: toolInputSchemaSha256(inputSchema),
    toolAssetSha256: sechubBinaryToolAssetSha256(toolName, inputSchema),
    schemaValidationPassed: true,
    successPassed: true,
    deterministicFailurePassed: true,
    successSummary: "safe local success",
    failureSummary: "deterministic tool error",
  }));
  return sealSechubBinaryAnalysisCanaryReceipt({
    version: 1,
    generatedAt: "2026-07-17T16:00:00.000Z",
    serverName: "sechub-binary-analysis",
    specialistAgentId: "ReverseSage",
    safety: {
      fixtureKind: "disposable_local_lab",
      networkMode: "none",
      clientArtifactsUsed: 0,
      engagementTargetsContacted: 0,
      publicProvidersCalled: 0,
      fixtureExecutedByServer: false,
      readOnlyRootFilesystem: true,
      droppedCapabilities: true,
      noNewPrivileges: true,
    },
    assets: {
      serverImage: "radare2-mcp:latest",
      serverImageSha256: hash,
      adapterAssetSha256: hash,
      registryAssetSha256: hash,
      canaryImplementationSha256: hash,
      fixtureSourceSha256: hash,
      fixtureBinarySha256: hash,
      toolSurfaceSha256: sechubBinaryToolSurfaceSha256(tools),
    },
    adapterSupported: false,
    callsAttempted: 64,
    tools,
    blockers: [{
      code: "adapter_state_not_persistent",
      toolName: null,
      message: "The production adapter loses binary-analysis state between calls.",
    }],
  });
}

describe("sechub binary-analysis canary receipt", () => {
  test("accepts a complete content-addressed 32-tool no-network receipt", () => {
    const value = receipt();
    expect(verifySechubBinaryAnalysisCanaryReceipt(value)).toBe(true);
    expect(value.receiptId).toMatch(/^sechub_binary_receipt_[a-f0-9]{64}$/u);
  });

  test("preserves production adapter blockers instead of promoting vendor-only calls", () => {
    const evidence = sechubBinaryReceiptCoverageEvidence(receipt());
    expect(evidence).toHaveLength(32);
    expect(evidence.every((item) => !item.successPath && item.implementationBlocker)).toBe(true);
    expect(evidence.every((item) => item.failurePath?.executionFailureCategory === "deterministic_tool_error")).toBe(true);
  });

  test("rejects tampered, incomplete, or unsafe receipts", () => {
    const value = receipt();
    expect(verifySechubBinaryAnalysisCanaryReceipt({
      ...value,
      callsAttempted: 65,
    })).toBe(false);
    const incomplete = sealSechubBinaryAnalysisCanaryReceipt({
      ...value,
      tools: value.tools.slice(1),
    });
    expect(verifySechubBinaryAnalysisCanaryReceipt(incomplete)).toBe(false);
    const networked = sealSechubBinaryAnalysisCanaryReceipt({
      ...value,
      safety: { ...value.safety, networkMode: "bridge" as "none" },
    });
    expect(verifySechubBinaryAnalysisCanaryReceipt(networked)).toBe(false);
  });
});
