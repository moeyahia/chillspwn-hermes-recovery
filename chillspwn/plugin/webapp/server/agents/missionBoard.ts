/**
 * Mission Board (Phase 15.7) + Handoff records (15.8). Pure data models + builders so the Mission
 * Board can render ChillsPwn (the Commander-in-Chief) + every active specialist as Agent Cards.
 * ChillsPwn owns the mission; specialists appear as cards with their restricted MCP/tool profile,
 * status, evidence, approvals, memory usage, and handoff target.
 */

import { COMMANDER_ID } from "./types";
import { AGENT_ROSTER, getAgent } from "./agentRoster";

export const AGENT_CARD_STATUSES = [
  "idle", "assigned", "planning", "running", "awaiting_approval", "blocked", "completed", "failed", "handoff_requested",
] as const;
export type AgentCardStatus = (typeof AGENT_CARD_STATUSES)[number];

export interface AgentCard {
  agentId: string;
  displayName: string;
  role: "commander" | "specialist";
  missionId: string | null;
  agentRunId: string | null;
  currentStepId: string | null;
  assignedTaskIds: string[];
  status: AgentCardStatus;
  specialty: string;
  persona: string;
  allowedMcpServers: string[];
  allowedTools: string[];
  pendingApprovals: number;
  evidenceCount: number;
  proposedLessonsCount: number;
  verifiedLessonsUsed: number;
  confidence: number | null;
  lastActivityAt: string | null;
  handoffTo: string | null;
  handoffReason: string | null;
  finalWorkerResultId: string | null;
}

export interface HandoffRecord {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  reason: string;
  evidenceIds: string[];
  sourceStepId: string | null;
  targetStepId: string | null;
  createdAt: string;
}

/** The ChillsPwn — Commander-in-Chief card (mission owner). Never a specialist. */
export function buildCommanderCard(missionId: string | null, state: Partial<AgentCard> = {}): AgentCard {
  return {
    agentId: COMMANDER_ID, displayName: "ChillsPwn — Commander-in-Chief", role: "commander",
    missionId, agentRunId: state.agentRunId ?? null, currentStepId: state.currentStepId ?? null,
    assignedTaskIds: state.assignedTaskIds ?? [], status: state.status ?? "planning",
    specialty: "command/route/supervise/approve/synthesize/learn", persona: COMMANDER_ID,
    allowedMcpServers: ["(coordination only — no direct specialist MCPs)"], allowedTools: ["plan", "route", "board", "cockpit", "approvals", "report-coordination"],
    pendingApprovals: state.pendingApprovals ?? 0, evidenceCount: state.evidenceCount ?? 0,
    proposedLessonsCount: state.proposedLessonsCount ?? 0, verifiedLessonsUsed: state.verifiedLessonsUsed ?? 0,
    confidence: state.confidence ?? null, lastActivityAt: state.lastActivityAt ?? null,
    handoffTo: null, handoffReason: null, finalWorkerResultId: null,
  };
}

/** A specialist Agent Card, merging its static roster profile with live runtime state. */
export function buildSpecialistCard(agentId: string, state: Partial<AgentCard> = {}): AgentCard | null {
  const a = getAgent(agentId);
  if (!a) return null;
  return {
    agentId: a.agentId, displayName: a.displayName, role: "specialist",
    missionId: state.missionId ?? null, agentRunId: state.agentRunId ?? null, currentStepId: state.currentStepId ?? null,
    assignedTaskIds: state.assignedTaskIds ?? [], status: state.status ?? "idle",
    specialty: a.specialty, persona: a.personaId,
    allowedMcpServers: a.allowedMcpServers, allowedTools: a.allowedTools,
    pendingApprovals: state.pendingApprovals ?? 0, evidenceCount: state.evidenceCount ?? 0,
    proposedLessonsCount: state.proposedLessonsCount ?? 0, verifiedLessonsUsed: state.verifiedLessonsUsed ?? 0,
    confidence: state.confidence ?? null, lastActivityAt: state.lastActivityAt ?? null,
    handoffTo: state.handoffTo ?? null, handoffReason: state.handoffReason ?? null,
    finalWorkerResultId: state.finalWorkerResultId ?? null,
  };
}

/** Build the full Mission Board: ChillsPwn command card first, then one card per specialist. */
export function buildMissionBoard(missionId: string | null, liveState: Record<string, Partial<AgentCard>> = {}): AgentCard[] {
  const cards: AgentCard[] = [buildCommanderCard(missionId, liveState[COMMANDER_ID])];
  for (const a of AGENT_ROSTER) {
    const c = buildSpecialistCard(a.agentId, { missionId, ...(liveState[a.agentId] ?? {}) });
    if (c) cards.push(c);
  }
  return cards;
}

let _hoSeq = 0;
/** Create a handoff record (id is derived; caller stamps createdAt). */
export function makeHandoff(input: Omit<HandoffRecord, "id">): HandoffRecord {
  return { id: `handoff_${++_hoSeq}_${input.fromAgentId}_${input.toAgentId}`, ...input };
}
