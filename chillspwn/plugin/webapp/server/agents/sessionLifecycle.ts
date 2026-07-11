/**
 * sessionLifecycle (Phase 19) — pure, testable classification + naming + list-filtering for sessions.
 *
 * Problem: every delegated specialist/board worker creates a session that LINGERS in the active
 * session list after it finishes (the repeated "Task: PingPong…" spam). This module decides, without
 * deleting anything, which sessions are GENERATED specialist sessions vs real user chats, whether a
 * session is terminal, and how to name/filter them so the active list stays focused on running work.
 *
 * NON-DESTRUCTIVE: this only annotates + filters a LIST. Session files on disk are never touched here.
 */

import { AGENT_ROSTER } from "./agentRoster";

/** Specialist roster ids (lower-cased). The commander ("chillspwn") is intentionally NOT here — the
 * main mission chat must never be auto-hidden. */
export const SPECIALIST_PERSONA_IDS: ReadonlySet<string> = new Set(
  AGENT_ROSTER.map((a) => a.agentId.toLowerCase()),
);

/** Terminal = the work is over. Specialist sessions in a terminal state are hidden from the default
 * active list (but kept on disk + shown with includeClosed). */
export const TERMINAL_SESSION_STATUSES: ReadonlySet<string> = new Set([
  "completed", "complete", "done", "archived", "closed", "stopped", "failed", "cancelled", "canceled", "timed_out", "timedout",
]);

/** Active = still running or needs attention (incl. awaiting_approval + blocked, per Part 6). */
export const ACTIVE_SESSION_STATUSES: ReadonlySet<string> = new Set([
  "running", "active", "planning", "awaiting_approval", "blocked", "idle", "assigned", "pending", "handoff_requested",
]);

export interface SessionLike {
  id: string;
  persona?: string;
  status?: string;
  isLive?: boolean;
  title?: string;
  preview?: string;
}

export type SessionKind = "specialist" | "chat";

/**
 * A session is a GENERATED specialist session when it is a board worker (`card-…`), runs a specialist
 * persona, or carries the delegated-task prompt prefix ("Task: …"). Everything else (incl. ChillsPwn
 * commander chats and human chats) is a real chat that is never auto-hidden.
 */
export function classifySessionKind(s: SessionLike): SessionKind {
  if ((s.id || "").startsWith("card-")) return "specialist";
  if (SPECIALIST_PERSONA_IDS.has((s.persona || "").toLowerCase())) return "specialist";
  const text = `${s.title || ""} ${s.preview || ""}`;
  if (/^\s*task:\s/i.test(s.title || "") || /^\s*task:\s/i.test(s.preview || "")) return "specialist";
  void text;
  return "chat";
}

export function isTerminalSessionStatus(status: string | null | undefined): boolean {
  return TERMINAL_SESSION_STATUSES.has((status || "").toLowerCase());
}

/** A live session is never terminal regardless of its persisted status. */
export function isTerminalSession(s: SessionLike): boolean {
  if (s.isLive) return false;
  return isTerminalSessionStatus(s.status);
}

const STATUS_LABEL: Record<string, string> = {
  running: "running", active: "running", awaiting_approval: "awaiting approval", blocked: "blocked",
  completed: "completed", complete: "completed", done: "completed", stopped: "stopped",
  failed: "failed", cancelled: "cancelled", canceled: "cancelled", archived: "archived", closed: "closed",
  planning: "planning", idle: "idle", assigned: "assigned", pending: "pending", handoff_requested: "handoff",
};

/** Strip the board-worker prompt prefix + trim to a short task phrase. */
function shortTask(s: SessionLike): string {
  let t = (s.preview || s.title || "").trim();
  t = t.replace(/^\s*task:\s*/i, "").replace(/\s+/g, " ").trim();
  if (t.length > 38) t = t.slice(0, 37).trimEnd() + "…";
  return t || "task";
}

/**
 * Structured display name for a GENERATED specialist session: `<AgentName> · <short task> · <status>`.
 * Returns "" for real chats (the UI keeps its own title/preview for those). A user-set custom title
 * always wins at the UI layer — this is only the fallback name that replaces "Task: …" spam.
 */
export function structuredSessionName(s: SessionLike): string {
  if (classifySessionKind(s) !== "specialist") return "";
  const agent = (s.persona || "agent").trim();
  const status = STATUS_LABEL[(s.status || "").toLowerCase()] || (s.isLive ? "running" : (s.status || "").toLowerCase() || "idle");
  return `${agent} · ${shortTask(s)} · ${status}`;
}

export interface ListFilterOpts {
  includeClosed?: boolean;
  status?: "active" | "completed" | "archived" | "all" | string;
  /** When false, the default-hide rule is disabled entirely (feature-flag rollback). */
  enabled?: boolean;
}

/**
 * Default active list = hide GENERATED specialist sessions that are terminal (and not live). Real
 * chats and any live/active session always stay. `includeClosed`/`status=all` returns everything;
 * `status=active|completed|archived` filters explicitly. `enabled=false` disables hiding (rollback).
 */
export function filterSessionsForList<T extends SessionLike>(sessions: T[], opts: ListFilterOpts = {}): T[] {
  const { includeClosed = false, status, enabled = true } = opts;
  if (status === "all" || includeClosed || enabled === false) {
    if (status && status !== "all") return applyStatusFilter(sessions, status);
    return sessions;
  }
  if (status && status !== "all") return applyStatusFilter(sessions, status);
  // default: drop terminal specialist sessions
  return sessions.filter((s) => !(classifySessionKind(s) === "specialist" && isTerminalSession(s)));
}

function applyStatusFilter<T extends SessionLike>(sessions: T[], status: string): T[] {
  switch (status) {
    case "active": return sessions.filter((s) => s.isLive || !isTerminalSession(s));
    case "completed": return sessions.filter((s) => isTerminalSession(s));
    case "archived": return sessions.filter((s) => (s.status || "").toLowerCase() === "archived");
    default: return sessions;
  }
}
