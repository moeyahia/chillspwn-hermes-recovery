import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { AgentRuntime, RuntimeError } from "../AgentRuntime";
import { AgentRunStore } from "../AgentRunStore";
import { EventLog } from "../EventLog";
import { MemoryBoardSink } from "../BoardSink";
import { DEFAULT_POLICY_CONFIG, type PolicyConfig } from "../ToolPolicy";

let dir: string;
let store: AgentRunStore;
let events: EventLog;
let board: MemoryBoardSink;

// Policy where file writes are enabled but approval-gated, and terminal stays disabled.
const APPROVAL_POLICY: PolicyConfig = {
  ...DEFAULT_POLICY_CONFIG,
  enableFileWrite: true,
  requireApprovalForFileWrite: true,
};

const PLAN = {
  steps: [
    { title: "Recon", purpose: "p", successCriteria: "s", allowedTools: ["read_file"] },
    { title: "Write", purpose: "p", successCriteria: "s", allowedTools: ["write_file"] },
  ],
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "chillspwn-p3-"));
  store = new AgentRunStore(dir);
  events = new EventLog({ dir });
  board = new MemoryBoardSink();
});
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

/** Build a runtime, drive it to executing, start both steps' parents, return handles. */
function executing(policy: PolicyConfig) {
  const rt = new AgentRuntime({ store, events, board, policy });
  const run = rt.createRun({ sessionId: "s1", persona: "chillspwn", providerKind: "openrouter", objective: "o" });
  rt.beginPlanning(run.id);
  const { steps } = rt.submitPlan(run.id, PLAN);
  rt.approvePlan(run.id);
  rt.startStep(run.id, steps[0].id); // read-only step
  return { rt, run, steps };
}

describe("ToolPolicy enforcement in /api/runs", () => {
  test("ALLOW: a read-only tool in the step's allowlist", () => {
    const { rt, run, steps } = executing(DEFAULT_POLICY_CONFIG);
    const { decision, toolCall } = rt.requestTool({ runId: run.id, stepId: steps[0].id, toolName: "read_file" });
    expect(decision.action).toBe("allow");
    expect(toolCall.status).toBe("approved");
  });

  test("DENY: a disabled-feature tool (terminal off)", () => {
    const { rt, run, steps } = executing(DEFAULT_POLICY_CONFIG);
    // step[1] allows write_file; with DEFAULT policy file writes are OFF → deny.
    rt.startStep(run.id, steps[1].id); // need it running (deps: step1 has none)
    const { decision, toolCall } = rt.requestTool({ runId: run.id, stepId: steps[1].id, toolName: "write_file" });
    expect(decision.action).toBe("deny");
    expect(toolCall.status).toBe("rejected");
  });

  test("APPROVAL-REQUIRED: an enabled but approval-gated tool creates a pending ApprovalRequest", () => {
    const { rt, run, steps } = executing(APPROVAL_POLICY);
    rt.startStep(run.id, steps[1].id);
    const { decision, toolCall } = rt.requestTool({ runId: run.id, stepId: steps[1].id, toolName: "write_file", command: "echo hi > /tmp/x" });
    expect(decision.action).toBe("require_approval");
    expect(toolCall.status).toBe("awaiting_approval");
    expect(toolCall.approvalId).toBeTruthy();

    const pending = rt.listApprovals(run.id, true);
    expect(pending.length).toBe(1);
    expect(pending[0].toolCallId).toBe(toolCall.id);
    expect(pending[0].riskLevel).toBe("file-write");
    expect(events.queryByRun(run.id).some((e) => e.type === "approval_requested")).toBe(true);
  });
});

describe("approval workflow", () => {
  function pendingApproval() {
    const { rt, run, steps } = executing(APPROVAL_POLICY);
    rt.startStep(run.id, steps[1].id);
    const { toolCall } = rt.requestTool({ runId: run.id, stepId: steps[1].id, toolName: "write_file" });
    const approval = rt.listApprovals(run.id, true)[0];
    return { rt, run, toolCall, approval };
  }

  test("approve flips the approval + the gated tool call to approved, and audits", () => {
    const { rt, run, toolCall, approval } = pendingApproval();
    const out = rt.resolveApproval(run.id, approval.id, "approve", { resolvedBy: "operator" });
    expect(out.approval.status).toBe("approved");
    expect(out.toolCall?.status).toBe("approved");
    const evs = events.queryByRun(run.id).map((e) => e.type);
    expect(evs).toContain("approval_resolved");
    expect(evs).toContain("tool_approved");
    // and now a result can be recorded for the (approved) call
    const r = rt.recordToolResult(run.id, toolCall.id, { success: true, output: "ok" });
    expect(r.output).toBe("ok");
  });

  test("reject flips both to rejected and blocks recording a result", () => {
    const { rt, run, toolCall, approval } = pendingApproval();
    const out = rt.resolveApproval(run.id, approval.id, "reject", { reason: "too risky" });
    expect(out.approval.status).toBe("rejected");
    expect(out.toolCall?.status).toBe("rejected");
    expect(events.queryByRun(run.id).some((e) => e.type === "tool_rejected")).toBe(true);
    expect(() => rt.recordToolResult(run.id, toolCall.id, { success: true })).toThrow(/not approved/);
  });

  test("resolving a non-pending approval throws", () => {
    const { rt, run, approval } = pendingApproval();
    rt.resolveApproval(run.id, approval.id, "approve");
    expect(() => rt.resolveApproval(run.id, approval.id, "approve")).toThrow(RuntimeError);
  });

  test("recording a result for a never-approved tool call is refused", () => {
    const { rt, run, toolCall } = pendingApproval();
    // still awaiting approval → result must be refused
    expect(() => rt.recordToolResult(run.id, toolCall.id, { success: true })).toThrow(/not approved/);
  });
});

