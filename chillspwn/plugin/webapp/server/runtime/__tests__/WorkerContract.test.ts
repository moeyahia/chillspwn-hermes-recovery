import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { validateWorkerResult } from "../WorkerContract";
import { AgentRuntime, RuntimeError } from "../AgentRuntime";
import { AgentRunStore } from "../AgentRunStore";
import { EventLog } from "../EventLog";
import { MemoryBoardSink } from "../BoardSink";
import { DEFAULT_POLICY_CONFIG } from "../ToolPolicy";

const goodResult = {
  status: "complete",
  summary: "enumerated the host",
  evidence: [{ kind: "command_output", label: "nmap", content: "80/tcp open" }],
  artifacts: [{ path: "/tmp/scan.xml" }],
  confidence: 0.8,
  assumptions: ["target is in scope"],
  recommendedNextSteps: ["exploit the web app"],
};

describe("validateWorkerResult", () => {
  test("accepts a well-formed result", () => {
    const v = validateWorkerResult(goodResult);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.result.status).toBe("complete");
      expect(v.result.evidence.length).toBe(1);
      expect(v.result.recommendedNextSteps).toEqual(["exploit the web app"]);
    }
  });

  test("rejects a bad status", () => {
    const v = validateWorkerResult({ ...goodResult, status: "kinda-done" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.some((e) => e.includes("status"))).toBe(true);
  });

  test("rejects missing summary and out-of-range confidence", () => {
    expect(validateWorkerResult({ ...goodResult, summary: "" }).ok).toBe(false);
    expect(validateWorkerResult({ ...goodResult, confidence: 5 }).ok).toBe(false);
  });

  test("rejects non-object / wrong-typed fields", () => {
    expect(validateWorkerResult("nope").ok).toBe(false);
    expect(validateWorkerResult({ ...goodResult, assumptions: "not-an-array" }).ok).toBe(false);
    expect(validateWorkerResult({ ...goodResult, evidence: [{ kind: "x" }] }).ok).toBe(false); // missing label
  });

  test("defaults optional arrays", () => {
    const v = validateWorkerResult({ status: "blocked", summary: "stuck", confidence: 0.2 });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.result.assumptions).toEqual([]);
      expect(v.result.evidence).toEqual([]);
      expect(v.result.artifacts).toEqual([]);
      expect(v.result.proposedAttackChains).toEqual([]);
    }
  });

  test("preserves structured box-agnostic attack-chain proposals and rejects scalar entries", () => {
    const chain = {
      title: "Relay coerced authentication into certificate enrollment",
      techniqueName: "Coercion relay chain",
      techniqueCategory: "active_directory",
      summary: "Relay a coerced machine authentication to an eligible enrollment endpoint.",
      stepsThatWorked: ["coerce <DOMAIN_CONTROLLER>", "relay to <ENROLLMENT_ENDPOINT>"],
      references: ["https://github.com/fortra/impacket"],
    };
    const good = validateWorkerResult({ ...goodResult, proposedAttackChains: [chain] });
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.result.proposedAttackChains).toEqual([chain]);
    expect(validateWorkerResult({ ...goodResult, proposedAttackChains: ["not-an-object"] }).ok).toBe(false);
  });

  describe("evidence.kind must be a valid EvidenceKind (Phase 4.1)", () => {
    const base = { status: "complete", summary: "s", confidence: 0.5 };
    const withEvidence = (e: any) => validateWorkerResult({ ...base, evidence: [e] });

    test("valid kinds are accepted", () => {
      for (const kind of ["command_output", "file", "screenshot", "http_response", "finding", "artifact"]) {
        expect(withEvidence({ kind, label: "x" }).ok).toBe(true);
      }
    });
    test("an arbitrary non-empty string kind is rejected", () => {
      const v = withEvidence({ kind: "totally_made_up", label: "x" });
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.errors.some((e) => e.includes("kind must be one of"))).toBe(true);
    });
    test("missing kind is rejected", () => {
      expect(withEvidence({ label: "x" }).ok).toBe(false);
    });
    test("empty kind is rejected", () => {
      expect(withEvidence({ kind: "", label: "x" }).ok).toBe(false);
    });
  });
});

