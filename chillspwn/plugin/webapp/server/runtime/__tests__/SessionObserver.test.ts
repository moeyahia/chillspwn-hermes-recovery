import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SessionObserver, type ObserverRuntime } from "../SessionObserver";

// stream-json fixtures (claude/OR envelope shapes that normalizeStreamLine understands)
const TOOL = JSON.stringify({
  type: "assistant",
  message: { content: [{ type: "tool_use", name: "Bash", id: "t1", input: { command: "nmap -sV 10.0.0.1" } }] },
});
const RESULT_OK = JSON.stringify({ type: "result", subtype: "success" });
const RESULT_ERR = JSON.stringify({ type: "result", subtype: "error" });

function spy() {
  const calls = { observed: [] as any[], turns: [] as Array<{ runId: string; kind: string }>, finalized: [] as string[] };
  const rt: ObserverRuntime = {
    observeToolCall(a) { calls.observed.push(a); return { wouldDecide: "allow", riskLevel: "read-only", reason: "", enforced: false }; },
    recordProviderTurn(runId, kind) { calls.turns.push({ runId, kind }); },
    finalizeChatRun(runId) { calls.finalized.push(runId); },
  };
  return { rt, calls };
}

let dir: string;
let logPath: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "chillspwn-obs-")); logPath = join(dir, "s.stdout.jsonl"); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

function obs(rt: ObserverRuntime, extra: Partial<ConstructorParameters<typeof SessionObserver>[0]> = {}) {
  return new SessionObserver({ sessionId: "s", runId: "run_x", logPath, runtime: rt, isSessionLive: () => true, ...extra });
}

