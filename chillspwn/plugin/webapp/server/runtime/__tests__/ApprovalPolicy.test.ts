import { test, expect, describe } from "bun:test";
import { decideApproval, type ApprovalPolicyConfig } from "../ApprovalPolicy";

const cfg = (over: Partial<ApprovalPolicyConfig> = {}): ApprovalPolicyConfig => ({
  mode: "human", autoApproveRiskClasses: ["read-only", "network"], autoApproveToolNames: [], autoApproveAgentIds: [], autoApproveMaxRisk: "network", ...over,
});

describe("Part 1 — approval mode policy", () => {
  test("human: never auto-approves", () => {
    expect(decideApproval({ toolName: "quick_scan", riskLevel: "network" }, cfg({ mode: "human" })).autoApprove).toBe(false);
    expect(decideApproval({ toolName: "x", riskLevel: "read-only" }, cfg({ mode: "human" })).autoApprove).toBe(false);
  });
  test("auto: auto-approves any policy-passing action (incl. terminal)", () => {
    expect(decideApproval({ toolName: "terminal", riskLevel: "terminal" }, cfg({ mode: "auto" })).autoApprove).toBe(true);
    const d = decideApproval({ toolName: "ffuf_dir", riskLevel: "network" }, cfg({ mode: "auto" }));
    expect(d.autoApprove).toBe(true); expect(d.reason).toContain("auto mode");
  });
  test("hybrid: auto-approves read-only/network, human for high-risk", () => {
    expect(decideApproval({ toolName: "list_x", riskLevel: "read-only" }, cfg({ mode: "hybrid" })).autoApprove).toBe(true);
    expect(decideApproval({ toolName: "quick_scan", riskLevel: "network" }, cfg({ mode: "hybrid" })).autoApprove).toBe(true);
    expect(decideApproval({ toolName: "run_cmd", riskLevel: "terminal" }, cfg({ mode: "hybrid" })).autoApprove).toBe(false);
    expect(decideApproval({ toolName: "write_file", riskLevel: "file-write" }, cfg({ mode: "hybrid" })).autoApprove).toBe(false);
    expect(decideApproval({ toolName: "hashcat", riskLevel: "credential-sensitive" }, cfg({ mode: "hybrid" })).autoApprove).toBe(false);
    expect(decideApproval({ toolName: "x", riskLevel: "exploit-sensitive" }, cfg({ mode: "hybrid" })).autoApprove).toBe(false);
  });
  test("hybrid: sensitive tools always need human even if low risk", () => {
    expect(decideApproval({ toolName: "delegate_task", riskLevel: "read-only" }, cfg({ mode: "hybrid" })).autoApprove).toBe(false);
    expect(decideApproval({ toolName: "remember", riskLevel: "read-only" }, cfg({ mode: "hybrid" })).autoApprove).toBe(false);
    expect(decideApproval({ toolName: "skill_manage", riskLevel: "network" }, cfg({ mode: "hybrid" })).autoApprove).toBe(false);
  });
  test("hybrid: AUTO_APPROVE_MAX_RISK caps", () => {
    expect(decideApproval({ toolName: "x", riskLevel: "network" }, cfg({ mode: "hybrid", autoApproveRiskClasses: ["read-only", "network", "file-write"], autoApproveMaxRisk: "read-only" })).autoApprove).toBe(false);
  });
  test("explicit AUTO_APPROVE_TOOL_NAMES always auto (non-human)", () => {
    expect(decideApproval({ toolName: "special_tool", riskLevel: "terminal" }, cfg({ mode: "hybrid", autoApproveToolNames: ["special_tool"] })).autoApprove).toBe(true);
    expect(decideApproval({ toolName: "special_tool", riskLevel: "terminal" }, cfg({ mode: "human", autoApproveToolNames: ["special_tool"] })).autoApprove).toBe(false);
  });
  test("AUTO_APPROVE_AGENT_IDS restricts auto-approval", () => {
    const c = cfg({ mode: "auto", autoApproveAgentIds: ["ReconScout"] });
    expect(decideApproval({ toolName: "x", riskLevel: "network", agentId: "ReconScout" }, c).autoApprove).toBe(true);
    expect(decideApproval({ toolName: "x", riskLevel: "network", agentId: "WebBreaker" }, c).autoApprove).toBe(false);
    expect(decideApproval({ toolName: "x", riskLevel: "network", agentId: null }, c).autoApprove).toBe(false);
  });
});
