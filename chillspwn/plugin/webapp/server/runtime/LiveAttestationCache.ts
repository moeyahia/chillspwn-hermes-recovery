export type LiveAttestationState = "unverified" | "healthy" | "degraded" | "unhealthy";

export type LiveAttestationResult<T> =
  | { readonly ok: true; readonly value: T; readonly reason: string }
  | { readonly ok: false; readonly retryable: boolean; readonly reason: string };

export interface LiveAttestationSnapshot<T> {
  readonly state: LiveAttestationState;
  readonly verified: boolean;
  readonly reason: string;
  readonly value?: T;
  readonly attestedAt: string | null;
  readonly expiresAt: string | null;
  readonly lastAttemptAt: string | null;
  readonly nextAttemptAt: string | null;
  readonly consecutiveFailures: number;
  readonly inFlight: boolean;
}

export interface LiveAttestationCacheOptions<K, T> {
  readonly probe: (key: K, signal: AbortSignal) => Promise<LiveAttestationResult<T>>;
  readonly clock?: () => Date;
  readonly successTtlMs?: number;
  readonly failureTtlMs?: number;
  readonly maximumFailureBackoffMs?: number;
  readonly timeoutMs?: number;
  readonly maximumConcurrency?: number;
  readonly describeKey?: (key: K) => string;
}

interface Entry<T> {
  result?: LiveAttestationResult<T>;
  attestedAtMs?: number;
  expiresAtMs?: number;
  lastAttemptAtMs?: number;
  nextAttemptAtMs?: number;
  consecutiveFailures: number;
  inFlight?: Promise<void>;
}

const MINIMUM_TTL_MS = 1_000;
const MAXIMUM_TTL_MS = 24 * 60 * 60 * 1_000;

function boundedInteger(value: number, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function safeReason(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/[\u0000-\u001F\u007F]/gu, " ").replace(/\s+/gu, " ").trim();
  return normalized ? normalized.slice(0, 500) : fallback;
}

/**
 * Bounded, fail-closed cache for live provider and tool-route attestations.
 *
 * Reading a snapshot never performs I/O. Callers may schedule a refresh from a
 * hot readiness path without awaiting it; duplicate requests coalesce and a
 * small queue bounds concurrent subprocess/network probes. Successful evidence
 * is refreshed before expiry and remains usable only through its original hard
 * expiry while that refresh is pending. Expired successes immediately lose
 * their verified value, so a slow refresh never extends stale authority.
 */
export class LiveAttestationCache<K, T> {
  private readonly probe: LiveAttestationCacheOptions<K, T>["probe"];
  private readonly clock: () => Date;
  private readonly successTtlMs: number;
  private readonly failureTtlMs: number;
  private readonly maximumFailureBackoffMs: number;
  private readonly timeoutMs: number;
  private readonly refreshLeadMs: number;
  private readonly maximumConcurrency: number;
  private readonly describeKey: (key: K) => string;
  private readonly entries = new Map<K, Entry<T>>();
  private readonly queued = new Set<K>();
  private readonly queue: K[] = [];
  private readonly controllers = new Map<K, AbortController>();
  private active = 0;
  private stopped = false;

  constructor(options: LiveAttestationCacheOptions<K, T>) {
    this.probe = options.probe;
    this.clock = options.clock ?? (() => new Date());
    this.successTtlMs = boundedInteger(
      options.successTtlMs ?? 60_000,
      "successTtlMs",
      MINIMUM_TTL_MS,
      MAXIMUM_TTL_MS,
    );
    this.failureTtlMs = boundedInteger(
      options.failureTtlMs ?? 15_000,
      "failureTtlMs",
      MINIMUM_TTL_MS,
      MAXIMUM_TTL_MS,
    );
    this.maximumFailureBackoffMs = boundedInteger(
      options.maximumFailureBackoffMs ?? 5 * 60_000,
      "maximumFailureBackoffMs",
      this.failureTtlMs,
      MAXIMUM_TTL_MS,
    );
    this.timeoutMs = boundedInteger(
      options.timeoutMs ?? 12_000,
      "timeoutMs",
      250,
      5 * 60_000,
    );
    // Start a successful attestation's replacement early enough for one normal
    // bounded probe to finish, while keeping at least half of every TTL free of
    // refresh traffic. This changes scheduling only: snapshot() still revokes
    // the old value at expiresAtMs and never grants a grace period.
    this.refreshLeadMs = Math.min(this.timeoutMs, Math.floor(this.successTtlMs / 2));
    this.maximumConcurrency = boundedInteger(
      options.maximumConcurrency ?? 1,
      "maximumConcurrency",
      1,
      16,
    );
    this.describeKey = options.describeKey ?? ((key) => String(key));
  }

