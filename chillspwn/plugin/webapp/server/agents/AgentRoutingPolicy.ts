/**
 * AgentRoutingPolicy (Phase 15.6) — CODE-LEVEL enforcement that ChillsPwn (the Commander-in-Chief)
 * commands specialists rather than operating their tools directly, and that specialists stay inside
 * their least-privilege allowlists. This is NOT prompt-only — it is a deterministic policy the gate /
 * runtime can consult.
 *
 * Pure + config-injected → fully testable. Default config is AUDIT-safe (it never blocks current
 * behavior); flip ENFORCE_CHILLSPWN_DELEGATION + REQUIRE_SPECIALIST_ASSIGNMENT to enforce.
 */

import { COMMANDER_ID, type SpecialistDomain, SPECIALIST_DOMAINS } from "./types";
import { isSpecialistTool, agentsForTool, getAgent } from "./agentRoster";
import { specialistToolDecision } from "./agentMcpMap";
import { evaluateCommanderTool, isCommander, type CommanderToolDecision } from "./ChillspwnCommanderPolicy";

export interface RoutingPolicyConfig {
  enableSpecialistRouting: boolean;
  enforceChillspwnDelegation: boolean;
  allowChillspwnDirectTools: boolean;
  requireSpecialistAssignment: boolean;
  /** Phase 18 — hard no-hands commander. Default true via SECURITY.enforceChillspwnNoHands. */
  enforceChillspwnNoHands?: boolean;
}

export interface PolicyDecision {
  action: "allow" | "deny" | "require_approval" | "audit" | "block_step";
  reason: string;
  audit: boolean;
  meta?: Record<string, unknown>;
}

export class AgentRoutingPolicy {
  constructor(private readonly cfg: RoutingPolicyConfig) {}

  /**
   * (0) Phase 18 — HARD no-hands commander. BEFORE the specialist-tool name check, deny a commander
   * actor any execution-surface tool (terminal/execute_code/process/mcp_execute) or specialist tool,
   * and name the specialist to route to. This is what closes the gap the PingPong session exposed:
   * `terminal` was previously a "coordination tool" and slipped through `chillspwnDirectTool`.
   * Inert for non-commander actors and when the flag is off. `command` is the shell/code text (used
   * only to pick the recommended specialist).
   */
  commanderNoHands(actorAgentId: string, toolName: string, command?: string | null): CommanderToolDecision {
    return evaluateCommanderTool(actorAgentId, toolName, command, {
      enforceChillspwnNoHands: this.cfg.enforceChillspwnNoHands !== false,
      enableSpecialistRouting: this.cfg.enableSpecialistRouting,
    });
  }

  /** Is this actor the Commander-in-Chief (no-hands subject)? */
  isCommanderActor(actorAgentId: string | null | undefined): boolean {
    return isCommander(actorAgentId);
  }

  /**
   * (1) ChillsPwn cannot directly call specialist tools. If the actor is the commander and the tool
   * belongs to a specialist domain, DENY (enforce) or AUDIT (default), unless an explicit override /
   * approval / emergency-fallback reason is supplied. Non-specialist tools (planning, board/cockpit
   * coordination, reporting coordination) always pass.
   */
  chillspwnDirectTool(toolName: string, opts: { override?: boolean; approved?: boolean; emergencyReason?: string } = {}): PolicyDecision {
    if (!this.cfg.enableSpecialistRouting) return { action: "allow", reason: "specialist routing disabled", audit: false };
    if (!isSpecialistTool(toolName)) return { action: "allow", reason: `'${toolName}' is a commander coordination tool (not a specialist tool)`, audit: false };

    const owners = agentsForTool(toolName);
    if (this.cfg.allowChillspwnDirectTools || opts.override || opts.approved || opts.emergencyReason) {
      return {
        action: "allow", audit: true,
        reason: `ChillsPwn direct use of specialist tool '${toolName}' permitted via ${opts.emergencyReason ? "emergency fallback" : opts.approved ? "approval" : "override"}`,
        meta: { owners, emergency: opts.emergencyReason ?? null },
      };
    }
    if (this.cfg.enforceChillspwnDelegation) {
      return { action: "deny", audit: true, reason: `ChillsPwn must DELEGATE '${toolName}' to ${owners.join("/")} — direct specialist-tool use is forbidden`, meta: { owners, mustDelegateTo: owners } };
    }
    return { action: "audit", audit: true, reason: `AUDIT (enforce off): ChillsPwn used specialist tool '${toolName}' — should delegate to ${owners.join("/")}`, meta: { owners } };
  }

