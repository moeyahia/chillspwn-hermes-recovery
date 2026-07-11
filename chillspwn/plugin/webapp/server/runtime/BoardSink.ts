/**
 * BoardSink (Phase 2) — runtime-owned board integration.
 *
 * The board is no longer dependent on the model remembering to call a board tool.
 * The AgentRuntime creates one card per PlanStep and updates it as the step runs,
 * collects evidence, and completes — through this interface.
 *
 *  - `MemoryBoardSink` — in-memory, for tests and as a safe default.
 *  - `KanbanBoardSink` — writes to the existing kanban via an injected `write(sql)` +
 *    `esc()` (the server passes its boardWrite/bsql — same escaped-SQL-over-sqlite3
 *    pattern used everywhere else in index.ts). It deliberately creates cards in a
 *    NON-'queued' status so the dashboard's auto-dispatcher never spawns an agent for a
 *    runtime plan card — the runtime owns execution, not the sweeper.
 *
 * Both implementations are total (never throw into the runtime): a board failure must
 * not abort an agent run.
 */

import type { PlanStepStatus } from "./types";

export interface BoardCardInput {
  agentRunId: string;
  stepId: string;
  title: string;
  body: string;
  /** Column/persona the card belongs to. */
  assignee: string;
  status: PlanStepStatus;
}

export interface BoardCardPatch {
  status?: PlanStepStatus;
  summary?: string;
  evidenceRefs?: string[];
}

export interface BoardSink {
  /** Create a card; returns its id, or null if the board write failed. */
  createCard(input: BoardCardInput): string | null;
  updateCard(cardId: string, patch: BoardCardPatch): void;
}

/** PlanStep status → the existing kanban CardStatus vocabulary (backlog/running/done/failed). */
export function planStatusToCard(status: PlanStepStatus): "backlog" | "running" | "done" | "failed" {
  switch (status) {
    case "running": return "running";
    case "completed": return "done";
    case "skipped": return "done";
    case "failed": return "failed";
    case "blocked": return "backlog";
    case "pending":
    default: return "backlog";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory sink (tests + safe default)
// ─────────────────────────────────────────────────────────────────────────────

export interface MemoryCard extends BoardCardInput {
  id: string;
  summary?: string;
  evidenceRefs: string[];
}

export class MemoryBoardSink implements BoardSink {
  readonly cards = new Map<string, MemoryCard>();
  private seq = 0;

  createCard(input: BoardCardInput): string {
    const id = `memcard_${++this.seq}`;
    this.cards.set(id, { ...input, id, evidenceRefs: [] });
    return id;
  }

  updateCard(cardId: string, patch: BoardCardPatch): void {
    const c = this.cards.get(cardId);
    if (!c) return;
    if (patch.status) c.status = patch.status;
    if (patch.summary !== undefined) c.summary = patch.summary;
    if (patch.evidenceRefs) c.evidenceRefs = patch.evidenceRefs;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Kanban sink (real board; SQL writer injected so the runtime never imports the server)
// ─────────────────────────────────────────────────────────────────────────────

/** A board change to broadcast to live dashboard clients. */
export interface BoardChangeEvent {
  type: "board_card_updated";
  taskId: string;
  patch: Record<string, unknown>;
}

export interface SqlBoardDeps {
  /** Run a write SQL statement. The server passes boardWrite (escaped SQL over sqlite3). */
  write: (sql: string) => void;
  /** Escape a value for single-quoted SQL (server passes bsql). */
  esc: (s: unknown) => string;
  /** Millisecond timestamp for created_at. */
  now: () => number;
  /** Mint a card id. */
  genId: () => string;
  /**
   * Optional: notified after a successful card create/update so the server can
   * broadcast it to live Kanban clients (server passes broadcastBoard). Best-effort —
   * a throwing/absent sink never affects the board write or the run.
   */
  onChange?: (evt: BoardChangeEvent) => void;
}

export class KanbanBoardSink implements BoardSink {
  constructor(private readonly deps: SqlBoardDeps) {}

  createCard(input: BoardCardInput): string | null {
    const id = this.deps.genId();
    const card = planStatusToCard(input.status); // never 'queued' ⇒ no auto-dispatch
    try {
      this.deps.write(
        `INSERT INTO tasks (id, title, body, status, assignee, created_by, created_at) VALUES (` +
          `'${this.deps.esc(id)}', '${this.deps.esc(input.title)}', '${this.deps.esc(input.body)}', ` +
          `'${card}', '${this.deps.esc(input.assignee)}', 'runtime', ${this.deps.now()});`,
      );
    } catch {
      return null; // board write failure must not abort the run
    }
    this.notify({ type: "board_card_updated", taskId: id, patch: { status: card, title: input.title, assignee: input.assignee, createdBy: "runtime" } });
    return id;
  }

  updateCard(cardId: string, patch: BoardCardPatch): void {
    const sets: string[] = [];
    const broadcast: Record<string, unknown> = {};
    if (patch.status) { sets.push(`status='${planStatusToCard(patch.status)}'`); broadcast.status = planStatusToCard(patch.status); }
    if (patch.summary !== undefined) { sets.push(`result='${this.deps.esc(patch.summary)}'`); broadcast.result = patch.summary; }
    if (!sets.length) return;
    try {
      this.deps.write(`UPDATE tasks SET ${sets.join(", ")} WHERE id='${this.deps.esc(cardId)}';`);
    } catch {
      return; // non-fatal
    }
    this.notify({ type: "board_card_updated", taskId: cardId, patch: broadcast });
  }

  private notify(evt: BoardChangeEvent): void {
    if (!this.deps.onChange) return;
    try { this.deps.onChange(evt); } catch { /* broadcast failure is non-fatal */ }
  }
}
