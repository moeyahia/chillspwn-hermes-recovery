import { test, expect, describe, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { AgentRuntime } from "../AgentRuntime";
import { AgentRunStore } from "../AgentRunStore";
import { EventLog } from "../EventLog";
import { MemoryBoardSink } from "../BoardSink";
import { DEFAULT_POLICY_CONFIG } from "../ToolPolicy";
import { buildVerifiedMemoryContext, MemoryService } from "../MemoryService";
import { MemoryStore } from "../MemoryStore";

// Policy where terminal is ENABLED but requires approval → produces require_approval.
const POLICY = { ...DEFAULT_POLICY_CONFIG, enableTerminal: true, requireApprovalForTerminal: true };
const dirs: string[] = [];
function mk() {
  const dir = mkdtempSync(join(tmpdir(), "chillspwn-dry-")); dirs.push(dir);
  const events = new EventLog({ dir });
  const rt = new AgentRuntime({ store: new AgentRunStore(dir), events, board: new MemoryBoardSink(), policy: POLICY });
  const run = rt.createManagedChatRun({ sessionId: "s", persona: "x", providerKind: "openrouter", objective: "o" });
  rt.beginPlanning(run.id);
  const { steps } = rt.submitPlan(run.id, { summary: "s", steps: [{ title: "a", purpose: "p", successCriteria: "c", allowedTools: [] }] });
  rt.approvePlan(run.id); rt.startStep(run.id, steps[0].id);
  return { rt, events, run, step: steps[0] };
}
afterEach(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} } dirs.length = 0; });

describe("Phase 8.1 dry-run gate semantics", () => {
  test("dry-run returns the would-be decision (caller never blocks on it)", () => {
    const { rt, run, step } = mk();
    const dec = rt.evaluateToolDryRun({ runId: run.id, stepId: step.id, toolName: "terminal", command: "id" });
    expect(dec.action).toBe("require_approval"); // what enforce WOULD do
  });

  test("dry-run creates NO ToolCall and NO actionable ApprovalRequest", () => {
    const { rt, run, step } = mk();
    rt.evaluateToolDryRun({ runId: run.id, stepId: step.id, toolName: "terminal", command: "id" });
    const doc = rt.getDoc(run.id)!;
    expect(doc.toolCalls.length).toBe(0);
    expect(doc.approvals.length).toBe(0); // ← the bug being fixed: no misleading "action required"
  });

  test("dry-run records a non-blocking observation event (mode=dry-run, enforced=false)", () => {
    const { rt, events, run, step } = mk();
    rt.evaluateToolDryRun({ runId: run.id, stepId: step.id, toolName: "terminal", command: "id" });
    const obs = events.queryByRun(run.id).filter((e) => e.type === "tool_observed");
    expect(obs.length).toBe(1);
    expect((obs[0].data as any).mode).toBe("dry-run");
    expect((obs[0].data as any).enforced).toBe(false);
    expect((obs[0].data as any).wouldDecide).toBe("require_approval");
  });

  test("ENFORCE on the same tool DOES create a real pending ApprovalRequest", () => {
    const { rt, run, step } = mk();
    const r = rt.requestTool({ runId: run.id, stepId: step.id, toolName: "terminal", command: "id", enforceAllowedTools: false });
    expect(r.toolCall.status).toBe("awaiting_approval");
    const doc = rt.getDoc(run.id)!;
    expect(doc.toolCalls.length).toBe(1);
    expect(doc.approvals.filter((a) => a.status === "pending").length).toBe(1); // real action required
  });
});

