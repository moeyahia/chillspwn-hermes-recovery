import { test, expect, describe } from "bun:test";
import { wrapWorkerResult } from "../WorkerContract";

const VALID = { status: "complete", summary: "did the thing", confidence: 0.9, evidence: [], artifacts: [], assumptions: [], recommendedNextSteps: [] };

describe("Phase 9 wrapWorkerResult (free-form fallback)", () => {
  test("valid structured result passes through unwrapped", () => {
    const w = wrapWorkerResult(VALID);
    expect(w.wrapped).toBe(false);
    expect(w.result.summary).toBe("did the thing");
    expect(w.result.confidence).toBe(0.9);
  });

  test("free-form text is wrapped conservatively (low confidence, no claimed evidence)", () => {
    const w = wrapWorkerResult("found 2 open ports, http and https");
    expect(w.wrapped).toBe(true);
    expect(w.result.summary).toContain("open ports");
    expect(w.result.confidence).toBe(0.3);
    expect(w.result.evidence).toEqual([]);
    expect(w.result.proposedAttackChains).toEqual([]);
    expect(w.result.status).toBe("complete");
  });

  test("infers blocked / failed status from text", () => {
    expect(wrapWorkerResult("I was blocked, cannot proceed without creds").result.status).toBe("blocked");
    expect(wrapWorkerResult("the scan failed with an error").result.status).toBe("failed");
  });

  test("invalid structured object (bad confidence) is wrapped, not thrown", () => {
    const w = wrapWorkerResult({ status: "complete", summary: "x", confidence: 5 });
    expect(w.wrapped).toBe(true);
    expect(w.result.summary).toBe("x"); // uses the summary field as the text
    expect(w.result.confidence).toBe(0.3);
  });

  test("honors an explicit valid status when wrapping an otherwise-invalid object", () => {
    const w = wrapWorkerResult({ status: "blocked", summary: "need approval", confidence: "high" });
    expect(w.wrapped).toBe(true);
    expect(w.result.status).toBe("blocked");
  });

  test("never throws on null / weird input", () => {
    expect(() => wrapWorkerResult(null)).not.toThrow();
    expect(() => wrapWorkerResult(42)).not.toThrow();
    expect(wrapWorkerResult(null).wrapped).toBe(true);
  });
});
