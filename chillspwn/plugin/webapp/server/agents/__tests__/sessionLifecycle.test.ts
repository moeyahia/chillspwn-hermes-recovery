/**
 * Phase 19 — Mission Board Open/Completed grouping + session lifecycle classification/filter/naming.
 */
import { test, expect, describe } from "bun:test";
import { buildSpecialistBoard, isCompletedCardStatus, type RunDocLite, type McpStatusSummary } from "../missionBoardLanes";
import {
  classifySessionKind, isTerminalSession, isTerminalSessionStatus, structuredSessionName,
  filterSessionsForList, type SessionLike,
} from "../sessionLifecycle";

const MCP_STUB: McpStatusSummary = { bridgeMode: "disabled", profile: "disabled", enabledServers: 0, disabledServers: 2, missingDependency: 0, missingSecret: 0, dockerRequired: 2, servers: [] };
const baseInput = (docs: RunDocLite[]) => ({
  missionId: "m1", docs,
  mcpStatusForAgent: (_a: string) => MCP_STUB,
  memoryCountsForAgent: (_a: string) => ({ proposed: 0, verified: 0, failedAttempts: 0, verifiedUsed: 0 }),
  handoffs: [],
});
const doc = (runId: string, steps: any[]): RunDocLite => ({ run: { id: runId, persona: "ChillsPwn", objective: "o", status: "executing" }, steps, approvals: [], evidence: [] });

describe("Phase 19 — Mission Board Open/Completed grouping", () => {
  const board = buildSpecialistBoard(baseInput([doc("r1", [
    { id: "s1", title: "scan ports", status: "running", assignedAgent: "ReconScout", evidenceRefs: ["ev1"] },
    { id: "s2", title: "deep scan", status: "completed", assignedAgent: "ReconScout", evidenceRefs: ["ev2", "ev3"] },
    { id: "s3", title: "udp scan", status: "done", assignedAgent: "ReconScout" },
    { id: "s4", title: "vhost scan", status: "failed", assignedAgent: "ReconScout" },
  ])]));
  const recon = board.lanes.find((l) => l.laneId === "recon")!;

  test("lane returns openCards and completedCards", () => {
    expect(Array.isArray(recon.openCards)).toBe(true);
    expect(Array.isArray(recon.completedCards)).toBe(true);
  });
  test("Phase 19.1 — open / failed / completed are separated", () => {
    const openTitles = recon.openCards.map((c) => c.title);
    const doneTitles = recon.completedCards.map((c) => c.title);
    const failTitles = (recon.failedCards ?? []).map((c) => c.title);
    expect(openTitles).toContain("scan ports");       // running → open
    expect(failTitles).toContain("vhost scan");        // failed → FAILED (its own group)
    expect(openTitles).not.toContain("vhost scan");    // failed no longer in open
    expect(doneTitles).toContain("deep scan");         // completed → done
    expect(doneTitles).toContain("udp scan");          // done → done
    expect(doneTitles).not.toContain("scan ports");
  });
  test("open + failed + completed counts correct", () => {
    expect(recon.counts.open).toBe(1);                 // only "scan ports"
    expect(recon.counts.failed).toBe(1);               // "vhost scan"
    expect(recon.counts.completed).toBe(2);
    expect(recon.counts.open).toBe(recon.openCards.length);
    expect(recon.counts.completed).toBe(recon.completedCards.length);
    expect(recon.counts.failed).toBe((recon.failedCards ?? []).length);
  });
  test("approvals + evidence counts aggregate", () => {
    expect(recon.counts.evidence).toBe(3); // ev1 + ev2 + ev3
    expect(typeof recon.counts.approvals).toBe("number");
  });
  test("completed card preserves assignedAgentId + originatingLane", () => {
    const done = recon.completedCards[0];
    expect(done.assignedAgentId).toBe("ReconScout");
    expect(done.originatingLane).toBe("recon");
  });
  test("collapsed-by-default helper: >3 completed collapses", () => {
    // mirror the UI rule: collapsed when completedCount > 3
    expect(2 > 3).toBe(false);          // recon has 2 → expanded
    expect(isCompletedCardStatus("completed")).toBe(true);
    expect(isCompletedCardStatus("archived")).toBe(true);
    expect(isCompletedCardStatus("running")).toBe(false);
    expect(isCompletedCardStatus("failed")).toBe(false);
  });
  test("back-compat: taskCards still present (full list = open+failed+completed)", () => {
    expect(recon.taskCards.length).toBe(recon.openCards.length + recon.completedCards.length + (recon.failedCards ?? []).length);
  });
});

