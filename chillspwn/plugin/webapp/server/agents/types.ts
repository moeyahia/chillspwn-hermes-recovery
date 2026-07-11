/**
 * Phase 15 — Specialist agent army types.
 *
 * ChillsPwn is the Commander-in-Chief (NOT a specialist) — it commands, routes, supervises,
 * approves, synthesizes, and learns. Specialists perform domain work under least-privilege MCP/tool
 * allowlists. No specialist may approve its own training lessons; no specialist may store
 * target-specific secrets as reusable memory.
 */

export const SPECIALIST_DOMAINS = [
  "reconnaissance", "web", "vulnerability_intelligence", "credentials", "active_directory", "cloud",
  "reverse_engineering", "fuzzing", "osint", "secrets_code", "persistent_execution", "reporting_memory",
] as const;
export type SpecialistDomain = (typeof SPECIALIST_DOMAINS)[number];

/** The Commander-in-Chief id. Treated specially by the routing policy. */
export const COMMANDER_ID = "chillspwn" as const;

export type AgentRiskProfile = "read-only" | "network" | "file-write" | "terminal" | "credential-sensitive" | "exploit-sensitive";

export interface AgentSpec {
  agentId: string;
  displayName: string;
  specialty: SpecialistDomain;
  description: string;
  personaId: string;
  defaultProvider: "openrouter" | "openai-codex" | "claude";
  allowedMcpServers: string[];
  allowedTools: string[];
  deniedTools: string[];
  approvalRequiredTools: string[];
  riskProfile: AgentRiskProfile;
  canProposeTrainingLessons: boolean;
  /** ALWAYS false — a specialist can never verify its own lesson. */
  canApproveTrainingLessons: false;
  memoryNamespace: string;
  outputContract: string;
  evidenceRequirements: string;
  handoffRules: { whenFinding: string; handoffTo: string }[];
  routingSignals: string[];
  safetyBoundaries: string[];
}

/** Operational policy layer for a specialist (limits + the enforcement allowlists). */
export interface AgentMcpMapping {
  agentId: string;
  allowedMcpServers: string[];
  allowedTools: string[];
  deniedTools: string[];
  approvalRequiredTools: string[];
  /** Risk classes that ALWAYS require approval for this agent regardless of tool. */
  approvalRequiredClasses: AgentRiskProfile[];
  defaultRisk: AgentRiskProfile;
  maxRuntimeSeconds: number;
  maxOutputBytes: number;
  evidenceRules: string;
  memoryRules: string;
}
