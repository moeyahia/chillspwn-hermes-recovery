import { test, expect, describe, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { TrainingMemoryStore } from "../TrainingMemoryStore";
import { TrainingMemoryService, TrainingMemoryError } from "../TrainingMemoryService";
import { EventLog } from "../EventLog";
import { validateAndNormalizeLesson, buildTrainingLessonContext, findRejectableSecrets, type AttackLessonInput } from "../AttackLesson";
import { buildVerifiedMemoryContext, MemoryService } from "../MemoryService";
import { MemoryStore } from "../MemoryStore";
import { classifyMemoryEntry, planCleanup } from "../MemoryCleanup";

const dirs: string[] = [];
function svc() {
  const dir = mkdtempSync(join(tmpdir(), "chillspwn-train-")); dirs.push(dir);
  return new TrainingMemoryService(new TrainingMemoryStore(dir), new EventLog({ dir }));
}
function memSvc() {
  const dir = mkdtempSync(join(tmpdir(), "chillspwn-tmem-")); dirs.push(dir);
  return new MemoryService(new MemoryStore(dir), new EventLog({ dir }));
}
afterEach(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} } dirs.length = 0; });

const BASE: AttackLessonInput = {
  title: "AS-REP roast un-preauth users",
  techniqueName: "AS-REP Roasting",
  techniqueCategory: "kerberos",
  summary: "Request AS-REP for accounts with preauth disabled, crack offline.",
  prerequisites: ["valid username list", "reachable KDC"],
  observedSignals: ["DONT_REQ_PREAUTH on an account"],
  stepsThatWorked: ["enumerate users", "impacket GetNPUsers"],
  toolsUsed: ["GetNPUsers"],
  evidenceIds: ["ev_123"],
  sourceRunId: "run_1",
  sourceStepIds: ["step_1"],
  reuseGuidance: "Try when you have a userlist but no creds.",
  antiReuseWarnings: ["noisy — generates 4768 events"],
  scope: "global",
};

describe("8.2 AttackLesson validation + secrets", () => {
  test("valid lesson normalizes (schema validation)", () => {
    const v = validateAndNormalizeLesson(BASE);
    expect(v.ok).toBe(true);
    if (v.ok) { expect(v.lesson!.category).toBe("verified_attack_lesson"); expect(v.lesson!.techniqueCategory).toBe("kerberos"); }
  });
  test("missing required fields / bad category fail", () => {
    expect(validateAndNormalizeLesson({ title: "x" }).ok).toBe(false);
    expect(validateAndNormalizeLesson({ ...BASE, techniqueCategory: "nope" }).ok).toBe(false);
  });
  test("REJECTS a lesson whose content carries a flag or hash (target secret)", () => {
    expect(validateAndNormalizeLesson({ ...BASE, summary: "got HTB{deadbeef_flag_here}" }).ok).toBe(false);
    expect(validateAndNormalizeLesson({ ...BASE, summary: "ntlm aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0" }).ok).toBe(false);
    expect(findRejectableSecrets("HTB{x_yyyy}").length).toBeGreaterThan(0);
  });
  test("REDACTS soft credentials in text fields (not rejected)", () => {
    const v = validateAndNormalizeLesson({ ...BASE, reuseGuidance: "login with password: hunter2s3cret" });
    expect(v.ok).toBe(true);
    if (v.ok) { expect(v.lesson!.reuseGuidance).toContain("REDACTED"); expect(v.lesson!.reuseGuidance).not.toContain("hunter2s3cret"); }
  });
});

describe("8.2 lesson lifecycle", () => {
  test("propose stores 'proposed' (never auto-verified)", () => {
    expect(svc().proposeLesson(BASE).status).toBe("proposed");
  });
  test("approve → verified; reject/stale transitions", () => {
    const s = svc();
    const a = s.proposeLesson(BASE); expect(s.approveLesson(a.id).status).toBe("verified");
    const b = s.proposeLesson(BASE); expect(s.rejectLesson(b.id).status).toBe("rejected");
    const c = s.proposeLesson(BASE); expect(s.staleLesson(c.id).status).toBe("stale");
  });
  test("approve REFUSES a non-promotable lesson (no provenance)", () => {
    const s = svc();
    const noProv = s.proposeLesson({ ...BASE, evidenceIds: [], sourceRunId: undefined });
    expect(() => s.approveLesson(noProv.id)).toThrow(TrainingMemoryError);
  });
});

describe("8.2 verified-lesson planning injection", () => {
  test("getRelevantVerifiedLessons returns ONLY verified", () => {
    const s = svc();
    s.proposeLesson(BASE); // proposed
    const v = s.proposeLesson({ ...BASE, title: "VERIFIED ONE" }); s.approveLesson(v.id);
    const r = s.proposeLesson({ ...BASE, title: "REJECTED ONE" }); s.rejectLesson(r.id);
    const got = s.getRelevantVerifiedLessons();
    expect(got.length).toBe(1);
    expect(got[0].title).toBe("VERIFIED ONE");
  });
  test("context includes technique/reuse/anti-reuse/evidence; excludes proposed + secrets", () => {
    const s = svc();
    const v = s.proposeLesson(BASE); s.approveLesson(v.id);
    s.proposeLesson({ ...BASE, title: "PROPOSED hidden" }); // not verified
    const ctx = s.buildPlanningContext();
    expect(ctx).toContain("VERIFIED TRAINING LESSONS");
    expect(ctx).toContain("AS-REP Roasting");
    expect(ctx).toContain("anti-reuse");
    expect(ctx).toContain("ev_123"); // evidence ref, not a secret
    expect(ctx).not.toContain("PROPOSED hidden");
  });
  test("empty context when nothing verified", () => {
    const s = svc(); s.proposeLesson(BASE);
    expect(buildTrainingLessonContext(s.listLessons())).toBe(""); // none verified
  });
});

