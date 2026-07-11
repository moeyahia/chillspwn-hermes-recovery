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

function makeRuntime(policy: PolicyConfig = DEFAULT_POLICY_CONFIG) {
  return new AgentRuntime({ store, events, board, policy });
}

const PLAN = {
  summary: "two-step plan",
  steps: [
    { title: "Recon", purpose: "enumerate", successCriteria: "ports found", allowedTools: ["read_file"] },
    { title: "Exploit", purpose: "shell", successCriteria: "shell", allowedTools: ["terminal"], dependsOn: [0] },
  ],
};

function newRun(rt: AgentRuntime) {
  return rt.createRun({ sessionId: "s1", persona: "chillspwn", providerKind: "openrouter", objective: "own the box" });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "chillspwn-runtime-"));
  store = new AgentRunStore(dir);
  events = new EventLog({ dir });
  board = new MemoryBoardSink();
});
afterEach(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
});

describe("AgentRun lifecycle", () => {
  test("createRun starts in 'created' and logs run_created", () => {
    const rt = makeRuntime();
    const run = newRun(rt);
    expect(run.status).toBe("created");
    expect(events.queryByRun(run.id).some((e) => e.type === "run_created")).toBe(true);
  });

  test("plan → steps → board cards → awaiting_plan_approval", () => {
    const rt = makeRuntime();
    const run = newRun(rt);
    rt.beginPlanning(run.id);
    const { run: after, steps } = rt.submitPlan(run.id, PLAN);

    expect(after.status).toBe("awaiting_plan_approval");
    expect(steps.length).toBe(2);
    expect(after.stepIds.length).toBe(2);
    // Runtime-owned board: one card per step, each linked back to its step.
    expect(board.cards.size).toBe(2);
    expect(steps.every((s) => !!s.boardCardId)).toBe(true);
    expect(events.queryByRun(run.id).some((e) => e.type === "plan_generated")).toBe(true);
  });

  test("an invalid plan is rejected and the run stays in 'planning'", () => {
    const rt = makeRuntime();
    const run = newRun(rt);
    rt.beginPlanning(run.id);
    expect(() => rt.submitPlan(run.id, { steps: [] })).toThrow(RuntimeError);
    expect(rt.getRun(run.id)?.status).toBe("planning");
    expect(board.cards.size).toBe(0);
  });

  test("approve → execute → run a step → board card goes running", () => {
    const rt = makeRuntime();
    const run = newRun(rt);
    rt.beginPlanning(run.id);
    const { steps } = rt.submitPlan(run.id, PLAN);
    rt.approvePlan(run.id);
    expect(rt.getRun(run.id)?.status).toBe("executing");

    const started = rt.startStep(run.id, steps[0].id);
    expect(started.status).toBe("running");
    const cardId = steps[0].boardCardId!;
    expect(board.cards.get(cardId)?.status).toBe("running");
  });

  test("a step cannot start before its dependencies complete", () => {
    const rt = makeRuntime();
    const run = newRun(rt);
    rt.beginPlanning(run.id);
    const { steps } = rt.submitPlan(run.id, PLAN);
    rt.approvePlan(run.id);
    // step[1] depends on step[0], which is still pending.
    expect(() => rt.startStep(run.id, steps[1].id)).toThrow(/unmet dependencies/);
  });

  test("illegal lifecycle transitions throw", () => {
    const rt = makeRuntime();
    const run = newRun(rt);
    // completeRun from 'created' is illegal (and there are no steps yet).
    expect(() => rt.completeRun(run.id, "done")).toThrow();
    // approvePlan before a plan exists is illegal.
    expect(() => rt.approvePlan(run.id)).toThrow(RuntimeError);
  });
});

