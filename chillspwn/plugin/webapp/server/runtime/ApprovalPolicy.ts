/**
 * Phase 16.2 — Approval mode policy.
 *
 * An operator-controlled runtime policy that decides whether a `require_approval` tool call is
 * auto-approved or left for a human. This is NOT ChillsPwn approving itself — it is the runtime
 * applying the operator's configured APPROVAL_MODE. It ONLY ever upgrades a `require_approval` into
 * an approval; it can never approve something ToolPolicy/AgentRoutingPolicy already DENIED (denials
 * are handled upstream and never reach here).
 *
 * Modes:
 *   human  — never auto-approve; operator approves every gated action (current behavior).
 *   auto   — auto-approve every action that passed ToolPolicy + AgentRoutingPolicy.
 *   hybrid — auto-approve low-risk/read-only; require human for high-risk classes + sensitive tools.
 */

import type { RiskLevel } from "./types";

export type ApprovalMode = "human" | "auto" | "hybrid";

// Lowest → highest. Used for AUTO_APPROVE_MAX_RISK comparisons.
const RISK_ORDER: RiskLevel[] = ["read-only", "network", "file-write", "terminal", "credential-sensitive", "exploit-sensitive", "destructive"];

// Tools that ALWAYS require a human in hybrid mode regardless of their risk class (delegation,
// memory/skill mutation, board state). Matches the spec's high-risk class list.
const HYBRID_HUMAN_TOOLS = new Set(["delegate_task", "skill_manage", "remember", "board_create_task", "board_update"]);

export interface ApprovalPolicyConfig {
  mode: ApprovalMode;
  autoApproveRiskClasses: string[];
  autoApproveToolNames: string[];
  autoApproveAgentIds: string[];
  autoApproveMaxRisk: string;
}

export interface ApprovalDecision { autoApprove: boolean; reason: string }

function riskIdx(r: string): number { const i = RISK_ORDER.indexOf(r as RiskLevel); return i < 0 ? RISK_ORDER.length : i; }

/**
 * Decide whether a gated (require_approval) action is auto-approved. Pure + config-injected → testable.
 * The caller has already confirmed the action PASSED ToolPolicy + AgentRoutingPolicy (it is
 * require_approval, not deny). ChillsPwn-direct / out-of-allowlist actions are denied upstream and
 * never reach this function.
 */
export function decideApproval(input: { toolName: string; riskLevel: RiskLevel; agentId?: string | null }, cfg: ApprovalPolicyConfig): ApprovalDecision {
  if (cfg.mode === "human") return { autoApprove: false, reason: "human approval mode — operator must approve in Cockpit" };

  // Agent restriction (applies to auto + hybrid): if a non-empty allowlist is set, only those agents auto-approve.
  if (cfg.autoApproveAgentIds.length) {
    const allowed = cfg.autoApproveAgentIds.map((a) => a.toLowerCase());
    if (!input.agentId || !allowed.includes(input.agentId.toLowerCase())) {
      return { autoApprove: false, reason: `auto-approval restricted to agents [${cfg.autoApproveAgentIds.join(", ")}] — human approval required for ${input.agentId ?? "this actor"}` };
    }
  }

  // Explicit tool allowlist always auto-approves (any non-human mode).
  if (cfg.autoApproveToolNames.includes(input.toolName)) {
    return { autoApprove: true, reason: `auto-approved: '${input.toolName}' is in AUTO_APPROVE_TOOL_NAMES` };
  }

  if (cfg.mode === "auto") {
    return { autoApprove: true, reason: "auto mode — action passed ToolPolicy + AgentRoutingPolicy (audited)" };
  }

  // hybrid
  if (HYBRID_HUMAN_TOOLS.has(input.toolName)) {
    return { autoApprove: false, reason: `hybrid: '${input.toolName}' is a sensitive tool — human approval required` };
  }
  const inClasses = cfg.autoApproveRiskClasses.includes(input.riskLevel);
  const withinMax = riskIdx(input.riskLevel) <= riskIdx(cfg.autoApproveMaxRisk);
  if (inClasses && withinMax) {
    return { autoApprove: true, reason: `hybrid: '${input.riskLevel}' is low-risk (auto-approved)` };
  }
  return { autoApprove: false, reason: `hybrid: '${input.riskLevel}' is high-risk — human approval required` };
}