describe("8.2 hypotheses NEVER injected (training + memory)", () => {
  test("verified memory context excludes verified AND unverified hypotheses", () => {
    const m = memSvc();
    const f = m.proposeMemory({ type: "engagement_fact", content: "FACT x", scope: "engagement", sourceAgentRunId: "r" }); m.approveMemory(f.id);
    const h1 = m.proposeMemory({ type: "hypothesis", content: "HYP verified", scope: "engagement", sourceAgentRunId: "r" }); m.approveMemory(h1.id);
    m.proposeMemory({ type: "hypothesis", content: "HYP unverified", scope: "engagement", sourceAgentRunId: "r" });
    const ctx = buildVerifiedMemoryContext(m.listMemoryItems());
    expect(ctx).toContain("FACT x");
    expect(ctx).not.toContain("HYP");
  });
});

describe("8.2 ledger cleanup tool (safe by default)", () => {
  const items: any[] = [
    { id: "m1", type: "hypothesis", status: "unverified", content: "maybe LFI" },
    { id: "m2", type: "finding", status: "verified", content: "SMB signing disabled", sourceEvidenceId: "ev1", sourceAgentRunId: "r", sourceStepId: "s" },
    { id: "m3", type: "finding", status: "unverified", content: "creds password: secret123val" },
    { id: "m4", type: "engagement_fact", status: "stale", content: "old fact" },
    { id: "m5", type: "finding", status: "unverified", content: "open port 80" },
  ];
  test("classifyMemoryEntry categorizes correctly", () => {
    expect(classifyMemoryEntry(items[0])).toBe("hypothesis");
    expect(classifyMemoryEntry(items[1])).toBe("verified_attack_lesson_candidate");
    expect(classifyMemoryEntry(items[3])).toBe("stale");
    expect(classifyMemoryEntry(items[4])).toBe("raw_note");
  });
  test("dry-run plan does NOT mutate (all actions are report)", () => {
    const plan = planCleanup(items, "dry-run");
    expect(plan.mutates).toBe(false);
    expect(plan.actions.every((a) => a.action === "report")).toBe(true);
  });
  test("quarantine marks hypotheses/raw_notes rejected — never delete", () => {
    const plan = planCleanup(items, "quarantine");
    expect(plan.actions.find((a) => a.id === "m1")!.action).toBe("mark_rejected");
    expect(plan.actions.every((a) => a.action !== "delete")).toBe(true);
  });
  test("promote only targets candidates with evidence/provenance", () => {
    const plan = planCleanup(items, "promote");
    expect(plan.actions.find((a) => a.id === "m2")!.action).toBe("promote_candidate");
    expect(plan.actions.find((a) => a.id === "m1")!.action).toBe("report"); // hypothesis NOT promoted
  });
});

import { isPromotable } from "../AttackLesson";

describe("8.3 verified lessons must be evidence-backed (evidenceIds AND sourceRunId)", () => {
  test("sourceRunId but NO evidenceIds → cannot be approved", () => {
    const s = svc();
    const l = s.proposeLesson({ ...BASE, evidenceIds: [], sourceRunId: "run_1" });
    expect(() => s.approveLesson(l.id)).toThrow(/evidenceIds/);
    expect(s.getLesson(l.id)!.status).toBe("proposed"); // unchanged
  });
  test("evidenceIds but NO sourceRunId → cannot be approved", () => {
    const s = svc();
    const l = s.proposeLesson({ ...BASE, evidenceIds: ["ev_1"], sourceRunId: undefined });
    expect(() => s.approveLesson(l.id)).toThrow(/sourceRunId/);
  });
  test("BOTH evidenceIds AND sourceRunId (+ corroboration) → can be approved", () => {
    const s = svc();
    const l = s.proposeLesson({ ...BASE, evidenceIds: ["ev_1"], sourceRunId: "run_1", reuseGuidance: "use when X" });
    expect(s.approveLesson(l.id).status).toBe("verified");
  });
  test("both ids but NO corroborating field → cannot be approved", () => {
    const s = svc();
    const l = s.proposeLesson({ ...BASE, evidenceIds: ["ev_1"], sourceRunId: "run_1", sourceStepIds: [], verificationMethod: "", outcome: "", reuseGuidance: "" });
    expect(() => s.approveLesson(l.id)).toThrow(/sourceStepIds|verificationMethod|outcome|reuseGuidance/);
  });
  test("proposed lessons may exist without evidence but stay out of the verified planning feed", () => {
    const s = svc();
    s.proposeLesson({ ...BASE, evidenceIds: [], sourceRunId: undefined }); // proposable, not verifiable
    expect(s.getRelevantVerifiedLessons().length).toBe(0);
    expect(s.buildPlanningContext()).toBe("");
  });
  test("isPromotable directly: needs both ids", () => {
    expect(isPromotable({ ...BASE, evidenceIds: ["e"], sourceRunId: "r" } as any).ok).toBe(true);
    expect(isPromotable({ ...BASE, evidenceIds: [], sourceRunId: "r" } as any).ok).toBe(false);
    expect(isPromotable({ ...BASE, evidenceIds: ["e"], sourceRunId: undefined } as any).ok).toBe(false);
  });
});
