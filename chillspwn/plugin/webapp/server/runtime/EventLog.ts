/**
 * EventLog — append-only audit log for the agent runtime (Phase 1).
 *
 * Every meaningful runtime/security event becomes an AgentEvent and is appended
 * here as a single JSON line. The log is queryable by agentRunId and sessionId so
 * a reviewer (or the cockpit UI) can reconstruct exactly what happened.
 *
 * Storage is intentionally boring: newline-delimited JSON under a data dir. No DB
 * dependency, atomic-enough for an append-only single-writer process. The format
 * is forward-compatible — readers ignore unknown event types.
 *
 * Phase 1 wires this into the security layer (auth failures, gated features,
 * process kills, obfuscation-enabled warnings, server start). Later phases add
 * run/plan/step/tool/evidence/memory/approval events.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import {
  createAgentEvent,
  type AgentEvent,
  type NewAgentEventInput,
} from "./types";

export interface EventLogOptions {
  /** Directory the log file lives in. Created lazily on first write. */
  dir: string;
  /** File name within `dir`. */
  file?: string;
  /**
   * Optional sink for already-built events (e.g. broadcast to the cockpit WS).
   * Never throws into the caller — a sink error is swallowed so audit logging
   * can never break the request path.
   */
  onEvent?: (event: AgentEvent) => void;
}

export class EventLog {
  private readonly dir: string;
  private readonly path: string;
  private readonly onEvent?: (event: AgentEvent) => void;
  private ensured = false;

  constructor(opts: EventLogOptions) {
    this.dir = opts.dir;
    this.path = join(opts.dir, opts.file ?? "events.jsonl");
    this.onEvent = opts.onEvent;
  }

  /** Build, persist, and fan-out an event. Returns the event for chaining. */
  append(input: NewAgentEventInput): AgentEvent {
    const event = createAgentEvent(input);
    this.write(event);
    return event;
  }

  /** Persist a pre-built event (used when the caller already minted the event). */
  write(event: AgentEvent): void {
    try {
      this.ensureDir();
      appendFileSync(this.path, JSON.stringify(event) + "\n");
    } catch {
      // Audit logging must never break the caller. A failed append is itself a
      // problem, but throwing here would be worse (it would abort the request).
    }
    if (this.onEvent) {
      try {
        this.onEvent(event);
      } catch {
        /* sink errors are non-fatal */
      }
    }
  }

  /** Read all events (oldest first). For small/medium logs and tests. */
  readAll(): AgentEvent[] {
    if (!existsSync(this.path)) return [];
    let raw: string;
    try {
      raw = readFileSync(this.path, "utf-8");
    } catch {
      return [];
    }
    const out: AgentEvent[] = [];
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        out.push(JSON.parse(t) as AgentEvent);
      } catch {
        // Skip a corrupt line rather than failing the whole query.
      }
    }
    return out;
  }

  /** All events for a given run, oldest first. */
  queryByRun(agentRunId: string): AgentEvent[] {
    return this.readAll().filter((e) => e.agentRunId === agentRunId);
  }

  /** All events for a given session, oldest first. */
  queryBySession(sessionId: string): AgentEvent[] {
    return this.readAll().filter((e) => e.sessionId === sessionId);
  }

  /** Path to the underlying log file (for diagnostics). */
  get filePath(): string {
    return this.path;
  }

  private ensureDir(): void {
    if (this.ensured) return;
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    this.ensured = true;
  }
}
