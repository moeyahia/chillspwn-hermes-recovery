/**
 * ChillspwnCommanderPolicy (Phase 18) — HARD "no-hands commander" enforcement.
 *
 * Background (the gap this closes): the Phase-15 AgentRoutingPolicy only blocked ChillsPwn from
 * calling *specialist tool names* (quick_scan/ffuf_dir/hashcat/…). But the actual attacks run through
 * `terminal` / `execute_code` / `process` / `mcp_execute`, which were classified as "commander
 * coordination tools" and therefore ALLOWED. In the PingPong HTB chat session ChillsPwn ran 418
 * `terminal` + 367 `execute_code` actions (Kerberos abuse, Certipy, DCSync, LDAP, SOCKS pivots) and
 * only ~77 delegations. Chat sessions also bypass the managed-run gate entirely.
 *
 * This policy makes the Commander-in-Chief truly hands-off: it may PLAN, ROUTE, SUPERVISE, APPROVE,
 * and SYNTHESIZE, but it may NOT directly run the execution surface or any specialist tool. When a
 * commander attempts a blocked tool, the decision names the specialist that SHOULD do the work so the
 * caller can convert it into a delegated task.
 *
 * Pure + config-injected → fully testable. The same classification is consulted by the managed-run
 * gate (gateRoutes), mirrored by the OR orchestrator for chat sessions, and used by the ledger
 * validator. Default behavior is controlled by `enforceChillspwnNoHands` (env ENFORCE_CHILLSPWN_NO_HANDS,
 * default TRUE).
 */

import { isSpecialistTool } from "./agentRoster";

/** Personas treated as the Commander-in-Chief (lower-cased match). None of these may execute. */
export const COMMANDER_PERSONAS: ReadonlySet<string> = new Set([
  "chillspwn", "commander", "commander-in-chief", "commander_in_chief", "orchestrator",
]);

/**
 * The EXECUTION surface a commander may never touch directly. These are the tools attacks actually
 * run through (the PingPong ledger proved it). `mcp_execute` is the MCP-bridge execution tool.
 *
 * Deliberately NOT blocked (coordination-safe): read_file, write_file, patch, search_files (plans /
 * synthesis / report drafts are local documents that cannot launch an attack once the execution
 * tools below are denied), board_*, delegate_task, recall_conversation, remember, use_skill,
 * skill_manage, web_search, web_extract.
 */
export const COMMANDER_BLOCKED_EXEC_TOOLS: ReadonlySet<string> = new Set([
  "terminal", "execute_code", "process", "mcp_execute",
]);

/** Explicit coordination allowlist (for documentation / strict-mode callers / the validator). */
export const COMMANDER_COORDINATION_TOOLS: ReadonlySet<string> = new Set([
  "board_create_task", "board_update", "board_await", "board_list", "delegate_task",
  "read_file", "write_file", "patch", "search_files",
  "recall_conversation", "remember", "use_skill", "skill_manage",
  "web_search", "web_extract",
]);

export interface CommanderPolicyConfig {
  /** Master switch for the no-hands rule (env ENFORCE_CHILLSPWN_NO_HANDS, default true). */
  enforceChillspwnNoHands: boolean;
  /** When specialist routing is off entirely, the policy is inert. */
  enableSpecialistRouting?: boolean;
}

export interface SpecialistRecommendation {
  agentId: string;
  displayName: string;
  domain: string;
}

export interface CommanderToolDecision {
  action: "allow" | "deny";
  reason: string;
  audit: boolean;
  /** When denied, the specialist ChillsPwn should route the work to. */
  recommendedSpecialist?: SpecialistRecommendation;
  meta?: Record<string, unknown>;
}

export function isCommander(actorAgentId: string | null | undefined): boolean {
  if (!actorAgentId) return false;
  return COMMANDER_PERSONAS.has(actorAgentId.trim().toLowerCase());
}

/**
 * Specialist routing table for blocked direct commands (Phase 18, Part 6). Ordered: the first
 * pattern that matches the tool name OR the command text wins, so domain-specific signals
 * (kerberos/certipy/ldap) are checked before generic ones. Patterns are matched case-insensitively
 * against `"<toolName> <command>"`.
 */
