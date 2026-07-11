import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { AgentRuntime, RuntimeError } from "../AgentRuntime";
import { AgentRunStore } from "../AgentRunStore";
import { EventLog } from "../EventLog";
import { MemoryBoardSink } from "../BoardSink";
import { DEFAULT_POLICY_CONFIG, type PolicyConfig } from "../ToolPolicy";
import { normalizeToolResult, MAX_INLINE_OUTPUT } from "../types";

let dir: string;
let store: AgentRunStore;
let events: EventLog;
let board: MemoryBoardSink;

const APPROVAL_POLICY: PolicyConfig = { ...DEFAULT_POLICY_CONFIG, enableFileWrite: true, requireApprovalForFileWrite: true };

const PLAN = {
  steps: [
    { title: "Recon", purpose: "p", successCriteria: "s", allowedTools: ["read_file"] },
    { title: "More", purpose: "p", successCriteria: "s", allowedTools: ["read_file", "write_file"] },
  ],
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "chillspwn-p31-"));
  store = new AgentRunStore(dir);
  events = new EventLog({ dir });
  board = new MemoryBoardSink();
});
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

function rt(policy: PolicyConfig = DEFAULT_POLICY_CONFIG) {
  return new AgentRuntime({ store, events, board, policy });
}
function freshRun(r: AgentRuntime) {
  return r.createRun({ sessionId: "s", persona: "chillspwn", providerKind: "openrouter", objective: "o" });
}

describe("Phase 3.1 — run/step lifecycle enforced before a tool call is allowed", () => {
  test("rejected before plan approval (run not executing: created/planning/awaiting)", () => {
    const r = rt();
    const run = freshRun(r);
    // status 'created' → reject
    let res = r.requestTool({ runId: run.id, stepId: "x", toolName: "read_file" });
    expect(res.decision.action).toBe("deny");
    expect(res.decision.reason).toMatch(/executing/);

    r.beginPlanning(run.id);
    const { steps } = r.submitPlan(run.id, PLAN); // status awaiting_plan_approval
    res = r.requestTool({ runId: run.id, stepId: steps[0].id, toolName: "read_file" });
    expect(res.decision.action).toBe("deny");
    expect(res.decision.reason).toMatch(/executing/);
  });

  test("rejected after approval but before the step is started (step pending)", () => {
    const r = rt();
    const run = freshRun(r);
    r.beginPlanning(run.id);
    const { steps } = r.submitPlan(run.id, PLAN);
    r.approvePlan(run.id); // executing, but no step started → step[0] is 'pending'
    const res = r.requestTool({ runId: run.id, stepId: steps[0].id, toolName: "read_file" });
    expect(res.decision.action).toBe("deny");
    expect(res.decision.reason).toMatch(/'pending'.*running|must be 'running'/);
  });

  test("rejected for a completed step", () => {
    const r = rt();
    const run = freshRun(r);
    r.beginPlanning(run.id);
    const { steps } = r.submitPlan(run.id, PLAN);
    r.approvePlan(run.id);
    r.startStep(run.id, steps[0].id);
    r.completeStep(run.id, steps[0].id, "done");
    const res = r.requestTool({ runId: run.id, stepId: steps[0].id, toolName: "read_file" });
    expect(res.decision.action).toBe("deny");
    expect(res.decision.reason).toMatch(/'completed'/);
  });

  test("rejected for a failed step and a blocked step", () => {
    const r = rt();
    const run = freshRun(r);
    r.beginPlanning(run.id);
    const { steps } = r.submitPlan(run.id, PLAN);
    r.approvePlan(run.id);
    r.startStep(run.id, steps[0].id);
    r.failStep(run.id, steps[0].id, "boom");
    expect(r.requestTool({ runId: run.id, stepId: steps[0].id, toolName: "read_file" }).decision.action).toBe("deny");

    r.startStep(run.id, steps[1].id);
    r.blockStep(run.id, steps[1].id, "waiting");
    const res = r.requestTool({ runId: run.id, stepId: steps[1].id, toolName: "read_file" });
    expect(res.decision.action).toBe("deny");
    expect(res.decision.reason).toMatch(/'blocked'/);
  });

  test("ALLOWED only when the step is running and policy allows", () => {
    const r = rt();
    const run = freshRun(r);
    r.beginPlanning(run.id);
    const { steps } = r.submitPlan(run.id, PLAN);
    r.approvePlan(run.id);
    r.startStep(run.id, steps[0].id);
    const res = r.requestTool({ runId: run.id, stepId: steps[0].id, toolName: "read_file" });
    expect(res.decision.action).toBe("allow");
    expect(res.toolCall.status).toBe("approved");
  });

  test("approval-required tool creates an approval ONLY when the step is running", () => {
    const r = rt(APPROVAL_POLICY);
    const run = freshRun(r);
    r.beginPlanning(run.id);
    const { steps } = r.submitPlan(run.id, PLAN);
    r.approvePlan(run.id);
    // before start → no approval, just a rejection
    expect(r.requestTool({ runId: run.id, stepId: steps[1].id, toolName: "write_file" }).decision.action).toBe("deny");
    expect(r.listApprovals(run.id).length).toBe(0);
    // after start → approval created
    r.startStep(run.id, steps[1].id);
    const res = r.requestTool({ runId: run.id, stepId: steps[1].id, toolName: "write_file" });
    expect(res.decision.action).toBe("require_approval");
    expect(r.listApprovals(run.id, true).length).toBe(1);
  });
});

