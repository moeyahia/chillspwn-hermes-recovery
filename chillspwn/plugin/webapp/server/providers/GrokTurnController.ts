/**
 * Pure turn-disposition policy for Grok ACP sessions.
 *
 * ACP `end_turn` means that one model turn ended; it does not prove that the
 * operator's objective is complete. This module keeps that protocol signal
 * separate from ChillsPwn's objective contract and returns an explicit action
 * for the process owner to perform.
 */

export const GROK_OBJECTIVE_COMPLETE_MARKER = "<<OBJECTIVE_COMPLETE>>" as const;

export interface GrokQuestionOption {
  label: string;
  description?: string;
}

export interface GrokUserQuestion {
  question: string;
  options: GrokQuestionOption[];
}

export interface GrokTurnControllerState {
  /** Number of automatic follow-up prompts sent since the last real operator prompt. */
  automaticContinuationCount: number;
  /** Bounded history used to detect identical and short-cycle model output loops. */
  recentOutputFingerprints: string[];
}

export interface GrokTurnControllerPolicy {
  /** Maximum follow-up prompts that may be sent without a real operator message. */
  maxAutomaticContinuations: number;
  /** Stop when the same normalized output occurs this many times in the history window. */
  maxRepeatedOutputOccurrences: number;
  /** Maximum number of output fingerprints retained in controller state. */
  outputHistorySize: number;
}

export const DEFAULT_GROK_TURN_CONTROLLER_POLICY: Readonly<GrokTurnControllerPolicy> =
  Object.freeze({
    maxAutomaticContinuations: 6,
    maxRepeatedOutputOccurrences: 3,
    outputHistorySize: 8,
  });

export type GrokContinuationTrigger = "incomplete_end_turn" | "limit";

export type GrokTurnDecision =
  | {
      kind: "objective_complete";
      action: "complete";
      stopReason: string | null;
      nextState: GrokTurnControllerState;
    }
  | {
      kind: "user_question";
      action: "await_user";
      stopReason: string | null;
      question: GrokUserQuestion;
      nextState: GrokTurnControllerState;
    }
  | {
      kind: "incomplete_end_turn" | "limit";
      action: "continue";
      trigger: GrokContinuationTrigger;
      stopReason: string;
      continuationPrompt: string;
      continuationCount: number;
      continuationCap: number;
      nextState: GrokTurnControllerState;
    }
  | {
      kind: "continuation_exhausted";
      action: "check_in";
      trigger: GrokContinuationTrigger;
      stopReason: string;
      continuationCount: number;
      continuationCap: number;
      nextState: GrokTurnControllerState;
    }
  | {
      kind: "repeated_output";
      action: "check_in";
      trigger: GrokContinuationTrigger;
      stopReason: string;
      occurrenceCount: number;
      nextState: GrokTurnControllerState;
    }
  | {
      kind: "cancelled";
      action: "cancel";
      stopReason: string;
      nextState: GrokTurnControllerState;
    }
  | {
      kind: "refused";
      action: "fail";
      stopReason: string;
      nextState: GrokTurnControllerState;
    }
  | {
      kind: "unknown_stop";
      action: "fail";
      stopReason: string | null;
      nextState: GrokTurnControllerState;
    };

export interface DecideGrokTurnInput {
  stopReason: unknown;
  assistantText: string;
  state?: GrokTurnControllerState;
}

export function createGrokTurnControllerState(): GrokTurnControllerState {
  return {
    automaticContinuationCount: 0,
    recentOutputFingerprints: [],
  };
}

/** A real operator message starts a new autonomous-continuation budget. */
export function resetGrokTurnControllerState(): GrokTurnControllerState {
  return createGrokTurnControllerState();
}

/**
 * The completion token is only valid on its own line, matching the system
 * contract. This avoids treating an explanation or quoted inline token as a
 * completed objective.
 */
export function hasGrokObjectiveCompleteMarker(text: string): boolean {
  return /(?:^|\r?\n)[\t ]*<<OBJECTIVE_COMPLETE>>[\t ]*(?=\r?\n|$)/.test(text);
}

/**
 * Parse the exact question shape rendered by ChatPage. A malformed or empty
 * block is not a safe reason to suspend automation because the UI cannot
 * present it to the operator.
 */
export function extractGrokUserQuestion(text: string): GrokUserQuestion | null {
  const blockPattern = /<user-question>\s*([\s\S]*?)\s*<\/user-question>/g;
  for (const match of text.matchAll(blockPattern)) {
    try {
      const value = JSON.parse(match[1].trim()) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const candidate = value as Record<string, unknown>;
      if (typeof candidate.question !== "string" || !candidate.question.trim()) continue;
      if (!Array.isArray(candidate.options) || candidate.options.length === 0) continue;

      const options: GrokQuestionOption[] = [];
      let valid = true;
      for (const rawOption of candidate.options) {
        if (!rawOption || typeof rawOption !== "object" || Array.isArray(rawOption)) {
          valid = false;
          break;
        }
        const option = rawOption as Record<string, unknown>;
        if (typeof option.label !== "string" || !option.label.trim()) {
          valid = false;
          break;
        }
        if (option.description !== undefined && typeof option.description !== "string") {
          valid = false;
          break;
        }
        options.push({
          label: option.label.trim(),
          ...(typeof option.description === "string" && option.description.trim()
            ? { description: option.description.trim() }
            : {}),
        });
      }
      if (!valid) continue;
      return { question: candidate.question.trim(), options };
    } catch {
      // Keep looking: a response may contain a malformed example before the
      // real structured question.
    }
  }
  return null;
}

/**
 * Stable, compact signature for loop detection. Case and whitespace are
 * normalized so cosmetic restatements cannot evade the guard.
 */
