#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { AGENT_ROSTER, getAgent } from "../../server/agents/agentRoster";
import { specialistToolDecision } from "../../server/agents/agentMcpMap";
import { McpArsenalBridge } from "../../server/mcp/McpArsenalBridge";
import {
  auditV2ProviderCoverage,
  auditV2ToolCoverage,
  type RegisteredV2Tool,
} from "../../server/mcp/V2ToolCoverageAudit";
import {
  V2_PROVIDER_COVERAGE_EVIDENCE,
  V2_TOOL_COVERAGE_EVIDENCE,
  nvdToolCoverageEvidenceFromReceipt,
  pentestReconCoverageEvidenceFromReceipt,
  pentestReconRegistrationsWithRuntime,
  vulnIntelCveToolCoverageEvidenceFromReceipt,
} from "../../server/mcp/V2ToolCoverageEvidence";
import { runV2ToolSchemaCanary } from "../../server/mcp/V2ToolSchemaCanary";
import { toolInputSchemaSha256 } from "../../server/mcp/V2ToolCoverageAudit";
import {
  attestReviewedMcpToolSchemas,
  isMcpToolDeliberatelySuppressed,
  reconcileMcpToolSurface,
  reviewedMcpToolDisposition,
} from "../../server/mcp/McpToolDispositionRegistry";
import {
  nvdRuntimeAttestation,
  runNvdToolLiveCanary,
  type NvdToolLiveCanaryReceipt,
} from "../../server/mcp/NvdToolLiveCanary";
import {
  runVulnIntelCveLocalCanary,
  type VulnIntelCveLocalCanaryReceipt,
} from "../../server/mcp/VulnIntelCveLocalCanary";
import {
  PROVISIONED_PENTEST_RECON_SERVICE_PATH,
  runPentestReconLiveCanary,
  type PentestReconLiveCanaryReceipt,
} from "../../server/mcp/PentestReconLiveCanary";

const args = new Set(process.argv.slice(2));
const reportOnly = args.has("--report-only");
const jsonOutput = args.has("--json");
const allowDocker = args.has("--allow-docker");
const livePublicNvdCanary = args.has("--live-public-nvd-canary");
const localVulnIntelCanary = args.has("--local-vulnintel-canary");
const livePentestReconCanary = args.has("--live-pentest-recon-canary");
const configPath = resolve(
  process.env.MCP_ARSENAL_CONFIG || "/opt/chillspwn-mcp-arsenal/.mcp.arsenal.json",
);
const manifestPath = resolve(import.meta.dir, "../../server/agents/mcpArsenal.manifest.json");

const bridge = new McpArsenalBridge({
  configPath,
  manifestPath,
  mode: "enabled",
  allowDocker,
  startServers: true,
  defaultTimeoutMs: 30_000,
  maxOutputBytes: 64 * 1024,
});

