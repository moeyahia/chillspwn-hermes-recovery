/**
 * SessionObserver (Phase 7.1) — a SECOND, read-only reader of the per-session stdout JSONL
 * log that the existing chat path already writes (`session-logs/<id>.stdout.jsonl`).
 *
 * It NEVER touches the subprocess, the existing `drainStdout` parser, `spawnClaude`,
 * `claude -p`, or the user-facing stream. It only tails the file by byte offset and feeds
 * the runtime, OBSERVE-ONLY:
 *   - assistant `tool_use`  → runtime.observeToolCall(...)  (records a `tool_observed`
 *     event with enforced=false — NEVER an enforced ToolCall, NEVER a block)
 *   - `result`              → runtime.recordProviderTurn(...) (does NOT complete the run)
 *
 * Robustness: handles the log being truncated/rewritten between turns (size < offset →
 * reset), buffers partial lines, never throws into the caller, and self-stops on idle /
 * max-lifetime (finalizing the run only if its session is no longer live).
 *
 * The core (`pump()`) is synchronous + dependency-injected so it is unit-testable without
 * timers; `start()` just polls `pump()` on an interval.
 */

import { closeSync, existsSync, openSync, readSync, statSync } from "fs";
import { normalizeStreamLine } from "../providers/AgentProvider";

/** Narrow runtime surface the observer needs (the real AgentRuntime satisfies it). */
export interface ObserverRuntime {
  observeToolCall(args: {
    runId?: string | null;
    sessionId?: string | null;
    stepId?: string | null;
    toolName: string;
    command?: string;
  }): unknown;
  recordProviderTurn(runId: string, kind: "completed" | "failed", detail?: Record<string, unknown>): void;
  finalizeChatRun?(runId: string, note?: string): void;
  /** Phase 7.5: record OBSERVE-ONLY evidence from an observed tool result (managed runs). */
  recordObservedEvidence?(args: { runId: string; sessionId: string; stepId: string | null; output: string }): void;
}

export interface SessionObserverOpts {
  sessionId: string;
  runId: string;
  logPath: string;
  runtime: ObserverRuntime;
  /** True while the chat session/process is still live (injected from index.ts). */
  isSessionLive: () => boolean;
  /**
   * Phase 7.5: for a MANAGED run, returns the currently-running PlanStep id (or null), so
   * observed tool calls + evidence are mapped to the active step. Absent / null ⇒ run-level
   * (observe-only chat runs have no steps). This NEVER enforces — observation only.
   */
  activeStepId?: () => string | null;
  /** Phase 7.5: false = never auto-finalize the run on session end (managed runs). Default true. */
  finalize?: boolean;
  /** Called once when the observer stops; `finalized` = the run was completed on stop. */
  onEnd?: (runId: string, finalized: boolean) => void;
  log?: (level: string, msg: string, data?: unknown) => void;
  now?: () => number;
  pollMs?: number;
  idleMs?: number;
  maxLifetimeMs?: number;
}

export class SessionObserver {
  private offset = 0;
  private buffer = "";
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private readonly startedAt: number;
  private lastActivityAt: number;
  private readonly now: () => number;
  private readonly idleMs: number;
  private readonly maxLifetimeMs: number;
  private readonly pollMs: number;

  constructor(private readonly o: SessionObserverOpts) {
    this.now = o.now ?? (() => Date.now());
    this.startedAt = this.now();
    this.lastActivityAt = this.startedAt;
    this.idleMs = o.idleMs ?? 10 * 60 * 1000; // 10 min: long enough to span inter-turn gaps
    this.maxLifetimeMs = o.maxLifetimeMs ?? 2 * 60 * 60 * 1000; // 2h backstop
    this.pollMs = o.pollMs ?? 750;
  }

