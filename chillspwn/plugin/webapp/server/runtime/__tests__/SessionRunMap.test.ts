import { test, expect, describe } from "bun:test";
import { SessionRunMap, type RunLister } from "../SessionRunMap";

describe("SessionRunMap", () => {
  test("set/get/has/delete + injected clock for startedAt/lastUpdatedAt", () => {
    let t = 100;
    const m = new SessionRunMap(() => t);
    expect(m.has("s1")).toBe(false);
    const e = m.set("s1", { runId: "run_1", provider: "claude", persona: "p", objective: "o" });
    expect(e.startedAt).toBe(100);
    expect(m.get("s1")?.runId).toBe("run_1");
    expect(m.has("s1")).toBe(true);
    t = 200;
    m.touch("s1");
    expect(m.get("s1")?.lastUpdatedAt).toBe(200);
    expect(m.get("s1")?.startedAt).toBe(100);
    m.delete("s1");
    expect(m.has("s1")).toBe(false);
    expect(m.size()).toBe(0);
  });

  test("rebuildFrom re-attaches only executing, observe-mode chat runs", () => {
    const store: RunLister = {
      listRuns: () => [
        { id: "run_a", sessionId: "sA", persona: "p", providerKind: "claude", objective: "o", status: "executing", source: "chat", mode: "observe" },
        { id: "run_b", sessionId: "sB", persona: "p", providerKind: "openrouter", objective: "o", status: "completed", source: "chat", mode: "observe" }, // terminal → skip
        { id: "run_c", sessionId: "sC", persona: "p", providerKind: "claude", objective: "o", status: "executing", source: "api", mode: "observe" }, // api → skip
        { id: "run_d", sessionId: "sD", persona: "p", providerKind: "claude", objective: "o", status: "executing", mode: "observe" }, // no source → skip
        { id: "run_e", sessionId: "sE", persona: "p", providerKind: "xai-grok", objective: "o", status: "executing", source: "chat", mode: "managed" }, // managed → skip
      ],
    };
    const m = new SessionRunMap(() => 1);
    const n = m.rebuildFrom(store);
    expect(n).toBe(1);
    expect(m.get("sA")?.runId).toBe("run_a");
    expect(m.has("sB")).toBe(false);
    expect(m.has("sC")).toBe(false);
    expect(m.has("sD")).toBe(false);
    expect(m.has("sE")).toBe(false);
  });

  test("rebuildFrom never throws if the store throws", () => {
    const bad: RunLister = { listRuns: () => { throw new Error("disk"); } };
    const m = new SessionRunMap();
    expect(() => m.rebuildFrom(bad)).not.toThrow();
    expect(m.rebuildFrom(bad)).toBe(0);
  });
});
