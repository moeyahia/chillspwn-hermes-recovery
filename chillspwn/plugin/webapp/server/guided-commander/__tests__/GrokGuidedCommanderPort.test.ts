import { describe, expect, test } from "bun:test";
import { GrokGuidedCommanderPort } from "../GrokGuidedCommanderPort";
import type { GuidedCommanderPortInput } from "../types";

function input(): GuidedCommanderPortInput {
  return {
    action: "explain_more",
    mission: {
      id: "mission-test",
      name: "Authorized mission",
      objective: "Explain the retained evidence",
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
    step: {
      id: "step-test",
      planId: "plan-test",
      planVersion: 1,
      phase: "Reconnaissance",
      title: "Inspect the service",
      objective: "Identify the service",
      status: "waiting_guided_decision",
      assignedAgentId: "agent-recon",
      riskClass: "low",
      successCriteria: ["Evidence retained"],
      explanation: "Inspect one approved service.",
      rationale: "The evidence selects the next branch.",
      reversibility: "Read-only.",
      representedAction: { actionType: "service_banner", target: "lab.internal" },
      actionFingerprint: "a".repeat(64),
      guidedDecisionId: "decision-test",
      guidedDecisionStatus: "pending",
    },
    recentTranscript: [],
    memoryContext: [{
      id: "memory-test",
      nodeType: "preference",
      title: "Concise explanations",
      summary: "Prefer concise evidence-led explanations",
      body: "Explain why the evidence matters.",
      scope: { kind: "global" },
      confidence: 1,
      lifecycleStatus: "confirmed",
    }],
    presentationPreferences: [{
      nodeId: "memory-test",
      directive: "Concise explanations — Prefer concise evidence-led explanations",
      scope: { kind: "global" },
      confidence: 1,
    }],
    constraints: {
      executeTools: false,
      mutatePlan: false,
      revealPrivateReasoning: false,
      consequentialNextStepRequiresOperatorDecision: true,
    },
  };
}

describe("Grok Guided Commander planning-only port", () => {
  test("sends a tool-less JSON contract and accepts only the declared response schema", async () => {
    let captured = "";
    const port = new GrokGuidedCommanderPort({
      callGrok: async (prompt) => {
        captured = prompt;
        return JSON.stringify({
          body: "The represented step is read-only and remains waiting for your deliberate decision.",
          summary: "Explained the represented step",
          confidence: 0.9,
          observations: ["No execution occurred"],
          recommendedNextStep: "Review the current action card.",
          contextUse: [{
            nodeId: "memory-test",
            used: true,
            relevanceReason: "Confirmed Guided explanation preference",
            influenceSummary: "Kept the explanation concise",
          }],
        });
      },
    });
    const base = input();
    const unsafeContext: GuidedCommanderPortInput = {
      ...base,
      memoryContext: [{
        ...base.memoryContext[0]!,
        body: "password=must-not-reach-provider",
      }],
    };
    const result = await port.respond(unsafeContext, new AbortController().signal);
    expect(result).toMatchObject({ confidence: 0.9, summary: "Explained the represented step" });
    expect(port.kind).toBe("planning_only");
    expect(port.supportsToolExecution).toBe(false);
    expect(captured).toContain('"executeTools":false');
    expect(captured).toContain('"mutatePlan":false');
    expect(captured).toContain('"actionFingerprint":"' + "a".repeat(64) + '"');
    expect(captured).toContain("Do not execute tools");
    expect(captured).toContain("Adapt explanation depth, terminology, pace, and evidence presentation");
    expect(captured).toContain('"presentationPreferences":[{"nodeId":"memory-test"');
    expect(captured).not.toContain("XAI_API_KEY");
    expect(captured).not.toContain("must-not-reach-provider");
    expect(captured).toContain("REDACTED AUTHENTICATION MATERIAL");
  });

  test("fails closed on fenced, malformed, oversized, or tool-capable responses", async () => {
    const cases = [
      "```json\n{}\n```",
      "not-json",
      JSON.stringify({
        body: "A valid body",
        summary: "A valid summary",
        confidence: 0.5,
        toolCall: { name: "execute" },
      }),
    ];
    for (const response of cases) {
      const port = new GrokGuidedCommanderPort({ callGrok: async () => response });
      await expect(port.respond(input(), new AbortController().signal)).rejects.toThrow();
    }
    const oversized = new GrokGuidedCommanderPort({
      maximumResponseBytes: 1_024,
      callGrok: async () => JSON.stringify({
        body: "x".repeat(2_000),
        summary: "summary",
        confidence: 0.5,
      }),
    });
    await expect(oversized.respond(input(), new AbortController().signal)).rejects.toThrow();
  });
});
