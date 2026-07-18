import type { AgentSpec, SpecialistDomain } from "../agents/types";
import {
  ACTION_CLASS_DEFINITIONS,
  ACTION_CLASS_IDS,
  type ActionClassId,
  type DeliverableId,
  type EvidenceTypeId,
  type RuntimeSourceManifests,
} from "../domain";
import type { EvidenceKind, RiskLevel } from "../runtime/types";
import type { CommandOsToolInventory } from "./CommandOsRuntimeAdapters";
import type { ProviderReadiness, RuntimeReadinessSnapshot } from "./RuntimeReadiness";
import type { FleetAgentProjection, McpServerProjection } from "./RuntimeProjectionService";

export interface HybridRuntimeCapabilityInput {
  readonly riskLevels: readonly RiskLevel[];
  readonly evidenceKinds: readonly EvidenceKind[];
  readonly agents: readonly AgentSpec[];
  readonly projectedAgents: readonly FleetAgentProjection[];
  readonly toolInventory: readonly CommandOsToolInventory[];
  readonly mcpServers: readonly McpServerProjection[];
  readonly providers: readonly ProviderReadiness[];
  readonly readiness: RuntimeReadinessSnapshot;
  readonly observedAt?: string;
}

const SPECIALTY_ACTIONS: Readonly<Record<SpecialistDomain, readonly ActionClassId[]>> = {
  reconnaissance: [
    "dns_domain_certificate_discovery",
    "active_host_discovery",
    "port_service_enumeration",
    "os_technology_fingerprinting",
  ],
  web: [
    "web_crawling_page_capture",
    "web_content_endpoint_discovery_fuzzing",
    "vulnerability_configuration_assessment",
    "authentication_testing",
  ],
  vulnerability_intelligence: ["cve_intelligence_applicability_validation"],
  credentials: ["credential_password_hash_assessment", "authentication_testing"],
  active_directory: ["active_directory_identity_operations"],
  cloud: ["cloud_container_kubernetes_assessment"],
  reverse_engineering: ["reverse_engineering_binary_analysis"],
  fuzzing: ["fuzzing_crash_discovery"],
  osint: ["passive_intelligence_osint", "dns_domain_certificate_discovery"],
  secrets_code: ["vulnerability_configuration_assessment"],
  persistent_execution: ["command_session_execution", "target_file_write", "cleanup_restoration"],
  reporting_memory: ["local_report_artifact_generation"],
};

const SPECIALTY_DELIVERABLES: Readonly<Record<SpecialistDomain, readonly DeliverableId[]>> = {
  reconnaissance: ["network_asset_map", "osi_application_stack_map", "engagement_timeline"],
  web: ["web_page_screenshot_gallery", "technical_findings"],
  vulnerability_intelligence: ["cve_applicability_register", "technical_findings"],
  credentials: ["technical_findings"],
  active_directory: ["attack_path_visualization", "technical_findings"],
  cloud: ["technical_findings", "remediation_plan"],
  reverse_engineering: ["scripts_and_documentation", "technical_findings"],
  fuzzing: ["scripts_and_documentation", "technical_findings"],
  osint: ["network_asset_map", "technical_findings"],
  secrets_code: ["technical_findings", "remediation_plan"],
  persistent_execution: ["engagement_timeline", "raw_technical_log_export"],
  reporting_memory: [
    "executive_summary",
    "technical_findings",
    "evidence_bundle",
    "remediation_plan",
    "obsidian_engagement_pack",
    "machine_readable_export",
    "pdf_html_markdown_report",
  ],
};

