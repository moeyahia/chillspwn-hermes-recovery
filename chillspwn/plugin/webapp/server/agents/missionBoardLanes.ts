/**
 * Phase 16.1 — Specialist Mission Board: lanes + Agent Cards + Task Cards + handoffs.
 *
 * The active Mission Board is a SPECIALIST-OPERATIONS board: one lane per specialist (+ Command,
 * Blocked/Approval, Complete). ChillsPwn is the Commander-in-Chief command card in the Command lane —
 * NOT a separate Commander agent. This is a PURE builder: it assembles the board from runtime docs +
 * MCP health + memory counts, deriving each PlanStep's specialist from `step.assignedAgent` (explicit,
 * backward-compatible) or the router (fallback). It never mutates runs, never touches the Claude path,
 * and never enables MCPs.
 */

import { AGENT_ROSTER, getAgent } from "./agentRoster";
import { mappingFor } from "./agentMcpMap";
import { routeTask } from "./agentRouter";
import { COMMANDER_ID } from "./types";

// ── Lanes (EXACT order required by Phase 16.1) ──────────────────────────────────────────────
export interface LaneDef { laneId: string; title: string; agentId: string | null; kind: "command" | "specialist" | "blocked" | "complete" }
export const SPECIALIST_LANES: LaneDef[] = [
  { laneId: "command", title: "Command", agentId: COMMANDER_ID, kind: "command" },
  { laneId: "recon", title: "Recon", agentId: "ReconScout", kind: "specialist" },
  { laneId: "web", title: "Web", agentId: "WebBreaker", kind: "specialist" },
  { laneId: "vuln_intel", title: "Vulnerability Intel", agentId: "VulnIntel", kind: "specialist" },
  { laneId: "credentials", title: "Credentials", agentId: "CredSmith", kind: "specialist" },
  { laneId: "ad_identity", title: "AD / Identity", agentId: "ADAttackMapper", kind: "specialist" },
  { laneId: "cloud_container", title: "Cloud / Container", agentId: "CloudSentinel", kind: "specialist" },
  { laneId: "reverse_binary", title: "Reverse / Binary", agentId: "ReverseSage", kind: "specialist" },
  { laneId: "fuzzing", title: "Fuzzing", agentId: "FuzzSmith", kind: "specialist" },
  { laneId: "osint", title: "OSINT", agentId: "OSINTSeeker", kind: "specialist" },
  { laneId: "secrets_code", title: "Secrets / Code", agentId: "SecretHunter", kind: "specialist" },
  { laneId: "persistent_sessions", title: "Persistent Sessions", agentId: "SessionRunner", kind: "specialist" },
  { laneId: "reporting", title: "Reporting", agentId: "ReportSmith", kind: "specialist" },
  { laneId: "blocked_approval", title: "Blocked / Approval", agentId: null, kind: "blocked" },
  { laneId: "complete", title: "Complete", agentId: null, kind: "complete" },
];
const LANE_BY_AGENT: Record<string, string> = Object.fromEntries(SPECIALIST_LANES.filter((l) => l.agentId).map((l) => [l.agentId!.toLowerCase(), l.laneId]));
export function laneForAgent(agentId: string): string { return LANE_BY_AGENT[(agentId || "").toLowerCase()] ?? "command"; }

// Phase 19 — Open vs Completed grouping within each lane. A card is "completed" only when its status
// is a terminal/done state; everything else (incl. failed/blocked/unknown) is "open" so it stays
// visible for attention. Kept as a pure predicate so the API + tests share one definition.
export const COMPLETED_CARD_STATUSES: ReadonlySet<string> = new Set(["completed", "complete", "done", "archived", "closed"]);
export function isCompletedCardStatus(status: string | null | undefined): boolean {
  return COMPLETED_CARD_STATUSES.has((status || "").toLowerCase());
}
// Phase 19.1 — failed/cancelled cards get their OWN group (not mixed into Open) so dead work is
// visible-but-separated, like Completed.
export const FAILED_CARD_STATUSES: ReadonlySet<string> = new Set(["failed", "error", "cancelled", "canceled", "timed_out", "timedout"]);
export function isFailedCardStatus(status: string | null | undefined): boolean {
  return FAILED_CARD_STATUSES.has((status || "").toLowerCase());
}

