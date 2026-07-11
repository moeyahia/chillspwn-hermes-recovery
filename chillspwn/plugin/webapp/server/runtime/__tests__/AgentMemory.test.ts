import { test, expect, describe, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { TrainingMemoryStore } from "../TrainingMemoryStore";
import { TrainingMemoryService, TrainingMemoryError } from "../TrainingMemoryService";
import { EventLog } from "../EventLog";
import { buildLayeredPlanningContext } from "../AttackLesson";
import { summarizeLessons } from "../MemoryCleanup";

const dirs: string[] = [];
function svc() { const d = mkdtempSync(join(tmpdir(), "chillspwn-agmem-")); dirs.push(d); return new TrainingMemoryService(new TrainingMemoryStore(d), new EventLog({ dir: d })); }
afterEach(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} } dirs.length = 0; });

const lesson = (over: any = {}) => ({ title: "L", techniqueName: "T", techniqueCategory: "web", summary: "s", evidenceIds: ["ev"], sourceRunId: "run", sourceStepIds: ["st"], reuseGuidance: "g", scope: "agent", agentId: "WebBreaker", ...over });

describe("15.9 per-agent memory namespace", () => {
  test("agent lesson stores with agentId + scope; listed by agent", () => {
    const s = svc();
    s.proposeLesson(lesson());
    s.proposeLesson(lesson({ agentId: "ReconScout" }));
    expect(s.listAgentLessons("WebBreaker").length).toBe(1);
    expect(s.listAgentLessons("WebBreaker")[0].agentId).toBe("WebBreaker");
    expect(s.listAgentLessons("ReconScout").length).toBe(1);
  });
});

describe("15.9 verified specialist lessons feed only the right agent's planning", () => {
  test("specialist planning context = global + project + THIS agent + failed attempts", () => {
    const s = svc();
    const g = s.proposeLesson(lesson({ title: "GLOBAL-L", scope: "global", agentId: undefined })); s.approveLesson(g.id);
    const wb = s.proposeLesson(lesson({ title: "WB-AGENT-L", scope: "agent", agentId: "WebBreaker" })); s.approveLesson(wb.id);
    const rs = s.proposeLesson(lesson({ title: "RS-AGENT-L", scope: "agent", agentId: "ReconScout" })); s.approveLesson(rs.id);
    const ctx = s.buildSpecialistPlanningContext("WebBreaker");
    expect(ctx).toContain("VERIFIED GLOBAL TRAINING LESSONS");
    expect(ctx).toContain("GLOBAL-L");
    expect(ctx).toContain("SPECIALIST LESSONS FOR WebBreaker");
    expect(ctx).toContain("WB-AGENT-L");
    expect(ctx).not.toContain("RS-AGENT-L"); // ReconScout's lesson not in WebBreaker's context
  });
});

describe("15.10 failed-attempt lessons injected SEPARATELY (never as successes)", () => {
  test("failed_attempt verified appears under FAILED ATTEMPTS, not training lessons", () => {
    const s = svc();
    const fa = s.proposeLesson(lesson({ title: "FA-L", kind: "failed_attempt", whyItFailed: "WAF blocked it", futureAvoidanceGuidance: "use a different vhost", agentId: "WebBreaker", scope: "agent" }));
    s.approveLesson(fa.id);
    const ctx = s.buildSpecialistPlanningContext("WebBreaker");
    expect(ctx).toContain("RELEVANT FAILED ATTEMPTS");
    expect(ctx).toContain("WAF blocked it");
    // a failed attempt must NEVER be in the VERIFIED TRAINING LESSONS section
    const verifiedSection = ctx.split("RELEVANT FAILED ATTEMPTS")[0];
    expect(verifiedSection).not.toContain("FA-L");
  });
});

describe("15.12 scope promotion requires approval + provenance + reason", () => {
  test("promote agent→global on a verified evidence-backed lesson with a reason", () => {
    const s = svc();
    const l = s.proposeLesson(lesson({ scope: "agent" })); s.approveLesson(l.id);
    const promoted = s.promoteScope(l.id, "global", { reason: "broadly reusable" });
    expect(promoted.scope).toBe("global");
  });
  test("promote without a reason fails; promote a non-verified fails; promote to narrower fails", () => {
    const s = svc();
    const l = s.proposeLesson(lesson({ scope: "agent" }));
    expect(() => s.promoteScope(l.id, "global", {})).toThrow(); // not verified
    s.approveLesson(l.id);
    expect(() => s.promoteScope(l.id, "global", {})).toThrow(TrainingMemoryError); // no reason
    expect(() => s.promoteScope(l.id, "agent", { reason: "x" })).toThrow(); // not broader
  });
});

describe("15.12 cleanup per-agent lesson summary (read-only)", () => {
  test("summarizeLessons buckets by agent + flags promotion candidates", () => {
    const s = svc();
    const v = s.proposeLesson(lesson({ scope: "agent" })); s.approveLesson(v.id);
    s.proposeLesson(lesson({ title: "P" })); // proposed
    s.proposeLesson(lesson({ kind: "failed_attempt", whyItFailed: "x" }));
    const sum = summarizeLessons(s.listAgentLessons("WebBreaker"));
    expect(sum.byAgent["webbreaker"].verified).toBe(1);
    expect(sum.byAgent["webbreaker"].proposed).toBe(1);
    expect(sum.byAgent["webbreaker"].failed_attempts).toBe(1);
    expect(sum.byAgent["webbreaker"].promotion_candidates).toBe(1); // verified agent-scoped + promotable
  });
  test("filter by category=failed_attempt_lesson", () => {
    const s = svc();
    const v = s.proposeLesson(lesson()); s.approveLesson(v.id);
    s.proposeLesson(lesson({ kind: "failed_attempt", whyItFailed: "x" }));
    const sum = summarizeLessons(s.listAgentLessons("WebBreaker"), { category: "failed_attempt_lesson" });
    expect(sum.total).toBe(1);
  });
});