const RISK_ACTIONS: Readonly<Record<RiskLevel, readonly ActionClassId[]>> = {
  "read-only": [
    "passive_intelligence_osint",
    "dns_domain_certificate_discovery",
    "os_technology_fingerprinting",
    "cve_intelligence_applicability_validation",
    "reverse_engineering_binary_analysis",
    "local_report_artifact_generation",
  ],
  network: [
    "active_host_discovery",
    "port_service_enumeration",
    "web_crawling_page_capture",
    "web_content_endpoint_discovery_fuzzing",
    "vulnerability_configuration_assessment",
    "authentication_testing",
    "active_directory_identity_operations",
    "cloud_container_kubernetes_assessment",
  ],
  "file-write": ["target_file_write", "cleanup_restoration", "local_report_artifact_generation"],
  terminal: ["command_session_execution", "fuzzing_crash_discovery"],
  destructive: ["persistence", "denial_of_service_disruption", "destructive_modification"],
  "credential-sensitive": [
    "credential_password_hash_assessment",
    "authentication_testing",
    "active_directory_identity_operations",
    "lateral_movement_pivoting",
    "cloud_container_kubernetes_assessment",
  ],
  "exploit-sensitive": [
    "exploit_validation",
    "privilege_escalation",
    "lateral_movement_pivoting",
    "data_access_impact_validation",
    "persistence",
  ],
};

const EVIDENCE_KIND_TYPES: Readonly<Record<EvidenceKind, readonly EvidenceTypeId[]>> = {
  command_output: ["session_command_outcome"],
  file: ["hashed_file_artifact", "generated_script_validation"],
  screenshot: ["web_page_capture"],
  http_response: ["http_exchange"],
  finding: ["finding_reproduction", "cve_applicability"],
  artifact: ["hashed_file_artifact", "chain_of_custody"],
};

const TOOL_HINTS: readonly { readonly pattern: RegExp; readonly actions: readonly ActionClassId[] }[] = [
  { pattern: /(?:whois|harvest|virustotal|otx|shodan|typosquat|username)/iu, actions: ["passive_intelligence_osint"] },
  { pattern: /(?:dig|dns|subdomain|certificate|sslscan|whois)/iu, actions: ["dns_domain_certificate_discovery"] },
  { pattern: /(?:quick_scan|masscan|nmap|naabu|host_discovery)/iu, actions: ["active_host_discovery", "port_service_enumeration"] },
  { pattern: /(?:os_detection|fingerprint|httpx|sslscan)/iu, actions: ["os_technology_fingerprinting"] },
  { pattern: /(?:crawl|katana|gospider|capture|httpx)/iu, actions: ["web_crawling_page_capture"] },
  { pattern: /(?:ffuf|gobuster|ferox|fuzz|endpoint|wayback)/iu, actions: ["web_content_endpoint_discovery_fuzzing"] },
  { pattern: /(?:nuclei|nikto|wpscan|semgrep|gitleaks|prowler|trivy|vuln|config)/iu, actions: ["vulnerability_configuration_assessment"] },
  { pattern: /(?:searchsploit|cve|advisory)/iu, actions: ["cve_intelligence_applicability_validation"] },
  { pattern: /(?:hashcat|john|hydra|password|wordlist|credential)/iu, actions: ["credential_password_hash_assessment"] },
  { pattern: /(?:login|auth|token)/iu, actions: ["authentication_testing"] },
  { pattern: /(?:bloodhound|ad_enum|ldap|kerberos)/iu, actions: ["active_directory_identity_operations"] },
  { pattern: /(?:prowler|trivy|cloud|kubernetes|container)/iu, actions: ["cloud_container_kubernetes_assessment"] },
  { pattern: /(?:radare|decompile|disassemble|binary|binwalk|capa|strings|xrefs)/iu, actions: ["reverse_engineering_binary_analysis"] },
  { pattern: /(?:boofuzz|dharma|go_fuzz|crash|fuzzer)/iu, actions: ["fuzzing_crash_discovery"] },
  { pattern: /(?:create_session|execute|read_output|send_input|reconnect|terminal|process)/iu, actions: ["command_session_execution"] },
  { pattern: /(?:upload_file|write_file)/iu, actions: ["target_file_write"] },
  { pattern: /(?:kill_session|cleanup|restore)/iu, actions: ["cleanup_restoration"] },
  { pattern: /(?:report|export|artifact|write_file|read_file)/iu, actions: ["local_report_artifact_generation"] },
];

