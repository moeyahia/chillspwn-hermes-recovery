/**
 * SessionRunMap (Phase 7.1) — maps a live chat sessionId to its attached AgentRun.
 *
 * In-memory by design. The AgentRuns themselves are durable (AgentRunStore on disk), so on
 * a server restart this map is empty but can be REBUILT from the store via `rebuildFrom`
 * (it re-attaches still-`executing`, source="chat", mode="observe" runs to their sessionId).
 * Until rebuilt, a chat turn after a restart simply creates a fresh observe-only run — never
 * an error. Managed runs are intentionally excluded because their lifecycle is runtime-owned.
 */

import type { ProviderKind } from "./types";

export interface SessionRunEntry {
  runId: string;
  provider: ProviderKind;
  persona: string;
  objective: string;
  startedAt: number;
  lastUpdatedAt: number;
}

/** Minimal store surface needed for rebuild (avoids importing the full store type). */
export interface RunLister {
  listRuns(): Array<{
    id: string;
    sessionId: string;
    persona: string;
    providerKind: ProviderKind;
    objective: string;
    status: string;
    source?: string;
    mode?: string;
  }>;
}

export class SessionRunMap {
  private readonly map = new Map<string, SessionRunEntry>();

  /** Now() injected for deterministic tests; defaults to Date.now. */
  constructor(private readonly now: () => number = () => Date.now()) {}

  get(sessionId: string): SessionRunEntry | undefined {
    return this.map.get(sessionId);
  }

  has(sessionId: string): boolean {
    return this.map.has(sessionId);
  }

  set(sessionId: string, entry: Omit<SessionRunEntry, "startedAt" | "lastUpdatedAt">): SessionRunEntry {
    const t = this.now();
    const full: SessionRunEntry = { ...entry, startedAt: t, lastUpdatedAt: t };
    this.map.set(sessionId, full);
    return full;
  }

  /** Bump lastUpdatedAt on an existing entry (a new turn arrived). */
  touch(sessionId: string): void {
    const e = this.map.get(sessionId);
    if (e) e.lastUpdatedAt = this.now();
  }

  delete(sessionId: string): void {
    this.map.delete(sessionId);
  }

  size(): number {
    return this.map.size;
  }

  /**
   * Repopulate from the AgentRunStore after a restart: re-attach every still-`executing`,
   * source="chat", mode="observe" run to its sessionId. Returns how many were re-attached.
   */
  rebuildFrom(store: RunLister): number {
    let n = 0;
    try {
      for (const r of store.listRuns()) {
        if (r.source === "chat" && r.mode === "observe" && r.status === "executing" && r.sessionId && !this.map.has(r.sessionId)) {
          this.set(r.sessionId, {
            runId: r.id,
            provider: r.providerKind,
            persona: r.persona,
            objective: r.objective,
          });
          n++;
        }
      }
    } catch {
      /* rebuild is best-effort */
    }
    return n;
  }
}
