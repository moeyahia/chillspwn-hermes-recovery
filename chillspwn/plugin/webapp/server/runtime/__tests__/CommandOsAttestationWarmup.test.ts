import { afterEach, describe, expect, test } from "bun:test";
import {
  warmCommandOsStartupAttestations,
  type StartupAttestationScheduler,
} from "../CommandOsAttestationWarmup";
import {
  LiveAttestationCache,
  type LiveAttestationResult,
} from "../LiveAttestationCache";

const stops: Array<() => void> = [];

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
});

describe("Command OS startup attestation warm-up", () => {
  test("starts bounded provider and eligible MCP probes without granting authority", async () => {
    interface Value {
      readonly surface: string;
    }
    let releaseProvider!: (result: LiveAttestationResult<Value>) => void;
    let releaseMcp!: (result: LiveAttestationResult<Value>) => void;
    const provider = new LiveAttestationCache<string, Value>({
      probe: () => new Promise((resolve) => { releaseProvider = resolve; }),
      timeoutMs: 2_000,
      describeKey: () => "Provider fixture",
    });
    const mcp = new LiveAttestationCache<string, Value>({
      probe: () => new Promise((resolve) => { releaseMcp = resolve; }),
      timeoutMs: 2_000,
      describeKey: (name) => `MCP fixture ${name}`,
    });
    stops.push(() => provider.stop(), () => mcp.stop());

    const warmup = warmCommandOsStartupAttestations({
      providerEnabled: true,
      providerId: "grok-acp",
      providerAttestations: provider,
      mcpEnabled: true,
      mcpStartPermitted: true,
      mcpRoutes: [
        { name: "recon", enabled: true, healthState: "configured" },
        { name: "disabled", enabled: false, healthState: "configured" },
        { name: "missing", enabled: true, healthState: "missing_dependency" },
      ],
      mcpAttestations: mcp,
    });

    expect(warmup).toMatchObject({
      provider: { state: "probing" },
      mcp: { state: "probing", eligibleRoutes: 1, probingRoutes: 1 },
    });
    expect(provider.snapshot("grok-acp")).toMatchObject({
      verified: false,
      inFlight: true,
    });
    expect(mcp.snapshot("recon")).toMatchObject({ verified: false, inFlight: true });
    expect(mcp.snapshot("disabled")).toMatchObject({ verified: false, inFlight: false });
    expect(mcp.snapshot("missing")).toMatchObject({ verified: false, inFlight: false });

    await Promise.resolve();
    releaseProvider({ ok: true, value: { surface: "provider" }, reason: "Provider live attested" });
    releaseMcp({ ok: true, value: { surface: "mcp" }, reason: "MCP live attested" });
    await Promise.all([
      provider.refreshNow("grok-acp"),
      mcp.refreshNow("recon"),
    ]);
    expect(provider.snapshot("grok-acp")).toMatchObject({ verified: true, inFlight: false });
    expect(mcp.snapshot("recon")).toMatchObject({ verified: true, inFlight: false });
  });

  test("keeps startup nonblocking and fail-closed when scheduling cannot start", () => {
    const failing: StartupAttestationScheduler = {
      refreshIfDue() { throw new Error("sensitive fixture detail"); },
      snapshot() { throw new Error("sensitive fixture detail"); },
    };
    const warmup = warmCommandOsStartupAttestations({
      providerEnabled: true,
      providerId: "grok-acp",
      providerAttestations: failing,
      mcpEnabled: true,
      mcpStartPermitted: true,
      mcpRoutes: [{ name: "recon", enabled: true, healthState: "healthy" }],
      mcpAttestations: failing,
    });

    expect(warmup).toEqual({
      provider: {
        state: "unavailable",
        reason: "Live attestation warm-up could not be scheduled",
      },
      mcp: {
        state: "unavailable",
        eligibleRoutes: 1,
        probingRoutes: 0,
        reason: "Eligible MCP routes have not completed a fresh live attestation",
      },
    });
  });
});