describe("Phase 8.1 verified-memory planning context", () => {
  function svc() {
    const dir = mkdtempSync(join(tmpdir(), "chillspwn-vmem-")); dirs.push(dir);
    return new MemoryService(new MemoryStore(dir), new EventLog({ dir }));
  }
  test("includes ONLY verified items; excludes unverified/rejected", () => {
    const s = svc();
    s.proposeMemory({ type: "engagement_fact", content: "UNVERIFIED fact", scope: "engagement", sourceAgentRunId: "r" });
    const v = s.proposeMemory({ type: "engagement_fact", content: "VERIFIED apache", scope: "engagement", sourceAgentRunId: "r" }); s.approveMemory(v.id);
    const rej = s.proposeMemory({ type: "engagement_fact", content: "REJECTED thing", scope: "engagement", sourceAgentRunId: "r" }); s.rejectMemory(rej.id);
    const ctx = buildVerifiedMemoryContext(s.listMemoryItems());
    expect(ctx).toContain("VERIFIED apache");
    expect(ctx).not.toContain("UNVERIFIED");
    expect(ctx).not.toContain("REJECTED");
    expect(ctx).toContain("VERIFIED MEMORY");
  });
  test("excludes session-scoped (run-specific) verified memory", () => {
    const s = svc();
    const a = s.proposeMemory({ type: "engagement_fact", content: "reusable", scope: "engagement", sourceAgentRunId: "r" }); s.approveMemory(a.id);
    const b = s.proposeMemory({ type: "engagement_fact", content: "session-only", scope: "session", sourceSessionId: "sess1" }); s.approveMemory(b.id);
    const ctx = buildVerifiedMemoryContext(s.listMemoryItems());
    expect(ctx).toContain("reusable");
    expect(ctx).not.toContain("session-only");
  });
  test("returns empty string when there is no verified memory", () => {
    const s = svc();
    s.proposeMemory({ type: "hypothesis", content: "maybe", scope: "engagement", sourceAgentRunId: "r" });
    expect(buildVerifiedMemoryContext(s.listMemoryItems())).toBe("");
  });
});

import { classifyTool, decideTool } from "../ToolPolicy";

describe("Phase 8.2 — hypothesis excluded from trusted verified-memory context", () => {
  function svc() {
    const dir = mkdtempSync(join(tmpdir(), "chillspwn-h2-")); dirs.push(dir);
    return new MemoryService(new MemoryStore(dir), new EventLog({ dir }));
  }
  test("verified engagement_fact + finding are included; verified hypothesis is EXCLUDED", () => {
    const s = svc();
    const f1 = s.proposeMemory({ type: "engagement_fact", content: "FACT apache 2.4.49", scope: "engagement", sourceAgentRunId: "r" }); s.approveMemory(f1.id);
    const f2 = s.proposeMemory({ type: "finding", content: "FINDING SMB signing off", scope: "engagement", sourceAgentRunId: "r", sourceEvidenceId: "e", sourceToolName: "nmap" } as any); s.approveMemory(f2.id);
    const h = s.proposeMemory({ type: "hypothesis", content: "HYPOTHESIS maybe SQLi", scope: "engagement", sourceAgentRunId: "r" }); s.approveMemory(h.id); // verified BUT still a hypothesis
    const ctx = buildVerifiedMemoryContext(s.listMemoryItems());
    expect(ctx).toContain("FACT apache");
    expect(ctx).toContain("FINDING SMB");
    expect(ctx).not.toContain("HYPOTHESIS"); // a verified hypothesis is NOT a trusted fact
    expect(ctx).not.toContain("maybe SQLi");
  });
  test("a context built ONLY from a verified hypothesis is empty (never 'you may TRUST')", () => {
    const s = svc();
    const h = s.proposeMemory({ type: "hypothesis", content: "guess", scope: "engagement", sourceAgentRunId: "r" }); s.approveMemory(h.id);
    expect(buildVerifiedMemoryContext(s.listMemoryItems())).toBe("");
  });
});

describe("Phase 8.2 — delegation/state-changing tools are gated risks, DENIED by default policy", () => {
  test("delegate_task / board_create_task / skill_manage / remember / board_update classify as a gated risk", () => {
    for (const t of ["delegate_task", "board_create_task", "skill_manage", "remember", "board_update"]) {
      // terminal OR file-write — both are OFF by default, so both get gated (not silently allowed).
      expect(["terminal", "file-write"]).toContain(classifyTool(t));
    }
  });
  test("with the DEFAULT policy (terminal+file-write OFF) every gated tool is DENIED", () => {
    for (const t of ["delegate_task", "board_create_task", "skill_manage", "remember", "board_update"]) {
      expect(decideTool({ toolName: t, stepId: "s", allowedTools: undefined }, DEFAULT_POLICY_CONFIG).action).toBe("deny");
    }
  });
});