function unique<T extends string>(values: Iterable<T>): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function safeId(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "") || "unknown";
}

function toolId(serverId: string, toolName: string): string {
  return `tool:${serverId}:${safeId(toolName)}`;
}

function evidenceFor(actions: readonly ActionClassId[]): EvidenceTypeId[] {
  return unique(actions.flatMap((actionId) =>
    ACTION_CLASS_DEFINITIONS.find(({ id }) => id === actionId)?.defaultEvidenceTypeIds ?? []));
}

function actionsForTool(toolName: string, specialties: readonly SpecialistDomain[]): ActionClassId[] {
  const permitted = new Set(specialties.flatMap((specialty) => SPECIALTY_ACTIONS[specialty]));
  const matched = TOOL_HINTS.flatMap(({ pattern, actions }) => pattern.test(toolName) ? actions : [])
    .filter((action) => permitted.has(action));
  return unique(matched.length > 0 ? matched : permitted);
}

function providerModelId(provider: ProviderReadiness): string | undefined {
  // This is the only exact model currently returned by a live hybrid route.
  return provider.id === "grok-acp" ? "grok-4.5" : undefined;
}

/**
 * Converts live, attested hybrid runtime state into the canonical V2.4 intake
 * manifests. It never upgrades a configured-but-uncallable provider or an
 * unattested MCP declaration into executable readiness.
 */
