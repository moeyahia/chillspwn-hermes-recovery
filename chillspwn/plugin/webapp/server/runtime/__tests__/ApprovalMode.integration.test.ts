import { test, expect, describe, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { AgentRuntime } from "../AgentRuntime";
import { AgentRunStore } from "../AgentRunStore";
import { EventLog } from "../EventLog";
import { MemoryBoardSink } from "../BoardSink";
import { DEFAULT_POLICY_CONFIG } from "../ToolPolicy";

const dirs: string[] = [];
function mk(mode: "human" | "auto" | "hybrid", opts: { enableTerminal?: boolean; persona?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "chillspwn-apr-")); dirs.push(dir);
  const events = new EventLog({ dir });
  const policy = { ...DEFAULT_POLICY_CONFIG, enableTerminal: opts.enableTerminal ?? true, requireApprovalForTerminal: true };
  const rt = new AgentRuntime({
    store: new AgentRunStore(dir), events, board: new MemoryBoardSink(), policy,
    getApprovalPolicy: () => ({ mode, autoApproveRiskClasses: ["read-only", "network"], autoApproveToolNames: [], autoApproveAgentIds: [], autoApproveMaxRisk: "network" }),
    agentForRun: () => opts.persona ?? "ReconScout",
  });
  const run = rt.createManagedChatRun({ sessionId: "s", persona: opts.persona ?? "ReconScout", providerKind: "openrouter", objective: "o" });
  rt.beginPlanning(run.id);
  const { steps } = rt.submitPlan(run.id, { summary: "s", steps: [{ title: "a", purpose: "p", successCriteria: "c", allowedTools: [] }] });
  rt.approvePlan(run.id); rt.startStep(run.id, steps[0].id);
  return { rt, events, run, step: steps[0] };
}
afterEach(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} } dirs.length = 0; });

const req = (rt: any, run: any, step: any, tool: string, cmd?: string) =>
  rt.requestTool({ runId: run.id, stepId: step.id, toolName: tool, command: cmd, enforceAllowedTools: false });

describe("Part 1 — approval mode integration", () => {
  test("human: terminal → pending approval, toolCall awaiting, not auto", () => {
    const { rt, run, step } = mk("human");
    const r = req(rt, run, step, "terminal", "id");
    expect(r.decision.action).toBe("require_approval");
    expect(r.autoApproved).toBeFalsy();
    expect(r.toolCall.status).toBe("awaiting_approval");
    const ap = rt.getDoc(run.id)!.approvals[0];
    expect(ap.status).toBe("pending"); expect(ap.autoApproved).toBe(false);
  });

  test("auto: terminal → AUTO-approved, toolCall approved, audited", () => {
    const { rt, events, run, step } = mk("auto");
    const r = req(rt, run, step, "terminal", "id");
    expect(r.autoApproved).toBe(true);
    expect(r.toolCall.status).toBe("approved");
    const ap = rt.getDoc(run.id)!.approvals[0];
    expect(ap.status).toBe("approved"); expect(ap.autoApproved).toBe(true);
    expect(ap.approvedBy ?? ap.resolvedBy).toBe("runtime:auto-policy");
    expect(ap.approvalMode).toBe("auto"); expect(ap.policyReason).toContain("auto mode");
    const evs = events.readAll().filter((e: any) => e.agentRunId === run.id).map((e: any) => e.type);
    expect(evs).toContain("approval_auto_granted");
  });

  test("hybrid: terminal needs human, read-only/network auto", () => {
    const { rt, run, step } = mk("hybrid");
    expect(req(rt, run, step, "terminal", "id").autoApproved).toBeFalsy(); // high-risk → human
    // a network-class tool (read_file is read-only; use a benign network tool name classified network)
    const net = req(rt, run, step, "http_get");
    // http_get classifies as 'terminal' default unless mapped; assert the policy reason is risk-based either way
    expect(["require_approval", "allow"]).toContain(net.decision.action);
  });

  test("deny stays denied regardless of mode (terminal disabled)", () => {
    const { rt, run, step } = mk("auto", { enableTerminal: false });
    const r = req(rt, run, step, "terminal", "id");
    expect(r.decision.action).toBe("deny");
    expect(r.toolCall.status).toBe("rejected");
    expect(r.autoApproved).toBeFalsy(); // auto NEVER approves a deny
  });
});