export type AgentCardStatus = "idle" | "assigned" | "planning" | "running" | "awaiting_approval" | "blocked" | "completed" | "failed" | "handoff_requested";

export interface McpStatusSummary {
  bridgeMode: "disabled" | "dry-run" | "enabled" | "bridge_disabled";
  profile: "active" | "dry-run" | "staged" | "disabled" | "missing_dependency" | "missing_secret" | "docker_disabled" | "bridge_disabled" | "bridge_not_active" | "failed" | "healthy";
  enabledServers: number; disabledServers: number; missingDependency: number; missingSecret: number; dockerRequired: number;
  servers: { name: string; state: string }[];
}

export interface AgentCard {
  agentId: string; displayName: string; role: "commander" | "specialist";
  missionId: string | null; agentRunId: string | null; currentStepId: string | null; currentTaskIds: string[];
  assignedColumn: string; originatingLane: string; currentObjective: string | null;
  status: AgentCardStatus; specialty: string; persona: string;
  assignedTools: string[]; assignedMcpServers: string[]; mcpHealthStatus: McpStatusSummary;
  evidenceCount: number; pendingApprovalCount: number;
  proposedLessonCount: number; verifiedLessonCount: number; failedAttemptLessonCount: number; verifiedLessonsUsed: number;
  memoryNamespace: string; hypothesesExcluded: boolean;
  handoffTo: string | null; handoffFrom: string | null;
  confidence: number | null; lastActivityAt: string | null; finalWorkerResultId: string | null;
  cockpitUrl: string; boardUrl: string;
}

export interface TaskCard {
  taskId: string; missionId: string | null; runId: string; stepId: string;
  assignedAgentId: string | null; laneId: string; originatingLane: string;
  title: string; objective: string; status: string; riskLevel: string;
  allowedTools: string[]; allowedMcpServers: string[]; mcpHealthStatus: string;
  evidenceIds: string[]; approvalIds: string[]; artifactIds: string[]; dependsOn: string[]; handoffIds: string[];
  cockpitUrl: string; mirroredIn: string[]; createdAt: string; updatedAt: string;
}

export interface HandoffRecord {
  handoffId: string; missionId: string | null; runId: string | null;
  fromAgentId: string; toAgentId: string; reason: string;
  evidenceIds: string[]; sourceStepId: string | null; targetStepId: string | null;
  sourceTaskId: string | null; targetTaskId: string | null; createdAt: string;
}

export interface BoardLane {
  laneId: string; title: string; agentId: string | null; kind: string; agentCard: AgentCard | null;
  taskCards: TaskCard[];                 // back-compat: full list (existing consumers)
  openCards: TaskCard[];                 // Phase 19 — additive: active (not completed, not failed)
  completedCards: TaskCard[];            // Phase 19 — additive: terminal/done cards
  failedCards: TaskCard[];               // Phase 19.1 — additive: failed/cancelled cards
  counts: { tasks: number; running: number; blocked: number; awaitingApproval: number; completed: number; failed: number; open: number; approvals: number; evidence: number };
}

// ── Inputs the API gathers and hands to the pure builder ────────────────────────────────────
export interface RunDocLite {
  run: { id: string; persona?: string; objective?: string; status?: string; updatedAt?: string; missionId?: string | null };
  steps: { id: string; title: string; purpose?: string; successCriteria?: string; status: string; assignedAgent?: string; allowedTools?: string[]; riskLevel?: string; evidenceRefs?: string[]; dependencies?: string[]; createdAt?: string; updatedAt?: string }[];
  approvals?: { id: string; stepId?: string | null; status?: string }[];
  evidence?: { id: string; stepId?: string | null; artifactId?: string }[];
}
/** A kanban task (from board_create_task) — the agents create work here; we map it to lanes by assignee. */
export interface KanbanCardLite { id: string; title: string; status: string; assignee?: string; createdBy?: string; createdAt?: string }
export interface BoardBuildInput {
  missionId?: string | null;
  docs: RunDocLite[];
  mcpStatusForAgent: (agentId: string) => McpStatusSummary;     // from the bridge (or a disabled stub)
  memoryCountsForAgent: (agentId: string) => { proposed: number; verified: number; failedAttempts: number; verifiedUsed: number };
  handoffs?: HandoffRecord[];
  /** Kanban board_create_task cards (assignee → lane). Merged into the lanes alongside PlanStep cards. */
  kanbanCards?: KanbanCardLite[];
}

