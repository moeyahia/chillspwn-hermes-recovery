import { test, expect, describe } from "bun:test";
import { generateStrictPlan, ManagedPlanError } from "../ManagedPlanService";

const VALID = JSON.stringify({
  summary: "recon then assess",
  steps: [
    { title: "Recon", purpose: "find services", successCriteria: "ports listed", allowedTools: ["nmap"], riskLevel: "network" },
    { title: "Assess", purpose: "rate", successCriteria: "rated", allowedTools: ["read_file"], dependsOn: [0] },
  ],
});
// step 0 depends on itself → STRICT validator rejects (the preview path would clamp this).
const SELF_DEP = JSON.stringify({
  steps: [{ title: "a", purpose: "p", successCriteria: "c", allowedTools: [], dependsOn: [0] }],
});

describe("ManagedPlanService (STRICT — no coercion)", () => {
  test("returns a strictly-valid plan", async () => {
    const plan = await generateStrictPlan("obj", async () => VALID);
    expect(plan.steps.length).toBe(2);
    expect(plan.steps[0].title).toBe("Recon");
  });

  test("REJECTS an invalid plan (self-dep) — does NOT coerce like the preview path", async () => {
    await expect(generateStrictPlan("obj", async () => SELF_DEP, { attempts: 1 })).rejects.toBeInstanceOf(ManagedPlanError);
  });

  test("retries a transient invalid response, then succeeds", async () => {
    let n = 0;
    const flaky = async () => { n++; return n < 2 ? SELF_DEP : VALID; };
    const plan = await generateStrictPlan("obj", flaky, { attempts: 3 });
    expect(plan.steps.length).toBe(2);
    expect(n).toBe(2);
  });

  test("ManagedPlanError carries the strict validation errors (fails clearly)", async () => {
    try {
      await generateStrictPlan("obj", async () => SELF_DEP, { attempts: 1 });
      throw new Error("should have thrown");
    } catch (e: any) {
      expect(e).toBeInstanceOf(ManagedPlanError);
      expect(Array.isArray(e.errors)).toBe(true);
      expect(e.errors.length).toBeGreaterThan(0);
      expect(e.errors.join(" ")).toContain("EARLIER");
    }
  });

  test("rejects non-JSON output", async () => {
    await expect(generateStrictPlan("obj", async () => "not json", { attempts: 1 })).rejects.toBeInstanceOf(ManagedPlanError);
  });
});
