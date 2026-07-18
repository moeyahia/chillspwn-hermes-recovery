import { createHash } from "node:crypto";
import { createDatabaseConnection, migrateDatabase } from "../../../server/db";
import { canonicalLessonMemoryNodeId } from "../../../server/learning/AttackChainLessonRepository";
import { MemoryRepository } from "../../../server/memory";
import { canonicalJson, hashJson } from "../../../server/orchestration/serialization";
import { fingerprintAction } from "../../../server/supervisor";
import { EventRepository } from "../../../server/events";

const CREATED = "2026-07-15T08:00:00.000Z";
const UPDATED = "2026-07-15T08:08:00.000Z";
const RECOVERY_AT = "2026-07-15T07:30:00.000Z";
const FIXTURE_LEASE_EXPIRY = "2099-01-01T00:00:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function representation(input: {
  title: string;
  target: string;
  kind: "tool" | "manual";
  actionClass: string;
}): string {
  return canonicalJson({
    explanation: `This bounded fixture step explains ${input.title.toLocaleLowerCase()} before any consequential action.`,
    rationale: "The represented action is scoped, reversible, and produces a clear verification signal.",
    reversibility: "Read-only; no target state is changed.",
    dependencies: [],
    action: {
      actionType: input.kind === "manual" ? "manual_verification" : "evidence_review",
      actionClass: input.actionClass,
      target: input.target,
      arguments: input.kind === "manual" ? { procedure: "Review the supplied isolated result" } : {},
      intentSummary: input.title,
      kind: input.kind,
      idempotent: true,
      destructive: false,
    },
  });
}

