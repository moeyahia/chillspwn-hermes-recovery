import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { McpBridgeExecuteInput } from "../McpArsenalBridge";
import type { McpToolResult } from "../McpTypes";
import {
  NVD_KEYLESS_MIN_INTERVAL_MS,
  nvdRuntimeAttestation,
  runNvdToolLiveCanary,
} from "../NvdToolLiveCanary";
import { nvdToolCoverageEvidenceFromReceipt } from "../V2ToolCoverageEvidence";
import { auditV2ToolCoverage, type RegisteredV2Tool } from "../V2ToolCoverageAudit";

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});
function fixtureFiles(): { assets: string[]; config: string } {
  const root = mkdtempSync(join(tmpdir(), "chillspwn-nvd-canary-"));
  roots.push(root);
  const assets = [join(root, "index.js"), join(root, "package.json"), join(root, "package-lock.json")];
  assets.forEach((path, index) => {
    writeFileSync(path, `fixture-${index}\n`, { mode: 0o644 });
    chmodSync(path, 0o644);
  });
  const config = join(root, "arsenal.json");
  writeFileSync(config, "{\"server\":\"vulnintel-nvd\"}\n", { mode: 0o644 });
  chmodSync(config, 0o644);
  return { assets, config };
}

const GET_SCHEMA = {
  type: "object",
  properties: { cve_id: { type: "string", pattern: "^CVE-\\d{4}-\\d{4,}$" } },
  required: ["cve_id"],
} as const;
const SEARCH_SCHEMA = {
  type: "object",
  properties: {
    keyword: { type: "string" },
    limit: { type: "number", default: 10, minimum: 1, maximum: 20 },
  },
  required: ["keyword"],
} as const;

function registrations(runtime: ReturnType<typeof nvdRuntimeAttestation>): RegisteredV2Tool[] {
  return [
    { serverName: "vulnintel-nvd", toolName: "get_cve_details", agentIds: ["VulnIntel"], inputSchema: GET_SCHEMA, runtimeAttestation: runtime },
    { serverName: "vulnintel-nvd", toolName: "search_cves", agentIds: ["VulnIntel"], inputSchema: SEARCH_SCHEMA, runtimeAttestation: runtime },
  ];
}

function result(input: Partial<McpToolResult> & Pick<McpToolResult, "toolName">): McpToolResult {
  return {
    success: true,
    dryRun: false,
    mcpServer: "vulnintel-nvd",
    specialistAgentId: "VulnIntel",
    outputPreview: "",
    fullOutputBytes: 0,
    artifactId: null,
    evidenceIds: [],
    error: null,
    durationMs: 1,
    isError: false,
    ...input,
  };
}

describe("live public NVD tool coverage canary", () => {
  test("creates hash-bound evidence only after both implementations and the deterministic failure execute", async () => {
    const files = fixtureFiles();
    const runtime = nvdRuntimeAttestation(files.assets, files.config);
    const calls: McpBridgeExecuteInput[] = [];
    const waits: number[] = [];
    const outputs = [
      result({ toolName: "get_cve_details", outputPreview: "# CVE-2021-44228\nCVSS: 10.0\nSource: NVD" }),
      result({ toolName: "search_cves", outputPreview: "CVE-2021-44228 | CRITICAL\nSource: NVD" }),
      result({
        toolName: "get_cve_details",
        success: false,
        isError: true,
        error: "MCP tool reported an error (see output)",
        outputPreview: "❌ 错误: 未找到CVE: CVE-2099-999999",
      }),
    ];
    const receipt = await runNvdToolLiveCanary({
      registrations: registrations(runtime),
      bridge: {
        execute: async (input) => {
          calls.push(input);
          return outputs[calls.length - 1]!;
        },
      },
      serverAssetPaths: files.assets,
      registryConfigPath: files.config,
      sleep: async (milliseconds) => { waits.push(milliseconds); },
      now: () => new Date("2026-07-17T16:00:00.000Z"),
    });

    expect(calls.map(({ toolName, arguments: args }) => ({ toolName, args }))).toEqual([
      { toolName: "get_cve_details", args: { cve_id: "CVE-2021-44228" } },
      { toolName: "search_cves", args: { keyword: "Apache Log4j", limit: 2 } },
      { toolName: "get_cve_details", args: { cve_id: "CVE-2099-999999" } },
    ]);
    expect(waits).toEqual([NVD_KEYLESS_MIN_INTERVAL_MS, NVD_KEYLESS_MIN_INTERVAL_MS]);
    expect(receipt).toMatchObject({
      authority: "services.nvd.nist.gov",
      publicRequests: 3,
      publicLlmCalls: 0,
      clientTargetsContacted: 0,
      rateLimitInduced: false,
      serverAssetSha256: runtime.serverAssetSha256,
      registryConfigSha256: runtime.registryConfigSha256,
    });
    expect(receipt.tools).toHaveLength(2);

    const report = auditV2ToolCoverage(
      registrations(runtime),
      nvdToolCoverageEvidenceFromReceipt(receipt),
    );
    expect(report).toMatchObject({
      registeredTools: 2,
      schemaValidationCovered: 2,
      safeSuccessPathCovered: 2,
      failureClassificationCovered: 2,
      fullyCovered: 2,
      blockers: [],
      releasable: true,
    });
  });

  test("cannot weaken the NVD keyless request interval", async () => {
    const files = fixtureFiles();
    const runtime = nvdRuntimeAttestation(files.assets, files.config);
    let calls = 0;
    await expect(runNvdToolLiveCanary({
      registrations: registrations(runtime),
      bridge: { execute: async () => { calls += 1; throw new Error("must not run"); } },
      serverAssetPaths: files.assets,
      registryConfigPath: files.config,
      minimumRequestIntervalMs: NVD_KEYLESS_MIN_INTERVAL_MS - 1,
    })).rejects.toThrow("must be at least");
    expect(calls).toBe(0);
  });

  test("an edited or structurally invalid receipt never becomes coverage evidence", async () => {
    const files = fixtureFiles();
    const runtime = nvdRuntimeAttestation(files.assets, files.config);
    const receipt = {
      receiptVersion: 1 as const,
      receiptId: "nvd_canary_fixture",
      observedAt: "2026-07-17T16:00:00.000Z",
      authority: "services.nvd.nist.gov" as const,
      minimumRequestIntervalMs: NVD_KEYLESS_MIN_INTERVAL_MS,
      publicRequests: 3 as const,
      publicLlmCalls: 0 as const,
      clientTargetsContacted: 0 as const,
      rateLimitInduced: false as const,
      ...runtime,
      tools: registrations(runtime).map((tool) => ({
        toolName: tool.toolName as "get_cve_details" | "search_cves",
        schemaSha256: "0".repeat(64),
        resultSha256: "1".repeat(64),
        invalidInputProofSha256: "2".repeat(64),
        deterministicFailureProofSha256: "3".repeat(64),
        rateLimitProofSha256: "4".repeat(64),
        invalidInputCategory: "invalid_input" as const,
        deterministicFailureCategory: "deterministic_tool_error" as const,
        rateLimitFailureCategory: "rate_limit" as const,
      })),
    };
    const report = auditV2ToolCoverage(registrations(runtime), nvdToolCoverageEvidenceFromReceipt(receipt));
    expect(report.releasable).toBe(false);
    expect(report.blockers.map(({ code }) => code)).toEqual([
      "missing_schema_validation_test",
      "missing_safe_success_path_test",
      "missing_failure_classification_test",
      "missing_schema_validation_test",
      "missing_safe_success_path_test",
      "missing_failure_classification_test",
    ]);
  });
});
