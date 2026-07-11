import { test, expect, describe } from "bun:test";
import {
  previewBadges, filterRuns, isArchivedRun, runModeLabel,
  isDryRunGateEvent, observeEventLabel, executionEnforcementNote,
  MANAGED_PLAN_APPROVED_MSG,
  runStatusBadge,
  stepStatusBadge,
  riskBadge,
  stepProgress,
  activeStep,
  activeToolCall,
  pendingApprovals,
  blockers,
  previewText,
  isObserveOnlyEvent,
  enforcementLabel,
  shortTime,
} from "../cockpit";
import type { PlanStep, ToolCall, ApprovalRequest, AgentEvent } from "../runtimeTypes";

function step(p: Partial<PlanStep> & { id: string; status: PlanStep["status"] }): PlanStep {
  return {
    agentRunId: "r", index: 0, title: "t", purpose: "p", successCriteria: "s",
    allowedTools: [], riskLevel: "read-only", dependencies: [], evidenceRefs: [], ...p,
  } as PlanStep;
}
function tc(p: Partial<ToolCall> & { id: string; status: ToolCall["status"] }): ToolCall {
  return { agentRunId: "r", stepId: "s", toolName: "read_file", arguments: {}, riskLevel: "read-only", createdAt: "t", ...p } as ToolCall;
}

describe("status + risk badges", () => {
  test("run status maps to a label/color", () => {
    expect(runStatusBadge("executing").label).toBe("EXECUTING");
    expect(runStatusBadge("completed").label).toBe("COMPLETED");
    expect(runStatusBadge("failed").color).toBe("#ff4d63");
  });
  test("step + risk badges", () => {
    expect(stepStatusBadge("running").label).toBe("RUNNING");
    expect(stepStatusBadge("completed").label).toBe("DONE");
    expect(riskBadge("terminal").label).toBe("terminal");
    expect(riskBadge("credential-sensitive").color).toBe("#ff4d63");
  });
});

describe("plan progress + active selection", () => {
  const steps = [
    step({ id: "a", status: "completed" }),
    step({ id: "b", status: "running" }),
    step({ id: "c", status: "pending" }),
    step({ id: "d", status: "skipped" }),
  ];
  test("stepProgress counts completed+skipped as done", () => {
    expect(stepProgress(steps)).toEqual({ done: 2, total: 4, pct: 50 });
    expect(stepProgress([])).toEqual({ done: 0, total: 0, pct: 0 });
  });
  test("activeStep returns the running step", () => {
    expect(activeStep(steps)?.id).toBe("b");
    expect(activeStep([step({ id: "x", status: "pending" })])).toBeNull();
  });
  test("activeToolCall returns the latest in-flight call", () => {
    const calls = [
      tc({ id: "1", status: "succeeded", result: { success: true, output: "" } }),
      tc({ id: "2", status: "approved" }),
      tc({ id: "3", status: "rejected" }),
    ];
    expect(activeToolCall(calls)?.id).toBe("2");
    expect(activeToolCall([tc({ id: "9", status: "rejected" })])).toBeNull();
  });
});

describe("approvals + blockers", () => {
  const approvals: ApprovalRequest[] = [
    { id: "ap1", agentRunId: "r", stepId: "s", toolCallId: "t1", toolName: "write_file", riskLevel: "file-write", summary: "x", status: "pending", createdAt: "t" },
    { id: "ap2", agentRunId: "r", stepId: "s", toolCallId: "t2", toolName: "terminal", riskLevel: "terminal", summary: "y", status: "approved", createdAt: "t" },
  ];
  test("pendingApprovals filters", () => {
    expect(pendingApprovals(approvals).map((a) => a.id)).toEqual(["ap1"]);
  });
  test("blockers reflects blocked steps + pending approvals + run state", () => {
    const b = blockers("blocked", [step({ id: "z", status: "blocked", title: "exploit", summary: "no creds" })], approvals);
    expect(b.some((x) => x.includes("Run is blocked"))).toBe(true);
    expect(b.some((x) => x.includes("Step blocked: exploit"))).toBe(true);
    expect(b.some((x) => x.includes("1 tool approval"))).toBe(true);
    expect(blockers("executing", [], [])).toEqual([]);
  });
});