/** Map a kanban status to a Mission Board card status. */
function kanbanStatusToCard(s: string): string {
  switch ((s || "").toLowerCase()) {
    case "running": case "in_progress": return "running";
    case "done": case "completed": case "archived": return "completed";
    case "blocked": return "blocked";
    case "failed": return "failed";
    case "awaiting_approval": return "awaiting_approval";
    default: return "assigned"; // backlog / todo / unknown
  }
}

const cockpitUrlFor = (runId: string | null, agentId?: string, stepId?: string) =>
  `/cockpit?` + [runId ? `run=${runId}` : "", agentId ? `agent=${agentId}` : "", stepId ? `step=${stepId}` : ""].filter(Boolean).join("&");

/** Derive the specialist for a step: explicit assignedAgent wins; else route by title+purpose. */
export function specialistForStep(step: { title: string; purpose?: string; assignedAgent?: string }): string | null {
  if (step.assignedAgent && getAgent(step.assignedAgent)) return getAgent(step.assignedAgent)!.agentId;
  const r = routeTask(`${step.title} ${step.purpose ?? ""}`);
  return r.selectedAgent;
}

function stepStatusToCardStatus(statuses: string[]): AgentCardStatus {
  if (statuses.includes("running")) return "running";
  if (statuses.includes("awaiting_approval")) return "awaiting_approval";
  if (statuses.includes("blocked")) return "blocked";
  if (statuses.includes("failed")) return "failed";
  if (statuses.length && statuses.every((s) => s === "completed")) return "completed";
  if (statuses.length) return "assigned";
  return "idle";
}

