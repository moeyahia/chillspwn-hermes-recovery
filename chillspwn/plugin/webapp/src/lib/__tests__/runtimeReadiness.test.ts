import { describe, expect, test } from "bun:test";
import { parseRuntimeReadiness } from "../../domain/schemas/runtimeReadiness";

describe("runtime readiness client contract", () => {
  test("retains MCP initialization and exact Guided tool execution", () => {
    const parsed = parseRuntimeReadiness({
      schemaVersion: "2.4",
      status: "degraded",
      execution: {
        autonomous: "unavailable",
        guided: "ready",
        guidedToolExecution: "unavailable",
        actionBoundaryActive: false,
        delegationEnforced: true,
        noHandsCommanderEnforced: true,
      },
      dependencies: {
        providers: {
          status: "available",
          initializing: false,
          probing: 0,
          reason: "Provider ready.",
          declared: 1,
          callable: 1,
          enforcing: 1,
          guidedCapable: 1,
        },
        mcp: {
          status: "unavailable",
          initializing: true,
          probingServers: 3,
          reason: "Tool routes are being checked.",
          configuredServers: 4,
          runnableServers: 0,
          executionMode: "enabled",
        },
      },
      checkedAt: "2026-07-18T06:00:00.000Z",
    });

    expect(parsed.execution.guided).toBe("ready");
    expect(parsed.execution.guidedToolExecution).toBe("unavailable");
    expect(parsed.dependencies.mcp).toMatchObject({
      initializing: true,
      probingServers: 3,
      reason: "Tool routes are being checked.",
    });
  });
});
