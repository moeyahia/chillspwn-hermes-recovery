import { test, expect, describe } from "bun:test";
import {
  MemoryBoardSink,
  KanbanBoardSink,
  planStatusToCard,
  type BoardChangeEvent,
} from "../BoardSink";

describe("planStatusToCard", () => {
  test("maps PlanStep status to the kanban CardStatus vocabulary (never 'queued')", () => {
    expect(planStatusToCard("pending")).toBe("backlog");
    expect(planStatusToCard("running")).toBe("running");
    expect(planStatusToCard("completed")).toBe("done");
    expect(planStatusToCard("skipped")).toBe("done");
    expect(planStatusToCard("failed")).toBe("failed");
    expect(planStatusToCard("blocked")).toBe("backlog");
  });
});

describe("MemoryBoardSink", () => {
  test("creates and updates cards", () => {
    const b = new MemoryBoardSink();
    const id = b.createCard({ agentRunId: "r", stepId: "s", title: "t", body: "b", assignee: "chillspwn", status: "pending" });
    expect(b.cards.get(id)?.status).toBe("pending");
    b.updateCard(id, { status: "running" });
    expect(b.cards.get(id)?.status).toBe("running");
    b.updateCard(id, { evidenceRefs: ["ev_1"] });
    expect(b.cards.get(id)?.evidenceRefs).toEqual(["ev_1"]);
  });
});

describe("KanbanBoardSink (Phase 2.1: SQL injected + onChange broadcast)", () => {
  function makeSink() {
    const sql: string[] = [];
    const changes: BoardChangeEvent[] = [];
    let n = 0;
    const sink = new KanbanBoardSink({
      write: (s) => sql.push(s),
      esc: (s) => String(s ?? "").replace(/'/g, "''"),
      now: () => 1000,
      genId: () => `card_${++n}`,
      onChange: (e) => changes.push(e),
    });
    return { sink, sql, changes };
  }

  test("createCard inserts a NON-'queued' card and broadcasts", () => {
    const { sink, sql, changes } = makeSink();
    const id = sink.createCard({ agentRunId: "r", stepId: "s", title: "Recon", body: "enum", assignee: "chillspwn", status: "pending" });
    expect(id).toBe("card_1");
    expect(sql[0]).toContain("INSERT INTO tasks");
    expect(sql[0]).toContain("'backlog'"); // pending → backlog, never 'queued'
    expect(sql[0]).not.toContain("'queued'");
    expect(changes[0]).toEqual({ type: "board_card_updated", taskId: "card_1", patch: { status: "backlog", title: "Recon", assignee: "chillspwn", createdBy: "runtime" } });
  });

  test("updateCard emits SQL + broadcast with mapped status", () => {
    const { sink, sql, changes } = makeSink();
    sink.updateCard("card_1", { status: "completed", summary: "done" });
    expect(sql[0]).toContain("status='done'");
    expect(sql[0]).toContain("result='done'");
    expect(changes[0].patch.status).toBe("done");
  });

  test("a failed board write returns null and does not broadcast", () => {
    const changes: BoardChangeEvent[] = [];
    const sink = new KanbanBoardSink({
      write: () => { throw new Error("db locked"); },
      esc: (s) => String(s ?? ""),
      now: () => 1, genId: () => "card_x",
      onChange: (e) => changes.push(e),
    });
    expect(sink.createCard({ agentRunId: "r", stepId: "s", title: "t", body: "b", assignee: "a", status: "pending" })).toBeNull();
    expect(changes.length).toBe(0);
  });

  test("a throwing onChange is non-fatal (card write still succeeds)", () => {
    const sql: string[] = [];
    const sink = new KanbanBoardSink({
      write: (s) => sql.push(s),
      esc: (s) => String(s ?? ""),
      now: () => 1, genId: () => "card_z",
      onChange: () => { throw new Error("broadcast boom"); },
    });
    expect(() => sink.createCard({ agentRunId: "r", stepId: "s", title: "t", body: "b", assignee: "a", status: "running" })).not.toThrow();
    expect(sql.length).toBe(1);
  });
});
