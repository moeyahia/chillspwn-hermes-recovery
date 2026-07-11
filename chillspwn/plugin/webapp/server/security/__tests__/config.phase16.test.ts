import { test, expect, describe } from "bun:test";
import { loadSecurityConfig } from "../config";
describe("Phase 16 MCP arsenal flags", () => {
  test("defaults: OFF + disabled mode (safe)", () => {
    const c = loadSecurityConfig({} as NodeJS.ProcessEnv);
    expect(c.enableMcpArsenal).toBe(false);
    expect(c.mcpArsenalMode).toBe("disabled");
    expect(c.mcpArsenalStartServers).toBe(false);
    expect(c.mcpArsenalAllowDocker).toBe(false);
    expect(c.mcpArsenalConfig).toContain(".mcp.arsenal.json");
    expect(c.mcpArsenalDefaultTimeoutSeconds).toBe(120);
    expect(c.mcpArsenalMaxOutputBytes).toBe(20000);
  });
  test("progressive activation via env (dry-run then enabled)", () => {
    const c = loadSecurityConfig({ ENABLE_MCP_ARSENAL: "true", MCP_ARSENAL_MODE: "dry-run" } as any);
    expect(c.enableMcpArsenal).toBe(true); expect(c.mcpArsenalMode).toBe("dry-run");
    expect(loadSecurityConfig({ MCP_ARSENAL_MODE: "enabled" } as any).mcpArsenalMode).toBe("enabled");
    expect(loadSecurityConfig({ MCP_ARSENAL_MODE: "bogus" } as any).mcpArsenalMode).toBe("disabled"); // invalid→safe
  });
});
