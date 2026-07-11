import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { AgentRunStore } from "../AgentRunStore";
import { createAgentRun, type PlanStep, type ToolCall, type EvidenceItem } from "../types";

let dir: string;
let store: AgentRunStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "chillspwn-runstore-"));
  store = new AgentRunStore(dir);
});
afterEach(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
});

function aRun() {
  return createAgentRun({ sessionId: "s1", persona: "chillspwn", providerKind: "openrouter", objective: "obj" });
}

describe("AgentRunStore", () => {
  test("create + get round-trips the run", () => {
    const run = aRun();
    store.createRun(run);
    expect(store.getRun(run.id)?.id).toBe(run.id);
    expect(store.getDoc(run.id)?.steps).toEqual([]);
    expect(store.getRun("missing")).toBeNull();
  });

  test("setSteps + updateStep + getStep", () => {
    const run = aRun();
    store.createRun(run);
    const step: PlanStep = {
      id: "step_1", agentRunId: run.id, index: 0, title: "t", purpose: "p",
      successCriteria: "s", allowedTools: [], riskLevel: "read-only", dependencies: [],
      status: "pending", evidenceRefs: [], createdAt: "t", updatedAt: "t",
    };
    store.setSteps(run.id, [step]);
    const updated = store.updateStep(run.id, "step_1", { status: "running" });
    expect(updated?.status).toBe("running");
    expect(store.getStep(run.id, "step_1")?.status).toBe("running");
    expect(store.updateStep(run.id, "nope", { status: "failed" })).toBeNull();
  });

  test("tool calls + evidence accumulate", () => {
    const run = aRun();
    store.createRun(run);
    const tc: ToolCall = {
      id: "tool_1", agentRunId: run.id, stepId: "step_1", toolName: "read_file",
      arguments: {}, riskLevel: "read-only", status: "approved", createdAt: "t",
    };
    store.addToolCall(run.id, tc);
    store.updateToolCall(run.id, "tool_1", { status: "succeeded" });
    expect(store.getDoc(run.id)?.toolCalls[0].status).toBe("succeeded");

    const ev: EvidenceItem = {
      id: "ev_1", agentRunId: run.id, stepId: "step_1", kind: "command_output",
      label: "nmap", createdAt: "t",
    };
    store.addEvidence(run.id, ev);
    expect(store.getDoc(run.id)?.evidence[0].id).toBe("ev_1");
  });

  test("listRuns returns newest first and survives reload", () => {
    const r1 = aRun(); store.createRun(r1);
    const r2 = { ...aRun(), createdAt: "2999-01-01T00:00:00.000Z" };
    store.createRun(r2);
    // A fresh store reading the same dir sees both (persisted to disk).
    const reloaded = new AgentRunStore(dir);
    const ids = reloaded.listRuns().map((r) => r.id);
    expect(ids).toContain(r1.id);
    expect(ids[0]).toBe(r2.id); // newest createdAt first
  });

  test("mutating a missing run throws", () => {
    expect(() => store.saveRun(aRun())).toThrow(/not found/);
  });
});