const SPECIALIST_SIGNALS: Array<{ re: RegExp; agentId: string; displayName: string; domain: string }> = [
  // Active Directory / Kerberos / identity — checked first (richest, most-specific signal set).
  { re: /\b(certipy|impacket|secretsdump|getuserspns|getnpusers|getst|gettgt|ticketer|dcsync|nxc|netexec|crackmapexec|cme|kerbrute|kerberos|krb5|s4u|gmsa|bloodhound|sharphound|roadrecon|evil-?winrm|winrm|ldapsearch|ldap|rpcclient|smbclient|smbmap|adcs|esc[0-9]|samba|pkinit|asreproast|kerberoast)\b/i,
    agentId: "ADAttackMapper", displayName: "ADAttackMapper", domain: "active_directory" },
  // Credentials / cracking.
  { re: /\b(hashcat|john|johntheripper|hydra|medusa|wordlist|rockyou|crack|brute-?force|bruteforce|password|passwords|mask-?attack)\b/i,
    agentId: "CredSmith", displayName: "CredSmith", domain: "credentials" },
  // Web fuzzing / app testing.
  { re: /\b(ffuf|gobuster|feroxbuster|dirb|dirbuster|wfuzz|nikto|nuclei|sqlmap|wpscan|whatweb|httpx|katana|gau|waybackurls|burp|dirsearch|web)\b/i,
    agentId: "WebBreaker", displayName: "WebBreaker", domain: "web" },
  // Persistent execution / pivoting / sessions.
  { re: /\b(tmux|ssh|socks|proxychains|chisel|ligolo|sshuttle|pivot|meterpreter|reverse-?shell|nc |ncat|socat|session|upload_file|download_file)\b/i,
    agentId: "SessionRunner", displayName: "SessionRunner", domain: "persistent_execution" },
  // Reverse engineering / binary analysis.
  { re: /\b(binwalk|radare2|r2 |ghidra|capa|yara|objdump|readelf|gdb|strings |pwndbg|decompile)\b/i,
    agentId: "ReverseSage", displayName: "ReverseSage", domain: "reverse_engineering" },
  // Secrets in source/config.
  { re: /\b(gitleaks|semgrep|trufflehog|trivy fs|secret-?scan|\.git\/)\b/i,
    agentId: "SecretHunter", displayName: "SecretHunter", domain: "secrets_code" },
  // Cloud account posture.
  { re: /\b(prowler|trivy|aws |awscli|kubectl|kubeconfig|az |gcloud|cloud-?posture)\b/i,
    agentId: "CloudSentinel", displayName: "CloudSentinel", domain: "cloud" },
  // Fuzzing.
  { re: /\b(boofuzz|dharma|afl|libfuzzer|fuzz)\b/i,
    agentId: "FuzzSmith", displayName: "FuzzSmith", domain: "fuzzing" },
  // OSINT.
  { re: /\b(theharvester|maigret|sherlock|shodan|censys|dnstwist|recon-?ng|osint|amass)\b/i,
    agentId: "OSINTSeeker", displayName: "OSINTSeeker", domain: "osint" },
  // CVE / vuln intelligence / exploit lookup.
  { re: /\b(searchsploit|cve-?\d|nvd|epss|kev|exploit-?db|vulners|cvss)\b/i,
    agentId: "VulnIntel", displayName: "VulnIntel", domain: "vulnerability_intelligence" },
  // Recon / discovery — generic network scanning is checked LAST so AD/web signals win first.
  { re: /\b(nmap|masscan|rustscan|port_?scan|service-?discovery|dig|whois|dnsenum|dnsrecon|fierce|sslscan|ping |traceroute|host )\b/i,
    agentId: "ReconScout", displayName: "ReconScout", domain: "reconnaissance" },
];

/**
 * Recommend the specialist that should perform a blocked command. Inspects the tool name and the
 * (optional) command text. Falls back to SessionRunner for raw shell/code with no domain signal
 * (a persistent-execution specialist can run arbitrary approved commands), and to ReconScout when
 * nothing matches at all.
 */
