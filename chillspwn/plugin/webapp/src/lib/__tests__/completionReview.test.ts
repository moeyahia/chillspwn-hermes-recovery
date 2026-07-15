import { describe, expect, test } from "bun:test";
import { operationsApi } from "../../data/api/operations";
import { parseEvaluationPage } from "../../domain/schemas/operations";
import type { EventRecord, FindingRecord } from "../../domain/types/operations";
import type { PlanStep, RuntimeRun } from "../../domain/types/runtimeV2";
import { comparisonBasisLabel, completionOutcomeLabel, formatComparisonMetricValue, summarizeCompletionEvents, unresolvedCompletionItems } from "../completionReview";

function event(id: string, eventType: string, summary: string, contextPackId: string | null = null): EventRecord {
  return {
    id, eventType, summary, occurredAt: "2026-07-15T12:00:00.000Z", mission: null,
    runId: "run-1", sequence: 1, actor: { type: "system", id: null }, payload: {},
    eventSchemaVersion: 1, journey: "autonomous", correlation: { traceId: null, spanId: null, contextPackId },
    sensitivity: "internal", redaction: {},
  };
}

describe("terminal run completion model", () => {
  test("summarizes bounded recovery, policy, retry, safe-stop, and memory context events", () => {
    const summary = summarizeCompletionEvents([
      event("1", "action.retry_scheduled", "Transient provider retry", "pack-1"),
      event("2", "run.recovering", "Loop detector began recovery", "pack-1"),
      event("3", "policy.denied", "Outside contract; safe-stopped", "pack-2"),
    ]);
    expect(summary).toEqual({ retryEvents: 1, recoveryEvents: 1, policyEvents: 1, safeStopEvents: 1, contextPackIds: ["pack-1", "pack-2"] });
  });

  test("uses journey-aware terminal language without claiming nonterminal completion", () => {
    const base = { journey: "autonomous", statusReason: null } as Pick<RuntimeRun, "journey" | "statusReason">;
    expect(completionOutcomeLabel({ ...base, status: "completed" })).toBe("Completed autonomously");
    expect(completionOutcomeLabel({ ...base, status: "failed", statusReason: "Outside contract" })).toBe("Safe-stopped outside contract");
    expect(completionOutcomeLabel({ ...base, status: "running" })).toBe("Completion review unavailable");
  });

  test("surfaces only unresolved plan and finding records", () => {
    const steps = [
      { id: "step-done", title: "Done", status: "completed" },
      { id: "step-open", title: "Validate remaining service", status: "failed" },
    ] as PlanStep[];
    const findings = [
      { id: "finding-done", title: "Verified", reviewStatus: "verified" },
      { id: "finding-open", title: "Needs review", reviewStatus: "under_review" },
    ] as FindingRecord[];
    expect(unresolvedCompletionItems(steps, findings)).toEqual([
      { id: "step-open", type: "step", status: "failed", summary: "Validate remaining service" },
      { id: "finding-open", type: "finding", status: "under_review", summary: "Needs review" },
    ]);
  });

  test("builds an encoded same-origin export path", () => {
    expect(operationsApi.runCompletionExportUrl("run:authorized/1")).toBe("/api/v2/reports/runs/run%3Aauthorized%2F1/export");
  });

  test("parses and formats a canonical measured comparison without inventing a claim", () => {
    const page = parseEvaluationPage({
      schemaVersion: "2.1",
      nextCursor: null,
      items: [{
        id: "evaluation-current",
        mission: { id: "mission-a", name: "Authorized mission" },
        run: { id: "run-current", status: "completed" },
        journey: "autonomous",
        scores: {},
        metrics: {},
        retrospective: "Evidence-linked evaluation",
        evidenceCoverage: 0.75,
        createdBy: "run-evaluator",
        createdAt: "2026-07-15T12:00:00.000Z",
        comparison: {
          status: "available",
          basis: "same_mission_and_journey",
          reason: "canonical_prior_selected",
          prior: {
            evaluationId: "evaluation-prior",
            runId: "run-prior",
            terminalStatus: "completed",
            evaluatedAt: "2026-07-15T10:00:00.000Z",
          },
          terminalStatusMatch: true,
          metrics: [{
            key: "durationMs", label: "Elapsed time", unit: "milliseconds",
            favorableDirection: "lower", current: 60_000, prior: 120_000,
            delta: -60_000, relativeDelta: -0.5, movement: "favorable",
          }],
          summary: "One measured direction was favorable. This descriptive comparison does not establish that the system improved.",
          createdAt: "2026-07-15T12:00:00.000Z",
        },
      }],
    });
    expect(page.items[0]?.comparison).toMatchObject({
      status: "available",
      basis: "same_mission_and_journey",
      metrics: [{ key: "durationMs", movement: "favorable" }],
    });
    expect(comparisonBasisLabel(page.items[0]!.comparison.basis)).toBe("Same mission and journey");
    expect(formatComparisonMetricValue(page.items[0]!.comparison.metrics[0]!, 60_000)).toBe("1 min");
    expect(page.items[0]!.comparison.summary).toContain("does not establish that the system improved");
  });
});
