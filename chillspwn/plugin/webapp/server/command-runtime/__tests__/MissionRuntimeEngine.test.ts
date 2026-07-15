import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { createDatabaseConnection, migrateDatabase, type SqliteDatabase } from "../../db";
import { ActionRepository, type DurableAction } from "../../orchestration";
import { hashJson } from "../../orchestration/serialization";
import { createMissionRuntimeV2Router } from "../../routes/missionRuntimeV2Routes";
import {
  createMissionRuntime,
  type ExecutionResultSink,
  type MissionOutcomeEvaluatorPort,
  type MissionPlannerPort,
  type ResultAwareExecutionPort,
} from "../index";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

class CallbackPort implements ResultAwareExecutionPort {
  readonly dispatched: DurableAction[] = [];
  readonly cancelled: string[] = [];
  sink?: ExecutionResultSink;

  bindResultSink(sink: ExecutionResultSink): () => void {
    this.sink = sink;
    return () => { this.sink = undefined; };
  }

  async dispatch(action: DurableAction, _signal: AbortSignal): Promise<void> {
    this.dispatched.push(action);
  }

  async resume(action: DurableAction, _signal: AbortSignal): Promise<void> {
    this.dispatched.push(action);
  }

  async cancelRun(runId: string): Promise<void> {
    this.cancelled.push(runId);
  }

  async succeed(index = 0): Promise<void> {
    const action = this.dispatched[index]!;
    if (!this.sink) throw new Error("Result sink not bound");
    await this.sink.acceptExecutionResult({
      actionId: action.id,
      runId: action.runId,
      actionFingerprint: action.fingerprint,
      success: true,
      summary: "The specialist returned a verified result",
      progress: {
        evidenceIds: [`evidence-${action.id}`],
        verifiedWorkerResultIds: [action.id],
      },
    });
  }

  async fail(
    index = 0,
    category: "timeout" | "deterministic_tool_error" = "timeout",
    retryAfterMs?: number,
  ): Promise<void> {
    const action = this.dispatched[index]!;
    if (!this.sink) throw new Error("Result sink not bound");
    await this.sink.acceptExecutionResult({
      actionId: action.id,
      runId: action.runId,
      actionFingerprint: action.fingerprint,
      success: false,
      summary: category === "timeout"
        ? "The authorized service observation timed out without evidence"
        : "The represented service observation returned a deterministic error",
      progress: {},
      failureCategory: category,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    });
  }
}

class RuntimeClock {
  private value = Date.parse("2026-07-15T00:00:00.000Z");
  now = () => new Date(this.value);
  advance(milliseconds: number): void { this.value += milliseconds; }
}

function seedAgent(database: SqliteDatabase): void {
  const now = "2026-07-15T00:00:00.000Z";
  database.prepare(`
    INSERT INTO agents (
      id, role, display_name, status, version, created_at, updated_at
    ) VALUES ('agent-recon', 'reconnaissance', 'Recon specialist', 'available', '1', ?, ?)
  `).run(now, now);
}

function seedRun(database: SqliteDatabase, journey: "autonomous" | "guided"): { missionId: string; runId: string } {
  const now = "2026-07-15T00:00:00.000Z";
  const missionId = `mission-${journey}`;
  const runId = `run-${journey}`;
  database.prepare(`
    INSERT INTO missions (
      id, name, objective, journey, status, authorization_status,
      success_criteria_json, memory_policy_json, created_by, created_at, updated_at
    ) VALUES (?, ?, 'Collect one verified result', ?, 'active', 'verified',
      '["One verified result is retained"]', '{}', 'operator', ?, ?)
  `).run(missionId, `${journey} mission`, journey, now, now);
  database.prepare(`
    INSERT INTO mission_targets (
      id, mission_id, target, target_type, disposition, normalized_target, created_at
    ) VALUES (?, ?, 'lab.internal', 'domain', 'allowed', 'lab.internal', ?)
  `).run(`target-${journey}`, missionId, now);
  let contractId: string | null = null;
  if (journey === "autonomous") {
    contractId = "contract-autonomous";
    database.prepare(`
      INSERT INTO mission_contracts (
        id, mission_id, version, state, contract_hash, authorization_json,
        action_policy_json, budgets_json, safe_stop_json, deliverables_json,
        memory_scopes_json, confirmed_by, confirmed_at, created_at
      ) VALUES (?, ?, 1, 'confirmed', ?, '{}', ?, ?, '{}', '[]', '[]', 'operator', ?, ?)
    `).run(
      contractId,
      missionId,
      "a".repeat(64),
      JSON.stringify({ allowedActionClasses: ["reconnaissance"], prohibitedActionClasses: [] }),
      JSON.stringify({ toolCalls: 5, concurrency: 1, retries: 1, replans: 1 }),
      now,
      now,
    );
  }
  database.prepare(`
    INSERT INTO runs (
      id, mission_id, journey, status, contract_id, budget_json, budget_usage_json,
      status_reason, next_action_summary, started_at, created_at, updated_at, version
    ) VALUES (?, ?, ?, 'planning', ?, ?, '{}', 'Planning fixture mission',
      'Build the first bounded plan', ?, ?, ?, 1)
  `).run(
    runId,
    missionId,
    journey,
    contractId,
    JSON.stringify({ toolCalls: 5, concurrency: 1, retries: 1, replans: 1 }),
    now,
    now,
    now,
  );
  return { missionId, runId };
}

const planner: MissionPlannerPort = {
  async plan(input) {
    return {
      strategySummary: "Use one bounded reconnaissance action and validate its retained result",
      rationaleSummary: "The action is sufficient for this fixture objective",
      steps: [{
        phase: "reconnaissance",
        title: "Map the authorized service",
        objective: "Collect a verified service result",
        explanation: "We are checking the one authorized target to establish whether the service is present.",
        rationale: "This is the smallest reversible step that advances the objective.",
        successCriteria: ["A verified specialist result is returned"],
        assignedAgentId: "agent-recon",
        riskClass: "low",
        reversibility: "Read-only and reversible",
        action: {
          actionType: "reconnaissance",
          actionClass: "reconnaissance",
          target: input.mission.allowedTargets[0]!,
          arguments: { service: "https" },
          intentSummary: "Inspect the approved service",
          kind: "tool",
          idempotent: true,
          destructive: false,
        },
      }],
    };
  },
};

