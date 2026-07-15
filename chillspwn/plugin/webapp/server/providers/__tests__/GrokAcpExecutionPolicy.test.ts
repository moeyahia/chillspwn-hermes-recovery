import { describe, expect, test } from "bun:test";
import {
  evaluateGrokAcpTool,
  grokAcpEffectiveToolName,
  grokAcpToolInput,
  grokAcpToolName,
  isGrokCommanderPersona,
  supportsGrokPreToolDeny,
} from "../GrokAcpExecutionPolicy";

const nativePermission = (name: string, rawInput: Record<string, unknown> = {}) => ({
  options: [
    { optionId: "allow", kind: "allow_once" },
    { optionId: "reject", kind: "reject_once" },
  ],
  toolCall: {
    _meta: { "x.ai/tool": { name, kind: "execute", namespace: "grok_build", read_only: false } },
    rawInput,
  },
});

describe("Grok ACP commander execution policy", () => {
  test("extracts real native and MCP-dispatch tool identities", () => {
    const terminal = nativePermission("run_terminal_command", { command: "id" });
    expect(grokAcpToolName(terminal)).toBe("run_terminal_command");
    expect(grokAcpToolInput(terminal)).toEqual({ command: "id" });

    const board = {
      toolName: "use_tool",
      toolInput: { tool_name: "chillspwn-board__board_create_task", tool_input: { agent: "ReverseSage" } },
    };
    expect(grokAcpEffectiveToolName(board)).toBe("chillspwn-board__board_create_task");
  });

  test("hard-denies native terminal, edit, private subagent, and polling paths", () => {
    for (const tool of [
      "run_terminal_command",
      "search_replace",
      "spawn_subagent",
      "get_command_or_subagent_output",
      "wait_commands_or_subagents",
      "kill_command_or_subagent",
      "tasks__create",
      "tasks__get_results",
    ]) {
      expect(evaluateGrokAcpTool("commander", nativePermission(tool), true).action).toBe("deny");
    }
  });

  test("allows only board and conversation MCP coordination", () => {
    for (const tool of [
      "chillspwn-board__board_list",
      "chillspwn-board__board_create_task",
      "chillspwn-board__board_update",
      "chillspwn-board__board_await",
      "chillspwn-conversation__get_recent_conversation",
      "chillspwn-conversation__recall_conversation",
    ]) {
      expect(evaluateGrokAcpTool("commander", { toolName: tool, toolInput: {} }, true).action).toBe("allow");
    }
    expect(evaluateGrokAcpTool("commander", {
      toolName: "use_tool",
      toolInput: { tool_name: "radare2__analyze_binary", tool_input: {} },
    }, true).action).toBe("deny");
  });

  test("fails closed for malformed/unknown commander tools", () => {
    expect(evaluateGrokAcpTool("commander", {}, true).action).toBe("deny");
    expect(evaluateGrokAcpTool("commander", { toolName: "future_mutating_tool" }, true).action).toBe("deny");
  });

  test("planning is tool-free while specialists retain execution", () => {
    expect(evaluateGrokAcpTool("planner", { toolName: "chillspwn-board__board_list" }, true).action).toBe("deny");
    expect(evaluateGrokAcpTool("specialist", nativePermission("run_terminal_command"), true).action).toBe("allow");
  });

  test("detects the exact ACP pre-tool deny capability", () => {
    const supported = {
      agentCapabilities: {
        _meta: { "x.ai/hooks": { blockingEvents: ["pre_tool_use"], decisions: ["deny"] } },
      },
    };
    expect(supportsGrokPreToolDeny(supported)).toBe(true);
    expect(supportsGrokPreToolDeny({ agentCapabilities: { _meta: { "x.ai/hooks": { blockingEvents: [], decisions: ["deny"] } } } })).toBe(false);
    expect(supportsGrokPreToolDeny(null)).toBe(false);
  });

  test("recognizes commander aliases only", () => {
    for (const name of ["ChillsPwn", "commander", "commander-in-chief", "orchestrator"]) {
      expect(isGrokCommanderPersona(name)).toBe(true);
    }
    expect(isGrokCommanderPersona("ReverseSage")).toBe(false);
  });
});
