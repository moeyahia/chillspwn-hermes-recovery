import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MemoryService, type MemoryProposalInput } from "../MemoryService";
import { MemoryStore } from "../MemoryStore";
import { EventLog } from "../EventLog";

let dir: string;
let svc: MemoryService;

const PROP: MemoryProposalInput = { type: "engagement_fact", content: "target runs Apache 2.4.49", scope: "engagement", sourceAgentRunId: "run_1" };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "chillspwn-mem10-"));
  svc = new MemoryService(new MemoryStore(dir), new EventLog({ dir }));
});
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

describe("Phase 10 live memory", () => {
  test("proposed memory is ALWAYS unverified (model can't auto-write trusted memory)", () => {
    expect(svc.proposeMemory(PROP).status).toBe("unverified");
  });

  test("getRelevantVerifiedMemory returns ONLY verified (excludes unverified/rejected/stale)", () => {
    svc.proposeMemory(PROP);                                              // unverified
    const b = svc.proposeMemory({ ...PROP, content: "verified one" }); svc.approveMemory(b.id);
    const c = svc.proposeMemory({ ...PROP, content: "rejected one" }); svc.rejectMemory(c.id);
    const verified = svc.getRelevantVerifiedMemory({ sourceAgentRunId: "run_1" });
    expect(verified.length).toBe(1);
    expect(verified[0].content).toBe("verified one");
    expect(verified.every((m) => m.status === "verified")).toBe(true);
  });

  test("verified memory is excluded once marked stale", () => {
    const b = svc.proposeMemory({ ...PROP, content: "x" }); svc.approveMemory(b.id);
    expect(svc.getRelevantVerifiedMemory({ sourceAgentRunId: "run_1" }).length).toBe(1);
    svc.markStale(b.id);
    expect(svc.getRelevantVerifiedMemory({ sourceAgentRunId: "run_1" }).length).toBe(0);
  });

  test("a hypothesis stays unverified — never auto-trusted", () => {
    const h = svc.proposeMemory({ ...PROP, type: "hypothesis", content: "maybe SQLi" });
    expect(h.status).toBe("unverified");
    expect(svc.getRelevantVerifiedMemory({ sourceAgentRunId: "run_1" }).find((m) => m.id === h.id)).toBeUndefined();
  });

  test("validateMemoryReferences flags a non-existent run", () => {
    const r = svc.validateMemoryReferences(PROP, { runExists: (id) => id === "run_real" });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors[0]).toContain("run_1");
  });

  test("validateMemoryReferences passes when references resolve", () => {
    const r = svc.validateMemoryReferences({ ...PROP, sourceStepId: "s1" }, { runExists: () => true, stepExists: () => true });
    expect(r.valid).toBe(true);
  });

  test("references with no checker remain structural-only (valid)", () => {
    expect(svc.validateMemoryReferences(PROP, {}).valid).toBe(true);
  });
});
