/**
 * agentRouter (Phase 15.13) — ChillsPwn's routing brain. Maps a task description to the NARROWEST
 * capable specialist using each agent's routingSignals, and returns the restricted execution profile
 * the specialist must run under. ChillsPwn uses this to assign PlanSteps; it never gives every agent
 * every tool, and it never injects hypotheses (memory injection is handled separately by the
 * training-memory hierarchy).
 */

import { AGENT_ROSTER, getAgent } from "./agentRoster";
import { mappingFor } from "./agentMcpMap";
import type { AgentSpec } from "./types";

export interface RoutingResult {
  selectedAgent: string | null;
  reason: string;
  allowedMcpServers: string[];
  allowedTools: string[];
  riskLevel: string;
  approvalRequirements: { approvalRequiredTools: string[]; approvalRequiredClasses: string[] };
  expectedOutputContract: string;
  fallbackAgent: string | null;
  matchedSignals: string[];
}

/** A sensible fallback specialist per domain (where the selected one can't take it). */
const FALLBACK: Record<string, string> = {
  ReconScout: "OSINTSeeker", OSINTSeeker: "ReconScout",
  WebBreaker: "ReconScout", CredSmith: "WebBreaker",
  ADAttackMapper: "ReconScout", CloudSentinel: "ReconScout",
  ReverseSage: "FuzzSmith", FuzzSmith: "ReverseSage",
  SecretHunter: "WebBreaker", SessionRunner: "ReconScout",
  ReportSmith: "",
};

function scoreAgent(agent: AgentSpec, text: string): { score: number; matched: string[] } {
  const matched: string[] = [];
  for (const sig of agent.routingSignals) {
    // word-ish boundary match, case-insensitive, allowing a trailing plural "s" so
    // "ports"/"services"/"secrets"/"sessions" match "port"/"service"/"secret"/"session".
    const re = new RegExp(`(^|[^a-z0-9])${sig.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?([^a-z0-9]|$)`, "i");
    if (re.test(text)) matched.push(sig);
  }
  // Longer, more-specific signals weigh more (narrowest-capable preference).
  const score = matched.reduce((s, m) => s + 1 + Math.min(2, Math.floor(m.length / 6)), 0);
  return { score, matched };
}

/** Route a task to the narrowest capable specialist. Returns selectedAgent=null if nothing matches. */
export function routeTask(taskText: string): RoutingResult {
  const text = ` ${(taskText || "").toLowerCase()} `;
  let best: { agent: AgentSpec; score: number; matched: string[] } | null = null;
  for (const agent of AGENT_ROSTER) {
    const { score, matched } = scoreAgent(agent, text);
    if (score > 0 && (!best || score > best.score)) best = { agent, score, matched };
  }
  if (!best) {
    return {
      selectedAgent: null,
      reason: "no specialist routing signal matched — ChillsPwn must classify the domain or create a blocked item and ask the operator to assign/create a specialist",
      allowedMcpServers: [], allowedTools: [], riskLevel: "unknown",
      approvalRequirements: { approvalRequiredTools: [], approvalRequiredClasses: [] },
      expectedOutputContract: "structured WorkerResult", fallbackAgent: null, matchedSignals: [],
    };
  }
  const a = best.agent;
  const m = mappingFor(a.agentId)!;
  return {
    selectedAgent: a.agentId,
    reason: `matched ${best.matched.length} signal(s) [${best.matched.join(", ")}] → narrowest capable specialist '${a.agentId}' (${a.specialty})`,
    allowedMcpServers: a.allowedMcpServers,
    allowedTools: a.allowedTools,
    riskLevel: a.riskProfile,
    approvalRequirements: { approvalRequiredTools: m.approvalRequiredTools, approvalRequiredClasses: m.approvalRequiredClasses },
    expectedOutputContract: a.outputContract,
    fallbackAgent: FALLBACK[a.agentId] || null,
    matchedSignals: best.matched,
  };
}

/** The restricted execution profile a specialist runs under (what ChillsPwn hands to it). */
export function specialistProfile(agentId: string) {
  const a = getAgent(agentId);
  const m = mappingFor(agentId);
  if (!a || !m) return null;
  return {
    agentId: a.agentId, specialty: a.specialty, personaId: a.personaId, defaultProvider: a.defaultProvider,
    allowedMcpServers: a.allowedMcpServers, allowedTools: a.allowedTools, deniedTools: a.deniedTools,
    approvalRequiredTools: m.approvalRequiredTools, riskProfile: a.riskProfile,
    maxRuntimeSeconds: m.maxRuntimeSeconds, maxOutputBytes: m.maxOutputBytes,
    outputContract: a.outputContract, evidenceRequirements: a.evidenceRequirements,
    memoryNamespace: a.memoryNamespace, safetyBoundaries: a.safetyBoundaries,
    canProposeTrainingLessons: a.canProposeTrainingLessons, canApproveTrainingLessons: a.canApproveTrainingLessons,
  };
}
