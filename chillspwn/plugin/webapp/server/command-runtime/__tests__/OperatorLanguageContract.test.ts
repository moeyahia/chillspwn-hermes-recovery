import { describe, expect, test } from "bun:test";
import {
  assertOperatorReadablePlan,
  operatorLanguageViolation,
} from "../OperatorLanguageContract";
import type { MissionPlanDraft } from "../types";

const badPriorityText = "Fetch public NVD detail for the top CVE candidate to sharpen prioritization toward user and root flag capture without target interaction.";
const badBindingText = "Dispatch VulnIntel via the exact reviewed vulnintel-nvd get_cve_details binding using an opaque reference to the top-ranked CVE from step 1, remaining strictly read-only.";

const goodPriorityText = "Check the highest-ranked CVE against its public NVD record to confirm the affected software versions and decide whether it is relevant. This reads public vulnerability data and does not contact the target.";
const goodSpecialistText = "Ask the vulnerability specialist to retrieve the public NVD record for CVE-2025-13583 so the team can assess applicability. This does not contact or change the target.";

function readablePlan(): MissionPlanDraft {
  return {
    strategySummary: "Validate the strongest vulnerability lead before deciding whether target-side testing is justified.",
    rationaleSummary: "Public vulnerability records can confirm affected versions without sending traffic to the target.",
    steps: [{
      phase: "Vulnerability assessment",
      title: "Check the leading CVE against NVD",
      objective: goodPriorityText,
      explanation: goodSpecialistText,
      rationale: "Version and advisory details will show whether the candidate deserves target-side validation.",
      successCriteria: ["The affected version range and authoritative advisory links are recorded."],
      dependencyOrdinals: [],
      assignedAgentId: "VulnIntel",
      riskClass: "low",
      reversibility: "Read-only public research; the target is not contacted.",
      action: {
        actionType: "vulnerability intelligence",
        actionClass: "public research",
        target: "CVE-2025-13583",
        arguments: {
          mcpServer: "vulnintel-nvd",
          toolName: "get_cve_details",
          arguments: { cve_id: "CVE-2025-13583" },
        },
        intentSummary: "Retrieve the authoritative public record for the confirmed CVE ID.",
        kind: "tool",
        idempotent: true,
        destructive: false,
      },
    }],
  };
}

describe("operator-language contract", () => {
  test("rejects the two reported descriptions with precise repair rules", () => {
    expect(operatorLanguageViolation(badPriorityText)).toMatchObject({
      rule: "operator_language_indirect_priority",
    });
    expect(operatorLanguageViolation(badBindingText)).toMatchObject({
      rule: "operator_language_internal_binding",
    });
  });

  test("keeps useful technical terms while accepting readable operator prose", () => {
    for (const candidate of [
      goodPriorityText,
      goodSpecialistText,
      "Confirm whether the HTTP service requires TLS and record the negotiated protocol version.",
      "Use the configured provider to compare the CVE against the vendor advisory.",
    ]) {
      expect(operatorLanguageViolation(candidate), candidate).toBeNull();
    }
  });

  test("keeps exact MCP and schema details in action arguments, outside the visible-language gate", () => {
    const plan = readablePlan();
    expect(() => assertOperatorReadablePlan(plan)).not.toThrow();
    expect(plan.steps[0]!.action.arguments).toEqual({
      mcpServer: "vulnintel-nvd",
      toolName: "get_cve_details",
      arguments: { cve_id: "CVE-2025-13583" },
    });
  });

  test("reports the exact visible field without retaining the rejected prose", () => {
    const plan = readablePlan();
    const invalid: MissionPlanDraft = {
      ...plan,
      steps: [{ ...plan.steps[0]!, objective: badBindingText }],
    };
    expect(() => assertOperatorReadablePlan(invalid)).toThrow(
      "steps[0].objective violates the operator-language contract",
    );
    try {
      assertOperatorReadablePlan(invalid);
    } catch (error) {
      expect(error).toMatchObject({
        code: "invalid_plan",
        options: {
          category: "invalid_input",
          details: {
            validationField: "steps[0].objective",
            validationRule: "operator_language_internal_binding",
          },
        },
      });
      expect(JSON.stringify(error)).not.toContain("vulnintel-nvd");
    }
  });
});
