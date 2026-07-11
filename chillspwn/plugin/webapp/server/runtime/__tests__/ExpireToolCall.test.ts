import { test, expect, describe, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { AgentRuntime } from "../AgentRuntime";
import { AgentRunStore } from "../AgentRunStore";
import { EventLog } from "../EventLog";
import { MemoryBoardSink } from "../BoardSink";
import { DEFAULT_POLICY_CONFIG } from "../ToolPolicy";

const POLICY = { ...DEFAULT_POLICY_CONFIG, enableTerminal: true, requireApprovalForTerminal: true };
const dirs: string[] = [];
function mk() {
  const dir = mkdtempSync(join(tmpdir(), "chillspwn-exp-")); dirs.push(dir);
  const events = new EventLog({ dir });
  const rt = new AgentRuntime({ store: new AgentRunStore(dir), events, board: new MemoryBoardSink(), policy: POLICY });
  const run = rt.createManagedChatRun({ sessionId: "s", persona: "x", providerKind: "openrouter", objective: "o" });
  rt.beginPlanning(run.id);
  const { steps } = rt.submitPlan(run.id, { summary: "s", steps: [{ title: "a", purpose: "p", successCriteria: "c", allowedTools: [] }] });
  rt.approvePlan(run.id); rt.startStep(run.id, steps[0].id);
  // create a pending approval
  const req = rt.requestTool({ runId: run.id, stepId: steps[0].id, toolName: "terminal", command: "id", enforceAllowedTools: false });
  return { rt, events, run, step: steps[0], toolCallId: req.toolCall.id, approvalId: req.toolCall.approvalId! };
}
afterEach(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} } dirs.length = 0; });

describe("8.3 gate-timeout approval expiry", () => {
  test("a fresh requested tool starts as a PENDING approval", () => {
    const { rt, run } = mk();
    const doc = rt.getDoc(run.id)!;
    expect(doc.approvals.filter((a) => a.status === "pending").length).toBe(1);
  });

  test("expireToolCall marks approval=expired + toolCall=rejected", () => {
    const { rt, run, toolCallId, approvalId } = mk();
    rt.expireToolCall(run.id, toolCallId, "gate timed out");
    const doc = rt.getDoc(run.id)!;
    expect(doc.toolCalls.find((t) => t.id === toolCallId)!.status).toBe("rejected");
    expect(doc.approvals.find((a) => a.id === approvalId)!.status).toBe("expired");
  });

  test("timeout removes it from the pending-approval queue (no action-required)", () => {
    const { rt, run, toolCallId } = mk();
    rt.expireToolCall(run.id, toolCallId);
    const doc = rt.getDoc(run.id)!;
    expect(doc.approvals.filter((a) => a.status === "pending").length).toBe(0);
  });

  test("timeout is visible in the audit log (approval_expired event)", () => {
    const { rt, events, run, toolCallId } = mk();
    rt.expireToolCall(run.id, toolCallId);
    const ev = events.queryByRun(run.id).filter((e) => e.type === "approval_expired");
    expect(ev.length).toBe(1);
    expect((ev[0].data as any).toolName).toBe("terminal");
  });

  test("idempotent: expiring an already-terminal tool call is a safe no-op", () => {
    const { rt, run, toolCallId } = mk();
    rt.expireToolCall(run.id, toolCallId);
    expect(() => rt.expireToolCall(run.id, toolCallId)).not.toThrow();
    expect(rt.getDoc(run.id)!.toolCalls.find((t) => t.id === toolCallId)!.status).toBe("rejected");
  });

  test("REJECTED approvals still behave as before (resolveApproval reject)", () => {
    const { rt, run, toolCallId, approvalId } = mk();
    rt.resolveApproval(run.id, approvalId, "reject", { resolvedBy: "operator" });
    const doc = rt.getDoc(run.id)!;
    expect(doc.approvals.find((a) => a.id === approvalId)!.status).toBe("rejected");
    expect(doc.toolCalls.find((t) => t.id === toolCallId)!.status).toBe("rejected");
  });

  test("APPROVED approvals still execute (resolveApproval approve → record result)", () => {
    const { rt, run, toolCallId, approvalId } = mk();
    rt.resolveApproval(run.id, approvalId, "approve", { resolvedBy: "operator" });
    expect(rt.getDoc(run.id)!.toolCalls.find((t) => t.id === toolCallId)!.status).toBe("approved");
    rt.recordToolResult(run.id, toolCallId, { success: true, output: "uid=0" }, { createEvidence: true });
    expect(rt.getDoc(run.id)!.toolCalls.find((t) => t.id === toolCallId)!.status).toBe("succeeded");
  });
});
