import { afterEach, describe, expect, test } from "bun:test";
import { createDatabaseConnection, migrateDatabase, type SqliteDatabase } from "../../db";
import type { DurableAction } from "../../orchestration";
import {
  CommandRuntimeError,
  createMissionRuntime,
  type MissionPlanPortResult,
  type MissionPlannerPort,
  type ResultAwareExecutionPort,
} from "..";

const START = Date.parse("2026-07-17T12:00:00.000Z");
const databases: SqliteDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

class Clock {
  private value = START;
  now = (): Date => new Date(this.value);
  advance(milliseconds: number): void { this.value += milliseconds; }
  iso(offset = 0): string { return new Date(this.value + offset).toISOString(); }
}

class NoopExecution implements ResultAwareExecutionPort {
  async dispatch(_action: DurableAction, _signal: AbortSignal): Promise<void> {}
  async resume(_action: DurableAction, _signal: AbortSignal): Promise<void> {}
  async cancelRun(_runId: string, _reason: string): Promise<void> {}
}

function database(): SqliteDatabase {
  const value = createDatabaseConnection({ filename: ":memory:" });
  databases.push(value);
  migrateDatabase(value);
  return value;
}

function seed(db: SqliteDatabase, suffix: string, clock: Clock): { missionId: string; runId: string } {
  const missionId = `mission-diagnosis-${suffix}`;
  const runId = `run-diagnosis-${suffix}`;
  const now = clock.iso();
  db.prepare(`
    INSERT INTO missions (
      id, name, objective, journey, status, authorization_status,
      memory_policy_json, created_by, created_at, updated_at, control_plane
    ) VALUES (?, 'Diagnosis lifecycle', 'Inspect one authorized lab target',
      'autonomous', 'active', 'verified', '{}', 'operator:test', ?, ?, 'command_os_v2')
  `).run(missionId, now, now);
  db.prepare(`
    INSERT INTO mission_targets (
      id, mission_id, target, target_type, disposition, normalized_target, created_at
    ) VALUES (?, ?, 'lab.internal', 'domain', 'allowed', 'lab.internal', ?)
  `).run(`target-${suffix}`, missionId, now);
  db.prepare(`
    INSERT INTO mission_contracts (
      id, mission_id, version, state, contract_hash, authorization_json,
      action_policy_json, budgets_json, safe_stop_json, deliverables_json,
      memory_scopes_json, confirmed_by, confirmed_at, created_at
    ) VALUES (?, ?, 1, 'confirmed', ?, '{}', ?, '{}', '{}', '[]', '[]',
      'operator:test', ?, ?)
  `).run(
    `contract-${runId}`,
    missionId,
    "a".repeat(64),
    JSON.stringify({
      allowedActionClasses: ["reconnaissance"],
      prohibitedActionClasses: [],
      destructivePolicy: "prohibited",
      specialistAgentIds: ["ReconScout"],
    }),
    now,
    now,
  );
  db.prepare(`
    INSERT INTO runs (
      id, mission_id, journey, status, contract_id, progress, status_reason,
      budget_json, budget_usage_json, retry_count, replan_count,
      started_at, created_at, updated_at, version, control_plane
    ) VALUES (?, ?, 'autonomous', 'planning', ?, 0, 'Build the first in-contract plan',
      '{"wallClockMs":60000,"providerTurns":8,"retries":2,"replans":1}',
      '{}', 0, 0, ?, ?, ?, 1, 'command_os_v2')
  `).run(runId, missionId, `contract-${runId}`, now, now, now);
  db.prepare(`
    INSERT INTO events (
      id, mission_id, run_id, sequence, event_type, occurred_at,
      actor_type, actor_id, summary, payload_json, schema_version,
      journey, sensitivity, redaction_json, created_at
    ) VALUES (?, ?, ?, 1, 'run.autonomous_planning_started', ?,
      'system', 'fixture', 'Autonomous planning started', '{}', 1,
      'autonomous', 'internal', '{}', ?)
  `).run(`event-planning-start-${suffix}`, missionId, runId, clock.iso(-1_000), clock.iso(-1_000));
  return { missionId, runId };
}

