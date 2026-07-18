import { describe, expect, test } from "bun:test";
import {
  executeOfflineVulnIntelCveHarness,
  runVulnIntelCveLocalCanary,
  verifyVulnIntelCveLocalCanaryReceipt,
  VULNINTEL_CVE_CANARY_TOOLS,
} from "../VulnIntelCveLocalCanary";
import { auditV2ToolCoverage, type RegisteredV2Tool } from "../V2ToolCoverageAudit";
import { vulnIntelCveToolCoverageEvidenceFromReceipt } from "../V2ToolCoverageEvidence";

const VENDOR_ROOT = process.env.CHILLSPWN_VULNINTEL_VENDOR_ROOT
  ?? "/opt/chillspwn-assets/vuln-intel/cve-mcp-server";
const REGISTRY_CONFIG = process.env.MCP_ARSENAL_CONFIG
  ?? "/opt/chillspwn-mcp-arsenal/.mcp.arsenal.json";

describe("pinned VulnIntel CVE MCP offline implementation canary", () => {
  test("proves eight exact bindings and retains the two vendor error-semantics blockers", () => {
    const harness = executeOfflineVulnIntelCveHarness({ vendorRoot: VENDOR_ROOT });
    const registrations: RegisteredV2Tool[] = VULNINTEL_CVE_CANARY_TOOLS.map((toolName) => ({
      serverName: "vulnintel-cve-mcp",
      toolName,
      agentIds: ["VulnIntel"],
      inputSchema: harness.schemas[toolName],
    }));
    const receipt = runVulnIntelCveLocalCanary({
      registrations,
      registryConfigPath: REGISTRY_CONFIG,
      vendorRoot: VENDOR_ROOT,
      executeHarness: () => harness,
      now: () => new Date("2026-07-18T00:00:00.000Z"),
    });

    expect(verifyVulnIntelCveLocalCanaryReceipt(receipt)).toBe(true);
    expect(receipt.completeSchemaSurfaceSha256)
      .toBe("38284cd7d60716ed00202432f1da8fd6526d3f1780b20565e15d2deb8517a7a5");
    expect(receipt.networkAttempts).toBe(0);
    expect(receipt.publicRequests).toBe(0);
    expect(receipt.publicLlmCalls).toBe(0);
    expect(receipt.clientTargetsContacted).toBe(0);
    expect(receipt.tools.filter(({ blocker }) => blocker === null).map(({ toolName }) => toolName))
      .toEqual([
        "lookup_cve",
        "search_cves",
        "get_epss_score",
        "check_kev",
        "parse_cvss",
        "check_package_vulns",
        "get_attack_mapping",
        "health_check",
      ]);
    expect(receipt.tools.filter(({ blocker }) => blocker !== null).map(({ toolName }) => toolName))
      .toEqual(["get_cve_summary", "calculate_risk_score"]);

    const evidence = vulnIntelCveToolCoverageEvidenceFromReceipt(receipt);
    const attestedRegistrations = registrations.map((registration) => ({
      ...registration,
      runtimeAttestation: {
        serverAssetSha256: receipt.serverAssetSha256,
        registryConfigSha256: receipt.registryConfigSha256,
      },
    }));
    const report = auditV2ToolCoverage(attestedRegistrations, evidence);
    expect(report).toMatchObject({
      registeredTools: 10,
      toolsWithInputSchemas: 10,
      schemaValidationCovered: 10,
      safeSuccessPathCovered: 8,
      failureClassificationCovered: 9,
      fullyCovered: 8,
      releasable: false,
    });
    expect(report.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        toolKey: "vulnintel-cve-mcp::get_cve_summary",
        code: "implementation_blocked",
        message: expect.stringContaining("erases upstream 429"),
      }),
      expect.objectContaining({
        toolKey: "vulnintel-cve-mcp::calculate_risk_score",
        code: "implementation_blocked",
        message: expect.stringContaining("ordinary-looking score"),
      }),
    ]));
  }, 30_000);

  test("rejects a mutated receipt instead of treating JSON presence as proof", () => {
    const harness = executeOfflineVulnIntelCveHarness({ vendorRoot: VENDOR_ROOT });
    const registrations: RegisteredV2Tool[] = VULNINTEL_CVE_CANARY_TOOLS.map((toolName) => ({
      serverName: "vulnintel-cve-mcp",
      toolName,
      agentIds: ["VulnIntel"],
      inputSchema: harness.schemas[toolName],
    }));
    const receipt = runVulnIntelCveLocalCanary({
      registrations,
      registryConfigPath: REGISTRY_CONFIG,
      vendorRoot: VENDOR_ROOT,
      executeHarness: () => harness,
      now: () => new Date("2026-07-18T00:00:00.000Z"),
    });
    expect(verifyVulnIntelCveLocalCanaryReceipt({
      ...receipt,
      publicRequests: 1 as 0,
    })).toBe(false);
    expect(vulnIntelCveToolCoverageEvidenceFromReceipt({
      ...receipt,
      receiptId: `vulnintel_cve_canary_${"0".repeat(32)}`,
    })).toEqual([]);
  }, 30_000);
});