describe("normalized ToolResult + evidence linkage", () => {
  test("recordToolResult normalizes partial input", () => {
    const { rt, run, steps } = executing(DEFAULT_POLICY_CONFIG);
    const { toolCall } = rt.requestTool({ runId: run.id, stepId: steps[0].id, toolName: "read_file" });
    const r = rt.recordToolResult(run.id, toolCall.id, { success: false, error: "boom" });
    expect(r).toEqual({ success: false, output: "", artifacts: undefined, evidenceRefs: undefined, error: "boom", suggestedNextStep: undefined });
    expect(rt.getDoc(run.id)?.toolCalls.find((t) => t.id === toolCall.id)?.status).toBe("failed");
  });

  test("createEvidence links ToolResult ↔ EvidenceItem ↔ step ↔ board card", () => {
    const { rt, run, steps } = executing(DEFAULT_POLICY_CONFIG);
    const { toolCall } = rt.requestTool({ runId: run.id, stepId: steps[0].id, toolName: "read_file" });
    const r = rt.recordToolResult(run.id, toolCall.id, { success: true, output: "80/tcp open" }, { createEvidence: true });
    expect(r.evidenceRefs?.length).toBe(1);
    const evId = r.evidenceRefs![0];
    const doc = rt.getDoc(run.id)!;
    expect(doc.evidence.some((e) => e.id === evId && e.sourceToolCallId === toolCall.id)).toBe(true);
    expect(doc.steps[0].evidenceRefs).toContain(evId);
    expect(board.cards.get(steps[0].boardCardId!)?.evidenceRefs).toContain(evId);
  });
});

describe("observe-only classification (live chat) does NOT block or mutate", () => {
  test("classifies + audits enforced=false, creates no tool call, no run needed", () => {
    const rt = new AgentRuntime({ store, events, board, policy: DEFAULT_POLICY_CONFIG });
    const out = rt.observeToolCall({ sessionId: "live-1", toolName: "terminal", command: "nmap 10.0.0.1" });
    expect(out.enforced).toBe(false);
    // terminal disabled in DEFAULT policy ⇒ would deny.
    expect(out.wouldDecide).toBe("deny");
    const evs = events.queryBySession("live-1");
    expect(evs.length).toBe(1);
    expect(evs[0].type).toBe("tool_observed");
    expect(evs[0].data.enforced).toBe(false);
  });

  test("observe never throws even for unknown tools and no run/session", () => {
    const rt = new AgentRuntime({ store, events, board });
    expect(() => rt.observeToolCall({ toolName: "some_unknown_tool" })).not.toThrow();
  });
});

describe("provider turn completion still does not complete the AgentRun", () => {
  test("recordProviderTurn leaves status executing; no run_completed", () => {
    const { rt, run } = executing(DEFAULT_POLICY_CONFIG);
    rt.recordProviderTurn(run.id, "completed");
    expect(rt.getRun(run.id)?.status).toBe("executing");
    expect(events.queryByRun(run.id).some((e) => e.type === "run_completed")).toBe(false);
    expect(events.queryByRun(run.id).some((e) => e.type === "provider_turn_completed")).toBe(true);
  });
});

describe("audit completeness for allow / deny / approval / rejection", () => {
  test("each decision path emits its audit event", () => {
    const { rt, run, steps } = executing(APPROVAL_POLICY);
    rt.requestTool({ runId: run.id, stepId: steps[0].id, toolName: "read_file" }); // allow
    rt.startStep(run.id, steps[1].id);
    const denied = new AgentRuntime({ store, events, board, policy: DEFAULT_POLICY_CONFIG });
    denied.requestTool({ runId: run.id, stepId: steps[1].id, toolName: "write_file" }); // deny (file write off)
    const ap = rt.requestTool({ runId: run.id, stepId: steps[1].id, toolName: "write_file" }); // approval (file write on+gated)
    rt.resolveApproval(run.id, ap.toolCall.approvalId!, "reject", { reason: "no" });

    const types = events.queryByRun(run.id).map((e) => e.type);
    expect(types).toContain("tool_approved");      // allow path
    expect(types).toContain("tool_rejected");      // deny + rejection paths
    expect(types).toContain("approval_requested"); // approval path
    expect(types).toContain("approval_resolved");
  });
});
