import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_ROSTER, getAgent } from "../../agents/agentRoster";
import {
  REVIEWED_MCP_SERVER_SURFACES,
  attestReviewedMcpToolSchemas,
  isMcpToolDeliberatelySuppressed,
  isMcpToolExposable,
  mcpToolSchemaSurfaceSha256,
  reconcileMcpToolSurface,
  resolvedMcpToolExecutionDecision,
  reviewedMcpServerSurface,
} from "../McpToolDispositionRegistry";

const PENTEST_LIVE = [
  "setMode",
  "nmapScan",
  "generateWordlist",
  "runJohnTheRipper",
  "runHashcat",
  "cancelScan",
  "listEngagementRecords",
  "getEngagementRecord",
  "createClientReport",
  "gobuster",
  "nikto",
  "subfinderEnum",
  "httpxProbe",
  "ffufScan",
  "nucleiScan",
  "trafficCapture",
  "hydraBruteforce",
  "privEscAudit",
  "extractionSweep",
] as const;

const PENTEST_CONFIGURED = [
  "nmapScan",
  "gobuster",
  "httpxProbe",
  "extractionSweep",
  "ffufScan",
  "nucleiScan",
  "nikto",
  "runJohnTheRipper",
  "generateWordlist",
  "hydraBruteforce",
] as const;

const VULNINTEL_LIVE = [
  "lookup_cve",
  "search_cves",
  "check_package_vulns",
  "get_epss_score",
  "check_kev",
  "parse_cvss",
  "get_cve_summary",
  "health_check",
  "check_ip_reputation",
  "get_domain_intel",
  "passive_dns_lookup",
  "shodan_host_lookup",
  "lookup_file_hash",
  "check_url_safety",
  "lookup_malware_family",
  "check_ransomware_intel",
  "get_vendor_advisory",
  "check_exploit_availability",
  "get_attack_mapping",
  "get_cve_timeline",
  "scan_dependencies",
  "scan_container_packages",
  "scan_repo_secrets",
  "check_poc_exists",
  "calculate_risk_score",
  "generate_vuln_report",
  "compare_cves",
] as const;

const VULNINTEL_CONFIGURED = [
  "lookup_cve",
  "search_cves",
  "get_cve_summary",
  "get_epss_score",
  "check_kev",
  "parse_cvss",
  "check_package_vulns",
  "get_attack_mapping",
  "calculate_risk_score",
  "health_check",
] as const;

const BINARY_ANALYSIS_LIVE = [
  "open_file",
  "close_file",
  "list_functions",
  "list_functions_tree",
  "list_libraries",
  "list_imports",
  "list_exports",
  "list_sections",
  "list_memory_maps",
  "show_function_details",
  "get_current_address",
  "show_info",
  "list_symbols",
  "list_entrypoints",
  "list_methods",
  "list_classes",
  "list_decompilers",
  "rename_function",
  "rename_flag",
  "use_decompiler",
  "get_function_prototype",
  "set_function_prototype",
  "set_comment",
  "list_strings",
  "list_all_strings",
  "analyze",
  "xrefs_to",
  "decompile_function",
  "list_files",
  "disassemble_function",
  "disassemble",
  "calculate",
] as const;

