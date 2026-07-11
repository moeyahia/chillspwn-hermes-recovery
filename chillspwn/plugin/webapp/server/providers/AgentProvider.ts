/**
 * AgentProvider abstraction (Phase 1 skeleton).
 *
 * Today the dashboard has two fully-separate execution paths (claude `-p` and the
 * python OpenRouter/Codex orchestrator) that happen to emit the same stream-json
 * envelope. This module introduces ONE interface the runtime can consume, plus the
 * shared normalizer that turns either path's raw stream-json lines into the unified
 * AgentEvent model.
 *
 * Phase 1 scope: interface + normalizer + thin provider classes, all DI-driven and
 * unit-tested. The live spawn paths in server/index.ts are NOT rewired yet — that
 * happens in Phase 2, where `lineSource` is fed the real subprocess stdout tail.
 * The Claude path's spawn/argv/behavior remains untouched (operator hard rule).
 */

import {
  createAgentEvent,
  type AgentEvent,
  type AgentEventData,
  type JsonValue,
  type ProviderKind,
} from "../runtime/types";

export interface AgentTurnInput {
  agentRunId: string;
  sessionId: string;
  /** The plan step this turn advances, when applicable. */
  stepId?: string | null;
  /** The prompt/objective text for this turn. */
  prompt: string;
  /**
   * Raw stream-json lines from the underlying engine. Dependency-injected so the
   * provider is testable without spawning a subprocess. In Phase 2 this is wired to
   * the tail of the claude/orchestrator stdout file.
   */
  lineSource: AsyncIterable<string>;
}

export interface AgentProvider {
  readonly name: string;
  readonly kind: ProviderKind;
  /** Stream normalized AgentEvents for one turn. */
  sendTurn(input: AgentTurnInput): AsyncIterable<AgentEvent>;
}

export interface NormalizeContext {
  agentRunId: string | null;
  sessionId: string | null;
  stepId?: string | null;
}

/** JSON-safe coercion for arbitrary parsed values placed into event payloads. */
function asJson(v: unknown): JsonValue {
  if (v === null) return null;
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean") return v as JsonValue;
  if (Array.isArray(v)) return v.map(asJson);
  if (t === "object") {
    const out: { [k: string]: JsonValue } = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = asJson(val);
    return out;
  }
  return String(v);
}

function asData(v: unknown): AgentEventData {
  const j = asJson(v);
  return j && typeof j === "object" && !Array.isArray(j) ? j : { value: j };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/**
 * Normalize a single raw stream-json line (string or pre-parsed object) into zero
 * or more AgentEvents. Pure + deterministic. Shared by both providers so the two
 * historically-divergent paths converge on one event vocabulary.
 *
 * Recognized envelopes (common to claude `-p` and the orchestrator):
 *   { type:"assistant", message:{ content:[ {type:"text"} | {type:"tool_use"} ] } }
 *   { type:"user",      message:{ content:[ {type:"tool_result", ...} ] } }
 *   { type:"result", subtype, end_reason, usage, ... }
 *   { type:"error", message }
 *   { type:"system" | "status" | "stream_event", ... }  (UI chrome → ignored)
 */
export function normalizeStreamLine(line: string | object, ctx: NormalizeContext): AgentEvent[] {
  let obj: Record<string, unknown>;
  if (typeof line === "string") {
    const t = line.trim();
    if (!t) return [];
    try {
      obj = JSON.parse(t) as Record<string, unknown>;
    } catch {
      return [];
    }
  } else {
    obj = line as Record<string, unknown>;
  }

  const base = { agentRunId: ctx.agentRunId, sessionId: ctx.sessionId, stepId: ctx.stepId ?? null };
  const type = obj.type;
  const out: AgentEvent[] = [];

  switch (type) {
    case "assistant": {
      const content = ((obj.message as Record<string, unknown>)?.content as unknown[]) || [];
      for (const blk of content) {
        const b = blk as Record<string, unknown>;
        if (b?.type === "text" && typeof b.text === "string") {
          out.push(createAgentEvent({ type: "model_text", ...base, data: { text: b.text } }));
        } else if (b?.type === "tool_use") {
          out.push(
            createAgentEvent({
              type: "tool_requested",
              ...base,
              data: {
                toolName: typeof b.name === "string" ? b.name : "",
                toolUseId: typeof b.id === "string" ? b.id : "",
                arguments: asData(b.input),
              },
            }),
          );
        } else if (b?.type === "thinking" && typeof b.thinking === "string") {
          out.push(createAgentEvent({ type: "model_thinking", ...base, data: { text: b.thinking } }));
        }
      }
      return out;
    }

    case "user": {
      const content = ((obj.message as Record<string, unknown>)?.content as unknown[]) || [];
      for (const blk of content) {
        const b = blk as Record<string, unknown>;
        if (b?.type === "tool_result") {
          const raw = b.content;
          const text =
            typeof raw === "string"
              ? raw
              : Array.isArray(raw)
                ? raw
                    .map((p) => {
                      const pr = p as Record<string, unknown>;
                      return typeof pr?.text === "string" ? pr.text : "";
                    })
                    .join("")
                : "";
          out.push(
            createAgentEvent({
              type: "tool_result",
              ...base,
              data: {
                toolUseId: typeof b.tool_use_id === "string" ? b.tool_use_id : "",
                isError: b.is_error === true,
                output: truncate(text, 8000),
              },
            }),
          );
        }
      }
      return out;
    }

    case "result": {
      // A provider `result` ends a TURN, not the whole AgentRun. We emit
      // provider_turn_* (never run_completed/run_failed) so the Phase 2 runtime can
      // apply its own completion criteria instead of trusting the model's turn end.
      const isError = obj.subtype === "error" || obj.is_error === true;
      out.push(
        createAgentEvent({
          type: isError ? "provider_turn_failed" : "provider_turn_completed",
          ...base,
          data: {
            subtype: typeof obj.subtype === "string" ? obj.subtype : "",
            endReason: typeof obj.end_reason === "string" ? obj.end_reason : "",
            usage: asData(obj.usage ?? {}),
            continuable: obj.continuable === true,
          },
        }),
      );
      return out;
    }

    case "error": {
      out.push(
        createAgentEvent({
          type: "provider_error",
          ...base,
          data: { message: typeof obj.message === "string" ? obj.message : String(obj.message ?? "") },
        }),
      );
      return out;
    }

    // system / status / stream_event are UI chrome (init banners, activity labels,
    // token deltas) — intentionally not modeled as runtime events.
    default:
      return out;
  }
}

/** Shared sendTurn implementation: iterate a line source, yield normalized events. */
export async function* streamTurn(
  input: AgentTurnInput,
): AsyncGenerator<AgentEvent, void, unknown> {
  const ctx: NormalizeContext = {
    agentRunId: input.agentRunId,
    sessionId: input.sessionId,
    stepId: input.stepId ?? null,
  };
  for await (const line of input.lineSource) {
    for (const ev of normalizeStreamLine(line, ctx)) {
      yield ev;
    }
  }
}