function insertFailedTurn(db: SqliteDatabase, runId: string, id: string, clock: Clock, category = "rate_limit"): void {
  db.prepare(`
    INSERT INTO provider_turns (
      id, run_id, provider, model, status, error_category,
      latency_ms, started_at, ended_at
    ) VALUES (?, ?, 'xai-grok-oauth', 'grok-4.5', 'failed', ?, 125, ?, ?)
  `).run(id, runId, category, clock.iso(), clock.iso());
}

function rateLimit(): CommandRuntimeError {
  return new CommandRuntimeError(429, "provider_rate_limited", "Provider returned HTTP 429", {
    humanMessage: "The planning provider is temporarily rate-limited and no plan was committed.",
    retryable: true,
    category: "rate_limit",
    details: { retryAfterMs: 500 },
  });
}

function policyDenial(): CommandRuntimeError {
  return new CommandRuntimeError(403, "provider_policy_denied", "Provider planning was denied", {
    humanMessage: "The planning request was denied by enforced policy.",
    retryable: false,
    category: "policy_denied",
  });
}

function runtime(input: {
  db: SqliteDatabase;
  clock: Clock;
  planner: MissionPlannerPort;
  suffix: string;
  crash?: Parameters<typeof createMissionRuntime>[0]["crashAfterCommit"];
}) {
  return createMissionRuntime({
    database: input.db,
    planner: input.planner,
    outcomeEvaluator: { async evaluate() { throw new Error("Evaluation is outside this fixture"); } },
    execution: new NoopExecution(),
    workerId: `diagnosis-worker-${input.suffix}`,
    leaseTtlMs: 1_000,
    now: input.clock.now,
    retryRandom: () => 0,
    ...(input.crash ? { crashAfterCommit: input.crash } : {}),
  });
}

function installAutonomousPlanDependencies(db: SqliteDatabase, clock: Clock): void {
  const now = clock.iso();
  db.prepare(`
    INSERT INTO agents (
      id, role, display_name, status, tool_policy_json, version, created_at, updated_at
    ) VALUES ('ReconScout', 'reconnaissance', 'Recon specialist', 'available', '{}', '1', ?, ?)
  `).run(now, now);
}

function successfulPlan(providerTurnId: string): MissionPlanPortResult {
  return {
    plan: {
      strategySummary: "Use one bounded read-only reconnaissance step",
      rationaleSummary: "The smallest authorized step establishes service availability",
      steps: [{
        phase: "reconnaissance",
        title: "Check the authorized service",
        objective: "Establish whether the approved service is available",
        explanation: "The specialist will inspect only the approved lab service.",
        rationale: "This read-only check provides the first useful planning result.",
        successCriteria: ["The service state is recorded"],
        assignedAgentId: "ReconScout",
        riskClass: "low",
        reversibility: "Read-only and reversible",
        action: {
          actionType: "reconnaissance",
          actionClass: "reconnaissance",
          target: "lab.internal",
          arguments: { question: "Is the approved service available?" },
          intentSummary: "Inspect the approved service",
          kind: "provider_turn",
          idempotent: true,
          destructive: false,
        },
      }],
    },
    usage: {
      providerTurnId,
      providerTurns: 1,
      exactTokenUsage: false,
      exactCostUsage: false,
    },
  };
}

