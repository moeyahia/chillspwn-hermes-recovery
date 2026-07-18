import { createHash } from "node:crypto";
import type { RiskLevel } from "../runtime/types";

/**
 * A reviewed live MCP tool is not automatically an executable capability.
 *
 * `supported_mapped` tools may be projected to an Autonomous plan only when
 * the active config also declares them and the normal mission/action policy
 * permits them. `guided_only` tools additionally require the exact durable
 * Guided-step approval boundary. The other two states are never projected or
 * dispatched, even if an installed third-party server advertises them.
 */
export const MCP_TOOL_DISPOSITIONS = [
  "supported_mapped",
  "guided_only",
  "prohibited",
  "intentionally_unavailable",
] as const;
export type McpToolDisposition = (typeof MCP_TOOL_DISPOSITIONS)[number];

export interface ReviewedMcpToolDisposition {
  readonly serverName: string;
  readonly toolName: string;
  readonly disposition: McpToolDisposition;
  readonly riskClass: RiskLevel;
  readonly mappedAgentIds: readonly string[];
  readonly reason: string;
}

export interface ReviewedMcpServerSurface {
  readonly serverName: string;
  readonly sourceRevision: string;
  readonly implementationSha256: string;
  /** Canonical SHA-256 of the complete live tool-name → inputSchema object. */
  readonly toolSchemaSurfaceSha256: string;
  readonly reviewedAt: string;
  readonly tools: readonly ReviewedMcpToolDisposition[];
}

const PENTEST_SERVER = "pentest-mcp-recon";
const VULNINTEL_SERVER = "vulnintel-cve-mcp";
const BINARY_ANALYSIS_SERVER = "sechub-binary-analysis";