describe("SessionObserver", () => {
  test("records observed tool calls + provider turns from appended lines", () => {
    const { rt, calls } = spy();
    const o = obs(rt);
    writeFileSync(logPath, TOOL + "\n" + RESULT_OK + "\n");
    o.pump();
    expect(calls.observed.length).toBe(1);
    expect(calls.observed[0].toolName).toBe("Bash");
    expect(calls.observed[0].command).toBe("nmap -sV 10.0.0.1");
    expect(calls.observed[0].runId).toBe("run_x");
    expect(calls.turns).toEqual([{ runId: "run_x", kind: "completed" }]);
    o.stop();
  });

  test("does not reprocess already-read bytes (offset advances)", () => {
    const { rt, calls } = spy();
    const o = obs(rt);
    writeFileSync(logPath, TOOL + "\n");
    o.pump();
    expect(calls.observed.length).toBe(1);
    o.pump(); // no new bytes
    expect(calls.observed.length).toBe(1);
    appendFileSync(logPath, RESULT_OK + "\n");
    o.pump();
    expect(calls.turns.length).toBe(1);
    o.stop();
  });

  test("handles truncation/reset between turns (size < offset → read from top)", () => {
    const { rt, calls } = spy();
    const o = obs(rt);
    writeFileSync(logPath, TOOL + "\n" + RESULT_OK + "\n"); // turn 1 (longer)
    o.pump();
    expect(calls.turns).toEqual([{ runId: "run_x", kind: "completed" }]);
    writeFileSync(logPath, RESULT_ERR + "\n"); // turn 2 truncates to a SHORTER file
    o.pump();
    expect(calls.turns).toEqual([
      { runId: "run_x", kind: "completed" },
      { runId: "run_x", kind: "failed" },
    ]);
    o.stop();
  });

  test("buffers a partial line until its newline (no drop, no duplicate)", () => {
    const { rt, calls } = spy();
    const o = obs(rt);
    writeFileSync(logPath, TOOL.slice(0, 25)); // partial, no newline
    o.pump();
    expect(calls.observed.length).toBe(0);
    appendFileSync(logPath, TOOL.slice(25) + "\n"); // completes the line
    o.pump();
    expect(calls.observed.length).toBe(1);
    o.stop();
  });

  test("observed calls are routed ONLY through observeToolCall (never requestTool / enforced)", () => {
    const { rt, calls } = spy();
    let enforcedPathCalled = false;
    (rt as any).requestTool = () => { enforcedPathCalled = true; };
    const o = obs(rt);
    writeFileSync(logPath, TOOL + "\n");
    o.pump();
    expect(calls.observed.length).toBe(1);
    expect(enforcedPathCalled).toBe(false);
    o.stop();
  });

  test("a throwing runtime never propagates out of pump()", () => {
    const rt: ObserverRuntime = {
      observeToolCall() { throw new Error("boom"); },
      recordProviderTurn() { throw new Error("boom"); },
    };
    const o = obs(rt);
    writeFileSync(logPath, TOOL + "\n" + RESULT_OK + "\n");
    expect(() => o.pump()).not.toThrow();
    o.stop();
  });

  test("a missing log file is safe (no throw)", () => {
    const { rt } = spy();
    const o = obs(rt); // logPath never created
    expect(() => o.pump()).not.toThrow();
    o.stop();
  });

  test("idle + session NOT live → finalizes once and stops", () => {
    let t = 1000;
    const { rt, calls } = spy();
    const o = new SessionObserver({
      sessionId: "s", runId: "run_x", logPath, runtime: rt,
      isSessionLive: () => false, now: () => t, idleMs: 5000,
    });
    writeFileSync(logPath, RESULT_OK + "\n");
    o.pump(); // activity at t=1000
    t = 7000; // 6s idle > 5s
    o.pump();
    expect(calls.finalized).toEqual(["run_x"]);
    expect(o.isStopped).toBe(true);
    o.stop();
  });

  test("maps observed tool calls to the active step (managed runs)", () => {
    const { rt, calls } = spy();
    const o = new SessionObserver({ sessionId: "s", runId: "run_x", logPath, runtime: rt, isSessionLive: () => true, activeStepId: () => "step_active" });
    writeFileSync(logPath, TOOL + "\n");
    o.pump();
    expect(calls.observed[0].stepId).toBe("step_active");
    o.stop();
  });

  test("records OBSERVE-ONLY evidence from a tool_result on the active step", () => {
    const evid: any[] = [];
    const rt: ObserverRuntime = {
      observeToolCall() { return { wouldDecide: "allow", riskLevel: "read-only", reason: "", enforced: false }; },
      recordProviderTurn() {},
      recordObservedEvidence(a) { evid.push(a); },
    };
    const o = new SessionObserver({ sessionId: "s", runId: "run_x", logPath, runtime: rt, isSessionLive: () => true, activeStepId: () => "step_active" });
    const RESULT = JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "PORT 80 open" }] } });
    writeFileSync(logPath, RESULT + "\n");
    o.pump();
    expect(evid.length).toBe(1);
    expect(evid[0].stepId).toBe("step_active");
    expect(evid[0].output).toContain("80");
    o.stop();
  });

  test("managed observer (finalize=false) does NOT finalize the run even when session not live", () => {
    let t = 1000;
    const finals: string[] = [];
    const rt: ObserverRuntime = {
      observeToolCall() { return { wouldDecide: "allow", riskLevel: "read-only", reason: "", enforced: false }; },
      recordProviderTurn() {},
      finalizeChatRun(rid) { finals.push(rid); },
    };
    const o = new SessionObserver({ sessionId: "s", runId: "run_x", logPath, runtime: rt, isSessionLive: () => false, finalize: false, now: () => t, idleMs: 5000 });
    writeFileSync(logPath, RESULT_OK + "\n");
    o.pump();
    t = 7000;
    o.pump();
    expect(finals).toEqual([]); // finalize disabled → managed run never auto-completed
    o.stop();
  });

  test("idle but session STILL live → does NOT finalize", () => {
    let t = 1000;
    const { rt, calls } = spy();
    const o = new SessionObserver({
      sessionId: "s", runId: "run_x", logPath, runtime: rt,
      isSessionLive: () => true, now: () => t, idleMs: 5000,
    });
    writeFileSync(logPath, RESULT_OK + "\n");
    o.pump();
    t = 7000;
    o.pump();
    expect(calls.finalized).toEqual([]);
    o.stop();
  });
});
