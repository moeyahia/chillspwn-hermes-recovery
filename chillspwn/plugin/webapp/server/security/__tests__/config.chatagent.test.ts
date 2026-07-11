import { test, expect, describe } from "bun:test";
import { loadSecurityConfig } from "../config";

// Phase 7.1: chat-runtime feature flags. Defaults must be safe/non-disruptive (OFF).
describe("chat-agent config flags", () => {
  test("default OFF / observe / off / false when env is empty", () => {
    const c = loadSecurityConfig({} as NodeJS.ProcessEnv);
    expect(c.enableChatAgentRuns).toBe(false);
    expect(c.chatAgentMode).toBe("observe");
    expect(c.chatAgentPlanning).toBe("off");
    expect(c.chatAgentForcePlan).toBe(false);
  });

  test("ENABLE_CHAT_AGENT_RUNS=true is honored", () => {
    const c = loadSecurityConfig({ ENABLE_CHAT_AGENT_RUNS: "true" } as unknown as NodeJS.ProcessEnv);
    expect(c.enableChatAgentRuns).toBe(true);
  });

  test("mode only accepts observe|managed; junk falls back to observe", () => {
    expect(loadSecurityConfig({ CHAT_AGENT_MODE: "managed" } as any).chatAgentMode).toBe("managed");
    expect(loadSecurityConfig({ CHAT_AGENT_MODE: "wat" } as any).chatAgentMode).toBe("observe");
  });

  test("planning only accepts preview|inferred; junk falls back to off", () => {
    expect(loadSecurityConfig({ CHAT_AGENT_PLANNING: "preview" } as any).chatAgentPlanning).toBe("preview");
    expect(loadSecurityConfig({ CHAT_AGENT_PLANNING: "inferred" } as any).chatAgentPlanning).toBe("inferred");
    expect(loadSecurityConfig({ CHAT_AGENT_PLANNING: "nope" } as any).chatAgentPlanning).toBe("off");
  });

  test("planning model has a default and is env-overridable", () => {
    expect(loadSecurityConfig({} as NodeJS.ProcessEnv).chatAgentPlanningModel).toBeTruthy();
    expect(loadSecurityConfig({ CHAT_AGENT_PLANNING_MODEL: "openai/gpt-4o-mini" } as any).chatAgentPlanningModel).toBe("openai/gpt-4o-mini");
  });

  test("Phase 7.4: managed-chat default OFF + plan-approval default ON", () => {
    const c = loadSecurityConfig({} as NodeJS.ProcessEnv);
    expect(c.enableRuntimeManagedChat).toBe(false);
    expect(c.requirePlanApproval).toBe(true);
    expect(loadSecurityConfig({ ENABLE_RUNTIME_MANAGED_CHAT: "true" } as any).enableRuntimeManagedChat).toBe(true);
    expect(loadSecurityConfig({ REQUIRE_PLAN_APPROVAL: "false" } as any).requirePlanApproval).toBe(false);
  });
});
