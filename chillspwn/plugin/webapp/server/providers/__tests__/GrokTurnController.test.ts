import { describe, expect, test } from "bun:test";
import {
  buildGrokContinuationPrompt,
  createGrokTurnControllerState,
  decideGrokTurn,
  extractGrokUserQuestion,
  fingerprintGrokTurnOutput,
  hasGrokObjectiveCompleteMarker,
  resetGrokTurnControllerState,
  type GrokTurnControllerState,
} from "../GrokTurnController";

describe("Grok objective contract", () => {
  test("accepts the exact completion marker only on its own line", () => {
    expect(hasGrokObjectiveCompleteMarker("proof\n<<OBJECTIVE_COMPLETE>>\nrooted")).toBe(true);
    expect(hasGrokObjectiveCompleteMarker("  <<OBJECTIVE_COMPLETE>>  ")).toBe(true);
    expect(hasGrokObjectiveCompleteMarker("Use <<OBJECTIVE_COMPLETE>> when done.")).toBe(false);
    expect(hasGrokObjectiveCompleteMarker("<<objective_complete>>")).toBe(false);
  });

  test("parses only UI-renderable structured questions", () => {
    const valid = extractGrokUserQuestion(`Before\n<user-question>
      {"question":"Reset the target?","options":[{"label":"Reset","description":"Start a clean instance"},{"label":"Wait"}]}
      </user-question>`);
    expect(valid).toEqual({
      question: "Reset the target?",
      options: [
        { label: "Reset", description: "Start a clean instance" },
        { label: "Wait" },
      ],
    });
    expect(extractGrokUserQuestion("<user-question>not json</user-question>")).toBeNull();
    expect(extractGrokUserQuestion('<user-question>{"question":"Q","options":[]}</user-question>')).toBeNull();
    expect(extractGrokUserQuestion('<user-question>{"question":"Q","options":[{"description":"missing label"}]}</user-question>')).toBeNull();
  });

  test("a valid question wins over a completion marker", () => {
    const decision = decideGrokTurn({
      stopReason: "end_turn",
      assistantText: `<<OBJECTIVE_COMPLETE>>\n<user-question>{"question":"Proceed?","options":[{"label":"Yes"}]}</user-question>`,
    });
    expect(decision.kind).toBe("user_question");
    expect(decision.action).toBe("await_user");
  });

  test("completion resets continuation state even after a protocol limit", () => {
    const decision = decideGrokTurn({
      stopReason: "max_tokens",
      assistantText: "<<OBJECTIVE_COMPLETE>>\nProof captured",
      state: { automaticContinuationCount: 4, recentOutputFingerprints: ["old"] },
    });
    expect(decision.kind).toBe("objective_complete");
    expect(decision.action).toBe("complete");
    expect(decision.nextState).toEqual(createGrokTurnControllerState());
  });
});

describe("Grok automatic continuation", () => {
  test("treats an ordinary end_turn as incomplete and emits a strict follow-up", () => {
    const decision = decideGrokTurn({
      stopReason: " END_TURN ",
      assistantText: "I found a new lead and will test it next.",
    });
    expect(decision.kind).toBe("incomplete_end_turn");
    expect(decision.action).toBe("continue");
    if (decision.action === "continue") {
      expect(decision.trigger).toBe("incomplete_end_turn");
      expect(decision.continuationCount).toBe(1);
      expect(decision.continuationCap).toBe(6);
      expect(decision.continuationPrompt).toContain("Continue working on the current objective immediately");
      expect(decision.continuationPrompt).toContain("<<OBJECTIVE_COMPLETE>>");
      expect(decision.nextState.automaticContinuationCount).toBe(1);
    }
  });

  test("continues both ACP limit reasons with a limit-specific prompt", () => {
    for (const stopReason of ["max_tokens", "max_turn_requests"]) {
      const decision = decideGrokTurn({ stopReason, assistantText: `partial ${stopReason}` });
      expect(decision.kind).toBe("limit");
      expect(decision.action).toBe("continue");
      if (decision.action === "continue") {
        expect(decision.trigger).toBe("limit");
        expect(decision.continuationPrompt).toBe(buildGrokContinuationPrompt("limit"));
      }
    }
  });

  test("allows exactly the configured number of automatic continuations", () => {
    let state = createGrokTurnControllerState();
    for (let turn = 1; turn <= 2; turn += 1) {
      const decision = decideGrokTurn(
        { stopReason: "end_turn", assistantText: `distinct output ${turn}`, state },
        { maxAutomaticContinuations: 2, maxRepeatedOutputOccurrences: 99 },
      );
      expect(decision.action).toBe("continue");
      state = decision.nextState;
    }

    const exhausted = decideGrokTurn(
      { stopReason: "end_turn", assistantText: "a third distinct output", state },
      { maxAutomaticContinuations: 2, maxRepeatedOutputOccurrences: 99 },
    );
    expect(exhausted.kind).toBe("continuation_exhausted");
    expect(exhausted.action).toBe("check_in");
    if (exhausted.kind === "continuation_exhausted") {
      expect(exhausted.continuationCount).toBe(2);
      expect(exhausted.continuationCap).toBe(2);
    }
  });

  test("a zero continuation cap checks in on the first incomplete turn", () => {
    const decision = decideGrokTurn(
      { stopReason: "end_turn", assistantText: "not finished" },
      { maxAutomaticContinuations: 0 },
    );
    expect(decision.kind).toBe("continuation_exhausted");
    expect(decision.action).toBe("check_in");
  });
});

