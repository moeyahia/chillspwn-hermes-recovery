/**
 * OpenRouterProvider (Phase 1 skeleton).
 *
 * Thin adapter presenting the python OpenRouter/Codex orchestrator path as an
 * AgentProvider. Same envelope as the Claude path, so it reuses the shared
 * `streamTurn` normalizer. `kind` distinguishes the underlying engine (openrouter
 * vs openai-codex) so the runtime can route + label without caring about wire
 * details. No subprocess work happens here in Phase 1.
 */

import {
  streamTurn,
  type AgentProvider,
  type AgentTurnInput,
} from "./AgentProvider";
import type { AgentEvent, ProviderKind } from "../runtime/types";

export class OpenRouterProvider implements AgentProvider {
  readonly name: string;
  readonly kind: ProviderKind;

  constructor(kind: Extract<ProviderKind, "openrouter" | "openai-codex"> = "openrouter") {
    this.kind = kind;
    this.name = kind;
  }

  sendTurn(input: AgentTurnInput): AsyncIterable<AgentEvent> {
    return streamTurn(input);
  }
}
