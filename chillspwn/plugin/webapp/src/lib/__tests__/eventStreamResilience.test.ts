import { describe, expect, test } from "bun:test";
import { QueryCache } from "../../data/cache/QueryProvider";
import {
  FALLBACK_REFRESH_INTERVAL_MS,
  MAX_RECONNECT_DELAY_MS,
  RECONNECT_JITTER_MS,
  reconnectDelayMs,
  shouldUseAuthoritativeFallback,
  STREAM_FAILURES_BEFORE_FALLBACK,
} from "../../data/events/eventStreamPolicy";

function abortError(): Error {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

describe("event stream recovery policy", () => {
  test("uses bounded exponential reconnect backoff with positive jitter", () => {
    expect(reconnectDelayMs(1, () => 0)).toBe(1_000);
    expect(reconnectDelayMs(2, () => 0)).toBe(2_000);
    expect(reconnectDelayMs(3, () => 0)).toBe(4_000);
    expect(reconnectDelayMs(20, () => 0)).toBe(MAX_RECONNECT_DELAY_MS);
    expect(reconnectDelayMs(20, () => 1)).toBe(MAX_RECONNECT_DELAY_MS + RECONNECT_JITTER_MS - 1);
  });

  test("starts fallback only after bounded online foreground failures", () => {
    expect(STREAM_FAILURES_BEFORE_FALLBACK).toBe(3);
    expect(FALLBACK_REFRESH_INTERVAL_MS).toBeGreaterThanOrEqual(30_000);
    expect(shouldUseAuthoritativeFallback({ consecutiveFailures: 2, online: true, visible: true })).toBeFalse();
    expect(shouldUseAuthoritativeFallback({ consecutiveFailures: 3, online: true, visible: true })).toBeTrue();
    expect(shouldUseAuthoritativeFallback({ consecutiveFailures: 3, online: false, visible: true })).toBeFalse();
    expect(shouldUseAuthoritativeFallback({ consecutiveFailures: 3, online: true, visible: false })).toBeFalse();
  });
});

describe("authoritative query lifecycle", () => {
  test("aborts an in-flight request when its final observer leaves", async () => {
    const cache = new QueryCache();
    let requestSignal: AbortSignal | undefined;
    const unsubscribe = cache.subscribe("mission:one", () => undefined);
    const pending = cache.fetch("mission:one", (signal) => {
      requestSignal = signal;
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(abortError()), { once: true });
      });
    }, 0);
    await Promise.resolve();

    unsubscribe();

    expect(requestSignal?.aborted).toBeTrue();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(cache.read("mission:one")?.error).toBeUndefined();
  });

  test("keeps a shared request alive until every observer leaves", async () => {
    const cache = new QueryCache();
    let requestSignal: AbortSignal | undefined;
    const first = cache.subscribe("run:shared", () => undefined);
    const second = cache.subscribe("run:shared", () => undefined);
    const pending = cache.fetch("run:shared", (signal) => {
      requestSignal = signal;
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(abortError()), { once: true });
      });
    }, 0);
    await Promise.resolve();

    first();
    expect(requestSignal?.aborted).toBeFalse();
    second();
    expect(requestSignal?.aborted).toBeTrue();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  test("an abandoned stale response cannot overwrite a replacement query", async () => {
    const cache = new QueryCache();
    let resolveStale: ((value: string) => void) | undefined;
    const firstObserver = cache.subscribe("run:changing", () => undefined);
    const stale = cache.fetch("run:changing", () => new Promise<string>((resolve) => {
      resolveStale = resolve;
    }), 0);
    await Promise.resolve();
    firstObserver();

    const replacementObserver = cache.subscribe("run:changing", () => undefined);
    await cache.fetch("run:changing", async () => "fresh", 0, true);
    resolveStale?.("stale");
    await stale;

    expect(cache.read<string>("run:changing")?.data).toBe("fresh");
    replacementObserver();
  });

  test("fallback invalidates mounted queries only", async () => {
    const cache = new QueryCache();
    await cache.fetch("mounted", async () => ({ version: 1 }), 60_000);
    await cache.fetch("unmounted", async () => ({ version: 1 }), 60_000);
    const unsubscribe = cache.subscribe("mounted", () => undefined);

    cache.invalidateSubscribed();

    expect(cache.read("mounted")?.updatedAt).toBe(0);
    expect(cache.read("unmounted")?.updatedAt).toBeGreaterThan(0);
    unsubscribe();
  });
});
