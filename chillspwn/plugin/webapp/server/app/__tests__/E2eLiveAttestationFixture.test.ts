import { describe, expect, test } from "bun:test";
import {
  createE2eLiveAttestationFixture,
  E2E_LIVE_ATTESTATION_FIXTURE_TOKEN,
} from "../E2eLiveAttestationFixture";

const NOW = new Date("2026-07-15T12:00:00.000Z");
const enabledEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  CHILLSPWN_E2E_GUIDED_FIXTURE: "1",
  CHILLSPWN_E2E_LIVE_ATTESTATION_FIXTURE: E2E_LIVE_ATTESTATION_FIXTURE_TOKEN,
};

describe("E2E live-attestation fixture boundary", () => {
  test("cannot activate in production or through a partial test opt-in", () => {
    expect(createE2eLiveAttestationFixture({
      ...enabledEnvironment,
      NODE_ENV: "production",
    }, NOW)).toBeNull();
    expect(createE2eLiveAttestationFixture({
      ...enabledEnvironment,
      CHILLSPWN_E2E_GUIDED_FIXTURE: "",
    }, NOW)).toBeNull();
    expect(createE2eLiveAttestationFixture({
      ...enabledEnvironment,
      CHILLSPWN_E2E_LIVE_ATTESTATION_FIXTURE: "1",
    }, NOW)).toBeNull();
  });

  test("projects one short-lived, exact, visibly test-labeled route", () => {
    const fixture = createE2eLiveAttestationFixture(enabledEnvironment, NOW);
    expect(fixture).not.toBeNull();
    expect(fixture?.provider).toMatchObject({
      id: "grok-acp",
      health: "healthy",
      authenticated: true,
      callable: true,
      attestedAt: "2026-07-15T12:00:00.000Z",
      expiresAt: "2026-07-15T12:05:00.000Z",
      reason: expect.stringContaining("E2E-only fixture"),
    });
    expect(fixture?.mcpRoutes).toEqual([{
      name: "sechub-reconnaissance",
      verified: true,
      tools: ["quick_scan"],
      toolSchemas: {
        quick_scan: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
      assignedAgentIds: ["ReconScout"],
      attestedAt: "2026-07-15T12:00:00.000Z",
      expiresAt: "2026-07-15T12:02:00.000Z",
      reason: "[E2E-only fixture] Exact no-network tools/list attestation",
    }]);
  });
});
