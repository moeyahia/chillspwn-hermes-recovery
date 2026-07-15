/**
 * gateRoutes (Phase 8) — the runtime tool gate the OpenRouter/Codex orchestrator calls BEFORE
 * executing each tool. This is REAL enforcement (unlike Claude observe-only): the orchestrator
 * owns tool execution in Python, so it can wait on the runtime's decision.
 *
 * It reuses the existing runtime exactly — `requestTool` (real policy + step binding →
 * allow/deny/awaiting_approval), the existing approval resolution (operator approves in the
 * cockpit), and `recordToolResult`. No policy logic is duplicated here or in Python.
 *
 * The endpoints are mode-agnostic: they always return the real policy decision. The orchestrator's
 * flags (off / dry-run / enforce / fail-mode / timeout / poll) decide whether it calls the gate
 * and how it acts on the response.
 */

import type { Express, Request, Response } from "express";
import type { AgentRuntime } from "../runtime/AgentRuntime";
import { AgentRoutingPolicy, type RoutingPolicyConfig } from "../agents/AgentRoutingPolicy";
import { getAgent } from "../agents/agentRoster";

export interface GateRouteDeps {
  agentRuntime: AgentRuntime;
  guardSeg: (res: Response, val: string, name: string) => boolean;
  log: (level: string, msg: string, data?: unknown) => void;
  /** Master switch (SECURITY.enableOpenrouterRuntimeGating). */
  gatingEnabled: () => boolean;
  /** Phase 15.1: live specialist-routing enforcement (consulted before the policy/risk gate). */
  routing?: { enabled: () => boolean; config: () => RoutingPolicyConfig };
}

function extractCommand(args: unknown): string | undefined {
  if (args && typeof args === "object" && typeof (args as { command?: unknown }).command === "string") {
    return (args as { command: string }).command;
  }
  return undefined;
}

/** Pure mapping: a requested ToolCall status → the orchestrator-facing gate decision. */
export function toolCallStatusToGateDecision(status: string): "allow" | "deny" | "awaiting_approval" {
  return status === "approved" ? "allow" : status === "rejected" ? "deny" : "awaiting_approval";
}

