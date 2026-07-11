import { test, expect, describe } from "bun:test";
import {
  createAgentRun,
  createAgentEvent,
  normalizeToolResult,
  isAgentRunStatus,
  isAgentEventType,
  isProviderKind,
  isRiskLevel,
  isEvidenceKind,
  newId,
  AGENT_RUN_STATUSES,
  isTerminalRunStatus,
} from "../types";

describe("runtime types — guards", () => {
  test("isAgentRunStatus accepts valid, rejects invalid", () => {
    expect(isAgentRunStatus("executing")).toBe(true);
    expect(isAgentRunStatus("completed")).toBe(true);
    expect(isAgentRunStatus("nonsense")).toBe(false);
    expect(isAgentRunStatus(42)).toBe(false);
  });

  test("every declared status passes its own guard", () => {
    for (const s of AGENT_RUN_STATUSES) expect(isAgentRunStatus(s)).toBe(true);
  });

  test("isAgentEventType / isProviderKind / isRiskLevel / isEvidenceKind", () => {
    expect(isAgentEventType("tool_requested")).toBe(true);
    expect(isAgentEventType("nope")).toBe(false);
    expect(isProviderKind("claude")).toBe(true);
    expect(isProviderKind("gpt9")).toBe(false);
    expect(isRiskLevel("terminal")).toBe(true);
    expect(isRiskLevel("safe")).toBe(false);
    expect(isEvidenceKind("command_output")).toBe(true);
    expect(isEvidenceKind("finding")).toBe(true);
    expect(isEvidenceKind("totally_made_up")).toBe(false);
    expect(isEvidenceKind(123)).toBe(false);
  });

  test("terminal statuses are flagged", () => {
    expect(isTerminalRunStatus("completed")).toBe(true);
    expect(isTerminalRunStatus("failed")).toBe(true);
    expect(isTerminalRunStatus("cancelled")).toBe(true);
    expect(isTerminalRunStatus("executing")).toBe(false);
  });
});

describe("runtime types — factories", () => {
  test("newId carries a self-describing prefix and is unique", () => {
    const a = newId("run");
    const b = newId("run");
    expect(a.startsWith("run_")).toBe(true);
    expect(a).not.toBe(b);
  });

  test("createAgentRun produces a valid initial run", () => {
    const run = createAgentRun({
      sessionId: "sess-1",
      persona: "chillspwn",
      providerKind: "openrouter",
      objective: "enumerate the target",
    });
    expect(run.id.startsWith("run_")).toBe(true);
    expect(run.status).toBe("created");
    expect(run.stepIds).toEqual([]);
    expect(run.sessionId).toBe("sess-1");
    expect(run.createdAt).toBe(run.updatedAt);
    expect(typeof run.createdAt).toBe("string");
  });

  test("createAgentEvent defaults nullable provenance fields", () => {
    const ev = createAgentEvent({ type: "security_event", data: { kind: "server_start" } });
    expect(ev.id.startsWith("evt_")).toBe(true);
    expect(ev.type).toBe("security_event");
    expect(ev.agentRunId).toBeNull();
    expect(ev.sessionId).toBeNull();
    expect(ev.stepId).toBeNull();
    expect(ev.data).toEqual({ kind: "server_start" });
  });

  test("normalizeToolResult fills defaults and preserves fields", () => {
    expect(normalizeToolResult({ success: true })).toEqual({
      success: true,
      output: "",
      artifacts: undefined,
      evidenceRefs: undefined,
      error: undefined,
      suggestedNextStep: undefined,
    });
    const r = normalizeToolResult({ success: false, output: "boom", error: "x" });
    expect(r.success).toBe(false);
    expect(r.output).toBe("boom");
    expect(r.error).toBe("x");
  });
});