if (bridge.loadError()) {
  console.error(`V2 tool coverage audit could not load the active registry: ${bridge.loadError()}`);
  process.exitCode = reportOnly ? 0 : 1;
} else {
  const configured = bridge.listServers();
  const enabled = configured.filter(({ spec }) => spec.enabled);
  const configuredBindings = configured.reduce((count, { spec }) => count + spec.toolNames.length, 0);
  const enabledBindings = enabled.reduce((count, { spec }) => count + spec.toolNames.length, 0);
  let policyMappedBindings = 0;
  let enabledPolicyMappedBindings = 0;
  const unmappedBindings: string[] = [];
  const enabledUnmappedBindings: string[] = [];
  const deliberatelySuppressedBindings: string[] = [];
  const enabledDeliberatelySuppressedBindings: string[] = [];
  for (const { spec } of configured) {
    for (const toolName of spec.toolNames) {
      const key = `${spec.name}::${toolName}`;
      const reviewedDisposition = reviewedMcpToolDisposition(spec.name, toolName);
      if (
        reviewedDisposition
        && isMcpToolDeliberatelySuppressed(reviewedDisposition.disposition)
      ) {
        deliberatelySuppressedBindings.push(key);
        if (spec.enabled) enabledDeliberatelySuppressedBindings.push(key);
        continue;
      }
      const mapped = spec.assignedAgents.some((agentId) => {
        const agent = getAgent(agentId);
        return Boolean(
          agent
          && agent.allowedMcpServers.includes(spec.name)
          && agent.allowedTools.includes(toolName),
        );
      });
      if (mapped) {
        policyMappedBindings += 1;
        if (spec.enabled) enabledPolicyMappedBindings += 1;
      } else {
        unmappedBindings.push(key);
        if (spec.enabled) enabledUnmappedBindings.push(key);
      }
    }
  }

  const registrations: RegisteredV2Tool[] = [];
  const vulnIntelDiagnosticRegistrations: RegisteredV2Tool[] = [];
  const routes: Array<{
    readonly serverName: string;
    readonly declaredTools: number;
    readonly liveTools: number;
    readonly status: "exact_attested" | "reviewed_filtered_attested" | "tool_surface_drift" | "probe_failed";
    readonly reason: string;
  }> = [];

  // The default audit performs only tools/list. An explicit
  // --live-public-nvd-canary additionally makes the three bounded, sequential
  // public-NVD calls documented by NvdToolLiveCanary; it never accepts or
  // derives a mission/client target and never invokes an LLM.
  for (const { spec } of enabled) {
    const probe = await bridge.probeTools(spec.name);
    if (!probe.ok || !probe.tools || !probe.toolSchemas) {
      routes.push({
        serverName: spec.name,
        declaredTools: spec.toolNames.length,
        liveTools: probe.tools?.length ?? 0,
        status: "probe_failed",
        reason: probe.error ?? "tools/list did not return exact input schemas",
      });
      continue;
    }
    const declared = [...new Set(spec.toolNames)].sort();
    const live = [...new Set(probe.tools)].sort();
    const reconciliation = reconcileMcpToolSurface(spec.name, declared, live);
    if (!reconciliation.accepted) {
      routes.push({
        serverName: spec.name,
        declaredTools: declared.length,
        liveTools: live.length,
        status: "tool_surface_drift",
        reason: reconciliation.reason,
      });
      continue;
    }
    const schemaAttestation = attestReviewedMcpToolSchemas(spec.name, probe.toolSchemas);
    if (!schemaAttestation.accepted) {
      routes.push({
        serverName: spec.name,
        declaredTools: declared.length,
        liveTools: live.length,
        status: "tool_surface_drift",
        reason: schemaAttestation.reason,
      });
      continue;
    }
    routes.push({
      serverName: spec.name,
      declaredTools: declared.length,
      liveTools: live.length,
      status: reconciliation.suppressedLiveTools.length
        ? "reviewed_filtered_attested"
        : "exact_attested",
      reason: `${reconciliation.reason}; ${schemaAttestation.reason}`,
    });
    // The local CVE canary deliberately exercises both releasable bindings and
    // the two reviewed blocked bindings. These diagnostic registrations never
    // enter the executable release denominator below.
    if (spec.name === "vulnintel-cve-mcp") {
      for (const toolName of declared) {
        const inputSchema = probe.toolSchemas[toolName];
        if (!inputSchema) continue;
        vulnIntelDiagnosticRegistrations.push({
          serverName: spec.name,
          toolName,
          agentIds: [...spec.assignedAgents],
          inputSchema,
        });
      }
    }
    for (const toolName of reconciliation.exposedTools) {
      const agentIds = spec.assignedAgents.filter((agentId) => {
        const agent = getAgent(agentId);
        const decision = specialistToolDecision(agentId, toolName);
        return Boolean(
          agent
          && agent.allowedMcpServers.includes(spec.name)
          && (decision === "allow" || decision === "require_approval"),
        );
      });
      if (agentIds.length === 0) continue;
      const inputSchema = probe.toolSchemas[toolName];
      if (!inputSchema) continue;
      registrations.push({ serverName: spec.name, toolName, agentIds, inputSchema });
    }
  }

  let auditedRegistrations: readonly RegisteredV2Tool[] = registrations;
  let pentestReceipt: PentestReconLiveCanaryReceipt | undefined;
  let pentestCanaryError: string | undefined;
  let pentestToolCalls = 0;
  if (livePentestReconCanary) {
    try {
      pentestReceipt = await runPentestReconLiveCanary({
        registryConfigPath: configPath,
        // The aggregate release audit must exercise the exact private V2
        // bundle used by production dispatch. Falling back to the host PATH
        // here would test a different runtime and can hide a missing or stale
        // provisioned binary behind an environment-variable convention.
        servicePath: process.env.PENTEST_RECON_CANARY_SERVICE_PATH
          || PROVISIONED_PENTEST_RECON_SERVICE_PATH,
      });
      pentestToolCalls = pentestReceipt.tools.reduce((count, tool) => count
        + Number(tool.successAttempted)
        + Number(tool.deterministicFailureAttempted)
        + Number(tool.hardDeadlineExercised), 0);
      auditedRegistrations = pentestReconRegistrationsWithRuntime(auditedRegistrations, pentestReceipt);
    } catch (error) {
      pentestCanaryError = error instanceof Error ? error.message : String(error);
    }
  }
  let nvdReceipt: NvdToolLiveCanaryReceipt | undefined;
  let nvdCanaryError: string | undefined;
  let nvdToolCalls = 0;
  if (livePublicNvdCanary) {
    try {
      const entry = enabled.find(({ spec }) => spec.name === "vulnintel-nvd")?.spec;
      if (!entry?.cwd || !entry.args?.[0]) throw new Error("The trusted NVD server entry point is not configured");
      const serverAssetPaths = [
        resolve(entry.cwd, entry.args[0]),
        resolve(entry.cwd, "package.json"),
        resolve(entry.cwd, "package-lock.json"),
      ];
      if (!serverAssetPaths.every(existsSync)) throw new Error("One or more installed NVD server assets are missing");
      const runtimeAttestation = nvdRuntimeAttestation(serverAssetPaths, configPath);
      auditedRegistrations = auditedRegistrations.map((registration) => registration.serverName === "vulnintel-nvd"
        ? { ...registration, runtimeAttestation }
        : registration);
      nvdReceipt = await runNvdToolLiveCanary({
        registrations: auditedRegistrations,
        bridge: {
          execute: async (input) => {
            nvdToolCalls += 1;
            return bridge.execute(input);
          },
        },
        serverAssetPaths,
        registryConfigPath: configPath,
      });
    } catch (error) {
      nvdCanaryError = error instanceof Error ? error.message : String(error);
    }
  }

  let vulnIntelReceipt: VulnIntelCveLocalCanaryReceipt | undefined;
  let vulnIntelCanaryError: string | undefined;
  if (localVulnIntelCanary) {
    try {
      vulnIntelReceipt = runVulnIntelCveLocalCanary({
        registrations: vulnIntelDiagnosticRegistrations,
        registryConfigPath: configPath,
        vendorRoot: resolve(
          process.env.CHILLSPWN_VULNINTEL_VENDOR_ROOT
            || "/opt/chillspwn-assets/vuln-intel/cve-mcp-server",
        ),
      });
      auditedRegistrations = auditedRegistrations.map((registration) => registration.serverName === "vulnintel-cve-mcp"
        ? {
            ...registration,
            runtimeAttestation: {
              serverAssetSha256: vulnIntelReceipt!.serverAssetSha256,
              registryConfigSha256: vulnIntelReceipt!.registryConfigSha256,
            },
          }
        : registration);
    } catch (error) {
      vulnIntelCanaryError = error instanceof Error ? error.message : String(error);
    }
  }

  const schemaCanaryFailures: Array<{ readonly toolKey: string; readonly reason: string }> = [];
  const dynamicSchemaEvidence = auditedRegistrations.flatMap((tool) => {
    try {
      runV2ToolSchemaCanary(tool.inputSchema);
      return [{
        serverName: tool.serverName,
        toolName: tool.toolName,
        schemaValidation: {
          testId: "audit-v2-tool-coverage: exact live schema positive/negative canary",
          schemaSha256: toolInputSchemaSha256(tool.inputSchema),
        },
      }];
    } catch (error) {
      schemaCanaryFailures.push({
        toolKey: `${tool.serverName}::${tool.toolName}`,
        reason: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  });
  const executableEvidence = [
    ...V2_TOOL_COVERAGE_EVIDENCE,
    ...(pentestReceipt ? pentestReconCoverageEvidenceFromReceipt(pentestReceipt) : []),
    ...(nvdReceipt ? nvdToolCoverageEvidenceFromReceipt(nvdReceipt) : []),
    ...(vulnIntelReceipt ? vulnIntelCveToolCoverageEvidenceFromReceipt(vulnIntelReceipt) : []),
  ];
  const staticEvidence = new Map(executableEvidence.map((record) => [
    `${record.serverName}::${record.toolName}`,
    record,
  ] as const));
  const combinedEvidence = dynamicSchemaEvidence.map((schemaRecord) => ({
    ...schemaRecord,
    ...(staticEvidence.get(`${schemaRecord.serverName}::${schemaRecord.toolName}`) ?? {}),
    schemaValidation: schemaRecord.schemaValidation,
  }));
  for (const record of executableEvidence) {
    if (!combinedEvidence.some((item) => item.serverName === record.serverName && item.toolName === record.toolName)) {
      combinedEvidence.push(record);
    }
  }
  const tools = auditV2ToolCoverage(auditedRegistrations, combinedEvidence);
  const providers = auditV2ProviderCoverage(
    [
      { routeId: "grok-acp", exposed: true },
      { routeId: "codex-oauth", exposed: false },
      { routeId: "openrouter", exposed: false },
      { routeId: "gemini", exposed: false },
      { routeId: "claude-oauth", exposed: false },
    ],
    V2_PROVIDER_COVERAGE_EVIDENCE,
  );
  const result = {
    generatedAt: new Date().toISOString(),
    safety: {
      toolsListOnly: !livePublicNvdCanary && !localVulnIntelCanary && !livePentestReconCanary,
      toolsCalled: nvdToolCalls + (localVulnIntelCanary ? 28 : 0) + pentestToolCalls,
      publicMcpToolCalls: nvdToolCalls,
      offlineVendorImplementationCalls: (localVulnIntelCanary ? 28 : 0) + pentestToolCalls,
      clientTargetsContacted: 0,
      publicLlmProvidersCalled: 0,
      publicReadOnlyAuthoritiesCalled: nvdToolCalls > 0 ? ["services.nvd.nist.gov"] : [],
      dockerToolsListAllowed: allowDocker,
    },
    inventory: {
      configuredServers: configured.length,
      enabledServers: enabled.length,
      configuredToolBindings: configuredBindings,
      enabledToolBindings: enabledBindings,
      policyMappedToolBindings: policyMappedBindings,
      enabledPolicyMappedToolBindings: enabledPolicyMappedBindings,
      deliberatelySuppressedToolBindings: deliberatelySuppressedBindings.length,
      enabledDeliberatelySuppressedToolBindings: enabledDeliberatelySuppressedBindings.length,
      unmappedToolBindings: unmappedBindings.length,
      enabledUnmappedToolBindings: enabledUnmappedBindings.length,
      exactAttestedServers: routes.filter(({ status }) => status === "exact_attested" || status === "reviewed_filtered_attested").length,
      exactAttestedExposedTools: registrations.length,
    },
    routes,
    unmappedBindings,
    enabledUnmappedBindings,
    deliberatelySuppressedBindings,
    enabledDeliberatelySuppressedBindings,
    schemaCanaries: {
      attempted: auditedRegistrations.length,
      passed: auditedRegistrations.length - schemaCanaryFailures.length,
      failed: schemaCanaryFailures.length,
      failures: schemaCanaryFailures,
    },
    nvdLiveCanary: {
      requested: livePublicNvdCanary,
      passed: Boolean(nvdReceipt),
      ...(nvdReceipt ? { receipt: nvdReceipt } : {}),
      ...(nvdCanaryError ? { error: nvdCanaryError } : {}),
    },
    vulnIntelLocalCanary: {
      requested: localVulnIntelCanary,
      passed: Boolean(vulnIntelReceipt),
      ...(vulnIntelReceipt ? { receipt: vulnIntelReceipt } : {}),
      ...(vulnIntelCanaryError ? { error: vulnIntelCanaryError } : {}),
    },
    pentestReconLiveCanary: {
      requested: livePentestReconCanary,
      passed: Boolean(pentestReceipt),
      ...(pentestReceipt ? { receipt: pentestReceipt } : {}),
      ...(pentestCanaryError ? { error: pentestCanaryError } : {}),
    },
    tools,
    providers,
    releasable: routes.every(({ status }) => status === "exact_attested" || status === "reviewed_filtered_attested")
      && enabledUnmappedBindings.length === 0
      && schemaCanaryFailures.length === 0
      && tools.releasable
      && providers.releasable,
    staticRosterAgents: AGENT_ROSTER.length,
  };

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log([
      "V2 runtime tool coverage audit",
      `  configured: ${result.inventory.configuredServers} servers / ${result.inventory.configuredToolBindings} tool bindings`,
      `  enabled: ${result.inventory.enabledServers} servers / ${result.inventory.enabledToolBindings} tool bindings`,
      `  policy-mapped: ${result.inventory.policyMappedToolBindings} total / ${result.inventory.enabledPolicyMappedToolBindings} enabled`,
      `  deliberately suppressed: ${result.inventory.deliberatelySuppressedToolBindings} total / ${result.inventory.enabledDeliberatelySuppressedToolBindings} enabled`,
      `  exact live-attested: ${result.inventory.exactAttestedServers} servers / ${result.inventory.exactAttestedExposedTools} exposed tools`,
      `  per-tool schema tests: ${tools.schemaValidationCovered}/${tools.registeredTools}`,
      `  per-tool safe success tests: ${tools.safeSuccessPathCovered}/${tools.registeredTools}`,
      `  per-tool failure classification tests: ${tools.failureClassificationCovered}/${tools.registeredTools}`,
      `  fully covered tools: ${tools.fullyCovered}/${tools.registeredTools}`,
      `  provider routes fully covered: ${providers.fullyCovered}/${providers.exposedRoutes}`,
      `  route/config blockers: ${routes.filter(({ status }) => status !== "exact_attested" && status !== "reviewed_filtered_attested").length}`,
      `  schema canaries: ${result.schemaCanaries.passed}/${result.schemaCanaries.attempted}`,
      `  NVD live canary: ${result.nvdLiveCanary.requested ? (result.nvdLiveCanary.passed ? `PASS (${result.nvdLiveCanary.receipt?.receiptId})` : `FAIL (${result.nvdLiveCanary.error})`) : "not requested"}`,
      `  VulnIntel local canary: ${result.vulnIntelLocalCanary.requested ? (result.vulnIntelLocalCanary.passed ? `EVIDENCE (${result.vulnIntelLocalCanary.receipt?.receiptId}; ${result.vulnIntelLocalCanary.receipt?.tools.filter(({ blocker }) => blocker === null).length}/10 releasable)` : `FAIL (${result.vulnIntelLocalCanary.error})`) : "not requested"}`,
      `  Pentest recon live canary: ${result.pentestReconLiveCanary.requested ? (result.pentestReconLiveCanary.passed ? `EVIDENCE (${result.pentestReconLiveCanary.receipt?.receiptId}; ${result.pentestReconLiveCanary.receipt?.blockers.some(({ toolName }) => toolName === null) ? 0 : result.pentestReconLiveCanary.receipt?.tools.filter(({ blockers }) => blockers.length === 0).length}/12 without blockers)` : `FAIL (${result.pentestReconLiveCanary.error})`) : "not requested"}`,
      `  unmapped bindings: ${unmappedBindings.length} configured / ${enabledUnmappedBindings.length} enabled`,
      `  release gate: ${result.releasable ? "PASS" : "FAIL"}`,
      "Use --json for exact route, tool, and blocker records.",
    ].join("\n"));
  }
  process.exitCode = result.releasable || reportOnly ? 0 : 1;
}
