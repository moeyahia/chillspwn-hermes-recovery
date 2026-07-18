const VULNINTEL_CVE_SERVER = "vulnintel-cve-mcp";

const VULNINTEL_CVE_TOOLS = new Set([
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
]);

const TOOL_FAILURE_OUTPUTS: Readonly<Record<string, readonly RegExp[]>> = {
  lookup_cve: [
    /^Invalid CVE ID format\./u,
    /^Request timed out after 15 seconds\./u,
    /^NVD rate limit exceeded\./u,
    /^Error fetching CVE:/u,
  ],
  search_cves: [
    /^Invalid search query\./u,
    /^Request timed out after 15 seconds\./u,
    /^NVD rate limit exceeded\./u,
    /^Search error:/u,
  ],
  get_cve_summary: [
    /^Invalid CVE ID format\./u,
    /^Request timed out after 15 seconds\./u,
    /SEVERITY: \(NVD data unavailable\)[\s\S]*EPSS Score:\s+\(unavailable\)/u,
  ],
  get_epss_score: [
    /^Invalid CVE ID:/u,
    /^No valid CVE IDs provided\./u,
    /^Request timed out after 15 seconds\./u,
    /^EPSS query error:/u,
  ],
  check_kev: [/^Invalid CVE ID format\./u],
  parse_cvss: [/^Unsupported CVSS vector\./u, /^CVSS parse error:/u],
  check_package_vulns: [
    /^Request timed out after 15 seconds\./u,
    /^OSV query error:/u,
  ],
  get_attack_mapping: [
    /^Invalid CVE ID format\./u,
    /^Request timed out after 60 seconds/u,
    /^ATT&CK mapping error:/u,
  ],
  // The reviewed vendor currently hides dependency errors behind an ordinary
  // low-risk result. Deliberately do not guess that a valid-looking score is a
  // failure; the canary retains this binding as an implementation blocker.
  calculate_risk_score: [],
  health_check: [
    /NVD API:\s+(?:TIMEOUT|ERROR)/u,
    /NVD API:\s+OK \(HTTP (?:429|5\d\d)\)/u,
  ],
};

export interface AdaptedMcpContent {
  readonly text: string;
  readonly isError: boolean;
}
/**
 * Normalize the pinned CVE MCP's documented text error envelopes into the MCP
 * protocol error bit. The vendor catches most dependency exceptions and
 * returns a normal text result, which otherwise makes the generic bridge label
 * a failed NVD/OSV/EPSS call as success.
 *
 * This adapter is intentionally exact-server and exact-tool scoped. Unknown
 * content and other MCP servers retain their protocol-provided state.
 */
export function adaptVulnIntelCveMcpContent(
  serverName: string,
  toolName: string,
  content: Readonly<AdaptedMcpContent>,
): AdaptedMcpContent {
  if (
    content.isError
    || serverName !== VULNINTEL_CVE_SERVER
    || !VULNINTEL_CVE_TOOLS.has(toolName)
  ) return content;
  const knownFailure = TOOL_FAILURE_OUTPUTS[toolName]?.some((pattern) => pattern.test(content.text)) === true;
  return knownFailure ? { ...content, isError: true } : content;
}
