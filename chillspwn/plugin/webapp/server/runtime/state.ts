/**
 * AgentRun state machine (Phase 1 scaffolding).
 *
 * The runtime — not the model — owns which status transitions are legal. Phase 2
 * drives these transitions inside AgentRuntime; Phase 1 ships the table + guards so
 * the rules are testable in isolation and the engine has a single source of truth.
 */

import type { AgentRunStatus } from "./types";
import { isTerminalRunStatus } from "./types";

/**
 * Legal transitions. A status maps to the set of statuses it may move to.
 * Terminal statuses map to an empty set (enforced by `isTerminalRunStatus`).
 */
const TRANSITIONS: Record<AgentRunStatus, readonly AgentRunStatus[]> = {
  created: ["planning", "cancelled", "failed"],
  planning: ["awaiting_plan_approval", "executing", "failed", "cancelled"],
  awaiting_plan_approval: ["executing", "planning", "cancelled", "failed"],
  executing: [
    "awaiting_user_input",
    "blocked",
    "completed",
    "failed",
    "cancelled",
    "planning", // re-planning mid-run is allowed
  ],
  awaiting_user_input: ["executing", "cancelled", "failed", "blocked"],
  blocked: ["executing", "awaiting_user_input", "cancelled", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function allowedTransitions(from: AgentRunStatus): readonly AgentRunStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: AgentRunStatus, to: AgentRunStatus): boolean {
  if (isTerminalRunStatus(from)) return false;
  return TRANSITIONS[from].includes(to);
}

/** Throws a descriptive error on an illegal transition (used by the Phase 2 engine). */
export function assertTransition(from: AgentRunStatus, to: AgentRunStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `Illegal AgentRun transition: ${from} → ${to} (allowed: ${
        allowedTransitions(from).join(", ") || "<none, terminal>"
      })`,
    );
  }
}
