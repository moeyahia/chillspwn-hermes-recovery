import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  LIVE_RESTART_CONFIRMATION,
  REVIEWED_SELFTEST_PATH,
  REVIEWED_SELFTEST_SERVER,
  REVIEWED_SELFTEST_TOOL,
  buildIsolatedServerEnvironment,
  validateFinalDurability,
  validateLiveRestartSmokeGate,
  validateReviewedSelftestConfig,
  type FinalDurabilitySnapshot,
  type IsolatedServerPaths,
} from "../../../scripts/command-os-v2/live-grok-restart-resume-smoke-lib";

const identity = { platform: "linux" as const, euid: 1001, username: "chillspwn" };
const environment: NodeJS.ProcessEnv = {
  CHILLSPWN_LIVE_RESTART_CONFIRM: LIVE_RESTART_CONFIRMATION,
  CHILLSPWN_LIVE_RESTART_SERVICE_USER: "chillspwn",
  CHILLSPWN_LIVE_RESTART_PORT: "34131",
  GROK_AUTH_PATH: "/srv/chillspwn/auth/grok.json",
};
const paths: IsolatedServerPaths = {
  root: "/tmp/smoke",
  home: "/tmp/smoke/home",
  hermesHome: "/tmp/smoke/home/.hermes",
  stateRoot: "/tmp/smoke/state",
  sessionsRoot: "/tmp/smoke/state/sessions",
  databasePath: "/tmp/smoke/state/command-os.sqlite",
  vaultRoot: "/tmp/smoke/state/vault",
  workspace: "/tmp/smoke/workspace",
  tmp: "/tmp/smoke/tmp",
  mcpConfigPath: "/opt/chillspwn/plugin/webapp/scripts/command-os-v2/fixtures/local-selftest.mcp.json",
};

function completedSnapshot(): FinalDurabilitySnapshot {
  return {
    run: { status: "completed", journey: "autonomous", leaseOwner: null, leaseExpiresAt: null },
    missionStatus: "completed",
    recoveryEventCount: 1,
    recoveryCheckpointCount: 1,
    waitingGuidedEventCount: 0,
    guidedDecisionCount: 0,
    planCount: 1,
    actions: [{
      id: "action-1", status: "succeeded", kind: "tool",
      mcpServer: REVIEWED_SELFTEST_SERVER, toolName: REVIEWED_SELFTEST_TOOL,
    }],
    toolCalls: [{
      id: "tool-1", actionId: "action-1", status: "succeeded",
      mcpServer: REVIEWED_SELFTEST_SERVER, toolName: REVIEWED_SELFTEST_TOOL,
    }],
    completedActionEventCount: 1,
    verifiedSelftestEvidenceCount: 1,
    evaluationCount: 1,
    evaluationEvidenceCoverage: 1,
    openAssignmentCount: 0,
    startedProviderTurnCount: 0,
    crashProviderTurn: { status: "cancelled", endedAt: "2026-07-15T12:00:00.000Z" },
  };
}