  start(): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => this.pump(), this.pollMs);
    // Unref so the observer never holds the process open on shutdown.
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }

  /**
   * One read cycle. Synchronous + safe to call directly in tests. Reads any new bytes,
   * processes complete lines, and applies idle/lifetime stop rules. Never throws.
   */
  pump(): void {
    if (this.stopped) return;
    try {
      const now = this.now();
      if (now - this.startedAt > this.maxLifetimeMs) return this.finish();

      if (!existsSync(this.o.logPath)) {
        // Log not created yet (observer started before the spawn opened it) — wait, but
        // still honor the idle stop so a never-started session can't leak forever.
        if (now - this.lastActivityAt > this.idleMs) return this.finish();
        return;
      }

      const size = statSync(this.o.logPath).size;
      if (size < this.offset) {
        // The log was truncated/rewritten for a new turn — reset and read from the top.
        this.offset = 0;
        this.buffer = "";
      }
      if (size > this.offset) {
        const fd = openSync(this.o.logPath, "r");
        try {
          const len = size - this.offset;
          const buf = Buffer.allocUnsafe(len);
          readSync(fd, buf, 0, len, this.offset);
          this.offset = size;
          this.ingest(buf.toString("utf-8"));
          this.lastActivityAt = now;
        } finally {
          closeSync(fd);
        }
      } else if (now - this.lastActivityAt > this.idleMs) {
        return this.finish();
      }
    } catch (e) {
      // The observer must NEVER throw into the chat path. Swallow + log.
      this.o.log?.("warn", "SessionObserver pump error (non-fatal)", { error: (e as Error)?.message });
    }
  }

  private ingest(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    // Process only COMPLETE lines; a trailing partial line stays buffered until its newline.
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    const t = line.trim();
    if (!t) return;
    const events = normalizeStreamLine(t, {
      agentRunId: this.o.runId,
      sessionId: this.o.sessionId,
      stepId: null,
    });
    // Phase 7.5: for managed runs, map observed events to the currently-running PlanStep.
    const stepId = this.o.activeStepId ? this.o.activeStepId() : null;
    for (const ev of events) {
      try {
        if (ev.type === "tool_requested") {
          const data = ev.data as Record<string, unknown>;
          const toolName = typeof data.toolName === "string" ? data.toolName : "";
          if (!toolName) continue;
          const args = data.arguments as Record<string, unknown> | undefined;
          const command =
            args && typeof args.command === "string" ? args.command : undefined;
          // OBSERVE-ONLY: classify + record against the active step; never block, never
          // create an enforced ToolCall.
          this.o.runtime.observeToolCall({
            runId: this.o.runId,
            sessionId: this.o.sessionId,
            stepId,
            toolName,
            command,
          });
        } else if (ev.type === "tool_result") {
          // Phase 7.5: observed tool output → OBSERVE-ONLY evidence on the active step
          // (managed runs only — recordObservedEvidence is absent for observe-only chat).
          const data = ev.data as Record<string, unknown>;
          const output = typeof data.output === "string" ? data.output : "";
          if (output) this.o.runtime.recordObservedEvidence?.({ runId: this.o.runId, sessionId: this.o.sessionId, stepId, output });
        } else if (ev.type === "provider_turn_completed") {
          this.o.runtime.recordProviderTurn(this.o.runId, "completed");
        } else if (ev.type === "provider_turn_failed") {
          this.o.runtime.recordProviderTurn(this.o.runId, "failed");
        }
        // model_text / model_thinking are ignored (no transcript replay).
      } catch (e) {
        this.o.log?.("warn", "SessionObserver dispatch error (non-fatal)", { error: (e as Error)?.message });
      }
    }
  }

  private finish(): void {
    if (this.stopped) return;
    this.stop();
    let finalized = false;
    try {
      // Only finalize when the session is truly gone — never end a still-live run. And NEVER
      // for a managed run (finalize=false): the operator owns step/run completion, so an ended
      // observed provider turn must NOT auto-complete the managed run.
      if (this.o.finalize !== false && !this.o.isSessionLive()) {
        this.o.runtime.finalizeChatRun?.(this.o.runId);
        finalized = true;
      }
    } catch (e) {
      this.o.log?.("warn", "SessionObserver finalize error (non-fatal)", { error: (e as Error)?.message });
    }
    try { this.o.onEnd?.(this.o.runId, finalized); } catch { /* non-fatal */ }
  }

  /** Stop tailing. Idempotent. Safe to call on session end / server shutdown. */
  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  get isStopped(): boolean {
    return this.stopped;
  }
}
