import { test, expect, describe } from "bun:test";
import { generatePlanPreview, extractJsonObject, mapValidatedPlanToPreview, PlanPreviewError } from "../PlanPreviewService";

const VALID = JSON.stringify({
  summary: "recon then assess",
  steps: [
    { title: "Recon", purpose: "find services", successCriteria: "ports listed", allowedTools: ["nmap"], riskLevel: "network" },
    { title: "Assess", purpose: "rate risk", successCriteria: "risk rated", allowedTools: ["read_file"], dependsOn: [0] },
  ],
});

describe("PlanPreviewService", () => {
  test("maps a valid model plan to an advisory, non-enforced preview", async () => {
    const p = await generatePlanPreview("triage host", async () => VALID, { generatedBy: "test-model" });
    expect(p.source).toBe("preview");
    expect(p.enforced).toBe(false);
    expect(p.purpose).toBe("triage host");
    expect(p.generatedBy).toBe("test-model");
    expect(p.steps.length).toBe(2);
    expect(p.steps[0].title).toBe("Recon");
    expect(p.steps[0].suggestedTools).toEqual(["nmap"]);
    expect(p.steps[0].riskLevel).toBe("network");
    expect(p.suggestedTools.sort()).toEqual(["nmap", "read_file"].sort());
    expect(typeof p.confidence).toBe("number");
  });

  test("rejects non-JSON / invalid plan output", async () => {
    await expect(generatePlanPreview("x", async () => "no json here")).rejects.toBeInstanceOf(PlanPreviewError);
    await expect(generatePlanPreview("x", async () => JSON.stringify({ notSteps: 1 }))).rejects.toBeInstanceOf(PlanPreviewError);
  });

  test("rejects an empty plan", async () => {
    await expect(generatePlanPreview("x", async () => JSON.stringify({ steps: [] }))).rejects.toBeInstanceOf(PlanPreviewError);
  });

  test("a throwing model caller surfaces as PlanPreviewError (never leaks)", async () => {
    await expect(generatePlanPreview("x", async () => { throw new Error("net down"); })).rejects.toBeInstanceOf(PlanPreviewError);
  });

  test("extractJsonObject strips code fences + surrounding prose", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJsonObject('Sure! {"a":1} hope that helps')).toBe('{"a":1}');
  });

  test("preview from a fenced response parses end-to-end", async () => {
    const fenced = "```json\n" + VALID + "\n```";
    const p = await generatePlanPreview("x", async () => fenced);
    expect(p.steps.length).toBe(2);
  });

  test("tolerates self/forward dependsOn (clamps advisory deps instead of failing)", async () => {
    // A model plan where step 1 depends on itself + a later step — invalid for managed
    // execution, but a preview should still render with those bad refs dropped.
    const loose = JSON.stringify({
      summary: "x",
      steps: [
        { title: "a", purpose: "p", successCriteria: "c", allowedTools: [] },
        { title: "b", purpose: "p", successCriteria: "c", allowedTools: [], dependsOn: [1, 5, 0] },
      ],
    });
    const p = await generatePlanPreview("x", async () => loose);
    expect(p.steps.length).toBe(2);
    expect(p.steps[1].dependsOn).toEqual([0]); // 1 (self) + 5 (forward/out-of-range) dropped
  });

  test("coerces invalid riskLevel + non-string tools (advisory) instead of failing", async () => {
    const messy = JSON.stringify({
      steps: [{ title: "a", purpose: "p", successCriteria: "c", allowedTools: ["nmap", 5, null], riskLevel: "MEGA-RISK" }],
    });
    const p = await generatePlanPreview("x", async () => messy);
    expect(p.steps.length).toBe(1);
    expect(p.steps[0].suggestedTools).toEqual(["nmap"]); // non-strings dropped
    expect(["read-only", "network", "file-write", "terminal", "exploit-sensitive", "credential-sensitive", "destructive"])
      .toContain(p.steps[0].riskLevel); // invalid risk dropped → derived, never "MEGA-RISK"
  });

  test("retries a transient failure and then succeeds (best-effort advisory generation)", async () => {
    let n = 0;
    const flaky = async () => {
      n++;
      return n < 3 ? "truncated {" : JSON.stringify({ steps: [{ title: "a", purpose: "p", successCriteria: "c", allowedTools: [] }] });
    };
    const p = await generatePlanPreview("x", flaky, { attempts: 3 });
    expect(p.steps.length).toBe(1);
    expect(n).toBe(3);
  });

  test("throws after exhausting retries (endpoint leaves the run untouched)", async () => {
    await expect(generatePlanPreview("x", async () => "always broken {", { attempts: 2 })).rejects.toBeInstanceOf(PlanPreviewError);
  });

  test("mapValidatedPlanToPreview is pure (no enforcement, source=preview)", () => {
    const p = mapValidatedPlanToPreview("obj", { summary: "s", steps: [{ title: "t", purpose: "p", successCriteria: "c", allowedTools: [] }] }, "m");
    expect(p.enforced).toBe(false);
    expect(p.source).toBe("preview");
    expect(p.steps[0].riskLevel).toBe("read-only"); // no tools → read-only
  });
});
