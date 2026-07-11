import { test, expect, describe } from "bun:test";
import { toolCallStatusToGateDecision } from "../gateRoutes";

describe("Phase 8 tool-gate decision mapping", () => {
  test("ToolCall status → orchestrator gate decision", () => {
    expect(toolCallStatusToGateDecision("approved")).toBe("allow");
    expect(toolCallStatusToGateDecision("rejected")).toBe("deny");
    expect(toolCallStatusToGateDecision("awaiting_approval")).toBe("awaiting_approval");
    expect(toolCallStatusToGateDecision("anything-else")).toBe("awaiting_approval"); // safe default
  });
});
