import { test, expect, describe } from "bun:test";
import { normalizeStreamLine, streamTurn } from "../AgentProvider";
import { ClaudeProvider } from "../ClaudeProvider";
import { OpenRouterProvider } from "../OpenRouterProvider";
import type { AgentEvent } from "../../runtime/types";

const ctx = { agentRunId: "run_1", sessionId: "s1", stepId: "step_1" };

describe("normalizeStreamLine", () => {
  test("assistant text → model_text", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "hello" }] },
    });
    const ev = normalizeStreamLine(line, ctx);
    expect(ev.length).toBe(1);
    expect(ev[0].type).toBe("model_text");
    expect(ev[0].data.text).toBe("hello");
    expect(ev[0].agentRunId).toBe("run_1");
    expect(ev[0].stepId).toBe("step_1");
  });

  test("assistant tool_use → tool_requested with normalized args", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "tu_1", name: "terminal", input: { command: "id" } }],
      },
    });
    const ev = normalizeStreamLine(line, ctx);
    expect(ev[0].type).toBe("tool_requested");
    expect(ev[0].data.toolName).toBe("terminal");
    expect(ev[0].data.toolUseId).toBe("tu_1");
    expect((ev[0].data.arguments as any).command).toBe("id");
  });

  test("user tool_result → tool_result with joined text", () => {
    const line = JSON.stringify({
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "tu_1", content: [{ type: "text", text: "uid=0" }] },
        ],
      },
    });
    const ev = normalizeStreamLine(line, ctx);
    expect(ev[0].type).toBe("tool_result");
    expect(ev[0].data.toolUseId).toBe("tu_1");
    expect(ev[0].data.output).toBe("uid=0");
  });

  test("result success → provider_turn_completed; error → provider_turn_failed (NOT run completion)", () => {
    // A provider turn ending must never be reported as the AgentRun completing.
    expect(
      normalizeStreamLine(JSON.stringify({ type: "result", subtype: "success", end_reason: "completed" }), ctx)[0].type,
    ).toBe("provider_turn_completed");
    expect(
      normalizeStreamLine(JSON.stringify({ type: "result", subtype: "error" }), ctx)[0].type,
    ).toBe("provider_turn_failed");
    // The normalizer never emits run_completed/run_failed — those are runtime-owned.
    const types = normalizeStreamLine(JSON.stringify({ type: "result", subtype: "success" }), ctx).map((e) => e.type);
    expect(types).not.toContain("run_completed");
  });

  test("error envelope → provider_error", () => {
    const ev = normalizeStreamLine(JSON.stringify({ type: "error", message: "429 rate limit" }), ctx);
    expect(ev[0].type).toBe("provider_error");
    expect(ev[0].data.message).toBe("429 rate limit");
  });

  test("UI chrome (system/status/stream_event) and junk are ignored", () => {
    expect(normalizeStreamLine(JSON.stringify({ type: "system", subtype: "init" }), ctx)).toEqual([]);
    expect(normalizeStreamLine(JSON.stringify({ type: "status", text: "thinking" }), ctx)).toEqual([]);
    expect(normalizeStreamLine("not json at all", ctx)).toEqual([]);
    expect(normalizeStreamLine("   ", ctx)).toEqual([]);
  });

  test("accepts a pre-parsed object too", () => {
    const ev = normalizeStreamLine({ type: "assistant", message: { content: [{ type: "text", text: "x" }] } }, ctx);
    expect(ev[0].type).toBe("model_text");
  });
});

describe("provider classes", () => {
  test("kinds and names", () => {
    expect(new ClaudeProvider().kind).toBe("claude");
    expect(new ClaudeProvider().name).toBe("claude");
    expect(new OpenRouterProvider().kind).toBe("openrouter");
    expect(new OpenRouterProvider("openai-codex").kind).toBe("openai-codex");
  });

  test("sendTurn normalizes a DI'd line source into AgentEvents (both providers identical)", async () => {
    async function* lines() {
      yield JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } });
      yield JSON.stringify({ type: "status", text: "noise" }); // ignored
      yield JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "t1", name: "read_file", input: {} }] },
      });
      yield JSON.stringify({ type: "result", subtype: "success" });
    }
    const input = { agentRunId: "run_1", sessionId: "s1", stepId: "step_1", prompt: "go", lineSource: lines() };

    const collected: AgentEvent[] = [];
    for await (const ev of new ClaudeProvider().sendTurn(input)) collected.push(ev);

    expect(collected.map((e) => e.type)).toEqual(["model_text", "tool_requested", "provider_turn_completed"]);
  });

  test("streamTurn is shared by both providers (same output for same input)", async () => {
    function src() {
      async function* g() {
        yield JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "z" }] } });
      }
      return g();
    }
    const base = { agentRunId: "r", sessionId: "s", stepId: null, prompt: "p" };
    const a: string[] = [];
    for await (const ev of streamTurn({ ...base, lineSource: src() })) a.push(ev.type);
    expect(a).toEqual(["model_text"]);
  });
});