describe("reviewed MCP tool disposition registry", () => {
  test("accounts for every exact installed pentest and CVE tool name", () => {
    expect(reviewedMcpServerSurface("pentest-mcp-recon")?.tools.map(({ toolName }) => toolName))
      .toEqual([...PENTEST_LIVE]);
    expect(reviewedMcpServerSurface("vulnintel-cve-mcp")?.tools.map(({ toolName }) => toolName))
      .toEqual([...VULNINTEL_LIVE]);
    expect(reviewedMcpServerSurface("sechub-binary-analysis")?.tools.map(({ toolName }) => toolName))
      .toEqual([...BINARY_ANALYSIS_LIVE]);
    expect(REVIEWED_MCP_SERVER_SURFACES.map(({ tools }) => tools.length)).toEqual([19, 27, 32]);
  });

  test("pins source review provenance and gives every disposition an operator-readable reason", () => {
    for (const surface of REVIEWED_MCP_SERVER_SURFACES) {
      expect(surface.sourceRevision).toMatch(/^[0-9a-f]{40}$/u);
      expect(surface.implementationSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(surface.toolSchemaSurfaceSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(new Set(surface.tools.map(({ toolName }) => toolName)).size).toBe(surface.tools.length);
      for (const entry of surface.tools) {
        expect(entry.serverName).toBe(surface.serverName);
        expect(entry.reason.length).toBeGreaterThan(30);
      }
    }
  });

  test("canonicalizes schema-key order and rejects an incomplete reviewed schema surface", () => {
    const left = {
      beta: { type: "object", properties: { value: { type: "string" } } },
      alpha: { required: ["id"], properties: { id: { type: "string" } }, type: "object" },
    };
    const reordered = {
      alpha: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      beta: { properties: { value: { type: "string" } }, type: "object" },
    };
    expect(mcpToolSchemaSurfaceSha256(left)).toBe(mcpToolSchemaSurfaceSha256(reordered));
    expect(mcpToolSchemaSurfaceSha256({ ...reordered, beta: { type: "object" } }))
      .not.toBe(mcpToolSchemaSurfaceSha256(reordered));
    expect(attestReviewedMcpToolSchemas("pentest-mcp-recon", { nmapScan: { type: "object" } }))
      .toMatchObject({ accepted: false, reason: expect.stringContaining("schema keys") });
  });

  test("requires an actual agent mapping for exposed tools and no stale mapping for suppressed tools", () => {
    for (const surface of REVIEWED_MCP_SERVER_SURFACES) {
      for (const entry of surface.tools) {
        if (entry.disposition === "supported_mapped" || entry.disposition === "guided_only") {
          expect(entry.mappedAgentIds.length).toBeGreaterThan(0);
          for (const agentId of entry.mappedAgentIds) {
            const agent = getAgent(agentId);
            expect(agent).not.toBeNull();
            expect(agent?.allowedMcpServers).toContain(surface.serverName);
            expect(agent?.allowedTools).toContain(entry.toolName);
            if (entry.disposition === "guided_only") {
              expect(agent?.approvalRequiredTools).toContain(entry.toolName);
            }
          }
        } else {
          expect(isMcpToolDeliberatelySuppressed(entry.disposition)).toBe(true);
          expect(entry.mappedAgentIds).toEqual([]);
          const assignedAgents = AGENT_ROSTER.filter(({ allowedMcpServers }) => allowedMcpServers.includes(surface.serverName));
          for (const agent of assignedAgents) {
            const fallback = agent.allowedTools.includes(entry.toolName) ? "allow" : "deny";
            expect(resolvedMcpToolExecutionDecision(
              surface.serverName,
              entry.toolName,
              agent.agentId,
              fallback,
            )).toBe("deny");
          }
        }
      }
    }
  });

  test("resolves reviewed Safe Recon tools for Autonomous without changing unreviewed legacy decisions", () => {
    expect(resolvedMcpToolExecutionDecision(
      "pentest-mcp-recon",
      "nmapScan",
      "ReconScout",
      "require_approval",
    )).toBe("allow");
    for (const [toolName, agentId] of [
      ["gobuster", "ReconScout"],
      ["ffufScan", "WebBreaker"],
    ] as const) {
      expect(resolvedMcpToolExecutionDecision(
        "pentest-mcp-recon",
        toolName,
        agentId,
        "allow",
      )).toBe("require_approval");
    }
    expect(resolvedMcpToolExecutionDecision(
      "pentest-mcp-recon",
      "httpxProbe",
      "ReconScout",
      "allow",
    )).toBe("deny");
    expect(resolvedMcpToolExecutionDecision(
      "pentest-mcp-recon",
      "nucleiScan",
      "WebBreaker",
      "allow",
    )).toBe("deny");
    expect(resolvedMcpToolExecutionDecision(
      "pentest-mcp-recon",
      "runHashcat",
      "CredSmith",
      "require_approval",
    )).toBe("deny");
    expect(resolvedMcpToolExecutionDecision(
      "pentest-mcp-recon",
      "subfinderEnum",
      "ReconScout",
      "allow",
    )).toBe("deny");
    expect(resolvedMcpToolExecutionDecision(
      "vulnintel-cve-mcp",
      "get_cve_summary",
      "VulnIntel",
      "allow",
    )).toBe("deny");
    expect(resolvedMcpToolExecutionDecision(
      "vulnintel-cve-mcp",
      "calculate_risk_score",
      "VulnIntel",
      "allow",
    )).toBe("deny");
    expect(resolvedMcpToolExecutionDecision(
      "sechub-binary-analysis",
      "open_file",
      "ReverseSage",
      "allow",
    )).toBe("deny");
    expect(resolvedMcpToolExecutionDecision(
      "sechub-reconnaissance",
      "nmapScan",
      "ReconScout",
      "require_approval",
    )).toBe("require_approval");
  });

  test("keeps source-manifest declarations behind the reviewed exposure filter", () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "agents", "mcpArsenal.manifest.json"), "utf8"));
    for (const surface of REVIEWED_MCP_SERVER_SURFACES.filter(({ serverName }) => serverName !== "sechub-binary-analysis")) {
      const declared = manifest.servers.find((server: { mcpServerName?: string }) => server.mcpServerName === surface.serverName);
      const exposable = surface.tools.filter(({ disposition }) => isMcpToolExposable(disposition)).map(({ toolName }) => toolName).sort();
      const declaredExposable = declared.toolNames.filter((toolName: string) => {
        const entry = surface.tools.find((candidate) => candidate.toolName === toolName);
        return Boolean(entry && isMcpToolExposable(entry.disposition));
      }).sort();
      expect(declaredExposable).toEqual(exposable);
      for (const toolName of declared.toolNames) {
        const entry = surface.tools.find((candidate) => candidate.toolName === toolName);
        expect(entry).toBeDefined();
        expect(entry?.disposition).not.toBe("prohibited");
      }
      expect(declared.toolNames.length).toBeLessThan(surface.tools.length);
    }
    const binaryManifest = manifest.servers.find((server: { mcpServerName?: string }) => server.mcpServerName === "sechub-binary-analysis");
    expect(binaryManifest.toolNames).toHaveLength(6);
    for (const toolName of binaryManifest.toolNames) {
      expect(resolvedMcpToolExecutionDecision(
        "sechub-binary-analysis",
        toolName,
        "ReverseSage",
        "allow",
      )).toBe("deny");
    }
  });

  test("attests the complete reviewed live surface while exposing only the active configured subset", () => {
    const pentest = reconcileMcpToolSurface("pentest-mcp-recon", PENTEST_CONFIGURED, PENTEST_LIVE);
    expect(pentest).toMatchObject({
      accepted: true,
      exposedTools: PENTEST_CONFIGURED.filter((toolName) => ![
        "httpxProbe",
        "nucleiScan",
      ].includes(toolName)).sort(),
    });
    expect(pentest.suppressedLiveTools).toHaveLength(11);
    expect(pentest.suppressedLiveTools).toEqual(expect.arrayContaining([
      "trafficCapture",
      "privEscAudit",
      "listEngagementRecords",
      "runHashcat",
      "subfinderEnum",
      "httpxProbe",
      "nucleiScan",
    ]));

    const vulnintel = reconcileMcpToolSurface("vulnintel-cve-mcp", VULNINTEL_CONFIGURED, VULNINTEL_LIVE);
    expect(vulnintel).toMatchObject({
      accepted: true,
      exposedTools: VULNINTEL_CONFIGURED.filter((toolName) => ![
        "get_cve_summary",
        "calculate_risk_score",
      ].includes(toolName)).sort(),
    });
    expect(vulnintel.suppressedLiveTools).toHaveLength(19);
    expect(vulnintel.suppressedLiveTools).toEqual(expect.arrayContaining([
      "check_url_safety",
      "scan_repo_secrets",
      "scan_dependencies",
      "get_cve_summary",
      "calculate_risk_score",
    ]));

    const binary = reconcileMcpToolSurface(
      "sechub-binary-analysis",
      BINARY_ANALYSIS_LIVE,
      BINARY_ANALYSIS_LIVE,
    );
    expect(binary).toMatchObject({ accepted: true, exposedTools: [] });
    expect(binary.suppressedLiveTools).toEqual([...BINARY_ANALYSIS_LIVE].sort());
  });

  test("fails closed for vendor drift or configured prohibited tools while suppressing intentional unavailability", () => {
    expect(reconcileMcpToolSurface(
      "pentest-mcp-recon",
      PENTEST_CONFIGURED,
      [...PENTEST_LIVE, "newUnreviewedTool"],
    )).toMatchObject({ accepted: false, reason: expect.stringContaining("unreviewed live tools") });

    expect(reconcileMcpToolSurface(
      "vulnintel-cve-mcp",
      VULNINTEL_CONFIGURED,
      VULNINTEL_LIVE.filter((name) => name !== "health_check"),
    )).toMatchObject({ accepted: false, reason: expect.stringContaining("reviewed tools missing") });

    expect(reconcileMcpToolSurface(
      "pentest-mcp-recon",
      [...PENTEST_CONFIGURED, "trafficCapture"],
      PENTEST_LIVE,
    )).toMatchObject({ accepted: false, reason: expect.stringContaining("prohibited") });

    const configuredUnavailable = reconcileMcpToolSurface(
      "pentest-mcp-recon",
      [...PENTEST_CONFIGURED, "runHashcat", "subfinderEnum"],
      PENTEST_LIVE,
    );
    expect(configuredUnavailable).toMatchObject({
      accepted: true,
      exposedTools: PENTEST_CONFIGURED.filter((toolName) => ![
        "httpxProbe",
        "nucleiScan",
      ].includes(toolName)).sort(),
    });
    expect(configuredUnavailable.suppressedLiveTools).toEqual(expect.arrayContaining([
      "runHashcat",
      "subfinderEnum",
      "httpxProbe",
      "nucleiScan",
    ]));
  });

  test("preserves exact configured/live equality for servers without a reviewed vendor surface", () => {
    expect(reconcileMcpToolSurface("other-server", ["safe"], ["safe"]))
      .toMatchObject({ accepted: true, exposedTools: ["safe"] });
    expect(reconcileMcpToolSurface("other-server", ["safe"], ["safe", "extra"]))
      .toMatchObject({ accepted: false, exposedTools: [] });
  });
});