export function registerGateRoutes(app: Express, deps: GateRouteDeps): void {
  const { agentRuntime, guardSeg, log, gatingEnabled } = deps;

  app.post("/api/runs/:id/tool-gate", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "id")) return;
    if (!gatingEnabled()) return res.status(403).json({ error: "OpenRouter runtime gating is disabled" });
    const run = agentRuntime.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: "run not found" });
    const toolName = typeof req.body?.toolName === "string" ? req.body.toolName : "";
    if (!toolName) return res.status(400).json({ error: "toolName is required" });

    // Phase 15.1 — LIVE specialist-routing enforcement, BEFORE the policy/risk gate. The actor is
    // the run's persona. A specialist may only call tools in its allowlist; ChillsPwn (the
    // commander / any non-specialist persona) may NOT directly call a specialist tool. This acts
    // only on specialist TOOL NAMES (quick_scan/ffuf_dir/hashcat/…), never on terminal/board/etc.,
    // so it cannot break the current orchestration flow. delegate_task/board_create_task with a
    // targetAgentId/agent that names a specialist are domain-validated.
    if (deps.routing?.enabled()) {
      const policy = new AgentRoutingPolicy(deps.routing.config());
      const actor = getAgent(run.persona);
      const args = req.body?.arguments && typeof req.body.arguments === "object" ? req.body.arguments : {};
      const cmd = typeof req.body?.command === "string" ? req.body.command : extractCommand(args);
      const target = typeof (args as any).targetAgentId === "string" ? (args as any).targetAgentId
        : typeof (args as any).agent === "string" && getAgent((args as any).agent) ? (args as any).agent : undefined;
      if ((toolName === "delegate_task" || toolName === "board_create_task") && target) {
        const d = policy.delegateTask({ targetAgentId: target, taskDomain: typeof (args as any).domain === "string" ? (args as any).domain : undefined, fromAgentId: run.persona });
        if (d.action === "deny") { log("warn", "15.1 delegate_task routing deny", { persona: run.persona, target, reason: d.reason }); return res.json({ decision: "deny", mode: "enforce", enforced: true, routingBlocked: true, toolCallId: null, reason: d.reason }); }
      } else if (policy.isCommanderActor(run.persona)) {
        // Phase 18 — HARD no-hands commander: deny the execution surface (terminal/execute_code/
        // process/mcp_execute) + any specialist tool, and name the specialist to route to. This is
        // the fix for the historical direct-execution gap (terminal used to slip through as a "coordination tool").
        const nh = policy.commanderNoHands(run.persona, toolName, cmd);
        if (nh.action === "deny") {
          log("warn", "18 no-hands commander deny", { persona: run.persona, toolName, recommend: nh.recommendedSpecialist?.agentId, reason: nh.reason });
          return res.json({ decision: "deny", mode: "enforce", enforced: true, routingBlocked: true, noHands: true, recommendedSpecialist: nh.recommendedSpecialist ?? null, toolCallId: null, reason: nh.reason });
        }
        // Legacy delegation layer still applies (blocks specialist tool NAMES even if no-hands is off).
        const d = policy.chillspwnDirectTool(toolName);
        if (d.action === "deny") { log("warn", "15.1 ChillsPwn direct-tool deny", { persona: run.persona, toolName, reason: d.reason }); return res.json({ decision: "deny", mode: "enforce", enforced: true, routingBlocked: true, toolCallId: null, reason: d.reason }); }
        if (d.action === "audit") log("info", "15.1 ChillsPwn direct-tool AUDIT", { persona: run.persona, toolName, reason: d.reason });
      } else if (actor) {
        const d = policy.specialistTool(actor.agentId, toolName);
        if (d.action === "deny") { log("warn", "15.1 specialist allowlist deny", { persona: run.persona, toolName, reason: d.reason }); return res.json({ decision: "deny", mode: "enforce", enforced: true, routingBlocked: true, toolCallId: null, reason: d.reason }); }
      } else {
        const d = policy.chillspwnDirectTool(toolName);
        if (d.action === "deny") { log("warn", "15.1 ChillsPwn direct-tool deny", { persona: run.persona, toolName, reason: d.reason }); return res.json({ decision: "deny", mode: "enforce", enforced: true, routingBlocked: true, toolCallId: null, reason: d.reason }); }
        if (d.action === "audit") log("info", "15.1 ChillsPwn direct-tool AUDIT", { persona: run.persona, toolName, reason: d.reason });
      }
    }
    try {
      // Bind to a running step — auto-start the first pending one if none is active so the
      // gate keeps working as the orchestrator progresses.
      let stepId = agentRuntime.getActiveStepId(run.id);
      if (!stepId) stepId = agentRuntime.startFirstPendingStep(run.id);
      const args = req.body?.arguments && typeof req.body.arguments === "object" ? req.body.arguments : {};
      const command = typeof req.body?.command === "string" ? req.body.command : extractCommand(args);

      // The mode is SERVER-AUTHORITATIVE — from how the run was launched (markGateMode), NOT the
      // client body. Anything not explicitly "dry-run" is treated as enforce (fail-safe).
      const mode = (run.metadata as { gateMode?: string } | undefined)?.gateMode === "dry-run" ? "dry-run" : "enforce";

      if (mode === "dry-run") {
        // DRY-RUN: record what enforce WOULD do as a non-blocking observation. It NEVER creates a
        // ToolCall or ApprovalRequest, so it can never appear in the "action required" queue.
        const decision = agentRuntime.evaluateToolDryRun({ runId: run.id, stepId, toolName, arguments: args, command });
        return res.json({
          decision: "allow", // dry-run NEVER blocks execution
          mode: "dry-run",
          enforced: false,
          wouldDecide: decision.action, // what enforce would have decided
          wouldRequireApproval: decision.action === "require_approval",
          toolCallId: null, // no ToolCall is created in dry-run
          stepId: stepId ?? null,
          riskLevel: decision.riskLevel,
          reason: decision.reason,
        });
      }

      // ENFORCE: policy/risk-only gating (model tool names don't match the plan's allowedTools),
      // with a REAL ToolCall + ApprovalRequest when approval is required.
      const result = agentRuntime.requestTool({ runId: run.id, stepId, toolName, arguments: args, command, enforceAllowedTools: false });
      const decision = toolCallStatusToGateDecision(result.toolCall.status);
      res.json({
        decision,
        mode: "enforce",
        toolCallId: result.toolCall.id,
        approvalId: result.toolCall.approvalId ?? null,
        stepId: stepId ?? null,
        riskLevel: result.decision.riskLevel,
        reason: result.decision.reason,
        enforced: true,
      });
    } catch (e: any) {
      log("warn", "Phase 8: tool-gate failed", { runId: run.id, error: e?.message });
      res.status(500).json({ error: e?.message || "gate error" });
    }
  });

  app.get("/api/runs/:id/tool-calls/:toolCallId", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "id")) return;
    if (!guardSeg(res, req.params.toolCallId, "toolCallId")) return;
    const doc = agentRuntime.getDoc(req.params.id);
    const tc = doc?.toolCalls.find((t) => t.id === req.params.toolCallId);
    if (!tc) return res.status(404).json({ error: "tool call not found" });
    res.json({ toolCallId: tc.id, status: tc.status, approvalId: tc.approvalId ?? null });
  });

  app.post("/api/runs/:id/tool-calls/:toolCallId/result", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "id")) return;
    if (!guardSeg(res, req.params.toolCallId, "toolCallId")) return;
    if (!gatingEnabled()) return res.status(403).json({ error: "OpenRouter runtime gating is disabled" });
    try {
      const success = req.body?.success !== false;
      const output = typeof req.body?.output === "string" ? req.body.output : "";
      agentRuntime.recordToolResult(req.params.id, req.params.toolCallId, { success, output }, { createEvidence: true });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "failed to record result" });
    }
  });

  // 8.3 — the orchestrator calls this when it stops waiting for an approval (gate timeout). The
  // runtime expires the approval + rejects the tool call so it stops showing as action-required.
  app.post("/api/runs/:id/tool-calls/:toolCallId/timeout", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "id")) return;
    if (!guardSeg(res, req.params.toolCallId, "toolCallId")) return;
    if (!gatingEnabled()) return res.status(403).json({ error: "OpenRouter runtime gating is disabled" });
    try {
      const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;
      const r = agentRuntime.expireToolCall(req.params.id, req.params.toolCallId, reason);
      res.json({ ok: true, toolCallStatus: r.toolCall?.status ?? null, approvalId: r.approvalId });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "failed to expire tool call" });
    }
  });
}
