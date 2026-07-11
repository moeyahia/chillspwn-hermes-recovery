import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { AgentRuntime } from "../AgentRuntime";
import { AgentRunStore } from "../AgentRunStore";
import { EventLog } from "../EventLog";
import { MemoryBoardSink } from "../BoardSink";
import { DEFAULT_POLICY_CONFIG } from "../ToolPolicy";

let dir: string;
let store: AgentRunStore;
let events: EventLog;
let rt: AgentRuntime;

const INPUT = { sessionId: "sess-1", persona: "chillspwn", providerKind: "claude" as const, objective: "triage host" };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "chillspwn-chatrun-"));
  store = new AgentRunStore(dir);
  events = new EventLog({ dir });
  rt = new AgentRuntime({ store, events, board: new MemoryBoardSink(), policy: DEFAULT_POLICY_CONFIG });
});
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

describe("createChatRun", () => {
  test("creates an observe-only run, executing, no steps, persisted, emits run_created", () => {
    const run = rt.createChatRun(INPUT);
    expect(run.source).toBe("chat");
    expect(run.mode).toBe("observe");
    expect(run.status).toBe("executing");
    expect(run.stepIds).toEqual([]);
    expect(run.sessionId).toBe("sess-1");
    expect(store.getRun(run.id)?.status).toBe("executing");
    expect(events.queryByRun(run.id).some((e) => e.type === "run_created")).toBe(true);
  });

  test("recordProviderTurn does NOT complete the chat run (stays executing)", () => {
    const run = rt.createChatRun(INPUT);
    rt.recordProviderTurn(run.id, "completed");
    rt.recordProviderTurn(run.id, "failed");
    expect(store.getRun(run.id)?.status).toBe("executing");
  });

  test("observeToolCall records OBSERVE-ONLY (enforced=false) — never an enforced ToolCall", () => {
    const run = rt.createChatRun(INPUT);
    const res = rt.observeToolCall({ runId: run.id, sessionId: "sess-1", toolName: "Bash", command: "nmap -sV 10.0.0.1" });
    expect(res.enforced).toBe(false);
    // A `tool_observed` event is recorded; NO enforced ToolCall is created.
    expect(events.queryByRun(run.id).some((e) => e.type === "tool_observed")).toBe(true);
    expect(rt.getDoc(run.id)?.toolCalls ?? []).toEqual([]);
  });
});

describe("finalizeChatRun", () => {
  test("completes an executing chat run", () => {
    const run = rt.createChatRun(INPUT);
    rt.finalizeChatRun(run.id, "session ended");
    expect(store.getRun(run.id)?.status).toBe("completed");
  });

  test("is a safe no-op (no throw) when the run is already terminal or unknown", () => {
    const run = rt.createChatRun(INPUT);
    rt.finalizeChatRun(run.id);
    expect(store.getRun(run.id)?.status).toBe("completed");
    expect(() => rt.finalizeChatRun(run.id)).not.toThrow(); // already completed
    expect(() => rt.finalizeChatRun("run_does_not_exist")).not.toThrow();
    expect(store.getRun(run.id)?.status).toBe("completed");
  });
});
