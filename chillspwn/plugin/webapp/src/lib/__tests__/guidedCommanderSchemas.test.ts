import { describe, expect, test } from "bun:test";
import {
  parseGuidedCommanderReply,
  parseGuidedMemoryCandidate,
  parseGuidedTranscript,
} from "../../domain/schemas/guidedCommander";

function message(id: string, role: "operator" | "assistant") {
  return {
    id,
    conversationId: "conversation-test",
    missionId: "mission-test",
    runId: "run-test",
    stepId: "step-test",
    role,
    body: "Bounded Guided message",
    structuredContent: { executionPerformed: false },
    contextPackId: role === "assistant" ? "context-test" : null,
    createdAt: "2026-07-15T10:00:00.000Z",
  };
}

describe("Guided Commander client schemas", () => {
  test("accepts the durable transcript and planning-only reply shape", () => {
    const representedStep = {
      id: "step-test",
      planId: "plan-test",
      planVersion: 1,
      phase: "Reconnaissance",
      title: "Inspect the service",
      objective: "Gather evidence",
      status: "waiting_guided_decision",
      assignedAgentId: "agent-test",
      riskClass: "low",
      successCriteria: ["Evidence retained"],
      explanation: "Inspect one service.",
      rationale: "Evidence selects the next branch.",
      reversibility: "Read-only.",
      representedAction: { target: "lab.internal" },
      decisionParameters: { kind: "manual", target: "lab.internal" },
      actionFingerprint: "a".repeat(64),
      guidedDecisionId: "decision-test",
      guidedDecisionStatus: "pending",
    };
    const transcript = parseGuidedTranscript({
      schemaVersion: "2.1",
      mission: {
        id: "mission-test",
        name: "Mission",
        objective: "Objective",
        engagementId: "engagement-test",
        authorizationStatus: "verified",
        scope: { target: "lab.internal" },
      },
      run: {
        id: "run-test",
        status: "waiting_guided_decision",
        currentStepId: "step-test",
        progress: 0,
      },
      currentStep: representedStep,
      currentObservation: {
        evidenceId: "evidence-test",
        contentHash: "c".repeat(64),
        source: "paste",
        mediaType: "text/plain",
        fileName: null,
        byteSize: 9,
        redactionCount: 0,
        interpretationSummary: "The observed marker matches the expected output",
        verificationState: "unverified",
        acquiredAt: "2026-07-15T10:00:00.000Z",
      },
      items: [message("message-operator", "operator"), message("message-assistant", "assistant")],
      nextCursor: null,
    });
    expect(transcript.currentStep?.actionFingerprint).toBe("a".repeat(64));
    expect(transcript.currentStep?.decisionParameters).toEqual({ kind: "manual", target: "lab.internal" });
    expect(transcript.currentObservation?.evidenceId).toBe("evidence-test");
    expect(transcript.items).toHaveLength(2);

    const reply = parseGuidedCommanderReply({
      schemaVersion: "2.1",
      result: {
        action: "explain_more",
        operatorMessage: message("message-operator", "operator"),
        assistantMessage: message("message-assistant", "assistant"),
        contextPackId: "context-test",
        actionFingerprint: "a".repeat(64),
      },
    });
    expect(reply.result.action).toBe("explain_more");
  });

  test("rejects unknown actions and any memory response that skips pending review", () => {
    expect(() => parseGuidedCommanderReply({
      schemaVersion: "2.1",
      result: {
        action: "execute_everything",
        operatorMessage: message("message-operator", "operator"),
        assistantMessage: message("message-assistant", "assistant"),
        contextPackId: "context-test",
        actionFingerprint: "a".repeat(64),
      },
    })).toThrow();
    expect(() => parseGuidedMemoryCandidate({
      schemaVersion: "2.1",
      result: {
        candidateId: "candidate-test",
        status: "confirmed",
        sourceMessageId: "message-test",
      },
    })).toThrow();
  });
});