describe("Grok output-loop guard", () => {
  test("normalizes case and whitespace for output signatures", () => {
    expect(fingerprintGrokTurnOutput("  SAME\n output ")).toBe(
      fingerprintGrokTurnOutput("same output"),
    );
  });

  test("halts on the configured occurrence even across a short A/B cycle", () => {
    let state: GrokTurnControllerState = createGrokTurnControllerState();
    for (const output of ["Plan A", "Plan B", " plan   a ", "Plan B"]) {
      const decision = decideGrokTurn(
        { stopReason: "end_turn", assistantText: output, state },
        { maxAutomaticContinuations: 20, maxRepeatedOutputOccurrences: 3, outputHistorySize: 5 },
      );
      expect(decision.action).toBe("continue");
      state = decision.nextState;
    }

    const loop = decideGrokTurn(
      { stopReason: "end_turn", assistantText: "PLAN A", state },
      { maxAutomaticContinuations: 20, maxRepeatedOutputOccurrences: 3, outputHistorySize: 5 },
    );
    expect(loop.kind).toBe("repeated_output");
    expect(loop.action).toBe("check_in");
    if (loop.kind === "repeated_output") expect(loop.occurrenceCount).toBe(3);
    expect(loop.nextState.recentOutputFingerprints.length).toBeLessThanOrEqual(5);
  });

  test("keeps history bounded for distinct outputs", () => {
    let state = createGrokTurnControllerState();
    for (let turn = 0; turn < 10; turn += 1) {
      state = decideGrokTurn(
        { stopReason: "end_turn", assistantText: `output-${turn}`, state },
        { maxAutomaticContinuations: 20, maxRepeatedOutputOccurrences: 2, outputHistorySize: 3 },
      ).nextState;
    }
    expect(state.recentOutputFingerprints).toHaveLength(3);
  });
});

describe("Grok non-continuable stop reasons", () => {
  test("distinguishes cancellation, refusal, and unknown protocol stops", () => {
    const cancelled = decideGrokTurn({ stopReason: "cancelled", assistantText: "partial" });
    expect(cancelled.kind).toBe("cancelled");
    expect(cancelled.action).toBe("cancel");

    const refused = decideGrokTurn({ stopReason: "refusal", assistantText: "no" });
    expect(refused.kind).toBe("refused");
    expect(refused.action).toBe("fail");

    for (const stopReason of ["future_reason", null, undefined]) {
      const unknown = decideGrokTurn({ stopReason, assistantText: "partial" });
      expect(unknown.kind).toBe("unknown_stop");
      expect(unknown.action).toBe("fail");
    }
  });

  test("cancellation and refusal override contract-like partial text", () => {
    for (const stopReason of ["cancelled", "refusal"]) {
      const decision = decideGrokTurn({
        stopReason,
        assistantText: "<<OBJECTIVE_COMPLETE>>\npartial before stop",
      });
      expect(decision.kind).toBe(stopReason === "cancelled" ? "cancelled" : "refused");
    }
  });

  test("a real operator prompt can reset all continuation and loop state", () => {
    expect(resetGrokTurnControllerState()).toEqual({
      automaticContinuationCount: 0,
      recentOutputFingerprints: [],
    });
  });
});
