import type { SqliteDatabase } from "../db";
import { hashJson } from "../orchestration/serialization";
import { OperationsApiError, notFound } from "./errors";
import { lessonScopeSql, missionScopeSql, sensitivitySql } from "./scope";
import type {
  OperationsAccessPolicy,
  RecoveryActionAvailability,
  RunRecoveryProjection,
} from "./types";
import { OPERATIONS_SCHEMA_VERSION } from "./types";
import { parseJson, sanitizeJson } from "./validation";

type Row = Record<string, unknown>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function text(value: unknown): string {
  const safe = sanitizeJson(value);
  return typeof safe === "string" ? safe : String(safe ?? "");
}

function budgetLimit(budget: Record<string, unknown>, canonical: string, legacy: string): number | null {
  return finite(budget[canonical] ?? budget[legacy]);
}

function remaining(used: number, limit: number | null): number | null {
  return limit === null ? null : Math.max(0, limit - used);
}

function isTerminal(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function recoveryActions(input: {
  status: string;
  hasCheckpoint: boolean;
  replanRemaining: number | null;
}): RecoveryActionAvailability[] {
  const resumeAvailable = input.status === "blocked" && input.hasCheckpoint;
  return [
    {
      kind: "resume",
      label: "Resume from checkpoint",
      available: resumeAvailable,
      reason: resumeAvailable
        ? "The public runtime resume command can continue this blocked run from its durable checkpoint."
        : input.status !== "blocked"
          ? "Resume is supported only while the canonical run state is blocked."
          : "No validated durable checkpoint is available for resume.",
      command: resumeAvailable ? "resume" : null,
    },
    {
      kind: "replan",
      label: "Request bounded replan",
      available: false,
      reason: input.replanRemaining === 0
        ? "The canonical replan budget is exhausted."
        : "Replanning is supervisor-owned; no operator replan mutation endpoint is implemented.",
      command: null,
    },
    {
      kind: "reassign",
      label: "Reassign specialist",
      available: false,
      reason: "Specialist reassignment has no policy-enforcing operator mutation endpoint yet.",
      command: null,
    },
    {
      kind: "change_provider",
      label: "Change provider",
      available: false,
      reason: "Provider changes require policy and contract validation; no safe operator mutation endpoint is implemented.",
      command: null,
    },
    {
      kind: "terminate",
      label: "Terminate gracefully",
      available: !isTerminal(input.status),
      reason: isTerminal(input.status)
        ? "The run is already terminal."
        : "The public cancellation command propagates to child work, releases leases, and writes a terminal checkpoint.",
      command: isTerminal(input.status) ? null : "cancel",
    },
  ];
}

/** Scope-enforcing, read-only recovery projection over canonical Command OS state. */
export class RecoveryRepository {
  constructor(private readonly database: SqliteDatabase) {}

  getRunRecovery(runId: string, access: OperationsAccessPolicy): RunRecoveryProjection {
    const scope = missionScopeSql("m", access);
    const run = this.database.prepare(`
      SELECT r.*, m.name AS mission_name, m.engagement_id
      FROM runs r JOIN missions m ON m.id = r.mission_id
      WHERE r.id = ? AND ${scope.sql}
    `).get(runId, ...scope.params) as Row | undefined;
    if (!run) throw notFound("Run recovery record");
    if (run.journey !== "autonomous" && run.journey !== "guided") {
      throw new OperationsApiError(500, "invalid_recovery_journey", "Recovery journey is invalid", {
        category: "data_integrity",
      });
    }

    const failedRows = this.database.prepare(`
      SELECT id, status, intent_summary, result_summary, error_category,
        retry_count, ended_at
      FROM actions
      WHERE run_id = ? AND status IN ('failed', 'timed_out', 'denied')
      ORDER BY coalesce(ended_at, updated_at) DESC, id DESC LIMIT 12
    `).all(runId) as Row[];
    const failedActions = failedRows.map((item) => ({
      id: String(item.id),
      status: String(item.status),
      intentSummary: text(item.intent_summary),
      resultSummary: item.result_summary === null ? null : text(item.result_summary),
      errorCategory: item.error_category === null ? null : String(item.error_category),
      retryCount: Number(item.retry_count ?? 0),
      endedAt: item.ended_at === null ? null : String(item.ended_at),
    }));

    const eventRows = this.database.prepare(`
      SELECT id, event_type, summary, occurred_at, sequence
      FROM events
      WHERE run_id = ? AND (
        event_type IN (
          'run.recovery_started', 'run.recovery_blocked', 'run.replan_started',
          'run.safe_stopped', 'run.cancellation_failed', 'policy.denied'
        )
        OR (event_type = 'run.state_changed'
          AND json_extract(payload_json, '$.to') IN ('recovering', 'blocked', 'failed', 'waiting_guided_decision'))
        OR (event_type = 'action.completed'
          AND json_extract(payload_json, '$.directive') IN ('retry', 'recover', 'blocked', 'failed'))
      )
      ORDER BY sequence DESC LIMIT 12
    `).all(runId) as Row[];
    const eventEvidence = eventRows.map((item) => ({
      id: String(item.id),
      eventType: String(item.event_type),
      summary: text(item.summary),
      occurredAt: String(item.occurred_at),
      sequence: Number(item.sequence),
    }));

    const checkpointRow = this.database.prepare(`
      SELECT id, event_sequence, plan_version, state_json, state_hash,
        in_flight_classification, created_at
      FROM checkpoints WHERE run_id = ?
      ORDER BY event_sequence DESC, created_at DESC LIMIT 1
    `).get(runId) as Row | undefined;
    let checkpoint: RunRecoveryProjection["checkpoint"] = null;
    if (checkpointRow) {
      const state = record(parseJson(String(checkpointRow.state_json)));
      if (hashJson(state) !== checkpointRow.state_hash) {
        throw new OperationsApiError(500, "checkpoint_integrity_failed", "Recovery checkpoint integrity check failed", {
          humanMessage: "The latest recovery checkpoint failed its integrity check and cannot be used.",
          category: "data_integrity",
          remediation: "Keep the run stopped and inspect the immutable event history before attempting recovery.",
        });
      }
      const completed = Array.isArray(state.completedActionIds) ? state.completedActionIds : [];
      const inFlight = Array.isArray(state.inFlightActions) ? state.inFlightActions : [];
      checkpoint = {
        id: String(checkpointRow.id),
        eventSequence: Number(checkpointRow.event_sequence),
        planVersion: checkpointRow.plan_version === null ? null : Number(checkpointRow.plan_version),
        createdAt: String(checkpointRow.created_at),
        stateHash: String(checkpointRow.state_hash),
        inFlightClassification: checkpointRow.in_flight_classification === null
          ? null
          : String(checkpointRow.in_flight_classification),
        completedActionCount: completed.length,
        inFlightActions: inFlight.slice(0, 50).flatMap((value) => {
          const item = record(value);
          if (typeof item.id !== "string" || typeof item.status !== "string") return [];
          return [{
            id: item.id,
            status: item.status,
            idempotent: item.idempotent === true,
            destructive: item.destructive === true,
          }];
        }),
      };
    }

    const budget = record(parseJson(String(run.budget_json ?? "{}")));
    const retryCount = Number(run.retry_count ?? 0);
    const replanCount = Number(run.replan_count ?? 0);
    const retryLimit = budgetLimit(budget, "retries", "retryBudget");
    const replanLimit = budgetLimit(budget, "replans", "replanBudget");
    const retriesRemaining = remaining(retryCount, retryLimit);
    const replansRemaining = remaining(replanCount, replanLimit);
    const pendingDecision = this.database.prepare(`
      SELECT id, step_id, rationale, risk_class, expires_at
      FROM guided_decisions
      WHERE run_id = ? AND status = 'pending'
      ORDER BY created_at DESC, id DESC LIMIT 1
    `).get(runId) as Row | undefined;
    const category = failedActions.find((item) => item.errorCategory)?.errorCategory ?? null;
    const status = String(run.status);
    const statusReason = run.status_reason === null ? null : text(run.status_reason);
    const reason = statusReason
      ?? eventEvidence[0]?.summary
      ?? failedActions[0]?.resultSummary
      ?? "No diagnostic reason has been persisted.";
    const recoveryEvent = eventEvidence.some((item) => item.eventType.startsWith("run.recovery") || item.eventType === "run.replan_started");
    const recoveryRequired = ["blocked", "recovering", "failed"].includes(status)
      || (run.journey === "guided" && status === "waiting_guided_decision" && (failedActions.length > 0 || recoveryEvent));

    const noExecutionImpact = status === "blocked" || isTerminal(status);
    const impact = {
      time: noExecutionImpact
        ? "No execution time is consumed while the run remains stopped."
        : `Automatic recovery may consume ${retriesRemaining ?? "an unreported number of"} remaining retries and ${replansRemaining ?? "an unreported number of"} remaining replans.`,
      cost: noExecutionImpact
        ? "No additional provider or tool cost is expected until execution resumes."
        : "Any retry or replan remains subject to the canonical token, cost, and tool-call budgets.",
      scope: run.journey === "autonomous"
        ? "The signed Autonomous contract remains unchanged; recovery cannot expand scope."
        : "The Guided exact-step boundary remains unchanged; a materially different action requires a new decision.",
    };

    let proposedRecovery: RunRecoveryProjection["proposedRecovery"];
    if (!recoveryRequired) {
      proposedRecovery = { kind: "none", summary: "No recovery is currently required.", basis: reason, impact };
    } else if (run.journey === "guided" && pendingDecision) {
      proposedRecovery = {
        kind: "guided_decision",
        summary: "Review the new bounded Guided action and make one deliberate decision.",
        basis: reason,
        impact,
      };
    } else if (status === "recovering") {
      proposedRecovery = {
        kind: "automatic_recovery",
        summary: run.journey === "autonomous"
          ? text(run.next_action_summary ?? "The supervisor is selecting an in-contract recovery path.")
          : "The supervisor is preparing a materially different Guided action; it must publish a decision before execution.",
        basis: reason,
        impact,
      };
    } else if (status === "blocked" && /paused by operator/iu.test(statusReason ?? "")) {
      proposedRecovery = {
        kind: "operator_resume",
        summary: "Resume from the last durable checkpoint when the recorded pause condition is resolved.",
        basis: reason,
        impact,
      };
    } else if (run.journey === "autonomous" && (status === "blocked" || /contract|scope|policy/iu.test(statusReason ?? ""))) {
      proposedRecovery = {
        kind: "safe_stop",
        summary: "Keep the run safe-stopped unless an in-contract path becomes available through a new run or versioned contract amendment.",
        basis: reason,
        impact,
      };
    } else if (status === "failed") {
      proposedRecovery = {
        kind: "failed_safely",
        summary: "The run is terminal. Review the exception evidence before creating a new run.",
        basis: reason,
        impact,
      };
    } else {
      proposedRecovery = {
        kind: "operator_resume",
        summary: "Resolve the recorded blocker, then resume from the durable checkpoint.",
        basis: reason,
        impact,
      };
    }

    const visibility = sensitivitySql("mn.sensitivity", access);
    const memoryRows = this.database.prepare(`
      SELECT mn.id, mn.title, mn.lifecycle_status, mn.confidence
      FROM memory_nodes mn
      WHERE mn.node_type = 'failure'
        AND mn.lifecycle_status != 'forgotten'
        AND ${visibility.sql}
        AND (mn.mission_id = ? OR EXISTS (
          SELECT 1 FROM memory_sources ms WHERE ms.node_id = mn.id AND ms.run_id = ?
        ))
      ORDER BY mn.updated_at DESC, mn.id DESC LIMIT 8
    `).all(...visibility.params, run.mission_id, runId) as Row[];
    const lessonScope = lessonScopeSql("l", access);
    const lessonRows = this.database.prepare(`
      SELECT l.id, l.statement, l.status, l.confidence, l.failure_category
      FROM lessons l
      WHERE ${lessonScope.sql}
        AND (l.lesson_type = 'failed_attempt' OR l.failure_category IS NOT NULL)
        AND (
          l.mission_id = ?
          OR EXISTS (SELECT 1 FROM lesson_evidence le WHERE le.lesson_id = l.id AND le.run_id = ?)
          ${category ? "OR (l.failure_category = ? AND (l.engagement_id IS NULL OR l.engagement_id = ?))" : ""}
        )
      ORDER BY CASE l.status WHEN 'verified' THEN 0 ELSE 1 END, l.updated_at DESC, l.id DESC
      LIMIT 8
    `).all(
      ...lessonScope.params,
      run.mission_id,
      runId,
      ...(category ? [category, run.engagement_id] : []),
    ) as Row[];
    const failedAttemptMemories: RunRecoveryProjection["failedAttemptMemories"] = [
      ...memoryRows.map((item) => ({
        kind: "memory" as const,
        id: String(item.id),
        title: text(item.title),
        status: String(item.lifecycle_status),
        confidence: finite(item.confidence),
        failureCategory: null,
      })),
      ...lessonRows.map((item) => ({
        kind: "lesson" as const,
        id: String(item.id),
        title: text(item.statement),
        status: String(item.status),
        confidence: finite(item.confidence),
        failureCategory: item.failure_category === null ? null : String(item.failure_category),
      })),
    ];

    return {
      schemaVersion: OPERATIONS_SCHEMA_VERSION,
      recoveryRequired,
      run: {
        id: String(run.id),
        missionId: String(run.mission_id),
        missionName: text(run.mission_name),
        journey: run.journey,
        status,
        statusReason,
        currentStepId: run.current_step_id === null ? null : String(run.current_step_id),
        currentOwnerId: run.current_owner_id === null ? null : String(run.current_owner_id),
        nextAction: run.next_action_summary === null ? null : text(run.next_action_summary),
        leaseExpiresAt: run.lease_expires_at === null ? null : String(run.lease_expires_at),
      },
      detection: {
        summary: reason,
        category,
        evidence: eventEvidence,
        failedActions,
      },
      checkpoint,
      attempts: {
        retryCount,
        retryLimit,
        retriesRemaining,
        replanCount,
        replanLimit,
        replansRemaining,
      },
      proposedRecovery,
      guidedDecision: pendingDecision ? {
        id: String(pendingDecision.id),
        stepId: String(pendingDecision.step_id),
        rationale: text(pendingDecision.rationale),
        riskClass: String(pendingDecision.risk_class),
        expiresAt: String(pendingDecision.expires_at),
      } : null,
      failedAttemptMemories,
      actions: recoveryActions({ status, hasCheckpoint: checkpoint !== null, replanRemaining: replansRemaining }),
    };
  }
}
