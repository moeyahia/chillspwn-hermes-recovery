/**
 * Phase 15 — Specialist agent roster. 11 domain operators commanded by ChillsPwn (the
 * Commander-in-Chief, which is NOT in this roster). Every specialist: own persona, own MCP/tool
 * allowlist, own memory namespace, can PROPOSE but never APPROVE training lessons, never stores
 * target-specific secrets as reusable memory.
 */

import type { AgentSpec } from "./types";

const NO_SELF_APPROVE = false as const;

export const AGENT_ROSTER: AgentSpec[] = [
  {
    agentId: "ReconScout", displayName: "ReconScout", specialty: "reconnaissance",
    description: "Network discovery, port/service enumeration, tech fingerprinting, DNS/subdomain enumeration, attack-surface mapping.",
    personaId: "reconscout", defaultProvider: "openrouter",
    allowedMcpServers: ["sechub-reconnaissance", "pentest-mcp-recon"],
    allowedTools: ["quick_scan", "port_scan", "os_detection", "masscan_scan", "masscan_top_ports", "run_masscan", "get_scan_results", "list_active_scans", "nmap", "dig", "whois", "dnsenum", "sslscan",
      "nmapScan", "gobuster", "httpxProbe", // reviewed pentest-mcp tools; Subfinder is suppressed pending reproducible provisioning
      // 17.1 — operational tools the orchestrator actually implements (specialists execute via terminal/
      // SURFACE + save evidence via write_file; the MCP allowlist alone left workers with no scan/fs tool):
      "terminal", "read_file", "write_file", "search_files", "execute_code", "use_skill", "recall_conversation"],
    deniedTools: ["hashcat", "sqlmap", "create_session", "execute"],
    approvalRequiredTools: ["masscan_scan", "run_masscan", "masscan_top_ports", "nmapScan", "gobuster", "httpxProbe"],
    riskProfile: "network", canProposeTrainingLessons: true, canApproveTrainingLessons: NO_SELF_APPROVE,
    memoryNamespace: "agent:reconscout",
    outputContract: "WorkerResult with discovered hosts/ports/services + evidenceIds; recommend WebBreaker for web ports.",
    evidenceRequirements: "Every discovered service must cite a scan-output evidenceId.",
    handoffRules: [{ whenFinding: "web ports (80/443/8080)", handoffTo: "WebBreaker" }, { whenFinding: "SMB/LDAP/Kerberos (445/389/88)", handoffTo: "ADAttackMapper" }],
    routingSignals: ["scan", "ports", "services", "subdomains", "what is exposed", "nmap", "masscan", "attack surface", "enumerate"],
    safetyBoundaries: ["authorized lab targets only", "no exploitation", "no credential use"],
  },
  {
    agentId: "WebBreaker", displayName: "WebBreaker", specialty: "web",
    description: "Web app testing: scanning, directory/param fuzzing, vuln template scanning, proxy-assisted testing, SQLi assessment in scope.",
    personaId: "webbreaker", defaultProvider: "openrouter",
    allowedMcpServers: ["sechub-web-security", "sechub-exploitation", "pentest-mcp-recon"],
    allowedTools: ["ffuf_dir", "ffuf_vhost", "ffuf_param", "ffuf_custom", "analyze_urls", "fetch_wayback_urls", "get_fuzz_results", "get_fetch_results", "nikto", "wpscan", "searchsploit_search", "searchsploit_examine",
      "ffufScan", "nucleiScan", "httpxProbe", "gobuster", "extractionSweep"], // reviewed pentest-mcp tools
    deniedTools: ["hashcat", "create_session", "execute", "bloodhound_collect"],
    approvalRequiredTools: ["ffuf_custom", "sqlmap_assess", "searchsploit_examine", "ffufScan", "nucleiScan", "httpxProbe", "gobuster", "nikto", "extractionSweep"],
    riskProfile: "network", canProposeTrainingLessons: true, canApproveTrainingLessons: NO_SELF_APPROVE,
    memoryNamespace: "agent:webbreaker",
    outputContract: "WorkerResult with web findings (endpoints/params/vulns) + evidenceIds; hand any discovered creds to CredSmith.",
    evidenceRequirements: "Each vuln/endpoint cites the request/response evidenceId; redact secrets.",
    handoffRules: [{ whenFinding: "credentials / hashes", handoffTo: "CredSmith" }, { whenFinding: "binary download / firmware", handoffTo: "ReverseSage" }],
    routingSignals: ["web", "endpoint", "directory", "fuzz", "nuclei", "nikto", "sql injection", "wpscan", "vhost", "parameter"],
    safetyBoundaries: ["authorized web targets only", "no mass data exfiltration", "SQLi in assessment scope only"],
  },
  {
    agentId: "CredSmith", displayName: "CredSmith", specialty: "credentials",
    description: "Hash identification/cracking, wordlist generation, password audit, credential validation within explicit lab scope.",
    personaId: "credsmith", defaultProvider: "openrouter",
    allowedMcpServers: ["sechub-password-cracking", "pentest-mcp-recon"],
    allowedTools: ["hashcat_identify", "hashcat_crack", "get_crack_results", "hashcat",
      "runJohnTheRipper", "generateWordlist", "hydraBruteforce"], // runHashcat suppressed until vendor argv + compute runtime are repaired
    deniedTools: ["create_session", "execute", "ffuf_dir", "prowler_scan"],
    approvalRequiredTools: ["hashcat_crack", "hashcat", "runJohnTheRipper", "generateWordlist", "hydraBruteforce"],
    riskProfile: "credential-sensitive", canProposeTrainingLessons: true, canApproveTrainingLessons: NO_SELF_APPROVE,
    memoryNamespace: "agent:credsmith",
    outputContract: "WorkerResult with hash types + crack outcome (cracked: yes/no, NO plaintext in reusable memory) + evidenceIds.",
    evidenceRequirements: "Cite the hash-source evidenceId; cracked secrets are NEVER stored as reusable memory.",
    handoffRules: [{ whenFinding: "valid domain credentials", handoffTo: "ADAttackMapper" }],
    routingSignals: ["hash", "password", "wordlist", "john", "hashcat", "hydra", "crack", "credential"],
    safetyBoundaries: ["authorized lab hashes only", "no plaintext secrets in memory", "operator policy: heavy cracking on GPU host"],
  },
  {
    agentId: "ADAttackMapper", displayName: "ADAttackMapper", specialty: "active_directory",
    description: "AD enumeration, LDAP/Kerberos reasoning, BloodHound/RoadRecon-style graph analysis, WinRM/identity-path analysis.",
    personaId: "adattackmapper", defaultProvider: "openrouter",
    allowedMcpServers: ["sechub-active-directory"],
    allowedTools: ["ad_enum", "bloodhound_collect", "bloodhound_query"],
    deniedTools: ["hashcat", "create_session", "ffuf_dir", "prowler_scan"],
    approvalRequiredTools: ["bloodhound_collect", "ad_enum"],
    riskProfile: "credential-sensitive", canProposeTrainingLessons: true, canApproveTrainingLessons: NO_SELF_APPROVE,
    memoryNamespace: "agent:adattackmapper",
    outputContract: "WorkerResult with identity attack-path (technique + prerequisites) + evidenceIds; creds never stored as memory.",
    evidenceRequirements: "Each attack path cites the graph/collection evidenceId.",
    handoffRules: [{ whenFinding: "interactive session / shell need", handoffTo: "SessionRunner" }],
    routingSignals: ["AD", "domain", "BloodHound", "Kerberos", "LDAP", "WinRM", "trust", "gMSA", "active directory", "kerberoast", "asrep"],
    safetyBoundaries: ["authorized lab domain only", "no credential storage as reusable memory"],
  },
  {
    agentId: "CloudSentinel", displayName: "CloudSentinel", specialty: "cloud",
    description: "Cloud posture, container scanning, IaC scanning, Kubernetes/container findings.",
    personaId: "cloudsentinel", defaultProvider: "openrouter",
    allowedMcpServers: ["sechub-cloud-security"],
    allowedTools: ["prowler_scan", "prowler_compliance", "list_compliance_frameworks", "list_checks", "run_trivy_scan", "run_prowler_scan", "get_scan_results"],
    deniedTools: ["create_session", "execute", "hashcat", "bloodhound_collect"],
    approvalRequiredTools: ["prowler_scan", "run_prowler_scan"],
    riskProfile: "credential-sensitive", canProposeTrainingLessons: true, canApproveTrainingLessons: NO_SELF_APPROVE,
    memoryNamespace: "agent:cloudsentinel",
    outputContract: "WorkerResult with cloud/container/IaC misconfig findings + evidenceIds; read-only lab credentials only.",
    evidenceRequirements: "Each finding cites the scan-output evidenceId.",
    handoffRules: [{ whenFinding: "secrets in IaC/code", handoffTo: "SecretHunter" }],
    routingSignals: ["cloud", "AWS", "Azure", "container", "Docker", "IaC", "Kubernetes", "k8s", "prowler", "trivy", "terraform"],
    safetyBoundaries: ["read-only lab cloud credentials only", "no resource mutation"],
  },
  {
    agentId: "ReverseSage", displayName: "ReverseSage", specialty: "reverse_engineering",
    description: "Static binary analysis, firmware extraction, decompilation support, capability detection (YARA/CAPA/radare/Ghidra/IDA/JADX).",
    personaId: "reversesage", defaultProvider: "openrouter",
    allowedMcpServers: ["sechub-binary-analysis"],
    // Phase 19.2 — aligned to the real tool names exposed by the wired radare2-mcp stdio image
    // (read-only static analysis). Legacy sechub names kept so binwalk/capa servers can be added later.
    allowedTools: [
      "open_file", "close_file", "list_functions", "list_functions_tree", "list_libraries", "list_imports",
      "list_exports", "list_sections", "list_memory_maps", "show_function_details", "get_current_address",
      "show_info", "list_symbols", "list_entrypoints", "list_methods", "list_classes", "list_decompilers",
      "rename_function", "rename_flag", "use_decompiler", "get_function_prototype", "set_function_prototype",
      "set_comment", "list_strings", "list_all_strings", "analyze", "xrefs_to", "decompile_function",
      "list_files", "disassemble_function", "disassemble", "calculate",
      "binwalk_scan", "binwalk_extract", "binwalk_entropy", "binwalk_hexdump", "capa_analyze", "get_analysis_results"],
    deniedTools: ["create_session", "execute", "hashcat", "prowler_scan", "ffuf_dir"],
    approvalRequiredTools: ["binwalk_extract"],
    riskProfile: "file-write", canProposeTrainingLessons: true, canApproveTrainingLessons: NO_SELF_APPROVE,
    memoryNamespace: "agent:reversesage",
    outputContract: "WorkerResult with capabilities/strings/structure findings + evidenceIds; offline analysis only.",
    evidenceRequirements: "Each capability cites the analysis-artifact evidenceId.",
    handoffRules: [{ whenFinding: "crashing input / fuzz target", handoffTo: "FuzzSmith" }],
    routingSignals: ["binary", "firmware", "reverse", "APK", "Ghidra", "IDA", "radare", "yara", "capa", "decompile", "disassemble"],
    safetyBoundaries: ["offline analysis only", "no execution of untrusted binaries outside sandbox"],
  },
  {
    agentId: "FuzzSmith", displayName: "FuzzSmith", specialty: "fuzzing",
    description: "Protocol fuzzing, input generation, crash discovery, corpus/minimization support.",
    personaId: "fuzzsmith", defaultProvider: "openrouter",
    allowedMcpServers: ["sechub-fuzzing", "sechub-code-security"],
    allowedTools: ["boofuzz_run_fuzzer", "boofuzz_create_script", "boofuzz_list_scripts", "boofuzz_get_results", "dharma_generate", "dharma_generate_custom", "ftp_fuzzer", "run_dharma", "go_fuzz_run", "analyze_crashes"],
    deniedTools: ["create_session", "execute", "hashcat", "prowler_scan"],
    approvalRequiredTools: ["boofuzz_run_fuzzer", "ftp_fuzzer", "run_dharma", "go_fuzz_run"],
    riskProfile: "terminal", canProposeTrainingLessons: true, canApproveTrainingLessons: NO_SELF_APPROVE,
    memoryNamespace: "agent:fuzzsmith",
    outputContract: "WorkerResult with crashes/corpus findings + evidenceIds; lab targets only.",
    evidenceRequirements: "Each crash cites the corpus/crash evidenceId.",
    handoffRules: [{ whenFinding: "crashing binary needs triage", handoffTo: "ReverseSage" }],
    routingSignals: ["fuzz", "crash", "protocol", "corpus", "boofuzz", "dharma", "minimize"],
    safetyBoundaries: ["lab targets only — fuzzing is DoS-adjacent", "approval-gated"],
  },
  {
    agentId: "OSINTSeeker", displayName: "OSINTSeeker", specialty: "osint",
    description: "Passive recon + public threat intelligence (username/domain/IP intel, VirusTotal/OTX, typosquat, Shodan).",
    personaId: "osintseeker", defaultProvider: "openrouter",
    allowedMcpServers: ["sechub-osint", "sechub-threat-intel"],
    allowedTools: ["theharvester_search", "subdomain_enum", "username_lookup", "domain_intel", "virustotal_lookup", "otx_pulse", "shodan_host", "typosquat_check"],
    deniedTools: ["create_session", "execute", "hashcat", "ffuf_dir", "prowler_scan"],
    approvalRequiredTools: [],
    riskProfile: "network", canProposeTrainingLessons: true, canApproveTrainingLessons: NO_SELF_APPROVE,
    memoryNamespace: "agent:osintseeker",
    outputContract: "WorkerResult with public-intel findings + evidenceIds; PUBLIC network egress (labeled).",
    evidenceRequirements: "Each intel item cites the source URL/lookup evidenceId; API keys never printed/stored.",
    handoffRules: [{ whenFinding: "live attack-surface targets", handoffTo: "ReconScout" }],
    routingSignals: ["OSINT", "username", "domain intel", "VirusTotal", "OTX", "typosquat", "Shodan", "passive recon", "threat intel"],
    safetyBoundaries: ["PUBLIC sources only — outbound egress (documented egress decision)", "API keys via env templates only, never stored"],
  },
  {
    agentId: "SecretHunter", displayName: "SecretHunter", specialty: "secrets_code",
    description: "Secret scanning, SAST, dependency/code security.",
    personaId: "secrethunter", defaultProvider: "openrouter",
    allowedMcpServers: ["sechub-secrets", "sechub-code-security"],
    allowedTools: ["gitleaks_detect", "gitleaks_scan_repo", "gitleaks_scan_dir", "scan_content", "run_gitleaks_scan", "get_scan_results", "semgrep_scan", "analyze_project"],
    deniedTools: ["create_session", "execute", "hashcat", "prowler_scan"],
    approvalRequiredTools: [],
    riskProfile: "file-write", canProposeTrainingLessons: true, canApproveTrainingLessons: NO_SELF_APPROVE,
    memoryNamespace: "agent:secrethunter",
    outputContract: "WorkerResult with secret/SAST findings as REFERENCES (redacted) + evidenceIds; never store secret values.",
    evidenceRequirements: "Each finding cites the file/line evidenceId; secret VALUES are redacted, never reusable memory.",
    handoffRules: [{ whenFinding: "valid credential discovered", handoffTo: "CredSmith" }],
    routingSignals: ["secret", "gitleaks", "semgrep", "source code", "SAST", "dependency", "leak"],
    safetyBoundaries: ["scan-only", "secret values redacted, never stored as reusable memory"],
  },
  {
    agentId: "SessionRunner", displayName: "SessionRunner", specialty: "persistent_execution",
    description: "Persistent execution / session management: SSH/tmux persistence, long-running jobs, session recovery, interactive command execution.",
    personaId: "sessionrunner", defaultProvider: "openrouter",
    allowedMcpServers: ["pentest-mcp-server-ssh"],
    allowedTools: ["create_session", "execute", "read_output", "send_input", "list_sessions", "kill_session", "reconnect", "recover_sessions", "upload_file", "download_file", "get_system_status",
      // Phase 18 — SessionRunner is THE execution specialist: it may run terminal/execute_code/process
      // (the surface the no-hands commander delegates here). Approval-gated below.
      "terminal", "execute_code", "process"],
    deniedTools: ["hashcat", "prowler_scan", "bloodhound_collect"],
    approvalRequiredTools: ["create_session", "execute", "send_input", "upload_file", "kill_session", "terminal", "execute_code", "process"],
    riskProfile: "terminal", canProposeTrainingLessons: true, canApproveTrainingLessons: NO_SELF_APPROVE,
    memoryNamespace: "agent:sessionrunner",
    outputContract: "WorkerResult with session id + command outcomes + evidenceIds; HIGH risk — every state change approval-gated.",
    evidenceRequirements: "Each command result cites a session-output evidenceId.",
    handoffRules: [{ whenFinding: "all evidence collected", handoffTo: "ReportSmith" }],
    routingSignals: ["long-running", "interactive shell", "tmux", "session", "SSH", "persistent", "reverse shell", "listener"],
    safetyBoundaries: ["authorized lab hosts only", "arbitrary remote command → every state change requires approval"],
  },
  {
    agentId: "ReportSmith", displayName: "ReportSmith", specialty: "reporting_memory",
    description: "Reporting/evidence/training-memory: final report generation, evidence bundles, verified attack-lesson proposal, training memory review.",
    personaId: "reportsmith", defaultProvider: "openrouter",
    allowedMcpServers: ["chillspwn-reporting"],
    // Native operational tools the OR orchestrator actually implements. `terminal` is granted so the
    // report deliverable is produced by filling the canonical template selected by
    // CHILLSPWN_REPORT_TEMPLATE_DIR via
    // generate_report.py + embed_logos.py + chromium PDF (see the pentest-report-pdf skill) — without
    // it the agent free-hands an off-brand HTML and cannot render a PDF ("no execution tool"). Scope is
    // local report assembly only; offensive tools stay denied below.
    allowedTools: ["read_file", "write_file", "search_files", "terminal", "use_skill", "recall_conversation"],
    deniedTools: ["create_session", "execute", "hashcat", "ffuf_dir", "prowler_scan", "bloodhound_collect", "nmapScan", "sqlmap"],
    approvalRequiredTools: [],
    riskProfile: "read-only", canProposeTrainingLessons: true, canApproveTrainingLessons: NO_SELF_APPROVE,
    memoryNamespace: "agent:reportsmith",
    outputContract: "WorkerResult = final report + evidence bundle + proposedAttackChains[] (box-agnostic, ordered, executable with placeholders, technical references, secret-free).",
    evidenceRequirements: "Aggregates every specialist's evidenceIds; reusable chains inherit runtime-owned evidenceIds+sourceRunId and never contain box identity.",
    handoffRules: [],
    routingSignals: ["report", "evidence bundle", "lesson", "write-up", "summary", "deliverable"],
    safetyBoundaries: ["local report assembly only — terminal runs the report generator/PDF, never touches targets", "redact secrets", "proposes lessons but cannot approve them"],
  },
  {
    agentId: "VulnIntel", displayName: "VulnIntel", specialty: "vulnerability_intelligence",
    description: "Vulnerability intelligence analyst — maps detected services/software to known CVEs; checks NVD/EPSS/CISA KEV/MITRE ATT&CK + exploit intelligence; prioritizes exploitability. NOT an exploitation agent.",
    personaId: "vulnintel", defaultProvider: "openrouter",
    allowedMcpServers: ["vulnintel-cve-mcp", "vulnintel-nvd", "vulnintel-cve-search-local"],
    allowedTools: [
      // 17.1 — REAL keyless read-only tools (python cve-mcp + node nvd, verified via tools/list):
      "lookup_cve", "search_cves", "get_cve_summary", "get_epss_score", "check_kev", "parse_cvss", "check_package_vulns", "get_attack_mapping", "calculate_risk_score", "health_check", "get_cve_details",
      "get_vendor_advisory", "check_exploit_availability", "get_cve_timeline", "check_poc_exists", "compare_cves",
      // local cve-search (when CVE_SEARCH_BASE provided):
      "cve_search_query", "cve_browse", "cve_by_vendor"],
    deniedTools: ["create_session", "execute", "hashcat", "runHashcat", "ffuf_dir", "ffufScan", "nmapScan", "nucleiScan", "sqlmap", "prowler_scan", "bloodhound_collect", "boofuzz_run_fuzzer", "searchsploit_examine"],
    approvalRequiredTools: [],
    riskProfile: "network", canProposeTrainingLessons: true, canApproveTrainingLessons: NO_SELF_APPROVE,
    memoryNamespace: "agent:vulnintel",
    outputContract: "WorkerResult with CVE mapping (confirmed vs possible), EPSS/KEV/ATT&CK + exploitability prioritization, recommended next specialist + evidenceIds. NO exploitation.",
    evidenceRequirements: "Each CVE mapping cites a lookup evidenceId + the version-evidence it is based on; distinguishes confirmed from possible.",
    handoffRules: [
      { whenFinding: "likely web CVE / web service", handoffTo: "WebBreaker" },
      { whenFinding: "AD/identity CVE", handoffTo: "ADAttackMapper" },
      { whenFinding: "cloud/container CVE", handoffTo: "CloudSentinel" },
      { whenFinding: "reportable vuln intelligence", handoffTo: "ReportSmith" },
    ],
    routingSignals: ["CVE", "vulnerability", "EPSS", "KEV", "NVD", "MITRE ATT&CK", "exploitability", "is this version vulnerable", "known vulnerabilities", "cve-", "advisory", "exploit maturity"],
    safetyBoundaries: ["read-only intelligence ONLY — never exploits, never mutates targets, never tests exploit chains", "do not treat unverified version banners as absolute proof", "public CVE/threat APIs only"],
  },
];