describe("AgentRuntime.recordWorkerResult", () => {
  let dir: string, store: AgentRunStore, events: EventLog, board: MemoryBoardSink;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "chillspwn-worker-"));
    store = new AgentRunStore(dir);
    events = new EventLog({ dir });
    board = new MemoryBoardSink();
  });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  function runWithStep() {
    const rt = new AgentRuntime({ store, events, board, policy: DEFAULT_POLICY_CONFIG });
    const run = rt.createRun({ sessionId: "s", persona: "chillspwn", providerKind: "openrouter", objective: "o" });
    rt.beginPlanning(run.id);
    const { steps } = rt.submitPlan(run.id, { steps: [{ title: "R", purpose: "p", successCriteria: "s", allowedTools: [] }] });
    rt.approvePlan(run.id);
    rt.startStep(run.id, steps[0].id);
    return { rt, run, steps };
  }

  test("a valid worker result is stored and its evidence folded into the run/step", () => {
    const { rt, run, steps } = runWithStep();
    const out = rt.recordWorkerResult(run.id, steps[0].id, goodResult);
    expect(out.result.status).toBe("complete");
    expect(out.evidenceIds.length).toBe(1);
    const doc = rt.getDoc(run.id)!;
    expect(doc.workerResults.length).toBe(1);
    expect(doc.workerResults[0].stepId).toBe(steps[0].id);
    // worker evidence became run evidence linked to the step + board card
    expect(doc.evidence.some((e) => e.id === out.evidenceIds[0])).toBe(true);
    expect(doc.steps[0].evidenceRefs).toContain(out.evidenceIds[0]);
    expect(events.queryByRun(run.id).some((e) => e.type === "worker_result_recorded")).toBe(true);
  });

  test("an invalid worker result is rejected", () => {
    const { rt, run, steps } = runWithStep();
    expect(() => rt.recordWorkerResult(run.id, steps[0].id, { status: "nope", summary: "x", confidence: 0.5 })).toThrow(/invalid worker result/);
  });

  test("a worker result for an unknown step is rejected", () => {
    const { rt, run } = runWithStep();
    expect(() => rt.recordWorkerResult(run.id, "step_nope", goodResult)).toThrow(/step not found/);
  });

  test("recordWorkerResult PERSISTS the generated evidenceIds, matching the return (Phase 4.1)", () => {
    const { rt, run, steps } = runWithStep();
    const out = rt.recordWorkerResult(run.id, steps[0].id, goodResult);
    const stored = rt.getDoc(run.id)!.workerResults[0];
    expect(stored.evidenceIds.length).toBe(1);
    expect(stored.evidenceIds).toEqual(out.evidenceIds); // stored == returned
    // and the ids are real run-owned evidence
    expect(rt.getDoc(run.id)!.evidence.some((e) => e.id === stored.evidenceIds[0])).toBe(true);
  });

  test("an OLD workerResults record without evidenceIds loads safely as []", () => {
    const { run } = runWithStep();
    // Simulate a pre-Phase-4.1 doc by writing a worker-result record with no evidenceIds.
    const docPath = join(dir, "runs", `${run.id}.json`);
    const raw = JSON.parse(readFileSync(docPath, "utf-8"));
    raw.workerResults = [{ stepId: null, result: { status: "complete", summary: "old", evidence: [], artifacts: [], confidence: 0.5, assumptions: [], recommendedNextSteps: [] }, recordedAt: "2026-01-01T00:00:00.000Z" }];
    writeFileSync(docPath, JSON.stringify(raw));
    // A fresh store reading it must normalize evidenceIds to [].
    const reloaded = new AgentRunStore(dir).getDoc(run.id)!;
    expect(reloaded.workerResults[0].evidenceIds).toEqual([]);
  });
});
