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

  test("rebuildFrom re-attaches only executing, source=chat runs", () => {
    const store: RunLister = {
      listRuns: () => [
        { id: "run_a", sessionId: "sA", persona: "p", providerKind: "claude", objective: "o", status: "executing", source: "chat" },
        { id: "run_b", sessionId: "sB", persona: "p", providerKind: "openrouter", objective: "o", status: "completed", source: "chat" }, // terminal → skip
        { id: "run_c", sessionId: "sC", persona: "p", providerKind: "claude", objective: "o", status: "executing", source: "api" }, // api → skip
        { id: "run_d", sessionId: "sD", persona: "p", providerKind: "claude", objective: "o", status: "executing" }, // no source → skip
      ],
    };
    const m = new SessionRunMap(() => 1);
    const n = m.rebuildFrom(store);
    expect(n).toBe(1);
    expect(m.get("sA")?.runId).toBe("run_a");
    expect(m.has("sB")).toBe(false);
    expect(m.has("sC")).toBe(false);
    expect(m.has("sD")).toBe(false);
  });

  test("rebuildFrom never throws if the store throws", () => {
    const bad: RunLister = { listRuns: () => { throw new Error("disk"); } };
    const m = new SessionRunMap();
    expect(() => m.rebuildFrom(bad)).not.toThrow();
    expect(m.rebuildFrom(bad)).toBe(0);
  });
});
