import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { AgentRuntime } from "../AgentRuntime";
import { AgentRunStore } from "../AgentRunStore";
import { EventLog } from "../EventLog";
import { MemoryBoardSink } from "../BoardSink";
import { DEFAULT_POLICY_CONFIG } from "../ToolPolicy";
import type { PlanPreview } from "../types";

let dir: string;
let store: AgentRunStore;
let events: EventLog;
let rt: AgentRuntime;

const PREVIEW: PlanPreview = {
  title: "t", purpose: "p", successCriteria: "s",
  steps: [{ title: "a", purpose: "b", successCriteria: "c", suggestedTools: ["nmap"], riskLevel: "network", dependsOn: [] }],
  riskLevel: "network", suggestedTools: ["nmap"], confidence: 0.6,
  createdAt: new Date(0).toISOString(), source: "preview", generatedBy: "m", enforced: false,
};
const CHAT = { sessionId: "s1", persona: "x", providerKind: "claude" as const, objective: "o" };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "chillspwn-preview-rt-"));
  store = new AgentRunStore(dir);
  events = new EventLog({ dir });
  rt = new AgentRuntime({ store, events, board: new MemoryBoardSink(), policy: DEFAULT_POLICY_CONFIG });
});
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

describe("AgentRuntime plan preview", () => {
  test("setPlanPreview attaches WITHOUT changing mode/status/steps or creating ToolCalls", () => {
    const run = rt.createChatRun(CHAT);
    const updated = rt.setPlanPreview(run.id, PREVIEW);
    expect(updated.planPreview?.steps.length).toBe(1);
    expect(updated.mode).toBe("observe");       // still observe-only
    expect(updated.status).toBe("executing");   // still executing (not managed lifecycle)
    expect(updated.stepIds).toEqual([]);         // NO managed PlanSteps
    expect(rt.getDoc(run.id)?.steps ?? []).toEqual([]);     // doc has no steps
    expect(rt.getDoc(run.id)?.toolCalls ?? []).toEqual([]); // no enforced ToolCalls
    expect(rt.getPlanPreview(run.id)?.enforced).toBe(false);
    expect(events.queryByRun(run.id).some((e) => e.type === "plan_preview_generated")).toBe(true);
  });

  test("setPlanPreview is REJECTED for a managed (non-chat) run", () => {
    const run = rt.createRun(CHAT); // source undefined / mode undefined ⇒ not observe-only chat
    expect(() => rt.setPlanPreview(run.id, PREVIEW)).toThrow();
    expect(rt.getPlanPreview(run.id)).toBeNull();
  });

  test("setPlanPreview throws for an unknown run", () => {
    expect(() => rt.setPlanPreview("run_nope", PREVIEW)).toThrow();
  });

  test("clearPlanPreview removes the preview and emits", () => {
    const run = rt.createChatRun(CHAT);
    rt.setPlanPreview(run.id, PREVIEW);
    rt.clearPlanPreview(run.id);
    expect(rt.getPlanPreview(run.id)).toBeNull();
    expect(events.queryByRun(run.id).some((e) => e.type === "plan_preview_cleared")).toBe(true);
  });

  test("a chat run with no preview loads safely (getPlanPreview → null)", () => {
    const run = rt.createChatRun(CHAT);
    expect(rt.getPlanPreview(run.id)).toBeNull();
    // and the doc round-trips through the store without a planPreview field
    expect(store.getRun(run.id)?.planPreview).toBeUndefined();
  });
});
