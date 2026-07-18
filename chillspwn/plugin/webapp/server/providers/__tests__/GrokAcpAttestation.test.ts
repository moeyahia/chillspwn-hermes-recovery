import { describe, expect, test } from "bun:test";
import {
  attestGrokCommanderHooks,
  attestGrokCommanderMcps,
  attestGrokCommanderToolSurface,
  canActivateGrokCommanderBoundary,
} from "../GrokAcpAttestation";

describe("Grok ACP commander launch attestation", () => {
  test("buffered success responses cannot reactivate a failed or closing launch", () => {
    const allPassed = {
      profileAttested: true,
      hooksAttested: true,
      mcpsAttested: true,
      failed: false,
      closing: false,
      activated: false,
    };
    expect(canActivateGrokCommanderBoundary(allPassed)).toBe(true);
    expect(canActivateGrokCommanderBoundary({ ...allPassed, failed: true })).toBe(false);
    expect(canActivateGrokCommanderBoundary({ ...allPassed, closing: true })).toBe(false);
    expect(canActivateGrokCommanderBoundary({ ...allPassed, activated: true })).toBe(false);
  });

  test("accepts only the exact dispatcher surface and its approved post-MCP expansion", () => {
    expect(attestGrokCommanderToolSurface({
      sessionUpdate: "available_commands_update",
      _meta: { tools: [
        "use_tool",
        "search_tool",
        "chillspwn-board__board_list",
        "chillspwn-board__board_create_task",
        "chillspwn-board__board_update",
        "chillspwn-board__board_await",
        "chillspwn-conversation__get_recent_conversation",
        "chillspwn-conversation__recall_conversation",
      ] },
    }, true)?.ok).toBe(true);
    expect(attestGrokCommanderToolSurface({
      sessionUpdate: "available_commands_update",
      _meta: { tools: ["use_tool", "search_tool"] },
    })?.ok).toBe(true);
    expect(attestGrokCommanderToolSurface({
      sessionUpdate: "available_commands_update",
      _meta: { tools: ["use_tool", "search_tool", "run_terminal_command"] },
    })?.ok).toBe(false);
    expect(attestGrokCommanderToolSurface({
      sessionUpdate: "available_commands_update",
      _meta: { tools: ["use_tool", "search_tool", { name: "run_terminal_command" }] },
    }, true)?.ok).toBe(false);
  });

  test("requires exactly one enabled global guard", () => {
    const good = { result: { hooks: [{
      event: "pre_tool_use",
      handlerType: "command",
      disabled: false,
      matcher: null,
      command: "\"/opt/chillspwn-runtime/bin/bun\" \"/app/guard.ts\"",
      timeoutMs: 5_000,
      sourceDir: "/isolated/.grok/hooks",
    }] } };
    expect(attestGrokCommanderHooks(good, "/app/guard.ts", "/isolated/.grok/hooks").ok).toBe(true);
    expect(attestGrokCommanderHooks({ result: { hooks: [] } }, "/app/guard.ts").ok).toBe(false);
    expect(attestGrokCommanderHooks({ result: { hooks: [{ ...good.result.hooks[0], disabled: true }] } }, "/app/guard.ts").ok).toBe(false);
    expect(attestGrokCommanderHooks(good, "/app/guard.ts", "/other/hooks").ok).toBe(false);
  });

  test("allows exactly the expected local MCPs and no managed gateway", () => {
    const response = { result: { servers: [
      { name: "chillspwn-board", source: "local", session: { enabled: true, status: "ready", tools: [
        { name: "board_await", enabled: true },
        { name: "board_create_task", enabled: true },
        { name: "board_list", enabled: true },
        { name: "board_update", enabled: true },
      ] } },
      { name: "chillspwn-conversation", source: "local", session: { enabled: true, status: "ready", tools: [
        { name: "get_recent_conversation", enabled: true },
        { name: "recall_conversation", enabled: true },
      ] } },
    ] } };
    expect(attestGrokCommanderMcps(response, ["chillspwn-board", "chillspwn-conversation"]).ok).toBe(true);
    expect(attestGrokCommanderMcps(response, []).ok).toBe(false);
    const initializing = structuredClone(response);
    initializing.result.servers[0].session.status = "initializing";
    expect(attestGrokCommanderMcps(initializing, ["chillspwn-board", "chillspwn-conversation"]).retryable).toBe(true);
    const poisoned = structuredClone(response);
    poisoned.result.servers.push({ name: "unwanted", source: "local", session: { enabled: true, status: "ready" } } as any);
    expect(attestGrokCommanderMcps(poisoned, ["chillspwn-board", "chillspwn-conversation"]).ok).toBe(false);
    const managed = structuredClone(response);
    managed.result.servers.push({ name: "managed_gateway:tasks", source: "managed", session: { enabled: true, status: "ready" } } as any);
    expect(attestGrokCommanderMcps(managed, ["chillspwn-board", "chillspwn-conversation"]).ok).toBe(false);
    const extraTool = structuredClone(response);
    extraTool.result.servers[0].session.tools.push({ name: "terminal", enabled: true } as any);
    expect(attestGrokCommanderMcps(extraTool, ["chillspwn-board", "chillspwn-conversation"]).ok).toBe(false);
    const disabledTool = structuredClone(response);
    disabledTool.result.servers[1].session.tools[0].enabled = false;
    expect(attestGrokCommanderMcps(disabledTool, ["chillspwn-board", "chillspwn-conversation"]).ok).toBe(false);
    const malformedServer = structuredClone(response) as any;
    malformedServer.result.servers.push({ name: { disguised: "unwanted" }, source: "local", session: { enabled: true, status: "ready", tools: [] } });
    expect(attestGrokCommanderMcps(malformedServer, ["chillspwn-board", "chillspwn-conversation"]).ok).toBe(false);
    const malformedTool = structuredClone(response) as any;
    malformedTool.result.servers[0].session.tools.push({ disguised: "terminal" });
    expect(attestGrokCommanderMcps(malformedTool, ["chillspwn-board", "chillspwn-conversation"]).ok).toBe(false);
  });
});