const evaluator: MissionOutcomeEvaluatorPort = {
  async evaluate(input) {
    return {
      success: input.completedActionIds.length === 1,
      summary: input.completedActionIds.length === 1
        ? "Success criterion validated from the completed specialist action"
        : "The required specialist result is missing",
      criteria: [{
        criterion: "One verified result is retained",
        satisfied: input.completedActionIds.length === 1,
        explanation: "Validated against the durable completed action record",
        evidenceIds: [],
      }],
    };
  },
};

const manualPlanner: MissionPlannerPort = {
  async plan(input, signal) {
    const draft = await planner.plan(input, signal);
    return {
      ...draft,
      strategySummary: "Guide the operator through one exact manual observation",
      steps: draft.steps.map((step) => ({
        ...step,
        title: "Inspect the approved service manually",
        action: {
          ...step.action,
          kind: "manual" as const,
          arguments: {
            command: "curl --fail --silent --show-error https://lab.internal/health",
            expectedOutput: "A successful health response",
            successPatterns: ["ok"],
            failurePatterns: ["connection refused"],
          },
          intentSummary: "Operator inspects the approved service and supplies the result",
        },
      })),
    };
  },
};

const guidedRecoveryPlanner: MissionPlannerPort = {
  async plan(input, signal) {
    const draft = await planner.plan(input, signal);
    if (!input.rejectionReason) return draft;
    return {
      ...draft,
      strategySummary: "Use a bounded alternate protocol observation after the failed HTTPS attempt",
      rationaleSummary: `The prior failure was interpreted before selecting another exact step: ${input.rejectionReason}`,
      steps: draft.steps.map((step) => ({
        ...step,
        title: "Inspect the alternate approved service path",
        explanation: "The previous HTTPS observation timed out, so this step checks a different read-only service path.",
        rationale: "A different protocol and parameter set can distinguish a service-specific timeout from target unavailability.",
        action: {
          ...step.action,
          actionType: "alternate-reconnaissance",
          arguments: { service: "http", fallbackAfter: "https-timeout" },
          intentSummary: "Inspect the alternate approved service path",
        },
      })),
    };
  },
};

const twoStepGuidedPlanner: MissionPlannerPort = {
  async plan(input, signal) {
    const draft = await planner.plan(input, signal);
    const first = draft.steps[0]!;
    return {
      ...draft,
      strategySummary: "Guide two bounded observations with an explicit decision at each step",
      steps: [
        first,
        {
          ...first,
          title: "Inspect the alternate approved service",
          objective: "Collect an alternate service result if the first observation is skipped",
          explanation: "This is the next dependency-eligible bounded observation.",
          rationale: "It provides another reversible way to advance the authorized objective.",
          dependencyOrdinals: [0],
          action: {
            ...first.action,
            actionType: "alternate-reconnaissance",
            arguments: { service: "http" },
            intentSummary: "Inspect the alternate approved service",
          },
        },
      ],
    };
  },
};

function setup(
  journey: "autonomous" | "guided",
  selectedPlanner: MissionPlannerPort = planner,
  selectedEvaluator: MissionOutcomeEvaluatorPort = evaluator,
) {
  const database = createDatabaseConnection({ filename: ":memory:" });
  migrateDatabase(database);
  seedAgent(database);
  const ids = seedRun(database, journey);
  const port = new CallbackPort();
  const runtime = createMissionRuntime({
    database,
    planner: selectedPlanner,
    outcomeEvaluator: selectedEvaluator,
    execution: port,
    workerId: "runtime-test-worker",
    leaseTtlMs: 10_000,
    scanIntervalMs: 100,
  });
  return { database, runtime, port, ...ids };
}

