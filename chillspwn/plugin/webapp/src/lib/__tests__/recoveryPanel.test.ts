import { describe, expect, test } from "bun:test";
import { parseRunRecovery } from "../../domain/schemas/operations";

function projection() {
  return {
    schemaVersion: "2.1",
    recoveryRequired: true,
    run: {
      id: "run-1", missionId: "mission-1", missionName: "Authorized lab", journey: "guided", status: "blocked",
      statusReason: "Timeout recovery needs a decision", currentStepId: "step-1", currentOwnerId: "agent-1",
      nextAction: "Review the alternative", leaseExpiresAt: null,
    },
    detection: {
      summary: "Timeout recovery needs a decision", category: "timeout",
      evidence: [{ id: "event-1", eventType: "run.recovery_started", summary: "Recovery started", occurredAt: "2026-07-15T10:00:00.000Z", sequence: 4 }],
      failedActions: [{ id: "action-1", status: "timed_out", intentSummary: "Map service", resultSummary: "Timed out", errorCategory: "timeout", retryCount: 0, endedAt: "2026-07-15T10:00:00.000Z" }],
    },
    checkpoint: {
      id: "checkpoint-1", eventSequence: 4, planVersion: 1, createdAt: "2026-07-15T10:00:00.000Z",
      stateHash: "a".repeat(64), inFlightClassification: "safe_no_in_flight_action", completedActionCount: 2, inFlightActions: [],
    },
    attempts: { retryCount: 1, retryLimit: 2, retriesRemaining: 1, replanCount: 0, replanLimit: 1, replansRemaining: 1 },
    proposedRecovery: {
      kind: "guided_decision", summary: "Review one bounded alternative", basis: "The first action timed out",
      impact: { time: "No execution while stopped", cost: "No additional cost while stopped", scope: "Exact-step boundary remains" },
    },
    guidedDecision: { id: "decision-1", stepId: "step-1", rationale: "Use another approach", riskClass: "low", expiresAt: "2026-07-16T10:00:00.000Z" },
    failedAttemptMemories: [{ kind: "lesson", id: "lesson-1", title: "Avoid identical retry", status: "verified", confidence: 0.9, failureCategory: "timeout" }],
    actions: [
      { kind: "resume", label: "Resume from checkpoint", available: true, reason: "Supported by the runtime", command: "resume" },
      { kind: "replan", label: "Request replan", available: false, reason: "No operator endpoint", command: null },
      { kind: "reassign", label: "Reassign", available: false, reason: "No operator endpoint", command: null },
      { kind: "change_provider", label: "Change provider", available: false, reason: "No operator endpoint", command: null },
      { kind: "terminate", label: "Terminate gracefully", available: true, reason: "Cancellation is supported", command: "cancel" },
    ],
  };
}

describe("Recovery Panel boundary schema", () => {
  test("accepts a canonical journey-aware recovery projection", () => {
    const parsed = parseRunRecovery(projection());
    expect(parsed.proposedRecovery.kind).toBe("guided_decision");
    expect(parsed.checkpoint?.eventSequence).toBe(4);
    expect(parsed.failedAttemptMemories).toMatchObject([{ kind: "lesson", id: "lesson-1" }]);
    expect(parsed.actions.filter((action) => action.available).map((action) => action.command)).toEqual(["resume", "cancel"]);
  });

  test("rejects a backend command that is not explicitly supported", () => {
    const invalid = projection();
    invalid.actions[1] = { ...invalid.actions[1], available: true, command: "replan" as never };
    expect(() => parseRunRecovery(invalid)).toThrow(/command is invalid/);
  });
});
