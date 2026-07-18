import { afterEach, describe, expect, test } from "bun:test";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  createMissionRuntime,
  type MissionOutcomeEvaluatorPort,
  type MissionPlannerPort,
  type ResultAwareExecutionPort,
} from "../../command-runtime";
import type { ResumeRunBoundary } from "../../command-runtime/MissionRuntimeEngine";
import { createDatabaseConnection, migrateDatabase, type SqliteDatabase } from "../../db";
import { EventRepository } from "../../events";
import {
  ActionRepository,
  CheckpointRepository,
  RunRepository,
  type DurableAction,
} from "../../orchestration";
import { createMissionRuntimeV2Router } from "../missionRuntimeV2Routes";
import { createOperationsRouter } from "../operationsRoutes";

const NOW = "2026-07-18T01:00:00.000Z";
const servers: Server[] = [];
const databases: SqliteDatabase[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
  for (const database of databases.splice(0)) database.close();
});

class NoopExecution implements ResultAwareExecutionPort {
  async dispatch(_action: DurableAction, _signal: AbortSignal): Promise<void> {}
  async resume(_action: DurableAction, _signal: AbortSignal): Promise<void> {}
  async cancelRun(_runId: string): Promise<void> {}
}

const planner: MissionPlannerPort = {
  async plan() { throw new Error("Planning is outside this focused resume-boundary test"); },
};

const evaluator: MissionOutcomeEvaluatorPort = {
  async evaluate() { return { success: false, summary: "No evaluation required", criteria: [] }; },
};

function seedGuidedWaitingRun(database: SqliteDatabase, suffix: string): { missionId: string; runId: string; assignmentId: string } {
  const missionId = `mission-${suffix}`;
  const runId = `run-${suffix}`;
  const planId = `plan-${suffix}`;
  const stepId = `step-${suffix}`;
  const agentId = `agent-${suffix}`;
  const assignmentId = `assignment-${suffix}`;
  database.prepare(`
    INSERT INTO missions (
      id, name, objective, journey, status, authorization_status,
      created_by, created_at, updated_at, control_plane
    ) VALUES (?, 'Resume boundary', 'Exercise one exact resume boundary',
      'guided', 'active', 'verified', 'operator:test', ?, ?, 'command_os_v2')
  `).run(missionId, NOW, NOW);
  database.prepare(`
    INSERT INTO agents (id, role, display_name, status, version, created_at, updated_at)
    VALUES (?, 'reconnaissance', 'Recon specialist', 'available', 'test-1', ?, ?)
  `).run(agentId, NOW, NOW);
  database.prepare(`
    INSERT INTO runs (
      id, mission_id, journey, status, current_plan_id, current_step_id,
      current_owner_id, progress, status_reason, next_action_summary,
      budget_json, budget_usage_json, started_at, created_at, updated_at,
      version, control_plane
    ) VALUES (?, ?, 'guided', 'waiting_guided_decision', ?, ?, ?, 0.25,
      'Waiting for the represented Guided decision', 'Wait for the exact decision',
      '{"retries":2,"replans":2,"concurrency":1}', '{}', ?, ?, ?, 1,
      'command_os_v2')
  `).run(runId, missionId, planId, stepId, agentId, NOW, NOW, NOW);
  database.prepare(`
    INSERT INTO plans (
      id, run_id, version, status, strategy_summary, plan_hash,
      created_by, created_at, activated_at
    ) VALUES (?, ?, 1, 'active', 'Collect one bounded observation', ?, 'planner:test', ?, ?)
  `).run(planId, runId, "a".repeat(64), NOW, NOW);
  database.prepare(`
    INSERT INTO plan_steps (
      id, plan_id, run_id, ordinal, phase, title, objective, status,
      assigned_agent_id, created_at, updated_at
    ) VALUES (?, ?, ?, 0, 'Recon', 'Observe the service', 'Reduce uncertainty',
      'waiting_guided_decision', ?, ?, ?)
  `).run(stepId, planId, runId, agentId, NOW, NOW);
  database.prepare(`
    INSERT INTO assignments (
      id, run_id, step_id, agent_id, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'queued', ?, ?)
  `).run(assignmentId, runId, stepId, agentId, NOW, NOW);
  database.prepare(`
    INSERT INTO guided_decisions (
      id, mission_id, run_id, step_id, requested_action_fingerprint,
      requested_parameters_json, rationale, risk_class, reversibility,
      status, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, '{}', 'Wait for one exact decision', 'low',
      'Read-only', 'pending', '2026-07-19T01:00:00.000Z', ?)
  `).run(`decision-${suffix}`, missionId, runId, stepId, "b".repeat(64), NOW);
  return { missionId, runId, assignmentId };
}