describe("Phase 3.1 — evidence step linkage", () => {
  function running() {
    const r = rt();
    const run = freshRun(r);
    r.beginPlanning(run.id);
    const { steps } = r.submitPlan(run.id, PLAN);
    r.approvePlan(run.id);
    r.startStep(run.id, steps[0].id);
    return { r, run, steps };
  }
  test("valid stepId links evidence to the step", () => {
    const { r, run, steps } = running();
    const ev = r.recordEvidence({ runId: run.id, stepId: steps[0].id, kind: "finding", label: "x" });
    expect(r.getDoc(run.id)?.steps[0].evidenceRefs).toContain(ev.id);
  });
  test("invalid stepId is rejected", () => {
    const { r, run } = running();
    expect(() => r.recordEvidence({ runId: run.id, stepId: "step_nope", kind: "finding", label: "x" })).toThrow(/step not found/);
  });
  test("null stepId is allowed (run-level evidence)", () => {
    const { r, run } = running();
    expect(() => r.recordEvidence({ runId: run.id, stepId: null, kind: "finding", label: "run-level" })).not.toThrow();
  });
});

describe("Phase 3.1 — tool result hardening", () => {
  function approvedCall() {
    const r = rt();
    const run = freshRun(r);
    r.beginPlanning(run.id);
    const { steps } = r.submitPlan(run.id, PLAN);
    r.approvePlan(run.id);
    r.startStep(run.id, steps[0].id);
    const { toolCall } = r.requestTool({ runId: run.id, stepId: steps[0].id, toolName: "read_file" });
    return { r, run, steps, toolCall };
  }

  test("result rejected if the tool call does not belong to the run", () => {
    const { r, run } = approvedCall();
    expect(() => r.recordToolResult(run.id, "tool_not_in_run", { success: true })).toThrow(/not found in this run/);
  });

  test("result rejected if the related step is terminal (late result)", () => {
    const { r, run, steps, toolCall } = approvedCall();
    r.completeStep(run.id, steps[0].id, "done"); // step now terminal
    expect(() => r.recordToolResult(run.id, toolCall.id, { success: true, output: "late" })).toThrow(/terminal.*late result/);
  });

  test("result accepted while the step is still running", () => {
    const { r, run, toolCall } = approvedCall();
    const res = r.recordToolResult(run.id, toolCall.id, { success: true, output: "ok" });
    expect(res.output).toBe("ok");
  });
});

describe("Phase 3.1 — listApprovals on a missing run errors", () => {
  test("throws instead of returning an empty list", () => {
    expect(() => rt().listApprovals("run_does_not_exist")).toThrow(RuntimeError);
  });
});

describe("Phase 3.1 — output-size guard", () => {
  test("output over the cap is truncated with a marker", () => {
    const big = "A".repeat(MAX_INLINE_OUTPUT + 5000);
    const r = normalizeToolResult({ success: true, output: big });
    expect(r.output.length).toBeLessThan(big.length);
    expect(r.output).toContain("truncated");
    expect(r.output.startsWith("A".repeat(100))).toBe(true);
  });
  test("output under the cap is unchanged", () => {
    expect(normalizeToolResult({ success: true, output: "short" }).output).toBe("short");
  });
});