  snapshot(key: K): LiveAttestationSnapshot<T> {
    const entry = this.entries.get(key);
    if (!entry?.result) {
      return {
        state: "unverified",
        verified: false,
        reason: `${this.describeKey(key)} has not completed a live attestation`,
        attestedAt: null,
        expiresAt: null,
        lastAttemptAt: entry?.lastAttemptAtMs === undefined ? null : new Date(entry.lastAttemptAtMs).toISOString(),
        nextAttemptAt: entry?.nextAttemptAtMs === undefined ? null : new Date(entry.nextAttemptAtMs).toISOString(),
        consecutiveFailures: entry?.consecutiveFailures ?? 0,
        inFlight: Boolean(entry?.inFlight) || this.queued.has(key),
      };
    }

    const nowMs = this.clock().getTime();
    const common = {
      attestedAt: entry.attestedAtMs === undefined ? null : new Date(entry.attestedAtMs).toISOString(),
      expiresAt: entry.expiresAtMs === undefined ? null : new Date(entry.expiresAtMs).toISOString(),
      lastAttemptAt: entry.lastAttemptAtMs === undefined ? null : new Date(entry.lastAttemptAtMs).toISOString(),
      nextAttemptAt: entry.nextAttemptAtMs === undefined ? null : new Date(entry.nextAttemptAtMs).toISOString(),
      consecutiveFailures: entry.consecutiveFailures,
      inFlight: Boolean(entry.inFlight) || this.queued.has(key),
    };
    if (entry.result.ok) {
      const fresh = entry.expiresAtMs !== undefined && nowMs <= entry.expiresAtMs;
      return fresh
        ? {
            ...common,
            state: "healthy",
            verified: true,
            reason: entry.result.reason,
            value: entry.result.value,
          }
        : {
            ...common,
            state: "degraded",
            verified: false,
            reason: `${this.describeKey(key)} live attestation expired; refresh is required`,
          };
    }
    return {
      ...common,
      state: entry.result.retryable ? "degraded" : "unhealthy",
      verified: false,
      reason: entry.result.reason,
    };
  }

  refreshIfDue(key: K): void {
    if (this.stopped || !this.isDue(key) || this.queued.has(key)) return;
    this.queued.add(key);
    this.queue.push(key);
    this.drain();
  }

  /** Test/administrative hook that performs one bounded probe and waits for it. */
  async refreshNow(key: K): Promise<LiveAttestationSnapshot<T>> {
    if (this.stopped) return this.snapshot(key);
    const existing = this.entries.get(key)?.inFlight;
    if (existing) {
      await existing;
      return this.snapshot(key);
    }
    this.removeQueued(key);
    await this.runProbe(key);
    return this.snapshot(key);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.queue.length = 0;
    this.queued.clear();
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }

  private isDue(key: K): boolean {
    const entry = this.entries.get(key);
    if (entry?.inFlight) return false;
    const nowMs = this.clock().getTime();
    if (!entry?.result) return entry?.nextAttemptAtMs === undefined || nowMs >= entry.nextAttemptAtMs;
    if (entry.result.ok) {
      return entry.expiresAtMs === undefined
        || nowMs >= entry.expiresAtMs - this.refreshLeadMs;
    }
    return entry.nextAttemptAtMs === undefined || nowMs >= entry.nextAttemptAtMs;
  }

  private removeQueued(key: K): void {
    if (!this.queued.delete(key)) return;
    const index = this.queue.indexOf(key);
    if (index >= 0) this.queue.splice(index, 1);
  }

  private drain(): void {
    if (this.stopped) return;
    while (this.active < this.maximumConcurrency && this.queue.length > 0) {
      const key = this.queue.shift()!;
      this.queued.delete(key);
      if (!this.isDue(key)) continue;
      this.active += 1;
      void this.runProbe(key).finally(() => {
        this.active -= 1;
        this.drain();
      });
    }
  }

  private async runProbe(key: K): Promise<void> {
    const entry = this.entries.get(key) ?? { consecutiveFailures: 0 };
    if (entry.inFlight) return entry.inFlight;
    this.entries.set(key, entry);
    const controller = new AbortController();
    this.controllers.set(key, controller);
    const attemptAtMs = this.clock().getTime();
    entry.lastAttemptAtMs = attemptAtMs;

    const work = (async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const timedOut = new Promise<LiveAttestationResult<T>>((resolve) => {
          timeout = setTimeout(() => {
            controller.abort();
            resolve({
              ok: false,
              retryable: true,
              reason: `${this.describeKey(key)} live attestation timed out`,
            });
          }, this.timeoutMs);
          timeout.unref?.();
        });
        const probed = Promise.resolve()
          .then(() => this.probe(key, controller.signal))
          .catch((): LiveAttestationResult<T> => ({
            ok: false,
            retryable: true,
            reason: `${this.describeKey(key)} live attestation failed safely`,
          }));
        const result = await Promise.race([probed, timedOut]);
        const completedAtMs = this.clock().getTime();
        if (result.ok) {
          entry.result = {
            ok: true,
            value: result.value,
            reason: safeReason(result.reason, `${this.describeKey(key)} live attestation succeeded`),
          };
          entry.attestedAtMs = completedAtMs;
          entry.expiresAtMs = completedAtMs + this.successTtlMs;
          entry.nextAttemptAtMs = entry.expiresAtMs - this.refreshLeadMs;
          entry.consecutiveFailures = 0;
        } else {
          entry.consecutiveFailures += 1;
          const backoff = Math.min(
            this.maximumFailureBackoffMs,
            this.failureTtlMs * (2 ** Math.min(10, entry.consecutiveFailures - 1)),
          );
          entry.result = {
            ok: false,
            retryable: result.retryable,
            reason: safeReason(result.reason, `${this.describeKey(key)} live attestation failed safely`),
          };
          entry.attestedAtMs = undefined;
          entry.expiresAtMs = undefined;
          entry.nextAttemptAtMs = completedAtMs + backoff;
        }
      } finally {
        if (timeout) clearTimeout(timeout);
        this.controllers.delete(key);
        entry.inFlight = undefined;
      }
    })();
    entry.inFlight = work;
    await work;
  }
}
