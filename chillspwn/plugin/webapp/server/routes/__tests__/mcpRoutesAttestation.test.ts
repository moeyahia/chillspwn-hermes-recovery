import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpExecutionBinding } from "../../mcp/McpApprovalAttestation";
import type { McpArsenalBridge, McpBridgeExecuteInput } from "../../mcp/McpArsenalBridge";
import type { McpToolResult } from "../../mcp/McpTypes";
import { AgentRunStore } from "../../runtime/AgentRunStore";
import { AgentRuntime } from "../../runtime/AgentRuntime";
import { MemoryBoardSink } from "../../runtime/BoardSink";
import { EventLog } from "../../runtime/EventLog";
import { DEFAULT_POLICY_CONFIG } from "../../runtime/ToolPolicy";
import { registerMcpRoutes } from "../mcpRoutes";

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "chillspwn-mcp-attestation-route-"));
});

afterEach(() => {
  try { rmSync(directory, { recursive: true, force: true }); } catch {}
});

function result(input: McpBridgeExecuteInput, success: boolean, error: string | null): McpToolResult {
  return {
    success,
    dryRun: false,
    mcpServer: input.mcpServer,
    toolName: input.toolName,
    specialistAgentId: input.specialistAgentId,
    outputPreview: success ? "exact approved execution" : "",
    fullOutputBytes: success ? 24 : 0,
    artifactId: null,
    evidenceIds: [],
    error,
    durationMs: 0,
    isError: !success,
  };
}

describe("legacy MCP route exact durable approval", () => {
  test("claims before dispatch and rejects changed arguments/server/tool plus replay", async () => {
    const runtime = new AgentRuntime({
      store: new AgentRunStore(directory),
      events: new EventLog({ dir: directory }),
      board: new MemoryBoardSink(),
      policy: {
        ...DEFAULT_POLICY_CONFIG,
        enableTerminal: true,
        requireApprovalForTerminal: true,
      },
    });
    const run = runtime.createRun({
      sessionId: "session-mcp-route",
      persona: "reconscout",
      providerKind: "openrouter",
      objective: "Authorized exact MCP route test",
    });
    runtime.beginPlanning(run.id);
    const { steps } = runtime.submitPlan(run.id, {
      steps: [{
        title: "Exact scan",
        purpose: "Test the durable MCP gate",
        successCriteria: "One exact result",
        allowedTools: ["nmapScan"],
      }],
    });
    runtime.approvePlan(run.id);
    runtime.startStep(run.id, steps[0]!.id);

    const executions: McpBridgeExecuteInput[] = [];
    const fakeBridge = {
      loadError: () => null,
      isDryRun: () => false,
      async execute(input: McpBridgeExecuteInput): Promise<McpToolResult> {
        const attestation = input.approvalAttestation;
        if (!attestation || !input.runId || !input.stepId) return result(input, false, "missing exact attestation");
        const binding = createMcpExecutionBinding({
          runId: input.runId,
          stepId: input.stepId,
          specialistAgentId: input.specialistAgentId,
          mcpServer: input.mcpServer,
          toolName: input.toolName,
          arguments: input.arguments,
        });
        const verified = runtime.verifyAndConsumeMcpApprovalAttestation({
          attestation,
          binding,
          verifiedAt: new Date().toISOString(),
        });
        if (!verified.approved) return result(input, false, verified.reason);
        executions.push(input);
        return result(input, true, null);
      },
    } as unknown as McpArsenalBridge;

    const app = express();
    app.use(express.json());
    registerMcpRoutes(app, {
      bridge: () => fakeBridge,
      agentRuntime: runtime,
      guardSeg: () => true,
      enabled: () => true,
      routingConfig: () => ({
        enableSpecialistRouting: true,
        enforceChillspwnDelegation: true,
        allowChillspwnDirectTools: false,
        requireSpecialistAssignment: true,
        enforceChillspwnNoHands: true,
      }),
      nowMs: () => Date.now(),
      log: () => {},
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const base = {
      runId: run.id,
      stepId: steps[0]!.id,
      actorAgentId: "ReconScout",
      specialistAgentId: "ReconScout",
      mcpServer: "mock-recon",
      toolName: "nmapScan",
      arguments: { target: "10.0.0.9" },
    };
    const post = (body: Record<string, unknown>) => fetch(`${origin}/api/mcp/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const requestAndApprove = async (): Promise<string> => {
      const response = await post(base);
      const pending = await response.json() as { decision: string; toolCallId: string };
      expect(pending.decision).toBe("awaiting_approval");
      const approvalId = runtime.getToolCall(run.id, pending.toolCallId)!.approvalId!;
      runtime.resolveApproval(run.id, approvalId, "approve", { resolvedBy: "operator:local" });
      return pending.toolCallId;
    };

    try {
      const exactToolCallId = await requestAndApprove();
      const exact = await post({ ...base, toolCallId: exactToolCallId });
      expect(exact.status).toBe(200);
      expect(await exact.json()).toMatchObject({ success: true, decision: "executed" });
      expect(executions).toHaveLength(1);
      expect(executions[0]!.approvalAttestation).toMatchObject({
        kind: "legacy_tool_approval",
        runId: run.id,
        stepId: steps[0]!.id,
        toolCallId: exactToolCallId,
        specialistAgentId: "ReconScout",
        mcpServer: "mock-recon",
        toolName: "nmapScan",
        actorId: "operator:local",
      });

      const replay = await post({ ...base, toolCallId: exactToolCallId });
      expect(replay.status).toBe(409);
      expect(executions).toHaveLength(1);

      const changedArgsId = await requestAndApprove();
      expect((await post({ ...base, arguments: { target: "10.0.0.10" }, toolCallId: changedArgsId })).status).toBe(409);
      const changedServerId = await requestAndApprove();
      expect((await post({ ...base, mcpServer: "other-server", toolCallId: changedServerId })).status).toBe(409);
      const changedToolId = await requestAndApprove();
      expect((await post({ ...base, toolName: "gobuster", toolCallId: changedToolId })).status).toBe(409);
      expect(executions).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
