import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

interface CacheEntry<T = unknown> {
  data?: T;
  error?: Error;
  updatedAt: number;
  promise?: Promise<T>;
  controller?: AbortController;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

export class QueryCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly listeners = new Map<string, Set<() => void>>();

  subscribe(key: string, listener: () => void): () => void {
    const listeners = this.listeners.get(key) ?? new Set();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(key);
        this.cancelIfUnused(key);
      }
    };
  }

  private subscribedKeys(): string[] {
    return [...new Set([...this.entries.keys(), ...this.listeners.keys()])];
  }

  private notify(key: string): void {
    this.listeners.get(key)?.forEach((listener) => listener());
  }

  read<T>(key: string): CacheEntry<T> | undefined {
    return this.entries.get(key) as CacheEntry<T> | undefined;
  }

  async fetch<T>(key: string, loader: (signal: AbortSignal) => Promise<T>, staleTime: number, force = false): Promise<T> {
    const current = this.read<T>(key);
    if (!force && current?.data !== undefined && Date.now() - current.updatedAt < staleTime) return current.data;
    if (current?.promise) return current.promise;
    const controller = new AbortController();
    const promise = Promise.resolve().then(() => loader(controller.signal));
    this.entries.set(key, { ...current, promise, controller, updatedAt: current?.updatedAt ?? 0 });
    this.notify(key);
    try {
      const data = await promise;
      // An aborted/stale request must never overwrite a replacement request.
      if (this.read<T>(key)?.promise === promise) {
        this.entries.set(key, { data, updatedAt: Date.now() });
        this.notify(key);
      }
      return data;
    } catch (error) {
      if (this.read<T>(key)?.promise === promise) {
        this.entries.set(key, isAbortError(error) || controller.signal.aborted
          ? {
              data: current?.data,
              error: current?.error,
              updatedAt: current?.updatedAt ?? 0,
            }
          : {
              data: current?.data,
              error: error instanceof Error ? error : new Error("Query failed"),
              // A failed event-driven refresh must not become a render/retry loop.
              // The caller can retry explicitly or on the next invalidation.
              updatedAt: Date.now(),
            });
        this.notify(key);
      }
      throw error;
    }
  }

  cancelIfUnused(key: string): void {
    if ((this.listeners.get(key)?.size ?? 0) > 0) return;
    const current = this.entries.get(key);
    if (!current?.promise || !current.controller) return;
    current.controller.abort();
    this.entries.set(key, {
      data: current.data,
      error: current.error,
      updatedAt: current.updatedAt,
    });
  }

  invalidate(key: string): void {
    const current = this.entries.get(key);
    if (current) this.entries.set(key, { ...current, updatedAt: 0 });
    this.notify(key);
  }

  invalidatePrefix(prefix: string): void {
    this.subscribedKeys()
      .filter((key) => key.startsWith(prefix))
      .forEach((key) => this.invalidate(key));
  }

  /**
   * Reconcile only mounted authoritative queries. This is intentionally not a
   * full-cache invalidation: one bounded fallback tick causes at most one
   * request per visible query key and existing in-flight requests stay deduped.
   */
  invalidateSubscribed(): void {
    [...this.listeners.keys()].forEach((key) => this.invalidate(key));
  }
}

const QueryContext = createContext<QueryCache | null>(null);

export function QueryProvider({ children }: { children: ReactNode }) {
  const cache = useMemo(() => new QueryCache(), []);
  return <QueryContext.Provider value={cache}>{children}</QueryContext.Provider>;
}

export function useQueryCache(): QueryCache {
  const cache = useContext(QueryContext);
  if (!cache) throw new Error("useQueryCache must be used inside QueryProvider");
  return cache;
}

export interface QueryResult<T> {
  data?: T;
  error?: Error;
  isLoading: boolean;
  isRefreshing: boolean;
  refresh: () => void;
}

export function useQuery<T>(
  key: string,
  loader: (signal: AbortSignal) => Promise<T>,
  options: { staleTime?: number } = {},
): QueryResult<T> {
  const cache = useQueryCache();
  const staleTime = options.staleTime ?? 15_000;
  const [, render] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const run = useCallback((force = false) => {
    void cache.fetch(key, (signal) => loaderRef.current(signal), staleTime, force).catch(() => undefined);
  }, [cache, key, staleTime]);

  useEffect(() => {
    const unsubscribe = cache.subscribe(key, () => {
      const current = cache.read<T>(key);
      render((value) => value + 1);
      if (current?.updatedAt === 0 && !current.promise) run(true);
    });
    run(false);
    return () => {
      unsubscribe();
    };
  }, [cache, key, run]);

  const entry = cache.read<T>(key);
  return {
    data: entry?.data,
    error: entry?.error,
    isLoading: !entry?.data && !entry?.error,
    isRefreshing: Boolean(entry?.data && entry?.promise),
    refresh: () => { run(true); },
  };
}
