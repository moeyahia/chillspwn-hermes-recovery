import { describe, expect, test } from "bun:test";
import { GUIDED_COMMANDER_ENDPOINTS } from "../../data/api/guidedCommander";
import { parseGuidedCommanderReply, parseGuidedTranscript } from "../../domain/schemas/guidedCommander";
import type { GuidedCommanderMessage } from "../../domain/types/guidedCommander";
import {
  GUIDED_TEXT_RESULT_LIMIT,
  mediaTypeForTextFile,
  memoryCandidatesBySource,
  responsePresentation,
  suggestedMemoryTitle,
  utf8ByteSize,
} from "../../features/guided/guidedCommanderUi";

const fingerprint = "a".repeat(64);

function message(overrides: Partial<GuidedCommanderMessage>): GuidedCommanderMessage {
  return {
    id: "msg-1",
    conversationId: "conversation-1",
    missionId: "mission-1",
    runId: "run-1",
    stepId: "step-1",
    role: "assistant",
    body: "Review the bounded result before deciding whether to advance.",
    structuredContent: {},
    contextPackId: null,
    createdAt: "2026-07-15T12:00:00.000Z",
    ...overrides,
  };
}

describe("Guided Commander response contracts", () => {
  test("parses a canonical transcript and rejects hidden journey schema drift", () => {
    const transcript = parseGuidedTranscript({
      schemaVersion: "2.1",
      mission: { id: "mission-1", name: "Local readiness", objective: "Validate health", engagementId: null, authorizationStatus: "verified", scope: { targets: ["127.0.0.1"] } },
      run: { id: "run-1", status: "waiting_guided_decision", currentStepId: "step-1", progress: 0.5 },
      currentStep: {
        id: "step-1", planId: "plan-1", planVersion: 1, phase: "Validation", title: "Inspect readiness",
        objective: "Collect a bounded readiness response", status: "waiting", assignedAgentId: "recon",
        riskClass: "low", successCriteria: ["Response retained"], explanation: "Read the local endpoint",
        rationale: "Establish readiness", reversibility: "Read-only", representedAction: { kind: "manual", target: "127.0.0.1" },
        decisionParameters: { kind: "manual", target: "127.0.0.1" },
        actionFingerprint: fingerprint, guidedDecisionId: "decision-1", guidedDecisionStatus: "pending",
      },
      currentObservation: null,
      items: [message({ structuredContent: { kind: "guided_commander_response" } })],
      nextCursor: null,
    });
    expect(transcript.currentStep?.actionFingerprint).toBe(fingerprint);
    expect(transcript.items[0]?.role).toBe("assistant");
    expect(() => parseGuidedTranscript({ schemaVersion: "1", mission: {}, run: {}, currentStep: null, items: [], nextCursor: null })).toThrow("unsupported");
  });

  test("validates the planning-only reply and bounded ingestion declaration", () => {
    const operator = message({ id: "operator-1", role: "operator", body: "Submitted result" });
    const assistant = message({ id: "assistant-1", contextPackId: "context-1", structuredContent: { executionPerformed: false } });
    const parsed = parseGuidedCommanderReply({
      schemaVersion: "2.1",
      result: { action: "interpret_result", operatorMessage: operator, assistantMessage: assistant, contextPackId: "context-1", evidenceId: "evidence-1", actionFingerprint: fingerprint },
      ingestion: { multipartSupported: false, rawContentRetained: false, acceptedSources: ["paste", "text_upload"] },
    });
    expect(parsed.result.evidenceId).toBe("evidence-1");
    expect(parsed.ingestion?.rawContentRetained).toBeFalse();
    expect(() => parseGuidedCommanderReply({ schemaVersion: "2.1", result: { action: "execute", operatorMessage: operator, assistantMessage: assistant, contextPackId: "context-1", actionFingerprint: fingerprint } })).toThrow("action");
  });

  test("encodes mission identifiers in every Guided Commander route", () => {
    expect(GUIDED_COMMANDER_ENDPOINTS.transcript("mission/a b")).toBe("/api/v2/guided/mission%2Fa%20b/commander/transcript");
    expect(GUIDED_COMMANDER_ENDPOINTS.doNotRemember("mission/a b")).toEndWith("/mission%2Fa%20b/commander/do-not-remember");
  });
});

describe("Guided Commander presentation safeguards", () => {
  test("presents semantic fields without exposing arbitrary structured payloads", () => {
    const result = responsePresentation(message({ structuredContent: {
      kind: "guided_commander_response",
      summary: "Readiness was confirmed",
      confidence: 4,
      observations: ["One unique endpoint responded", 42],
      recommendedNextStep: "Review the exact decision",
      secretInternalField: "must not be surfaced",
    } }));
    expect(result.confidence).toBe(1);
    expect(result.observations).toEqual(["One unique endpoint responded"]);
    expect(result).not.toHaveProperty("secretInternalField");
  });

  test("reconstructs pending and suppressed memory candidates from durable exchanges", () => {
    const messages = [
      message({ id: "request-1", role: "operator", structuredContent: { kind: "guided_memory_request", sourceMessageId: "source-1" } }),
      message({ id: "candidate-1", structuredContent: { kind: "guided_memory_candidate", candidateId: "memory-candidate-1", status: "pending" } }),
      message({ id: "suppression-1", structuredContent: { kind: "guided_memory_suppression", candidateId: "memory-candidate-1", status: "suppressed" } }),
    ];
    expect(memoryCandidatesBySource(messages).get("source-1")).toEqual({ candidateId: "memory-candidate-1", status: "suppressed" });
  });

  test("accepts only bounded supported text formats and counts UTF-8 bytes", () => {
    expect(mediaTypeForTextFile({ name: "result.JSON", type: "" } as File)).toBe("application/json");
    expect(mediaTypeForTextFile({ name: "result.bin", type: "application/octet-stream" } as File)).toBeNull();
    expect(utf8ByteSize("é")).toBe(2);
    expect(GUIDED_TEXT_RESULT_LIMIT).toBe(131_072);
  });

  test("suggests a bounded title from validated semantic summary", () => {
    const title = suggestedMemoryTitle(message({ structuredContent: { summary: "A".repeat(200) } }));
    expect(title.length).toBe(120);
  });
});
