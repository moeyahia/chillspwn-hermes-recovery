import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RUNTIME_ENDPOINTS } from "../../data/api/runtimeV2";
import type { GuidedDecision } from "../../domain/types/runtimeV2";
import { DecisionCard } from "../../features/decisions/DecisionsPage";

const decision: GuidedDecision = {
  id: "decision/a b",
  missionId: "mission-1",
  runId: "run-1",
  stepId: "step-1",
  status: "pending",
  actionFingerprint: "a".repeat(64),
  requestedParameters: {
    actionType: "readiness_check",
    kind: "manual",
    target: "127.0.0.1",
    arguments: { path: "/api/v2/health" },
  },
  rationale: "Inspect the exact local readiness endpoint",
  riskClass: "low",
  reversibility: "Read-only",
  expiresAt: "2999-07-16T12:00:00.000Z",
  createdAt: "2026-07-15T12:00:00.000Z",
};

describe("Guided exact-step control presentation", () => {
  test("visibly separates planning-only interpretation from completion and mission stop", () => {
    const markup = renderToStaticMarkup(<DecisionCard decision={decision} onChanged={() => undefined} />);
    expect(markup).toContain("Complete and advance after manual execution");
    expect(markup).toContain("This is not interpretation.");
    expect(markup).toContain("marks the step complete, and advances canonical execution");
    expect(markup).toContain("Complete exact step and advance");
    expect(markup).toContain("Skip this exact step");
    expect(markup).toContain("Creates no action and no evidence.");
    expect(markup).toContain("Skip exact step");
    expect(markup).toContain("Stop this mission");
    expect(markup).toContain("I understand this stops the entire mission, not only this step.");
    expect(markup).toContain("Stop mission");
    expect(markup).not.toContain("Record manual result");
  });

  test("encodes the exact-decision stop endpoint", () => {
    expect(RUNTIME_ENDPOINTS.decision(decision.id, "skip"))
      .toBe("/api/v2/guided-decisions/decision%2Fa%20b/skip");
    expect(RUNTIME_ENDPOINTS.decision(decision.id, "stop"))
      .toBe("/api/v2/guided-decisions/decision%2Fa%20b/stop");
  });
});
