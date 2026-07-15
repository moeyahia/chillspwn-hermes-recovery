import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(
  import.meta.dir,
  "../../../scripts/command-os-v2/live-grok-oauth-smoke.ts",
), "utf8");

describe("live Grok OAuth smoke safety boundary", () => {
  test("signs the Autonomous run to the reviewed ReconScout inventory", () => {
    expect(source).toContain('specialistAgentIds: ["ReconScout"]');
    expect(source).toContain('step.action?.arguments?.mcpServer === "sechub-reconnaissance"');
    expect(source).toContain('step.action?.arguments?.toolName === "quick_scan"');
    expect(source).toContain('dispatched.assignedAgentId !== "ReconScout"');
  });

  test("keeps Guided explanation bound to one exact represented step", () => {
    expect(source).toContain("!/^[a-f0-9]{64}$/u.test(actionFingerprint)");
    expect(source).toContain("expectedFingerprint: actionFingerprint");
    expect(source).toContain("structured.nextConsequentialActionRequiresDecision !== true");
    expect(source).toContain('after.run?.status !== "waiting_guided_decision"');
    expect(source).toContain("pendingAfter.items.length !== 1");
    expect(source).toContain("JSON.stringify(pendingAfter.items[0]?.requestedParameters) !== representedParameters");
    expect(source).toContain("actions.items.length !== 0");
    expect(source).not.toContain("/guided-decisions/${encodeURIComponent(decision.id)}/approve");
  });

  test("does not read or emit OAuth credential material", () => {
    expect(source).not.toMatch(/readFileSync\([^\n]*(?:authPath|GROK_AUTH_PATH)/u);
    expect(source).not.toContain("XAI_API_KEY");
  });
});
