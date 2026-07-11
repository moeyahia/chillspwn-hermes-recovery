/**
 * MemoryStore (Phase 4) — durable home for provenance-backed MemoryItems.
 *
 * Separate from the legacy file-based memory (`~/.hermes/memories/USER.md|MEMORY.md`),
 * which is left completely untouched. This store holds the new structured memory model
 * (proposals + verified items) as a single JSON array written atomically.
 *
 * Cross-run by design: project/global memory transcends any one AgentRun, so this is a
 * standalone store rather than per-run state.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import type { MemoryItem, MemoryScope, MemoryStatus } from "./types";

export interface MemoryQuery {
  status?: MemoryStatus;
  scope?: MemoryScope;
  sourceAgentRunId?: string;
  sourceSessionId?: string;
}

export class MemoryStore {
  private readonly dir: string;
  private readonly path: string;
  private items: MemoryItem[] | null = null;

  constructor(baseDir: string) {
    this.dir = join(baseDir, "memory");
    this.path = join(this.dir, "items.json");
  }

  add(item: MemoryItem): void {
    const items = this.load();
    items.push(item);
    this.persist(items);
  }

  get(id: string): MemoryItem | null {
    return this.load().find((m) => m.id === id) ?? null;
  }

  update(id: string, patch: Partial<MemoryItem>): MemoryItem | null {
    const items = this.load();
    const idx = items.findIndex((m) => m.id === id);
    if (idx === -1) return null;
    items[idx] = { ...items[idx], ...patch };
    this.persist(items);
    return items[idx];
  }

  list(query: MemoryQuery = {}): MemoryItem[] {
    return this.load()
      .filter((m) => (query.status ? m.status === query.status : true))
      .filter((m) => (query.scope ? m.scope === query.scope : true))
      .filter((m) => (query.sourceAgentRunId ? m.sourceAgentRunId === query.sourceAgentRunId : true))
      .filter((m) => (query.sourceSessionId ? m.sourceSessionId === query.sourceSessionId : true))
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  }

  // ── internals ────────────────────────────────────────────────────────────────

  private load(): MemoryItem[] {
    if (this.items) return this.items;
    if (!existsSync(this.path)) {
      this.items = [];
      return this.items;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf-8"));
      this.items = Array.isArray(parsed) ? (parsed as MemoryItem[]) : [];
    } catch {
      this.items = [];
    }
    return this.items;
  }

  private persist(items: MemoryItem[]): void {
    this.items = items;
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.path}.tmp-${randomUUID()}`;
    writeFileSync(tmp, JSON.stringify(items, null, 2));
    renameSync(tmp, this.path);
  }
}
