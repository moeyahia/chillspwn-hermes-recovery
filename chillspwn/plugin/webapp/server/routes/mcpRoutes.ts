/**
 * Phase 16 — mcpRoutes. Read-only MCP inventory/health APIs + the GATED execute endpoint.
 *
 * Execution chain (POST /api/mcp/execute):
 *   run exists → specialist exists → actor not bypassing → AgentRoutingPolicy (allowlist) →
 *   AgentRuntime.requestTool (ToolPolicy/risk gate + approval) → bridge health → bridge.execute →
 *   ToolResult + Evidence (large→artifact) + audit. Mirrors the OR gate: require_approval returns
 *   awaiting + toolCallId; a follow-up call with that toolCallId (once approved) dispatches it.
 *
 * Nothing here touches the Claude path. Tools are exposed ONLY via specialist allowlists + the
 * bridge; no MCP is exposed globally.
 */

import type { Express, Request, Response } from "express";
import type { AgentRuntime } from "../runtime/AgentRuntime";
import type { McpArsenalBridge } from "../mcp/McpArsenalBridge";
import { AgentRoutingPolicy, type RoutingPolicyConfig } from "../agents/AgentRoutingPolicy";
import { getAgent } from "../agents/agentRoster";
import { COMMANDER_ID } from "../agents/types";

export interface McpRouteDeps {
  bridge: () => McpArsenalBridge | null;
  agentRuntime: AgentRuntime;
  guardSeg: (res: Response, val: string, name: string) => boolean;
  enabled: () => boolean;                    // SECURITY.enableMcpArsenal
  routingConfig: () => RoutingPolicyConfig;
  nowMs: () => number;
  log: (level: string, msg: string, data?: unknown) => void;
}

