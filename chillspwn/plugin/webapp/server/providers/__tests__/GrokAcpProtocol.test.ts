import { describe, expect, test } from "bun:test";
import {
  GROK_ACP_CLIENT_CAPABILITIES,
  acpNotification,
  buildGrokAgentArgs,
  classifyGrokStopReason,
  extractGrokToolOutput,
  grokAcpInitializeParams,
  isAcpClientRequest,
  isFinalGrokToolUpdate,
  permissionCancelledResponse,
  permissionSelectedResponse,
  selectPermissionOption,
  unsupportedAcpMethodResponse,
  type AcpPermissionOption,
} from "../GrokAcpProtocol";

describe("Grok ACP process and initialize parameters", () => {
  test("places every agent option before the stdio subcommand", () => {
    expect(buildGrokAgentArgs("grok-4.5", false)).toEqual([
      "agent",
      "-m",
      "grok-4.5",
      "--reasoning-effort",
      "high",
      "stdio",
    ]);
    expect(buildGrokAgentArgs("grok-4.5", true)).toEqual([
      "agent",
      "-m",
      "grok-4.5",
      "--reasoning-effort",
      "high",
      "--always-approve",
      "stdio",
    ]);
  });

  test("does not advertise unimplemented filesystem or terminal callbacks", () => {
    expect(GROK_ACP_CLIENT_CAPABILITIES).toEqual({});
    expect(Object.isFrozen(GROK_ACP_CLIENT_CAPABILITIES)).toBe(true);
    expect(grokAcpInitializeParams()).toEqual({ protocolVersion: 1, clientCapabilities: {} });
  });
});

describe("Grok ACP JSON-RPC routing", () => {
  test("recognizes inbound requests, including ID zero, before response IDs", () => {
    expect(isAcpClientRequest({ jsonrpc: "2.0", id: 0, method: "session/request_permission", params: {} })).toBe(true);
    expect(isAcpClientRequest({ jsonrpc: "2.0", id: "agent-1", method: "fs/read_text_file" })).toBe(true);
    expect(isAcpClientRequest({ jsonrpc: "2.0", id: 0, result: {} })).toBe(false);
    expect(isAcpClientRequest({ jsonrpc: "2.0", method: "session/update", params: {} })).toBe(false);
    expect(isAcpClientRequest({ jsonrpc: "2.0", id: null, method: "invalid" })).toBe(false);
  });

  test("builds a notification with no request ID", () => {
    const notification = acpNotification("session/cancel", { sessionId: "grok-session" });
    expect(notification).toEqual({
      jsonrpc: "2.0",
      method: "session/cancel",
      params: { sessionId: "grok-session" },
    });
    expect("id" in notification).toBe(false);
  });

  test("builds a JSON-RPC method-not-found response", () => {
    expect(unsupportedAcpMethodResponse(0, "terminal/create")).toEqual({
      jsonrpc: "2.0",
      id: 0,
      error: { code: -32601, message: "Method not found: terminal/create" },
    });
  });
});

describe("Grok ACP permissions", () => {
  const options: AcpPermissionOption[] = [
    { optionId: "always-reject", kind: "reject_always", name: "Never" },
    { optionId: "always-allow", kind: "allow_always", name: "Always" },
    { optionId: "once-reject", kind: "reject_once", name: "No" },
    { optionId: "once-allow", kind: "allow_once", name: "Yes" },
  ];

  test("prefers once over always for both approval decisions", () => {
    expect(selectPermissionOption(options, true)?.optionId).toBe("once-allow");
    expect(selectPermissionOption(options, false)?.optionId).toBe("once-reject");
  });

  test("falls back to the matching always option and never invents one", () => {
    expect(selectPermissionOption(options.slice(0, 2), true)?.optionId).toBe("always-allow");
    expect(selectPermissionOption(options.slice(0, 2), false)?.optionId).toBe("always-reject");
    expect(selectPermissionOption([{ optionId: "x", kind: "other" }], true)).toBeUndefined();
    expect(selectPermissionOption(undefined, false)).toBeUndefined();
  });

  test("builds the exact selected and cancelled ACP response outcomes", () => {
    expect(permissionSelectedResponse("permission-1", "once-allow")).toEqual({
      jsonrpc: "2.0",
      id: "permission-1",
      result: { outcome: { outcome: "selected", optionId: "once-allow" } },
    });
    expect(permissionCancelledResponse("permission-2")).toEqual({
      jsonrpc: "2.0",
      id: "permission-2",
      result: { outcome: { outcome: "cancelled" } },
    });
  });
});

describe("Grok ACP stop reasons", () => {
  test("classifies all protocol stop reasons", () => {
    expect(classifyGrokStopReason("end_turn")).toBe("completed");
    expect(classifyGrokStopReason("cancelled")).toBe("cancelled");
    expect(classifyGrokStopReason("max_tokens")).toBe("limit");
    expect(classifyGrokStopReason("max_turn_requests")).toBe("limit");
    expect(classifyGrokStopReason("refusal")).toBe("refused");
    expect(classifyGrokStopReason("future_reason")).toBe("unknown");
    expect(classifyGrokStopReason(null)).toBe("unknown");
  });
});

describe("Grok ACP tool output", () => {
  test("only completed and failed statuses are final", () => {
    expect(isFinalGrokToolUpdate({ status: "completed" })).toBe(true);
    expect(isFinalGrokToolUpdate({ status: "Failed" })).toBe(true);
    expect(isFinalGrokToolUpdate({ status: "in_progress", rawOutput: { output_for_prompt: "partial" } })).toBe(false);
    expect(isFinalGrokToolUpdate({ status: null })).toBe(false);
  });

  test("ignores initial metadata content until final or raw output exists", () => {
    expect(
      extractGrokToolOutput({
        status: null,
        content: [{ type: "content", content: { type: "text", text: "command description" } }],
      }),
    ).toBe("");
  });

  test("prefers Grok rawOutput and extracts terminal output while it streams", () => {
    expect(
      extractGrokToolOutput({
        status: "in_progress",
        content: [{ type: "content", content: { type: "text", text: "stale" } }],
        rawOutput: { type: "Bash", output_for_prompt: "exit: 0\nhello\n" },
      }),
    ).toBe("exit: 0\nhello\n");
  });

  test("flattens nested ACP content on completion", () => {
    expect(
      extractGrokToolOutput({
        status: "completed",
        content: [
          { type: "content", content: { type: "text", text: "first" } },
          { type: "content", content: { type: "text", text: "second" } },
        ],
      }),
    ).toBe("first\nsecond");
  });

  test("handles Grok ListDir payloads and byte-array terminal output", () => {
    expect(
      extractGrokToolOutput({
        status: "completed",
        rawOutput: { type: "ListDir", Content: { content: "- package.json\n- server/" } },
      }),
    ).toBe("- package.json\n- server/");
    expect(
      extractGrokToolOutput({
        status: "failed",
        rawOutput: { type: "Bash", output: [101, 114, 114, 111, 114, 10] },
      }),
    ).toBe("error\n");
  });

  test("handles malformed and cyclic values without throwing", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.content = cyclic;
    expect(extractGrokToolOutput({ status: "completed", content: cyclic })).toBe("");
    expect(extractGrokToolOutput(null)).toBe("");
  });
});
