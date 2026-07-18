import { describe, expect, test } from "bun:test";
import { classifyMcpToolFailure } from "../McpToolFailureClassifier";
import { adaptVulnIntelCveMcpContent } from "../VulnIntelCveResultAdapter";

function classify(toolName: string, text: string) {
  const content = adaptVulnIntelCveMcpContent(
    "vulnintel-cve-mcp",
    toolName,
    { text, isError: false },
  );
  return {
    content,
    category: classifyMcpToolFailure({
      error: content.isError ? "MCP tool reported an error (see output)" : null,
      outputPreview: content.text,
      isError: content.isError,
    }),
  };
}

describe("pinned VulnIntel CVE MCP result adapter", () => {
  test("preserves valid vendor output as success", () => {
    expect(classify("lookup_cve", "=== CVE-2021-44228 ===\nScore: 10.0 CRITICAL"))
      .toMatchObject({ content: { isError: false }, category: "unknown" });
    expect(classify("calculate_risk_score", "Risk Score: CVE-2021-44228\nScore: 98/100"))
      .toMatchObject({ content: { isError: false }, category: "unknown" });
  });

  test("turns exact vendor dependency-error envelopes into deterministic failures", () => {
    for (const [toolName, output] of [
      ["lookup_cve", "Error fetching CVE: fixture deterministic failure"],
      ["search_cves", "Search error: fixture deterministic failure"],
      ["get_epss_score", "EPSS query error: fixture deterministic failure"],
      ["check_package_vulns", "OSV query error: fixture deterministic failure"],
      ["get_attack_mapping", "ATT&CK mapping error: fixture deterministic failure"],
      ["parse_cvss", "CVSS parse error: fixture deterministic failure"],
      ["health_check", "CVE MCP Server — Health Check\nNVD API: ERROR — fixture deterministic failure"],
    ] as const) {
      expect(classify(toolName, output)).toMatchObject({
        content: { isError: true },
        category: "deterministic_tool_error",
      });
    }
  });

  test("keeps upstream 429 failures retryable without inducing a public rate limit", () => {
    for (const [toolName, output] of [
      ["lookup_cve", "NVD rate limit exceeded. Retry in ~30 seconds."],
      ["search_cves", "NVD rate limit exceeded. Retry in ~30 seconds."],
      ["get_epss_score", "EPSS query error: HTTP 429 rate limit"],
      ["check_package_vulns", "OSV query error: HTTP 429 rate limit"],
      ["get_attack_mapping", "ATT&CK mapping error: HTTP 429 rate limit"],
      ["health_check", "CVE MCP Server — Health Check\nNVD API: ERROR — HTTP 429 rate limit"],
    ] as const) {
      expect(classify(toolName, output)).toMatchObject({
        content: { isError: true },
        category: "rate_limit",
      });
    }
  });

  test("does not invent dependency health for the vendor risk scorer", () => {
    expect(classify(
      "calculate_risk_score",
      "Risk Score: CVE-2021-44228\nScore: 0.0/100 (LOW)",
    )).toMatchObject({ content: { isError: false }, category: "unknown" });
  });

  test("never reinterprets another MCP server", () => {
    expect(adaptVulnIntelCveMcpContent(
      "another-server",
      "lookup_cve",
      { text: "Error fetching CVE: fixture", isError: false },
    )).toEqual({ text: "Error fetching CVE: fixture", isError: false });
  });
});