describe("observe-only must never be labeled ENFORCED", () => {
  const observe: AgentEvent = { id: "e1", type: "tool_observed", agentRunId: null, sessionId: "live-1", timestamp: "t", data: { toolName: "terminal", wouldDecide: "deny", enforced: false } };
  const runsTool: AgentEvent = { id: "e2", type: "tool_requested", agentRunId: "r", sessionId: "s", timestamp: "t", data: { toolName: "read_file", action: "allow" } };
  test("isObserveOnlyEvent detects observe events", () => {
    expect(isObserveOnlyEvent(observe)).toBe(true);
    expect(isObserveOnlyEvent(runsTool)).toBe(false);
  });
  test("enforcementLabel never returns ENFORCED for an observe-only event", () => {
    expect(enforcementLabel(observe)).toBe("OBSERVE-ONLY");
    expect(enforcementLabel(observe)).not.toBe("ENFORCED");
    expect(enforcementLabel(runsTool)).toBe("ENFORCED");
  });
});

describe("formatting helpers", () => {
  test("previewText truncates with a marker", () => {
    expect(previewText("short")).toBe("short");
    const long = "A".repeat(500);
    expect(previewText(long, 100).startsWith("A".repeat(100))).toBe(true);
    expect(previewText(long, 100)).toContain("+400 chars");
    expect(previewText(undefined)).toBe("");
  });
  test("shortTime extracts HH:MM:SS", () => {
    expect(shortTime("2026-06-05T03:14:37.667Z")).toBe("03:14:37");
    expect(shortTime(undefined)).toBe("");
  });
  test("previewBadges always include PREVIEW + NOT ENFORCED (never implies control)", () => {
    const labels = previewBadges().map((b) => b.label);
    expect(labels).toContain("PREVIEW");
    expect(labels).toContain("NOT ENFORCED");
    expect(labels).not.toContain("MANAGED");
    expect(labels).not.toContain("ENFORCED");
  });
  test("Phase 7.5.1: approved-plan message points to observed execution, not a future phase", () => {
    expect(MANAGED_PLAN_APPROVED_MSG).toContain("observed execution");
    const lc = MANAGED_PLAN_APPROVED_MSG.toLowerCase();
    expect(lc).not.toContain("phase 7.5");
    expect(lc).not.toContain("arrives");
    expect(lc).not.toContain("later phase");
  });
});

describe("Phase 13 cockpit nav + labels", () => {
  const runs = [
    { id: "run_a", objective: "Enumerate host", persona: "recon", status: "executing", source: "chat", mode: "managed" },
    { id: "run_b", objective: "Scan web", persona: "web", status: "completed", source: "chat", mode: "observe" },
    { id: "run_c", objective: "API run", persona: "api", status: "cancelled", source: "api" },
  ] as any[];
  test("filterRuns by query (objective/persona/id)", () => {
    expect(filterRuns(runs, { query: "enumerate" }).map(r => r.id)).toEqual(["run_a"]);
    expect(filterRuns(runs, { query: "web" }).length).toBe(1);
    expect(filterRuns(runs, { query: "run_c" }).map(r => r.id)).toEqual(["run_c"]);
  });
  test("filterRuns by status + source", () => {
    expect(filterRuns(runs, { status: "executing" }).length).toBe(1);
    expect(filterRuns(runs, { source: "api" }).length).toBe(1);
  });
  test("isArchivedRun = terminal states only", () => {
    expect(isArchivedRun({ status: "executing" })).toBe(false);
    expect(isArchivedRun({ status: "completed" })).toBe(true);
    expect(isArchivedRun({ status: "cancelled" })).toBe(true);
  });
  test("runModeLabel is unambiguous about enforcement", () => {
    expect(runModeLabel({ metadata: { gateMode: "enforce" } }).enforced).toBe(true);
    expect(runModeLabel({ metadata: { gateMode: "enforce" } }).label).toContain("ENFORCED");
    expect(runModeLabel({ metadata: { gateMode: "dry-run" } }).enforced).toBe(false);
    expect(runModeLabel({ source: "chat", mode: "managed" }).enforced).toBe(false); // Claude observe-only
    expect(runModeLabel({ source: "chat", mode: "managed" }).label).toContain("OBSERVE-ONLY");
    expect(runModeLabel({ source: "chat", mode: "observe" }).enforced).toBe(false);
    expect(runModeLabel({ source: "api" }).enforced).toBe(true);
  });
});