/** Build the full specialist-lane board (pure). */
export function buildSpecialistBoard(input: BoardBuildInput): { mode: string; missionId: string | null; lanes: BoardLane[]; handoffs: HandoffRecord[] } {
  const missionId = input.missionId ?? null;
  // 1. Flatten every step into a Task Card with its derived specialist + lane.
  const tasks: TaskCard[] = [];
  const approvalsByStep: Record<string, string[]> = {};
  for (const d of input.docs) for (const a of d.approvals ?? []) if (a.stepId) (approvalsByStep[a.stepId] ??= []).push(a.id);
  const evArtifactByStep: Record<string, string[]> = {};
  for (const d of input.docs) for (const e of d.evidence ?? []) if (e.stepId && e.artifactId) (evArtifactByStep[e.stepId] ??= []).push(e.artifactId);

  for (const d of input.docs) {
    for (const step of d.steps) {
      const agentId = specialistForStep(step);
      const lane = agentId ? laneForAgent(agentId) : "blocked_approval"; // unassigned classified step → blocked
      const approvalIds = approvalsByStep[step.id] ?? [];
      const status = step.status;
      const mirroredIn: string[] = [];
      if (status === "blocked" || status === "awaiting_approval" || approvalIds.length) mirroredIn.push("blocked_approval");
      if (status === "completed") mirroredIn.push("complete");
      tasks.push({
        taskId: step.id, missionId, runId: d.run.id, stepId: step.id,
        assignedAgentId: agentId, laneId: lane, originatingLane: lane,
        title: step.title, objective: step.purpose ?? step.successCriteria ?? "", status, riskLevel: step.riskLevel ?? "terminal",
        allowedTools: step.allowedTools ?? [], allowedMcpServers: agentId ? (mappingFor(agentId)?.allowedMcpServers ?? []) : [],
        mcpHealthStatus: agentId ? input.mcpStatusForAgent(agentId).profile : "bridge_disabled",
        evidenceIds: step.evidenceRefs ?? [], approvalIds, artifactIds: evArtifactByStep[step.id] ?? [], dependsOn: step.dependencies ?? [],
        handoffIds: (input.handoffs ?? []).filter((h) => h.sourceStepId === step.id || h.targetStepId === step.id).map((h) => h.handoffId),
        cockpitUrl: cockpitUrlFor(d.run.id, agentId ?? undefined, step.id), mirroredIn,
        createdAt: step.createdAt ?? "", updatedAt: step.updatedAt ?? "",
      });
    }
  }

  // 1b. Merge KANBAN cards (board_create_task) — the agents create work here. Map by assignee → lane.
  for (const k of input.kanbanCards ?? []) {
    const agent = k.assignee && getAgent(k.assignee) ? getAgent(k.assignee)!.agentId : null;
    const isCommander = (k.assignee || "").toLowerCase() === COMMANDER_ID || (k.assignee || "").toLowerCase() === "chillspwn";
    const lane = agent ? laneForAgent(agent) : isCommander ? "command" : "blocked_approval";
    const status = kanbanStatusToCard(k.status);
    const mirroredIn: string[] = [];
    if (status === "blocked" || status === "awaiting_approval") mirroredIn.push("blocked_approval");
    if (status === "completed") mirroredIn.push("complete");
    tasks.push({
      taskId: k.id, missionId, runId: "", stepId: "",
      assignedAgentId: agent ?? (isCommander ? COMMANDER_ID : null), laneId: lane, originatingLane: lane,
      title: k.title || "(untitled card)", objective: `kanban card · ${k.assignee ?? "unassigned"}`, status, riskLevel: "n/a",
      allowedTools: [], allowedMcpServers: agent ? (mappingFor(agent)?.allowedMcpServers ?? []) : [],
      mcpHealthStatus: agent ? input.mcpStatusForAgent(agent).profile : "bridge_disabled",
      evidenceIds: [], approvalIds: [], artifactIds: [], dependsOn: [], handoffIds: [],
      cockpitUrl: "", mirroredIn, createdAt: k.createdAt ?? "", updatedAt: k.createdAt ?? "",
    });
  }

  // 2. Build each lane with its Agent Card + Task Cards (specialist lanes), or mirrored cards.
  const lanes: BoardLane[] = SPECIALIST_LANES.map((def) => {
    let taskCards: TaskCard[] = [];
    if (def.kind === "specialist" || def.kind === "command") taskCards = tasks.filter((t) => t.laneId === def.laneId);
    // Blocked/Approval = tasks PRIMARILY here (unassigned/unroutable) PLUS mirrored blocked/awaiting tasks.
    else if (def.kind === "blocked") taskCards = tasks.filter((t) => t.laneId === "blocked_approval" || t.mirroredIn.includes("blocked_approval")).map((t) => ({ ...t, laneId: "blocked_approval" }));
    else if (def.kind === "complete") taskCards = tasks.filter((t) => t.mirroredIn.includes("complete")).map((t) => ({ ...t, laneId: "complete" }));

    // Phase 19 — split into Open / Failed / Completed (preserving originatingLane + assignedAgentId).
    const completedCards = taskCards.filter((t) => isCompletedCardStatus(t.status));
    const failedCards = taskCards.filter((t) => isFailedCardStatus(t.status));
    const openCards = taskCards.filter((t) => !isCompletedCardStatus(t.status) && !isFailedCardStatus(t.status));
    const counts = {
      tasks: taskCards.length,
      running: taskCards.filter((t) => t.status === "running").length,
      blocked: taskCards.filter((t) => t.status === "blocked").length,
      awaitingApproval: taskCards.filter((t) => t.status === "awaiting_approval" || t.approvalIds.length).length,
      completed: completedCards.length,
      failed: failedCards.length,
      open: openCards.length,
      approvals: taskCards.reduce((n, t) => n + t.approvalIds.length, 0),
      evidence: taskCards.reduce((n, t) => n + t.evidenceIds.length, 0),
    };

    let agentCard: AgentCard | null = null;
    if (def.agentId) agentCard = buildAgentCard(def, input, tasks);
    return { laneId: def.laneId, title: def.title, agentId: def.agentId, kind: def.kind, agentCard, taskCards, openCards, completedCards, failedCards, counts };
  });

  return { mode: "specialist_lanes", missionId, lanes, handoffs: input.handoffs ?? [] };
}

