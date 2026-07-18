import { describe, expect, test } from "bun:test";
import type { McpToolResult } from "../McpTypes";
import { classifyMcpToolFailure } from "../McpToolFailureClassifier";

function result(outputPreview: string, overrides: Partial<McpToolResult> = {}): McpToolResult {
  return {
    success: false,
    dryRun: false,
    mcpServer: "vulnintel-nvd",
    toolName: "search_cves",
    specialistAgentId: "VulnIntel",
    outputPreview,
    fullOutputBytes: Buffer.byteLength(outputPreview),
    artifactId: null,
    evidenceIds: [],
    error: "MCP tool reported an error (see output)",
    durationMs: 0,
    isError: true,
    ...overrides,
  };
}

describe("MCP tool failure classification", () => {
  test("classifies the exact NVD adapter's no-result error as deterministic", () => {
    expect(classifyMcpToolFailure(result("❌ 错误: 未找到CVE: CVE-2099-999999")))
      .toBe("deterministic_tool_error");
  });

  test("classifies an upstream NVD HTTP 429 without intentionally inducing one", () => {
    expect(classifyMcpToolFailure(result("❌ 错误: 搜索失败: Request failed with status code 429")))
      .toBe("rate_limit");
  });

  test("preserves transient transport and timeout categories", () => {
    expect(classifyMcpToolFailure(result("搜索失败: socket hang up"))).toBe("transient_network");
    expect(classifyMcpToolFailure(result("搜索失败: timeout of 20000ms exceeded"))).toBe("timeout");
  });

  test("classifies exact reviewed command envelopes without trusting the vendor success flag", () => {
    expect(classifyMcpToolFailure(result(
      "Executing: httpx\nExit: null\nStderr:\nCommand timed out after 12000ms.",
      { success: false, isError: true },
    ))).toBe("timeout");
    expect(classifyMcpToolFailure(result(
      'Error: Required command "subfinder" is not available in PATH. Checked: /usr/bin/subfinder',
    ))).toBe("dependency_missing");
    expect(classifyMcpToolFailure(result(
      "Exit Code: 255\nStderr:\nNo OpenCL devices found",
    ))).toBe("deterministic_tool_error");
    expect(classifyMcpToolFailure(result(
      "Exit: null\nStderr:\nChild terminated without an exit status",
    ))).toBe("process_crash");
  });

  test("classifies an exact sandbox denial as policy, not a retryable transient error", () => {
    expect(classifyMcpToolFailure(result(
      "Exit Code: 126\nStderr:\n/usr/bin/nmap: exec: /usr/lib/nmap/nmap: Operation not permitted",
    ))).toBe("policy_denied");
  });

  test("does not infer a command failure from incidental human prose", () => {
    expect(classifyMcpToolFailure(result(
      "The report explains that an exit code can help diagnose a future run.",
      { isError: false, error: "MCP result was incomplete" },
    ))).toBe("unknown");
  });
});