export function recommendSpecialist(toolName: string, command?: string | null): SpecialistRecommendation {
  const hay = `${toolName || ""} ${command || ""}`;
  for (const sig of SPECIALIST_SIGNALS) {
    if (sig.re.test(hay)) return { agentId: sig.agentId, displayName: sig.displayName, domain: sig.domain };
  }
  // Raw shell / code execution with no domain signal → the persistent-execution specialist.
  if (toolName === "terminal" || toolName === "execute_code" || toolName === "process") {
    return { agentId: "SessionRunner", displayName: "SessionRunner", domain: "persistent_execution" };
  }
  return { agentId: "ReconScout", displayName: "ReconScout", domain: "reconnaissance" };
}

/**
 * The core decision. For a COMMANDER actor, deny any execution-surface or specialist tool and name
 * the specialist to route to. Non-commander actors are not this policy's concern (the specialist
 * allowlist gate handles them). Inert when the flag or routing is off.
 */
export function evaluateCommanderTool(
  actorAgentId: string | null | undefined,
  toolName: string,
  command: string | null | undefined,
  cfg: CommanderPolicyConfig,
): CommanderToolDecision {
  if (cfg.enableSpecialistRouting === false) return { action: "allow", reason: "specialist routing disabled", audit: false };
  if (!cfg.enforceChillspwnNoHands) return { action: "allow", reason: "no-hands enforcement disabled (ENFORCE_CHILLSPWN_NO_HANDS=false)", audit: false };
  if (!isCommander(actorAgentId)) return { action: "allow", reason: `'${actorAgentId}' is not the commander`, audit: false };

  const blockedExec = COMMANDER_BLOCKED_EXEC_TOOLS.has(toolName);
  // Coordination tools are ALWAYS allowed for the commander, even if a generic tool happens to also
  // sit in a specialist's allowlist (it should not, per GENERIC_TOOLS, but be explicit + defensive).
  if (!blockedExec && COMMANDER_COORDINATION_TOOLS.has(toolName)) {
    return { action: "allow", reason: `'${toolName}' is a commander coordination tool`, audit: false };
  }
  const specialistTool = isSpecialistTool(toolName);
  if (!blockedExec && !specialistTool) {
    return { action: "allow", reason: `'${toolName}' is a commander coordination tool`, audit: false };
  }
  const rec = recommendSpecialist(toolName, command);
  const kind = blockedExec ? "execution tool" : "specialist tool";
  return {
    action: "deny",
    audit: true,
    reason: `ChillsPwn is the Commander-in-Chief and cannot directly run the ${kind} '${toolName}'. Route this to ${rec.displayName} (${rec.domain}) via a delegated specialist task.`,
    recommendedSpecialist: rec,
    meta: { blockedExec, specialistTool, toolName },
  };
}

/** Convenience for callers that only need allow/deny. */
export function commanderMayUseTool(actorAgentId: string, toolName: string, cfg: CommanderPolicyConfig): boolean {
  return evaluateCommanderTool(actorAgentId, toolName, null, cfg).action === "allow";
}

/**
 * Phase 18, Part 4 — HTB / authorized-lab mission signal detection. When a prompt or run metadata
 * carries these signals, the work is a managed specialist mission: every execution step must be
 * delegated (which the no-hands rule already guarantees, in chat OR managed). Casual chat with none
 * of these signals stays conversational. Pure + deterministic (no network/LLM).
 */
const HTB_SIGNALS: RegExp[] = [
  /\bhack[\s-]?the[\s-]?box\b/i,
  /\bHTB\b/,
  /\b(?:10\.10\.(?:1[0-4]|\d)\d?\.\d{1,3}|10\.129\.\d{1,3}\.\d{1,3})\b/, // HTB lab ranges (10.10.10-14.x, 10.129.x)
  /\b(?:user|root)\s+flag\b/i,
  /\bcapture\s+the\s+flag\b/i,
  /\bauthorized\s+(?:lab|engagement|pentest|test)\b/i,
  /\b(?:managed\s+)?specialist\s+mission\b/i,
  /\b(?:pwn|own|root)\s+(?:the\s+)?(?:box|machine|target)\b/i,
];

export function isManagedMissionPrompt(text: string | null | undefined): boolean {
  if (!text) return false;
  return HTB_SIGNALS.some((re) => re.test(text));
}

