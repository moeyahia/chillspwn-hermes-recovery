import { afterEach, describe, expect, test } from "bun:test";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { CommandOsBoundedExecutionPort } from "../../app/CommandOsRuntimeAdapters";
import {
  createMissionRuntime,
  RuntimeRepository,
  type ExecutionResultSink,
  type MissionOutcomeEvaluatorPort,
  type MissionPlannerPort,
  type ResultAwareExecutionPort,
} from "../../command-runtime";
import { createDatabaseConnection, migrateDatabase, type SqliteDatabase } from "../../db";
import { EventRepository } from "../../events";
import { ActionRepository, CheckpointRepository, RunRepository } from "../../orchestration";
import { createOperationsRouter } from "../../routes/operationsRoutes";
import { fingerprintAction } from "../../supervisor";
import type { OperationsAccessPolicy } from "../types";

const NOW = "2026-07-15T15:00:00.000Z";
const LATER = "2026-07-15T15:01:00.000Z";
const CONTRACT_HASH = "a".repeat(64);
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function seed(database: SqliteDatabase, journey: "autonomous" | "guided" = "autonomous"): void {
  database.prepare(`
    INSERT INTO missions (
      id, name, objective, journey, status, authorization_status, engagement_id,
      created_by, created_at, updated_at
    ) VALUES ('mission-recovery', 'Recovery lab', 'Collect authorized evidence', ?,
      'active', 'verified', 'eng-recovery', 'operator:test', ?, ?)
  `).run(journey, NOW, NOW);
  database.prepare(`
    INSERT INTO mission_targets (
      id, mission_id, target, target_type, disposition, normalized_target, created_at
    ) VALUES ('target-recovery', 'mission-recovery', 'lab.internal', 'domain',
      'allowed', 'lab.internal', ?)
  `).run(NOW);
  let contractId: string | null = null;
  if (journey === "autonomous") {
    contractId = "contract-recovery";
    database.prepare(`
      INSERT INTO mission_contracts (
        id, mission_id, version, state, contract_hash, authorization_json,
        action_policy_json, budgets_json, safe_stop_json, deliverables_json,
        confirmed_by, confirmed_at, created_at
      ) VALUES (?, 'mission-recovery', 1, 'confirmed', ?, '{}', ?, '{}', '{}', '[]',
        'operator:test', ?, ?)
    `).run(contractId, CONTRACT_HASH, JSON.stringify({
      allowedActionClasses: ["analysis", "network"],
      prohibitedActionClasses: [],
      destructivePolicy: "prohibited",
      providerPolicy: "automatic_enforcing_only",
      specialistAgentIds: ["specialist-current", "specialist-target", "specialist-offline"],
    }), NOW, NOW);
  }
  const status = journey === "guided" ? "waiting_guided_decision" : "blocked";
  database.prepare(`
    INSERT INTO runs (
      id, mission_id, journey, status, contract_id, current_plan_id,
      current_step_id, current_owner_id, budget_json, budget_usage_json,
      status_reason, next_action_summary, started_at, created_at, updated_at, version
    ) VALUES ('run-recovery', 'mission-recovery', ?, ?, ?, NULL, NULL,
      'specialist-current', ?, '{}', 'A bounded recovery decision is required',
      'Choose one enforced recovery action', ?, ?, ?, 1)
  `).run(journey, status, contractId, JSON.stringify({
    retries: 2,
    replans: 2,
    providerTokens: 500,
    estimatedCost: 5,
  }), NOW, NOW, NOW);
  const agent = database.prepare(`
    INSERT INTO agents (
      id, role, display_name, status, version, last_heartbeat_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '2.1', ?, ?, ?)
  `);
  agent.run("specialist-current", "reconnaissance", "Current specialist", "available", NOW, NOW, NOW);
  agent.run("specialist-target", "reconnaissance", "Replacement specialist", "available", NOW, NOW, NOW);
  agent.run("specialist-unsigned", "reconnaissance", "Unsigned specialist", "available", NOW, NOW, NOW);
  agent.run("specialist-offline", "reconnaissance", "Offline specialist", "offline", NOW, NOW, NOW);
  agent.run("Chillspwn", "commander", "Commander", "available", NOW, NOW, NOW);
  for (const id of ["specialist-current", "specialist-target", "specialist-unsigned", "specialist-offline", "Chillspwn"]) {
    database.prepare(`
      INSERT INTO agent_capabilities (agent_id, capability, source, enabled, metadata_json)
      VALUES (?, 'network.recon', 'live-route-attestation', 1, ?)
    `).run(id, JSON.stringify({
      attestedAt: NOW,
      validUntil: "2026-07-15T16:00:00.000Z",
      providerIds: ["grok-acp", "alternate-oauth"],
    }));
  }
  database.prepare(`
    INSERT INTO plans (
      id, run_id, version, status, strategy_summary, rationale_summary,
      plan_hash, created_by, created_at, activated_at
    ) VALUES ('plan-recovery', 'run-recovery', 1, 'active',
      'Repeat the original provider analysis', 'Original bounded plan', ?, 'planner', ?, ?)
  `).run("b".repeat(64), NOW, NOW);
  database.prepare(`
    INSERT INTO plan_steps (
      id, plan_id, run_id, ordinal, phase, title, objective, status,
      action_class, risk_class, assigned_agent_id, created_at, updated_at
    ) VALUES ('step-recovery', 'plan-recovery', 'run-recovery', 0, 'reconnaissance',
      'Analyze the approved target', 'Collect a bounded specialist assessment', ?,
      'network', 'low', 'specialist-current', ?, ?)
  `).run(journey === "guided" ? "waiting_guided_decision" : "blocked", NOW, NOW);
  database.prepare(`
    INSERT INTO assignments (
      id, run_id, step_id, agent_id, status, created_at, updated_at
    ) VALUES ('assignment-recovery', 'run-recovery', 'step-recovery',
      'specialist-current', 'blocked', ?, ?)
  `).run(NOW, NOW);
  database.prepare(`
    UPDATE runs SET current_plan_id = 'plan-recovery', current_step_id = 'step-recovery'
    WHERE id = 'run-recovery'
  `).run();
  database.prepare(`
    INSERT INTO mission_constraints (
      id, mission_id, constraint_type, value_json, source, created_at
    ) VALUES ('represented-recovery', 'mission-recovery', 'represented_action', ?,
      'step-recovery', ?)
  `).run(JSON.stringify({ action: {
    actionType: "analysis",
    actionClass: "network",
    target: "lab.internal",
    arguments: { question: "Assess the approved evidence gap" },
    intentSummary: "Assess the approved target",
    kind: "provider_turn",
    idempotent: true,
    destructive: false,
  } }), NOW);
  if (journey === "guided") {
    const representedIntent = new RuntimeRepository(database).getStepIntent("step-recovery");
    database.prepare(`
      INSERT INTO guided_decisions (
        id, mission_id, run_id, step_id, requested_action_fingerprint,
        requested_parameters_json, rationale, risk_class, reversibility,
        status, expires_at, created_at
      ) VALUES ('decision-recovery', 'mission-recovery', 'run-recovery',
        'step-recovery', ?, ?, 'Run the represented bounded analysis',
        'low', 'Read-only', 'pending', '2026-07-16T15:00:00.000Z', ?)
    `).run(fingerprintAction(representedIntent).hash, JSON.stringify(representedIntent), NOW);
  }
  database.prepare(`
    INSERT INTO actions (
      id, mission_id, run_id, step_id, assignment_id, action_type, action_class,
      fingerprint, normalized_arguments_json, scoped_target, status, intent_summary,
      result_summary, error_category, retry_count, contract_id, ended_at, created_at, updated_at
    ) VALUES ('action-failed', 'mission-recovery', 'run-recovery', 'step-recovery',
      'assignment-recovery', 'analysis', 'network', ?, ?, 'lab.internal', 'timed_out',
      'Assess the approved target', 'Provider timed out without new evidence', 'timeout',
      0, ?, ?, ?, ?)
  `).run(
    "c".repeat(64),
    JSON.stringify({ orchestration: { kind: "provider_turn", idempotent: true, destructive: false }, input: {} }),
    contractId,
    NOW,
    NOW,
    NOW,
  );
  for (const [id, metrics] of [
    ["grok-acp", { authenticated: true, callable: true, attestedAt: NOW, expiresAt: "2026-07-15T16:00:00.000Z", supportsGuided: true, enforcesAutonomousBoundary: true, reportsExactTokenUsage: true, reportsExactCostUsage: true }],
    ["alternate-oauth", { authenticated: true, callable: true, attestedAt: NOW, expiresAt: "2026-07-15T16:00:00.000Z", supportsGuided: true, enforcesAutonomousBoundary: true, reportsExactTokenUsage: true, reportsExactCostUsage: true }],
    ["bad-oauth", { authenticated: true, callable: true, attestedAt: NOW, expiresAt: "2026-07-15T16:00:00.000Z", supportsGuided: true, enforcesAutonomousBoundary: true, reportsExactTokenUsage: false, reportsExactCostUsage: false }],
  ] as const) {
    database.prepare(`
      INSERT INTO health_snapshots (
        id, component_type, component_id, status, metrics_json, captured_at
      ) VALUES (?, 'provider', ?, 'healthy', ?, ?)
    `).run(`health-${id}`, id, JSON.stringify(metrics), NOW);
  }
  const event = new EventRepository(database).append({
    missionId: "mission-recovery",
    runId: "run-recovery",
    journey,
    eventType: "run.recovery_blocked",
    actorType: "system",
    summary: "Recovery stopped at a durable exact-work boundary",
    payload: { reason: "timeout" },
  });
  const actions = new ActionRepository(database);
  new CheckpointRepository(database, actions).create({
    run: new RunRepository(database).get("run-recovery"),
    eventSequence: event.sequence,
    now: NOW,
    inFlightClassification: "safe_no_in_flight_action",
  });
}