describe("step-bound tool execution", () => {
  function runToExecuting() {
    const rt = makeRuntime();
    const run = newRun(rt);
    rt.beginPlanning(run.id);
    const { steps } = rt.submitPlan(run.id, PLAN);
    rt.approvePlan(run.id);
    rt.startStep(run.id, steps[0].id);
    return { rt, run, steps };
  }

  test("REJECTS a tool call with no stepId (step binding)", () => {
    const { rt, run } = runToExecuting();
    const { decision, toolCall } = rt.requestTool({ runId: run.id, stepId: null, toolName: "read_file" });
    expect(decision.action).toBe("deny");
    expect(decision.reason).toMatch(/stepId/);
    expect(toolCall.status).toBe("rejected");
    expect(events.queryByRun(run.id).some((e) => e.type === "tool_rejected")).toBe(true);
  });

  test("REJECTS a tool not in the step's allowedTools", () => {
    const { rt, run, steps } = runToExecuting();
    // step[0] allows only read_file; ask for terminal.
    const { decision } = rt.requestTool({ runId: run.id, stepId: steps[0].id, toolName: "terminal" });
    expect(decision.action).toBe("deny");
    expect(decision.reason).toMatch(/allowed tools/);
  });

  test("ALLOWS a read-only tool that is in the step's allowedTools", () => {
    const { rt, run, steps } = runToExecuting();
    const { decision, toolCall } = rt.requestTool({ runId: run.id, stepId: steps[0].id, toolName: "read_file" });
    expect(decision.action).toBe("allow");
    expect(toolCall.status).toBe("approved");
    expect(toolCall.stepId).toBe(steps[0].id);
  });

  test("a stepId that does not resolve to a real step is rejected", () => {
    const { rt, run } = runToExecuting();
    const { decision } = rt.requestTool({ runId: run.id, stepId: "step_does_not_exist", toolName: "read_file" });
    expect(decision.action).toBe("deny");
    expect(decision.reason).toMatch(/step not found/);
  });

  test("recordToolResult normalizes and stores the outcome", () => {
    const { rt, run, steps } = runToExecuting();
    const { toolCall } = rt.requestTool({ runId: run.id, stepId: steps[0].id, toolName: "read_file" });
    const result = rt.recordToolResult(run.id, toolCall.id, { success: true, output: "uid=0" });
    expect(result.output).toBe("uid=0");
    expect(rt.getDoc(run.id)?.toolCalls[0].status).toBe("succeeded");
  });
});

describe("evidence + step completion", () => {
  test("evidence links to the step and the board card", () => {
    const rt = makeRuntime();
    const run = newRun(rt);
    rt.beginPlanning(run.id);
    const { steps } = rt.submitPlan(run.id, PLAN);
    rt.approvePlan(run.id);
    rt.startStep(run.id, steps[0].id);

    const ev = rt.recordEvidence({
      runId: run.id, stepId: steps[0].id, kind: "command_output", label: "nmap output", content: "80/tcp open",
    });
    expect(rt.getDoc(run.id)?.steps[0].evidenceRefs).toContain(ev.id);
    expect(board.cards.get(steps[0].boardCardId!)?.evidenceRefs).toContain(ev.id);

    const done = rt.completeStep(run.id, steps[0].id, "recon complete");
    expect(done.status).toBe("completed");
    expect(board.cards.get(steps[0].boardCardId!)?.status).toBe("completed");
  });
});

describe("provider turn vs run completion (must stay distinct)", () => {
  test("recordProviderTurn never completes the run", () => {
    const rt = makeRuntime();
    const run = newRun(rt);
    rt.beginPlanning(run.id);
    const { steps } = rt.submitPlan(run.id, PLAN);
    rt.approvePlan(run.id);
    rt.startStep(run.id, steps[0].id);

    rt.recordProviderTurn(run.id, "completed", { endReason: "completed" });
    // The run is still executing — a provider turn ending is NOT run completion.
    expect(rt.getRun(run.id)?.status).toBe("executing");
    const evs = events.queryByRun(run.id);
    expect(evs.some((e) => e.type === "provider_turn_completed")).toBe(true);
    expect(evs.some((e) => e.type === "run_completed")).toBe(false);
  });

  test("completeRun is blocked until all steps are terminal, then succeeds", () => {
    const rt = makeRuntime();
    const run = newRun(rt);
    rt.beginPlanning(run.id);
    const { steps } = rt.submitPlan(run.id, PLAN);
    rt.approvePlan(run.id);

    rt.startStep(run.id, steps[0].id);
    rt.completeStep(run.id, steps[0].id, "done");
    // step[1] still pending → completeRun must refuse.
    expect(() => rt.completeRun(run.id, "report")).toThrow(/not terminal/);

    rt.startStep(run.id, steps[1].id);
    rt.completeStep(run.id, steps[1].id, "done");
    const finished = rt.completeRun(run.id, "final report");
    expect(finished.status).toBe("completed");
    expect(finished.finalReport).toBe("final report");
    expect(events.queryByRun(run.id).some((e) => e.type === "run_completed")).toBe(true);
  });
});