describe("live Grok process restart smoke safety boundary", () => {
  test("requires the explicit matching unprivileged service identity and isolated port", () => {
    expect(validateLiveRestartSmokeGate(environment, identity)).toEqual({
      authPath: "/srv/chillspwn/auth/grok.json",
      port: 34131,
      serviceUser: "chillspwn",
      grokBin: "/opt/chillspwn/bin/grok",
    });
    expect(() => validateLiveRestartSmokeGate(environment, { ...identity, euid: 0 })).toThrow("unprivileged");
    expect(() => validateLiveRestartSmokeGate(environment, { ...identity, username: "another-user" })).toThrow("must match");
    expect(() => validateLiveRestartSmokeGate({ ...environment, CHILLSPWN_LIVE_RESTART_CONFIRM: "" }, identity)).toThrow("opt in");
    expect(() => validateLiveRestartSmokeGate({ ...environment, CHILLSPWN_LIVE_RESTART_PORT: "3131" }, identity)).toThrow("production port");
    expect(() => validateLiveRestartSmokeGate({ ...environment, GROK_AUTH_PATH: "relative.json" }, identity)).toThrow("absolute path");
  });

  test("constructs a positive child-environment allowlist without ambient secrets", () => {
    const gate = validateLiveRestartSmokeGate(environment, identity);
    const child = buildIsolatedServerEnvironment({
      ...environment,
      PATH: "/usr/bin:/bin",
      XAI_API_KEY: "must-not-cross",
      OPENROUTER_API_KEY: "must-not-cross",
      GITHUB_TOKEN: "must-not-cross",
      AWS_SECRET_ACCESS_KEY: "must-not-cross",
    }, gate, paths);
    expect(child.HOME).toBe(paths.home);
    expect(child.COMMAND_OS_DB_PATH).toBe(paths.databasePath);
    expect(child.CHILLSPWN_BIND).toBe("127.0.0.1");
    expect(child.MCP_ARSENAL_CONFIG).toBe(paths.mcpConfigPath);
    expect(child.AUTO_APPROVE_TOOL_NAMES).toBe(REVIEWED_SELFTEST_TOOL);
    expect(child.GROK_AUTH_PATH).toBe(environment.GROK_AUTH_PATH);
    expect(child.XAI_API_KEY).toBe("");
    expect(child.OPENROUTER_API_KEY).toBe("");
    expect(child.GITHUB_TOKEN).toBeUndefined();
    expect(child.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(Object.values(child)).not.toContain("must-not-cross");
  });

  test("accepts only the pinned no-network local-selftest MCP surface", () => {
    const fixture = JSON.parse(readFileSync(resolve(
      import.meta.dir,
      "../../../scripts/command-os-v2/fixtures/local-selftest.mcp.json",
    ), "utf8"));
    expect(() => validateReviewedSelftestConfig(fixture)).not.toThrow();
    expect(fixture.reviewedAsset.path).toBe(REVIEWED_SELFTEST_PATH);
    expect(() => validateReviewedSelftestConfig({
      ...fixture,
      mcpServers: { ...fixture.mcpServers, anotherServer: fixture.mcpServers[REVIEWED_SELFTEST_SERVER] },
    })).toThrow("only local-selftest");
    expect(() => validateReviewedSelftestConfig({
      ...fixture,
      mcpServers: {
        [REVIEWED_SELFTEST_SERVER]: {
          ...fixture.mcpServers[REVIEWED_SELFTEST_SERVER],
          toolNames: [REVIEWED_SELFTEST_TOOL, "network_scan"],
        },
      },
    })).toThrow("tool surface");
  });

  test("keeps the process crash, lease wait, recovery, and credential boundaries explicit", () => {
    const source = readFileSync(resolve(
      import.meta.dir,
      "../../../scripts/command-os-v2/live-grok-restart-resume-smoke.ts",
    ), "utf8");
    expect(source).toContain('signalGroup(server, "SIGKILL")');
    expect(source).toContain("await waitUntilLeaseExpired(paths.databasePath, runId)");
    expect(source).toContain("eventType=run.recovery_started");
    expect(source).toContain("await stopGracefully(finalServer)");
    expect(source).not.toMatch(/readFileSync\([^\n]*(?:authPath|GROK_AUTH_PATH)/u);
  });

  test("rejects duplicate work, user-wait states, and ghost process records", () => {
    const complete = completedSnapshot();
    expect(() => validateFinalDurability(complete)).not.toThrow();
    expect(() => validateFinalDurability({
      ...complete,
      actions: [...complete.actions, { ...complete.actions[0]!, id: "action-duplicate" }],
    })).toThrow("duplicate or missing action");
    expect(() => validateFinalDurability({ ...complete, waitingGuidedEventCount: 1 })).toThrow("Guided decision");
    expect(() => validateFinalDurability({ ...complete, startedProviderTurnCount: 1 })).toThrow("ghost");
    expect(() => validateFinalDurability({
      ...complete,
      crashProviderTurn: { status: "started", endedAt: null },
    })).toThrow("interrupted planning turn");
  });
});