describe("planning FailureDiagnosis lifecycle", () => {
  test("reconciles the retry-checkpoint crash window once from the exact failed provider turn", async () => {
    const db = database();
    const clock = new Clock();
    const fixture = seed(db, "retry-crash", clock);
    const engine = runtime({
      db,
      clock,
      suffix: "retry-crash",
      planner: {
        async plan() {
          insertFailedTurn(db, fixture.runId, "turn-retry-crash", clock);
          throw rateLimit();
        },
      },
      crash(point) {
        if (point === "planning_retry_scheduled") throw new Error("simulated process loss");
      },
    });
    try {
      await expect(engine.processRunNow(fixture.runId)).rejects.toThrow(
        "Injected process crash after durable commit: planning_retry_scheduled",
      );
      expect(db.prepare("SELECT COUNT(*) AS count FROM failure_diagnoses").get()).toEqual({ count: 0 });
      const before = db.prepare("SELECT status, version, retry_count FROM runs WHERE id = ?")
        .get(fixture.runId);
      expect(engine.reconcilePlanningFailureDiagnoses()).toBe(1);
      expect(engine.reconcilePlanningFailureDiagnoses()).toBe(0);
      expect(db.prepare("SELECT status, version, retry_count FROM runs WHERE id = ?")
        .get(fixture.runId)).toEqual(before);
      const diagnosis = db.prepare(`
        SELECT state, category, retry_history_json, preserved_refs_json
        FROM failure_diagnoses WHERE run_id = ?
      `).get(fixture.runId) as {
        state: string;
        category: string;
        retry_history_json: string;
        preserved_refs_json: string;
      };
      expect(diagnosis).toMatchObject({ state: "active", category: "rate_limit" });
      expect(JSON.parse(diagnosis.retry_history_json)).toEqual([
        expect.objectContaining({ providerTurnId: "turn-retry-crash", errorCategory: "rate_limit" }),
      ]);
      expect(JSON.parse(diagnosis.preserved_refs_json).map((item: { kind: string }) => item.kind))
        .toEqual(["event", "checkpoint"]);
    } finally {
      await engine.stop();
    }
  });

  test("reconciles an exact pre-plan safe stop without authorizing work", async () => {
    const db = database();
    const clock = new Clock();
    const fixture = seed(db, "safe-stop-crash", clock);
    const engine = runtime({
      db,
      clock,
      suffix: "safe-stop-crash",
      planner: {
        async plan() {
          insertFailedTurn(db, fixture.runId, "turn-safe-stop-crash", clock, "policy_denied");
          throw policyDenial();
        },
      },
      crash(point) {
        if (point === "planning_safe_stop_committed") throw new Error("simulated process loss");
      },
    });
    try {
      await expect(engine.processRunNow(fixture.runId)).rejects.toThrow(
        "Injected process crash after durable commit: planning_safe_stop_committed",
      );
      await engine.start();
      expect(engine.reconcilePlanningFailureDiagnoses()).toBe(0);
      expect(db.prepare("SELECT status, current_plan_id FROM runs WHERE id = ?").get(fixture.runId))
        .toEqual({ status: "blocked", current_plan_id: null });
      expect(db.prepare("SELECT COUNT(*) AS count FROM runtime_continuations WHERE run_id = ? AND status IN ('pending','processing')")
        .get(fixture.runId)).toEqual({ count: 0 });
      expect(db.prepare("SELECT state, category FROM failure_diagnoses WHERE run_id = ?").get(fixture.runId))
        .toEqual({ state: "terminal", category: "policy_denied" });
    } finally {
      await engine.stop();
    }
  });

  test("reconciles the exact adjacent safe-stop tail used by older pre-plan checkpoints", async () => {
    const db = database();
    const clock = new Clock();
    const fixture = seed(db, "adjacent-safe-stop", clock);
    const engine = runtime({
      db,
      clock,
      suffix: "adjacent-safe-stop",
      planner: {
        async plan() {
          insertFailedTurn(db, fixture.runId, "turn-adjacent-safe-stop", clock, "policy_denied");
          throw policyDenial();
        },
      },
      crash(point) {
        if (point === "planning_safe_stop_committed") throw new Error("simulated process loss");
      },
    });
    try {
      await expect(engine.processRunNow(fixture.runId)).rejects.toThrow("Injected process crash");
      const checkpoints = db.prepare(`
        SELECT id, event_sequence FROM checkpoints WHERE run_id = ?
        ORDER BY event_sequence DESC, created_at DESC, id DESC
      `).all(fixture.runId) as Array<{ id: string; event_sequence: number }>;
      const safeStopEvent = db.prepare(`
        SELECT id, sequence FROM events
        WHERE run_id = ? AND event_type = 'run.autonomous_safe_stopped'
      `).get(fixture.runId) as { id: string; sequence: number };
      const safeStopCheckpoint = checkpoints.find((item) => item.event_sequence === safeStopEvent.sequence);
      expect(safeStopCheckpoint).toBeDefined();
      db.prepare("DELETE FROM checkpoints WHERE id = ?").run(safeStopCheckpoint!.id);
      const legacyCheckpoint = db.prepare(`
        SELECT id, event_sequence FROM checkpoints WHERE run_id = ?
        ORDER BY event_sequence DESC, created_at DESC, id DESC LIMIT 1
      `).get(fixture.runId) as { id: string; event_sequence: number };
      expect(legacyCheckpoint.event_sequence).toBe(safeStopEvent.sequence - 1);
      db.prepare("UPDATE checkpoints SET in_flight_classification = 'safe_no_in_flight_action' WHERE id = ?")
        .run(legacyCheckpoint.id);

      expect(engine.reconcilePlanningFailureDiagnoses()).toBe(1);
      expect(engine.reconcilePlanningFailureDiagnoses()).toBe(0);
      const diagnosis = db.prepare(`
        SELECT state, category, preserved_refs_json
        FROM failure_diagnoses WHERE run_id = ?
      `).get(fixture.runId) as {
        state: string;
        category: string;
        preserved_refs_json: string;
      };
      expect(diagnosis).toMatchObject({ state: "terminal", category: "policy_denied" });
      expect(JSON.parse(diagnosis.preserved_refs_json)).toEqual([
        expect.objectContaining({
          kind: "event",
          meaning: expect.stringContaining("Exact canonical event"),
        }),
        expect.objectContaining({ kind: "checkpoint", id: legacyCheckpoint.id }),
      ]);
      expect(db.prepare("SELECT status, current_plan_id FROM runs WHERE id = ?").get(fixture.runId))
        .toEqual({ status: "blocked", current_plan_id: null });
    } finally {
      await engine.stop();
    }
  });

  test("rejects a stale checkpoint and an unrelated historical provider turn", async () => {
    for (const variant of ["stale-event", "historical-turn"] as const) {
      const db = database();
      const clock = new Clock();
      const fixture = seed(db, variant, clock);
      const engine = runtime({
        db,
        clock,
        suffix: variant,
        planner: {
          async plan() {
            insertFailedTurn(db, fixture.runId, `turn-${variant}`, clock, "policy_denied");
            throw policyDenial();
          },
        },
        crash(point) {
          if (point === "planning_safe_stop_committed") throw new Error("simulated process loss");
        },
      });
      try {
        await expect(engine.processRunNow(fixture.runId)).rejects.toThrow("Injected process crash");
        if (variant === "stale-event") {
          const latest = db.prepare("SELECT MAX(sequence) AS sequence FROM events WHERE run_id = ?")
            .get(fixture.runId) as { sequence: number };
          db.prepare(`
            INSERT INTO events (
              id, mission_id, run_id, sequence, event_type, occurred_at,
              actor_type, summary, payload_json, schema_version, journey,
              sensitivity, redaction_json, created_at
            ) VALUES (?, ?, ?, ?, 'run.unrelated_historical_marker', ?, 'system',
              'Unrelated later event', '{}', 1, 'autonomous', 'internal', '{}', ?)
          `).run(`event-${variant}`, fixture.missionId, fixture.runId, latest.sequence + 1, clock.iso(), clock.iso());
        } else {
          db.prepare("UPDATE provider_turns SET started_at = ?, ended_at = ? WHERE id = ?")
            .run(clock.iso(-5_000), clock.iso(-4_000), `turn-${variant}`);
        }
        expect(engine.reconcilePlanningFailureDiagnoses()).toBe(0);
        expect(db.prepare("SELECT COUNT(*) AS count FROM failure_diagnoses WHERE run_id = ?")
          .get(fixture.runId)).toEqual({ count: 0 });
      } finally {
        await engine.stop();
      }
    }
  });

  test("never reconciles planning failures after either run or mission ownership transfers", async () => {
    for (const ownership of ["run", "mission"] as const) {
      const db = database();
      const clock = new Clock();
      const suffix = `legacy-${ownership}`;
      const fixture = seed(db, suffix, clock);
      const engine = runtime({
        db,
        clock,
        suffix,
        planner: {
          async plan() {
            insertFailedTurn(db, fixture.runId, `turn-${suffix}`, clock, "policy_denied");
            throw policyDenial();
          },
        },
        crash(point) {
          if (point === "planning_safe_stop_committed") throw new Error("simulated process loss");
        },
      });
      try {
        await expect(engine.processRunNow(fixture.runId)).rejects.toThrow("Injected process crash");
        db.prepare(`UPDATE ${ownership === "run" ? "runs" : "missions"}
          SET control_plane = 'legacy' WHERE id = ?`)
          .run(ownership === "run" ? fixture.runId : fixture.missionId);
        const before = db.prepare(`
          SELECT r.status, r.version, r.control_plane,
            m.control_plane AS mission_control_plane
          FROM runs r JOIN missions m ON m.id = r.mission_id
          WHERE r.id = ?
        `).get(fixture.runId);

        expect(engine.reconcilePlanningFailureDiagnoses()).toBe(0);
        expect(db.prepare(`
          SELECT r.status, r.version, r.control_plane,
            m.control_plane AS mission_control_plane
          FROM runs r JOIN missions m ON m.id = r.mission_id
          WHERE r.id = ?
        `).get(fixture.runId)).toEqual(before);
        expect(db.prepare("SELECT COUNT(*) AS count FROM failure_diagnoses WHERE run_id = ?")
          .get(fixture.runId)).toEqual({ count: 0 });
      } finally {
        await engine.stop();
      }
    }
  });

  test("supersedes the active planning diagnosis when the exact retry turn activates a plan", async () => {
    const db = database();
    const clock = new Clock();
    const fixture = seed(db, "success", clock);
    installAutonomousPlanDependencies(db, clock);
    let calls = 0;
    const engine = runtime({
      db,
      clock,
      suffix: "success",
      planner: {
        async plan() {
          calls += 1;
          if (calls === 1) {
            insertFailedTurn(db, fixture.runId, "turn-success-failed", clock);
            throw rateLimit();
          }
          const providerTurnId = "turn-success-completed";
          db.prepare(`
            INSERT INTO provider_turns (
              id, run_id, provider, model, status, latency_ms, started_at, ended_at
            ) VALUES (?, ?, 'xai-grok-oauth', 'grok-4.5', 'completed', 100, ?, ?)
          `).run(providerTurnId, fixture.runId, clock.iso(), clock.iso());
          return successfulPlan(providerTurnId);
        },
      },
    });
    try {
      await engine.processRunNow(fixture.runId);
      expect(db.prepare("SELECT state FROM failure_diagnoses WHERE run_id = ?").get(fixture.runId))
        .toEqual({ state: "active" });
      clock.advance(500);
      await engine.replayContinuations(fixture.runId, ["planning_retry_to_dispatch"]);
      expect(calls).toBe(2);
      expect(db.prepare("SELECT state, resolved_at FROM failure_diagnoses WHERE run_id = ?")
        .get(fixture.runId)).toEqual({ state: "superseded", resolved_at: clock.iso() });
      const audit = db.prepare(`
        SELECT action, details_json FROM audit_records
        WHERE run_id = ? AND action = 'failure_diagnosis.superseded'
      `).get(fixture.runId) as { action: string; details_json: string };
      expect(audit.action).toBe("failure_diagnosis.superseded");
      expect(JSON.parse(audit.details_json)).toMatchObject({
        providerTurnId: "turn-success-completed",
        rawProviderPayloadPersisted: false,
      });
    } finally {
      await engine.stop();
    }
  });
});