export function registerMcpRoutes(app: Express, deps: McpRouteDeps): void {
  const gate = (res: Response): McpArsenalBridge | null => {
    if (!deps.enabled()) { res.status(403).json({ error: "MCP arsenal is disabled (ENABLE_MCP_ARSENAL=false)" }); return null; }
    const b = deps.bridge();
    if (!b) { res.status(503).json({ error: "MCP arsenal bridge not initialized" }); return null; }
    if (b.loadError()) { res.status(503).json({ error: b.loadError() }); return null; }
    return b;
  };

  // ── Read-only inventory / health (16.6) ──
  app.get("/api/mcp/servers", (_req, res) => {
    const b = gate(res); if (!b) return;
    res.json({ mode: b.mode, servers: b.listServers().map(({ spec, health }) => ({ name: spec.name, runtime: spec.runtime, enabled: spec.enabled, assignedAgents: spec.assignedAgents, riskClass: spec.riskClass, toolNames: spec.toolNames, state: health.state, reasons: health.reasons, missingBinaries: health.missingBinaries, missingEnv: health.missingEnv, missingDockerImages: health.missingDockerImages })) });
  });

  app.get("/api/mcp/tools", (_req, res) => {
    const b = gate(res); if (!b) return;
    const out: any[] = [];
    for (const { spec, health } of b.listServers()) for (const t of spec.toolNames) out.push({ tool: t, mcpServer: spec.name, assignedAgents: spec.assignedAgents, serverState: health.state });
    res.json({ mode: b.mode, tools: out });
  });

  app.get("/api/mcp/specialists/:agentId/tools", (req, res) => {
    if (!deps.guardSeg(res, req.params.agentId, "agentId")) return;
    const b = gate(res); if (!b) return;
    const view = b.toolsForSpecialist(req.params.agentId);
    if (!view) return res.status(404).json({ error: "unknown specialist" });
    res.json({ mode: b.mode, ...view });
  });

  app.get("/api/mcp/health", (_req, res) => {
    const b = gate(res); if (!b) return;
    res.json({ mode: b.mode, health: b.healthAll() });
  });

  app.post("/api/mcp/health-check", (req, res) => {
    const b = gate(res); if (!b) return;
    b.reload();
    const name = typeof req.body?.server === "string" ? req.body.server : null;
    res.json({ mode: b.mode, health: name ? [b.health(name)] : b.healthAll() });
  });

  // ── GATED execute (16.3) ──
  app.post("/api/mcp/execute", async (req: Request, res: Response) => {
    const b = gate(res); if (!b) return;
    const body = req.body ?? {};
    const { runId, stepId, actorAgentId, specialistAgentId, mcpServer, toolName } = body;
    const args = body.arguments && typeof body.arguments === "object" ? body.arguments : {};
    if (!runId || !specialistAgentId || !mcpServer || !toolName) return res.status(400).json({ error: "runId, specialistAgentId, mcpServer, toolName are required" });

    const run = deps.agentRuntime.getRun(runId);
    if (!run) return res.status(404).json({ error: "run not found" });
    const specialist = getAgent(specialistAgentId);
    if (!specialist) return res.status(400).json({ error: `unknown specialist '${specialistAgentId}'` });

    // Actor must be the specialist itself OR the commander delegating — not a DIFFERENT specialist.
    const actor = (actorAgentId || run.persona || "").toString();
    const actorIsCommander = !getAgent(actor) || actor.toLowerCase() === COMMANDER_ID;
    const actorIsTheSpecialist = actor.toLowerCase() === specialistAgentId.toLowerCase();
    if (!actorIsCommander && !actorIsTheSpecialist) {
      return res.status(403).json({ success: false, error: `actor '${actor}' may not run ${specialistAgentId}'s tools (one specialist cannot operate another's MCP)`, routingBlocked: true });
    }

    // AgentRoutingPolicy: the tool must be in the specialist's allowlist.
    const policy = new AgentRoutingPolicy(deps.routingConfig());
    const rd = policy.specialistTool(specialistAgentId, toolName);
    if (rd.action === "deny") { deps.log("warn", "16.3 MCP routing deny", { specialistAgentId, toolName, reason: rd.reason }); return res.status(403).json({ success: false, error: rd.reason, routingBlocked: true }); }

    // Post-approval dispatch: a toolCallId that is already approved → execute it now.
    const providedTcId = typeof body.toolCallId === "string" ? body.toolCallId : null;

    // Risk/approval gate via the runtime (skips the step allowed-tools binding; gates on risk).
    let toolCallId = providedTcId;
    if (!toolCallId) {
      try {
        const rr = deps.agentRuntime.requestTool({ runId, stepId: stepId ?? null, toolName, arguments: { ...args, __mcpServer: mcpServer, __specialist: specialistAgentId }, enforceAllowedTools: false });
        toolCallId = rr.toolCall.id;
        if (rr.decision.action === "deny") return res.json({ success: false, decision: "deny", error: rr.decision.reason ?? "denied by tool policy", toolCallId, mcpServer, toolName });
        // Phase 16.2 — if runtime approval policy auto-approved, the toolCall is already approved →
        // fall through to execute. Otherwise it stays pending for a human.
        if (rr.decision.action === "require_approval" && !rr.autoApproved) {
          // dry-run still records the intent but never executes — return the preview, no approval wait.
          if (b.isDryRun()) { const dr = await b.execute({ specialistAgentId, mcpServer, toolName, arguments: args, startedAtMs: deps.nowMs() }); return res.json({ success: true, dryRun: true, decision: "dry-run", outputPreview: dr.outputPreview, toolCallId, mcpServer, toolName, evidenceIds: [], artifacts: [] }); }
          return res.json({ success: false, decision: "awaiting_approval", toolCallId, mcpServer, toolName, note: "approve via /api/runs/:id/approvals/:approvalId/approve, then re-POST /api/mcp/execute with this toolCallId" });
        }
      } catch (e) { return res.status(400).json({ success: false, error: (e as Error).message }); }
    } else {
      const tc = deps.agentRuntime.getRun(runId) && (deps.agentRuntime as any).store?.getToolCall?.(runId, toolCallId);
      if (tc && tc.status !== "approved" && tc.status !== "executing") return res.status(409).json({ success: false, error: `toolCall ${toolCallId} is '${tc.status}', not approved` });
    }

    // DRY-RUN: record-only, no execution.
    if (b.isDryRun()) {
      const dr = await b.execute({ specialistAgentId, mcpServer, toolName, arguments: args, startedAtMs: deps.nowMs() });
      return res.json({ success: true, dryRun: true, decision: "dry-run", outputPreview: dr.outputPreview, toolCallId, mcpServer, toolName, evidenceIds: [], artifacts: [] });
    }

    // ENABLED: execute the MCP tool.
    const t0 = deps.nowMs();
    const result = await b.execute({ specialistAgentId, mcpServer, toolName, arguments: args, startedAtMs: t0 });
    result.durationMs = Math.max(0, deps.nowMs() - t0);

    // Record ToolResult + Evidence (large output → artifact via recordEvidence).
    const evidenceIds: string[] = [];
    let artifactId: string | null = null;
    try {
      if (toolCallId) deps.agentRuntime.recordToolResult(runId, toolCallId, { success: result.success, output: result.outputPreview, error: result.error ?? undefined });
      const ev = deps.agentRuntime.recordEvidence({ runId, stepId: stepId ?? null, kind: "command_output", label: `mcp:${mcpServer}:${toolName}`, content: result.outputPreview, sourceToolName: `${mcpServer}.${toolName}`, sourceToolCallId: toolCallId ?? undefined });
      evidenceIds.push(ev.id); result.evidenceIds = evidenceIds; artifactId = (ev as any).artifactId ?? null;
    } catch (e) { deps.log("warn", "16.3 MCP result recording failed", { error: (e as Error).message }); }

    deps.log("info", "16.3 MCP executed", { specialistAgentId, mcpServer, toolName, success: result.success, durationMs: result.durationMs });
    res.json({ success: result.success, decision: "executed", mcpServer, toolName, specialistAgentId, outputPreview: result.outputPreview, fullOutputBytes: result.fullOutputBytes, evidenceIds, artifacts: artifactId ? [artifactId] : [], error: result.error, durationMs: result.durationMs, isError: result.isError });
  });
}