  /**
   * (2) Specialist tool allowlist. Allow only tools in the specialist's allowlist; deny outside it;
   * require approval for approvalRequiredTools; unknown agent → deny.
   */
  specialistTool(agentId: string, toolName: string): PolicyDecision {
    if (!this.cfg.enableSpecialistRouting) return { action: "allow", reason: "specialist routing disabled", audit: false };
    const d = specialistToolDecision(agentId, toolName);
    switch (d) {
      case "unknown_agent": return { action: "deny", audit: true, reason: `unknown agent '${agentId}'`, meta: {} };
      case "deny": return { action: "deny", audit: true, reason: `'${toolName}' is outside ${agentId}'s allowlist`, meta: {} };
      case "require_approval": return { action: "require_approval", audit: true, reason: `'${toolName}' requires approval for ${agentId}`, meta: {} };
      default: return { action: "allow", audit: false, reason: `'${toolName}' allowed for ${agentId}`, meta: {} };
    }
  }

  /**
   * (3) Required specialist assignment. A PlanStep classified into a specialist domain MUST have an
   * assignedAgentId. Missing → block the step (enforce) / audit (default), prompting ChillsPwn routing.
   */
  requireAssignment(step: { domain?: string | null; assignedAgentId?: string | null; title?: string }): PolicyDecision {
    if (!this.cfg.enableSpecialistRouting) return { action: "allow", reason: "routing disabled", audit: false };
    const domain = (step.domain ?? "") as SpecialistDomain;
    const isClassified = SPECIALIST_DOMAINS.includes(domain);
    if (!isClassified) return { action: "allow", reason: "step is not a classified specialist domain", audit: false };
    if (step.assignedAgentId) return { action: "allow", reason: `assigned to ${step.assignedAgentId}`, audit: false };
    if (this.cfg.requireSpecialistAssignment) {
      return { action: "block_step", audit: true, reason: `domain '${domain}' step has no assigned specialist — ChillsPwn must route it`, meta: { domain } };
    }
    return { action: "audit", audit: true, reason: `AUDIT: domain '${domain}' step unassigned (would block in enforce mode)`, meta: { domain } };
  }

  /**
   * (4) delegate_task constraint. It must carry a real targetAgentId whose specialty matches the task
   * domain; the target receives a RESTRICTED MCP/tool context; an audit link is emitted. delegate_task
   * may never be used to bypass the runtime gate.
   */
  delegateTask(input: { targetAgentId?: string | null; taskDomain?: string | null; fromAgentId?: string }): PolicyDecision {
    if (!this.cfg.enableSpecialistRouting) return { action: "allow", reason: "routing disabled", audit: false };
    if (!input.targetAgentId) return { action: "deny", audit: true, reason: "delegate_task requires a targetAgentId (no anonymous delegation)", meta: {} };
    const agent = getAgent(input.targetAgentId);
    if (!agent) return { action: "deny", audit: true, reason: `delegate_task targetAgentId '${input.targetAgentId}' is not a known specialist`, meta: {} };
    if (input.taskDomain && agent.specialty !== input.taskDomain) {
      return { action: "deny", audit: true, reason: `task domain '${input.taskDomain}' does not match ${agent.agentId} (${agent.specialty}) — route to the right specialist`, meta: { specialty: agent.specialty } };
    }
    return {
      action: "allow", audit: true,
      reason: `delegate ${input.fromAgentId ?? COMMANDER_ID} → ${agent.agentId} (${agent.specialty}); target restricted to its allowlist + gated`,
      meta: { from: input.fromAgentId ?? COMMANDER_ID, to: agent.agentId, allowedMcpServers: agent.allowedMcpServers, allowedTools: agent.allowedTools },
    };
  }
}
