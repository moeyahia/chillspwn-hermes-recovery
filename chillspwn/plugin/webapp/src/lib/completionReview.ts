import type { EvaluationComparisonMetric, EventRecord, FindingRecord } from "../domain/types/operations";
import type { PlanStep, RuntimeRun } from "../domain/types/runtimeV2";

export interface CompletionEventSummary {
  retryEvents: number;
  recoveryEvents: number;
  policyEvents: number;
  safeStopEvents: number;
  contextPackIds: string[];
}

export function summarizeCompletionEvents(events: readonly EventRecord[]): CompletionEventSummary {
  const contextPackIds = new Set<string>();
  let retryEvents = 0;
  let recoveryEvents = 0;
  let policyEvents = 0;
  let safeStopEvents = 0;
  for (const event of events) {
    const semantic = `${event.eventType} ${event.summary}`.toLocaleLowerCase("en-US");
    if (/retry|attempt\.repeated/u.test(semantic)) retryEvents += 1;
    if (/recover|stagn|loop|lease\.expired|worker\.lost/u.test(semantic)) recoveryEvents += 1;
    if (/policy|contract|authori[sz]|scope|approval|decision/u.test(semantic)) policyEvents += 1;
    if (/safe[-_. ]?stop|outside (?:the )?contract/u.test(semantic)) safeStopEvents += 1;
    if (event.correlation.contextPackId) contextPackIds.add(event.correlation.contextPackId);
  }
  return { retryEvents, recoveryEvents, policyEvents, safeStopEvents, contextPackIds: [...contextPackIds] };
}

export function completionOutcomeLabel(run: Pick<RuntimeRun, "journey" | "status" | "statusReason">): string {
  if (run.status === "completed") return run.journey === "autonomous" ? "Completed autonomously" : "Guided mission completed";
  if (run.status === "cancelled") return "Cancelled by an authorized operator";
  if (run.status === "failed") {
    return run.journey === "autonomous" && /contract|scope|policy/iu.test(run.statusReason ?? "")
      ? "Safe-stopped outside contract"
      : "Failed safely";
  }
  return "Completion review unavailable";
}

export function unresolvedCompletionItems(
  steps: readonly PlanStep[],
  findings: readonly FindingRecord[],
): Array<{ id: string; type: "step" | "finding"; status: string; summary: string }> {
  return [
    ...steps
      .filter((step) => !["completed", "skipped", "cancelled"].includes(step.status))
      .map((step) => ({ id: step.id, type: "step" as const, status: step.status, summary: step.title })),
    ...findings
      .filter((finding) => !["verified", "accepted_risk", "rejected"].includes(finding.reviewStatus))
      .map((finding) => ({ id: finding.id, type: "finding" as const, status: finding.reviewStatus, summary: finding.title })),
  ];
}

export function comparisonBasisLabel(basis: "same_mission_and_journey" | "same_engagement_and_journey" | null): string {
  if (basis === "same_mission_and_journey") return "Same mission and journey";
  if (basis === "same_engagement_and_journey") return "Same engagement and journey";
  return "No in-scope comparison basis";
}

export function formatComparisonMetricValue(metric: Pick<EvaluationComparisonMetric, "unit">, value: number): string {
  if (metric.unit === "ratio") return `${Math.round(value * 10_000) / 100}%`;
  if (metric.unit === "milliseconds") {
    const magnitude = Math.abs(value);
    if (magnitude < 1_000) return `${Math.round(value)} ms`;
    if (magnitude < 60_000) return `${Math.round(value / 100) / 10} s`;
    return `${Math.round(value / 6_000) / 10} min`;
  }
  if (metric.unit === "cost") return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value);
  return new Intl.NumberFormat().format(value);
}