const BINARY_ANALYSIS_TOOLS = [
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

function tool(
  serverName: string,
  toolName: string,
  disposition: McpToolDisposition,
  riskClass: RiskLevel,
  mappedAgentIds: readonly string[],
  reason: string,
): ReviewedMcpToolDisposition {
  return { serverName, toolName, disposition, riskClass, mappedAgentIds, reason };
}

/**
 * Reviewed against the installed tools/list schemas and implementation source.
 * This is deliberately an exposure policy, not a copy of every advertised
 * name into the agent allowlist.
 */
export const REVIEWED_MCP_SERVER_SURFACES: readonly ReviewedMcpServerSurface[] = [
  {
    serverName: PENTEST_SERVER,
    sourceRevision: "b644b150a8b837dba8311aad7ab01d90a86c177c",
    implementationSha256: "bb4575c81f799ec12239f8a9bfa11b2d1d59626ca3b0813348016898da991ac2",
    toolSchemaSurfaceSha256: "d4f5ed8f534a5a26fc53436626ebba68255ba7ac6d0c5d839c3b6bce59277a2f",
    reviewedAt: "2026-07-17T00:00:00.000Z",
    tools: [
      tool(PENTEST_SERVER, "setMode", "intentionally_unavailable", "file-write", [], "The vendor implementation mutates one process-global session mode, so concurrent runs cannot be isolated."),
      tool(PENTEST_SERVER, "nmapScan", "supported_mapped", "network", ["ReconScout"], "Bounded TCP Connect enumeration may run inside an explicit signed Safe Recon contract only after the capability-free V2 binary and service-user canary are healthy."),
      tool(PENTEST_SERVER, "generateWordlist", "guided_only", "credential-sensitive", ["CredSmith"], "The tool derives and writes credential-audit material; the operator must review the exact source words and retention boundary."),
      tool(PENTEST_SERVER, "runJohnTheRipper", "guided_only", "credential-sensitive", ["CredSmith"], "Offline password recovery can expose plaintext credentials and requires an exact Guided decision."),
      tool(PENTEST_SERVER, "runHashcat", "intentionally_unavailable", "credential-sensitive", [], "The pinned vendor constructs Hashcat argv incorrectly and the execution host has no verified compute runtime, so this binding remains unavailable until both defects are repaired and re-canary-tested."),
      tool(PENTEST_SERVER, "cancelScan", "intentionally_unavailable", "destructive", [], "The vendor scan identifier is process-global and is not bound to the requesting mission/run owner."),
      tool(PENTEST_SERVER, "listEngagementRecords", "prohibited", "credential-sensitive", [], "The vendor record store is process-global and can contain raw outputs from another engagement."),
      tool(PENTEST_SERVER, "getEngagementRecord", "prohibited", "credential-sensitive", [], "The vendor record store is process-global and lacks engagement isolation and canonical evidence authorization."),
      tool(PENTEST_SERVER, "createClientReport", "intentionally_unavailable", "file-write", [], "Reports must use the canonical evidence-linked ReportSmith pipeline rather than the vendor's in-memory record store."),
      tool(PENTEST_SERVER, "gobuster", "guided_only", "network", ["ReconScout", "WebBreaker"], "The vendor command can expand one call into many requests and lacks a complete per-call rate, redirect, wordlist-path, and target-expansion policy, so it remains one exact Guided decision."),
      tool(PENTEST_SERVER, "nikto", "guided_only", "network", ["WebBreaker"], "Active web vulnerability scanning is bounded to one exact authorized Guided step."),
      tool(PENTEST_SERVER, "subfinderEnum", "intentionally_unavailable", "network", [], "No exact reviewed Subfinder executable is currently reachable by the service account, and passive enumeration contacts public providers, so the binding stays suppressed pending reproducible provisioning and disclosure-aware canary evidence."),
      tool(PENTEST_SERVER, "httpxProbe", "intentionally_unavailable", "network", [], "The isolated service-account canary proved the pinned executable opens a public DNS-resolver socket even for a literal loopback target. Production has no equivalent per-call network namespace, so this binding remains unavailable until egress containment is enforced and re-canary-tested."),
      tool(PENTEST_SERVER, "ffufScan", "guided_only", "network", ["WebBreaker"], "The vendor command can generate high request volume and lacks a complete per-call rate, concurrency, raw-option, wordlist-path, and target-expansion policy, so it remains one exact Guided decision."),
      tool(PENTEST_SERVER, "nucleiScan", "intentionally_unavailable", "exploit-sensitive", [], "The isolated service-account canary proved the pinned executable opens a public DNS-resolver socket even for a literal loopback target and local template. Production has no equivalent per-call network namespace, so this binding remains unavailable until egress containment is enforced and re-canary-tested."),
      tool(PENTEST_SERVER, "trafficCapture", "prohibited", "credential-sensitive", [], "Packet capture can collect unrelated credentials and the vendor tool has no mission-scoped interface or capture isolation."),
      tool(PENTEST_SERVER, "hydraBruteforce", "guided_only", "credential-sensitive", ["CredSmith"], "Online authentication attempts can cause lockout and require exact target, rate, credential source, and operator authorization."),
      tool(PENTEST_SERVER, "privEscAudit", "prohibited", "terminal", [], "The implementation audits the Command OS host itself and has no isolated target/session binding."),
      tool(PENTEST_SERVER, "extractionSweep", "guided_only", "exploit-sensitive", ["WebBreaker"], "SQL injection validation and optional extraction require one exact authorized Guided decision and evidence boundary."),
    ],
  },
  {
    serverName: VULNINTEL_SERVER,
    sourceRevision: "809953e04c1db4eaa3b808747e16711d23964af4",
    implementationSha256: "8cd4c398522250754a68e6fb90189a18c7b3c8a904d8eca8bd0858ce7e594b1f",
    toolSchemaSurfaceSha256: "38284cd7d60716ed00202432f1da8fd6526d3f1780b20565e15d2deb8517a7a5",
    reviewedAt: "2026-07-17T00:00:00.000Z",
    tools: [
      tool(VULNINTEL_SERVER, "lookup_cve", "supported_mapped", "network", ["VulnIntel"], "Read-only authoritative CVE lookup using a normalized CVE identifier."),
      tool(VULNINTEL_SERVER, "search_cves", "supported_mapped", "network", ["VulnIntel"], "Read-only public CVE search with a bounded result limit."),
      tool(VULNINTEL_SERVER, "check_package_vulns", "supported_mapped", "network", ["VulnIntel"], "Read-only package/version lookup; the request contains one explicit component rather than a raw manifest."),
      tool(VULNINTEL_SERVER, "get_epss_score", "supported_mapped", "network", ["VulnIntel"], "Read-only EPSS lookup for explicit CVE identifiers."),
      tool(VULNINTEL_SERVER, "check_kev", "supported_mapped", "network", ["VulnIntel"], "Read-only CISA KEV lookup for one explicit CVE identifier."),
      tool(VULNINTEL_SERVER, "parse_cvss", "supported_mapped", "read-only", ["VulnIntel"], "Local CVSS vector parsing does not contact an engagement target."),
      tool(VULNINTEL_SERVER, "get_cve_summary", "intentionally_unavailable", "network", [], "The pinned vendor adapter erases an upstream HTTP 429 and returns a generic tool error, so V2 cannot preserve the required retry category until the adapter is repaired and re-canary-tested."),
      tool(VULNINTEL_SERVER, "health_check", "supported_mapped", "read-only", ["VulnIntel"], "Local service health and cache readiness check."),
      tool(VULNINTEL_SERVER, "check_ip_reputation", "intentionally_unavailable", "network", [], "It discloses a mission IP to external reputation providers and is not wired to the disclosure/engagement-isolation policy."),
      tool(VULNINTEL_SERVER, "get_domain_intel", "intentionally_unavailable", "network", [], "It belongs to the OSINT lane and discloses a mission domain to public CT/passive-DNS providers without a disclosure receipt."),
      tool(VULNINTEL_SERVER, "passive_dns_lookup", "intentionally_unavailable", "network", [], "It belongs to the OSINT lane and lacks the required public-provider exposure receipt."),
      tool(VULNINTEL_SERVER, "shodan_host_lookup", "intentionally_unavailable", "network", [], "It requires a Shodan credential that is intentionally not passed to this MCP route and needs OSINT disclosure policy."),
      tool(VULNINTEL_SERVER, "lookup_file_hash", "intentionally_unavailable", "network", [], "Malware/hash intelligence belongs to a separately reviewed threat-intelligence lane and optional provider credentials are not passed."),
      tool(VULNINTEL_SERVER, "check_url_safety", "prohibited", "credential-sensitive", [], "An unredacted URL may contain private paths, tokens, or query data and the implementation sends it to a public service."),
      tool(VULNINTEL_SERVER, "lookup_malware_family", "intentionally_unavailable", "network", [], "IOC attribution is outside the reviewed CVE route and needs a separately isolated threat-intelligence mapping."),
      tool(VULNINTEL_SERVER, "check_ransomware_intel", "intentionally_unavailable", "network", [], "Wallet/ransomware intelligence is outside the reviewed CVE route and has no mission data-classification mapping."),
      tool(VULNINTEL_SERVER, "get_vendor_advisory", "supported_mapped", "network", ["VulnIntel"], "Read-only vendor-advisory retrieval for one explicit CVE identifier."),
      tool(VULNINTEL_SERVER, "check_exploit_availability", "supported_mapped", "network", ["VulnIntel"], "Read-only public exploit-maturity lookup; it reports availability and never executes an exploit."),
      tool(VULNINTEL_SERVER, "get_attack_mapping", "supported_mapped", "network", ["VulnIntel"], "Read-only ATT&CK relationship lookup for one explicit CVE identifier."),
      tool(VULNINTEL_SERVER, "get_cve_timeline", "supported_mapped", "network", ["VulnIntel"], "Read-only publication, EPSS, and KEV timeline lookup."),
      tool(VULNINTEL_SERVER, "scan_dependencies", "intentionally_unavailable", "credential-sensitive", [], "The implementation sends a raw dependency manifest to OSV without a local sanitizer or disclosure receipt."),
      tool(VULNINTEL_SERVER, "scan_container_packages", "intentionally_unavailable", "credential-sensitive", [], "The implementation sends a raw package inventory to OSV without a local sanitizer or disclosure receipt."),
      tool(VULNINTEL_SERVER, "scan_repo_secrets", "prohibited", "credential-sensitive", [], "Secret-oriented search terms must not be sent to a public GitHub search endpoint by the CVE specialist."),
      tool(VULNINTEL_SERVER, "check_poc_exists", "supported_mapped", "network", ["VulnIntel"], "Read-only public PoC presence lookup; results are intelligence only and cannot authorize execution."),
      tool(VULNINTEL_SERVER, "calculate_risk_score", "intentionally_unavailable", "network", [], "The pinned vendor suppresses failed NVD, EPSS, and PoC dependencies and returns an ordinary-looking score, so V2 cannot distinguish complete prioritization from degraded data until it is repaired and re-canary-tested."),
      tool(VULNINTEL_SERVER, "generate_vuln_report", "intentionally_unavailable", "network", [], "Mission reports must come from canonical findings and verified evidence through ReportSmith."),
      tool(VULNINTEL_SERVER, "compare_cves", "supported_mapped", "network", ["VulnIntel"], "Read-only comparison of two to ten explicit CVE identifiers."),
    ],
  },
  {
    serverName: BINARY_ANALYSIS_SERVER,
    sourceRevision: "b6800740da9965e9dd3fde2ec3cf4c775c358f72",
    implementationSha256: "58af3b409791c415b9a9b16fd87fccad213c9c90fea007ac20b052787f748c84",
    toolSchemaSurfaceSha256: "d44e93f1776f482f89ee153fb5b21e7ed3a4e1ce3c14ab2452f13694d66909f8",
    reviewedAt: "2026-07-18T00:00:00.000Z",
    tools: BINARY_ANALYSIS_TOOLS.map((toolName) => tool(
      BINARY_ANALYSIS_SERVER,
      toolName,
      "intentionally_unavailable",
      "file-write",
      [],
      "The 32-binding disposable canary reached the pinned vendor image, but the production adapter is stateless, mounts no authorized input, and does not enforce network-none; this binding remains suppressed until that adapter and the observed vendor error semantics are repaired and re-canary-tested.",
    )),
  },
] as const;

const SURFACE_BY_SERVER = new Map(REVIEWED_MCP_SERVER_SURFACES.map((surface) => [surface.serverName, surface] as const));
const TOOL_BY_KEY = new Map(
  REVIEWED_MCP_SERVER_SURFACES.flatMap((surface) => surface.tools)
    .map((entry) => [`${entry.serverName}::${entry.toolName}`, entry] as const),
);

export function reviewedMcpServerSurface(serverName: string): ReviewedMcpServerSurface | null {
  return SURFACE_BY_SERVER.get(serverName) ?? null;
}

export function reviewedMcpToolDisposition(
  serverName: string,
  toolName: string,
): ReviewedMcpToolDisposition | null {
  return TOOL_BY_KEY.get(`${serverName}::${toolName}`) ?? null;
}

export function isMcpToolExposable(disposition: McpToolDisposition): boolean {
  return disposition === "supported_mapped" || disposition === "guided_only";
}

/** Reviewed unavailable/prohibited names are accounted policy decisions, not unmapped capabilities. */
export function isMcpToolDeliberatelySuppressed(disposition: McpToolDisposition): boolean {
  return disposition === "prohibited" || disposition === "intentionally_unavailable";
}

export type McpToolExecutionDecision = "allow" | "deny" | "require_approval" | "unknown_agent";

/**
 * Resolve a global roster decision against the exact reviewed server binding.
 * This keeps legacy/unreviewed server behavior unchanged while allowing a
 * signed Autonomous contract to use a reviewed Safe Recon binding. Guided
 * journey enforcement remains a separate exact-step boundary in the runtime.
 */
export function resolvedMcpToolExecutionDecision(
  serverName: string,
  toolName: string,
  agentId: string,
  fallback: McpToolExecutionDecision,
): McpToolExecutionDecision {
  if (fallback === "unknown_agent") return fallback;
  const surface = reviewedMcpServerSurface(serverName);
  if (!surface) return fallback;
  const entry = reviewedMcpToolDisposition(serverName, toolName);
  if (!entry || !isMcpToolExposable(entry.disposition) || !entry.mappedAgentIds.includes(agentId)) return "deny";
  return entry.disposition === "guided_only" ? "require_approval" : "allow";
}

export interface McpToolSurfaceReconciliation {
  readonly accepted: boolean;
  readonly exposedTools: readonly string[];
  readonly suppressedLiveTools: readonly string[];
  readonly reason: string;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("MCP schema surface contains a non-JSON value");
  return encoded;
}

export function mcpToolSchemaSurfaceSha256(
  schemas: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): string {
  return createHash("sha256").update(canonicalJson(schemas)).digest("hex");
}

export interface McpToolSchemaSurfaceAttestation {
  readonly accepted: boolean;
  readonly actualSha256: string | null;
  readonly reason: string;
}

/** A reviewed name with a changed argument schema is a new capability and fails closed. */
export function attestReviewedMcpToolSchemas(
  serverName: string,
  schemas: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): McpToolSchemaSurfaceAttestation {
  const review = reviewedMcpServerSurface(serverName);
  if (!review) return { accepted: true, actualSha256: null, reason: "No pinned vendor schema surface is required for this server" };
  const expectedNames = uniqueSorted(review.tools.map(({ toolName }) => toolName));
  const actualNames = uniqueSorted(Object.keys(schemas));
  if (
    expectedNames.length !== actualNames.length
    || expectedNames.some((name, index) => name !== actualNames[index])
  ) {
    return {
      accepted: false,
      actualSha256: null,
      reason: "Live input-schema keys do not match the complete reviewed tool surface",
    };
  }
  let actualSha256: string;
  try { actualSha256 = mcpToolSchemaSurfaceSha256(schemas); }
  catch {
    return { accepted: false, actualSha256: null, reason: "Live input schemas are not canonical JSON" };
  }
  return actualSha256 === review.toolSchemaSurfaceSha256
    ? { accepted: true, actualSha256, reason: "Complete live MCP input-schema surface matches the reviewed hash" }
    : { accepted: false, actualSha256, reason: "Live MCP input-schema surface differs from the reviewed hash" };
}

/**
 * Reconcile live tools/list with the reviewed disposition registry.
 *
 * For an unreviewed server the historical exact-match rule remains in force.
 * For the two reviewed vendor servers, the complete installed surface must
 * still match the reviewed inventory, but only the explicitly configured
 * supported/Guided subset is exposed. A newly advertised name fails closed.
 */
export function reconcileMcpToolSurface(
  serverName: string,
  configuredTools: readonly string[],
  liveTools: readonly string[],
): McpToolSurfaceReconciliation {
  const configured = uniqueSorted(configuredTools);
  const live = uniqueSorted(liveTools);
  const duplicateConfigured = configured.length !== configuredTools.length;
  const duplicateLive = live.length !== liveTools.length;
  if (duplicateConfigured || duplicateLive) {
    return {
      accepted: false,
      exposedTools: [],
      suppressedLiveTools: [],
      reason: "MCP tool surface contains duplicate names",
    };
  }

  const review = reviewedMcpServerSurface(serverName);
  if (!review) {
    const exact = configured.length === live.length
      && configured.every((name, index) => name === live[index]);
    return {
      accepted: exact,
      exposedTools: exact ? configured : [],
      suppressedLiveTools: [],
      reason: exact
        ? "Live MCP tool surface exactly matches the reviewed route declaration"
        : "MCP live tool surface differs from the reviewed route declaration",
    };
  }

  const reviewed = uniqueSorted(review.tools.map((entry) => entry.toolName));
  const unknownLive = live.filter((name) => !reviewed.includes(name));
  const missingLive = reviewed.filter((name) => !live.includes(name));
  if (unknownLive.length || missingLive.length) {
    return {
      accepted: false,
      exposedTools: [],
      suppressedLiveTools: [],
      reason: [
        unknownLive.length ? `unreviewed live tools: ${unknownLive.join(", ")}` : "",
        missingLive.length ? `reviewed tools missing from live server: ${missingLive.join(", ")}` : "",
      ].filter(Boolean).join("; "),
    };
  }

  const missingConfigured = configured.filter((name) => !live.includes(name));
  const prohibitedConfigured = configured.filter((name) => {
    const entry = reviewedMcpToolDisposition(serverName, name);
    return !entry || entry.disposition === "prohibited";
  });
  if (missingConfigured.length || prohibitedConfigured.length) {
    return {
      accepted: false,
      exposedTools: [],
      suppressedLiveTools: [],
      reason: [
        missingConfigured.length ? `configured tools missing from live server: ${missingConfigured.join(", ")}` : "",
        prohibitedConfigured.length ? `configured tools are prohibited or unreviewed: ${prohibitedConfigured.join(", ")}` : "",
      ].filter(Boolean).join("; "),
    };
  }

  const exposedTools = configured.filter((name) => {
    const entry = reviewedMcpToolDisposition(serverName, name);
    return Boolean(entry && isMcpToolExposable(entry.disposition));
  });
  const suppressedLiveTools = live.filter((name) => !exposedTools.includes(name));
  return {
    accepted: true,
    exposedTools,
    suppressedLiveTools,
    reason: suppressedLiveTools.length
      ? `Complete reviewed live surface attested; ${suppressedLiveTools.length} non-exposed tools remain suppressed by configuration or disposition`
      : "Complete reviewed live surface and configured exposure subset attested",
  };
}
