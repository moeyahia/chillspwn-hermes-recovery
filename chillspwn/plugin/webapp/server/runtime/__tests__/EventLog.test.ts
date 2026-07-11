import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { EventLog } from "../EventLog";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "chillspwn-eventlog-"));
});
afterEach(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
});

describe("EventLog", () => {
  test("appends events and reads them back in order", () => {
    const log = new EventLog({ dir });
    log.append({ type: "run_created", agentRunId: "run_1", sessionId: "s1" });
    log.append({ type: "step_started", agentRunId: "run_1", sessionId: "s1", stepId: "step_1" });
    log.append({ type: "run_completed", agentRunId: "run_1", sessionId: "s1" });

    const all = log.readAll();
    expect(all.length).toBe(3);
    expect(all[0].type).toBe("run_created");
    expect(all[2].type).toBe("run_completed");
    expect(existsSync(log.filePath)).toBe(true);
  });

  test("queryByRun / queryBySession filter correctly", () => {
    const log = new EventLog({ dir });
    log.append({ type: "run_created", agentRunId: "run_A", sessionId: "sX" });
    log.append({ type: "run_created", agentRunId: "run_B", sessionId: "sY" });
    log.append({ type: "tool_requested", agentRunId: "run_A", sessionId: "sX" });

    expect(log.queryByRun("run_A").length).toBe(2);
    expect(log.queryByRun("run_B").length).toBe(1);
    expect(log.queryBySession("sX").length).toBe(2);
    expect(log.queryBySession("sY").length).toBe(1);
  });

  test("onEvent sink is invoked and a throwing sink is non-fatal", () => {
    const seen: string[] = [];
    const log = new EventLog({
      dir,
      onEvent: (e) => {
        seen.push(e.type);
        throw new Error("sink boom"); // must not propagate
      },
    });
    expect(() => log.append({ type: "security_event" })).not.toThrow();
    expect(seen).toEqual(["security_event"]);
  });

  test("readAll on a missing log returns empty", () => {
    const log = new EventLog({ dir: join(dir, "does-not-exist-yet") });
    expect(log.readAll()).toEqual([]);
  });
});