function openProviderCircuit(database: SqliteDatabase, providerId: string, now = LATER): void {
  const actions = new ActionRepository(database);
  const checkpoints = new CheckpointRepository(database, actions);
  const stored = new RunRepository(database).get("run-recovery");
  const run = { ...stored, control: checkpoints.restoreControl("run-recovery", stored.control) };
  const event = new EventRepository(database).append({
    missionId: "mission-recovery",
    runId: "run-recovery",
    journey: run.run.journey,
    eventType: "provider.circuit_opened",
    actorType: "system",
    summary: `${providerId} circuit opened after repeated transient failures`,
    payload: { providerId },
  });
  checkpoints.create({
    run: {
      ...run,
      control: {
        ...run.control,
        circuits: {
          ...run.control.circuits,
          [`provider:${providerId}`]: {
            state: "open",
            consecutiveFailures: 3,
            halfOpenSuccesses: 0,
            halfOpenInFlight: 0,
            openedAt: Date.parse(now),
          },
        },
      },
    },
    eventSequence: event.sequence,
    now,
  });
}

async function application(journey: "autonomous" | "guided" = "autonomous") {
  const database = createDatabaseConnection({ filename: ":memory:" });
  migrateDatabase(database);
  seed(database, journey);
  const app = express();
  app.use(express.json({ limit: "128kb" }));
  app.use(createOperationsRouter({
    database,
    clock: () => new Date(LATER),
    providerRouteIds: ["grok-acp", "alternate-oauth", "bad-oauth"],
    resolveActor: (request) => ({
      id: "operator:test",
      type: request.get("X-Test-Role") === "reviewer" ? "reviewer" : "admin",
    }),
    resolveAccess: (request): OperationsAccessPolicy => ({
      maximumSensitivity: "restricted",
      engagementIds: request.get("X-Test-Scope") === "other" ? ["eng-other"] : ["eng-recovery"],
      missionIds: request.get("X-Test-Scope") === "other" ? [] : ["mission-recovery"],
      canManageRecovery: request.get("X-Test-Recovery") !== "deny",
    }),
  }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  return { database, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

async function json(response: Response): Promise<any> {
  return response.json() as Promise<any>;
}

function exact(recovery: any) {
  return {
    expectedRunVersion: recovery.run.version,
    expectedPlanId: recovery.boundary.planId,
    expectedPlanVersion: recovery.boundary.planVersion,
    expectedStepId: recovery.boundary.stepId,
    expectedAssignmentId: recovery.boundary.assignmentId,
    expectedCheckpointId: recovery.checkpoint.id,
    expectedCheckpointStateHash: recovery.checkpoint.stateHash,
    expectedCheckpointEventSequence: recovery.checkpoint.eventSequence,
  };
}

async function recovery(url: string): Promise<any> {
  return json(await fetch(`${url}/api/v2/operations/runs/run-recovery/recovery`));
}

async function mutate(url: string, suffix: string, body: unknown, key: string, headers: Record<string, string> = {}) {
  return fetch(`${url}/api/v2/operations/runs/run-recovery/recovery/${suffix}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key, ...headers },
    body: JSON.stringify(body),
  });
}

async function waitFor(check: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

describe("enforced recovery mutations", () => {
  test("projects only executable controls and queues one idempotent bounded replan through the supervisor", async () => {
    const { database, url } = await application();
    try {
      const before = await recovery(url);
      expect(before.boundary).toMatchObject({
        planId: "plan-recovery",
        planVersion: 1,
        stepId: "step-recovery",
        assignmentId: "assignment-recovery",
        agentId: "specialist-current",
        actionKind: "provider_turn",
      });
      expect(before.reassignmentCandidates).toEqual([
        expect.objectContaining({ agentId: "specialist-target", capabilities: ["network.recon"] }),
      ]);
      expect(before.providerCandidates).toEqual([
        expect.objectContaining({ providerId: "alternate-oauth", enforcesAutonomousBoundary: true }),
      ]);
      expect(Object.fromEntries(before.actions.map((item: any) => [item.kind, item.command]))).toMatchObject({
        replan: "replan",
        reassign: "reassign",
        change_provider: "change_provider",
      });

      const request = {
        ...exact(before),
        strategyReason: "Use the independently healthy alternate path and compare its evidence delta",
      };
      const response = await mutate(url, "replan", request, "replan-idempotency-0001");
      expect(response.status).toBe(200);
      const result = await json(response);
      expect(result).toMatchObject({
        mutation: { kind: "replan", eventId: expect.any(String), checkpointId: expect.any(String), continuationId: expect.any(String) },
        run: { id: "run-recovery", journey: "autonomous", status: "recovering", version: 3 },
      });

      const replay = await mutate(url, "replan", request, "replan-idempotency-0001");
      expect(replay.status).toBe(200);
      expect(await json(replay)).toEqual(result);
      const stale = await mutate(url, "replan", request, "replan-idempotency-0002");
      expect(stale.status).toBe(409);
      expect(await json(stale)).toMatchObject({ error: { code: "operations_state_conflict" } });

      expect(database.prepare(`
        SELECT status, version, replan_count, contract_id, contract_version_bound, contract_hash_bound
        FROM runs WHERE id = 'run-recovery'
      `).get()).toEqual({
        status: "recovering",
        version: 3,
        replan_count: 0,
        contract_id: "contract-recovery",
        contract_version_bound: 1,
        contract_hash_bound: CONTRACT_HASH,
      });
      expect(database.prepare(`
        SELECT kind, status FROM runtime_continuations WHERE run_id = 'run-recovery'
      `).get()).toEqual({ kind: "resume_recovery_pending", status: "pending" });
      expect(database.prepare(`
        SELECT count(*) AS count FROM events
        WHERE run_id = 'run-recovery' AND event_type = 'run.state_changed'
      `).get()).toEqual({ count: 1 });
      expect(database.prepare(`
        SELECT count(*) AS count FROM events
        WHERE run_id = 'run-recovery' AND event_type = 'run.operator_replan_requested'
      `).get()).toEqual({ count: 1 });
      expect(database.prepare(`
        SELECT count(*) AS count FROM audit_records
        WHERE run_id = 'run-recovery' AND action = 'run.replan_requested'
      `).get()).toEqual({ count: 1 });
      expect(database.prepare(`SELECT count(*) AS count FROM checkpoints WHERE run_id = 'run-recovery'`).get())
        .toEqual({ count: 2 });
      expect(database.prepare(`SELECT count(*) AS count FROM actions WHERE status IN ('queued', 'running')`).get())
        .toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  test("denies unauthorized, out-of-scope, exhausted, equivalent, and stale replan requests", async () => {
    const reviewer = await application();
    try {
      const view = await recovery(reviewer.url);
      const request = { ...exact(view), strategyReason: "Use a materially different verified recovery route" };
      const denied = await mutate(reviewer.url, "replan", request, "replan-reviewer-0001", { "X-Test-Role": "reviewer" });
      expect(denied.status).toBe(403);
      const outOfScope = await mutate(reviewer.url, "replan", request, "replan-scope-000001", { "X-Test-Scope": "other" });
      expect(outOfScope.status).toBe(404);
      const permission = await mutate(reviewer.url, "replan", request, "replan-permission-01", { "X-Test-Recovery": "deny" });
      expect(permission.status).toBe(403);
    } finally {
      reviewer.database.close();
    }

    const exhausted = await application();
    try {
      exhausted.database.prepare(`UPDATE runs SET replan_count = 2 WHERE id = 'run-recovery'`).run();
      const view = await recovery(exhausted.url);
      const response = await mutate(exhausted.url, "replan", {
        ...exact(view),
        strategyReason: "Use a materially different verified recovery route",
      }, "replan-exhausted-01");
      expect(response.status).toBe(409);
      expect(await json(response)).toMatchObject({ error: { code: "replan_budget_exhausted" } });
    } finally {
      exhausted.database.close();
    }

    const equivalent = await application();
    try {
      const view = await recovery(equivalent.url);
      const response = await mutate(equivalent.url, "replan", {
        ...exact(view),
        strategyReason: "Repeat the original provider analysis",
      }, "replan-equivalent-1");
      expect(response.status).toBe(409);
      expect(await json(response)).toMatchObject({ error: { code: "equivalent_replan" } });
    } finally {
      equivalent.database.close();
    }
  });

  test("the replan continuation consumes the bounded budget and dispatches only the newly persisted in-contract plan", async () => {
    const { database, url } = await application();
    const dispatched: Array<{ id: string; stepId: string; kind: string }> = [];
    let sink: ExecutionResultSink | undefined;
    let plannerReason = "";
    const execution: ResultAwareExecutionPort = {
      bindResultSink(next) { sink = next; return () => { if (sink === next) sink = undefined; }; },
      async dispatch(action) { dispatched.push({ id: action.id, stepId: action.stepId, kind: action.kind }); },
      async resume(action) { dispatched.push({ id: action.id, stepId: action.stepId, kind: action.kind }); },
      async cancelRun() {},
    };
    const planner: MissionPlannerPort = {
      async plan(input) {
        plannerReason = input.rejectionReason ?? "";
        return {
          strategySummary: "Use an independent alternate specialist analysis and verify its evidence delta",
          rationaleSummary: "The prior provider attempt timed out without evidence",
          providerUsage: {
            providerTurns: 1,
            providerTokens: 12,
            estimatedCost: 0.1,
            exactTokenUsage: true,
            exactCostUsage: true,
          },
          steps: [{
            phase: "reconnaissance",
            title: "Run the alternate bounded analysis",
            objective: "Produce one independent assessment of the approved target",
            explanation: "This changes the strategy without expanding target or action scope.",
            rationale: "An alternate analysis path may make progress after the prior timeout.",
            successCriteria: ["A specialist result is retained"],
            assignedAgentId: "specialist-current",
            riskClass: "low",
            reversibility: "Read-only",
            action: {
              actionType: "analysis",
              actionClass: "network",
              target: "lab.internal",
              arguments: { question: "Assess the authorized evidence gap using an independent method" },
              intentSummary: "Run the alternate analysis of the approved target",
              kind: "provider_turn",
              idempotent: true,
              destructive: false,
            },
          }],
        };
      },
    };
    const evaluator: MissionOutcomeEvaluatorPort = {
      async evaluate() { return { success: false, summary: "Not reached", criteria: [] }; },
    };
    let runtime: ReturnType<typeof createMissionRuntime> | undefined;
    try {
      const view = await recovery(url);
      const mutation = await mutate(url, "replan", {
        ...exact(view),
        strategyReason: "Use a verified alternate analysis path with an independent evidence delta",
      }, "replan-runtime-0001");
      expect(mutation.status).toBe(200);
      // Construct a fresh runtime only after the mutation committed. This is
      // the restart/replay boundary: no in-memory request state is available.
      runtime = createMissionRuntime({
        database,
        planner,
        outcomeEvaluator: evaluator,
        execution,
        workerId: "recovery-runtime-test",
        now: () => new Date("2026-07-15T15:02:00.000Z"),
        leaseTtlMs: 10_000,
        scanIntervalMs: 60_000,
      });
      const replayed = await runtime.replayContinuations("run-recovery", ["resume_recovery_pending"]);
      if (replayed !== 1) {
        const continuation = database.prepare(`SELECT status, attempt_count, last_error FROM runtime_continuations`).get();
        const run = database.prepare(`SELECT status, status_reason, version, replan_count FROM runs WHERE id = 'run-recovery'`).get();
        throw new Error(`replan continuation did not complete: ${JSON.stringify({ replayed, continuation, run })}`);
      }
      expect(plannerReason).toContain("verified alternate analysis path");
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]).toMatchObject({ kind: "provider_turn" });
      expect(dispatched[0]?.stepId).not.toBe("step-recovery");
      expect(database.prepare(`
        SELECT status, replan_count,
          json_extract(budget_usage_json, '$.replans') AS replans
        FROM runs WHERE id = 'run-recovery'
      `).get()).toEqual({ status: "running", replan_count: 1, replans: 1 });
      expect(database.prepare(`
        SELECT version, status FROM plans WHERE run_id = 'run-recovery' ORDER BY version
      `).all()).toEqual([{ version: 1, status: "superseded" }, { version: 2, status: "active" }]);
      expect(database.prepare(`
        SELECT status FROM runtime_continuations
        WHERE run_id = 'run-recovery' AND kind = 'resume_recovery_pending'
      `).get()).toEqual({ status: "completed" });
      expect(database.prepare(`
        SELECT count(*) AS count FROM events
        WHERE run_id = 'run-recovery' AND payload_json LIKE '%waiting_guided_decision%'
      `).get()).toEqual({ count: 0 });
    } finally {
      await runtime?.stop();
      database.close();
    }
  });

  test("reassigns only the exact stopped assignment to a healthy signed capable specialist without starting work", async () => {
    const { database, url } = await application();
    try {
      const view = await recovery(url);
      const base = { ...exact(view), capability: "network.recon", reason: "Move the stopped analysis to the healthy backup specialist" };
      const unsigned = await mutate(url, "reassign", {
        ...base,
        targetAgentId: "specialist-unsigned",
      }, "reassign-unsigned-01");
      expect(unsigned.status).toBe(409);
      expect(await json(unsigned)).toMatchObject({ error: { code: "autonomous_specialist_not_signed" } });
      const commander = await mutate(url, "reassign", {
        ...base,
        targetAgentId: "Chillspwn",
      }, "reassign-commander-1");
      expect(commander.status).toBe(409);
      expect(await json(commander)).toMatchObject({ error: { code: "reassignment_specialist_incompatible" } });
      const offline = await mutate(url, "reassign", {
        ...base,
        targetAgentId: "specialist-offline",
      }, "reassign-offline-01");
      expect(offline.status).toBe(409);

      const response = await mutate(url, "reassign", {
        ...base,
        targetAgentId: "specialist-target",
      }, "reassign-success-01");
      expect(response.status).toBe(200);
      const result = await json(response);
      if (!result?.run?.assignmentId) throw new Error(`reassignment response missing assignment: ${JSON.stringify(result)}`);
      const replacementAssignmentId = String(result.run.assignmentId);
      expect(result).toMatchObject({
        mutation: { kind: "reassign", agentId: "specialist-target", continuationId: null },
        run: { status: "blocked", version: 2 },
      });
      expect(replacementAssignmentId).not.toBe("assignment-recovery");
      const replay = await mutate(url, "reassign", {
        ...base,
        targetAgentId: "specialist-target",
      }, "reassign-success-01");
      expect(await json(replay)).toEqual(result);
      expect(database.prepare(`
        SELECT agent_id, status, lease_owner FROM assignments WHERE id = 'assignment-recovery'
      `).get()).toEqual({ agent_id: "specialist-current", status: "cancelled", lease_owner: null });
      const replacementRow = database.prepare(`
        SELECT agent_id, status, lease_owner FROM assignments WHERE id = ?
      `).get(replacementAssignmentId);
      expect(replacementRow).toEqual({ agent_id: "specialist-target", status: "queued", lease_owner: null });
      expect(database.prepare(`
        SELECT a.id, a.assignment_id, ass.agent_id
        FROM actions a JOIN assignments ass ON ass.id = a.assignment_id
        WHERE a.id = 'action-failed'
      `).get()).toEqual({
        id: "action-failed",
        assignment_id: "assignment-recovery",
        agent_id: "specialist-current",
      });
      expect(database.prepare(`
        SELECT assigned_agent_id, status FROM plan_steps WHERE id = 'step-recovery'
      `).get()).toEqual({ assigned_agent_id: "specialist-target", status: "ready" });
      expect(database.prepare(`SELECT status, current_owner_id FROM runs WHERE id = 'run-recovery'`).get())
        .toEqual({ status: "blocked", current_owner_id: "specialist-target" });
      expect(database.prepare(`SELECT count(*) AS count FROM runtime_continuations`).get()).toEqual({ count: 0 });
      expect(database.prepare(`SELECT count(*) AS count FROM actions WHERE status IN ('queued', 'running')`).get())
        .toEqual({ count: 0 });
      expect(database.prepare(`
        SELECT count(*) AS count FROM events WHERE event_type = 'run.specialist_reassigned'
      `).get()).toEqual({ count: 1 });
      const stale = await mutate(url, "reassign", {
        ...base,
        targetAgentId: "specialist-current",
      }, "reassign-stale-0001");
      expect(stale.status).toBe(409);
    } finally {
      database.close();
    }
  });

  test("excludes and rejects an available specialist whose canonical heartbeat is stale", async () => {
    const { database, url } = await application();
    try {
      database.prepare(`
        UPDATE agents SET last_heartbeat_at = '2026-07-15T14:00:00.000Z'
        WHERE id = 'specialist-target'
      `).run();
      const view = await recovery(url);
      expect(view.reassignmentCandidates.map((item: any) => item.agentId)).not.toContain("specialist-target");
      const response = await mutate(url, "reassign", {
        ...exact(view),
        targetAgentId: "specialist-target",
        capability: "network.recon",
        reason: "Attempt the stale specialist only to verify the fail-closed boundary",
      }, "reassign-stale-heartbeat");
      expect(response.status).toBe(409);
      expect(await json(response)).toMatchObject({ error: { code: "reassignment_specialist_incompatible" } });
      expect(database.prepare(`SELECT agent_id, status FROM assignments WHERE id = 'assignment-recovery'`).get())
        .toEqual({ agent_id: "specialist-current", status: "blocked" });
    } finally {
      database.close();
    }
  });

  test("excludes and rejects an available specialist with no genuine worker heartbeat", async () => {
    const { database, url } = await application();
    try {
      database.prepare(`
        UPDATE agents SET last_heartbeat_at = NULL WHERE id = 'specialist-target'
      `).run();
      const view = await recovery(url);
      expect(view.reassignmentCandidates.map((item: any) => item.agentId)).not.toContain("specialist-target");
      const response = await mutate(url, "reassign", {
        ...exact(view),
        targetAgentId: "specialist-target",
        capability: "network.recon",
        reason: "Attempt the heartbeat-free specialist only to verify the fail-closed boundary",
      }, "reassign-missing-heartbeat");
      expect(response.status).toBe(409);
      expect(await json(response)).toMatchObject({ error: { code: "reassignment_specialist_incompatible" } });
      expect(database.prepare(`SELECT agent_id, status FROM assignments WHERE id = 'assignment-recovery'`).get())
        .toEqual({ agent_id: "specialist-current", status: "blocked" });
    } finally {
      database.close();
    }
  });

  test("reassignment invalidates an older assignment-scoped provider route instead of silently falling back", async () => {
    const { database, url } = await application();
    try {
      const initial = await recovery(url);
      const selected = await mutate(url, "provider", {
        ...exact(initial),
        providerId: "alternate-oauth",
        reason: "Select the alternate route for the original exact assignment",
      }, "provider-before-reassign");
      expect(selected.status).toBe(200);
      const beforeReassign = await recovery(url);
      const reassigned = await mutate(url, "reassign", {
        ...exact(beforeReassign),
        targetAgentId: "specialist-target",
        capability: "network.recon",
        reason: "Move the stopped step to the healthy signed backup specialist",
      }, "reassign-after-provider");
      expect(reassigned.status).toBe(200);
      const after = await recovery(url);
      expect(after.boundary.assignmentId).not.toBe("assignment-recovery");
      expect(after.run.nextAction).toContain("Select a provider again");
      expect(after.providerCandidates.map((item: any) => item.providerId)).toContain("alternate-oauth");
      const tombstone = database.prepare(`
        SELECT value_json FROM settings WHERE key LIKE 'command_os.recovery.provider_route.%'
      `).get() as { value_json: string };
      expect(JSON.parse(tombstone.value_json)).toMatchObject({
        invalidated: true,
        previousProviderId: "alternate-oauth",
        previousVersion: 1,
        assignmentId: "assignment-recovery",
        reason: "assignment_changed",
      });

      database.prepare(`UPDATE runs SET status = 'running' WHERE id = 'run-recovery'`).run();
      database.prepare(`UPDATE plan_steps SET status = 'running' WHERE id = 'step-recovery'`).run();
      database.prepare(`UPDATE assignments SET status = 'active' WHERE id = ?`).run(after.boundary.assignmentId);
      const action = new ActionRepository(database).create({
        intent: {
          missionId: "mission-recovery",
          runId: "run-recovery",
          stepId: "step-recovery",
          planVersion: 1,
          assignmentId: after.boundary.assignmentId,
          actionType: "analysis",
          actionClass: "network",
          target: "lab.internal",
          intentSummary: "Verify stale assignment-scoped routing fails closed",
          kind: "provider_turn",
          idempotent: true,
          destructive: false,
          arguments: { question: "Verify the fail-closed routing boundary" },
        },
        fingerprint: "provider-stale-assignment-action",
        contractId: "contract-recovery",
        now: LATER,
      });
      let defaultCalls = 0;
      let alternateCalls = 0;
      let resolveResult!: (value: any) => void;
      const received = new Promise<any>((resolve) => { resolveResult = resolve; });
      const port = new CommandOsBoundedExecutionPort({
        database,
        now: () => new Date("2026-07-15T15:02:00.000Z"),
        providerHealthMaxAgeMs: 180_000,
        inventory: () => [],
        callGrok: async () => { defaultCalls += 1; return "default must not run"; },
        providerRoutes: [{
          id: "alternate-oauth",
          provider: "alternate-oauth",
          model: "alternate-expert",
          call: async () => { alternateCalls += 1; return "alternate must be reselected"; },
        }],
        executeMcp: async () => { throw new Error("MCP execution must not be reached"); },
      });
      port.bindResultSink({
        async acceptExecutionResult(result) {
          resolveResult(result);
          return { accepted: true, duplicate: false, actionId: result.actionId, runId: result.runId, runState: "blocked", nextAction: null };
        },
      });
      await port.dispatch(action, new AbortController().signal);
      expect(await received).toMatchObject({ success: false, failure: { code: "provider_route_binding_invalid" } });
      expect(defaultCalls).toBe(0);
      expect(alternateCalls).toBe(0);
    } finally {
      database.close();
    }
  });

  test("public resume dispatches one parent-linked successor on the replacement assignment and selected provider across restart", async () => {
    const { database, url } = await application();
    let runtime: ReturnType<typeof createMissionRuntime> | undefined;
    let restarted: ReturnType<typeof createMissionRuntime> | undefined;
    try {
      const initial = await recovery(url);
      const initiallySelected = await mutate(url, "provider", {
        ...exact(initial),
        providerId: "alternate-oauth",
        reason: "Select the healthy enforcing route for the original assignment",
      }, "resume-provider-first");
      expect(initiallySelected.status).toBe(200);
      const selectedBoundary = await recovery(url);
      const reassigned = await mutate(url, "reassign", {
        ...exact(selectedBoundary),
        targetAgentId: "specialist-target",
        capability: "network.recon",
        reason: "Move the stopped retry to the healthy signed specialist",
      }, "resume-reassign-second");
      expect(reassigned.status).toBe(200);
      const replacement = await recovery(url);
      const replacementAssignmentId = replacement.boundary.assignmentId;
      const selected = await mutate(url, "provider", {
        ...exact(replacement),
        providerId: "alternate-oauth",
        reason: "Reselect the same healthy route for the replacement assignment",
      }, "resume-provider-reselected");
      expect(selected.status).toBe(200);
      expect(await json(selected)).toMatchObject({
        mutation: { providerId: "alternate-oauth", providerRouteVersion: 2 },
      });

      let plannerCalls = 0;
      let defaultCalls = 0;
      let alternateCalls = 0;
      const execution = new CommandOsBoundedExecutionPort({
        database,
        now: () => new Date("2026-07-15T15:02:00.000Z"),
        providerHealthMaxAgeMs: 180_000,
        inventory: () => [],
        callGrok: async () => { defaultCalls += 1; return "default route must not be used"; },
        providerRoutes: [{
          id: "alternate-oauth",
          provider: "alternate-oauth",
          model: "alternate-expert",
          call: async () => {
            alternateCalls += 1;
            return {
              text: "The replacement specialist produced one bounded verified assessment",
              usage: { inputTokens: 4, outputTokens: 4, providerTokens: 8, estimatedCost: 0.1 },
            };
          },
        }],
        executeMcp: async () => { throw new Error("MCP execution must not be reached"); },
      });
      runtime = createMissionRuntime({
        database,
        execution,
        planner: { async plan() { plannerCalls += 1; throw new Error("Exact recovery resume must not replan"); } },
        outcomeEvaluator: { async evaluate() { return { success: false, summary: "No final evaluator result required", criteria: [] }; } },
        workerId: "recovery-resume-runtime",
        now: () => new Date("2026-07-15T15:02:00.000Z"),
        leaseTtlMs: 10_000,
        scanIntervalMs: 60_000,
      });
      runtime.resumeRun("run-recovery", "operator:test", "Resume the exact reassigned provider retry");
      await waitFor(() => alternateCalls === 1, "selected provider dispatch");
      await waitFor(() => Boolean(database.prepare(`
        SELECT 1 FROM actions WHERE parent_action_id = 'action-failed' AND status = 'succeeded'
      `).get()), "parent-linked successor completion");
      const successor = database.prepare(`
        SELECT parent_action_id, assignment_id, status FROM actions
        WHERE parent_action_id = 'action-failed'
      `).get();
      expect(successor).toEqual({
        parent_action_id: "action-failed",
        assignment_id: replacementAssignmentId,
        status: "succeeded",
      });
      expect(database.prepare(`
        SELECT provider, model, status FROM provider_turns ORDER BY started_at DESC, id DESC LIMIT 1
      `).get()).toEqual({ provider: "alternate-oauth", model: "alternate-expert", status: "completed" });
      expect(defaultCalls).toBe(0);
      expect(alternateCalls).toBe(1);
      expect(plannerCalls).toBe(0);
      await waitFor(() => Boolean(database.prepare(`
        SELECT 1 FROM runtime_continuations
        WHERE kind = 'autonomous_retry_to_dispatch' AND source_id = 'action-failed' AND status = 'completed'
      `).get()), "retry continuation completion");
      await runtime.stop();
      runtime = undefined;

      const actionsBeforeRestart = (database.prepare(`SELECT count(*) AS count FROM actions WHERE parent_action_id = 'action-failed'`).get() as { count: number }).count;
      const turnsBeforeRestart = (database.prepare(`SELECT count(*) AS count FROM provider_turns`).get() as { count: number }).count;
      let restartedAlternateCalls = 0;
      restarted = createMissionRuntime({
        database,
        execution: new CommandOsBoundedExecutionPort({
          database,
          now: () => new Date("2026-07-15T15:03:00.000Z"),
          providerHealthMaxAgeMs: 240_000,
          inventory: () => [],
          callGrok: async () => "default must not run after restart",
          providerRoutes: [{
            id: "alternate-oauth",
            provider: "alternate-oauth",
            model: "alternate-expert",
            call: async () => { restartedAlternateCalls += 1; return "duplicate dispatch"; },
          }],
          executeMcp: async () => { throw new Error("MCP execution must not be reached"); },
        }),
        planner: { async plan() { plannerCalls += 1; throw new Error("Restart must not replan the completed retry"); } },
        outcomeEvaluator: { async evaluate() { return { success: false, summary: "No final evaluator result required", criteria: [] }; } },
        workerId: "recovery-restarted-runtime",
        now: () => new Date("2026-07-15T15:03:00.000Z"),
        leaseTtlMs: 10_000,
        scanIntervalMs: 60_000,
      });
      await restarted.start();
      expect((database.prepare(`SELECT count(*) AS count FROM actions WHERE parent_action_id = 'action-failed'`).get() as { count: number }).count)
        .toBe(actionsBeforeRestart);
      expect((database.prepare(`SELECT count(*) AS count FROM provider_turns`).get() as { count: number }).count)
        .toBe(turnsBeforeRestart);
      expect(restartedAlternateCalls).toBe(0);
    } finally {
      await runtime?.stop();
      await restarted?.stop();
      database.close();
    }
  });

  test("versions only callable healthy budget-compatible provider routes and never starts execution", async () => {
    const { database, url } = await application();
    try {
      const view = await recovery(url);
      const base = { ...exact(view), reason: "Use the healthy enforcing provider for this exact stopped analysis" };
      const unknown = await mutate(url, "provider", { ...base, providerId: "not-connected" }, "provider-unknown-01");
      expect(unknown.status).toBe(409);
      expect(await json(unknown)).toMatchObject({ error: { code: "provider_route_not_callable" } });
      const imprecise = await mutate(url, "provider", { ...base, providerId: "bad-oauth" }, "provider-imprecise-1");
      expect(imprecise.status).toBe(409);
      expect(await json(imprecise)).toMatchObject({ error: { code: "provider_route_budget_telemetry_missing" } });

      const response = await mutate(url, "provider", {
        ...base,
        providerId: "alternate-oauth",
      }, "provider-success-01");
      expect(response.status).toBe(200);
      const result = await json(response);
      expect(result).toMatchObject({
        mutation: { kind: "change_provider", providerId: "alternate-oauth", providerRouteVersion: 1, continuationId: null },
        run: { status: "blocked", version: 2, planId: "plan-recovery", stepId: "step-recovery" },
      });
      const setting = database.prepare(`
        SELECT value_json, version FROM settings
        WHERE key LIKE 'command_os.recovery.provider_route.%'
      `).get() as { value_json: string; version: number };
      expect(JSON.parse(setting.value_json)).toMatchObject({
        schemaVersion: 1,
        version: 1,
        runId: "run-recovery",
        journey: "autonomous",
        providerId: "alternate-oauth",
        planId: "plan-recovery",
        planVersion: 1,
        stepId: "step-recovery",
        assignmentId: "assignment-recovery",
        contract: { id: "contract-recovery", version: 1, hash: CONTRACT_HASH },
      });
      expect(setting.version).toBe(1);
      expect(database.prepare(`SELECT count(*) AS count FROM provider_turns`).get()).toEqual({ count: 0 });
      expect(database.prepare(`SELECT count(*) AS count FROM runtime_continuations`).get()).toEqual({ count: 0 });
      expect(database.prepare(`SELECT status FROM runs WHERE id = 'run-recovery'`).get()).toEqual({ status: "blocked" });
      expect(database.prepare(`
        SELECT count(*) AS count FROM events WHERE event_type = 'run.provider_route_changed'
      `).get()).toEqual({ count: 1 });
      expect(database.prepare(`
        SELECT count(*) AS count FROM audit_records WHERE action = 'run.provider_route_changed'
      `).get()).toEqual({ count: 1 });
      const replay = await mutate(url, "provider", {
        ...base,
        providerId: "alternate-oauth",
      }, "provider-success-01");
      expect(await json(replay)).toEqual(result);
    } finally {
      database.close();
    }
  });

  test("fails closed when the latest callable provider health attestation is stale", async () => {
    const { database, url } = await application();
    try {
      database.prepare(`
        UPDATE health_snapshots
        SET metrics_json = json_set(metrics_json, '$.attestedAt', '2026-07-15T14:00:00.000Z')
        WHERE component_type = 'provider' AND component_id = 'alternate-oauth'
      `).run();
      const view = await recovery(url);
      expect(view.providerCandidates.map((item: any) => item.providerId)).not.toContain("alternate-oauth");
      const response = await mutate(url, "provider", {
        ...exact(view),
        providerId: "alternate-oauth",
        reason: "Attempt the stale provider route only to verify the fail-closed boundary",
      }, "provider-stale-health");
      expect(response.status).toBe(409);
      expect(await json(response)).toMatchObject({
        error: { code: "provider_route_health_stale", retryable: true },
      });
      expect(database.prepare(`SELECT count(*) AS count FROM settings WHERE key LIKE 'command_os.recovery.provider_route.%'`).get())
        .toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  test("excludes and rejects a callable provider whose canonical circuit breaker is open", async () => {
    const { database, url } = await application();
    try {
      openProviderCircuit(database, "alternate-oauth");
      const view = await recovery(url);
      expect(view.providerCandidates.map((item: any) => item.providerId)).not.toContain("alternate-oauth");
      const response = await mutate(url, "provider", {
        ...exact(view),
        providerId: "alternate-oauth",
        reason: "Attempt the open-circuit route only to verify the fail-closed boundary",
      }, "provider-open-circuit");
      expect(response.status).toBe(409);
      expect(await json(response)).toMatchObject({
        error: { code: "provider_route_circuit_open", retryable: true },
      });
      expect(database.prepare(`SELECT count(*) AS count FROM settings WHERE key LIKE 'command_os.recovery.provider_route.%'`).get())
        .toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  test("Guided recovery routing requires the exact current represented decision fingerprint", async () => {
    const { database, url } = await application("guided");
    try {
      const view = await recovery(url);
      expect(view.run.journey).toBe("guided");
      expect(view.guidedDecision).toMatchObject({
        id: "decision-recovery",
        stepId: "step-recovery",
      });
      const actionFingerprint = view.guidedDecision.actionFingerprint;
      const base = {
        ...exact(view),
        providerId: "alternate-oauth",
        reason: "Select the compatible provider before deciding whether to run this exact step",
      };
      const unrepresented = await mutate(url, "provider", base, "guided-provider-missing");
      expect(unrepresented.status).toBe(409);
      expect(await json(unrepresented)).toMatchObject({ error: { code: "guided_recovery_not_represented" } });
      const stale = await mutate(url, "provider", {
        ...base,
        guidedDecisionId: "decision-recovery",
        expectedDecisionFingerprint: "e".repeat(64),
      }, "guided-provider-stale01");
      expect(stale.status).toBe(409);
      expect(await json(stale)).toMatchObject({ error: { code: "guided_recovery_not_represented" } });
      const response = await mutate(url, "provider", {
        ...base,
        guidedDecisionId: "decision-recovery",
        expectedDecisionFingerprint: actionFingerprint,
      }, "guided-provider-success");
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({
        mutation: { kind: "change_provider", providerId: "alternate-oauth" },
        run: { journey: "guided", status: "waiting_guided_decision" },
      });
      const binding = database.prepare(`
        SELECT value_json FROM settings WHERE key LIKE 'command_os.recovery.provider_route.%'
      `).get() as { value_json: string };
      expect(JSON.parse(binding.value_json)).toMatchObject({
        journey: "guided",
        guidedDecision: { id: "decision-recovery", fingerprint: actionFingerprint },
      });
      expect(database.prepare(`SELECT status FROM guided_decisions WHERE id = 'decision-recovery'`).get())
        .toEqual({ status: "pending" });
      expect(database.prepare(`SELECT count(*) AS count FROM actions WHERE status IN ('queued', 'running')`).get())
        .toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  test("Guided reassignment remains stopped behind the exact represented decision", async () => {
    const { database, url } = await application("guided");
    let runtime: ReturnType<typeof createMissionRuntime> | undefined;
    try {
      const view = await recovery(url);
      const actionFingerprint = view.guidedDecision.actionFingerprint;
      const base = {
        ...exact(view),
        targetAgentId: "specialist-target",
        capability: "network.recon",
        reason: "Move the represented Guided step to the healthy capable specialist",
      };
      const unrepresented = await mutate(url, "reassign", base, "guided-reassign-missing");
      expect(unrepresented.status).toBe(409);
      expect(await json(unrepresented)).toMatchObject({ error: { code: "guided_recovery_not_represented" } });
      const response = await mutate(url, "reassign", {
        ...base,
        guidedDecisionId: "decision-recovery",
        expectedDecisionFingerprint: actionFingerprint,
      }, "guided-reassign-exact");
      expect(response.status).toBe(200);
      const result = await json(response);
      expect(result).toMatchObject({
        mutation: { kind: "reassign", agentId: "specialist-target", continuationId: null },
        run: { journey: "guided", status: "waiting_guided_decision" },
      });
      expect(database.prepare(`SELECT status FROM guided_decisions WHERE id = 'decision-recovery'`).get())
        .toEqual({ status: "cancelled" });
      const replacementDecision = database.prepare(`
        SELECT id, requested_action_fingerprint, requested_parameters_json, status
        FROM guided_decisions
        WHERE run_id = 'run-recovery' AND status = 'pending'
        ORDER BY created_at DESC, id DESC LIMIT 1
      `).get() as {
        id: string;
        requested_action_fingerprint: string;
        requested_parameters_json: string;
        status: string;
      };
      expect(replacementDecision.id).not.toBe("decision-recovery");
      expect(replacementDecision.requested_action_fingerprint).toBe(actionFingerprint);
      expect(JSON.parse(replacementDecision.requested_parameters_json)).toMatchObject({
        assignmentId: result.run.assignmentId,
        stepId: "step-recovery",
      });
      expect(database.prepare(`SELECT status FROM assignments WHERE id = ?`).get(result.run.assignmentId))
        .toEqual({ status: "queued" });
      expect(database.prepare(`SELECT count(*) AS count FROM runtime_continuations`).get()).toEqual({ count: 0 });
      expect(database.prepare(`SELECT count(*) AS count FROM actions WHERE status IN ('queued', 'running')`).get())
        .toEqual({ count: 0 });

      const dispatched: string[] = [];
      const execution: ResultAwareExecutionPort = {
        bindResultSink() { return () => {}; },
        async dispatch(action) { dispatched.push(action.id); },
        async resume(action) { dispatched.push(action.id); },
        async cancelRun() {},
      };
      runtime = createMissionRuntime({
        database,
        execution,
        planner: { async plan() { throw new Error("Guided approval must not replan"); } },
        outcomeEvaluator: { async evaluate() { return { success: false, summary: "Not reached", criteria: [] }; } },
        workerId: "guided-reassignment-runtime",
        now: () => new Date("2026-07-15T15:02:00.000Z"),
        leaseTtlMs: 10_000,
        scanIntervalMs: 60_000,
      });
      await expect(runtime.approveGuidedDecision(
        "decision-recovery",
        "operator:test",
        "A superseded decision must fail closed",
      )).rejects.toMatchObject({ code: "guided_decision_not_pending" });
      database.prepare(`
        UPDATE guided_decisions
        SET requested_parameters_json = json_set(requested_parameters_json, '$.assignmentId', 'assignment-recovery')
        WHERE id = ?
      `).run(replacementDecision.id);
      await expect(runtime.approveGuidedDecision(
        replacementDecision.id,
        "operator:test",
        "A stale assignment parameter must fail closed",
      )).rejects.toMatchObject({ code: "guided_action_changed" });
      database.prepare(`
        UPDATE guided_decisions SET requested_parameters_json = ? WHERE id = ?
      `).run(replacementDecision.requested_parameters_json, replacementDecision.id);
      const action = await runtime.approveGuidedDecision(
        replacementDecision.id,
        "operator:test",
        "Run the exact refreshed step with the replacement specialist",
      );
      expect(database.prepare(`SELECT assignment_id FROM actions WHERE id = ?`).get(action.id))
        .toEqual({ assignment_id: result.run.assignmentId });
      expect(dispatched).toEqual([action.id]);
    } finally {
      await runtime?.stop();
      database.close();
    }
  });

  test("the execution adapter uses the selected route and rechecks health immediately before the external provider call", async () => {
    const runCase = async (race: "none" | "unhealthy" | "stale" | "circuit") => {
      const { database, url } = await application();
      const view = await recovery(url);
      const selected = await mutate(url, "provider", {
        ...exact(view),
        providerId: "alternate-oauth",
        reason: "Use the alternate enforcing provider for the exact current analysis",
      }, `provider-adapter-${race}`);
      expect(selected.status).toBe(200);
      if (race === "circuit") openProviderCircuit(database, "alternate-oauth", "2026-07-15T15:02:30.000Z");
      database.prepare(`UPDATE runs SET status = 'running' WHERE id = 'run-recovery'`).run();
      database.prepare(`UPDATE plan_steps SET status = 'running' WHERE id = 'step-recovery'`).run();
      database.prepare(`UPDATE assignments SET status = 'active' WHERE id = 'assignment-recovery'`).run();
      const action = new ActionRepository(database).create({
        intent: {
          missionId: "mission-recovery",
          runId: "run-recovery",
          stepId: "step-recovery",
          planVersion: 1,
          assignmentId: "assignment-recovery",
          actionType: "analysis",
          actionClass: "network",
          target: "lab.internal",
          intentSummary: "Assess the approved target through the selected route",
          kind: "provider_turn",
          idempotent: true,
          destructive: false,
          arguments: { question: "Assess the authorized evidence gap" },
        },
        fingerprint: `provider-action-${race}`,
        contractId: "contract-recovery",
        now: LATER,
      });
      if (race === "unhealthy") {
        database.exec(`
          CREATE TRIGGER make_selected_provider_unhealthy_after_turn_reservation
          AFTER INSERT ON provider_turns
          WHEN NEW.run_id = 'run-recovery'
          BEGIN
            INSERT INTO health_snapshots (
              id, component_type, component_id, status, metrics_json, message, captured_at
            ) VALUES (
              'health-alternate-raced', 'provider', 'alternate-oauth', 'unhealthy',
              '{"authenticated":false,"callable":false,"attestedAt":"2026-07-15T15:02:00.000Z"}',
              'OAuth route invalidated during reservation',
              '2026-07-15T15:02:00.000Z'
            );
          END;
        `);
      } else if (race === "stale") {
        database.exec(`
          CREATE TRIGGER make_selected_provider_stale_after_turn_reservation
          AFTER INSERT ON provider_turns
          WHEN NEW.run_id = 'run-recovery'
          BEGIN
            UPDATE health_snapshots
            SET metrics_json = json_set(metrics_json, '$.attestedAt', '2026-07-15T14:00:00.000Z')
            WHERE component_type = 'provider' AND component_id = 'alternate-oauth';
          END;
        `);
      }
      let defaultCalls = 0;
      let alternateCalls = 0;
      let resolveResult!: (value: any) => void;
      const received = new Promise<any>((resolve) => { resolveResult = resolve; });
      const port = new CommandOsBoundedExecutionPort({
        database,
        now: () => new Date("2026-07-15T15:02:30.000Z"),
        providerHealthMaxAgeMs: 180_000,
        inventory: () => [],
        callGrok: async () => {
          defaultCalls += 1;
          return "The default route must not be used when an exact override exists";
        },
        providerRoutes: [{
          id: "alternate-oauth",
          provider: "alternate-oauth",
          model: "alternate-expert",
          call: async () => {
            alternateCalls += 1;
            return {
              text: "The alternate specialist produced one bounded analysis result",
              usage: { inputTokens: 4, outputTokens: 3, providerTokens: 7, estimatedCost: 0.1 },
            };
          },
        }],
        executeMcp: async () => { throw new Error("MCP execution must not be reached"); },
      });
      port.bindResultSink({
        async acceptExecutionResult(result) {
          resolveResult(result);
          return {
            accepted: true,
            duplicate: false,
            actionId: result.actionId,
            runId: result.runId,
            runState: "running",
            nextAction: null,
          };
        },
      });
      await port.dispatch(action, new AbortController().signal);
      const result = await received;
      return { database, result, defaultCalls, alternateCalls };
    };

    const success = await runCase("none");
    try {
      expect(success.result).toMatchObject({ success: true, circuitKey: "provider:alternate-oauth" });
      expect(success.defaultCalls).toBe(0);
      expect(success.alternateCalls).toBe(1);
      expect(success.database.prepare(`
        SELECT provider, model, status FROM provider_turns ORDER BY started_at DESC, id DESC LIMIT 1
      `).get()).toEqual({ provider: "alternate-oauth", model: "alternate-expert", status: "completed" });
    } finally {
      success.database.close();
    }

    const raced = await runCase("unhealthy");
    try {
      expect(raced.result).toMatchObject({
        success: false,
        failure: { code: "provider_route_unhealthy" },
      });
      expect(raced.defaultCalls).toBe(0);
      expect(raced.alternateCalls).toBe(0);
      expect(raced.database.prepare(`
        SELECT provider, model, status FROM provider_turns ORDER BY started_at DESC, id DESC LIMIT 1
      `).get()).toEqual({ provider: "alternate-oauth", model: "alternate-expert", status: "failed" });
    } finally {
      raced.database.close();
    }

    const stale = await runCase("stale");
    try {
      expect(stale.result).toMatchObject({
        success: false,
        failure: { code: "provider_route_health_stale" },
      });
      expect(stale.defaultCalls).toBe(0);
      expect(stale.alternateCalls).toBe(0);
      expect(stale.database.prepare(`
        SELECT provider, model, status FROM provider_turns ORDER BY started_at DESC, id DESC LIMIT 1
      `).get()).toEqual({ provider: "alternate-oauth", model: "alternate-expert", status: "failed" });
    } finally {
      stale.database.close();
    }

    const circuit = await runCase("circuit");
    try {
      expect(circuit.result).toMatchObject({
        success: false,
        failure: { code: "provider_route_circuit_open" },
      });
      expect(circuit.defaultCalls).toBe(0);
      expect(circuit.alternateCalls).toBe(0);
      expect(circuit.database.prepare(`SELECT count(*) AS count FROM provider_turns`).get()).toEqual({ count: 0 });
    } finally {
      circuit.database.close();
    }
  });
});
