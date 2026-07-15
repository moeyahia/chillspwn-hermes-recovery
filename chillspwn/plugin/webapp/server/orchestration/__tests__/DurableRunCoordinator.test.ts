import { describe, expect, test } from "bun:test";
import { createDatabaseConnection, migrateDatabase } from "../../db";
import { fingerprintAction } from "../../supervisor";
import {
  DurableOrchestrationError,
  DurableRunCoordinator,
  mapLegacyRunState,
  type DurableAction,
  type DurableActionIntent,
  type ExecutionPort,
} from "../index";

class Clock {
  private value = Date.parse("2026-07-15T00:00:00.000Z");
  now = () => new Date(this.value);
  advance(milliseconds: number): void { this.value += milliseconds; }
}

class RecordingExecutionPort implements ExecutionPort {
  readonly dispatched: DurableAction[] = [];
  readonly resumed: DurableAction[] = [];
  readonly cancelled: string[] = [];
  readonly signals: AbortSignal[] = [];
  failDispatch = false;
  failResume = false;
  failCancel = false;
  beforeDispatch?: (action: DurableAction) => void;

  async dispatch(action: DurableAction, signal: AbortSignal): Promise<void> {
    this.beforeDispatch?.(action);
    this.dispatched.push(action);
    this.signals.push(signal);
    if (this.failDispatch) throw new Error("dispatch unavailable");
  }

  async resume(action: DurableAction, signal: AbortSignal): Promise<void> {
    this.resumed.push(action);
    this.signals.push(signal);
    if (this.failResume) throw new Error("resume unavailable");
  }

  async cancelRun(runId: string): Promise<void> {
    this.cancelled.push(runId);
    if (this.failCancel) throw new Error("cleanup unavailable");
  }
}

type Database = ReturnType<typeof createDatabaseConnection>;

function seedRun(database: Database, input: {
  runId: string;
  journey: "autonomous" | "guided";
  status?: string;
  allowedActions?: string[];
  budget?: Record<string, number>;
}): { missionId: string; stepId: string; contractId?: string } {
  const now = "2026-07-14T23:59:00.000Z";
  const missionId = `mission_${input.runId}`;
  const planId = `plan_${input.runId}`;
  const stepId = `step_${input.runId}`;
  database.prepare(`
    INSERT INTO missions (
      id, name, objective, journey, status, authorization_status,
      scope_json, created_by, created_at, updated_at
    ) VALUES (?, ?, 'Authorized fixture objective', ?, 'active', 'verified', '{}', 'operator', ?, ?)
  `).run(missionId, `Mission ${input.runId}`, input.journey, now, now);

  let contractId: string | undefined;
  if (input.journey === "autonomous") {
    contractId = `contract_${input.runId}`;
    database.prepare(`
      INSERT INTO mission_contracts (
        id, mission_id, version, state, contract_hash,
        authorization_json, action_policy_json, budgets_json,
        safe_stop_json, deliverables_json, memory_scopes_json,
        confirmed_by, confirmed_at, created_at
      ) VALUES (?, ?, 1, 'confirmed', ?, '{}', ?, ?, '{"conditions":[]}', '[]', '[]', 'operator', ?, ?)
    `).run(
      contractId,
      missionId,
      "a".repeat(64),
      JSON.stringify({
        allowedActionClasses: input.allowedActions ?? ["scan", "mutate"],
        prohibitedActionClasses: [],
      }),
      JSON.stringify(input.budget ?? { toolCalls: 20, concurrency: 3, retries: 2, replans: 2 }),
      now,
      now,
    );
    database.prepare(`
      INSERT INTO mission_targets (
        id, mission_id, target, target_type, disposition,
        normalized_target, created_at
      ) VALUES (?, ?, 'target-1', 'other', 'allowed', 'target-1', ?)
    `).run(`target_${input.runId}`, missionId, now);
  }

  database.prepare(`
    INSERT INTO runs (
      id, mission_id, journey, status, contract_id, budget_json,
      budget_usage_json, status_reason, started_at, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, '{}', 'Executing fixture', ?, ?, ?, 1)
  `).run(
    input.runId,
    missionId,
    input.journey,
    input.status ?? "running",
    contractId ?? null,
    JSON.stringify(input.budget ?? { toolCalls: 20, concurrency: 3, retries: 2, replans: 2 }),
    now,
    now,
    now,
  );
  database.prepare(`
    INSERT INTO plans (
      id, run_id, version, status, strategy_summary,
      plan_hash, created_by, created_at, activated_at
    ) VALUES (?, ?, 1, 'active', 'Fixture strategy', ?, 'system', ?, ?)
  `).run(planId, input.runId, `hash_${input.runId}`, now, now);
  database.prepare(`
    INSERT INTO plan_steps (
      id, plan_id, run_id, ordinal, phase, title, objective,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, 0, 'recon', 'Fixture step', 'Collect evidence', 'running', ?, ?)
  `).run(stepId, planId, input.runId, now, now);
  database.prepare("UPDATE runs SET current_plan_id = ?, current_step_id = ? WHERE id = ?")
    .run(planId, stepId, input.runId);
  return { missionId, stepId, ...(contractId ? { contractId } : {}) };
}