export function buildHybridRuntimeSourceManifests(
  input: HybridRuntimeCapabilityInput,
): RuntimeSourceManifests {
  const observedAt = input.observedAt ?? new Date().toISOString();
  const projectedAgents = new Map(input.projectedAgents.map((agent) => [agent.id, agent] as const));
  const roster = new Map(input.agents.map((agent) => [agent.agentId, agent] as const));
  const serverByName = new Map(input.mcpServers.map((server) => [server.name, server] as const));
  const autonomousBindings = new Set(input.toolInventory.flatMap((item) =>
    item.mcpServer
      ? item.toolNames.map((toolName) => `${item.agentId}\0${item.mcpServer}\0${toolName}`)
      : []));

  interface Binding {
    readonly server: McpServerProjection;
    readonly toolName: string;
    readonly agentIds: Set<string>;
  }
  const bindings = new Map<string, Binding>();
  const addBinding = (server: McpServerProjection, toolName: string, agentId: string): void => {
    const key = `${server.id}\0${toolName}`;
    const current = bindings.get(key) ?? { server, toolName, agentIds: new Set<string>() };
    current.agentIds.add(agentId);
    bindings.set(key, current);
  };

  for (const server of input.mcpServers) {
    for (const toolName of server.capabilities) {
      for (const agent of input.agents) {
        if (agent.allowedMcpServers.includes(server.name) && agent.allowedTools.includes(toolName)) {
          addBinding(server, toolName, agent.agentId);
        }
      }
    }
  }
  for (const item of input.toolInventory) {
    const server = serverByName.get(item.mcpServer);
    if (!server || !roster.has(item.agentId)) continue;
    for (const toolName of item.toolNames) addBinding(server, toolName, item.agentId);
  }

  const providerManifests = input.providers.map((provider) => {
    const modelId = providerModelId(provider);
    const isLive = provider.callable && provider.health === "healthy" && modelId !== undefined;
    return {
      id: provider.id,
      authenticated: provider.authenticated,
      healthy: isLive,
      catalogObservedAt: provider.attestedAt ?? observedAt,
      models: !isLive ? [] : [{
        id: modelId,
        displayName: modelId,
        toolCalling: true,
        structuredOutput: true,
        enforcement: provider.enforcesAutonomousBoundary && input.readiness.actionBoundaryActive
          ? "enforced_executor" as const
          : "advisor_only" as const,
        compatibleActionClassIds: [...ACTION_CLASS_IDS],
        disclosureClasses: ["public", "sanitized_internal"],
      }],
    };
  });
  const modelRefs = providerManifests.flatMap((provider) => provider.models.map((model) => ({
    providerId: provider.id,
    modelId: model.id,
  })));

  const tools = [...bindings.values()].map((binding) => {
    const owners = [...binding.agentIds].flatMap((agentId) => {
      const agent = roster.get(agentId);
      return agent ? [agent] : [];
    });
    const specialties = unique(owners.map(({ specialty }) => specialty));
    const actionClassIds = actionsForTool(binding.toolName, specialties);
    const ownerAvailable = owners.some((owner) => {
      const status = projectedAgents.get(owner.agentId)?.status;
      return status === "available" || status === "busy";
    });
    const serverReady = binding.server.status === "healthy"
      && input.readiness.mcp.enabled
      && input.readiness.mcp.startPermitted;
    const autonomousEligible = owners.some((owner) =>
      autonomousBindings.has(`${owner.agentId}\0${binding.server.name}\0${binding.toolName}`));
    return {
      id: toolId(binding.server.id, binding.toolName),
      label: `${binding.toolName} · ${binding.server.name}`,
      available: ownerAvailable && serverReady,
      locallyPolicyEnforced: autonomousEligible && input.readiness.actionBoundaryActive,
      requiresModel: true,
      actionClassIds,
      evidenceTypeIds: evidenceFor(actionClassIds),
      deliverableIds: unique(owners.flatMap(({ specialty }) => SPECIALTY_DELIVERABLES[specialty])),
      riskClassIds: unique(owners.map(({ riskProfile }) => riskProfile)
        .filter((risk) => input.riskLevels.includes(risk as RiskLevel))),
      mcpServerId: binding.server.id,
      dependencies: [{ id: `mcp:${binding.server.id}:ready`, ready: serverReady }],
    };
  });

  const toolByAgent = new Map<string, string[]>();
  for (const binding of bindings.values()) {
    for (const agentId of binding.agentIds) {
      const ids = toolByAgent.get(agentId) ?? [];
      ids.push(toolId(binding.server.id, binding.toolName));
      toolByAgent.set(agentId, ids);
    }
  }

  return {
    riskClasses: input.riskLevels.map((risk) => ({
      id: risk,
      label: risk,
      actionClassIds: RISK_ACTIONS[risk],
    })),
    evidenceKinds: input.evidenceKinds.map((kind) => ({
      id: kind,
      label: kind.replaceAll("_", " "),
      evidenceTypeIds: EVIDENCE_KIND_TYPES[kind],
    })),
    capabilities: unique(input.agents.map(({ specialty }) => specialty)).map((specialty) => ({
      id: `capability:${specialty}`,
      label: specialty.replaceAll("_", " "),
      actionClassIds: SPECIALTY_ACTIONS[specialty],
      evidenceTypeIds: evidenceFor(SPECIALTY_ACTIONS[specialty]),
      deliverableIds: SPECIALTY_DELIVERABLES[specialty],
    })),
    tools,
    mcpServers: input.mcpServers.map((server) => ({
      id: server.id,
      label: server.name,
      status: server.status === "healthy" || server.status === "degraded" || server.status === "offline"
        ? server.status
        : "unconfigured",
      toolIds: unique(tools.filter((tool) => tool.mcpServerId === server.id).map(({ id }) => id)),
    })),
    agents: input.agents.map((agent) => {
      const projected = projectedAgents.get(agent.agentId);
      return {
        id: agent.agentId,
        label: agent.displayName,
        available: projected?.status === "available" || projected?.status === "busy",
        capabilityIds: [`capability:${agent.specialty}`],
        actionClassIds: SPECIALTY_ACTIONS[agent.specialty],
        toolIds: unique(toolByAgent.get(agent.agentId) ?? []),
        deliverableIds: SPECIALTY_DELIVERABLES[agent.specialty],
        modelRefs,
      };
    }),
    providers: providerManifests,
  };
}
