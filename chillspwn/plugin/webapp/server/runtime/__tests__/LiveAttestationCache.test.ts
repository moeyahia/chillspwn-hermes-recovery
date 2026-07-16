import { describe, expect, test } from "bun:test";
import { LiveAttestationCache, type LiveAttestationResult } from "../LiveAttestationCache";

interface Value {
  readonly authenticated: true;
}

describe("LiveAttestationCache", () => {
  test("stays unverified until a live probe succeeds and expires without serving stale authority", async () => {
    let now = new Date("2026-07-15T12:00:00.000Z");
    let result: LiveAttestationResult<Value> = {
      ok: true,
      value: { authenticated: true },
      reason: "live OAuth accepted",
    };
    const cache = new LiveAttestationCache<string, Value>({
      probe: async () => result,
      clock: () => now,
      successTtlMs: 1_000,
      failureTtlMs: 1_000,
      maximumFailureBackoffMs: 4_000,
      timeoutMs: 1_000,
      describeKey: () => "Grok OAuth/ACP route",
    });

    const unverified = cache.snapshot("grok-acp");
    expect(unverified).toMatchObject({
      state: "unverified",
      verified: false,
    });
    expect(unverified.value).toBeUndefined();
    expect(await cache.refreshNow("grok-acp")).toMatchObject({
      state: "healthy",
      verified: true,
      value: { authenticated: true },
      attestedAt: "2026-07-15T12:00:00.000Z",
      expiresAt: "2026-07-15T12:00:01.000Z",
    });

    now = new Date("2026-07-15T12:00:01.001Z");
    const expired = cache.snapshot("grok-acp");
    expect(expired).toMatchObject({
      state: "degraded",
      verified: false,
    });
    expect(expired.value).toBeUndefined();

    result = {
      ok: false,
      retryable: false,
      reason: "Live Grok OAuth authentication was rejected",
    };
    const revoked = await cache.refreshNow("grok-acp");
    expect(revoked).toMatchObject({
      state: "unhealthy",
      verified: false,
      reason: "Live Grok OAuth authentication was rejected",
      consecutiveFailures: 1,
    });
    expect(revoked.value).toBeUndefined();
    cache.stop();
  });

  test("coalesces background refreshes and backs off a transient outage", async () => {
    let now = new Date("2026-07-15T12:00:00.000Z");
    let calls = 0;
    let release!: (value: LiveAttestationResult<Value>) => void;
    const pending = new Promise<LiveAttestationResult<Value>>((resolve) => { release = resolve; });
    const cache = new LiveAttestationCache<string, Value>({
      probe: async () => {
        calls += 1;
        return pending;
      },
      clock: () => now,
      successTtlMs: 1_000,
      failureTtlMs: 1_000,
      maximumFailureBackoffMs: 4_000,
      timeoutMs: 5_000,
    });

    cache.refreshIfDue("grok-acp");
    cache.refreshIfDue("grok-acp");
    cache.refreshIfDue("grok-acp");
    await Promise.resolve();
    expect(calls).toBe(1);
    release({ ok: false, retryable: true, reason: "provider unavailable" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cache.snapshot("grok-acp")).toMatchObject({
      state: "degraded",
      verified: false,
      consecutiveFailures: 1,
      nextAttemptAt: "2026-07-15T12:00:01.000Z",
    });

    cache.refreshIfDue("grok-acp");
    await Promise.resolve();
    expect(calls).toBe(1);
    now = new Date("2026-07-15T12:00:01.001Z");
    cache.refreshIfDue("grok-acp");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toBe(2);
    expect(cache.snapshot("grok-acp")).toMatchObject({
      consecutiveFailures: 2,
      nextAttemptAt: "2026-07-15T12:00:03.001Z",
    });
    cache.stop();
  });
});
