import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildGrokCommanderEnv,
  buildGrokCommanderMcpServers,
  buildGrokPlanningOnlyRules,
  createGrokCommanderLaunchRuntime,
  ensureGrokCommanderRuntime,
  GROK_COMMANDER_BUN,
  grokCommanderRuntimePaths,
  resolveGrokOAuthAuthPath,
  validateGrokOAuthAuthFile,
} from "../GrokCommanderRuntime";

describe("Grok ACP commander isolated runtime", () => {
  test("shares only the OAuth auth path and disables inherited MCP discovery", () => {
    const paths = grokCommanderRuntimePaths("/tmp/chillspwn-grok-boundary-test");
    const env = buildGrokCommanderEnv(
      {
        HOME: "/root",
        GROK_HOME: "/root/.hermes/chillspwn/grok",
        XAI_API_KEY: "must-not-leak",
        UNRELATED_SERVICE_SECRET: "must-not-leak",
      },
      paths,
      "/root/.hermes/auth/grok/auth.json",
      "commander",
    );

    expect(env.XAI_API_KEY).toBeUndefined();
    expect(env.GROK_AUTH_PATH).toBe("/root/.hermes/auth/grok/auth.json");
    expect(env.HOME).not.toBe("/root");
    expect(env.GROK_HOME).toStartWith(env.HOME!);
    expect(env.GROK_CLAUDE_MCPS_ENABLED).toBe("0");
    expect(env.GROK_CURSOR_MCPS_ENABLED).toBe("0");
    expect(env.GROK_MANAGED_MCPS_ENABLED).toBe("0");
    expect(env.GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED).toBe("0");
    expect(env.GROK_SUBAGENTS).toBe("0");
    expect(env.GROK_MEMORY).toBe("0");
    expect(env.UNRELATED_SERVICE_SECRET).toBeUndefined();
    expect(env.CHILLSPWN_GROK_ROLE).toBe("commander");
  });

  test("injects exactly board and conversation with engagement context", () => {
    const servers = buildGrokCommanderMcpServers({
      engagementDir: "/root/engagements/acme",
      model: "grok-4.5",
    });
    expect(servers.map((server) => server.name)).toEqual([
      "chillspwn-board",
      "chillspwn-conversation",
    ]);
    expect(servers[0].env).toContainEqual({ name: "CHILLSPWN_ORCH_PROVIDER", value: "xai-grok" });
    expect(servers[1].env).toContainEqual({
      name: "CHILLSPWN_ENGAGEMENT_DIR",
      value: "/root/engagements/acme",
    });
  });

  test("injects the canonical no-hands SOUL into the two-journey planning projection", () => {
    const root = mkdtempSync(join(tmpdir(), "chillspwn-grok-planning-soul-"));
    const soul = join(root, "SOUL.md");
    try {
      writeFileSync(soul, "# Commander\n\nNO HANDS\n\n## MANDATORY ROUTING RULE\nDelegate.\n", { mode: 0o600 });
      const rules = buildGrokPlanningOnlyRules(soul);
      expect(rules).toStartWith("# Commander");
      expect(rules).toContain("NO HANDS");
      expect(rules).toContain("Autonomous");
      expect(rules).toContain("Guided");
      expect(rules).toContain("signed mission contract");
      expect(rules).toContain("scoped Context Pack");

      writeFileSync(soul, "# Unbounded planner\n", { mode: 0o600 });
      expect(() => buildGrokPlanningOnlyRules(soul)).toThrow(/missing the enforced commander boundary/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("isolates concurrent ACP launches and prepares each root independently", () => {
    const root = mkdtempSync(join(tmpdir(), "chillspwn-grok-launches-"));
    try {
      const launches = Array.from({ length: 16 }, (_, index) =>
        createGrokCommanderLaunchRuntime(root, `session-${index}`));
      expect(new Set(launches.map((paths) => paths.root)).size).toBe(launches.length);
      for (const paths of launches) ensureGrokCommanderRuntime(paths);
      for (const paths of launches) {
        expect(existsSync(join(paths.grokHome, "config.toml"))).toBeTrue();
        expect(statSync(join(paths.grokHome, "config.toml")).mode & 0o777).toBe(0o600);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("writes the commander hook against the attested root-controlled Bun runtime", () => {
    const root = mkdtempSync(join(tmpdir(), "chillspwn-grok-hook-runtime-"));
    const guard = join(root, "guard.ts");
    try {
      writeFileSync(guard, "process.exit(0);\n", { mode: 0o600 });
      const paths = grokCommanderRuntimePaths(join(root, "runtime"));
      ensureGrokCommanderRuntime(paths, guard);
      const hook = JSON.parse(readFileSync(join(paths.grokHome, "hooks", "chillspwn-commander.json"), "utf8"));
      expect(hook.hooks.PreToolUse[0].hooks[0].command)
        .toBe(`${JSON.stringify(GROK_COMMANDER_BUN)} ${JSON.stringify(guard)}`);
      expect(hook.hooks.PreToolUse[0].hooks[0].command).not.toContain("/root/.bun");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("resolves cached OAuth auth without reading it", () => {
    expect(resolveGrokOAuthAuthPath({ GROK_AUTH_PATH: "/tmp/auth.json" })).toBe("/tmp/auth.json");
    expect(resolveGrokOAuthAuthPath({ HOME: "/root" })).toBe("/root/.hermes/auth/grok/auth.json");
  });

  test("requires refresh-safe, service-owned OAuth state", () => {
    const root = mkdtempSync(join(tmpdir(), "chillspwn-grok-auth-"));
    const home = join(root, ".grok");
    const auth = join(home, "auth.json");
    try {
      mkdirSync(home, { mode: 0o700 });
      writeFileSync(auth, "{}\n", { mode: 0o600 });
      const uid = statSync(auth).uid;

      expect(() => validateGrokOAuthAuthFile(auth, uid)).not.toThrow();
      expect(() => validateGrokOAuthAuthFile(auth, uid + 1)).toThrow(/owned by the service user/);

      chmodSync(auth, 0o640);
      expect(() => validateGrokOAuthAuthFile(auth, uid)).toThrow(/mode 0600/);
      chmodSync(auth, 0o600);

      chmodSync(home, 0o750);
      expect(() => validateGrokOAuthAuthFile(auth, uid)).toThrow(/mode 0700/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