function seedRecoveryAcceptanceFixtures(database: ReturnType<typeof createDatabaseConnection>): void {
  const missions = [
    {
      id: "mission-e2e-auto-transient",
      name: "[E2E fixture] Autonomous transient recovery",
      objective: "Recover one idempotent in-contract observation after a transient timeout.",
      journey: "autonomous",
      status: "active",
    },
    {
      id: "mission-e2e-auto-loop",
      name: "[E2E fixture] Autonomous repeated-action stop",
      objective: "Bound repeated identical actions that produce no meaningful progress.",
      journey: "autonomous",
      status: "paused",
    },
    {
      id: "mission-e2e-guided-transient",
      name: "[E2E fixture] Guided transient recovery",
      objective: "Explain a timeout and wait for one materially different recovery decision.",
      journey: "guided",
      status: "active",
    },
    {
      id: "mission-e2e-guided-loop",
      name: "[E2E fixture] Guided repeated-action stop",
      objective: "Stop a repeated Guided action and explain the missing new information.",
      journey: "guided",
      status: "paused",
    },
  ] as const;
  const insertMission = database.prepare(`
    INSERT INTO missions (
      id, name, objective, journey, status, authorization_status, engagement_id,
      scope_json, success_criteria_json, retention_policy_json, memory_policy_json,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'verified', 'eng-e2e', ?, ?, '{}', '{}',
      'e2e-fixture', ?, ?)
  `);
  const insertTarget = database.prepare(`
    INSERT INTO mission_targets (
      id, mission_id, target, target_type, disposition, normalized_target,
      metadata_json, created_at
    ) VALUES (?, ?, 'fixture.local', 'hostname', 'allowed', 'fixture.local',
      '{"fixture":true}', ?)
  `);
  for (const mission of missions) {
    insertMission.run(
      mission.id,
      mission.name,
      mission.objective,
      mission.journey,
      mission.status,
      canonicalJson({ authorized: true, fixture: true }),
      canonicalJson(["Recovery remains bounded and operator-readable"]),
      RECOVERY_AT,
      RECOVERY_AT,
    );
    insertTarget.run(`target-${mission.id}`, mission.id, RECOVERY_AT);
  }

  const insertContract = database.prepare(`
    INSERT INTO mission_contracts (
      id, mission_id, version, state, contract_hash, authorization_json,
      action_policy_json, budgets_json, safe_stop_json, deliverables_json,
      memory_scopes_json, confirmed_by, confirmed_at, created_at
    ) VALUES (?, ?, 1, 'confirmed', ?, '{"fixture":true}', ?, ?,
      '{"outsideContract":"safe_stop"}', '[]', '["verified_lessons"]',
      'e2e-operator', ?, ?)
  `);
  insertContract.run(
    "contract-e2e-auto-transient",
    "mission-e2e-auto-transient",
    hash("contract-e2e-auto-transient"),
    canonicalJson({ allowedActionClasses: ["analysis"], prohibitedActionClasses: [], contextNodeIds: [] }),
    canonicalJson({ retries: 2, replans: 1, toolCalls: 4, concurrency: 1 }),
    RECOVERY_AT,
    RECOVERY_AT,
  );
  insertContract.run(
    "contract-e2e-auto-loop",
    "mission-e2e-auto-loop",
    hash("contract-e2e-auto-loop"),
    canonicalJson({ allowedActionClasses: ["analysis"], prohibitedActionClasses: [], contextNodeIds: [] }),
    canonicalJson({ retries: 2, replans: 1, toolCalls: 4, concurrency: 1 }),
    RECOVERY_AT,
    RECOVERY_AT,
  );

  const insertRun = database.prepare(`
    INSERT INTO runs (
      id, mission_id, journey, status, contract_id, current_plan_id,
      current_step_id, current_owner_id, progress, status_reason,
      next_action_summary, budget_json, budget_usage_json, retry_count,
      replan_count, lease_owner, lease_acquired_at, last_heartbeat_at,
      lease_expires_at, started_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'agent-e2e-recon', ?, ?, ?, ?, ?, ?, 0,
      ?, ?, ?, ?, ?, ?, ?)
  `);
  insertRun.run(
    "run-e2e-auto-transient", "mission-e2e-auto-transient", "autonomous", "recovering",
    "contract-e2e-auto-transient", "plan-e2e-auto-transient", "step-e2e-auto-transient", 0.35,
    "Transient timeout classified; a bounded idempotent retry is scheduled after Retry-After.",
    "Retry the unchanged in-contract observation after the bounded delay",
    canonicalJson({ retries: 2, replans: 1, toolCalls: 4 }),
    canonicalJson({ retries: 1, replans: 0, toolCalls: 1 }),
    1, "e2e-recovery-worker", RECOVERY_AT, RECOVERY_AT, FIXTURE_LEASE_EXPIRY,
    RECOVERY_AT, RECOVERY_AT, RECOVERY_AT,
  );
  insertRun.run(
    "run-e2e-auto-loop", "mission-e2e-auto-loop", "autonomous", "blocked",
    "contract-e2e-auto-loop", "plan-e2e-auto-loop", "step-e2e-auto-loop", 0.2,
    "Repeated identical action fingerprint produced no meaningful progress within the configured bound.",
    "Keep the run safe-stopped and review a materially different in-contract strategy",
    canonicalJson({ retries: 2, replans: 1, toolCalls: 4 }),
    canonicalJson({ retries: 2, replans: 0, toolCalls: 3 }),
    2, null, null, RECOVERY_AT, null, RECOVERY_AT, RECOVERY_AT, RECOVERY_AT,
  );
  insertRun.run(
    "run-e2e-guided-transient", "mission-e2e-guided-transient", "guided", "waiting_guided_decision",
    null, "plan-e2e-guided-transient", "step-e2e-guided-transient", 0.3,
    "The represented observation timed out; a materially different recovery step awaits one exact decision.",
    "Review the alternate bounded Guided observation",
    canonicalJson({ retries: 2, replans: 1, toolCalls: 4 }),
    canonicalJson({ retries: 0, replans: 1, toolCalls: 1 }),
    0, null, null, RECOVERY_AT, null, RECOVERY_AT, RECOVERY_AT, RECOVERY_AT,
  );
  insertRun.run(
    "run-e2e-guided-loop", "mission-e2e-guided-loop", "guided", "blocked",
    null, "plan-e2e-guided-loop", "step-e2e-guided-loop", 0.15,
    "The same Guided action was regenerated without changed facts or missing information.",
    "Explain the loop and wait for a materially different operator choice",
    canonicalJson({ retries: 2, replans: 1, toolCalls: 4 }),
    canonicalJson({ retries: 2, replans: 1, toolCalls: 3 }),
    2, null, null, RECOVERY_AT, null, RECOVERY_AT, RECOVERY_AT, RECOVERY_AT,
  );

  const insertPlan = database.prepare(`
    INSERT INTO plans (
      id, run_id, version, status, strategy_summary, rationale_summary,
      plan_hash, created_by, created_at, activated_at
    ) VALUES (?, ?, 1, 'active', ?, ?, ?, 'e2e-fixture', ?, ?)
  `);
  const planRows = [
    ["plan-e2e-auto-transient", "run-e2e-auto-transient", "Retry once after the provider-directed delay", "Only a transient idempotent failure is eligible for bounded retry."],
    ["plan-e2e-auto-loop", "run-e2e-auto-loop", "Stop the identical no-progress cycle", "The configured fingerprint bound was reached without evidence delta."],
    ["plan-e2e-guided-transient", "run-e2e-guided-transient", "Explain the timeout and offer one alternate step", "Guided recovery remains deliberate and exact."],
    ["plan-e2e-guided-loop", "run-e2e-guided-loop", "Stop repeating the rejected action", "No changed fact justified another identical Guided request."],
  ] as const;
  for (const [planId, runId, strategy, rationale] of planRows) {
    insertPlan.run(planId, runId, strategy, rationale, hash(planId), RECOVERY_AT, RECOVERY_AT);
  }
  const insertStep = database.prepare(`
    INSERT INTO plan_steps (
      id, plan_id, run_id, ordinal, phase, title, objective, status,
      success_criteria_json, dependencies_json, action_class, risk_class,
      assigned_agent_id, started_at, created_at, updated_at
    ) VALUES (?, ?, ?, 0, 'Recovery', ?, ?, ?, ?, '[]', 'analysis', 'low',
      'agent-e2e-recon', ?, ?, ?)
  `);
  const stepRows = [
    ["step-e2e-auto-transient", "plan-e2e-auto-transient", "run-e2e-auto-transient", "Retry the authorized observation", "Produce a new evidence delta after the bounded delay.", "recovering"],
    ["step-e2e-auto-loop", "plan-e2e-auto-loop", "run-e2e-auto-loop", "Stop repeated observation", "Prevent a fourth identical no-progress action.", "blocked"],
    ["step-e2e-guided-transient", "plan-e2e-guided-transient", "run-e2e-guided-transient", "Use an alternate read-only observation", "Let the operator choose one materially different exact step.", "waiting_guided_decision"],
    ["step-e2e-guided-loop", "plan-e2e-guided-loop", "run-e2e-guided-loop", "Explain the repeated-action loop", "Identify the new information needed before another action.", "blocked"],
  ] as const;
  for (const [stepId, planId, runId, title, objective, status] of stepRows) {
    insertStep.run(stepId, planId, runId, title, objective, status, canonicalJson([objective]), RECOVERY_AT, RECOVERY_AT, RECOVERY_AT);
  }
  const insertAssignment = database.prepare(`
    INSERT INTO assignments (
      id, run_id, step_id, agent_id, status, started_at, created_at, updated_at
    ) VALUES (?, ?, ?, 'agent-e2e-recon', ?, ?, ?, ?)
  `);
  insertAssignment.run("assignment-e2e-auto-transient", "run-e2e-auto-transient", "step-e2e-auto-transient", "active", RECOVERY_AT, RECOVERY_AT, RECOVERY_AT);
  insertAssignment.run("assignment-e2e-auto-loop", "run-e2e-auto-loop", "step-e2e-auto-loop", "blocked", RECOVERY_AT, RECOVERY_AT, RECOVERY_AT);
  insertAssignment.run("assignment-e2e-guided-transient", "run-e2e-guided-transient", "step-e2e-guided-transient", "blocked", RECOVERY_AT, RECOVERY_AT, RECOVERY_AT);
  insertAssignment.run("assignment-e2e-guided-loop", "run-e2e-guided-loop", "step-e2e-guided-loop", "blocked", RECOVERY_AT, RECOVERY_AT, RECOVERY_AT);

  const insertAction = database.prepare(`
    INSERT INTO actions (
      id, mission_id, run_id, step_id, assignment_id, action_type, action_class,
      fingerprint, normalized_arguments_json, scoped_target, status,
      intent_summary, result_summary, error_category, retry_count,
      progress_signature, started_at, ended_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'evidence_review', 'analysis', ?, ?, 'fixture.local', ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const timeoutFingerprint = hash("recovery-timeout-action");
  insertAction.run(
    "action-e2e-auto-transient", "mission-e2e-auto-transient", "run-e2e-auto-transient",
    "step-e2e-auto-transient", "assignment-e2e-auto-transient", timeoutFingerprint,
    canonicalJson({ observation: "service-health" }), "timed_out", "Observe the authorized service",
    "The transient provider timeout produced no evidence.", "timeout", 1, hashJson({ evidence: [] }),
    RECOVERY_AT, RECOVERY_AT, RECOVERY_AT, RECOVERY_AT,
  );
  insertAction.run(
    "action-e2e-guided-transient", "mission-e2e-guided-transient", "run-e2e-guided-transient",
    "step-e2e-guided-transient", "assignment-e2e-guided-transient", timeoutFingerprint,
    canonicalJson({ observation: "service-health" }), "timed_out", "Observe the authorized service",
    "The represented Guided observation timed out without evidence.", "timeout", 0, hashJson({ evidence: [] }),
    RECOVERY_AT, RECOVERY_AT, RECOVERY_AT, RECOVERY_AT,
  );
  for (const journey of ["auto", "guided"] as const) {
    const missionId = `mission-e2e-${journey}-loop`;
    const runId = `run-e2e-${journey}-loop`;
    const stepId = `step-e2e-${journey}-loop`;
    const assignmentId = `assignment-e2e-${journey}-loop`;
    const repeatedFingerprint = hash(`${journey}-repeated-action`);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      insertAction.run(
        `action-e2e-${journey}-loop-${attempt}`, missionId, runId, stepId, assignmentId,
        repeatedFingerprint, canonicalJson({ observation: "unchanged", attemptExcludedFromFingerprint: attempt }),
        "failed", "Repeat the unchanged observation",
        `Attempt ${attempt} produced the same deterministic error and no evidence delta.`,
        "deterministic_tool_error", attempt - 1, hashJson({ evidence: [] }),
        RECOVERY_AT, RECOVERY_AT, RECOVERY_AT, RECOVERY_AT,
      );
    }
  }

  database.prepare(`
    INSERT INTO guided_decisions (
      id, mission_id, run_id, step_id, requested_action_fingerprint,
      requested_parameters_json, rationale, risk_class, reversibility,
      status, expires_at, created_at
    ) VALUES (
      'decision-e2e-guided-transient', 'mission-e2e-guided-transient',
      'run-e2e-guided-transient', 'step-e2e-guided-transient', ?, ?,
      'Use a materially different read-only observation after explaining the timeout.',
      'low', 'Read-only and skippable', 'pending', ?, ?
    )
  `).run(
    hash("guided-transient-alternative"),
    canonicalJson({ procedure: "Inspect the alternate health metadata without repeating the timed-out request" }),
    FIXTURE_LEASE_EXPIRY,
    RECOVERY_AT,
  );

  const insertEvent = database.prepare(`
    INSERT INTO events (
      id, mission_id, run_id, sequence, event_type, occurred_at, actor_type,
      actor_id, summary, payload_json, schema_version, journey, sensitivity,
      redaction_json, created_at
    ) VALUES (?, ?, ?, 1, 'action.completed', ?, 'system', 'run-supervisor', ?, ?,
      1, ?, 'internal', '{}', ?)
  `);
  insertEvent.run(
    "event-e2e-auto-transient", "mission-e2e-auto-transient", "run-e2e-auto-transient",
    RECOVERY_AT, "Transient timeout classified; bounded retry honors Retry-After and the retry budget.",
    canonicalJson({ directive: "retry", errorCategory: "timeout", retryAfterMs: 5_000 }),
    "autonomous", RECOVERY_AT,
  );
  insertEvent.run(
    "event-e2e-auto-loop", "mission-e2e-auto-loop", "run-e2e-auto-loop",
    RECOVERY_AT, "Third identical action fingerprint produced no progress; Autonomous execution stopped safely.",
    canonicalJson({ directive: "blocked", loopKinds: ["repeated_action"], identicalCount: 3 }),
    "autonomous", RECOVERY_AT,
  );
  insertEvent.run(
    "event-e2e-guided-transient", "mission-e2e-guided-transient", "run-e2e-guided-transient",
    RECOVERY_AT, "Guided timeout was interpreted before publishing one materially different decision.",
    canonicalJson({ directive: "recover", errorCategory: "timeout", decisionId: "decision-e2e-guided-transient" }),
    "guided", RECOVERY_AT,
  );
  insertEvent.run(
    "event-e2e-guided-loop", "mission-e2e-guided-loop", "run-e2e-guided-loop",
    RECOVERY_AT, "Repeated Guided action was blocked because no changed fact justified another request.",
    canonicalJson({ directive: "blocked", loopKinds: ["repeated_action"], identicalCount: 3 }),
    "guided", RECOVERY_AT,
  );

  const insertCheckpoint = database.prepare(`
    INSERT INTO checkpoints (
      id, mission_id, run_id, journey, event_sequence, plan_version,
      state_json, state_hash, in_flight_classification, created_at
    ) VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, ?)
  `);
  const checkpointRows = [
    ["auto-transient", "mission-e2e-auto-transient", "run-e2e-auto-transient", "autonomous", "recovering", "retry_after_delay"],
    ["auto-loop", "mission-e2e-auto-loop", "run-e2e-auto-loop", "autonomous", "blocked", "loop_bound_reached"],
    ["guided-transient", "mission-e2e-guided-transient", "run-e2e-guided-transient", "guided", "waiting_guided_decision", "exact_recovery_decision"],
    ["guided-loop", "mission-e2e-guided-loop", "run-e2e-guided-loop", "guided", "blocked", "loop_bound_reached"],
  ] as const;
  for (const [suffix, missionId, runId, journey, state, classification] of checkpointRows) {
    const checkpointState = {
      schemaVersion: 1,
      run: {
        id: runId,
        missionId,
        journey,
        state,
        stateVersion: 1,
        reason: state === "recovering" ? "Transient timeout is inside the bounded retry policy." : "Recovery boundary is durable and operator-readable.",
        leaseOwner: state === "recovering" ? "e2e-recovery-worker" : null,
        leaseExpiresAt: state === "recovering" ? FIXTURE_LEASE_EXPIRY : null,
      },
      control: {
        budget: { limits: { retries: 2, replans: 1, toolCalls: 4 }, usage: { retries: state === "recovering" ? 1 : 2, replans: state === "waiting_guided_decision" ? 1 : 0, toolCalls: state === "recovering" ? 1 : 3 } },
        retryCount: state === "recovering" ? 1 : state === "waiting_guided_decision" ? 0 : 2,
        replanCount: state === "waiting_guided_decision" ? 1 : 0,
        circuits: {},
        progress: {},
      },
      completedActionIds: [],
      inFlightActions: [],
      lastEventSequence: 1,
    };
    insertCheckpoint.run(
      `checkpoint-e2e-${suffix}`, missionId, runId, journey,
      canonicalJson(checkpointState), hashJson(checkpointState), classification, RECOVERY_AT,
    );
  }

  const insertAvoidanceLesson = database.prepare(`
    INSERT INTO lessons (
      id, statement, lesson_type, applicability_scope, engagement_id,
      failure_category, retry_conditions, confidence, expected_benefit, risk,
      status, authoring_agent_id, created_at, updated_at
    ) VALUES (?, ?, 'failed_attempt', 'engagement', 'eng-e2e', ?, ?, 0.9, ?, 'low',
      'under_review', 'e2e-evaluator', ?, ?)
  `);
  insertAvoidanceLesson.run(
    "lesson-e2e-timeout-recovery",
    "Retry transient timeouts only after a bounded provider-directed delay",
    "timeout",
    "Retry only when the action is idempotent and the retry budget remains.",
    "Avoid immediate duplicate work while preserving one justified recovery path.",
    RECOVERY_AT,
    RECOVERY_AT,
  );
  insertAvoidanceLesson.run(
    "lesson-e2e-repeat-stop",
    "Do not repeat an identical deterministic action without new evidence or changed facts",
    "deterministic_tool_error",
    "Retry only after parameters, prerequisites, or evidence materially change.",
    "Prevent no-progress cycles in either journey.",
    RECOVERY_AT,
    RECOVERY_AT,
  );
}

/**
 * Explicit browser-test fixtures. They are written only inside the random E2E
 * state directory and are visibly named as fixtures. Production server paths
 * never call this helper.
 */
export function seedCanonicalE2eFixtures(databasePath: string): void {
  const database = createDatabaseConnection({ filename: databasePath });
  try {
    migrateDatabase(database);
    const insertMission = database.prepare(`
      INSERT INTO missions (
        id, name, objective, journey, status, authorization_status, engagement_id,
        scope_json, success_criteria_json, retention_policy_json, memory_policy_json,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'verified', 'eng-e2e', ?, ?, '{}', ?, 'e2e-fixture', ?, ?)
    `);
    insertMission.run(
      "mission-e2e-auto-complete",
      "[E2E fixture] Completed Autonomous review",
      "Validate the isolated fixture evidence and produce an evidence-linked report.",
      "autonomous",
      "completed",
      canonicalJson({ authorized: true, fixture: true }),
      canonicalJson(["Verified fixture evidence retained"]),
      canonicalJson({ allowedScopes: ["verified_lessons"] }),
      CREATED,
      UPDATED,
    );
    insertMission.run(
      "mission-e2e-safe-stop",
      "[E2E fixture] Autonomous safe stop",
      "Demonstrate a visible safe stop when work would exceed the signed fixture contract.",
      "autonomous",
      "failed",
      canonicalJson({ authorized: true, fixture: true }),
      canonicalJson(["No out-of-contract action executes"]),
      canonicalJson({ allowedScopes: [] }),
      CREATED,
      UPDATED,
    );
    insertMission.run(
      "mission-e2e-guided",
      "[E2E fixture] Guided evidence lesson",
      "Explain one bounded evidence-review step and wait for the operator's deliberate decision.",
      "guided",
      "active",
      canonicalJson({ authorized: true, fixture: true }),
      canonicalJson(["Operator deliberately records the interpreted result"]),
      canonicalJson({ guidedUse: true }),
      CREATED,
      UPDATED,
    );
    insertMission.run(
      "mission-e2e-notification-history",
      "[E2E fixture] Archived notification history",
      "Exercise cursor pagination for an archived in-app notification history.",
      "autonomous",
      "archived",
      canonicalJson({ authorized: true, fixture: true }),
      canonicalJson(["Older semantic notifications remain reachable"]),
      canonicalJson({ allowedScopes: [] }),
      CREATED,
      CREATED,
    );

    const target = database.prepare(`
      INSERT INTO mission_targets (
        id, mission_id, target, target_type, disposition, normalized_target,
        metadata_json, created_at
      ) VALUES (?, ?, 'fixture.local', 'hostname', 'allowed', 'fixture.local', '{}', ?)
    `);
    target.run("target-e2e-complete", "mission-e2e-auto-complete", CREATED);
    target.run("target-e2e-stop", "mission-e2e-safe-stop", CREATED);
    target.run("target-e2e-guided", "mission-e2e-guided", CREATED);

    database.prepare(`
      INSERT INTO mission_contracts (
        id, mission_id, version, state, contract_hash, authorization_json,
        action_policy_json, budgets_json, safe_stop_json, deliverables_json,
        memory_scopes_json, confirmed_by, confirmed_at, created_at
      ) VALUES (
        'contract-e2e-auto-complete', 'mission-e2e-auto-complete', 1, 'confirmed', ?,
        '{"fixture":true}', ?, ?, '{"outsideContract":"safe_stop"}',
        '["evidence_bundle","mission_report"]', '["verified_lessons"]',
        'e2e-operator', ?, ?
      )
    `).run(
      hash("contract-e2e-auto-complete"),
      canonicalJson({ allowedActionClasses: ["analysis"], prohibitedActionClasses: [], contextNodeIds: [] }),
      canonicalJson({ wallClockMs: 900_000, retries: 2, replans: 1, toolCalls: 5, concurrency: 1 }),
      CREATED,
      CREATED,
    );

    database.prepare(`
      INSERT INTO agents (
        id, role, display_name, status, provider_policy_json, tool_policy_json,
        configuration_json, version, last_heartbeat_at, created_at, updated_at
      ) VALUES (
        'agent-e2e-recon', 'recon', 'Fixture Recon Specialist', 'available',
        '{}', '{}', '{"fixture":true}', 'e2e', ?, ?, ?
      )
    `).run(UPDATED, CREATED, UPDATED);

    seedRecoveryAcceptanceFixtures(database);

    const insertRun = database.prepare(`
      INSERT INTO runs (
        id, mission_id, journey, status, current_plan_id, current_step_id,
        current_owner_id, contract_id, progress, status_reason, next_action_summary,
        budget_json, budget_usage_json, retry_count, replan_count,
        last_heartbeat_at, started_at, ended_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'agent-e2e-recon', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertRun.run(
      "run-e2e-auto-complete", "mission-e2e-auto-complete", "autonomous", "completed",
      "plan-e2e-auto-complete", "step-e2e-auto-complete", "contract-e2e-auto-complete", 1,
      "Completed autonomously with fixture evidence.", "Completion review available",
      canonicalJson({ wallClockMs: 900_000, providerTokens: 1_000, estimatedCost: 2, retries: 2, replans: 1, toolCalls: 5 }),
      canonicalJson({ wallClockMs: 480_000, providerTokens: 120, estimatedCost: 0.25, retries: 0, replans: 0, toolCalls: 1 }),
      0, 0, UPDATED, CREATED, UPDATED, CREATED, UPDATED,
    );
    insertRun.run(
      "run-e2e-safe-stop", "mission-e2e-safe-stop", "autonomous", "failed",
      "plan-e2e-safe-stop", "step-e2e-safe-stop", null, 0.4,
      "Safe-stopped: requested action is outside the signed contract.", "Review the contract exception",
      canonicalJson({ wallClockMs: 900_000, retries: 1, replans: 1, toolCalls: 3 }),
      canonicalJson({ wallClockMs: 160_000, retries: 0, replans: 0, toolCalls: 0 }),
      0, 0, UPDATED, CREATED, UPDATED, CREATED, UPDATED,
    );
    insertRun.run(
      "run-e2e-guided", "mission-e2e-guided", "guided", "waiting_guided_decision",
      "plan-e2e-guided", "step-e2e-guided", null, 0.25,
      "Waiting for the exact represented Guided decision.", "Operator chooses the bounded fixture step",
      canonicalJson({ wallClockMs: 1_800_000, retries: 2, replans: 1, toolCalls: 4 }),
      canonicalJson({ wallClockMs: 45_000, retries: 0, replans: 0, toolCalls: 0 }),
      0, 0, UPDATED, CREATED, null, CREATED, UPDATED,
    );
    insertRun.run(
      "run-e2e-notification-history", "mission-e2e-notification-history", "autonomous", "completed",
      null, null, null, 1,
      "Archived notification pagination fixture.", "Review older in-app notifications",
      canonicalJson({}), canonicalJson({}),
      0, 0, CREATED, CREATED, CREATED, CREATED, CREATED,
    );
    const insertPlan = database.prepare(`
      INSERT INTO plans (
        id, run_id, version, status, strategy_summary, rationale_summary,
        plan_hash, created_by, created_at, activated_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?, 'e2e-fixture', ?, ?)
    `);
    insertPlan.run("plan-e2e-auto-complete", "run-e2e-auto-complete", "completed", "Review immutable evidence and report the verified outcome", "A single bounded specialist step was sufficient.", hash("plan-complete"), CREATED, CREATED);
    insertPlan.run("plan-e2e-safe-stop", "run-e2e-safe-stop", "abandoned", "Attempt only work allowed by the signed contract", "The next proposed action was out of contract and was not executed.", hash("plan-stop"), CREATED, CREATED);
    insertPlan.run("plan-e2e-guided", "run-e2e-guided", "active", "Explain, recommend, wait, interpret, and record", "The operator retains control of each consequential step.", hash("plan-guided"), CREATED, CREATED);

    const insertStep = database.prepare(`
      INSERT INTO plan_steps (
        id, plan_id, run_id, ordinal, phase, title, objective, status,
        success_criteria_json, dependencies_json, action_class, risk_class,
        assigned_agent_id, started_at, ended_at, created_at, updated_at
      ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, '[]', ?, 'low', 'agent-e2e-recon', ?, ?, ?, ?)
    `);
    insertStep.run("step-e2e-auto-complete", "plan-e2e-auto-complete", "run-e2e-auto-complete", "Verification", "Verify retained fixture evidence", "Confirm the immutable evidence hash and report linkage.", "completed", canonicalJson(["Evidence hash and report are linked"]), "analysis", CREATED, UPDATED, CREATED, UPDATED);
    insertStep.run("step-e2e-safe-stop", "plan-e2e-safe-stop", "run-e2e-safe-stop", "Contract enforcement", "Reject out-of-contract work", "Stop without executing work outside the signed contract.", "failed", canonicalJson(["No action is dispatched"]), "analysis", CREATED, UPDATED, CREATED, UPDATED);
    insertStep.run("step-e2e-guided", "plan-e2e-guided", "run-e2e-guided", "Evidence review", "Inspect the bounded fixture result", "Learn what the supplied evidence establishes before advancing.", "waiting_guided_decision", canonicalJson(["The operator can explain the result"]), "analysis", null, null, CREATED, UPDATED);
    database.prepare(`
      INSERT INTO plan_steps (
        id, plan_id, run_id, ordinal, phase, title, objective, status,
        success_criteria_json, dependencies_json, action_class, risk_class,
        assigned_agent_id, created_at, updated_at
      ) VALUES (
        'step-e2e-guided-next', 'plan-e2e-guided', 'run-e2e-guided', 1,
        'Validation', 'Review the next bounded checkpoint',
        'Wait for another explicit decision after the first result is interpreted.',
        'pending', ?, ?, 'analysis', 'low', 'agent-e2e-recon', ?, ?
      )
    `).run(canonicalJson(["A new exact decision is presented"]), canonicalJson(["step-e2e-guided"]), CREATED, UPDATED);

    const constraint = database.prepare(`
      INSERT INTO mission_constraints (
        id, mission_id, constraint_type, value_json, source, created_at
      ) VALUES (?, ?, 'represented_action', ?, ?, ?)
    `);
    constraint.run("constraint-e2e-complete", "mission-e2e-auto-complete", representation({ title: "Verify retained fixture evidence", target: "fixture.local", kind: "tool", actionClass: "analysis" }), "step-e2e-auto-complete", CREATED);
    constraint.run("constraint-e2e-stop", "mission-e2e-safe-stop", representation({ title: "Reject out-of-contract work", target: "fixture.local", kind: "tool", actionClass: "analysis" }), "step-e2e-safe-stop", CREATED);
    constraint.run("constraint-e2e-guided", "mission-e2e-guided", representation({ title: "Inspect the bounded fixture result", target: "fixture.local", kind: "manual", actionClass: "analysis" }), "step-e2e-guided", CREATED);
    constraint.run("constraint-e2e-guided-next", "mission-e2e-guided", representation({ title: "Review the next bounded checkpoint", target: "fixture.local", kind: "manual", actionClass: "analysis" }), "step-e2e-guided-next", CREATED);

    const assignment = database.prepare(`
      INSERT INTO assignments (
        id, run_id, step_id, agent_id, status, started_at, ended_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'agent-e2e-recon', ?, ?, ?, ?, ?)
    `);
    assignment.run("assignment-e2e-complete", "run-e2e-auto-complete", "step-e2e-auto-complete", "completed", CREATED, UPDATED, CREATED, UPDATED);
    assignment.run("assignment-e2e-stop", "run-e2e-safe-stop", "step-e2e-safe-stop", "failed", CREATED, UPDATED, CREATED, UPDATED);
    assignment.run("assignment-e2e-guided", "run-e2e-guided", "step-e2e-guided", "queued", null, null, CREATED, UPDATED);
    assignment.run("assignment-e2e-guided-next", "run-e2e-guided", "step-e2e-guided-next", "queued", null, null, CREATED, UPDATED);

    const guidedAction = {
      actionType: "manual_verification",
      actionClass: "analysis",
      target: "fixture.local",
      arguments: { procedure: "Review the supplied isolated result" },
      intentSummary: "Inspect the bounded fixture result",
      kind: "manual" as const,
      idempotent: true,
      destructive: false,
    };
    const guidedIntent = {
      missionId: "mission-e2e-guided",
      runId: "run-e2e-guided",
      stepId: "step-e2e-guided",
      assignmentId: "assignment-e2e-guided",
      planVersion: 1,
      ...guidedAction,
    };
    const guidedFingerprint = fingerprintAction(guidedIntent).hash;
    database.prepare(`
      INSERT INTO guided_decisions (
        id, mission_id, run_id, step_id, requested_action_fingerprint,
        requested_parameters_json, rationale, risk_class, reversibility,
        status, expires_at, created_at
      ) VALUES (
        'decision-e2e-guided', 'mission-e2e-guided', 'run-e2e-guided',
        'step-e2e-guided', ?, ?, 'Interpret one bounded fixture result', 'low',
        'Read-only and skippable', 'pending', '2099-01-01T00:00:00.000Z', ?
      )
    `).run(guidedFingerprint, canonicalJson(guidedIntent), CREATED);

    database.prepare(`
      INSERT INTO conversations (
        id, mission_id, run_id, step_id, conversation_type, created_at, updated_at
      ) VALUES (
        'conversation-e2e-guided', 'mission-e2e-guided', 'run-e2e-guided',
        'step-e2e-guided', 'guided', ?, ?
      )
    `).run(CREATED, UPDATED);
    database.prepare(`
      INSERT INTO messages (
        id, conversation_id, role, body, structured_content_json, created_at
      ) VALUES (
        'message-e2e-guided', 'conversation-e2e-guided', 'assistant', ?, ?, ?
      )
    `).run(
      "We are in evidence review. The goal is to establish what the bounded fixture result proves. I recommend inspecting one read-only result because it has a clear success pattern and cannot change the target. Choose whether to run, complete manually, skip, or stop.",
      canonicalJson({ kind: "guided_step", stepId: "step-e2e-guided", decisionId: "decision-e2e-guided" }),
      CREATED,
    );

    database.prepare(`
      INSERT INTO actions (
        id, mission_id, run_id, step_id, assignment_id, action_type, action_class,
        fingerprint, normalized_arguments_json, scoped_target, status,
        intent_summary, result_summary, retry_count, trace_id,
        started_at, ended_at, created_at, updated_at
      ) VALUES (
        'action-e2e-complete', 'mission-e2e-auto-complete', 'run-e2e-auto-complete',
        'step-e2e-auto-complete', 'assignment-e2e-complete', 'evidence_review',
        'analysis', ?, '{}', 'fixture.local', 'succeeded',
        'Verify retained fixture evidence', 'One unique verified evidence record retained',
        0, 'trace-e2e-complete', ?, ?, ?, ?
      )
    `).run(HASH_A, CREATED, UPDATED, CREATED, UPDATED);

    database.prepare(`
      INSERT INTO evidence (
        id, mission_id, run_id, step_id, action_id, source, acquired_at, target,
        evidence_type, content_hash, provenance_json, confidence, sensitivity,
        verification_state, summary, created_by, created_at
      ) VALUES (
        'evidence-e2e-complete', 'mission-e2e-auto-complete', 'run-e2e-auto-complete',
        'step-e2e-auto-complete', 'action-e2e-complete', 'fixture:safe', ?,
        'fixture.local', 'verification', ?, '{"fixture":true}', 1, 'internal',
        'verified', 'Fixture evidence hash verified', 'agent-e2e-recon', ?
      )
    `).run(UPDATED, HASH_B, UPDATED);
    database.prepare(`
      INSERT INTO findings (
        id, mission_id, run_id, title, severity, confidence, affected_scope,
        description, impact, remediation, review_status, created_at, updated_at
      ) VALUES (
        'finding-e2e-complete', 'mission-e2e-auto-complete', 'run-e2e-auto-complete',
        'Fixture evidence chain is complete', 'informational', 1, 'fixture.local',
        'The bounded verification evidence is linked and immutable.',
        'The completion claim can be independently reviewed.', 'No remediation required.',
        'verified', ?, ?
      )
    `).run(CREATED, UPDATED);
    database.prepare(`
      INSERT INTO finding_evidence (finding_id, evidence_id, relationship, added_at)
      VALUES ('finding-e2e-complete', 'evidence-e2e-complete', 'supports', ?)
    `).run(UPDATED);
    database.prepare(`
      INSERT INTO findings (
        id, mission_id, run_id, title, severity, confidence, affected_scope,
        description, impact, remediation, review_status, created_at, updated_at
      ) VALUES (
        'finding-e2e-review', 'mission-e2e-auto-complete', 'run-e2e-auto-complete',
        'Fixture finding awaits independent review', 'low', 0.9, 'fixture.local',
        'The exact terminal run retained supporting evidence for this review fixture.',
        'An operator must deliberately review the evidence link.', 'Review the immutable evidence.',
        'under_review', ?, ?
      )
    `).run(CREATED, UPDATED);
    database.prepare(`
      INSERT INTO finding_evidence (finding_id, evidence_id, relationship, added_at)
      VALUES ('finding-e2e-review', 'evidence-e2e-complete', 'supports', ?)
    `).run(UPDATED);
    database.prepare(`
      INSERT INTO artifacts (
        id, mission_id, run_id, action_id, journey, artifact_type, storage_uri,
        content_hash, byte_size, media_type, sensitivity, metadata_json, created_at
      ) VALUES (
        'report-e2e-complete', 'mission-e2e-auto-complete', 'run-e2e-auto-complete',
        'action-e2e-complete', 'autonomous', 'mission_report', 'artifact://e2e/report',
        ?, 256, 'application/json', 'internal', '{"fixture":true}', ?
      )
    `).run(HASH_A, UPDATED);

    database.prepare(`
      INSERT INTO run_evaluations (
        id, mission_id, run_id, journey, scores_json, metrics_json,
        retrospective, evidence_coverage, created_by, created_at
      ) VALUES (
        'evaluation-e2e-complete', 'mission-e2e-auto-complete',
        'run-e2e-auto-complete', 'autonomous', ?, ?,
        'The fixture run met its single evidence-backed success criterion without retries.',
        1, 'e2e-evaluator', ?
      )
    `).run(
      canonicalJson({ objectiveCompletion: 1, policyCompliance: 1, evidenceQuality: 1 }),
      canonicalJson({ duplicateActionRate: 0, retryRate: 0, journeyAdherence: 1 }),
      UPDATED,
    );
    database.prepare(`
      INSERT INTO run_evaluation_comparisons (
        evaluation_id, run_id, comparison_status, reason, metrics_json, summary, created_at
      ) VALUES (
        'evaluation-e2e-complete', 'run-e2e-auto-complete', 'insufficient_data',
        'no_prior_same_scope_evaluation', '[]',
        'No prior fixture run exists in the same scope and journey.', ?
      )
    `).run(UPDATED);

    database.prepare(`
      INSERT INTO lessons (
        id, statement, lesson_type, applicability_scope, engagement_id, mission_id,
        confidence, expected_benefit, risk, status, authoring_agent_id,
        created_at, updated_at
      ) VALUES (
        'lesson-e2e-verified-follow-up',
        'Require a fresh immutable evidence delta before declaring the follow-up complete',
        'strategy', 'mission', 'eng-e2e', 'mission-e2e-auto-complete', 0.96,
        'Prevent completion claims that merely repeat prior observations.', 'low',
        'under_review', 'e2e-evaluator', ?, ?
      )
    `).run(UPDATED, UPDATED);
    database.prepare(`
      INSERT INTO lesson_evidence (
        lesson_id, evidence_id, run_id, relationship, rationale, created_at
      ) VALUES (
        'lesson-e2e-verified-follow-up', 'evidence-e2e-complete',
        'run-e2e-auto-complete', 'supports',
        'The terminal run and verified evidence support this bounded completion gate.', ?
      )
    `).run(UPDATED);
    database.prepare(`
      UPDATE lessons SET status = 'verified', reviewed_by = 'e2e-independent-reviewer',
        reviewed_at = ?, updated_at = ?
      WHERE id = 'lesson-e2e-verified-follow-up'
    `).run(UPDATED, UPDATED);
    database.prepare(`
      INSERT INTO lessons (
        id, statement, lesson_type, applicability_scope, engagement_id, mission_id,
        confidence, expected_benefit, risk, status, authoring_agent_id,
        created_at, updated_at
      ) VALUES (
        'lesson-e2e-review',
        'Require an independent reviewer before promoting this exact-run candidate',
        'strategy', 'mission', 'eng-e2e', 'mission-e2e-auto-complete', 0.85,
        'Preserve the evidence and self-approval boundary.', 'low',
        'under_review', 'e2e-evaluator', ?, ?
      )
    `).run(UPDATED, UPDATED);
    database.prepare(`
      INSERT INTO lesson_evidence (
        lesson_id, evidence_id, run_id, relationship, rationale, created_at
      ) VALUES (
        'lesson-e2e-review', 'evidence-e2e-complete', 'run-e2e-auto-complete',
        'supports', 'The exact terminal run and immutable evidence support independent review.', ?
      )
    `).run(UPDATED);

    const events = new EventRepository(database);
    events.append({
      id: "event-e2e-complete", missionId: "mission-e2e-auto-complete", runId: "run-e2e-auto-complete",
      journey: "autonomous", eventType: "run.completed", occurredAt: UPDATED,
      actorType: "system", actorId: "run-supervisor",
      summary: "Completed autonomously with verified fixture evidence",
      payload: { evidenceDelta: 1, next: "Completion review" },
      contextPackId: "context-e2e-complete", sensitivity: "internal",
    });
    events.append({
      id: "event-e2e-safe-stop", missionId: "mission-e2e-safe-stop", runId: "run-e2e-safe-stop",
      journey: "autonomous", eventType: "run.safe_stopped", occurredAt: UPDATED,
      actorType: "system", actorId: "run-supervisor",
      summary: "Safe-stopped: outside the signed fixture contract",
      payload: { outsideContract: true, actionDispatched: false }, sensitivity: "internal",
    });
    events.append({
      id: "event-e2e-guided", missionId: "mission-e2e-guided", runId: "run-e2e-guided",
      journey: "guided", eventType: "guided.decision_requested", occurredAt: UPDATED,
      actorType: "agent", actorId: "guided-commander",
      summary: "Guided Commander explained one bounded step and is waiting for the operator",
      payload: { decisionId: "decision-e2e-guided" }, sensitivity: "internal",
    });
    for (let index = 0; index < 22; index += 1) {
      events.append({
        id: `event-e2e-notification-history-${String(index).padStart(2, "0")}`,
        missionId: "mission-e2e-notification-history",
        runId: "run-e2e-notification-history",
        journey: "autonomous",
        eventType: "run.completed",
        occurredAt: new Date(Date.parse(CREATED) - index * 1_000).toISOString(),
        actorType: "system",
        actorId: "e2e-fixture",
        summary: "Archived semantic completion event for cursor pagination",
        sensitivity: "internal",
      });
    }

    const stoppedState = {
      schemaVersion: 1,
      run: {
        id: "run-e2e-safe-stop", missionId: "mission-e2e-safe-stop", journey: "autonomous",
        state: "failed", stateVersion: 1,
        reason: "Safe-stopped: requested action is outside the signed contract.",
        leaseOwner: null, leaseExpiresAt: null,
      },
      control: {
        budget: { limits: { wallClockMs: 900_000, retries: 1, replans: 1, toolCalls: 3 }, usage: { wallClockMs: 160_000, retries: 0, replans: 0, toolCalls: 0 } },
        retryCount: 0, replanCount: 0, circuits: {}, progress: {},
      },
      completedActionIds: [], inFlightActions: [], lastEventSequence: 1,
    };
    database.prepare(`
      INSERT INTO checkpoints (
        id, mission_id, run_id, journey, event_sequence, plan_version,
        state_json, state_hash, in_flight_classification, created_at
      ) VALUES (
        'checkpoint-e2e-safe-stop', 'mission-e2e-safe-stop', 'run-e2e-safe-stop',
        'autonomous', 1, 1, ?, ?, 'safe_no_in_flight_action', ?
      )
    `).run(canonicalJson(stoppedState), hashJson(stoppedState), UPDATED);

    const memory = new MemoryRepository(database, {
      clock: () => new Date(UPDATED),
      createId: (prefix) => `${prefix}_e2e_${Math.random().toString(16).slice(2)}`,
    });
    const provenance = (sourceId: string) => ({
      method: "derived" as const,
      explanation: "Generated from an explicit, isolated browser acceptance fixture.",
      sources: [{ sourceType: "e2e_fixture", sourceId, acquiredAt: UPDATED, sourceHash: hash(sourceId) }],
    });
    const verifiedLessonNodeId = canonicalLessonMemoryNodeId("lesson-e2e-verified-follow-up");
    const nodes = [
      memory.createNode({ id: "mem-e2e-operator", nodeType: "operator", title: "Fixture operator", summary: "Operator root for browser acceptance", scope: { kind: "global" }, sensitivity: "private", confidence: 1, lifecycleStatus: "confirmed", confirmationState: "confirmed", provenance: provenance("operator"), authorType: "operator", authorId: "e2e-operator" }),
      memory.createNode({ id: "mem-e2e-preference", nodeType: "preference", title: "Explain before acting", summary: "Use concise explanations before each Guided step", body: "Explain purpose, risk, expected evidence, and verification before presenting a bounded action.", scope: { kind: "global" }, sensitivity: "private", confidence: 1, lifecycleStatus: "confirmed", confirmationState: "confirmed", provenance: provenance("preference"), authorType: "operator", authorId: "e2e-operator", pinned: true }),
      memory.createNode({ id: "mem-e2e-mission", nodeType: "mission", title: "Completed Autonomous fixture mission", summary: "Evidence-backed fixture mission cluster", scope: { kind: "mission", engagementId: "eng-e2e", missionId: "mission-e2e-auto-complete" }, sensitivity: "internal", confidence: 1, lifecycleStatus: "verified", confirmationState: "not_required", provenance: provenance("mission"), authorType: "system" }),
      memory.createNode({ id: "mem-e2e-technique", nodeType: "technique", title: "Immutable evidence verification", summary: "Validate hashes and provenance before a completion claim", scope: { kind: "global" }, sensitivity: "internal", confidence: 0.95, lifecycleStatus: "verified", confirmationState: "not_required", provenance: provenance("technique"), authorType: "agent", authorId: "agent-e2e-recon" }),
      memory.createNode({ id: "mem-e2e-evidence", nodeType: "evidence", title: "Verified fixture evidence", summary: "Immutable evidence linked to the completed run", scope: { kind: "mission", engagementId: "eng-e2e", missionId: "mission-e2e-auto-complete" }, sensitivity: "internal", confidence: 1, lifecycleStatus: "verified", confirmationState: "not_required", provenance: provenance("evidence"), authorType: "system" }),
      memory.createNode({ id: "mem-e2e-failure", nodeType: "failure", title: "Out-of-contract action rejected", summary: "The Autonomous fixture did not expand its signed scope", scope: { kind: "mission", engagementId: "eng-e2e", missionId: "mission-e2e-safe-stop" }, sensitivity: "internal", confidence: 1, lifecycleStatus: "verified", confirmationState: "not_required", provenance: provenance("failure"), authorType: "system" }),
      memory.createNode({ id: "mem-e2e-recovery", nodeType: "recovery", title: "Contract safe stop", summary: "Stop safely and explain the blocked boundary", scope: { kind: "mission", engagementId: "eng-e2e", missionId: "mission-e2e-safe-stop" }, sensitivity: "internal", confidence: 1, lifecycleStatus: "verified", confirmationState: "not_required", provenance: provenance("recovery"), authorType: "system" }),
      memory.createNode({
        id: verifiedLessonNodeId,
        nodeType: "lesson",
        title: "Require a fresh immutable evidence delta before declaring the follow-up complete",
        summary: "Evidence coverage must advance rather than merely repeat a prior observation.",
        body: "Apply this verified lesson only inside the unchanged mission scope and signed Autonomous contract.",
        scope: { kind: "mission", engagementId: "eng-e2e", missionId: "mission-e2e-auto-complete" },
        sensitivity: "internal",
        confidence: 0.96,
        lifecycleStatus: "verified",
        confirmationState: "not_required",
        provenance: {
          method: "derived",
          explanation: "Projected from an independently reviewed evidence-linked lesson.",
          sources: [{
            sourceType: "lesson",
            sourceId: "lesson-e2e-verified-follow-up",
            acquiredAt: UPDATED,
            sourceHash: hash("lesson-e2e-verified-follow-up"),
          }],
        },
        authorType: "operator",
        authorId: "e2e-independent-reviewer",
        retentionPolicy: { allowAutonomous: true, allowGuided: true },
      }),
    ];
    memory.createCandidate({
      id: "candidate-e2e-completion-review",
      nodeType: "procedure",
      title: "Review completion evidence before retaining the procedure",
      summary: "A pending memory candidate linked only to the exact completed fixture run.",
      scope: { kind: "mission", engagementId: "eng-e2e", missionId: "mission-e2e-auto-complete" },
      sensitivity: "internal",
      confidence: 0.85,
      provenance: {
        method: "derived",
        explanation: "Proposed from the exact terminal run for browser acceptance review.",
        sources: [{ sourceType: "run", sourceId: "run-e2e-auto-complete", acquiredAt: UPDATED, sourceHash: hash("run-e2e-auto-complete") }],
      },
      proposedBy: "e2e-evaluator",
    });
    const edge = (id: string, sourceNodeId: string, targetNodeId: string, edgeType: "prefers" | "belongs_to" | "supports" | "recovered_by" | "learned_from") => memory.createEdge({ id, sourceNodeId, targetNodeId, edgeType, title: edgeType.replaceAll("_", " "), summary: "Fixture relationship with explicit provenance", scope: { kind: "global" }, sensitivity: "internal", confidence: 1, lifecycleStatus: "verified", provenance: provenance(id), explanation: "This relationship is asserted only by the isolated acceptance fixture.", authorType: "system" });
    edge("edge-e2e-preference", nodes[0]!.id, nodes[1]!.id, "prefers");
    edge("edge-e2e-mission", nodes[2]!.id, nodes[3]!.id, "belongs_to");
    edge("edge-e2e-evidence", nodes[4]!.id, nodes[2]!.id, "supports");
    edge("edge-e2e-recovery", nodes[5]!.id, nodes[6]!.id, "recovered_by");
    edge("edge-e2e-lesson", nodes[7]!.id, nodes[2]!.id, "learned_from");

    database.prepare(`
      INSERT INTO memory_context_packs (
        id, mission_id, run_id, action_id, journey, purpose, query_redacted,
        scope_policy_json, context_budget, retrieval_metrics_json, created_by, created_at
      ) VALUES (
        'context-e2e-complete', 'mission-e2e-auto-complete', 'run-e2e-auto-complete',
        'action-e2e-complete', 'autonomous', 'Verify fixture evidence using a permitted lesson',
        '[fixture query redacted]', '{"engagementIsolation":true}', 512,
        '{"fixture":true}', 'e2e-planner', ?
      )
    `).run(UPDATED);
    const contextItem = database.prepare(`
      INSERT INTO memory_context_items (
        context_pack_id, node_id, rank, retrieval_score, used,
        relevance_reason, influence_summary, corrected
      ) VALUES ('context-e2e-complete', ?, ?, ?, 1, ?, ?, 0)
    `);
    contextItem.run("mem-e2e-preference", 0, 1, "The confirmed explanation preference applies globally.", "The Guided explanation was structured before the action.");
    contextItem.run(verifiedLessonNodeId, 1, 0.95, "The verified lesson matches the evidence-verification phase.", "The completion gate required evidence coverage.");
    database.prepare("UPDATE actions SET context_pack_id = 'context-e2e-complete' WHERE id = 'action-e2e-complete'").run();

    database.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    database.close();
  }
}