export const ROSTER_BY_ID: Record<string, AgentSpec> = Object.fromEntries(AGENT_ROSTER.map((a) => [a.agentId.toLowerCase(), a]));

export function getAgent(agentId: string): AgentSpec | null {
  return ROSTER_BY_ID[(agentId || "").toLowerCase()] ?? null;
}
export function listAgentIds(): string[] {
  return AGENT_ROSTER.map((a) => a.agentId);
}
/**
 * Generic operational / coordination tools that several agents share (and that ChillsPwn itself uses
 * to plan/route/synthesize). These are NOT domain-specialist tools — even though they appear in some
 * agents' allowlists (e.g. ReconScout gained terminal/read_file/search_files so the gate would permit
 * real scanning), they must never make `isSpecialistTool` true, or the commander would be blocked from
 * its own coordination surface. The commander's EXECUTION block (terminal/execute_code/process/
 * mcp_execute) is enforced separately by ChillspwnCommanderPolicy.COMMANDER_BLOCKED_EXEC_TOOLS.
 */
export const GENERIC_TOOLS: ReadonlySet<string> = new Set([
  "terminal", "execute_code", "process", "patch", "read_file", "write_file", "search_files",
  "use_skill", "skill_manage", "recall_conversation", "remember", "web_search", "web_extract",
  "board_create_task", "board_update", "board_await", "board_list", "delegate_task", "mcp_execute",
]);

/** True if a tool is a DOMAIN-specialist tool (generic operational tools excluded). */
export function isSpecialistTool(toolName: string): boolean {
  if (GENERIC_TOOLS.has(toolName)) return false;
  return AGENT_ROSTER.some((a) => a.allowedTools.includes(toolName));
}
/** The specialist(s) that own a given domain tool (generic tools belong to no one). */
export function agentsForTool(toolName: string): string[] {
  if (GENERIC_TOOLS.has(toolName)) return [];
  return AGENT_ROSTER.filter((a) => a.allowedTools.includes(toolName)).map((a) => a.agentId);
}