describe("MissionRuntimeEngine", () => {
  test("startup records expired planning recovery before reacquiring either journey", async () => {
    for (const journey of ["autonomous", "guided"] as const) {
      const { database, runtime, port, runId } = setup(journey);
      try {
        runtime.coordinator.acquireRunLease(runId, `dead-${journey}-planner`, 10_000);
        const interruptedAt = new Date(Date.now() - 5_000).toISOString();
        const expiredAt = new Date(Date.now() - 1_000).toISOString();
        database.prepare(`
          INSERT INTO provider_turns (id, run_id, provider, model, status, started_at)
          VALUES (?, ?, 'xai-grok-oauth', 'grok-4.5', 'started', ?)
        `).run(`interrupted-${journey}-turn`, runId, interruptedAt);
        database.prepare("UPDATE runs SET lease_expires_at = ? WHERE id = ?").run(expiredAt, runId);

        const lifecycle = await runtime.start();
        expect(lifecycle).toEqual({ recoveredRuns: 1, scheduledRuns: 1 });
        const expectedStatus = journey === "autonomous" ? "running" : "waiting_guided_decision";
        for (let attempt = 0; attempt < 100; attempt += 1) {
          if (runtime.repository.getRunProjection(runId).status === expectedStatus) break;
          await Bun.sleep(10);
        }
        expect(runtime.repository.getRunProjection(runId).status).toBe(expectedStatus);

        expect(database.prepare(`
          SELECT status, error_category, ended_at IS NOT NULL AS closed
          FROM provider_turns WHERE id = ?
        `).get(`interrupted-${journey}-turn`)).toEqual({
          status: "cancelled",
          error_category: "process_crash",
          closed: 1,
        });
        const events = database.prepare(`
          SELECT sequence, event_type,
            json_extract(payload_json, '$.classification') AS classification,
            payload_json
          FROM events WHERE run_id = ? ORDER BY sequence
        `).all(runId) as Array<{
          sequence: number; event_type: string; classification: string | null; payload_json: string;
        }>;
        expect(events[0]).toMatchObject({
          event_type: "run.recovery_started",
          classification: "restart_planning",
        });
        expect(database.prepare(`
          SELECT in_flight_classification FROM checkpoints
          WHERE run_id = ? AND event_sequence = ?
        `).get(runId, events[0]!.sequence)).toEqual({ in_flight_classification: "restart_planning" });
        expect(events.findIndex((event) => event.event_type === "run.recovery_started"))
          .toBeLessThan(events.findIndex((event) => event.event_type === "run.state_changed"));

        if (journey === "autonomous") {
          expect(port.dispatched).toHaveLength(1);
          expect(runtime.repository.listDecisions({ runId })).toHaveLength(0);
          expect(events.some((event) => event.payload_json.includes("waiting_guided_decision"))).toBe(false);
        } else {
          expect(port.dispatched).toHaveLength(0);
          expect(runtime.repository.listDecisions({ runId, status: "pending" })).toHaveLength(1);
          expect(database.prepare("SELECT COUNT(*) AS count FROM actions WHERE run_id = ?").get(runId))
            .toEqual({ count: 0 });
        }
      } finally {
        await runtime.stop();
        database.close();
      }
    }
  }, 120_000);

  test("Guided manual actions cannot dispatch and complete only from the exact operator result", async () => {
    let evaluatorEvidenceIds: string[] = [];
    let database!: SqliteDatabase;
    const evidenceAwareEvaluator: MissionOutcomeEvaluatorPort = {
      async evaluate(input) {
        evaluatorEvidenceIds = (database.prepare(`
          SELECT id FROM evidence
          WHERE mission_id = ? AND run_id = ? AND verification_state = 'verified'
          ORDER BY id
        `).all(input.mission.id, input.run.id) as Array<{ id: string }>).map((row) => row.id);
        return {
          success: evaluatorEvidenceIds.length === 1,
          summary: evaluatorEvidenceIds.length === 1
            ? "The operator-attested evidence was available to terminal evaluation"
            : "Terminal evaluation could not see retained evidence",
          criteria: [{
            criterion: "One verified result is retained",
            satisfied: evaluatorEvidenceIds.length === 1,
            explanation: "Validated against canonical private evidence",
            evidenceIds: evaluatorEvidenceIds,
          }],
        };
      },
    };
    const configured = setup("guided", manualPlanner, evidenceAwareEvaluator);
    database = configured.database;
    const { runtime, port, runId } = configured;
    try {
      await runtime.processRunNow(runId);
      const [decision] = runtime.repository.listDecisions({ status: "pending", runId });
      expect(decision).toBeDefined();
      expect((decision!.requestedParameters as { kind?: string }).kind).toBe("manual");
      expect(port.dispatched).toHaveLength(0);

      await expect(runtime.approveGuidedDecision(decision!.id, "operator-test"))
        .rejects.toThrow("manual Guided action cannot be dispatched");
      expect(runtime.repository.getDecision(decision!.id).status).toBe("pending");
      expect(runtime.repository.getRunProjection(runId).status).toBe("waiting_guided_decision");
      expect(port.dispatched).toHaveLength(0);

      const rawResult = "RAW_OPERATOR_RESULT_DO_NOT_STREAM: health endpoint returned ok";
      const receipt = await runtime.submitManualGuidedResult(
        decision!.id,
        "operator-test",
        rawResult,
      );
      expect(receipt).toMatchObject({ accepted: true, duplicate: false, runState: "completed" });
      expect(receipt.evidenceIds).toHaveLength(1);
      expect(evaluatorEvidenceIds).toEqual(receipt.evidenceIds as string[]);
      expect(port.dispatched).toHaveLength(0);
      expect(database.prepare(`
        SELECT status FROM actions WHERE run_id = ?
      `).get(runId)).toEqual({ status: "succeeded" });
      const action = new ActionRepository(database).get(receipt.actionId);
      expect(action.kind).toBe("manual");
      const evidenceId = receipt.evidenceIds![0]!;
      const evidence = database.prepare(`
        SELECT mission_id, run_id, step_id, action_id, source, evidence_type,
          content_hash, provenance_json, sensitivity, verification_state,
          summary, extracted_text, created_by
        FROM evidence WHERE id = ?
      `).get(evidenceId) as Record<string, string>;
      expect(evidence).toMatchObject({
        mission_id: "mission-guided",
        run_id: runId,
        step_id: decision!.stepId,
        action_id: receipt.actionId,
        source: "guided.operator_manual_result",
        evidence_type: "guided_manual_result",
        sensitivity: "private",
        verification_state: "verified",
        created_by: "operator-test",
        extracted_text: rawResult,
      });
      expect(evidence.content_hash).toBe(createHash("sha256").update(rawResult).digest("hex"));
      expect(evidence.summary).not.toContain(rawResult);
      expect(JSON.parse(evidence.provenance_json)).toMatchObject({
        method: "operator_attestation",
        operatorId: "operator-test",
        decisionId: decision!.id,
        actionId: receipt.actionId,
        contentExcludedFromSemanticEvents: true,
      });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM evidence_chain_events WHERE evidence_id = ?
      `).get(evidenceId)).toEqual({ count: 2 });
      expect(() => database.prepare(`
        UPDATE evidence_chain_events SET actor = 'tampered' WHERE evidence_id = ?
      `).run(evidenceId)).toThrow("evidence chain events are immutable");
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM audit_records
        WHERE resource_type = 'evidence' AND resource_id = ?
      `).get(evidenceId)).toEqual({ count: 1 });
      const audit = database.prepare(`
        SELECT * FROM audit_records WHERE resource_type = 'evidence' AND resource_id = ?
      `).get(evidenceId) as Record<string, any>;
      expect(audit.journey).toBe("guided");
      expect(audit.record_hash).toBe(hashJson({
        id: audit.id,
        previousHash: audit.previous_hash,
        journey: "guided",
        missionId: audit.mission_id,
        runId: audit.run_id,
        actorId: audit.actor_id,
        action: audit.action,
        resourceType: audit.resource_type,
        resourceId: audit.resource_id,
        reason: audit.reason,
        details: JSON.parse(audit.details_json),
        now: audit.occurred_at,
      }));
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM events
        WHERE run_id = ? AND event_type = 'action.completed'
          AND payload_json LIKE '%\"actionKind\":\"manual\"%'
      `).get(runId)).toEqual({ count: 1 });
      const streamedEvents = (database.prepare(`
        SELECT summary, payload_json, redaction_json FROM events WHERE run_id = ?
      `).all(runId) as Array<Record<string, string>>).map((row) => JSON.stringify(row)).join("\n");
      expect(streamedEvents).not.toContain(rawResult);
      expect(streamedEvents).toContain("retained_in_private_evidence_only");

      const replay = await runtime.submitManualGuidedResult(decision!.id, "operator-test", "ignored replay content");
      expect(replay).toMatchObject({
        accepted: true,
        duplicate: true,
        actionId: receipt.actionId,
        evidenceIds: [evidenceId],
      });
      expect(database.prepare("SELECT COUNT(*) AS count FROM evidence WHERE run_id = ?").get(runId))
        .toEqual({ count: 1 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM actions WHERE run_id = ?").get(runId))
        .toEqual({ count: 1 });
      expect(database.prepare("SELECT evidence_coverage FROM run_evaluations WHERE run_id = ?").get(runId))
        .toEqual({ evidence_coverage: 1 });
    } finally {
      await runtime.stop();
      database.close();
    }
  }, 120_000);

  test("Guided skip terminalizes only the exact represented step, checkpoints it, and advances without fabricated work", async () => {
    const { database, runtime, port, runId } = setup("guided", twoStepGuidedPlanner);
    try {
      await runtime.processRunNow(runId);
      const [firstDecision] = runtime.repository.listDecisions({ runId, status: "pending" });
      expect(firstDecision).toBeDefined();
      const firstParameterHash = hashJson(firstDecision!.requestedParameters);

      const first = await runtime.skipGuidedDecision(
        firstDecision!.id,
        "operator-test",
        "Skip this reversible observation and continue to the next represented step",
      );
      expect(first).toMatchObject({
        decisionId: firstDecision!.id,
        status: "cancelled",
        skippedStepId: firstDecision!.stepId,
        runId,
        runState: "waiting_guided_decision",
        duplicate: false,
      });
      expect(first.nextDecisionId).not.toBeNull();
      expect(port.dispatched).toHaveLength(0);
      expect(database.prepare("SELECT COUNT(*) AS count FROM actions WHERE run_id = ?").get(runId))
        .toEqual({ count: 0 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM evidence WHERE run_id = ?").get(runId))
        .toEqual({ count: 0 });
      expect(database.prepare("SELECT status FROM guided_decisions WHERE id = ?").get(firstDecision!.id))
        .toEqual({ status: "cancelled" });
      expect(database.prepare("SELECT status FROM plan_steps WHERE id = ?").get(firstDecision!.stepId))
        .toEqual({ status: "skipped" });
      expect(database.prepare("SELECT status FROM assignments WHERE step_id = ?").get(firstDecision!.stepId))
        .toEqual({ status: "cancelled" });

      const event = database.prepare(`
        SELECT actor_type, actor_id,
          json_extract(payload_json, '$.actionFingerprint') AS action_fingerprint,
          json_extract(payload_json, '$.parameterHash') AS parameter_hash,
          json_extract(payload_json, '$.reason') AS reason,
          json_extract(payload_json, '$.actionCreated') AS action_created,
          json_extract(payload_json, '$.evidenceCreated') AS evidence_created
        FROM events
        WHERE run_id = ? AND event_type = 'guided.decision_skipped'
          AND json_extract(payload_json, '$.decisionId') = ?
      `).get(runId, firstDecision!.id) as Record<string, unknown>;
      expect(event).toMatchObject({
        actor_type: "operator",
        actor_id: "operator-test",
        action_fingerprint: firstDecision!.actionFingerprint,
        parameter_hash: firstParameterHash,
        reason: "Skip this reversible observation and continue to the next represented step",
        action_created: 0,
        evidence_created: 0,
      });
      const audit = database.prepare(`
        SELECT journey, details_json FROM audit_records
        WHERE action = 'guided.decision_skipped' AND resource_id = ?
      `).get(firstDecision!.id) as { journey: string; details_json: string };
      expect(audit.journey).toBe("guided");
      expect(JSON.parse(audit.details_json)).toMatchObject({
        stepId: firstDecision!.stepId,
        actionFingerprint: firstDecision!.actionFingerprint,
        parameterHash: firstParameterHash,
        actionCreated: false,
        evidenceCreated: false,
      });
      const checkpoint = database.prepare(`
        SELECT journey, state_json FROM checkpoints
        WHERE run_id = ? ORDER BY event_sequence DESC LIMIT 1
      `).get(runId) as { journey: string; state_json: string };
      expect(checkpoint.journey).toBe("guided");
      expect(JSON.parse(checkpoint.state_json)).toMatchObject({
        run: { journey: "guided", state: "waiting_guided_decision" },
        control: { progress: { stepStates: { [firstDecision!.stepId]: "skipped" } } },
      });

      const replay = await runtime.skipGuidedDecision(
        firstDecision!.id,
        "operator-test",
        "An idempotent replay must not create work",
      );
      expect(replay).toMatchObject({
        decisionId: firstDecision!.id,
        nextDecisionId: first.nextDecisionId,
        duplicate: true,
      });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM events
        WHERE run_id = ? AND event_type = 'guided.decision_skipped'
          AND json_extract(payload_json, '$.decisionId') = ?
      `).get(runId, firstDecision!.id)).toEqual({ count: 1 });

      const secondDecision = runtime.repository.getDecision(first.nextDecisionId!);
      const terminal = await runtime.skipGuidedDecision(
        secondDecision.id,
        "operator-test",
        "Skip the remaining represented step and evaluate the actual outcome",
      );
      expect(terminal).toMatchObject({
        decisionId: secondDecision.id,
        status: "cancelled",
        nextDecisionId: null,
        runState: "failed",
        duplicate: false,
      });
      expect(port.dispatched).toHaveLength(0);
      expect(database.prepare("SELECT COUNT(*) AS count FROM actions WHERE run_id = ?").get(runId))
        .toEqual({ count: 0 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM evidence WHERE run_id = ?").get(runId))
        .toEqual({ count: 0 });
      expect(database.prepare(`
        SELECT DISTINCT status FROM plan_steps WHERE run_id = ? ORDER BY status
      `).all(runId)).toEqual([{ status: "skipped" }]);
      expect(database.prepare(`
        SELECT DISTINCT status FROM assignments WHERE run_id = ? ORDER BY status
      `).all(runId)).toEqual([{ status: "cancelled" }]);
      expect(database.prepare("SELECT status FROM plans WHERE run_id = ?").get(runId))
        .toEqual({ status: "completed" });
      expect(database.prepare("SELECT journey FROM run_evaluations WHERE run_id = ?").get(runId))
        .toEqual({ journey: "guided" });
    } finally {
      await runtime.stop();
      database.close();
    }
  }, 120_000);

  test("Autonomous plans containing manual actions fail closed before plan persistence or dispatch", async () => {
    const { database, runtime, port, runId } = setup("autonomous", manualPlanner);
    try {
      await expect(runtime.processRunNow(runId)).rejects.toThrow(
        "Autonomous plans cannot contain operator-executed manual actions",
      );
      expect(port.dispatched).toHaveLength(0);
      expect(runtime.repository.getRunProjection(runId).status).toBe("blocked");
      expect(database.prepare("SELECT COUNT(*) AS count FROM plans WHERE run_id = ?").get(runId))
        .toEqual({ count: 0 });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM events
        WHERE run_id = ? AND event_type = 'run.autonomous_safe_stopped'
      `).get(runId)).toEqual({ count: 1 });
    } finally {
      await runtime.stop();
      database.close();
    }
  }, 120_000);

  test("planning dependency failures are classified, actionable, and never persist raw provider details", async () => {
    const rawProviderDetail = "RAW_PROVIDER_DETAIL_DO_NOT_PERSIST";
    const failingPlanner: MissionPlannerPort = {
      async plan() {
        throw new Error(`Grok OAuth auth path has no cached_token: ${rawProviderDetail}`);
      },
    };
    const { database, runtime, port, runId } = setup("autonomous", failingPlanner);
    try {
      let received: unknown;
      try {
        await runtime.processRunNow(runId);
      } catch (error) {
        received = error;
      }
      expect(received).toMatchObject({
        name: "CommandRuntimeError",
        code: "mission_runtime_authentication_missing",
        options: {
          category: "authentication_missing",
          humanMessage: "The planning provider has no valid refreshable OAuth authentication state.",
        },
      });
      expect(String((received as Error).message)).not.toContain(rawProviderDetail);
      expect(port.dispatched).toHaveLength(0);
      expect(runtime.repository.getRunProjection(runId)).toMatchObject({
        status: "blocked",
        statusReason: "The planning provider has no valid refreshable OAuth authentication state.",
      });
      const persisted = JSON.stringify(database.prepare(`
        SELECT summary, payload_json FROM events WHERE run_id = ? ORDER BY sequence
      `).all(runId));
      expect(persisted).not.toContain(rawProviderDetail);
      expect(persisted).toContain("mission_runtime_authentication_missing");
    } finally {
      await runtime.stop();
      database.close();
    }
  }, 120_000);

  test("blocked planning events retain only the safe validation field and rule", async () => {
    const invalidPlanner: MissionPlannerPort = {
      async plan(input, signal) {
        const planned = await planner.plan(input, signal) as unknown as Record<string, any>;
        delete planned.steps[0].reversibility;
        planned.discardedProviderValue = "must-not-enter-events";
        return planned as any;
      },
    };
    const { database, runtime, runId } = setup("guided", invalidPlanner);
    try {
      await expect(runtime.processRunNow(runId)).rejects.toMatchObject({ code: "invalid_plan" });
      const event = database.prepare(`
        SELECT summary, payload_json FROM events
        WHERE run_id = ? AND event_type = 'run.guided_blocked'
      `).get(runId) as { summary: string; payload_json: string };
      expect(event.summary).toContain("steps[0].reversibility");
      expect(JSON.parse(event.payload_json)).toMatchObject({
        code: "invalid_plan",
        category: "invalid_input",
        validationField: "steps[0].reversibility",
        validationRule: "required_nonempty_string",
      });
      expect(event.payload_json).not.toContain("must-not-enter-events");
    } finally {
      await runtime.stop();
      database.close();
    }
  }, 120_000);

  test("cancellation persists an idempotent terminal evaluation without proposing a lesson", async () => {
    const { database, runtime, runId } = setup("autonomous");
    try {
      await runtime.processRunNow(runId);
      await runtime.cancelRun(runId, "operator-test", "Stop at the operator boundary");
      await runtime.cancelRun(runId, "operator-test", "Idempotent replay");
      expect(runtime.repository.getRunProjection(runId).status).toBe("cancelled");
      expect(database.prepare(`
        SELECT journey, created_by FROM run_evaluations WHERE run_id = ?
      `).get(runId)).toEqual({ journey: "autonomous", created_by: "run-supervisor" });
      expect(database.prepare("SELECT COUNT(*) AS count FROM run_evaluations WHERE run_id = ?").get(runId))
        .toEqual({ count: 1 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM lessons").get()).toEqual({ count: 0 });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM plan_steps
        WHERE run_id = ? AND status NOT IN ('completed', 'failed', 'skipped', 'cancelled')
      `).get(runId)).toEqual({ count: 0 });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM assignments
        WHERE run_id = ? AND status NOT IN ('completed', 'failed', 'cancelled')
      `).get(runId)).toEqual({ count: 0 });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM guided_decisions WHERE run_id = ? AND status = 'pending'
      `).get(runId)).toEqual({ count: 0 });
    } finally {
      await runtime.stop();
      database.close();
    }
  }, 120_000);

  test("cancelling a waiting Guided run closes queued assignments and its exact decision", async () => {
    const { database, runtime, port, runId } = setup("guided");
    try {
      await runtime.processRunNow(runId);
      expect(runtime.repository.getRunProjection(runId).status).toBe("waiting_guided_decision");
      expect(runtime.repository.listDecisions({ runId, status: "pending" })).toHaveLength(1);

      await runtime.cancelRun(runId, "operator-test", "Stop the Guided mission cleanly");

      expect(runtime.repository.getRunProjection(runId).status).toBe("cancelled");
      expect(port.dispatched).toHaveLength(0);
      expect(runtime.repository.listDecisions({ runId, status: "pending" })).toHaveLength(0);
      expect(database.prepare(`
        SELECT DISTINCT status FROM plan_steps WHERE run_id = ? ORDER BY status
      `).all(runId)).toEqual([{ status: "cancelled" }]);
      expect(database.prepare(`
        SELECT DISTINCT status FROM assignments WHERE run_id = ? ORDER BY status
      `).all(runId)).toEqual([{ status: "cancelled" }]);
      expect(database.prepare(`
        SELECT DISTINCT status FROM guided_decisions WHERE run_id = ? ORDER BY status
      `).all(runId)).toEqual([{ status: "cancelled" }]);
    } finally {
      await runtime.stop();
      database.close();
    }
  }, 120_000);

  test("runtime shutdown confirms execution-port cleanup without falsely completing in-flight work", async () => {
    const { database, runtime, port, runId } = setup("autonomous");
    try {
      await runtime.processRunNow(runId);
      expect(port.dispatched).toHaveLength(1);
      await runtime.stop();
      expect(port.cancelled).toContain(runId);
      expect(database.prepare("SELECT status FROM actions WHERE run_id = ?").get(runId))
        .toEqual({ status: "running" });
    } finally {
      await runtime.stop();
      database.close();
    }
  }, 120_000);

  test("Autonomous retry waits for Retry-After and survives a runtime restart without immediate execution", async () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    migrateDatabase(database);
    seedAgent(database);
    const { runId } = seedRun(database, "autonomous");
    const clock = new RuntimeClock();
    const firstPort = new CallbackPort();
    const first = createMissionRuntime({
      database,
      planner,
      outcomeEvaluator: evaluator,
      execution: firstPort,
      workerId: "retry-worker-before-restart",
      leaseTtlMs: 10_000,
      scanIntervalMs: 100,
      now: clock.now,
    });
    let second: ReturnType<typeof createMissionRuntime> | undefined;
    try {
      await first.processRunNow(runId);
      expect(firstPort.dispatched).toHaveLength(1);
      await firstPort.fail(0, "timeout", 10_000);
      expect(first.repository.getRunProjection(runId).status).toBe("recovering");
      expect(first.coordinator.getRun(runId).control.recovery).toMatchObject({ kind: "retry" });
      expect(Date.parse(first.coordinator.getRun(runId).control.recovery!.notBefore))
        .toBeGreaterThanOrEqual(clock.now().getTime() + 10_000);

      await first.scanOnce();
      await Bun.sleep(0);
      expect(firstPort.dispatched).toHaveLength(1);
      await first.stop();

      const secondPort = new CallbackPort();
      second = createMissionRuntime({
        database,
        planner,
        outcomeEvaluator: evaluator,
        execution: secondPort,
        workerId: "retry-worker-after-restart",
        leaseTtlMs: 10_000,
        scanIntervalMs: 100,
        now: clock.now,
      });
      await second.start();
      await Bun.sleep(0);
      expect(secondPort.dispatched).toHaveLength(0);

      clock.advance(30_000);
      await second.scanOnce();
      for (let attempt = 0; attempt < 50 && secondPort.dispatched.length === 0; attempt += 1) {
        await Bun.sleep(2);
      }
      expect(secondPort.dispatched).toHaveLength(1);
      expect(database.prepare("SELECT COUNT(*) AS count FROM actions WHERE run_id = ?").get(runId))
        .toEqual({ count: 2 });
    } finally {
      await first.stop();
      if (second) await second.stop();
      database.close();
    }
  }, 120_000);

  test("cancelling a delayed retry prevents later scheduler execution", async () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    migrateDatabase(database);
    seedAgent(database);
    const { runId } = seedRun(database, "autonomous");
    const clock = new RuntimeClock();
    const port = new CallbackPort();
    const runtime = createMissionRuntime({
      database,
      planner,
      outcomeEvaluator: evaluator,
      execution: port,
      workerId: "retry-cancel-worker",
      leaseTtlMs: 10_000,
      scanIntervalMs: 100,
      now: clock.now,
    });
    try {
      await runtime.processRunNow(runId);
      await port.fail(0, "timeout", 15_000);
      expect(runtime.repository.getRunProjection(runId).status).toBe("recovering");
      await runtime.cancelRun(runId, "operator-test", "Cancel the delayed retry");
      clock.advance(30_000);
      await runtime.scanOnce();
      await Bun.sleep(0);
      expect(runtime.repository.getRunProjection(runId).status).toBe("cancelled");
      expect(port.dispatched).toHaveLength(1);
      expect(database.prepare("SELECT COUNT(*) AS count FROM actions WHERE run_id = ?").get(runId))
        .toEqual({ count: 1 });
    } finally {
      await runtime.stop();
      database.close();
    }
  }, 120_000);

  test("signed wall-clock budget includes planning elapsed time", async () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    migrateDatabase(database);
    seedAgent(database);
    const { runId } = seedRun(database, "autonomous");
    database.prepare(`
      UPDATE runs SET budget_json = ? WHERE id = ?
    `).run(JSON.stringify({ wallClockMs: 1_000, toolCalls: 5, concurrency: 1, retries: 1, replans: 1 }), runId);
    const clock = new RuntimeClock();
    const slowPlanner: MissionPlannerPort = {
      async plan(input, signal) {
        clock.advance(1_500);
        return planner.plan(input, signal);
      },
    };
    const port = new CallbackPort();
    const runtime = createMissionRuntime({
      database,
      planner: slowPlanner,
      outcomeEvaluator: evaluator,
      execution: port,
      workerId: "planning-budget-worker",
      leaseTtlMs: 10_000,
      scanIntervalMs: 100,
      now: clock.now,
    });
    try {
      await expect(runtime.processRunNow(runId)).rejects.toThrow("Signed run budget was exhausted");
      expect(runtime.repository.getRunProjection(runId)).toMatchObject({ status: "blocked" });
      expect(port.dispatched).toHaveLength(0);
      expect(database.prepare(`
        SELECT json_extract(budget_usage_json, '$.wallClockMs') AS elapsed
        FROM runs WHERE id = ?
      `).get(runId)).toEqual({ elapsed: 1_500 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM plans WHERE run_id = ?").get(runId))
        .toEqual({ count: 0 });
    } finally {
      await runtime.stop();
      database.close();
    }
  }, 120_000);

  test("Autonomous plans, delegates, executes and validates without any user-wait state", async () => {
    const { database, runtime, port, runId } = setup("autonomous");
    try {
      await runtime.processRunNow(runId);
      expect(port.dispatched).toHaveLength(1);
      expect(runtime.repository.getRunProjection(runId).status).toBe("running");
      expect(database.prepare("SELECT COUNT(*) AS count FROM guided_decisions").get()).toEqual({ count: 0 });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM events
        WHERE run_id = ? AND payload_json LIKE '%waiting_guided_decision%'
      `).get(runId)).toEqual({ count: 0 });

      await port.succeed();
      expect(runtime.repository.getRunProjection(runId)).toMatchObject({
        status: "completed",
        progress: 1,
      });
      expect(database.prepare("SELECT status FROM assignments WHERE run_id = ?").get(runId))
        .toEqual({ status: "completed" });
      expect(database.prepare("SELECT COUNT(*) AS count FROM checkpoints WHERE run_id = ?").get(runId))
        // Planning and outcome evaluation each add a correlated budget
        // checkpoint in addition to the prior state/action checkpoints.
        .toEqual({ count: 6 });
      expect(database.prepare("SELECT journey, created_by FROM run_evaluations WHERE run_id = ?").get(runId))
        .toEqual({ journey: "autonomous", created_by: "outcome-evaluator" });
    } finally {
      await runtime.stop();
      database.close();
    }
  }, 120_000);

  test("accounts every provider turn represented by a bounded schema-repair result", async () => {
    const usagePlanner: MissionPlannerPort = {
      async plan(input, signal) {
        const planned = await planner.plan(input, signal);
        return {
          ...planned,
          providerUsage: {
            providerTurnId: "providerturn-repair",
            providerTurns: 2,
            providerTokens: 35,
            exactTokenUsage: true,
            exactCostUsage: false,
          },
        };
      },
    };
    const { database, runtime, runId } = setup("autonomous", usagePlanner);
    try {
      await runtime.processRunNow(runId);
      expect(database.prepare(`
        SELECT
          json_extract(budget_usage_json, '$.providerTurns') AS provider_turns,
          json_extract(budget_usage_json, '$.providerTokens') AS provider_tokens
        FROM runs WHERE id = ?
      `).get(runId)).toEqual({ provider_turns: 2, provider_tokens: 35 });
    } finally {
      await runtime.stop();
      database.close();
    }
  }, 120_000);

  test("Autonomous safe-stops a planner action outside the signed contract before dispatch", async () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    migrateDatabase(database);
    seedAgent(database);
    const { runId } = seedRun(database, "autonomous");
    const port = new CallbackPort();
    const outsidePlanner: MissionPlannerPort = {
      async plan(input, signal) {
        const valid = await planner.plan(input, signal);
        return {
          ...valid,
          steps: valid.steps.map((step) => ({
            ...step,
            action: { ...step.action, actionType: "destructive-change" },
          })),
        };
      },
    };
    const runtime = createMissionRuntime({
      database,
      planner: outsidePlanner,
      outcomeEvaluator: evaluator,
      execution: port,
      workerId: "runtime-safe-stop-worker",
      leaseTtlMs: 10_000,
      scanIntervalMs: 100,
    });
    try {
      await expect(runtime.processRunNow(runId)).rejects.toThrow("out-of-contract action");
      expect(port.dispatched).toHaveLength(0);
      expect(runtime.repository.getRunProjection(runId)).toMatchObject({
        status: "blocked",
      });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM events
        WHERE run_id = ? AND event_type = 'run.autonomous_safe_stopped'
      `).get(runId)).toEqual({ count: 1 });
    } finally {
      await runtime.stop();
      database.close();
    }
  }, 120_000);

  test("Guided persists an explanation and exact decision, rejects a stale fingerprint, then advances only after the exact result", async () => {
    const { database, runtime, port, runId } = setup("guided");
    const app = express();
    app.use(express.json());
    app.use(createMissionRuntimeV2Router({ runtime, resolveActor: () => "operator-test" }));
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      await runtime.processRunNow(runId);
      expect(port.dispatched).toHaveLength(0);
      expect(runtime.repository.getRunProjection(runId).status).toBe("waiting_guided_decision");
      const [decision] = runtime.repository.listDecisions({ status: "pending", runId });
      expect(decision).toBeDefined();
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM messages msg
        JOIN conversations c ON c.id = msg.conversation_id
        WHERE c.run_id = ? AND msg.role = 'assistant'
      `).get(runId)).toEqual({ count: 1 });

      const stale = await fetch(`${url}/api/v2/guided-decisions/${decision!.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "guided-stale-0001" },
        body: JSON.stringify({ expectedFingerprint: "changed-parameters" }),
      });
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({ error: { code: "guided_action_changed" } });
      expect(port.dispatched).toHaveLength(0);
      expect(runtime.repository.getDecision(decision!.id).status).toBe("pending");

      const approve = await fetch(`${url}/api/v2/guided-decisions/${decision!.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "guided-approve-0001" },
        body: JSON.stringify({ expectedFingerprint: decision!.actionFingerprint, reason: "Run this exact step" }),
      });
      expect(approve.status).toBe(200);
      expect(port.dispatched).toHaveLength(1);
      expect(runtime.repository.getRunProjection(runId).status).toBe("running");

      await port.succeed();
      expect(runtime.repository.getRunProjection(runId).status).toBe("completed");
      expect(database.prepare("SELECT COUNT(*) AS count FROM actions WHERE guided_decision_id = ?").get(decision!.id))
        .toEqual({ count: 1 });
      expect(database.prepare("SELECT journey, created_by FROM run_evaluations WHERE run_id = ?").get(runId))
        .toEqual({ journey: "guided", created_by: "outcome-evaluator" });
    } finally {
      await runtime.stop();
      database.close();
    }
  }, 120_000);

  test("Guided failure explains the attempt and publishes one materially different exact recovery decision", async () => {
    const { database, runtime, port, runId } = setup("guided", guidedRecoveryPlanner);
    const app = express();
    app.use(express.json());
    app.use(createMissionRuntimeV2Router({ runtime, resolveActor: () => "operator-test" }));
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      await runtime.processRunNow(runId);
      const [initialDecision] = runtime.repository.listDecisions({ status: "pending", runId });
      expect(initialDecision).toBeDefined();
      await runtime.approveGuidedDecision(initialDecision!.id, "operator-test", "Run this exact first step");
      expect(port.dispatched).toHaveLength(1);

      await port.fail(0, "timeout");
      await runtime.processRunNow(runId).catch(() => undefined);

      expect(runtime.repository.getRunProjection(runId)).toMatchObject({
        status: "waiting_guided_decision",
      });
      expect(database.prepare(`
        SELECT status, error_category FROM actions WHERE id = ?
      `).get(port.dispatched[0]!.id)).toEqual({ status: "timed_out", error_category: "timeout" });
      expect(database.prepare(`SELECT status FROM plan_steps WHERE id = ?`).get(initialDecision!.stepId))
        .toEqual({ status: "failed" });
      expect(database.prepare(`SELECT status FROM assignments WHERE step_id = ?`).get(initialDecision!.stepId))
        .toEqual({ status: "failed" });
      expect(database.prepare(`
        SELECT replan_count, json_extract(budget_usage_json, '$.replans') AS replans
        FROM runs WHERE id = ?
      `).get(runId)).toEqual({ replan_count: 1, replans: 1 });

      const pending = runtime.repository.listDecisions({ status: "pending", runId });
      expect(pending).toHaveLength(1);
      const recoveryDecision = pending[0]!;
      expect(recoveryDecision.id).not.toBe(initialDecision!.id);
      expect(recoveryDecision.actionFingerprint).not.toBe(initialDecision!.actionFingerprint);
      expect(recoveryDecision.requestedParameters).toMatchObject({
        actionType: "alternate-reconnaissance",
        arguments: { service: "http", fallbackAfter: "https-timeout" },
      });
      expect(port.dispatched).toHaveLength(1);

      const messages = database.prepare(`
        SELECT json_extract(msg.structured_content_json, '$.kind') AS kind,
          json_extract(msg.structured_content_json, '$.errorCategory') AS error_category
        FROM messages msg JOIN conversations c ON c.id = msg.conversation_id
        WHERE c.run_id = ? AND msg.role = 'assistant'
        ORDER BY msg.created_at, msg.id
      `).all(runId) as Array<{ kind: string; error_category: string | null }>;
      expect(messages.map((message) => message.kind)).toContain("guided_failure");
      expect(messages.map((message) => message.kind)).toContain("guided_recovery_step");
      expect(messages.find((message) => message.kind === "guided_failure")?.error_category).toBe("timeout");
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM events
        WHERE run_id = ? AND event_type = 'guided.commander.recovery_ready'
      `).get(runId)).toEqual({ count: 1 });

      const stale = await fetch(`${url}/api/v2/guided-decisions/${recoveryDecision.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "guided-recovery-stale-0001" },
        body: JSON.stringify({
          expectedFingerprint: initialDecision!.actionFingerprint,
          reason: "This stale fingerprint must not authorize changed parameters",
        }),
      });
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({ error: { code: "guided_action_changed" } });
      expect(port.dispatched).toHaveLength(1);

      const approved = await fetch(`${url}/api/v2/guided-decisions/${recoveryDecision.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "guided-recovery-approve-0001" },
        body: JSON.stringify({
          expectedFingerprint: recoveryDecision.actionFingerprint,
          reason: "Run only this materially different represented recovery step",
        }),
      });
      expect(approved.status).toBe(200);
      expect(port.dispatched).toHaveLength(2);
      expect(port.dispatched[1]).toMatchObject({
        actionType: "alternate-reconnaissance",
        arguments: { service: "http", fallbackAfter: "https-timeout" },
        guidedDecisionId: recoveryDecision.id,
      });
    } finally {
      await runtime.stop();
      database.close();
    }
  }, 120_000);

  test("Guided recovery blocks precisely and creates no decision when the planner repeats the failed action", async () => {
    const volatileOnlyPlanner: MissionPlannerPort = {
      async plan(input, signal) {
        const draft = await planner.plan(input, signal);
        if (!input.rejectionReason) return draft;
        return {
          ...draft,
          strategySummary: "Claimed recovery with only volatile metadata changed",
          steps: draft.steps.map((step) => ({
            ...step,
            action: {
              ...step.action,
              arguments: {
                ...step.action.arguments,
                timestamp: "2026-07-15T00:01:00.000Z",
                traceId: "volatile-recovery-trace",
              },
            },
          })),
        };
      },
    };
    const { database, runtime, port, runId } = setup("guided", volatileOnlyPlanner);
    try {
      await runtime.processRunNow(runId);
      const [decision] = runtime.repository.listDecisions({ status: "pending", runId });
      await runtime.approveGuidedDecision(decision!.id, "operator-test", "Run the exact represented step");
      await port.fail(0, "deterministic_tool_error");
      await runtime.processRunNow(runId).catch(() => undefined);

      expect(runtime.repository.getRunProjection(runId)).toMatchObject({
        status: "blocked",
        statusReason: "Recovery was blocked because it proposed the same reconnaissance action and parameters that already failed.",
      });
      expect(runtime.repository.listDecisions({ status: "pending", runId })).toHaveLength(0);
      expect(database.prepare("SELECT COUNT(*) AS count FROM plans WHERE run_id = ?").get(runId))
        .toEqual({ count: 1 });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM messages msg
        JOIN conversations c ON c.id = msg.conversation_id
        WHERE c.run_id = ?
          AND json_extract(msg.structured_content_json, '$.kind') = 'guided_failure'
      `).get(runId)).toEqual({ count: 1 });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM events
        WHERE run_id = ? AND event_type = 'run.guided_blocked'
          AND summary LIKE '%same reconnaissance action and parameters%'
      `).get(runId)).toEqual({ count: 1 });
      expect(port.dispatched).toHaveLength(1);
    } finally {
      await runtime.stop();
      database.close();
    }
  }, 120_000);
});
