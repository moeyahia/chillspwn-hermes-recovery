/**
 * agentRoutes (Phase 15.17) — read-only API surface for the specialist army so the Mission Board /
 * Cockpit can render ChillsPwn (Commander-in-Chief) + specialists, the routing decision, and the
 * enforcement mode. Data-first (minimal UI). Gated by ENABLE_SPECIALIST_AGENT_ROUTING.
 */

import type { Express, Request, Response } from "express";
import { AGENT_ROSTER } from "../agents/agentRoster";
import { AGENT_MCP_MAP } from "../agents/agentMcpMap";
import { buildMissionBoard } from "../agents/missionBoard";
import { routeTask, specialistProfile } from "../agents/agentRouter";
import { AgentRoutingPolicy, type RoutingPolicyConfig } from "../agents/AgentRoutingPolicy";
import { buildSpecialistBoard, SPECIALIST_LANES, type RunDocLite, type McpStatusSummary, type HandoffRecord, type KanbanCardLite } from "../agents/missionBoardLanes";

export interface AgentRouteDeps {
  guardSeg: (res: Response, val: string, name: string) => boolean;
  enabled: () => boolean;
  policyConfig: () => RoutingPolicyConfig;
  // Phase 16.1 — specialist-lane Mission Board inputs (optional; when absent the lanes render empty).
  board?: {
    listRunDocs: (missionId: string | null) => RunDocLite[];
    mcpStatusForAgent: (agentId: string) => McpStatusSummary;
    memoryCountsForAgent: (agentId: string) => { proposed: number; verified: number; failedAttempts: number; verifiedUsed: number };
    handoffs: (missionId: string | null) => HandoffRecord[];
    kanbanCards?: (missionId: string | null) => KanbanCardLite[];
  };
}

export function registerAgentRoutes(app: Express, deps: AgentRouteDeps): void {
  const gate = (res: Response) => deps.enabled() ? true : (res.status(403).json({ error: "specialist agent routing disabled" }), false);

  app.get("/api/agents/roster", (_req: Request, res: Response) => {
    if (!gate(res)) return;
    res.json({ commander: { agentId: "chillspwn", role: "Commander-in-Chief" }, specialists: AGENT_ROSTER, map: AGENT_MCP_MAP });
  });

  // Phase 16.1 — lane definitions (exact order) for the specialist Mission Board.
  app.get("/api/agents/mission-board/lanes", (_req: Request, res: Response) => {
    if (!gate(res)) return;
    res.json({ mode: "specialist_lanes", lanes: SPECIALIST_LANES });
  });

  // Phase 16.1 — the active Mission Board is the SPECIALIST-LANE board (Command + 11 specialists +
  // Blocked/Approval + Complete). The legacy flat cards remain available as `legacyCards` and the old
  // generic Kanban board is untouched (its APIs are unchanged). ?mode=legacy returns only the old cards.
  app.get("/api/agents/mission-board", (req: Request, res: Response) => {
    if (!gate(res)) return;
    const missionId = typeof req.query.missionId === "string" ? req.query.missionId : null;
    const legacyCards = buildMissionBoard(missionId);
    if (req.query.mode === "legacy" || !deps.board) {
      return res.json({ mode: req.query.mode === "legacy" ? "legacy" : "specialist_lanes", missionId, legacyCards, lanes: deps.board ? undefined : [], cards: legacyCards });
    }
    const b = deps.board;
    const board = buildSpecialistBoard({
      missionId,
      docs: b.listRunDocs(missionId),
      mcpStatusForAgent: b.mcpStatusForAgent,
      memoryCountsForAgent: b.memoryCountsForAgent,
      handoffs: b.handoffs(missionId),
      kanbanCards: b.kanbanCards ? b.kanbanCards(missionId) : [],
    });
    res.json({ ...board, legacyCards });
  });

  app.get("/api/agents/:agentId/profile", (req: Request, res: Response) => {
    if (!deps.guardSeg(res, req.params.agentId, "agentId")) return;
    if (!gate(res)) return;
    const p = specialistProfile(req.params.agentId);
    if (!p) return res.status(404).json({ error: "unknown specialist" });
    res.json({ profile: p });
  });

  // Routing preview: "who would ChillsPwn route this task to, and under what restricted profile?"
  app.get("/api/agents/route", (req: Request, res: Response) => {
    if (!gate(res)) return;
    const task = typeof req.query.task === "string" ? req.query.task : "";
    res.json({ task, routing: routeTask(task) });
  });

  // Current enforcement posture (audit vs enforce) — drives the cockpit's safety label.
  app.get("/api/agents/enforcement", (_req: Request, res: Response) => {
    if (!gate(res)) return;
    const cfg = deps.policyConfig();
    res.json({
      ...cfg,
      mode: cfg.enforceChillspwnDelegation ? "ENFORCE" : "AUDIT",
      note: cfg.enforceChillspwnDelegation
        ? "ChillsPwn direct specialist-tool use is DENIED; specialists confined to allowlists."
        : "AUDIT-only: violations are logged but not blocked. Set ENFORCE_CHILLSPWN_DELEGATION=true to enforce.",
    });
  });

  // Dry-run: would a ChillsPwn direct tool call be blocked? (cockpit/test helper)
  // Phase 18 — also returns the HARD no-hands decision so the operator can verify, with a safe no-op,
  // that e.g. `terminal` is DENIED for the commander and names the specialist to route to.
  app.get("/api/agents/check-direct-tool", (req: Request, res: Response) => {
    if (!gate(res)) return;
    const tool = typeof req.query.tool === "string" ? req.query.tool : "";
    const command = typeof req.query.command === "string" ? req.query.command : undefined;
    const actor = typeof req.query.actor === "string" ? req.query.actor : "chillspwn";
    const policy = new AgentRoutingPolicy(deps.policyConfig());
    res.json({
      tool, actor, command: command ?? null,
      noHands: policy.commanderNoHands(actor, tool, command),
      legacyDirectTool: policy.chillspwnDirectTool(tool),
    });
  });
}