export function fingerprintGrokTurnOutput(text: string): string {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${normalized.length}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function buildGrokContinuationPrompt(trigger: GrokContinuationTrigger): string {
  const prefix = trigger === "limit"
    ? "The previous Grok turn reached its model/request limit before the objective was complete."
    : "The previous Grok turn ended without completing the objective or asking a valid operator question.";
  return `${prefix}\nContinue working on the current objective immediately from the latest state. Do not provide another progress-only update. Stop only after emitting ${GROK_OBJECTIVE_COMPLETE_MARKER} on its own line when the objective is fully achieved, or after emitting one valid <user-question> JSON block when an operator decision is genuinely required.`;
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : fallback;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : fallback;
}

function normalizePolicy(policy?: Partial<GrokTurnControllerPolicy>): GrokTurnControllerPolicy {
  const maxAutomaticContinuations = normalizeNonNegativeInteger(
    policy?.maxAutomaticContinuations,
    DEFAULT_GROK_TURN_CONTROLLER_POLICY.maxAutomaticContinuations,
  );
  const maxRepeatedOutputOccurrences = normalizePositiveInteger(
    policy?.maxRepeatedOutputOccurrences,
    DEFAULT_GROK_TURN_CONTROLLER_POLICY.maxRepeatedOutputOccurrences,
  );
  const requestedHistorySize = normalizePositiveInteger(
    policy?.outputHistorySize,
    DEFAULT_GROK_TURN_CONTROLLER_POLICY.outputHistorySize,
  );
  return {
    maxAutomaticContinuations,
    maxRepeatedOutputOccurrences,
    // A threshold larger than the history window could never fire.
    outputHistorySize: Math.max(requestedHistorySize, maxRepeatedOutputOccurrences),
  };
}

function normalizeState(
  state: GrokTurnControllerState | undefined,
  historySize: number,
): GrokTurnControllerState {
  return {
    automaticContinuationCount: normalizeNonNegativeInteger(
      state?.automaticContinuationCount,
      0,
    ),
    recentOutputFingerprints: Array.isArray(state?.recentOutputFingerprints)
      ? state.recentOutputFingerprints
          .filter((entry): entry is string => typeof entry === "string")
          .slice(-historySize)
      : [],
  };
}

function normalizeStopReason(reason: unknown): string | null {
  if (typeof reason !== "string") return null;
  const normalized = reason.trim().toLowerCase();
  return normalized || null;
}

/**
 * Decide what the Grok process owner should do after a true ACP turn boundary.
 * This function has no timers, I/O, or mutation; callers persist `nextState`
 * and perform the returned action.
 */
export function decideGrokTurn(
  input: DecideGrokTurnInput,
  policyOverrides?: Partial<GrokTurnControllerPolicy>,
): GrokTurnDecision {
  const policy = normalizePolicy(policyOverrides);
  const currentState = normalizeState(input.state, policy.outputHistorySize);
  const stopReason = normalizeStopReason(input.stopReason);
  const terminalState = createGrokTurnControllerState();

  // Protocol cancellation/refusal is authoritative even if a partial response
  // happened to contain contract-looking text before it was stopped.
  if (stopReason === "cancelled") {
    return { kind: "cancelled", action: "cancel", stopReason, nextState: terminalState };
  }
  if (stopReason === "refusal") {
    return { kind: "refused", action: "fail", stopReason, nextState: terminalState };
  }

  // A valid question takes precedence over a completion token if a malformed
  // model response contains both: waiting for the explicitly requested user
  // decision is the safer state.
  const question = extractGrokUserQuestion(input.assistantText);
  if (question) {
    return { kind: "user_question", action: "await_user", stopReason, question, nextState: terminalState };
  }
  if (hasGrokObjectiveCompleteMarker(input.assistantText)) {
    return { kind: "objective_complete", action: "complete", stopReason, nextState: terminalState };
  }

  if (
    stopReason !== "end_turn" &&
    stopReason !== "max_tokens" &&
    stopReason !== "max_turn_requests"
  ) {
    return { kind: "unknown_stop", action: "fail", stopReason, nextState: terminalState };
  }
  const trigger: GrokContinuationTrigger = stopReason === "end_turn"
    ? "incomplete_end_turn"
    : "limit";

  const fingerprint = fingerprintGrokTurnOutput(input.assistantText);
  const history = [...currentState.recentOutputFingerprints, fingerprint]
    .slice(-policy.outputHistorySize);
  const observedState: GrokTurnControllerState = {
    automaticContinuationCount: currentState.automaticContinuationCount,
    recentOutputFingerprints: history,
  };
  const occurrenceCount = history.reduce(
    (count, candidate) => count + (candidate === fingerprint ? 1 : 0),
    0,
  );

  if (occurrenceCount >= policy.maxRepeatedOutputOccurrences) {
    return {
      kind: "repeated_output",
      action: "check_in",
      trigger,
      stopReason,
      occurrenceCount,
      nextState: observedState,
    };
  }

  if (currentState.automaticContinuationCount >= policy.maxAutomaticContinuations) {
    return {
      kind: "continuation_exhausted",
      action: "check_in",
      trigger,
      stopReason,
      continuationCount: currentState.automaticContinuationCount,
      continuationCap: policy.maxAutomaticContinuations,
      nextState: observedState,
    };
  }

  const continuationCount = currentState.automaticContinuationCount + 1;
  return {
    kind: trigger === "limit" ? "limit" : "incomplete_end_turn",
    action: "continue",
    trigger,
    stopReason,
    continuationPrompt: buildGrokContinuationPrompt(trigger),
    continuationCount,
    continuationCap: policy.maxAutomaticContinuations,
    nextState: {
      automaticContinuationCount: continuationCount,
      recentOutputFingerprints: history,
    },
  };
}
