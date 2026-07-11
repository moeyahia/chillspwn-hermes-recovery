import { test, expect, describe } from "bun:test";
import { loadSecurityConfig } from "../config";

describe("Phase 8-14 config flags", () => {
  test("Phase 8 gating defaults OFF + safe", () => {
    const c = loadSecurityConfig({} as NodeJS.ProcessEnv);
    expect(c.enableOpenrouterRuntimeGating).toBe(false);
    expect(c.openrouterGateMode).toBe("off");
    expect(c.openrouterGateFailMode).toBe("deny");
    expect(c.openrouterGateTimeoutSeconds).toBe(300);
    expect(c.openrouterGatePollSeconds).toBe(2);
  });
  test("gate mode/fail-mode reject junk", () => {
    expect(loadSecurityConfig({ OPENROUTER_GATE_MODE: "enforce" } as any).openrouterGateMode).toBe("enforce");
    expect(loadSecurityConfig({ OPENROUTER_GATE_MODE: "wat" } as any).openrouterGateMode).toBe("off");
    expect(loadSecurityConfig({ OPENROUTER_GATE_FAIL_MODE: "junk" } as any).openrouterGateFailMode).toBe("deny");
    // 8.1: allow-read-only was removed → coerced to deny (fail closed)
    expect(loadSecurityConfig({ OPENROUTER_GATE_FAIL_MODE: "allow-read-only" } as any).openrouterGateFailMode).toBe("deny");
  });
  test("Phase 9-13 additive capabilities default ON; legacy cleanup OFF", () => {
    const c = loadSecurityConfig({} as NodeJS.ProcessEnv);
    expect(c.enableDelegatedWorkerContract).toBe(true);
    expect(c.enableLiveMemoryProposals).toBe(true);
    expect(c.enableFinalRunReports).toBe(true);
    expect(c.enableArtifactStorage).toBe(true);
    expect(c.enableCockpitLiveRefresh).toBe(true);
    expect(c.enableLegacyPromptCleanup).toBe(false);
  });
});
