import { test, expect, describe } from "bun:test";
import {
  parseAndValidatePlan,
  materializePlanSteps,
  buildPlanPrompt,
  MAX_PLAN_STEPS,
} from "../Planner";

const validPlan = {
  summary: "compromise the host",
  steps: [
    { title: "Recon", purpose: "find open services", successCriteria: "ports enumerated", allowedTools: ["read_file"] },
    { title: "Exploit", purpose: "get a shell", successCriteria: "shell obtained", allowedTools: ["terminal"], riskLevel: "terminal", dependsOn: [0] },
  ],
};

describe("parseAndValidatePlan", () => {
  test("accepts a well-formed plan (object or JSON string)", () => {
    const a = parseAndValidatePlan(validPlan);
    expect(a.ok).toBe(true);
    const b = parseAndValidatePlan(JSON.stringify(validPlan));
    expect(b.ok).toBe(true);
  });

  test("rejects non-JSON string and non-object", () => {
    expect(parseAndValidatePlan("not json").ok).toBe(false);
    expect(parseAndValidatePlan(42).ok).toBe(false);
    expect(parseAndValidatePlan(null).ok).toBe(false);
  });

  test("requires a non-empty steps array", () => {
    expect(parseAndValidatePlan({ steps: [] }).ok).toBe(false);
    expect(parseAndValidatePlan({}).ok).toBe(false);
  });

  test("requires title/purpose/successCriteria per step", () => {
    const r = parseAndValidatePlan({ steps: [{ title: "x" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("purpose"))).toBe(true);
      expect(r.errors.some((e) => e.includes("successCriteria"))).toBe(true);
    }
  });

  test("rejects an invalid riskLevel", () => {
    const r = parseAndValidatePlan({
      steps: [{ title: "t", purpose: "p", successCriteria: "s", riskLevel: "nuclear" }],
    });
    expect(r.ok).toBe(false);
  });

  test("dependsOn must reference an EARLIER, in-range step", () => {
    const forward = parseAndValidatePlan({
      steps: [
        { title: "a", purpose: "p", successCriteria: "s", dependsOn: [1] }, // references later
        { title: "b", purpose: "p", successCriteria: "s" },
      ],
    });
    expect(forward.ok).toBe(false);

    const oob = parseAndValidatePlan({
      steps: [{ title: "a", purpose: "p", successCriteria: "s", dependsOn: [5] }],
    });
    expect(oob.ok).toBe(false);
  });

  test("rejects more than MAX_PLAN_STEPS", () => {
    const steps = Array.from({ length: MAX_PLAN_STEPS + 1 }, (_, i) => ({
      title: `t${i}`, purpose: "p", successCriteria: "s",
    }));
    expect(parseAndValidatePlan({ steps }).ok).toBe(false);
  });
});

describe("materializePlanSteps", () => {
  test("assigns ids/indices, resolves dependsOn to ids, derives risk", () => {
    const v = parseAndValidatePlan(validPlan);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const steps = materializePlanSteps("run_1", v.plan);
    expect(steps.length).toBe(2);
    expect(steps[0].id.startsWith("step_")).toBe(true);
    expect(steps[0].index).toBe(0);
    expect(steps[0].status).toBe("pending");
    expect(steps[0].agentRunId).toBe("run_1");
    // step 1 depends on step 0 → its dependencies hold step 0's id (not the index).
    expect(steps[1].dependencies).toEqual([steps[0].id]);
    // risk: read_file ⇒ read-only; terminal ⇒ terminal.
    expect(steps[0].riskLevel).toBe("read-only");
    expect(steps[1].riskLevel).toBe("terminal");
  });

  test("derives risk from allowedTools when riskLevel omitted", () => {
    const v = parseAndValidatePlan({
      steps: [{ title: "t", purpose: "p", successCriteria: "s", allowedTools: ["write_file"] }],
    });
    if (!v.ok) throw new Error("expected valid");
    expect(materializePlanSteps("r", v.plan)[0].riskLevel).toBe("file-write");
  });
});

describe("buildPlanPrompt", () => {
  test("embeds the objective and demands JSON-only output", () => {
    const p = buildPlanPrompt("enumerate AD");
    expect(p).toContain("enumerate AD");
    expect(p.toLowerCase()).toContain("json");
    expect(p).toContain("successCriteria");
  });
});
