import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { AgentRuntime } from "../AgentRuntime";
import { AgentRunStore } from "../AgentRunStore";
import { EventLog } from "../EventLog";
import { MemoryBoardSink } from "../BoardSink";
import { DEFAULT_POLICY_CONFIG } from "../ToolPolicy";

let dir: string;
let store: AgentRunStore;
let events: EventLog;
let board: MemoryBoardSink;
let rt: AgentRuntime;

const INPUT = { sessionId: "managed-1", persona: "managed", providerKind: "claude" as const, objective: "enumerate host" };
const PLAN = {
  summary: "recon",
  steps: [
    { title: "Recon", purpose: "p", successCriteria: "ports listed", allowedTools: ["read_file"] },
    { title: "Report", purpose: "p", successCriteria: "report drafted", allowedTools: [], dependsOn: [0] },
  ],
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "chillspwn-managed-"));
  store = new AgentRunStore(dir);
  events = new EventLog({ dir });
  board = new MemoryBoardSink();
  rt = new AgentRuntime({ store, events, board, policy: DEFAULT_POLICY_CONFIG });
});
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

describe("managed chat run lifecycle (Phase 7.4)", () => {
  test("createManagedChatRun → source=chat, mode=managed, status=created, no steps", () => {
    const run = rt.createManagedChatRun(INPUT);
    expect(run.source).toBe("chat");
    expect(run.mode).toBe("managed");
    expect(run.status).toBe("created");
    expect(run.stepIds).toEqual([]);
    expect(store.getRun(run.id)?.mode).toBe("managed");
  });

  test("is DISTINCT from the observe-only createChatRun", () => {
    const obs = rt.createChatRun(INPUT);
    expect(obs.mode).toBe("observe");
    expect(obs.status).toBe("executing");
  });

  test("beginPlanning + submitPlan → awaiting_plan_approval with REAL PlanSteps + board cards", () => {
    const run = rt.createManagedChatRun(INPUT);
    rt.beginPlanning(run.id);
    const { run: r2, steps } = rt.submitPlan(run.id, PLAN);
    expect(r2.status).toBe("awaiting_plan_approval");
    expect(steps.length).toBe(2);
    expect(steps[0].id).toBeTruthy(); // real PlanStep with an id
    expect(steps[0].status).toBe("pending");
    expect(steps[1].dependencies.length).toBe(1); // dependsOn resolved to a real step id
    expect(r2.stepIds.length).toBe(2);
    expect(board.cards.size).toBe(2); // one runtime-owned board card per step
  });

  test("approvePlan → executing (next lifecycle state; no execution happens in 7.4)", () => {
    const run = rt.createManagedChatRun(INPUT);
    rt.beginPlanning(run.id);
    rt.submitPlan(run.id, PLAN);
    expect(rt.approvePlan(run.id).status).toBe("executing");
  });

  test("rejectPlan → planning", () => {
    const run = rt.createManagedChatRun(INPUT);
    rt.beginPlanning(run.id);
    rt.submitPlan(run.id, PLAN);
    expect(rt.rejectPlan(run.id, "no good").status).toBe("planning");
  });

  test("submitPlan REJECTS an invalid managed plan (strict, no coercion)", () => {
    const run = rt.createManagedChatRun(INPUT);
    rt.beginPlanning(run.id);
    // step 0 depends on itself → strict validator rejects
    expect(() => rt.submitPlan(run.id, { steps: [{ title: "a", purpose: "p", successCriteria: "c", dependsOn: [0] }] })).toThrow();
  });
});

describe("managed observed execution (Phase 7.5)", () => {
  function approvedManaged() {
    const run = rt.createManagedChatRun(INPUT);
    rt.beginPlanning(run.id);
    const { steps } = rt.submitPlan(run.id, PLAN);
    rt.approvePlan(run.id); // → executing
    return { run, steps };
  }

  test("getActiveStepId reflects the running step", () => {
    const { run, steps } = approvedManaged();
    expect(rt.getActiveStepId(run.id)).toBeNull(); // nothing running yet
    rt.startStep(run.id, steps[0].id);
    expect(rt.getActiveStepId(run.id)).toBe(steps[0].id);
  });

  test("Phase 7.5.1: startFirstPendingStep auto-starts step 0 when none is running", () => {
    const { run, steps } = approvedManaged();
    expect(rt.getActiveStepId(run.id)).toBeNull();
    expect(rt.startFirstPendingStep(run.id)).toBe(steps[0].id);
    expect(rt.getActiveStepId(run.id)).toBe(steps[0].id);
  });

  test("Phase 7.5.1: startFirstPendingStep returns the already-running step (no double start)", () => {
    const { run, steps } = approvedManaged();
    rt.startStep(run.id, steps[0].id);
    expect(rt.startFirstPendingStep(run.id)).toBe(steps[0].id);
  });

  test("Phase 7.5.1: startFirstPendingStep does NOT auto-complete (step stays running)", () => {
    const { run } = approvedManaged();
    rt.startFirstPendingStep(run.id);
    expect(rt.getDoc(run.id)!.steps[0].status).toBe("running");
  });

  test("markObservedExecution sets metadata (drives the cockpit 'running' state)", () => {
    const { run } = approvedManaged();
    expect(rt.getRun(run.id)?.metadata?.observedExecutionStartedAt).toBeUndefined();
    rt.markObservedExecution(run.id);
    expect(rt.getRun(run.id)?.metadata?.observedExecutionStartedAt).toBeTruthy();
  });

  test("recordObservedEvidence links observe-only evidence to the active step — NO enforced ToolCall", () => {
    const { run, steps } = approvedManaged();
    rt.startStep(run.id, steps[0].id);
    rt.recordObservedEvidence({ runId: run.id, sessionId: "s", stepId: steps[0].id, output: "PORT 80 open\n80/tcp open http" });
    const doc = rt.getDoc(run.id)!;
    expect(doc.evidence.length).toBe(1);
    expect(doc.evidence[0].stepId).toBe(steps[0].id);
    expect(doc.evidence[0].label).toContain("observe-only");
    expect(doc.toolCalls.length).toBe(0); // observe-only → no enforced ToolCall ever
  });

  test("recordObservedEvidence is best-effort: never throws on a bad/missing run or step", () => {
    expect(() => rt.recordObservedEvidence({ runId: "run_nope", sessionId: "s", stepId: "x", output: "y" })).not.toThrow();
    const { run } = approvedManaged();
    // stepId that doesn't exist → recorded at run level, no throw
    expect(() => rt.recordObservedEvidence({ runId: run.id, sessionId: "s", stepId: "step_nope", output: "z" })).not.toThrow();
  });
});
