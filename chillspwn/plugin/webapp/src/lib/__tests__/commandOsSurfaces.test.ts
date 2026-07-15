import { describe, expect, test } from "bun:test";
import { queryPath } from "../../data/api/operations";
import { parseEvidencePage, parseFindingReview, parseProviderPage } from "../../domain/schemas/operations";
import { parseDecisionMutation, parseDecisions, parseMissionRuntime, parsePlans, parseRunMutation } from "../../domain/schemas/runtimeV2";
import { parseAutonomousMissionPreflight } from "../../domain/schemas/commandOs";

const run = {
  id: "run-1", missionId: "mission-1", missionName: "Authorized mission", objective: "Verify target",
  journey: "guided", status: "waiting_guided_decision", statusReason: "Awaiting exact step", progress: .25,
  nextAction: "Review represented action", currentPlanId: "plan-1", currentStepId: "step-1", currentOwnerId: "recon",
  lastHeartbeatAt: "2026-07-15T12:00:00.000Z", leaseExpiresAt: null, startedAt: "2026-07-15T11:00:00.000Z",
  endedAt: null, createdAt: "2026-07-15T10:00:00.000Z", updatedAt: "2026-07-15T12:00:00.000Z", version: 4,
};

describe("Command OS operational response contracts", () => {
  test("parses a real Autonomous contract digest and selectable context preview", () => {
    const parsed = parseAutonomousMissionPreflight({
      schemaVersion: "2.1",
      contract: { version: 1, hash: "a".repeat(64) },
      readiness: { status: "ready", score: 100, checks: [] },
      context: {
        candidates: [{
          id: "mem-preference", nodeType: "preference", title: "Deep explanations",
          summary: "Explain evidence carefully", lifecycleStatus: "confirmed",
          scope: { kind: "global" }, sensitivity: "private", confidence: 1,
          provenanceExplanation: "Operator confirmed", updatedAt: "2026-07-15T12:00:00.000Z",
        }],
        selectedNodeIds: ["mem-preference"], invalidSelectedNodeIds: [],
      },
      policySummary: {
        provider: "Enforcing only", tools: "Contract allowlist", notifications: "In-app",
        reporting: "Command OS JSON", retention: "Operator managed", storage: "Bounded",
      },
    });
    expect(parsed.contract.hash).toBe("a".repeat(64));
    expect(parsed.context.candidates[0]?.lifecycleStatus).toBe("confirmed");
    expect(() => parseAutonomousMissionPreflight({
      ...parsed,
      contract: { version: 1, hash: "not-a-digest" },
    })).toThrow("hash");
  });

  test("parses scoped evidence pages and rejects incomplete records", () => {
    const parsed = parseEvidencePage({ schemaVersion: "2.1", nextCursor: "next", items: [{
      id: "ev-1", mission: { id: "mission-1", name: "Authorized mission" }, runId: "run-1", stepId: "step-1", actionId: null,
      source: "tool", acquiredAt: "2026-07-15T12:00:00.000Z", target: "10.0.0.1", evidenceType: "service",
      contentHash: "a".repeat(64), provenance: { tool: "nmap" }, confidence: .9, sensitivity: "private",
      verificationState: "verified", summary: "Service confirmed", hasExtractedText: false, artifactId: null,
      createdBy: "recon", createdAt: "2026-07-15T12:00:00.000Z",
    }] });
    expect(parsed.items[0].mission.name).toBe("Authorized mission");
    expect(parsed.nextCursor).toBe("next");
    expect(() => parseEvidencePage({ schemaVersion: "2.1", nextCursor: null, items: [{ id: "ev-bad" }] })).toThrow();
  });

  test("validates provider metrics and review mutation envelopes", () => {
    expect(parseProviderPage({ schemaVersion: "2.1", nextCursor: null, items: [{ id: "p", provider: "grok", model: "expert", status: "operational", turnCount: 3, completedCount: 3, failedCount: 0, meanLatencyMs: 42, inputTokens: 10, outputTokens: 20, estimatedCost: null, lastTurnAt: null }] }).items[0].turnCount).toBe(3);
    expect(parseFindingReview({ schemaVersion: "2.1", finding: { id: "finding-1", reviewStatus: "verified", version: 2, evidenceCount: 1 } }).finding).toBeDefined();
    expect(() => parseProviderPage({ schemaVersion: "1", items: [], nextCursor: null })).toThrow("unsupported");
  });

  test("encodes only supplied URL values without losing special characters", () => {
    expect(queryPath("/api/v2/observability/logs", { query: "provider error", traceId: "trace:1", cursor: undefined })).toBe("/api/v2/observability/logs?query=provider+error&traceId=trace%3A1");
  });
});

describe("Command runtime V2 response contracts", () => {
  test("parses mission, run, plan, and exact Guided decision projections", () => {
    const mission = parseMissionRuntime({ schemaVersion: "2.1", mission: { id: "mission-1", name: "Authorized mission", objective: "Verify target", journey: "guided", engagementId: "eng-1", authorizationStatus: "verified", allowedTargets: ["10.0.0.1"], prohibitedTargets: [], successCriteria: ["Evidence captured"], memoryPolicy: { allowed: true } }, runs: [run] });
    expect(mission.runs[0].status).toBe("waiting_guided_decision");
    const plans = parsePlans({ schemaVersion: "2.1", items: [{ id: "plan-1", runId: "run-1", version: 1, status: "active", strategySummary: "Bounded recon", rationaleSummary: "Establish services", createdAt: "2026-07-15T11:00:00.000Z", activatedAt: "2026-07-15T11:00:01.000Z", steps: [{ id: "step-1", ordinal: 0, phase: "Recon", title: "Map approved service", objective: "Find ports", status: "waiting", assignedAgentId: "recon", riskClass: "low", successCriteria: ["Unique service"], explanation: "Map the approved host", rationale: "Reduce uncertainty", reversibility: "Read-only", action: { actionType: "scan", actionClass: "recon", target: "10.0.0.1", arguments: { ports: "80" }, intentSummary: "Map service", kind: "tool", idempotent: true, destructive: false } }] }] });
    expect(plans.items[0].steps[0].action.target).toBe("10.0.0.1");
    const decisions = parseDecisions({ schemaVersion: "2.1", items: [{ id: "decision-1", missionId: "mission-1", runId: "run-1", stepId: "step-1", status: "pending", actionFingerprint: "f".repeat(64), requestedParameters: { target: "10.0.0.1" }, rationale: "Map service", riskClass: "low", reversibility: "Read-only", expiresAt: "2026-07-15T13:00:00.000Z", createdAt: "2026-07-15T12:00:00.000Z" }] });
    expect(decisions.items[0].requestedParameters).toEqual({ target: "10.0.0.1" });
    expect(parseRunMutation({ schemaVersion: "2.1", run }).status).toBe("waiting_guided_decision");
    expect(parseDecisionMutation({ schemaVersion: "2.1", decisionId: "decision-1", status: "cancelled", run: { ...run, status: "cancelled", endedAt: "2026-07-15T12:10:00.000Z" } }).run?.status).toBe("cancelled");
  });

  test("rejects hidden third journeys and unknown run states", () => {
    expect(() => parseMissionRuntime({ schemaVersion: "2.1", mission: { id: "m", name: "M", objective: "O", journey: "supervised", engagementId: null, authorizationStatus: "verified", allowedTargets: [], prohibitedTargets: [], successCriteria: [], memoryPolicy: {} }, runs: [] })).toThrow("journey");
    expect(() => parseRunMutation({ schemaVersion: "2.1", run: { ...run, status: "waiting_input" } })).toThrow("run status");
  });
});
