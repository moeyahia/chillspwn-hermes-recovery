import type { SqliteDatabase } from "../db";
import type { RunEvent } from "../events/types";
import type { NotificationSeverity } from "./types";

interface NotificationTemplate {
  readonly allowedJourneys: readonly RunEvent["journey"][];
  readonly notificationType: string;
  readonly severity: NotificationSeverity;
  readonly title: string;
  readonly body: string;
}

const BOTH_JOURNEYS = Object.freeze(["autonomous", "guided"] as const);
const AUTONOMOUS_ONLY = Object.freeze(["autonomous"] as const);
const GUIDED_ONLY = Object.freeze(["guided"] as const);

const TEMPLATES: Readonly<Record<string, NotificationTemplate>> = Object.freeze({
  "guided.decision_requested": {
    allowedJourneys: GUIDED_ONLY,
    notificationType: "guided_decision_ready",
    severity: "warning",
    title: "Guided step ready",
    body: "A represented Guided step is ready for your deliberate decision.",
  },
  "guided.commander.recovery_ready": {
    allowedJourneys: GUIDED_ONLY,
    notificationType: "guided_recovery_ready",
    severity: "warning",
    title: "Guided recovery ready",
    body: "A bounded recovery step is ready for your deliberate decision.",
  },
  "run.guided_blocked": {
    allowedJourneys: GUIDED_ONLY,
    notificationType: "guided_run_blocked",
    severity: "error",
    title: "Guided run blocked",
    body: "The Guided run stopped at a durable boundary and needs your review.",
  },
  "run.autonomous_safe_stopped": {
    allowedJourneys: AUTONOMOUS_ONLY,
    notificationType: "autonomous_safe_stop",
    severity: "critical",
    title: "Autonomous run safe-stopped",
    body: "The run stopped safely because no permitted in-contract path remained.",
  },
  "run.safe_stopped": {
    allowedJourneys: AUTONOMOUS_ONLY,
    notificationType: "autonomous_safe_stop",
    severity: "critical",
    title: "Autonomous run safe-stopped",
    body: "The run stopped safely at its enforced operating boundary.",
  },
  "run.failed_safely": {
    allowedJourneys: BOTH_JOURNEYS,
    notificationType: "run_failed_safely",
    severity: "error",
    title: "Run failed safely",
    body: "The run ended without weakening its authorization or safety policy.",
  },
  "run.recovery_started": {
    allowedJourneys: BOTH_JOURNEYS,
    notificationType: "recovery_required",
    severity: "warning",
    title: "Run recovery started",
    body: "The supervisor detected a recoverable interruption and started bounded recovery.",
  },
  "run.recovery_blocked": {
    allowedJourneys: BOTH_JOURNEYS,
    notificationType: "recovery_blocked",
    severity: "critical",
    title: "Run recovery blocked",
    body: "Bounded recovery could not continue safely and requires operator review.",
  },
  "run.continuation_blocked": {
    allowedJourneys: BOTH_JOURNEYS,
    notificationType: "continuation_blocked",
    severity: "critical",
    title: "Run continuation blocked",
    body: "Durable continuation stopped because replay could not be proven safe.",
  },
  "run.cancellation_failed": {
    allowedJourneys: BOTH_JOURNEYS,
    notificationType: "cancellation_failed",
    severity: "critical",
    title: "Cancellation requires review",
    body: "Child-work cleanup was not confirmed and the run stopped for review.",
  },
  "action.pre_dispatch_denied": {
    allowedJourneys: AUTONOMOUS_ONLY,
    notificationType: "autonomous_dispatch_denied",
    severity: "critical",
    title: "Autonomous dispatch denied",
    body: "An action was denied before dispatch by the enforced mission boundary.",
  },
  "policy.denied": {
    allowedJourneys: BOTH_JOURNEYS,
    notificationType: "policy_denied",
    severity: "critical",
    title: "Policy denied an action",
    body: "The runtime prevented an action that did not satisfy current policy.",
  },
  "budget.exhausted": {
    allowedJourneys: BOTH_JOURNEYS,
    notificationType: "budget_exhausted",
    severity: "error",
    title: "Run budget exhausted",
    body: "The run reached an enforced operating budget and stopped further work.",
  },
  "run.budget_exhausted": {
    allowedJourneys: BOTH_JOURNEYS,
    notificationType: "budget_exhausted",
    severity: "error",
    title: "Run budget exhausted",
    body: "The run reached an enforced operating budget and stopped further work.",
  },
  "run.success_validated": {
    allowedJourneys: BOTH_JOURNEYS,
    notificationType: "run_completed",
    severity: "info",
    title: "Mission outcome validated",
    body: "The run completed and its success criteria were evaluated.",
  },
  "run.completed": {
    allowedJourneys: BOTH_JOURNEYS,
    notificationType: "run_completed",
    severity: "info",
    title: "Run completed",
    body: "The run reached a terminal completion state and is ready for review.",
  },
  "run.success_criteria_failed": {
    allowedJourneys: BOTH_JOURNEYS,
    notificationType: "run_failed",
    severity: "error",
    title: "Mission criteria not met",
    body: "The terminal evaluation found that the mission success criteria were not met.",
  },
  "run.cancelled": {
    allowedJourneys: BOTH_JOURNEYS,
    notificationType: "run_cancelled",
    severity: "info",
    title: "Run cancelled",
    body: "The run and its child work reached a confirmed cancelled state.",
  },
  "memory.candidate_created": {
    allowedJourneys: BOTH_JOURNEYS,
    notificationType: "memory_candidate_ready",
    severity: "info",
    title: "Memory candidate ready",
    body: "A reviewable memory candidate is waiting in the Memory Inbox.",
  },
  "approval.requested": {
    allowedJourneys: BOTH_JOURNEYS,
    notificationType: "approval_requested",
    severity: "warning",
    title: "Administrative approval requested",
    body: "A scoped administrative approval record is ready for review.",
  },
  "vault.conflict_detected": {
    allowedJourneys: BOTH_JOURNEYS,
    notificationType: "vault_conflict",
    severity: "warning",
    title: "Obsidian vault conflict",
    body: "A versioned vault conflict is waiting for side-by-side resolution.",
  },
});

/**
 * Project only explicitly recognized semantic events. Notification content is
 * fixed by event class: payloads, provider output, tool output, and event
 * summaries are intentionally never copied into this user-facing store.
 */
export class NotificationProjector {
  private readonly insert;

  constructor(database: SqliteDatabase) {
    this.insert = database.prepare(`
      INSERT OR IGNORE INTO notifications (
        id, mission_id, run_id, notification_type, severity,
        title, body, read_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `);
  }

  project(event: RunEvent): boolean {
    const template = TEMPLATES[event.eventType];
    if (!template) return false;
    // Every template declares its journey contract. Unknown combinations fail
    // closed so a generic-looking event can never inherit the wrong journey
    // label (notably Guided run.safe_stopped as an Autonomous safe stop).
    if (!template.allowedJourneys.includes(event.journey)) return false;
    return this.insert.run(
      `notification:${event.id}`,
      event.missionId,
      event.runId,
      template.notificationType,
      template.severity,
      template.title,
      template.body,
      event.occurredAt,
    ).changes === 1;
  }
}

export function isActionableNotificationEvent(eventType: string): boolean {
  return Object.hasOwn(TEMPLATES, eventType);
}