function seedCurrentPlanningRateLimit(database: SqliteDatabase, suffix: string): { missionId: string; runId: string } {
  const missionId = `mission-${suffix}`;
  const runId = `run-${suffix}`;
  database.prepare(`
    INSERT INTO missions (
      id, name, objective, journey, status, authorization_status,
      created_by, created_at, updated_at, control_plane
    ) VALUES (?, 'ReaperTwo', 'Plan the authorized lab assessment',
      'autonomous', 'failed', 'verified', 'operator:test', ?, ?, 'command_os_v2')
  `).run(missionId, NOW, NOW);
  database.prepare(`
    INSERT INTO runs (
      id, mission_id, journey, status, progress, status_reason,
      next_action_summary, budget_json, budget_usage_json, retry_count,
      replan_count, started_at, created_at, updated_at, version, control_plane
    ) VALUES (?, ?, 'autonomous', 'blocked', 0,
      'The planning provider is rate-limited and no result was committed.',
      'Start a new run after the provider recovers',
      '{"retries":2,"replans":2}', '{}', 0, 0, ?, ?, ?, 4, 'command_os_v2')
  `).run(runId, missionId, NOW, NOW, NOW);
  database.prepare(`
    INSERT INTO provider_turns (
      id, run_id, provider, model, status, error_category, started_at, ended_at
    ) VALUES (?, ?, 'xai-grok-oauth', 'grok-4.5', 'failed', 'rate_limit', ?, ?)
  `).run(`turn-${suffix}`, runId, NOW, NOW);
  const events = new EventRepository(database);
  const blockedEvent = events.append({
    missionId,
    runId,
    journey: "autonomous",
    eventType: "run.state_changed",
    actorType: "worker",
    summary: "planning -> blocked: provider rate limit",
    payload: { from: "planning", to: "blocked", stateVersion: 4 },
  });
  const stored = new RunRepository(database).get(runId);
  new CheckpointRepository(database, new ActionRepository(database)).create({
    run: stored,
    eventSequence: blockedEvent.sequence,
    now: NOW,
    inFlightClassification: "safe_no_in_flight_action",
  });
  // ReaperTwo's legacy shape recorded a semantic safe-stop diagnosis after
  // the transition checkpoint. It may improve the explanation, but it must
  // never act as historical authorization to replay provider planning.
  events.append({
    missionId,
    runId,
    journey: "autonomous",
    eventType: "run.autonomous_safe_stopped",
    actorType: "system",
    summary: "Planning stopped before any plan or target action existed",
    payload: { category: "rate_limit", code: "mission_runtime_rate_limit" },
  });
  return { missionId, runId };
}

function engine(database: SqliteDatabase, workerId: string) {
  return createMissionRuntime({
    database,
    planner,
    outcomeEvaluator: evaluator,
    execution: new NoopExecution(),
    workerId,
    leaseTtlMs: 2_000,
    scanIntervalMs: 60_000,
    now: () => new Date(NOW),
  });
}