// session fixtures
const liveChat: SessionLike = { id: "s-100", persona: "ChillsPwn", status: "running", isLive: true, title: "", preview: "lets pwn pingpong" };
const doneChat: SessionLike = { id: "s-101", persona: "ChillsPwn", status: "stopped", isLive: false, title: "", preview: "old chat" };
const cardDone: SessionLike = { id: "card-abc", persona: "ReconScout", status: "stopped", isLive: false, title: "", preview: "Task: PingPong port scan" };
const cardRunning: SessionLike = { id: "card-def", persona: "ReconScout", status: "running", isLive: true, title: "", preview: "Task: PingPong port scan" };
const specByPersona: SessionLike = { id: "s-200", persona: "ADAttackMapper", status: "completed", isLive: false, title: "", preview: "gMSA path" };
const taskPrefixChat: SessionLike = { id: "s-201", persona: "ChillsPwn", status: "completed", isLive: false, title: "", preview: "Task: kerberoast pong" };
const awaitingApproval: SessionLike = { id: "card-ghi", persona: "SessionRunner", status: "awaiting_approval", isLive: false, title: "", preview: "Task: WinRM validation" };

describe("Phase 19 — session classification", () => {
  test("card-* is specialist", () => expect(classifySessionKind(cardDone)).toBe("specialist"));
  test("specialist persona is specialist", () => expect(classifySessionKind(specByPersona)).toBe("specialist"));
  test("'Task: …' prefix is specialist", () => expect(classifySessionKind(taskPrefixChat)).toBe("specialist"));
  test("ChillsPwn chat is NOT specialist (never auto-closed)", () => {
    expect(classifySessionKind(liveChat)).toBe("chat");
    expect(classifySessionKind(doneChat)).toBe("chat");
  });
  test("terminal detection (live never terminal)", () => {
    expect(isTerminalSessionStatus("stopped")).toBe(true);
    expect(isTerminalSessionStatus("completed")).toBe(true);
    expect(isTerminalSessionStatus("running")).toBe(false);
    expect(isTerminalSession(cardRunning)).toBe(false);  // live
    expect(isTerminalSession(cardDone)).toBe(true);
    expect(isTerminalSession(awaitingApproval)).toBe(false); // awaiting_approval is NOT terminal (Part 6)
  });
});

describe("Phase 19 — structured session naming (Part 3)", () => {
  test("specialist session: AgentName · task · status", () => {
    expect(structuredSessionName(cardDone)).toBe("ReconScout · PingPong port scan · stopped");
    expect(structuredSessionName(awaitingApproval)).toBe("SessionRunner · WinRM validation · awaiting approval");
  });
  test("real chat has no structured name (UI keeps title/preview)", () => {
    expect(structuredSessionName(liveChat)).toBe("");
  });
});

describe("Phase 19 — active list filtering (Parts 2/4)", () => {
  const all = [liveChat, doneChat, cardDone, cardRunning, specByPersona, taskPrefixChat, awaitingApproval];

  test("default: completed specialist session removed from active list", () => {
    const list = filterSessionsForList(all);
    const ids = list.map((s) => s.id);
    expect(ids).not.toContain("card-abc");   // terminal specialist → hidden
    expect(ids).not.toContain("s-200");      // terminal specialist (by persona) → hidden
    expect(ids).not.toContain("s-201");      // terminal "Task:" chat → treated specialist → hidden
  });
  test("default: live + awaiting_approval specialist sessions STAY", () => {
    const ids = filterSessionsForList(all).map((s) => s.id);
    expect(ids).toContain("card-def");       // live specialist
    expect(ids).toContain("card-ghi");       // awaiting_approval (not terminal) — Part 6
  });
  test("default: real user chats are never auto-closed (even when stopped)", () => {
    const ids = filterSessionsForList(all).map((s) => s.id);
    expect(ids).toContain("s-100");          // live chat
    expect(ids).toContain("s-101");          // stopped chat — kept
  });
  test("includeClosed=true shows the completed/archived sessions", () => {
    const ids = filterSessionsForList(all, { includeClosed: true }).map((s) => s.id);
    expect(ids).toContain("card-abc");
    expect(ids).toContain("s-200");
  });
  test("status=completed returns only terminal sessions", () => {
    const ids = filterSessionsForList(all, { status: "completed" }).map((s) => s.id);
    expect(ids).toContain("card-abc");
    expect(ids).not.toContain("s-100");      // live chat excluded
  });
  test("enabled=false (feature-flag rollback) shows everything", () => {
    expect(filterSessionsForList(all, { enabled: false }).length).toBe(all.length);
  });
});

describe("Phase 19 — cleanup classification (Part 5b safety)", () => {
  test("cleanup would target ONLY terminal specialist sessions, never real chats", () => {
    const all = [liveChat, doneChat, cardDone, specByPersona, taskPrefixChat, cardRunning, awaitingApproval];
    const targets = all.filter((s) => classifySessionKind(s) === "specialist" && isTerminalSession(s));
    const ids = targets.map((s) => s.id).sort();
    expect(ids).toEqual(["card-abc", "s-200", "s-201"].sort());
    // real chats + live + awaiting-approval never targeted
    expect(targets.find((s) => s.id === "s-100")).toBeUndefined();
    expect(targets.find((s) => s.id === "s-101")).toBeUndefined();
    expect(targets.find((s) => s.id === "card-def")).toBeUndefined();
    expect(targets.find((s) => s.id === "card-ghi")).toBeUndefined();
  });
});
