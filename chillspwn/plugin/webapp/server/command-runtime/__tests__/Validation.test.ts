import { describe, expect, test } from "bun:test";
import { CommandRuntimeError, type MissionPlanDraft } from "../types";
import { validateMissionPlanDraft } from "../validation";

function draft(): MissionPlanDraft {
  return {
    strategySummary: "Use one bounded specialist action",
    rationaleSummary: "The action is sufficient for the authorized objective",
    steps: [{
      phase: "reconnaissance",
      title: "Inspect the approved target",
      objective: "Collect one verified result",
      explanation: "The specialist will perform one read-only observation.",
      rationale: "This is the smallest action that advances the objective.",
      successCriteria: ["One result is retained"],
      dependencyOrdinals: [],
      assignedAgentId: "ReconScout",
      riskClass: "low",
      reversibility: "Read-only",
      action: {
        actionType: "reconnaissance",
        actionClass: "reconnaissance",
        target: "lab.internal",
        arguments: {},
        intentSummary: "Inspect the approved target",
        kind: "tool",
        idempotent: true,
        destructive: false,
      },
    }],
  };
}

describe("mission-plan provider boundary validation", () => {
  test("reports only the safe path and rule for a missing required string", () => {
    const invalid = draft() as unknown as Record<string, any>;
    delete invalid.steps[0].reversibility;
    try {
      validateMissionPlanDraft(invalid as unknown as MissionPlanDraft);
      throw new Error("expected plan validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CommandRuntimeError);
      expect(error).toMatchObject({
        code: "invalid_plan",
        message: "steps[0].reversibility is required",
        options: {
          category: "invalid_input",
          details: {
            validationField: "steps[0].reversibility",
            validationRule: "required_nonempty_string",
          },
        },
      });
      expect((error as CommandRuntimeError).options.details).not.toHaveProperty("value");
    }
  });

  test("rejects malformed dependency containers as provider drift rather than throwing a TypeError", () => {
    const invalid = draft() as unknown as Record<string, any>;
    invalid.steps[0].dependencyOrdinals = "none";
    expect(() => validateMissionPlanDraft(invalid as unknown as MissionPlanDraft)).toThrow(CommandRuntimeError);
    try {
      validateMissionPlanDraft(invalid as unknown as MissionPlanDraft);
    } catch (error) {
      expect(error).toMatchObject({
        code: "invalid_plan",
        options: {
          details: {
            validationField: "steps[0].dependencyOrdinals",
            validationRule: "array_of_prior_step_ordinals",
          },
        },
      });
    }
  });
});