async function application(database: SqliteDatabase, workerId: string) {
  const runtime = engine(database, workerId);
  const app = express();
  app.use(express.json());
  app.use(createOperationsRouter({
    database,
    clock: () => new Date(NOW),
    resolveActor: () => ({ id: "operator:test", type: "operator" }),
    resolveAccess: () => ({
      maximumSensitivity: "restricted",
      allEngagements: true,
      allowUnscopedSystemData: true,
      canManageRecovery: true,
    }),
  }));
  app.use(createMissionRuntimeV2Router({ runtime, resolveActor: () => "operator:test" }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  return { runtime, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

function exactBoundary(runtime: ReturnType<typeof engine>, runId: string): ResumeRunBoundary {
  const run = runtime.repository.getRunProjection(runId);
  const checkpoint = runtime.coordinator.getLatestCheckpoint(runId);
  if (!checkpoint || run.status !== "blocked") throw new Error("Fixture has no exact blocked checkpoint");
  return {
    expectedRunVersion: run.version,
    expectedRunStatus: "blocked",
    expectedCheckpointId: checkpoint.id,
    expectedCheckpointStateHash: checkpoint.stateHash,
    expectedCheckpointEventSequence: checkpoint.eventSequence,
  };
}

function mutate(base: string, runId: string, command: "pause" | "resume", key: string, body: Record<string, unknown>) {
  return fetch(`${base}/api/v2/runs/${runId}/${command}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
}

describe("hybrid V2 exact resume POST boundary", () => {
  test("requires the exact checkpoint fields, consumes them once, and rejects stale cached replay", async () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    databases.push(database);
    migrateDatabase(database);
    const fixture = seedGuidedWaitingRun(database, "exact-post");
    const { runtime, base } = await application(database, "exact-post-worker");

    const paused = await mutate(base, fixture.runId, "pause", "resume-boundary-pause", {
      reason: "Pause at the represented decision",
    });
    expect(paused.status).toBe(200);
    const boundary = exactBoundary(runtime, fixture.runId);

    const missing = await mutate(base, fixture.runId, "resume", "resume-boundary-missing", {
      reason: "Do not resume without an exact checkpoint",
    });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: { code: "invalid_resume_boundary" } });

    const stale = await mutate(base, fixture.runId, "resume", "resume-boundary-stale", {
      reason: "Do not resume stale checkpoint state",
      ...boundary,
      expectedCheckpointStateHash: "c".repeat(64),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "resume_checkpoint_stale" } });

    const first = await mutate(base, fixture.runId, "resume", "resume-boundary-current", {
      reason: "Resume the exact represented decision",
      ...boundary,
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      run: { id: fixture.runId, status: "waiting_guided_decision" },
      latestCheckpoint: { state: { run: { state: "waiting_guided_decision" } } },
    });

    const consumedAgain = await mutate(base, fixture.runId, "resume", "resume-boundary-new-command", {
      reason: "A consumed checkpoint cannot authorize another transition",
      ...boundary,
    });
    expect(consumedAgain.status).toBe(409);
    expect(await consumedAgain.json()).toMatchObject({ error: { code: "resume_checkpoint_stale" } });

    const immediateReplay = await mutate(base, fixture.runId, "resume", "resume-boundary-current", {
      reason: "Resume the exact represented decision",
      ...boundary,
    });
    expect(immediateReplay.status).toBe(200);

    database.prepare("UPDATE runs SET version = version + 1 WHERE id = ?").run(fixture.runId);
    const staleReplay = await mutate(base, fixture.runId, "resume", "resume-boundary-current", {
      reason: "Resume the exact represented decision",
      ...boundary,
    });
    expect(staleReplay.status).toBe(409);
    expect(await staleReplay.json()).toMatchObject({ error: { code: "resume_idempotent_replay_stale" } });
  });

  test("rejects every fresh execution-bearing work class before reserving resume", async () => {
    for (const kind of ["action", "provider_turn", "runtime_continuation", "assignment"] as const) {
      const database = createDatabaseConnection({ filename: ":memory:" });
      databases.push(database);
      migrateDatabase(database);
      const fixture = seedGuidedWaitingRun(database, `work-${kind}`);
      const { runtime, base } = await application(database, `work-${kind}-worker`);
      runtime.pauseRun(fixture.runId, "operator:test", "Create an exact zero-work checkpoint");
      const boundary = exactBoundary(runtime, fixture.runId);
      if (kind === "action") {
        database.prepare(`
          INSERT INTO actions (
            id, mission_id, run_id, action_type, action_class, fingerprint,
            normalized_arguments_json, status, intent_summary, created_at, updated_at
          ) VALUES (?, ?, ?, 'readiness', 'reconnaissance', ?, '{}', 'queued',
            'Fresh queued action', ?, ?)
        `).run(`active-${kind}`, fixture.missionId, fixture.runId, "d".repeat(64), NOW, NOW);
      } else if (kind === "provider_turn") {
        database.prepare(`
          INSERT INTO provider_turns (id, run_id, provider, status, started_at)
          VALUES (?, ?, 'fixture', 'started', ?)
        `).run(`active-${kind}`, fixture.runId, NOW);
      } else if (kind === "runtime_continuation") {
        database.prepare(`
          INSERT INTO runtime_continuations (
            id, run_id, kind, source_id, status, attempt_count, available_at,
            created_at, updated_at
          ) VALUES (?, ?, 'resume_recovery_pending', ?, 'pending', 0, ?, ?, ?)
        `).run(`active-${kind}`, fixture.runId, `source-${kind}`, NOW, NOW, NOW);
      } else {
        database.prepare(`
          UPDATE assignments SET status = 'active', lease_owner = 'other-worker',
            lease_acquired_at = ?, last_heartbeat_at = ?, lease_expires_at = ?
          WHERE id = ?
        `).run(NOW, NOW, "2026-07-18T01:30:00.000Z", fixture.assignmentId);
      }
      const response = await mutate(base, fixture.runId, "resume", `resume-work-${kind}`, {
        reason: "Do not resume while fresh work exists",
        ...boundary,
      });
      expect(response.status, kind).toBe(409);
      expect(await response.json(), kind).toMatchObject({
        error: {
          code: "resume_has_in_flight_work",
          details: {
            blockingWorkKind: kind,
            blockingWorkId: kind === "assignment" ? fixture.assignmentId : `active-${kind}`,
          },
        },
      });
      expect(runtime.repository.getRunProjection(fixture.runId)).toMatchObject({
        status: "blocked",
        version: boundary.expectedRunVersion,
      });
    }
  });

  test("denies the current ReaperTwo-style planning rate limit in place and rejects legacy control-plane ownership", async () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    databases.push(database);
    migrateDatabase(database);
    const fixture = seedCurrentPlanningRateLimit(database, "planning-rate-limit");
    const { runtime, base } = await application(database, "planning-rate-limit-worker");
    const boundary = exactBoundary(runtime, fixture.runId);

    const projectionResponse = await fetch(
      `${base}/api/v2/operations/runs/${fixture.runId}/recovery`,
    );
    expect(projectionResponse.status).toBe(200);
    const projection = await projectionResponse.json() as {
      proposedRecovery: { kind: string; summary: string };
      actions: Array<{ kind: string; available: boolean; command: string | null; reason: string }>;
    };
    expect(projection.proposedRecovery).toMatchObject({ kind: "safe_stop" });
    expect(projection.proposedRecovery.summary).toContain("start a new run");
    expect(projection.actions.find((action) => action.kind === "resume")).toMatchObject({
      available: false,
      command: null,
    });

    const rejected = await mutate(base, fixture.runId, "resume", "resume-planning-rate-limit", {
      reason: "Retry provider planning after recovery",
      ...boundary,
    });
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({
      error: { code: "resume_requires_new_run_after_planning_failure" },
    });
    expect(runtime.repository.getRunProjection(fixture.runId)).toMatchObject({
      status: "blocked",
      version: boundary.expectedRunVersion,
    });
    expect(database.prepare(`
      SELECT count(*) AS count FROM runtime_continuations WHERE run_id = ?
    `).get(fixture.runId)).toEqual({ count: 0 });

    database.prepare("UPDATE runs SET control_plane = 'legacy' WHERE id = ?").run(fixture.runId);
    const legacy = await mutate(base, fixture.runId, "resume", "resume-legacy-owned", {
      reason: "Do not cross the owning control plane",
      ...boundary,
    });
    expect(legacy.status).toBe(409);
    expect(await legacy.json()).toMatchObject({ error: { code: "control_plane_control_plane_mismatch" } });
  });

  test("HTTP mutation routes keep every legacy-owned Guided decision and run read-only", async () => {
    for (const command of ["approve", "skip", "reject", "manual-result"] as const) {
      const database = createDatabaseConnection({ filename: ":memory:" });
      databases.push(database);
      migrateDatabase(database);
      const fixture = seedGuidedWaitingRun(database, `legacy-${command}`);
      const { base } = await application(database, `legacy-${command}-worker`);
      database.prepare("UPDATE runs SET control_plane = 'legacy' WHERE id = ?").run(fixture.runId);
      const decisionId = `decision-legacy-${command}`;
      const response = await fetch(`${base}/api/v2/guided-decisions/${decisionId}/${command}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `legacy-${command}-boundary`,
        },
        body: JSON.stringify({
          expectedFingerprint: "b".repeat(64),
          expectedParameters: {},
          reason: "Do not cross the owning control plane",
        }),
      });
      expect(response.status, command).toBe(409);
      expect(await response.json(), command).toMatchObject({
        error: { code: "control_plane_control_plane_mismatch" },
      });
      expect(database.prepare("SELECT status FROM guided_decisions WHERE id = ?").get(decisionId))
        .toEqual({ status: "pending" });
      expect(database.prepare("SELECT COUNT(*) AS count FROM actions WHERE run_id = ?").get(fixture.runId))
        .toEqual({ count: 0 });
    }

    const database = createDatabaseConnection({ filename: ":memory:" });
    databases.push(database);
    migrateDatabase(database);
    const fixture = seedGuidedWaitingRun(database, "legacy-cancel");
    const { base } = await application(database, "legacy-cancel-worker");
    database.prepare("UPDATE missions SET control_plane = 'legacy' WHERE id = ?").run(fixture.missionId);
    const cancelled = await fetch(`${base}/api/v2/runs/${fixture.runId}/cancel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "legacy-cancel-boundary",
      },
      body: JSON.stringify({ reason: "Do not cross the owning control plane" }),
    });
    expect(cancelled.status).toBe(409);
    expect(await cancelled.json()).toMatchObject({
      error: { code: "control_plane_control_plane_mismatch" },
    });
    expect(database.prepare("SELECT status FROM runs WHERE id = ?").get(fixture.runId))
      .toEqual({ status: "waiting_guided_decision" });
  });
});
