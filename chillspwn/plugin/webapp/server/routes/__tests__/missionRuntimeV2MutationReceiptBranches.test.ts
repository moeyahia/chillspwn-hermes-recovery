import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import {
  CommandRuntimeError,
  createMissionRuntime,
  type MissionOutcomeEvaluatorPort,
  type MissionPlannerPort,
  type ResultAwareExecutionPort,
  type ResumeRunBoundary,
} from "../../command-runtime";
import { RuntimeRepository } from "../../command-runtime/RuntimeRepository";
import { createDatabaseConnection, migrateDatabase, type SqliteDatabase } from "../../db";
import type { DurableAction } from "../../orchestration";
import { canonicalJson } from "../../orchestration/serialization";
import { createMissionRuntimeV2Router } from "../missionRuntimeV2Routes";

const servers: Server[] = [];
const databases: SqliteDatabase[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
  for (const database of databases.splice(0)) database.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

class NoopExecution implements ResultAwareExecutionPort {
  async dispatch(_action: DurableAction, _signal: AbortSignal): Promise<void> {}
  async resume(_action: DurableAction, _signal: AbortSignal): Promise<void> {}
  async cancelRun(_runId: string): Promise<void> {}
}

const basePlanner: MissionPlannerPort = {
  async plan(input) {
    return {
      strategySummary: "Collect one bounded observation and retain its result",
      rationaleSummary: "One reversible observation is sufficient for this receipt fixture",
      steps: [{
        phase: "reconnaissance",
        title: "Inspect the authorized service",
        objective: "Collect one attributable service result",
        explanation: "Check the approved lab service without changing it.",
        rationale: "This is the smallest reversible action that advances the objective.",
        successCriteria: ["One attributable result is retained"],
        assignedAgentId: "ReconScout",
        riskClass: "low",
        reversibility: "Read-only and reversible",
        action: {
          actionType: "reconnaissance",
          actionClass: "reconnaissance",
          target: input.mission.allowedTargets[0]!,
          arguments: {
            mcpServer: "sechub-reconnaissance",
            toolName: "quick_scan",
            arguments: { service: "https" },
          },
          intentSummary: "Inspect the approved service",
          kind: "tool" as const,
          idempotent: true,
          destructive: false,
        },
      }],
    };
  },
};

const rejectionRecoveryPlanner: MissionPlannerPort = {
  async plan(input, signal) {
    const draft = await basePlanner.plan(input, signal);
    if (!input.rejectionReason) return draft;
    return {
      ...draft,
      strategySummary: "Use a materially different bounded observation after rejection",
      rationaleSummary: `The operator requested another approach: ${input.rejectionReason}`,
      steps: draft.steps.map((step) => ({
        ...step,
        title: "Inspect the alternate approved service path",
        action: {
          ...step.action,
          actionType: "alternate-reconnaissance",
          arguments: {
            mcpServer: "sechub-reconnaissance",
            toolName: "quick_scan",
            arguments: { service: "http", selectedAfter: "operator-rejection" },
          },
          intentSummary: "Inspect a different approved service path",
        },
      })),
    };
  },
};

const manualPlanner: MissionPlannerPort = {
  async plan(input, signal) {
    const draft = await basePlanner.plan(input, signal);
    return {
      ...draft,
      steps: draft.steps.map((step) => ({
        ...step,
        title: "Inspect the approved service manually",
        action: {
          ...step.action,
          kind: "manual" as const,
          arguments: {
            command: "curl --fail --silent https://lab.internal/health",
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

const twoStepPlanner: MissionPlannerPort = {
  async plan(input, signal) {
    const draft = await basePlanner.plan(input, signal);
    const first = draft.steps[0]!;
    return {
      ...draft,
      strategySummary: "Offer two bounded observations with an exact decision at each step",
      steps: [
        first,
        {
          ...first,
          title: "Inspect the alternate approved service",
          objective: "Collect an alternate result if the first observation is skipped",
          dependencyOrdinals: [0],
          action: {
            ...first.action,
            actionType: "alternate-reconnaissance",
            arguments: {
              mcpServer: "sechub-reconnaissance",
              toolName: "quick_scan",
              arguments: { service: "http" },
            },
            intentSummary: "Inspect the alternate approved service",
          },
        },
      ],
    };
  },
};

const evaluator: MissionOutcomeEvaluatorPort = {
  async evaluate(input) {
    const succeeded = input.completedActionIds.length > 0;
    return {
      success: succeeded,
      summary: succeeded ? "The retained result satisfies the fixture" : "No result was retained",
      criteria: [{
        criterion: "One attributable result is retained",
        satisfied: succeeded,
        explanation: succeeded ? "A completed action is durable" : "No completed action exists",
        evidenceIds: [],
      }],
    };
  },
};

function seedGuidedPlanningRun(database: SqliteDatabase, suffix: string): {
  missionId: string;
  runId: string;
} {
  const now = new Date(Date.now() - 60_000).toISOString();
  const missionId = `mission-receipt-${suffix}`;
  const runId = `run-receipt-${suffix}`;
  database.prepare(`
    INSERT INTO agents (
      id, role, display_name, status, tool_policy_json, version, created_at, updated_at
    ) VALUES ('ReconScout', 'reconnaissance', 'Recon specialist', 'available',
      '{"allowedTools":["quick_scan"],"deniedTools":[],"approvalRequiredTools":[]}',
      'receipt-test-1', ?, ?)
  `).run(now, now);
  database.prepare(`
    INSERT INTO agent_capabilities (agent_id, capability, source, enabled, metadata_json)
    VALUES ('ReconScout', 'quick_scan', 'receipt-test-attestation', 1, '{}')
  `).run();
  database.prepare(`
    INSERT INTO mcp_servers (
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
    INSERT INTO missions (
      id, name, objective, journey, status, authorization_status,
      success_criteria_json, memory_policy_json, created_by, created_at,
      updated_at, control_plane
    ) VALUES (?, 'Mutation receipt fixture', 'Retain one bounded result',
      'guided', 'active', 'verified', '["One attributable result is retained"]',
      '{}', 'operator:test', ?, ?, 'command_os_v2')
  `).run(missionId, now, now);
  database.prepare(`
    INSERT INTO mission_targets (
      id, mission_id, target, target_type, disposition, normalized_target, created_at
    ) VALUES (?, ?, 'lab.internal', 'domain', 'allowed', 'lab.internal', ?)
  `).run(`target-receipt-${suffix}`, missionId, now);
  database.prepare(`
    INSERT INTO runs (
      id, mission_id, journey, status, budget_json, budget_usage_json,
      status_reason, next_action_summary, started_at, created_at, updated_at,
      version, control_plane
    ) VALUES (?, ?, 'guided', 'planning',
      '{"toolCalls":5,"concurrency":1,"retries":1,"replans":2}', '{}',
      'Planning the receipt fixture', 'Build one bounded plan', ?, ?, ?, 1,
      'command_os_v2')
  `).run(runId, missionId, now, now, now);
  return { missionId, runId };
}

function createEngine(
  database: SqliteDatabase,
  planner: MissionPlannerPort,
  workerId: string,
) {
  return createMissionRuntime({
    database,
    planner,
    outcomeEvaluator: evaluator,
    execution: new NoopExecution(),
    workerId,
    leaseTtlMs: 5_000,
    scanIntervalMs: 60_000,
    now: () => new Date(),
  });
}

async function startApplication(runtime: ReturnType<typeof createEngine>): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use(createMissionRuntimeV2Router({ runtime, resolveActor: () => "operator:test" }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function setup(
  suffix: string,
  planner: MissionPlannerPort = basePlanner,
) {
  const database = createDatabaseConnection({ filename: ":memory:" });
  databases.push(database);
  migrateDatabase(database);
  const ids = seedGuidedPlanningRun(database, suffix);
  const runtime = createEngine(database, planner, `receipt-worker-${suffix}`);
  await runtime.processRunNow(ids.runId);
  const decision = runtime.repository.listDecisions({
    runId: ids.runId,
    status: "pending",
    limit: 10,
  })[0];
  if (!decision) throw new Error("Fixture planning did not create a pending Guided decision");
  const base = await startApplication(runtime);
  return { database, runtime, decision, base, ...ids };
}

function receiptKey(scope: string, key: string): string {
  return `idempotency.runtime.${scope}.${createHash("sha256").update(key, "utf8").digest("hex")}`;
}

function expireReceipt(database: SqliteDatabase, scope: string, key: string): void {
  const updated = database.prepare(`
    UPDATE runtime_mutation_receipts
    SET lease_expires_at = '1970-01-01T00:00:00.000Z',
      updated_at = '1970-01-01T00:00:00.000Z'
    WHERE receipt_key = ? AND state = 'in_progress'
  `).run(receiptKey(scope, key));
  expect(updated.changes).toBe(1);
}

function crashNextReceiptWrite(runtime: ReturnType<typeof createEngine>): void {
  const original = runtime.repository.completeIdempotent.bind(runtime.repository);
  let pending = true;
  runtime.repository.completeIdempotent = (...parameters) => {
    if (pending) {
      pending = false;
      throw new CommandRuntimeError(
        500,
        "receipt_write_test_crash",
        "Simulated process loss before the mutation response receipt was written",
        { category: "internal" },
      );
    }
    return original(...parameters);
  };
}

function decisionRequest(
  decision: ReturnType<RuntimeRepository["getDecision"]>,
  key: string,
  reason: string,
  extra: Record<string, unknown> = {},
): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({
      expectedFingerprint: decision.actionFingerprint,
      expectedParameters: decision.requestedParameters,
      reason,
      ...extra,
    }),
  };
}

function auditCount(database: SqliteDatabase, action: string, resourceId: string): number {
  return (database.prepare(`
    SELECT count(*) AS count FROM audit_records
    WHERE action = ? AND resource_id = ?
  `).get(action, resourceId) as { count: number }).count;
}

function insertInterpretedEvidence(
  database: SqliteDatabase,
  input: {
    missionId: string;
    runId: string;
    stepId: string;
    fingerprint: string;
    evidenceId: string;
  },
): void {
  const now = new Date().toISOString();
  const content = "HTTP/1.1 200 OK\n\nok";
  const contentHash = createHash("sha256").update(content, "utf8").digest("hex");
  database.prepare(`
    INSERT INTO evidence (
      id, mission_id, run_id, step_id, action_id, source, acquired_at,
      target, evidence_type, content_hash, provenance_json, confidence,
      sensitivity, verification_state, summary, extracted_text,
      artifact_id, created_by, created_at
    ) VALUES (?, ?, ?, ?, NULL, 'guided.operator_upload', ?, 'lab.internal',
      'guided_text_result', ?, ?, 0.7, 'private', 'unverified', ?, ?, NULL,
      'operator:test', ?)
  `).run(
    input.evidenceId,
    input.missionId,
    input.runId,
    input.stepId,
    now,
    contentHash,
    canonicalJson({
      representedActionFingerprint: input.fingerprint,
      byteSize: Buffer.byteLength(content, "utf8"),
    }),
    "Operator output awaiting exact-step acceptance",
    content,
    now,
  );
  database.prepare(`
    INSERT INTO evidence_chain_events (
      id, evidence_id, event_type, actor, details_json, occurred_at
    ) VALUES (?, ?, 'interpreted', 'guided-test-interpreter', ?, ?)
  `).run(
    `chain-${input.evidenceId}`,
    input.evidenceId,
    canonicalJson({
      summary: "The approved local health check returned the expected ok marker",
      assistantMessageId: "message-receipt-fixture",
      contextPackId: null,
    }),
    now,
  );
}

describe("real SQLite mutation receipt response reconstruction", () => {
  test("reconstructs run.resume after its domain commit survives the response-receipt write", async () => {
    const fixture = await setup("resume");
    const pause = await fetch(`${fixture.base}/api/v2/runs/${fixture.runId}/pause`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "prepare-resume-boundary" },
      body: JSON.stringify({ reason: "Prepare the exact blocked checkpoint" }),
    });
    expect(pause.status).toBe(200);
    const run = fixture.runtime.repository.getRunProjection(fixture.runId);
    const checkpoint = fixture.runtime.coordinator.getLatestCheckpoint(fixture.runId);
    if (!checkpoint || run.status !== "blocked") throw new Error("Pause did not create a resume boundary");
    const boundary: ResumeRunBoundary = {
      expectedRunVersion: run.version,
      expectedRunStatus: "blocked",
      expectedCheckpointId: checkpoint.id,
      expectedCheckpointStateHash: checkpoint.stateHash,
      expectedCheckpointEventSequence: checkpoint.eventSequence,
    };
    const key = "resume-after-receipt-write-crash";
    const request: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ reason: "Resume this exact represented checkpoint", ...boundary }),
    };
    crashNextReceiptWrite(fixture.runtime);

    const interrupted = await fetch(`${fixture.base}/api/v2/runs/${fixture.runId}/resume`, request);
    expect(interrupted.status).toBe(500);
    expect(await interrupted.json()).toMatchObject({ error: { code: "receipt_write_test_crash" } });
    expect(fixture.runtime.repository.getRunProjection(fixture.runId).status)
      .toBe("waiting_guided_decision");
    expect(auditCount(fixture.database, "run.resumed", fixture.runId)).toBe(1);
    expireReceipt(fixture.database, "run.resume", key);

    const recovered = await fetch(`${fixture.base}/api/v2/runs/${fixture.runId}/resume`, request);
    expect(recovered.status).toBe(200);
    const recoveredBody = await recovered.json();
    expect(recoveredBody).toMatchObject({
      schemaVersion: "2.4",
      run: { id: fixture.runId, status: "waiting_guided_decision" },
    });
    const replay = await fetch(`${fixture.base}/api/v2/runs/${fixture.runId}/resume`, request);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(recoveredBody);
    expect(auditCount(fixture.database, "run.resumed", fixture.runId)).toBe(1);
  });

  test("reconstructs run.cancel after terminal state survives the response-receipt write", async () => {
    const fixture = await setup("cancel");
    const key = "cancel-after-receipt-write-crash";
    const request: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ reason: "Cancel the represented run once" }),
    };
    crashNextReceiptWrite(fixture.runtime);

    const interrupted = await fetch(`${fixture.base}/api/v2/runs/${fixture.runId}/cancel`, request);
    expect(interrupted.status).toBe(500);
    expect(fixture.runtime.repository.getRunProjection(fixture.runId).status).toBe("cancelled");
    expect(auditCount(fixture.database, "run.cancelled", fixture.runId)).toBe(1);
    expireReceipt(fixture.database, "run.cancel", key);

    const recovered = await fetch(`${fixture.base}/api/v2/runs/${fixture.runId}/cancel`, request);
    expect(recovered.status).toBe(200);
    const recoveredBody = await recovered.json();
    expect(recoveredBody).toMatchObject({ run: { id: fixture.runId, status: "cancelled" } });
    const replay = await fetch(`${fixture.base}/api/v2/runs/${fixture.runId}/cancel`, request);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(recoveredBody);
    expect(auditCount(fixture.database, "run.cancelled", fixture.runId)).toBe(1);
    expect(fixture.database.prepare(`
      SELECT count(*) AS count FROM events
      WHERE run_id = ? AND event_type = 'run.cancelled'
    `).get(fixture.runId)).toEqual({ count: 1 });
  });

  const guidedCases = [
    {
      name: "reject",
      planner: rejectionRecoveryPlanner,
      endpoint: "reject",
      scope: "decision.reject",
      reason: "Use a different bounded observation",
      auditAction: "guided.decision_rejected",
      responseStatus: "rejected",
      decisionStatus: "rejected",
    },
    {
      name: "skip",
      planner: twoStepPlanner,
      endpoint: "skip",
      scope: "decision.skip",
      reason: "This first optional observation is unnecessary",
      auditAction: "guided.decision_skipped",
      responseStatus: "skipped",
      decisionStatus: "cancelled",
    },
    {
      name: "stop",
      planner: basePlanner,
      endpoint: "stop",
      scope: "decision.stop",
      reason: "Stop after retaining enough information",
      auditAction: "guided.mission_stopped",
      responseStatus: "cancelled",
      decisionStatus: "cancelled",
    },
  ] as const;

  for (const item of guidedCases) {
    test(`reconstructs Guided ${item.name} without applying its domain mutation twice`, async () => {
      const fixture = await setup(`guided-${item.name}`, item.planner);
      const key = `guided-${item.name}-after-receipt-write-crash`;
      const request = decisionRequest(fixture.decision, key, item.reason);
      crashNextReceiptWrite(fixture.runtime);
      const endpoint = `${fixture.base}/api/v2/guided-decisions/${fixture.decision.id}/${item.endpoint}`;

      const interrupted = await fetch(endpoint, request);
      expect(interrupted.status).toBe(500);
      expect(fixture.runtime.repository.getDecision(fixture.decision.id).status)
        .toBe(item.decisionStatus);
      expect(auditCount(fixture.database, item.auditAction, fixture.decision.id)).toBe(1);
      expireReceipt(fixture.database, item.scope, key);

      const recovered = await fetch(endpoint, request);
      expect(recovered.status).toBe(200);
      const recoveredBody = await recovered.json();
      expect(recoveredBody).toMatchObject({
        schemaVersion: "2.4",
        decisionId: fixture.decision.id,
        status: item.responseStatus,
      });
      const replay = await fetch(endpoint, request);
      expect(replay.status).toBe(200);
      expect(await replay.json()).toEqual(recoveredBody);
      expect(auditCount(fixture.database, item.auditAction, fixture.decision.id)).toBe(1);
    });
  }

  test("reconstructs Guided manual-result with its verified derivative evidence", async () => {
    const fixture = await setup("guided-manual", manualPlanner);
    const sourceEvidenceId = "evidence-interpreted-source";
    insertInterpretedEvidence(fixture.database, {
      missionId: fixture.missionId,
      runId: fixture.runId,
      stepId: fixture.decision.stepId,
      fingerprint: fixture.decision.actionFingerprint,
      evidenceId: sourceEvidenceId,
    });
    const key = "guided-manual-after-receipt-write-crash";
    const request = decisionRequest(
      fixture.decision,
      key,
      "Accept the interpreted result for this exact step",
      { evidenceId: sourceEvidenceId },
    );
    const endpoint = `${fixture.base}/api/v2/guided-decisions/${fixture.decision.id}/manual-result`;
    crashNextReceiptWrite(fixture.runtime);

    const interrupted = await fetch(endpoint, request);
    expect(interrupted.status).toBe(500);
    expect(fixture.runtime.repository.getDecision(fixture.decision.id).status).toBe("manual");
    expect(auditCount(fixture.database, "guided.manual_result_recorded", fixture.decision.id)).toBe(1);
    expect(fixture.database.prepare(`
      SELECT count(*) AS count FROM actions WHERE guided_decision_id = ?
    `).get(fixture.decision.id)).toEqual({ count: 1 });
    expireReceipt(fixture.database, "decision.manual", key);

    const recovered = await fetch(endpoint, request);
    expect(recovered.status).toBe(200);
    const recoveredBody = await recovered.json() as {
      status: string;
      receipt: { actionId: string; evidenceIds: string[]; duplicate: boolean };
    };
    expect(recoveredBody).toMatchObject({
      status: "manual",
      receipt: { duplicate: true },
    });
    expect(recoveredBody.receipt.evidenceIds).toHaveLength(1);
    expect(recoveredBody.receipt.evidenceIds[0]).not.toBe(sourceEvidenceId);
    expect(fixture.database.prepare(`
      SELECT id FROM evidence
      WHERE id = ? AND action_id = ? AND verification_state = 'verified'
        AND json_extract(provenance_json, '$.originalEvidenceId') = ?
    `).get(
      recoveredBody.receipt.evidenceIds[0]!,
      recoveredBody.receipt.actionId,
      sourceEvidenceId,
    )).toBeDefined();
    const replay = await fetch(endpoint, request);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(recoveredBody);
    expect(auditCount(fixture.database, "guided.manual_result_recorded", fixture.decision.id)).toBe(1);
    expect(fixture.database.prepare(`
      SELECT count(*) AS count FROM actions WHERE guided_decision_id = ?
    `).get(fixture.decision.id)).toEqual({ count: 1 });
  });
});

describe("migration 014 receipt fencing across two SQLite connections", () => {
  test("allows exactly one connection to reclaim an expired receipt and fences both stale contenders", async () => {
    const directory = mkdtempSync(join(tmpdir(), "command-os-v2-receipt-race-"));
    temporaryDirectories.push(directory);
    const filename = join(directory, "receipts.sqlite");
    const firstDatabase = createDatabaseConnection({ filename });
    databases.push(firstDatabase);
    migrateDatabase(firstDatabase);
    const secondDatabase = createDatabaseConnection({ filename, fileMustExist: true });
    databases.push(secondDatabase);
    expect(firstDatabase.prepare(`
      SELECT max(version) AS version FROM schema_migrations
    `).get()).toEqual({ version: 14 });
    expect(secondDatabase.prepare(`
      SELECT max(version) AS version FROM schema_migrations
    `).get()).toEqual({ version: 14 });

    const firstRepository = new RuntimeRepository(firstDatabase);
    const secondRepository = new RuntimeRepository(secondDatabase);
    const request = {
      actorId: "operator:test",
      params: { runId: "run-not-yet-created" },
      body: { reason: "Reserve one fenced cancellation receipt" },
    };
    const original = firstRepository.reserveIdempotent(
      "run.cancel",
      "two-connection-expired-reclaim",
      request,
      "operator:test",
      "2026-07-18T03:00:00.000Z",
      1_000,
    );
    if (original.status !== "reserved") throw new Error("Initial receipt was not reserved");

    const contenders = await Promise.allSettled([
      Promise.resolve().then(() => firstRepository.reserveIdempotent(
        "run.cancel",
        "two-connection-expired-reclaim",
        request,
        "operator:test",
        "2026-07-18T03:00:01.001Z",
        1_000,
      )),
      Promise.resolve().then(() => secondRepository.reserveIdempotent(
        "run.cancel",
        "two-connection-expired-reclaim",
        request,
        "operator:test",
        "2026-07-18T03:00:01.001Z",
        1_000,
      )),
    ]);
    const fulfilled = contenders.filter((result) => result.status === "fulfilled");
    const rejected = contenders.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const winner = fulfilled[0]!;
    if (winner.status !== "fulfilled" || winner.value.status !== "reserved") {
      throw new Error("Expired receipt had no recovery owner");
    }
    expect(winner.value.recoveryRequired).toBe(true);
    expect(rejected[0]).toMatchObject({
      status: "rejected",
      reason: { code: "idempotency_request_in_progress" },
    });
    expect(() => firstRepository.completeIdempotent(
      "run.cancel",
      "two-connection-expired-reclaim",
      request,
      original.ownerToken,
      { status: "stale-owner-must-not-publish" },
      "operator:test",
      "2026-07-18T03:00:01.002Z",
    )).toThrow("reservation changed");
    expect(firstDatabase.prepare(`
      SELECT owner_token, state FROM runtime_mutation_receipts WHERE receipt_key = ?
    `).get(receiptKey("run.cancel", "two-connection-expired-reclaim"))).toEqual({
      owner_token: winner.value.ownerToken,
      state: "in_progress",
    });
  });
});
