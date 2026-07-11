import { test, expect, describe } from "bun:test";
import { loadSecurityConfig } from "../config";

describe("Phase 15 routing flags", () => {
  test("defaults: routing on; enforcement AUDIT-safe (cannot break current behavior)", () => {
    const c = loadSecurityConfig({} as NodeJS.ProcessEnv);
    expect(c.enableSpecialistAgentRouting).toBe(true);
    expect(c.enforceChillspwnDelegation).toBe(false); // audit-only by default
    expect(c.allowChillspwnDirectTools).toBe(false);
    expect(c.requireSpecialistAssignment).toBe(false);
  });
  test("enforce mode is opt-in via env", () => {
    const c = loadSecurityConfig({ ENFORCE_CHILLSPWN_DELEGATION: "true", REQUIRE_SPECIALIST_ASSIGNMENT: "true" } as any);
    expect(c.enforceChillspwnDelegation).toBe(true);
    expect(c.requireSpecialistAssignment).toBe(true);
  });
});
