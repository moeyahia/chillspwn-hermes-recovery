import { test, expect, describe } from "bun:test";
import { canTransition, assertTransition, allowedTransitions } from "../state";

describe("AgentRun state machine", () => {
  test("happy path transitions are legal", () => {
    expect(canTransition("created", "planning")).toBe(true);
    expect(canTransition("planning", "awaiting_plan_approval")).toBe(true);
    expect(canTransition("awaiting_plan_approval", "executing")).toBe(true);
    expect(canTransition("executing", "completed")).toBe(true);
  });

  test("re-planning and blocking mid-run are allowed", () => {
    expect(canTransition("executing", "planning")).toBe(true);
    expect(canTransition("executing", "blocked")).toBe(true);
    expect(canTransition("blocked", "executing")).toBe(true);
    expect(canTransition("executing", "awaiting_user_input")).toBe(true);
  });

  test("terminal states cannot transition", () => {
    expect(canTransition("completed", "executing")).toBe(false);
    expect(canTransition("failed", "planning")).toBe(false);
    expect(canTransition("cancelled", "executing")).toBe(false);
    expect(allowedTransitions("completed")).toEqual([]);
  });

  test("illegal transitions are rejected", () => {
    expect(canTransition("created", "completed")).toBe(false);
    expect(canTransition("planning", "blocked")).toBe(false);
    expect(canTransition("awaiting_user_input", "completed")).toBe(false);
  });

  test("assertTransition throws on illegal, passes on legal", () => {
    expect(() => assertTransition("created", "completed")).toThrow(/Illegal AgentRun transition/);
    expect(() => assertTransition("created", "planning")).not.toThrow();
  });
});
