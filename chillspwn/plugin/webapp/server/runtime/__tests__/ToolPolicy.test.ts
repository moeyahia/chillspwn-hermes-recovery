import { test, expect, describe } from "bun:test";
import {
  classifyTool,
  isSecuritySensitiveCommand,
  isCredentialSensitiveCommand,
  decideTool,
  DEFAULT_POLICY_CONFIG,
  type PolicyConfig,
} from "../ToolPolicy";

describe("ToolPolicy — classification", () => {
  test("classifyTool maps known tools", () => {
    expect(classifyTool("terminal")).toBe("terminal");
    expect(classifyTool("Bash")).toBe("terminal");
    expect(classifyTool("write_file")).toBe("file-write");
    expect(classifyTool("Edit")).toBe("file-write");
    expect(classifyTool("read_file")).toBe("read-only");
    expect(classifyTool("web_search")).toBe("network");
    expect(classifyTool("delegate_task")).toBe("terminal");
  });

  test("unknown tools default to the conservative 'terminal'", () => {
    expect(classifyTool("some_unknown_tool")).toBe("terminal");
  });

  test("offensive command detection (raw names + UPPERCASE aliases)", () => {
    expect(isSecuritySensitiveCommand("nmap -sC -sV 10.10.10.5")).toBe(true);
    expect(isSecuritySensitiveCommand("SURFACE 10.10.10.5")).toBe(true);
    expect(isSecuritySensitiveCommand("impacket-secretsdump dom/u:p@host")).toBe(true);
    expect(isSecuritySensitiveCommand("ls -la /tmp")).toBe(false);
    // word-boundary: 'STEP' alias must not match 'stepwise'
    expect(isSecuritySensitiveCommand("echo stepwise")).toBe(false);
  });

  test("credential-sensitive detection", () => {
    expect(isCredentialSensitiveCommand("cat /etc/shadow")).toBe(true);
    expect(isCredentialSensitiveCommand("impacket-secretsdump x")).toBe(true);
    expect(isCredentialSensitiveCommand("ls")).toBe(false);
  });
});

describe("ToolPolicy — decisions (secure defaults)", () => {
  test("DEFAULT_POLICY_CONFIG is secure", () => {
    expect(DEFAULT_POLICY_CONFIG.enableTerminal).toBe(false);
    expect(DEFAULT_POLICY_CONFIG.enableFileWrite).toBe(false);
    expect(DEFAULT_POLICY_CONFIG.enableSecurityTools).toBe(false);
    expect(DEFAULT_POLICY_CONFIG.requireStepBinding).toBe(true);
  });

  test("a tool call without a stepId is denied (step binding)", () => {
    const d = decideTool({ toolName: "read_file", stepId: null }, DEFAULT_POLICY_CONFIG);
    expect(d.action).toBe("deny");
    expect(d.reason).toMatch(/stepId/);
  });

  test("a tool not in the step's allowed list is denied", () => {
    const d = decideTool(
      { toolName: "terminal", stepId: "step_1", allowedTools: ["read_file"] },
      { ...DEFAULT_POLICY_CONFIG },
    );
    expect(d.action).toBe("deny");
    expect(d.reason).toMatch(/allowed tools/);
  });

  test("read-only tools are allowed under secure defaults", () => {
    const d = decideTool({ toolName: "read_file", stepId: "step_1" }, DEFAULT_POLICY_CONFIG);
    expect(d.action).toBe("allow");
    expect(d.riskLevel).toBe("read-only");
  });

  test("terminal is denied when disabled, approval-gated when enabled", () => {
    const denied = decideTool({ toolName: "terminal", stepId: "s1" }, DEFAULT_POLICY_CONFIG);
    expect(denied.action).toBe("deny");

    const enabled: PolicyConfig = { ...DEFAULT_POLICY_CONFIG, enableTerminal: true };
    const gated = decideTool({ toolName: "terminal", stepId: "s1" }, enabled);
    expect(gated.action).toBe("require_approval");

    const noApproval: PolicyConfig = { ...enabled, requireApprovalForTerminal: false };
    expect(decideTool({ toolName: "terminal", stepId: "s1" }, noApproval).action).toBe("allow");
  });

  test("offensive command is denied when security tools disabled", () => {
    const enabled: PolicyConfig = {
      ...DEFAULT_POLICY_CONFIG,
      enableTerminal: true,
      requireApprovalForTerminal: false,
      enableSecurityTools: false,
    };
    const d = decideTool({ toolName: "terminal", stepId: "s1", command: "nmap 10.0.0.1" }, enabled);
    expect(d.action).toBe("deny");
    expect(d.riskLevel === "exploit-sensitive" || d.riskLevel === "credential-sensitive").toBe(true);
  });

  test("file-write is approval-gated when enabled", () => {
    const enabled: PolicyConfig = { ...DEFAULT_POLICY_CONFIG, enableFileWrite: true };
    expect(decideTool({ toolName: "write_file", stepId: "s1" }, enabled).action).toBe("require_approval");
    expect(decideTool({ toolName: "write_file", stepId: "s1" }, DEFAULT_POLICY_CONFIG).action).toBe("deny");
  });
});