describe("Phase 8.1 dry-run gate observations (NOT enforced, NOT actionable)", () => {
  const dry = (would: string): AgentEvent => ({ id: "d", type: "tool_observed", agentRunId: "r", sessionId: "s", timestamp: "t", data: { toolName: "terminal", wouldDecide: would, enforced: false, mode: "dry-run" } });
  const live: AgentEvent = { id: "l", type: "tool_observed", agentRunId: null, sessionId: "live", timestamp: "t", data: { toolName: "nmap", wouldDecide: "allow", enforced: false } };
  test("isDryRunGateEvent detects dry-run mode", () => {
    expect(isDryRunGateEvent(dry("deny"))).toBe(true);
    expect(isDryRunGateEvent(live)).toBe(false);
  });
  test("dry-run is labeled DRY RUN / NOT ENFORCED — never ENFORCED", () => {
    expect(observeEventLabel(dry("deny"))).toContain("DRY RUN");
    expect(observeEventLabel(dry("deny"))).toContain("NOT ENFORCED");
    expect(observeEventLabel(dry("deny"))).not.toContain("ENFORCED ");
    expect(observeEventLabel(dry("require_approval"))).toContain("WOULD REQUIRE APPROVAL");
    expect(observeEventLabel(live)).toContain("OBSERVE-ONLY");
  });
});

describe("Phase 8.2 provider-aware run labels + enforcement note", () => {
  test("runModeLabel is provider-aware for managed runs", () => {
    expect(runModeLabel({ source: "chat", mode: "managed", providerKind: "claude" }).label).toBe("MANAGED · CLAUDE OBSERVE-ONLY");
    expect(runModeLabel({ source: "chat", mode: "managed", providerKind: "openrouter" }).label).toBe("MANAGED · OPENROUTER OBSERVE-ONLY");
    expect(runModeLabel({ source: "chat", mode: "managed", providerKind: "openai-codex" }).label).toBe("MANAGED · OPENROUTER OBSERVE-ONLY");
    // gateMode wins over provider
    expect(runModeLabel({ source: "chat", mode: "managed", providerKind: "openrouter", metadata: { gateMode: "enforce" } }).label).toBe("OR GATED · ENFORCED");
    expect(runModeLabel({ source: "chat", mode: "managed", providerKind: "openrouter", metadata: { gateMode: "dry-run" } }).enforced).toBe(false);
  });
  test("managed OpenRouter run is NEVER labeled CLAUDE", () => {
    expect(runModeLabel({ source: "chat", mode: "managed", providerKind: "openrouter" }).label).not.toContain("CLAUDE");
  });
  test("executionEnforcementNote is provider/gate-aware", () => {
    expect(executionEnforcementNote({ providerKind: "claude" })).toContain("Claude");
    expect(executionEnforcementNote({ providerKind: "claude" })).toContain("OBSERVE-ONLY");
    expect(executionEnforcementNote({ providerKind: "openrouter" })).toContain("OpenRouter");
    expect(executionEnforcementNote({ providerKind: "openrouter" })).not.toContain("Claude");
    expect(executionEnforcementNote({ providerKind: "openrouter", metadata: { gateMode: "enforce" } })).toContain("ENFORCED");
    expect(executionEnforcementNote({ providerKind: "openrouter", metadata: { gateMode: "dry-run" } })).toContain("DRY RUN");
  });
});