function buildAgentCard(def: LaneDef, input: BoardBuildInput, allTasks: TaskCard[]): AgentCard {
  const isCommander = def.kind === "command";
  const myTasks = allTasks.filter((t) => t.assignedAgentId && t.assignedAgentId.toLowerCase() === (def.agentId || "").toLowerCase());
  const statuses = myTasks.map((t) => t.status);
  const agent = isCommander ? null : getAgent(def.agentId!);
  const mcp = isCommander
    ? { bridgeMode: "disabled" as const, profile: "bridge_disabled" as const, enabledServers: 0, disabledServers: 0, missingDependency: 0, missingSecret: 0, dockerRequired: 0, servers: [] }
    : input.mcpStatusForAgent(def.agentId!);
  const mem = isCommander ? { proposed: 0, verified: 0, failedAttempts: 0, verifiedUsed: 0 } : input.memoryCountsForAgent(def.agentId!);
  const activeRunId = myTasks.find((t) => t.status === "running")?.runId ?? myTasks[0]?.runId ?? null;
  const activeTask = myTasks.find((t) => t.status === "running") ?? myTasks.find((t) => t.status === "awaiting_approval") ?? myTasks[0];
  const handoffTo = (input.handoffs ?? []).find((h) => h.fromAgentId.toLowerCase() === (def.agentId || "").toLowerCase())?.toAgentId ?? null;
  const handoffFrom = (input.handoffs ?? []).find((h) => h.toAgentId.toLowerCase() === (def.agentId || "").toLowerCase())?.fromAgentId ?? null;

  return {
    agentId: def.agentId!, displayName: isCommander ? "ChillsPwn — Commander-in-Chief" : agent!.displayName,
    role: isCommander ? "commander" : "specialist",
    missionId: input.missionId ?? null, agentRunId: activeRunId, currentStepId: activeTask?.stepId ?? null,
    currentTaskIds: myTasks.map((t) => t.taskId), assignedColumn: def.laneId, originatingLane: def.laneId,
    currentObjective: activeTask?.objective ?? null,
    status: handoffTo ? "handoff_requested" : stepStatusToCardStatus(statuses),
    specialty: isCommander ? "command/route/supervise/approve/synthesize/learn" : agent!.specialty,
    persona: isCommander ? COMMANDER_ID : agent!.personaId,
    assignedTools: isCommander ? ["plan", "route", "board", "approvals", "report-coordination"] : agent!.allowedTools,
    assignedMcpServers: isCommander ? ["(coordination only — no direct specialist MCPs)"] : agent!.allowedMcpServers,
    mcpHealthStatus: mcp,
    evidenceCount: myTasks.reduce((n, t) => n + t.evidenceIds.length, 0),
    pendingApprovalCount: myTasks.reduce((n, t) => n + t.approvalIds.length, 0),
    proposedLessonCount: mem.proposed, verifiedLessonCount: mem.verified, failedAttemptLessonCount: mem.failedAttempts, verifiedLessonsUsed: mem.verifiedUsed,
    memoryNamespace: isCommander ? "global" : agent!.memoryNamespace, hypothesesExcluded: true,
    handoffTo, handoffFrom, confidence: null,
    lastActivityAt: null, finalWorkerResultId: null,
    cockpitUrl: cockpitUrlFor(activeRunId, def.agentId!), boardUrl: `/missionboard?lane=${def.laneId}`,
  };
}

let _hoSeq = 0;
export function makeHandoff(input: Omit<HandoffRecord, "handoffId">): HandoffRecord {
  return { handoffId: `handoff_${++_hoSeq}_${input.fromAgentId}_${input.toAgentId}`, ...input };
}
