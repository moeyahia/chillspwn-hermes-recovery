/**
 * ClaudeProvider (Phase 1 skeleton).
 *
 * Thin adapter that presents the existing `claude -p` path as an AgentProvider. It
 * does NOT spawn anything itself and does NOT change spawnClaude's argv/behavior —
 * per the operator hard rule, the Claude path stays frozen. It simply normalizes a
 * stream of claude stream-json lines into the unified AgentEvent model via the
 * shared `streamTurn`.
 *
 * Phase 2 will construct the `lineSource` from the live subprocess stdout tail that
 * server/index.ts already produces.
 */

import {
  streamTurn,
  type AgentProvider,
  type AgentTurnInput,
} from "./AgentProvider";
import type { AgentEvent, ProviderKind } from "../runtime/types";

export class ClaudeProvider implements AgentProvider {
  readonly name = "claude";
  readonly kind: ProviderKind = "claude";

  sendTurn(input: AgentTurnInput): AsyncIterable<AgentEvent> {
    return streamTurn(input);
  }
}
