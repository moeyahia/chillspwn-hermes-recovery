import { describe, expect, test } from "bun:test";
import {
  LOCAL_RELEASE_ATTESTATION,
  PLAYWRIGHT_MANAGED_STATIC_SERVER_MODE,
  parseE2EProfile,
} from "../../e2e/support/e2eProfile";

const releaseEnvironment = (overrides: Record<string, string | undefined> = {}) => ({
  COMMAND_OS_V2_E2E_PROFILE: "release",
  COMMAND_OS_V2_E2E_REQUIRE_API: "1",
  COMMAND_OS_V2_E2E_ENFORCE_MANIFEST: "1",
  COMMAND_OS_V2_E2E_SERVER_MODE: PLAYWRIGHT_MANAGED_STATIC_SERVER_MODE,
  COMMAND_OS_V2_E2E_EXTERNAL_SERVERS: "false",
  COMMAND_OS_V2_E2E_BASE_URL: "http://127.0.0.1:43141",
  COMMAND_OS_V2_E2E_API_URL: "http://127.0.0.1:43141",
  ...overrides,
});

describe("E2E execution profile parser", () => {
  test("preserves strict development defaults and explicit degraded relaxation", () => {
    expect(parseE2EProfile({})).toEqual(expect.objectContaining({
      profile: "development",
      requireApi: true,
      enforceManifest: false,
      baseURL: "http://127.0.0.1:43140",
      apiURL: "http://127.0.0.1:43141",
      releaseAttestation: undefined,
    }));
    expect(parseE2EProfile({ COMMAND_OS_V2_E2E_PROFILE: "development" }).requireApi).toBe(true);
    expect(parseE2EProfile({
      COMMAND_OS_V2_E2E_PROFILE: " development ",
      COMMAND_OS_V2_E2E_REQUIRE_API: " 0 ",
    }).requireApi).toBe(true);
    expect(parseE2EProfile({
      COMMAND_OS_V2_E2E_PROFILE: "degraded",
      COMMAND_OS_V2_E2E_REQUIRE_API: "0",
    })).toEqual(expect.objectContaining({
      profile: "degraded",
      requireApi: false,
      releaseAttestation: undefined,
    }));
    expect(parseE2EProfile({ COMMAND_OS_V2_E2E_PROFILE: "degraded" }).requireApi).toBe(false);
  });

  test("keeps degraded as the only profile that may relax required API auditing", () => {
    expect(() => parseE2EProfile({
      COMMAND_OS_V2_E2E_PROFILE: "development",
      COMMAND_OS_V2_E2E_REQUIRE_API: "0",
    })).toThrow("Required V2 API auditing can be relaxed only by the explicit degraded profile");
    expect(() => parseE2EProfile({
      COMMAND_OS_V2_E2E_PROFILE: "release",
      COMMAND_OS_V2_E2E_REQUIRE_API: "0",
    })).toThrow("Required V2 API auditing can be relaxed only by the explicit degraded profile");
    expect(() => parseE2EProfile({ COMMAND_OS_V2_E2E_PROFILE: "smoke" })).toThrow(
      "COMMAND_OS_V2_E2E_PROFILE must be development, release, or degraded",
    );
  });

  test("uses only the canonical E2E manifest switch outside release", () => {
    expect(parseE2EProfile({
      COMMAND_OS_V2_E2E_PROFILE: "development",
      COMMAND_OS_V2_E2E_ENFORCE_MANIFEST: "1",
    }).enforceManifest).toBe(true);
    expect(parseE2EProfile({
      COMMAND_OS_V2_E2E_PROFILE: "development",
      COMMAND_OS_V2_ENFORCE_MANIFEST: "1",
    }).enforceManifest).toBe(false);
  });

  test("accepts only the exact managed-static release contract", () => {
    const parsed = parseE2EProfile(releaseEnvironment());
    expect(parsed).toEqual({
      profile: "release",
      requireApi: true,
      enforceManifest: true,
      serverMode: PLAYWRIGHT_MANAGED_STATIC_SERVER_MODE,
      externalServers: false,
      baseURL: "http://127.0.0.1:43141",
      apiURL: "http://127.0.0.1:43141",
      releaseAttestation: LOCAL_RELEASE_ATTESTATION,
    });
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  test("rejects every missing or relaxed release switch", () => {
    const cases: Array<[string, Record<string, string | undefined>, string]> = [
      ["required API", { COMMAND_OS_V2_E2E_REQUIRE_API: undefined }, "COMMAND_OS_V2_E2E_REQUIRE_API must equal \"1\""],
      ["exact required API", { COMMAND_OS_V2_E2E_REQUIRE_API: " 1 " }, "COMMAND_OS_V2_E2E_REQUIRE_API must equal \"1\""],
      ["manifest", { COMMAND_OS_V2_E2E_ENFORCE_MANIFEST: "0" }, "COMMAND_OS_V2_E2E_ENFORCE_MANIFEST must equal \"1\""],
      ["server", { COMMAND_OS_V2_E2E_SERVER_MODE: "vite-development" }, "COMMAND_OS_V2_E2E_SERVER_MODE must equal \"playwright-managed-static\""],
      ["external server", { COMMAND_OS_V2_E2E_EXTERNAL_SERVERS: "true" }, "COMMAND_OS_V2_E2E_EXTERNAL_SERVERS must equal \"false\""],
      ["missing external declaration", { COMMAND_OS_V2_E2E_EXTERNAL_SERVERS: undefined }, "COMMAND_OS_V2_E2E_EXTERNAL_SERVERS must equal \"false\""],
      ["missing UI URL", { COMMAND_OS_V2_E2E_BASE_URL: undefined }, "COMMAND_OS_V2_E2E_BASE_URL must be explicitly set"],
      ["missing API URL", { COMMAND_OS_V2_E2E_API_URL: undefined }, "COMMAND_OS_V2_E2E_API_URL must be explicitly set"],
    ];
    for (const [, overrides, expectedMessage] of cases) {
      expect(() => parseE2EProfile(releaseEnvironment(overrides))).toThrow(expectedMessage);
    }
  });

  test("requires one credential-free loopback HTTP origin for UI and API", () => {
    const cases: Array<[Record<string, string>, string]> = [
      [{ COMMAND_OS_V2_E2E_API_URL: "http://127.0.0.1:43142" }, "must have the same origin"],
      [{
        COMMAND_OS_V2_E2E_BASE_URL: "https://127.0.0.1:43141",
        COMMAND_OS_V2_E2E_API_URL: "https://127.0.0.1:43141",
      }, "must use local HTTP"],
      [{
        COMMAND_OS_V2_E2E_BASE_URL: "http://example.test:43141",
        COMMAND_OS_V2_E2E_API_URL: "http://example.test:43141",
      }, "must use a loopback host"],
      [{
        COMMAND_OS_V2_E2E_BASE_URL: "http://operator:secret@127.0.0.1:43141",
        COMMAND_OS_V2_E2E_API_URL: "http://operator:secret@127.0.0.1:43141",
      }, "must not contain URL credentials"],
    ];
    for (const [overrides, expectedMessage] of cases) {
      expect(() => parseE2EProfile(releaseEnvironment(overrides))).toThrow(expectedMessage);
    }

    expect(parseE2EProfile(releaseEnvironment({
      COMMAND_OS_V2_E2E_BASE_URL: "http://localhost:43141",
      COMMAND_OS_V2_E2E_API_URL: "http://localhost:43141/api/v2",
    })).profile).toBe("release");
    expect(parseE2EProfile(releaseEnvironment({
      COMMAND_OS_V2_E2E_BASE_URL: "http://[::1]:43141",
      COMMAND_OS_V2_E2E_API_URL: "http://[::1]:43141",
    })).profile).toBe("release");
  });

  test("freezes an explicitly ineligible local release attestation", () => {
    expect(LOCAL_RELEASE_ATTESTATION).toEqual(expect.objectContaining({
      immutableSourceAttested: false,
      releaseCandidateEligible: false,
    }));
    expect(LOCAL_RELEASE_ATTESTATION.blockers.length).toBeGreaterThanOrEqual(3);
    expect(Object.isFrozen(LOCAL_RELEASE_ATTESTATION)).toBe(true);
    expect(Object.isFrozen(LOCAL_RELEASE_ATTESTATION.blockers)).toBe(true);
  });
});
