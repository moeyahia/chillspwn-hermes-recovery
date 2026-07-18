import { expect, test } from "bun:test";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  createMissionRuntime,
  type MissionOutcomeEvaluatorPort,
  type MissionPlannerPort,
  type ResultAwareExecutionPort,
} from "../../command-runtime";
import { createDatabaseConnection, migrateDatabase } from "../../db";
import type { DurableAction } from "../../orchestration";
import { createMissionRuntimeV2Router } from "../missionRuntimeV2Routes";

class NoopExecution implements ResultAwareExecutionPort {
  async dispatch(_action: DurableAction, _signal: AbortSignal): Promise<void> {}
  async resume(_action: DurableAction, _signal: AbortSignal): Promise<void> {}
  async cancelRun(_runId: string): Promise<void> {}
}

const planner: MissionPlannerPort = {
  async plan() { throw new Error("Planning is outside this idempotency recovery test"); },
};

const evaluator: MissionOutcomeEvaluatorPort = {
  async evaluate() { return { success: false, summary: "No evaluation required", criteria: [] }; },
};

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("real SQLite route reconciliation recovers a post-commit pause crash without mutating twice", async () => {
  const database = createDatabaseConnection({ filename: ":memory:" });
  let server: Server | undefined;
  try {
    migrateDatabase(database);
    const seededAt = "2026-07-17T23:00:00.000Z";
    database.prepare(`
      INSERT INTO missions (
        id, name, objective, journey, status, authorization_status,
        created_by, created_at, updated_at, control_plane
      ) VALUES (
        'mission-receipt-crash', 'Receipt crash recovery',
        'Pause one V2 run at a durable zero-work boundary', 'guided', 'active',
        'verified', 'operator:test', ?, ?, 'command_os_v2'
      )
    `).run(seededAt, seededAt);
    database.prepare(`
      INSERT INTO runs (
        id, mission_id, journey, status, status_reason, next_action_summary,
        budget_json, budget_usage_json, started_at, created_at, updated_at,
        version, control_plane
      ) VALUES (
        'run-receipt-crash', 'mission-receipt-crash', 'guided', 'running',
        'Running without in-flight work', 'Pause at the requested boundary',
        '{}', '{}', ?, ?, ?, 1, 'command_os_v2'
      )
    `).run(seededAt, seededAt, seededAt);

    let injectCrash = true;
    const runtime = createMissionRuntime({
      database,
      planner,
      outcomeEvaluator: evaluator,
      execution: new NoopExecution(),
      workerId: "receipt-crash-worker",
      leaseTtlMs: 2_000,
      scanIntervalMs: 60_000,
      now: () => new Date(),
      crashAfterCommit(point) {
        if (injectCrash && point === "pause_projection_committed") {
          injectCrash = false;
          throw new Error("Simulated process loss after the durable pause commit");
        }
      },
    });
    const app = express();
    app.use(express.json());
    app.use(createMissionRuntimeV2Router({ runtime, resolveActor: () => "operator:test" }));
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server?.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const request: RequestInit = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "real-pause-post-commit-crash",
      },
      body: JSON.stringify({ reason: "Pause exactly once for operator review" }),
    };

    const interrupted = await fetch(`${base}/api/v2/runs/run-receipt-crash/pause`, request);
    expect(interrupted.status).toBe(500);
    expect(await interrupted.json()).toMatchObject({
      error: { code: "command_runtime_internal_error" },
    });
    const committedRun = database.prepare(`
      SELECT status, version FROM runs WHERE id = 'run-receipt-crash'
    `).get() as { status: string; version: number };
    expect(committedRun.status).toBe("blocked");
    expect(committedRun.version).toBeGreaterThan(1);
    expect(database.prepare(`
      SELECT json_extract(details_json, '$.committedRunVersion') AS committed_version
      FROM audit_records
      WHERE run_id = 'run-receipt-crash' AND action = 'run.paused'
    `).get()).toEqual({ committed_version: committedRun.version });
    expect(database.prepare(`
      SELECT state FROM runtime_mutation_receipts
      WHERE receipt_key LIKE 'idempotency.runtime.run.pause.%'
    `).get()).toEqual({ state: "failed" });

    const recovered = await fetch(`${base}/api/v2/runs/run-receipt-crash/pause`, request);
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({
      schemaVersion: "2.4",
      run: { id: "run-receipt-crash", status: "blocked", version: committedRun.version },
      latestCheckpoint: {
        state: { run: { state: "blocked", stateVersion: committedRun.version } },
      },
    });
    expect(database.prepare(`
      SELECT state FROM runtime_mutation_receipts
      WHERE receipt_key LIKE 'idempotency.runtime.run.pause.%'
    `).get()).toEqual({ state: "succeeded" });

    const replay = await fetch(`${base}/api/v2/runs/run-receipt-crash/pause`, request);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      run: { status: "blocked", version: committedRun.version },
    });
    expect(database.prepare(`
      SELECT count(*) AS count FROM audit_records
      WHERE run_id = 'run-receipt-crash' AND action = 'run.paused'
    `).get()).toEqual({ count: 1 });
  } finally {
    if (server) await close(server);
    database.close();
  }
});