function intent(fixture: { missionId: string; stepId: string }, runId: string, overrides: Partial<DurableActionIntent> = {}): DurableActionIntent {
  return {
    missionId: fixture.missionId,
    runId,
    stepId: fixture.stepId,
    planVersion: 1,
    actionType: "scan",
    actionClass: "reconnaissance",
    arguments: { ports: [80, 443] },
    target: "target-1",
    intentSummary: "Map approved services",
    kind: "tool",
    idempotent: true,
    destructive: false,
    ...overrides,
  };
}

function setup() {
  const database = createDatabaseConnection({ filename: ":memory:" });
  migrateDatabase(database);
  const clock = new Clock();
  const port = new RecordingExecutionPort();
  const coordinator = new DurableRunCoordinator(database, port, {
    now: clock.now,
    leaseTtlMs: 1_000,
  });
  return { database, clock, port, coordinator };
}

describe("DurableRunCoordinator", () => {
  test("enforces Autonomous no-wait and maps legacy user waits fail-closed", () => {
    const { database, coordinator } = setup();
    try {
      seedRun(database, { runId: "run-no-wait", journey: "autonomous" });
      const lease = coordinator.acquireRunLease("run-no-wait", "worker-1");
      expect(() => coordinator.transitionRun({
        lease,
        to: "waiting_guided_decision",
        reason: "Ask the operator",
        guidedDecisionId: "decision-impossible",
      })).toThrow();
      expect(coordinator.getRun("run-no-wait").run.state).toBe("running");
      expect(mapLegacyRunState("awaiting_user_input", "autonomous")).toMatchObject({
        state: "blocked",
        requiresReview: true,
      });
      expect(mapLegacyRunState("awaiting_user_input", "guided").state).toBe("waiting_guided_decision");
    } finally {
      database.close();
    }
  });

  test("rolls back authorization and action creation before dispatch when event durability fails", async () => {
    const { database, coordinator, port } = setup();
    try {
      const fixture = seedRun(database, { runId: "run-rollback", journey: "autonomous" });
      const lease = coordinator.acquireRunLease("run-rollback", "worker-1");
      database.exec(`
        CREATE TRIGGER reject_orchestration_outbox
        BEFORE INSERT ON event_outbox BEGIN
          SELECT RAISE(ABORT, 'outbox unavailable');
        END;
      `);
      await expect(coordinator.startAction({
        lease,
        intent: intent(fixture, "run-rollback"),
      })).rejects.toThrow("outbox unavailable");
      expect(port.dispatched).toHaveLength(0);
      expect(database.prepare("SELECT COUNT(*) AS count FROM actions").get()).toEqual({ count: 0 });
      expect(coordinator.getRun("run-rollback").run.stateVersion).toBe(lease.fence);
    } finally {
      database.close();
    }
  });

  test("consumes an approved Guided decision once and binds it to the exact action", async () => {
    const { database, coordinator, port } = setup();
    try {
      const fixture = seedRun(database, {
        runId: "run-guided",
        journey: "guided",
        status: "waiting_guided_decision",
      });
      const represented = intent(fixture, "run-guided");
      database.prepare(`
        INSERT INTO guided_decisions (
          id, mission_id, run_id, step_id, requested_action_fingerprint,
          requested_parameters_json, rationale, risk_class, reversibility,
          status, decision_actor, decided_at, expires_at, created_at
        ) VALUES ('decision-1', ?, ?, ?, ?, '{}', 'Run exact scan', 'low', 'reversible',
          'approved', 'operator', ?, ?, ?)
      `).run(
        fixture.missionId,
        "run-guided",
        fixture.stepId,
        fingerprintAction(represented).hash,
        "2026-07-14T23:59:30.000Z",
        "2026-07-15T01:00:00.000Z",
        "2026-07-14T23:59:00.000Z",
      );
      const lease = coordinator.acquireRunLease("run-guided", "worker-1");
      const started = await coordinator.startAction({
        lease,
        intent: represented,
        guidedDecisionId: "decision-1",
      });
      expect(port.dispatched).toHaveLength(1);
      expect(started.action.guidedDecisionId).toBe("decision-1");
      expect(coordinator.getRun("run-guided").run.state).toBe("running");
      await expect(coordinator.startAction({
        lease: started.lease,
        intent: represented,
        guidedDecisionId: "decision-1",
      })).rejects.toBeInstanceOf(DurableOrchestrationError);
      expect(database.prepare("SELECT COUNT(*) AS count FROM actions WHERE guided_decision_id = 'decision-1'").get())
        .toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });

  test("preserves action context-pack correlation in durable records and semantic events", async () => {
    const { database, coordinator } = setup();
    try {
      const fixture = seedRun(database, { runId: "run-context", journey: "autonomous" });
      const lease = coordinator.acquireRunLease("run-context", "worker-context");
      const started = await coordinator.startAction({
        lease,
        intent: intent(fixture, "run-context", { contextPackId: "context-pack-verified" }),
      });
      expect(started.action.contextPackId).toBe("context-pack-verified");
      await coordinator.completeAction({
        lease: started.lease,
        actionId: started.action.id,
        success: true,
        resultSummary: "The bounded observation completed",
        before: {},
        after: { verifiedWorkerResultIds: [started.action.id] },
      });
      const events = database.prepare(`
        SELECT event_type, context_pack_id,
          json_extract(payload_json, '$.contextPackId') AS payload_context_pack_id
        FROM events WHERE run_id = ? AND event_type IN ('action.authorized', 'action.completed')
        ORDER BY sequence
      `).all("run-context");
      expect(events).toEqual([
        {
          event_type: "action.authorized",
          context_pack_id: "context-pack-verified",
          payload_context_pack_id: "context-pack-verified",
        },
        {
          event_type: "action.completed",
          context_pack_id: "context-pack-verified",
          payload_context_pack_id: "context-pack-verified",
        },
      ]);
    } finally {
      database.close();
    }
  });

  test("checkpoints a failed Guided action for bounded recovery without silently retrying it", async () => {
    const { database, coordinator, port } = setup();
    try {
      const fixture = seedRun(database, {
        runId: "run-guided-recovery",
        journey: "guided",
        status: "waiting_guided_decision",
        budget: { toolCalls: 5, concurrency: 1, retries: 2, replans: 1 },
      });
      const represented = intent(fixture, "run-guided-recovery");
      database.prepare(`
        INSERT INTO guided_decisions (
          id, mission_id, run_id, step_id, requested_action_fingerprint,
          requested_parameters_json, rationale, risk_class, reversibility,
          status, decision_actor, decided_at, expires_at, created_at
        ) VALUES ('decision-recovery-1', ?, ?, ?, ?, '{}', 'Run exact scan', 'low', 'reversible',
          'approved', 'operator', ?, ?, ?)
      `).run(
        fixture.missionId,
        "run-guided-recovery",
        fixture.stepId,
        fingerprintAction(represented).hash,
        "2026-07-14T23:59:30.000Z",
        "2026-07-15T01:00:00.000Z",
        "2026-07-14T23:59:00.000Z",
      );
      const lease = coordinator.acquireRunLease("run-guided-recovery", "worker-1");
      const started = await coordinator.startAction({
        lease,
        intent: represented,
        guidedDecisionId: "decision-recovery-1",
      });
      const failed = await coordinator.completeAction({
        lease: started.lease,
        actionId: started.action.id,
        success: false,
        resultSummary: "The exact scan timed out without evidence",
        failureCategory: "timeout",
        before: {},
        after: {},
      });
      expect(failed).toMatchObject({
        directive: "recover",
        run: { run: { state: "recovering" } },
      });
      expect(failed.run.lease).not.toBeNull();
      expect(port.dispatched).toHaveLength(1);
      expect(database.prepare("SELECT COUNT(*) AS count FROM actions WHERE run_id = ?").get("run-guided-recovery"))
        .toEqual({ count: 1 });
      expect(database.prepare("SELECT error_category FROM actions WHERE id = ?").get(started.action.id))
        .toEqual({ error_category: "timeout" });
      expect(database.prepare("SELECT COUNT(*) AS count FROM guided_decisions WHERE run_id = ? AND status = 'pending'")
        .get("run-guided-recovery")).toEqual({ count: 0 });
      expect(coordinator.getLatestCheckpoint("run-guided-recovery")?.state.run.state).toBe("recovering");
    } finally {
      database.close();
    }
  });

  test("detects the configured third identical no-progress action and persists its safe stop", async () => {
    const { database, coordinator } = setup();
    try {
      const fixture = seedRun(database, { runId: "run-loop", journey: "autonomous" });
      let lease = coordinator.acquireRunLease("run-loop", "worker-1");
      let last;
      for (let index = 0; index < 3; index += 1) {
        const started = await coordinator.startAction({ lease, intent: intent(fixture, "run-loop") });
        last = await coordinator.completeAction({
          lease: started.lease,
          actionId: started.action.id,
          success: true,
          resultSummary: `No new evidence on attempt ${index + 1}`,
          before: {},
          after: {},
        });
        if (last.run.lease) lease = last.run.lease;
      }
      expect(last?.directive).toBe("blocked");
      expect(last?.loopKinds).toContain("identical_action");
      expect(last?.run.run.state).toBe("blocked");
      expect(last?.run.lease).toBeNull();
      const checkpoint = coordinator.getLatestCheckpoint("run-loop");
      expect(checkpoint?.eventSequence).toBe(last?.eventSequence);
      expect(checkpoint?.state.run.state).toBe("blocked");
      const event = database.prepare("SELECT event_type FROM events WHERE run_id = ? AND sequence = ?")
        .get("run-loop", last!.eventSequence) as { event_type: string };
      expect(event.event_type).toBe("action.completed");
    } finally {
      database.close();
    }
  });

  test("startup recovery resumes only safe idempotent work and blocks unsafe ambiguity", async () => {
    const { database, coordinator, clock, port } = setup();
    try {
      const safeFixture = seedRun(database, { runId: "run-safe", journey: "autonomous" });
      const unsafeFixture = seedRun(database, { runId: "run-unsafe", journey: "autonomous" });
      const safeLease = coordinator.acquireRunLease("run-safe", "dead-worker");
      const unsafeLease = coordinator.acquireRunLease("run-unsafe", "dead-worker");
      await coordinator.startAction({ lease: safeLease, intent: intent(safeFixture, "run-safe") });
      await coordinator.startAction({
        lease: unsafeLease,
        intent: intent(unsafeFixture, "run-unsafe", {
          actionType: "mutate",
          intentSummary: "Perform non-repeatable change",
          idempotent: false,
          destructive: true,
        }),
      });
      clock.advance(2_000);
      const restarted = new DurableRunCoordinator(database, port, { now: clock.now, leaseTtlMs: 1_000 });
      const results = await restarted.recoverOnStartup("recovery-worker");
      expect(results.find((result) => result.runId === "run-safe")?.disposition)
        .toBe("resumed_idempotently");
      expect(results.find((result) => result.runId === "run-unsafe")?.disposition)
        .toBe("blocked_for_review");
      expect(port.resumed.map((action) => action.runId)).toEqual(["run-safe"]);
      expect(restarted.getRun("run-safe")).toMatchObject({
        run: { state: "recovering" },
        lease: { ownerId: "recovery-worker" },
      });
      expect(restarted.getRun("run-unsafe")).toMatchObject({
        run: { state: "blocked" },
        lease: null,
      });
    } finally {
      database.close();
    }
  });

  test("startup recovery closes expired planning turns and checkpoints both journeys before replanning", async () => {
    const { database, coordinator, clock, port } = setup();
    try {
      for (const journey of ["autonomous", "guided"] as const) {
        const runId = `run-planning-${journey}`;
        seedRun(database, { runId, journey, status: "planning" });
        coordinator.acquireRunLease(runId, `dead-${journey}-planner`);
        database.prepare(`
          INSERT INTO provider_turns (id, run_id, provider, model, status, started_at)
          VALUES (?, ?, 'xai-grok-oauth', 'grok-4.5', 'started', ?)
        `).run(`turn-${journey}`, runId, clock.now().toISOString());
      }

      clock.advance(2_000);
      const restarted = new DurableRunCoordinator(database, port, { now: clock.now, leaseTtlMs: 1_000 });
      const results = await restarted.recoverOnStartup("recovery-worker");

      for (const journey of ["autonomous", "guided"] as const) {
        const runId = `run-planning-${journey}`;
        expect(results.find((result) => result.runId === runId)).toMatchObject({
          disposition: "restarted_planning",
          actionIds: [],
        });
        expect(restarted.getRun(runId)).toMatchObject({
          run: { state: "planning", journey },
          lease: null,
        });
        expect(database.prepare(`
          SELECT status, error_category, ended_at FROM provider_turns WHERE id = ?
        `).get(`turn-${journey}`)).toEqual({
          status: "cancelled",
          error_category: "process_crash",
          ended_at: clock.now().toISOString(),
        });
        const event = database.prepare(`
          SELECT sequence, event_type, journey,
            json_extract(payload_json, '$.classification') AS classification
          FROM events WHERE run_id = ? ORDER BY sequence DESC LIMIT 1
        `).get(runId) as { sequence: number; event_type: string; journey: string; classification: string };
        expect(event).toMatchObject({
          event_type: "run.recovery_started",
          journey,
          classification: "restart_planning",
        });
        expect(database.prepare(`
          SELECT in_flight_classification FROM checkpoints
          WHERE run_id = ? AND event_sequence = ?
        `).get(runId, event.sequence)).toEqual({ in_flight_classification: "restart_planning" });
        expect(database.prepare("SELECT COUNT(*) AS count FROM actions WHERE run_id = ?").get(runId))
          .toEqual({ count: 0 });
        expect(database.prepare("SELECT COUNT(*) AS count FROM guided_decisions WHERE run_id = ?").get(runId))
          .toEqual({ count: 0 });
      }
    } finally {
      database.close();
    }
  });

  test("persists delayed retry, budget, and circuit snapshots across coordinator restart", async () => {
    const { database, coordinator, port, clock } = setup();
    try {
      const fixture = seedRun(database, { runId: "run-controls", journey: "autonomous" });
      const lease = coordinator.acquireRunLease("run-controls", "worker-1");
      const started = await coordinator.startAction({ lease, intent: intent(fixture, "run-controls") });
      const failed = await coordinator.completeAction({
        lease: started.lease,
        actionId: started.action.id,
        success: false,
        resultSummary: "Provider temporarily unavailable",
        before: {},
        after: {},
        failureCategory: "provider_unavailable",
        circuitKey: "provider:grok",
        budgetDelta: { providerTokens: 250 },
      });
      expect(failed.directive).toBe("retry");
      expect(failed.run.run.state).toBe("recovering");
      expect(failed.run.control.retryCount).toBe(1);
      expect(failed.run.control.budget.usage).toMatchObject({ retries: 1, providerTokens: 250 });
      expect(failed.run.control.circuits["provider:grok"]?.consecutiveFailures).toBe(1);
      expect(failed.run.lease).toBeNull();
      expect(failed.run.control.recovery).toMatchObject({
        kind: "retry",
        failedActionId: started.action.id,
      });
      clock.advance(10);
      const restarted = new DurableRunCoordinator(database, port, { now: clock.now });
      expect(restarted.getRun("run-controls").control).toMatchObject({
        retryCount: 1,
        replanCount: 0,
        circuits: { "provider:grok": { consecutiveFailures: 1 } },
        recovery: { kind: "retry", failedActionId: started.action.id },
      });
    } finally {
      database.close();
    }
  });

  test("allows a bounded replan only when a failed action produced canonical new facts", async () => {
    const { database, coordinator } = setup();
    try {
      const fixture = seedRun(database, { runId: "run-new-facts", journey: "autonomous" });
      const lease = coordinator.acquireRunLease("run-new-facts", "worker-1");
      const started = await coordinator.startAction({ lease, intent: intent(fixture, "run-new-facts") });
      const failed = await coordinator.completeAction({
        lease: started.lease,
        actionId: started.action.id,
        success: false,
        resultSummary: "The service returned a different verified banner before failing",
        before: { evidenceIds: [] },
        after: { evidenceIds: ["evidence-new-fact"] },
        failureCategory: "deterministic_tool_error",
      });
      expect(failed).toMatchObject({ directive: "replan", run: { run: { state: "recovering" } } });
      expect(failed.run.control.recovery).toMatchObject({
        kind: "replan",
        failedActionId: started.action.id,
      });
      const replanLease = coordinator.acquireRunLease("run-new-facts", "worker-2");
      const replanned = coordinator.beginReplan({
        lease: replanLease,
        reason: "The newly retained evidence supports a materially different in-contract strategy",
      });
      expect(replanned.run.run.state).toBe("planning");
      expect(replanned.run.control.replanCount).toBe(1);
      expect(replanned.run.control.recovery).toBeUndefined();
    } finally {
      database.close();
    }
  });

  test("cooperatively cancels child work, writes terminal checkpoint, and clears every active lease", async () => {
    const { database, coordinator, port } = setup();
    try {
      const fixture = seedRun(database, { runId: "run-cancel", journey: "autonomous" });
      const lease = coordinator.acquireRunLease("run-cancel", "worker-1");
      const started = await coordinator.startAction({ lease, intent: intent(fixture, "run-cancel") });
      const cancelled = await coordinator.cancelRun({
        lease: started.lease,
        reason: "Operator requested a safe stop",
      });
      expect(port.cancelled).toEqual(["run-cancel"]);
      expect(port.signals[0]?.aborted).toBe(true);
      expect(cancelled.run.run.state).toBe("cancelled");
      expect(cancelled.run.lease).toBeNull();
      expect(database.prepare("SELECT lease_owner, lease_expires_at FROM runs WHERE id = 'run-cancel'").get())
        .toEqual({ lease_owner: null, lease_expires_at: null });
      expect(database.prepare("SELECT status FROM actions WHERE id = ?").get(started.action.id))
        .toEqual({ status: "cancelled" });
      const checkpoint = coordinator.getLatestCheckpoint("run-cancel");
      expect(checkpoint?.eventSequence).toBe(cancelled.eventSequence);
      expect(checkpoint?.state.run.state).toBe("cancelled");
    } finally {
      database.close();
    }
  });
});
