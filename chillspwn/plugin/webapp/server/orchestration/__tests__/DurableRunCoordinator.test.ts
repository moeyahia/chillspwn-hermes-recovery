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
}): { missionId: string; stepId: string; assignmentId: string; contractId?: string } {
  const now = "2026-07-14T23:59:00.000Z";
  const missionId = `mission_${input.runId}`;
  const planId = `plan_${input.runId}`;
  const stepId = `step_${input.runId}`;
  const assignmentId = `assignment_${input.runId}`;
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
        allowedActionClasses: input.allowedActions ?? ["scan", "mutate", "reconnaissance"],
        prohibitedActionClasses: [],
        destructivePolicy: "prohibited",
        specialistAgentIds: ["ReconScout"],
      }),
      JSON.stringify(input.budget ?? { toolCalls: 20, concurrency: 3, retries: 2, replans: 2 }),
      now,
      now,
    );
  }

  database.prepare(`
    INSERT INTO mission_targets (
      id, mission_id, target, target_type, disposition,
      normalized_target, created_at
    ) VALUES (?, ?, 'target-1', 'other', 'allowed', 'target-1', ?)
  `).run(`target_${input.runId}`, missionId, now);

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
    INSERT OR IGNORE INTO agents (
      id, role, display_name, status, tool_policy_json,
      version, created_at, updated_at
    ) VALUES (
      'ReconScout', 'reconnaissance', 'ReconScout', 'available',
      '{"allowedTools":["quick_scan"],"deniedTools":[],"approvalRequiredTools":[]}',
      '1', ?, ?
    )
  `).run(now, now);
  database.prepare(`
    INSERT OR IGNORE INTO agent_capabilities (
      agent_id, capability, source, enabled, metadata_json
    ) VALUES ('ReconScout', 'quick_scan', 'durable-coordinator-test', 1, '{}')
  `).run();
  database.prepare(`
    INSERT OR IGNORE INTO mcp_servers (
      id, name, transport, endpoint_redacted, status, capabilities_json,
      policy_json, last_checked_at, created_at, updated_at
    ) VALUES (
      'sechub-reconnaissance', 'sechub-reconnaissance', 'fixture', 'test-only',
      'healthy', '["quick_scan"]',
      '{"enabled":true,"assignedAgents":["ReconScout"],"startPermitted":true}',
      ?, ?, ?
    )
  `).run(now, now, now);
  database.prepare(`
    INSERT INTO plan_steps (
      id, plan_id, run_id, ordinal, phase, title, objective,
      status, assigned_agent_id, created_at, updated_at
    ) VALUES (?, ?, ?, 0, 'recon', 'Fixture step', 'Collect evidence',
      'ready', 'ReconScout', ?, ?)
  `).run(stepId, planId, input.runId, now, now);
  database.prepare(`
    INSERT INTO assignments (
      id, run_id, step_id, agent_id, status, created_at, updated_at
    ) VALUES (?, ?, ?, 'ReconScout', 'queued', ?, ?)
  `).run(assignmentId, input.runId, stepId, now, now);
  database.prepare("UPDATE runs SET current_plan_id = ?, current_step_id = ? WHERE id = ?")
    .run(planId, stepId, input.runId);
  return { missionId, stepId, assignmentId, ...(contractId ? { contractId } : {}) };
}

function intent(fixture: { missionId: string; stepId: string; assignmentId: string }, runId: string, overrides: Partial<DurableActionIntent> = {}): DurableActionIntent {
  return {
    missionId: fixture.missionId,
    runId,
    stepId: fixture.stepId,
    assignmentId: fixture.assignmentId,
    planVersion: 1,
    actionType: "scan",
    actionClass: "reconnaissance",
    arguments: {
      mcpServer: "sechub-reconnaissance",
      toolName: "quick_scan",
      arguments: { ports: [80, 443] },
    },
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

  test("revalidates canonical Autonomous authority after lease acquisition and safe-stops without an action", async () => {
    const cases: Array<{
      name: string;
      mutate: (database: Database, fixture: ReturnType<typeof seedRun>) => void;
    }> = [
      {
        name: "mission authorization revoked",
        mutate(database, fixture) {
          database.prepare("UPDATE missions SET authorization_status = 'revoked' WHERE id = ?")
            .run(fixture.missionId);
        },
      },
      {
        name: "contract superseded",
        mutate(database, fixture) {
          database.prepare("UPDATE mission_contracts SET state = 'superseded' WHERE id = ?")
            .run(fixture.contractId!);
        },
      },
      {
        name: "contract version drifted",
        mutate(database, fixture) {
          database.prepare("UPDATE mission_contracts SET version = version + 1 WHERE id = ?")
            .run(fixture.contractId!);
        },
      },
      {
        name: "contract hash drifted",
        mutate(database, fixture) {
          database.prepare("UPDATE mission_contracts SET contract_hash = ? WHERE id = ?")
            .run("b".repeat(64), fixture.contractId!);
        },
      },
      {
        name: "target prohibited",
        mutate(database, fixture) {
          database.prepare("UPDATE mission_targets SET disposition = 'prohibited' WHERE mission_id = ?")
            .run(fixture.missionId);
        },
      },
      {
        name: "specialist removed from contract",
        mutate(database, fixture) {
          database.prepare(`
            UPDATE mission_contracts
            SET action_policy_json = json_set(
              action_policy_json, '$.specialistAgentIds', json('["WebBreaker"]')
            ) WHERE id = ?
          `).run(fixture.contractId!);
        },
      },
      {
        name: "assignment no longer executable",
        mutate(database, fixture) {
          database.prepare("UPDATE assignments SET status = 'blocked' WHERE id = ?")
            .run(fixture.assignmentId);
        },
      },
    ];

    for (const testCase of cases) {
      const { database, coordinator, port } = setup();
      try {
        const runId = `run-authority-race-${testCase.name.replaceAll(" ", "-")}`;
        const fixture = seedRun(database, { runId, journey: "autonomous" });
        const lease = coordinator.acquireRunLease(runId, "worker-race");
        testCase.mutate(database, fixture);

        let rejection: unknown;
        try {
          await coordinator.startAction({ lease, intent: intent(fixture, runId) });
        } catch (error) {
          rejection = error;
        }
        expect(rejection).toBeInstanceOf(DurableOrchestrationError);
        expect((rejection as DurableOrchestrationError).code.length).toBeGreaterThan(0);
        expect(port.dispatched).toHaveLength(0);
        expect(database.prepare("SELECT COUNT(*) AS count FROM actions WHERE run_id = ?").get(runId))
          .toEqual({ count: 0 });
        expect(database.prepare("SELECT status FROM plan_steps WHERE id = ?").get(fixture.stepId))
          .toEqual({ status: "blocked" });
        expect(database.prepare("SELECT status FROM assignments WHERE id = ?").get(fixture.assignmentId))
          .toEqual({ status: "blocked" });
        expect(coordinator.getRun(runId)).toMatchObject({ run: { state: "blocked" }, lease: null });
        expect(coordinator.getLatestCheckpoint(runId)?.state.run.state).toBe("blocked");
        expect(database.prepare(`
          SELECT event_type, json_extract(payload_json, '$.dispatchAttempted') AS dispatch_attempted
          FROM events WHERE run_id = ? ORDER BY sequence DESC LIMIT 1
        `).get(runId)).toEqual({
          event_type: "run.autonomous_safe_stopped",
          dispatch_attempted: 0,
        });
      } finally {
        database.close();
      }
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

  test("revalidates Guided authorization, scope, plan, and assignment before action creation", async () => {
    const cases: Array<{
      name: string;
      mutate: (
        database: Database,
        missionId: string,
        fixture: { missionId: string; stepId: string; assignmentId: string },
        runId: string,
      ) => void;
    }> = [
      {
        name: "authorization revoked",
        mutate(database, missionId) {
          database.prepare("UPDATE missions SET authorization_status = 'revoked' WHERE id = ?").run(missionId);
        },
      },
      {
        name: "target prohibited",
        mutate(database, missionId) {
          database.prepare("UPDATE mission_targets SET disposition = 'prohibited' WHERE mission_id = ?").run(missionId);
        },
      },
      {
        name: "assignment cancelled",
        mutate(database, _missionId, fixture) {
          database.prepare("UPDATE assignments SET status = 'cancelled' WHERE id = ?").run(fixture.assignmentId);
        },
      },
      {
        name: "specialist quarantined",
        mutate(database) {
          database.prepare("UPDATE agents SET status = 'quarantined' WHERE id = 'ReconScout'").run();
        },
      },
      {
        name: "step reassigned",
        mutate(database, _missionId, fixture) {
          database.prepare("UPDATE plan_steps SET assigned_agent_id = NULL WHERE id = ?").run(fixture.stepId);
        },
      },
      {
        name: "plan superseded",
        mutate(database, _missionId, _fixture, runId) {
          database.prepare("UPDATE plans SET status = 'superseded' WHERE run_id = ?").run(runId);
        },
      },
    ];
    for (const testCase of cases) {
      const { database, coordinator, port } = setup();
      try {
        const runId = `run-guided-race-${testCase.name.replaceAll(" ", "-")}`;
        const fixture = seedRun(database, { runId, journey: "guided", status: "waiting_guided_decision" });
        const represented = intent(fixture, runId);
        const decisionId = `decision-${runId}`;
        database.prepare(`
          INSERT INTO guided_decisions (
            id, mission_id, run_id, step_id, requested_action_fingerprint,
            requested_parameters_json, rationale, risk_class, reversibility,
            status, decision_actor, decided_at, expires_at, created_at
          ) VALUES (?, ?, ?, ?, ?, '{}', 'Run exact scan', 'low', 'reversible',
            'approved', 'operator', ?, ?, ?)
        `).run(
          decisionId,
          fixture.missionId,
          runId,
          fixture.stepId,
          fingerprintAction(represented).hash,
          "2026-07-14T23:59:30.000Z",
          "2026-07-15T01:00:00.000Z",
          "2026-07-14T23:59:00.000Z",
        );
        const lease = coordinator.acquireRunLease(runId, "guided-worker");
        testCase.mutate(database, fixture.missionId, fixture, runId);
        await expect(coordinator.startAction({ lease, intent: represented, guidedDecisionId: decisionId }))
          .rejects.toBeInstanceOf(DurableOrchestrationError);
        expect(port.dispatched).toHaveLength(0);
        expect(database.prepare("SELECT COUNT(*) AS count FROM actions WHERE run_id = ?").get(runId))
          .toEqual({ count: 0 });
        expect(database.prepare("SELECT status FROM guided_decisions WHERE id = ?").get(decisionId))
          .toEqual({ status: "approved" });
        expect(coordinator.getRun(runId)).toMatchObject({ run: { state: "blocked" }, lease: null });
        expect(coordinator.getLatestCheckpoint(runId)?.state.run.state).toBe("blocked");
      } finally {
        database.close();
      }
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
        if (index < 2) {
          database.prepare("UPDATE assignments SET status = 'queued' WHERE id = ?")
            .run(fixture.assignmentId);
          database.prepare("UPDATE plan_steps SET status = 'ready' WHERE id = ?")
            .run(fixture.stepId);
        }
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
          destructive: false,
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

  test("Autonomous transient failures do not retry after specialist tool policy drifts", async () => {
    for (const drift of ["require_approval", "deny"] as const) {
      const { database, coordinator } = setup();
      try {
        const runId = `run-tool-policy-drift-${drift}`;
        const fixture = seedRun(database, { runId, journey: "autonomous" });
        expect(database.prepare(`
          SELECT tool_policy_json FROM agents WHERE id = 'ReconScout'
        `).get()).toEqual({
          tool_policy_json: '{"allowedTools":["quick_scan"],"deniedTools":[],"approvalRequiredTools":[]}',
        });
        const lease = coordinator.acquireRunLease(runId, "worker-1");
        const started = await coordinator.startAction({ lease, intent: intent(fixture, runId) });

        const policyKey = drift === "require_approval"
          ? "approvalRequiredTools"
          : "deniedTools";
        database.prepare(`
          UPDATE agents
          SET tool_policy_json = json_set(tool_policy_json, ?, json('["quick_scan"]'))
          WHERE id = 'ReconScout'
        `).run(`$.${policyKey}`);
        expect(database.prepare(`
          SELECT json_extract(tool_policy_json, ?) AS policy_value
          FROM agents WHERE id = 'ReconScout'
        `).get(`$.${policyKey}`)).toEqual({ policy_value: '["quick_scan"]' });

        const failed = await coordinator.completeAction({
          lease: started.lease,
          actionId: started.action.id,
          success: false,
          resultSummary: "The exact MCP call timed out after its policy changed",
          failureCategory: "timeout",
          before: {},
          after: {},
        });
        expect(failed).toMatchObject({
          directive: "blocked",
          run: {
            run: { state: "blocked" },
            control: { retryCount: 0 },
            lease: null,
          },
        });
        expect(failed.reason).toContain("Safe-stopped (outside_contract)");
        expect(failed.run.control.recovery).toBeUndefined();
        expect(database.prepare(`
          SELECT json_extract(payload_json, '$.directive') AS directive
          FROM events WHERE run_id = ? AND event_type = 'action.completed'
          ORDER BY sequence DESC LIMIT 1
        `).get(runId)).toEqual({ directive: "blocked" });
      } finally {
        database.close();
      }
    }
  });

  test("Autonomous authorization rejects an unsigned class and incomplete MCP bindings before action creation", async () => {
    const cases: Array<{ name: string; overrides: Partial<DurableActionIntent> }> = [
      {
        name: "unsigned action class",
        overrides: { actionClass: "credential-access" },
      },
      {
        name: "missing exact MCP server",
        overrides: {
          arguments: { toolName: "quick_scan", arguments: { ports: [80, 443] } },
        },
      },
      {
        name: "missing exact MCP tool",
        overrides: {
          arguments: { mcpServer: "sechub-reconnaissance", arguments: { ports: [80, 443] } },
        },
      },
    ];
    for (const testCase of cases) {
      const { database, coordinator } = setup();
      try {
        const runId = `run-retry-boundary-${testCase.name.replaceAll(" ", "-")}`;
        const fixture = seedRun(database, { runId, journey: "autonomous" });
        const lease = coordinator.acquireRunLease(runId, "worker-1");
        await expect(coordinator.startAction({
          lease,
          intent: intent(fixture, runId, testCase.overrides),
        })).rejects.toBeInstanceOf(DurableOrchestrationError);
        expect(coordinator.getRun(runId)).toMatchObject({ run: { state: "blocked" }, lease: null });
        expect(database.prepare("SELECT COUNT(*) AS count FROM actions WHERE run_id = ?").get(runId))
          .toEqual({ count: 0 });
        expect(coordinator.getLatestCheckpoint(runId)?.state.run.state).toBe("blocked");
      } finally {
        database.close();
      }
    }
  });

  test("Autonomous retry fails closed when the signed action class or specialist pool drifts", async () => {
    const cases: Array<{ name: string; policyPath: string; value: string }> = [
      { name: "action class removed", policyPath: "$.allowedActionClasses", value: '["scan"]' },
      { name: "specialist removed", policyPath: "$.specialistAgentIds", value: '["WebBreaker"]' },
    ];
    for (const testCase of cases) {
      const { database, coordinator } = setup();
      try {
        const runId = `run-retry-drift-${testCase.name.replaceAll(" ", "-")}`;
        const fixture = seedRun(database, { runId, journey: "autonomous" });
        const lease = coordinator.acquireRunLease(runId, "worker-1");
        const started = await coordinator.startAction({ lease, intent: intent(fixture, runId) });
        database.prepare(`
          UPDATE mission_contracts
          SET action_policy_json = json_set(action_policy_json, ?, json(?))
          WHERE id = ?
        `).run(testCase.policyPath, testCase.value, fixture.contractId!);
        const failed = await coordinator.completeAction({
          lease: started.lease,
          actionId: started.action.id,
          success: false,
          resultSummary: `Transient failure after ${testCase.name}`,
          failureCategory: "timeout",
          before: {},
          after: {},
        });
        expect(failed).toMatchObject({ directive: "blocked", run: { run: { state: "blocked" } } });
        expect(failed.run.control.retryCount).toBe(0);
        expect(failed.run.control.recovery).toBeUndefined();
      } finally {
        database.close();
      }
    }
  });

  test("startup recovery does not resume an idempotent tool after it becomes approval-gated", async () => {
    const { database, coordinator, clock, port } = setup();
    try {
      const runId = "run-startup-policy-drift";
      const fixture = seedRun(database, { runId, journey: "autonomous" });
      const lease = coordinator.acquireRunLease(runId, "dead-worker");
      await coordinator.startAction({ lease, intent: intent(fixture, runId) });
      database.prepare(`
        UPDATE agents
        SET tool_policy_json = json_set(
          tool_policy_json,
          '$.approvalRequiredTools',
          json('["quick_scan"]')
        )
        WHERE id = 'ReconScout'
      `).run();
      clock.advance(2_000);

      const restarted = new DurableRunCoordinator(database, port, { now: clock.now, leaseTtlMs: 1_000 });
      const results = await restarted.recoverOnStartup("recovery-worker");
      expect(results).toContainEqual(expect.objectContaining({
        runId,
        disposition: "blocked_for_review",
      }));
      expect(port.resumed).toHaveLength(0);
      expect(restarted.getRun(runId)).toMatchObject({ run: { state: "blocked" }, lease: null });
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
