import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createDatabaseConnection, DATABASE_MIGRATIONS, migrateDatabase } from "../../db";
import { hashJson } from "../../orchestration/serialization";
import {
  RuntimeRepository,
  type RuntimeIdempotencyFailure,
} from "../RuntimeRepository";

function insertGuidedRun(
  database: ReturnType<typeof createDatabaseConnection>,
  missionId = "mission-1",
  runId = "run-1",
): void {
  const now = "2026-07-17T00:00:00.000Z";
  database.prepare(`
    INSERT INTO missions (
      id, name, objective, journey, created_by, created_at, updated_at
    ) VALUES (?, 'Receipt recovery mission', 'Exercise one exact mutation',
      'guided', 'operator-a', ?, ?)
  `).run(missionId, now, now);
  database.prepare(`
    INSERT INTO runs (
      id, mission_id, journey, status, created_at, updated_at, version,
      control_plane
    ) VALUES (?, ?, 'guided', 'running', ?, ?, 1, 'command_os_v2')
  `).run(runId, missionId, now, now);
}

function receiptKey(scope: string, key: string): string {
  return `idempotency.runtime.${scope}.${createHash("sha256").update(key, "utf8").digest("hex")}`;
}

describe("RuntimeRepository idempotency reservations", () => {
  test("binds a reservation to actor and request before work starts", () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    try {
      migrateDatabase(database);
      const repository = new RuntimeRepository(database);
      const request = { actorId: "operator-a", body: { reason: "Run the represented step" } };
      const reserved = repository.reserveIdempotent(
        "decision.approve",
        "approve-once",
        request,
        "operator-a",
        "2026-07-17T00:00:00.000Z",
      );
      expect(reserved.status).toBe("reserved");

      expect(() => repository.reserveIdempotent(
        "decision.approve",
        "approve-once",
        request,
        "operator-a",
        "2026-07-17T00:00:01.000Z",
      )).toThrow("earlier command with this key has no final response");
      expect(() => repository.reserveIdempotent(
        "decision.approve",
        "approve-once",
        { actorId: "operator-b", body: request.body },
        "operator-b",
        "2026-07-17T00:00:01.000Z",
      )).toThrow("different request or actor");
    } finally {
      database.close();
    }
  });

  test("completes only through the exact owner token and replays the canonical response", () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    try {
      migrateDatabase(database);
      const repository = new RuntimeRepository(database);
      const request = { actorId: "operator-a", params: { runId: "run-1" }, body: {} };
      const reserved = repository.reserveIdempotent(
        "run.pause",
        "pause-once",
        request,
        "operator-a",
        "2026-07-17T00:00:00.000Z",
      );
      if (reserved.status !== "reserved") throw new Error("Fixture did not reserve the mutation");

      expect(() => repository.completeIdempotent(
        "run.pause",
        "pause-once",
        request,
        "forged-owner-token",
        { schemaVersion: "2.4", status: "blocked" },
        "operator-a",
        "2026-07-17T00:00:01.000Z",
      )).toThrow("reservation changed");

      const response = { schemaVersion: "2.4", status: "blocked", runId: "run-1" } as const;
      repository.completeIdempotent(
        "run.pause",
        "pause-once",
        request,
        reserved.ownerToken,
        response,
        "operator-a",
        "2026-07-17T00:00:02.000Z",
      );
      expect(repository.reserveIdempotent(
        "run.pause",
        "pause-once",
        request,
        "operator-a",
        "2026-07-17T00:00:03.000Z",
      )).toEqual({ status: "replay", response });
    } finally {
      database.close();
    }
  });

  test("heartbeats preserve an active owner, then expiry fences it and permits only reconciled recovery", () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    try {
      migrateDatabase(database);
      insertGuidedRun(database);
      const repository = new RuntimeRepository(database);
      const request = {
        actorId: "operator-a",
        params: { runId: "run-1" },
        body: { reason: "Pause at the represented boundary" },
      };
      const original = repository.reserveIdempotent(
        "run.pause",
        "pause-heartbeat",
        request,
        "operator-a",
        "2026-07-17T00:00:00.000Z",
        1_000,
      );
      if (original.status !== "reserved") throw new Error("Fixture did not reserve the mutation");
      repository.heartbeatIdempotent(
        "run.pause",
        "pause-heartbeat",
        request,
        original.ownerToken,
        "operator-a",
        "2026-07-17T00:00:00.500Z",
        1_000,
      );

      expect(() => repository.reserveIdempotent(
        "run.pause",
        "pause-heartbeat",
        request,
        "operator-a",
        "2026-07-17T00:00:01.100Z",
        1_000,
      )).toThrow("earlier command with this key has no final response");

      const recovered = repository.reserveIdempotent(
        "run.pause",
        "pause-heartbeat",
        request,
        "operator-a",
        "2026-07-17T00:00:01.501Z",
        1_000,
      );
      expect(recovered).toMatchObject({ status: "reserved", recoveryRequired: true });
      if (recovered.status !== "reserved") throw new Error("Fixture did not recover the mutation");
      expect(repository.reconcileIdempotentReservation(
        "run.pause",
        "pause-heartbeat",
        request,
        recovered.ownerToken,
        "operator-a",
        "2026-07-17T00:00:01.502Z",
      )).toEqual({ status: "not_committed" });
      expect(() => repository.completeIdempotent(
        "run.pause",
        "pause-heartbeat",
        request,
        original.ownerToken,
        { status: "stale" },
        "operator-a",
        "2026-07-17T00:00:01.503Z",
      )).toThrow("reservation changed");
    } finally {
      database.close();
    }
  });

  test("reconciles a post-domain-commit crash from immutable audit without repeating the mutation", () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    try {
      migrateDatabase(database);
      insertGuidedRun(database);
      const repository = new RuntimeRepository(database);
      const request = {
        actorId: "operator-a",
        params: { runId: "run-1" },
        body: { reason: "Pause before changing the plan" },
      };
      const original = repository.reserveIdempotent(
        "run.pause",
        "pause-post-commit",
        request,
        "operator-a",
        "2026-07-17T00:00:00.000Z",
        1_000,
      );
      if (original.status !== "reserved") throw new Error("Fixture did not reserve the mutation");

      database.prepare(`
        UPDATE runs SET status = 'blocked', status_reason = 'Paused by operator',
          version = 2, updated_at = '2026-07-17T00:00:00.400Z'
        WHERE id = 'run-1'
      `).run();
      repository.appendAudit({
        missionId: "mission-1",
        runId: "run-1",
        actorId: "operator-a",
        action: "run.paused",
        resourceType: "run",
        resourceId: "run-1",
        reason: "Pause before changing the plan",
        details: { committedRunVersion: 2, checkpointId: null, checkpointEventSequence: 0 },
        now: "2026-07-17T00:00:00.400Z",
      });

      const recovered = repository.reserveIdempotent(
        "run.pause",
        "pause-post-commit",
        request,
        "operator-a",
        "2026-07-17T00:00:01.001Z",
        1_000,
      );
      expect(recovered).toMatchObject({ status: "reserved", recoveryRequired: true });
      if (recovered.status !== "reserved") throw new Error("Fixture did not recover the mutation");
      expect(repository.reconcileIdempotentReservation(
        "run.pause",
        "pause-post-commit",
        request,
        recovered.ownerToken,
        "operator-a",
        "2026-07-17T00:00:01.002Z",
      )).toEqual({
        status: "committed",
        auditDetails: { committedRunVersion: 2, checkpointId: null, checkpointEventSequence: 0 },
      });

      const response = { schemaVersion: "2.4", run: { id: "run-1", status: "blocked", version: 2 } } as const;
      repository.completeIdempotent(
        "run.pause",
        "pause-post-commit",
        request,
        recovered.ownerToken,
        response,
        "operator-a",
        "2026-07-17T00:00:01.003Z",
      );
      expect(repository.reserveIdempotent(
        "run.pause",
        "pause-post-commit",
        request,
        "operator-a",
        "2026-07-17T00:00:01.004Z",
      )).toEqual({ status: "replay", response });
      expect(database.prepare(`
        SELECT count(*) AS count FROM audit_records
        WHERE action = 'run.paused' AND resource_id = 'run-1'
      `).get()).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });

  test("fails closed when an abandoned receipt sees changed state without an exact audit proof", () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    try {
      migrateDatabase(database);
      insertGuidedRun(database);
      const repository = new RuntimeRepository(database);
      const request = {
        actorId: "operator-a",
        params: { runId: "run-1" },
        body: { reason: "Pause only once" },
      };
      repository.reserveIdempotent(
        "run.pause",
        "pause-indeterminate",
        request,
        "operator-a",
        "2026-07-17T00:00:00.000Z",
        1_000,
      );
      database.prepare("UPDATE runs SET version = 2 WHERE id = 'run-1'").run();
      const recovered = repository.reserveIdempotent(
        "run.pause",
        "pause-indeterminate",
        request,
        "operator-a",
        "2026-07-17T00:00:01.001Z",
        1_000,
      );
      if (recovered.status !== "reserved") throw new Error("Fixture did not recover the mutation");
      expect(repository.reconcileIdempotentReservation(
        "run.pause",
        "pause-indeterminate",
        request,
        recovered.ownerToken,
        "operator-a",
        "2026-07-17T00:00:01.002Z",
      )).toEqual({ status: "indeterminate" });
    } finally {
      database.close();
    }
  });

  test("terminalizes and replays the exact sanitized failure instead of leaving an in-progress tombstone", () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    try {
      migrateDatabase(database);
      insertGuidedRun(database);
      const repository = new RuntimeRepository(database);
      const request = {
        actorId: "operator-a",
        params: { runId: "run-1" },
        body: { reason: "Pause with a validated request" },
      };
      const reserved = repository.reserveIdempotent(
        "run.pause",
        "pause-terminal-failure",
        request,
        "operator-a",
        "2026-07-17T00:00:00.000Z",
      );
      if (reserved.status !== "reserved") throw new Error("Fixture did not reserve the mutation");
      const failure: RuntimeIdempotencyFailure = {
        status: 409,
        code: "represented_boundary_changed",
        message: "Represented boundary changed",
        humanMessage: "Refresh the current run before trying again.",
        retryable: false,
        category: "conflict",
        details: { protectedValue: "[REDACTED]" },
        remediation: "Refresh the run.",
      };
      repository.failIdempotent(
        "run.pause",
        "pause-terminal-failure",
        request,
        reserved.ownerToken,
        failure,
        "operator-a",
        "2026-07-17T00:00:00.100Z",
      );

      expect(repository.reserveIdempotent(
        "run.pause",
        "pause-terminal-failure",
        request,
        "operator-a",
        "2026-07-17T00:10:00.000Z",
      )).toEqual({ status: "failure", error: failure });
      expect(() => repository.reserveIdempotent(
        "run.pause",
        "pause-terminal-failure",
        { ...request, actorId: "operator-b" },
        "operator-b",
        "2026-07-17T00:10:00.000Z",
      )).toThrow("different request or actor");
    } finally {
      database.close();
    }
  });

  test("migrates legacy settings receipts while expiring interrupted rows for fail-closed reconciliation", () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    try {
      migrateDatabase(database, DATABASE_MIGRATIONS.slice(0, 13));
      const successfulRequest = { actorId: "operator-a", params: { runId: "run-1" }, body: {} };
      const interruptedRequest = {
        actorId: "operator-a",
        params: { runId: "run-2" },
        body: { reason: "Pause once" },
      };
      const insert = database.prepare(`
        INSERT INTO settings (
          key, value_json, sensitivity, version, updated_by, updated_at
        ) VALUES (?, ?, 'private', 1, 'operator-a', ?)
      `);
      insert.run(
        receiptKey("run.pause", "legacy-success"),
        JSON.stringify({
          requestHash: hashJson(successfulRequest),
          response: { schemaVersion: "2.4", runId: "run-1", status: "blocked" },
        }),
        "2026-07-16T23:00:00.000Z",
      );
      insert.run(
        receiptKey("run.pause", "legacy-interrupted"),
        JSON.stringify({
          requestHash: hashJson(interruptedRequest),
          actorId: "operator-a",
          state: "in_progress",
          ownerToken: "legacy-owner",
          startedAt: "2026-07-16T23:30:00.000Z",
        }),
        "2026-07-16T23:30:00.000Z",
      );

      expect(migrateDatabase(database).applied.map((migration) => migration.version)).toEqual([14]);
      const repository = new RuntimeRepository(database);
      expect(repository.reserveIdempotent(
        "run.pause",
        "legacy-success",
        successfulRequest,
        "operator-a",
        "2026-07-17T00:00:00.000Z",
      )).toEqual({
        status: "replay",
        response: { schemaVersion: "2.4", runId: "run-1", status: "blocked" },
      });
      const recovered = repository.reserveIdempotent(
        "run.pause",
        "legacy-interrupted",
        interruptedRequest,
        "operator-a",
        "2026-07-17T00:00:00.000Z",
      );
      expect(recovered).toMatchObject({ status: "reserved", recoveryRequired: true });
      if (recovered.status !== "reserved") throw new Error("Fixture did not recover the migration receipt");
      expect(repository.reconcileIdempotentReservation(
        "run.pause",
        "legacy-interrupted",
        interruptedRequest,
        recovered.ownerToken,
        "operator-a",
        "2026-07-17T00:00:00.100Z",
      )).toEqual({ status: "indeterminate" });
    } finally {
      database.close();
    }
  });
});
