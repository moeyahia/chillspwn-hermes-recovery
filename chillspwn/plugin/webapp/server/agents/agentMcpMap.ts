/**
 * Phase 15 — agent → MCP/tool operational mapping (least-privilege). Derives the allowlists from
 * the roster (single source of truth) and adds runtime limits + evidence/memory rules. Principles:
 * least privilege; no all-tools-to-all-agents; no raw MCP exposure globally; every high-risk tool
 * requires approval; every state-changing MCP is gated; every specialist gets only domain MCPs.
 */

import type { AgentMcpMapping } from "./types";
import { AGENT_ROSTER } from "./agentRoster";

// Per-agent runtime limits + rules (keyed by agentId).
const LIMITS: Record<string, { maxRuntimeSeconds: number; maxOutputBytes: number; evidenceRules: string; memoryRules: string }> = {
  ReconScout: { maxRuntimeSeconds: 1800, maxOutputBytes: 200000, evidenceRules: "scan outputs → evidence; large outputs → artifacts", memoryRules: "lessons in agent:reconscout; no target IPs as global facts" },
  WebBreaker: { maxRuntimeSeconds: 1800, maxOutputBytes: 200000, evidenceRules: "request/response evidence; redact secrets", memoryRules: "lessons in agent:webbreaker; no creds/tokens" },
  CredSmith: { maxRuntimeSeconds: 3600, maxOutputBytes: 100000, evidenceRules: "hash-source evidence only; NO plaintext stored", memoryRules: "lessons in agent:credsmith; NEVER store cracked secrets" },
  ADAttackMapper: { maxRuntimeSeconds: 1800, maxOutputBytes: 300000, evidenceRules: "graph/collection evidence", memoryRules: "lessons in agent:adattackmapper; no domain creds in memory" },
  CloudSentinel: { maxRuntimeSeconds: 1800, maxOutputBytes: 300000, evidenceRules: "scan-output evidence", memoryRules: "lessons in agent:cloudsentinel; no cloud keys in memory" },
  ReverseSage: { maxRuntimeSeconds: 2400, maxOutputBytes: 500000, evidenceRules: "analysis-artifact evidence", memoryRules: "lessons in agent:reversesage" },
  FuzzSmith: { maxRuntimeSeconds: 3600, maxOutputBytes: 300000, evidenceRules: "crash/corpus evidence", memoryRules: "lessons in agent:fuzzsmith; failed-attempt lessons valued" },
  OSINTSeeker: { maxRuntimeSeconds: 900, maxOutputBytes: 200000, evidenceRules: "source-URL evidence", memoryRules: "lessons in agent:osintseeker; API keys never stored/printed" },
  SecretHunter: { maxRuntimeSeconds: 1200, maxOutputBytes: 300000, evidenceRules: "file/line evidence; redact secret VALUES", memoryRules: "lessons in agent:secrethunter; NEVER store secret values" },
  SessionRunner: { maxRuntimeSeconds: 7200, maxOutputBytes: 500000, evidenceRules: "session-output evidence", memoryRules: "lessons in agent:sessionrunner; no remote secrets in memory" },
  ReportSmith: { maxRuntimeSeconds: 600, maxOutputBytes: 1000000, evidenceRules: "aggregates all evidence; redacts secrets", memoryRules: "proposes lessons (evidence-backed); cannot approve" },
};

export const AGENT_MCP_MAP: AgentMcpMapping[] = AGENT_ROSTER.map((a) => ({
  agentId: a.agentId,
  allowedMcpServers: a.allowedMcpServers,
  allowedTools: a.allowedTools,
  deniedTools: a.deniedTools,
  approvalRequiredTools: a.approvalRequiredTools,
  // Classes that always require approval for this agent (its risk profile + always credential/exploit/destructive).
  approvalRequiredClasses: Array.from(new Set([a.riskProfile, "credential-sensitive", "exploit-sensitive", "destructive"]))
    .filter((c) => c !== "read-only" && c !== "network") as AgentMcpMapping["approvalRequiredClasses"],
  defaultRisk: a.riskProfile,
  maxRuntimeSeconds: LIMITS[a.agentId]?.maxRuntimeSeconds ?? 1800,
  maxOutputBytes: LIMITS[a.agentId]?.maxOutputBytes ?? 200000,
  evidenceRules: LIMITS[a.agentId]?.evidenceRules ?? "cite evidenceIds",
  memoryRules: LIMITS[a.agentId]?.memoryRules ?? "lessons in agent namespace; no secrets",
}));

export const MAP_BY_ID: Record<string, AgentMcpMapping> = Object.fromEntries(AGENT_MCP_MAP.map((m) => [m.agentId.toLowerCase(), m]));

export function mappingFor(agentId: string): AgentMcpMapping | null {
  return MAP_BY_ID[(agentId || "").toLowerCase()] ?? null;
}

/** Tool-level decision for a specialist: allow / deny / require_approval (within its own profile). */
export function specialistToolDecision(agentId: string, toolName: string): "allow" | "deny" | "require_approval" | "unknown_agent" {
  const m = mappingFor(agentId);
  if (!m) return "unknown_agent";
  if (m.deniedTools.includes(toolName)) return "deny";
  if (!m.allowedTools.includes(toolName)) return "deny"; // outside allowlist ⇒ deny
  if (m.approvalRequiredTools.includes(toolName)) return "require_approval";
  return "allow";
}
