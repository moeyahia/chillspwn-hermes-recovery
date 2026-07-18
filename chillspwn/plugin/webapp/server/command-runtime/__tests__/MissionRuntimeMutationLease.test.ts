import { afterEach, describe, expect, test } from "bun:test";
import {
  ControlPlaneLeaseError,
  ControlPlaneLeaseService,
  RunMutationAuthorityGuard,
} from "../../control-plane";
import {
  createDatabaseConnection,
  migrateDatabase,
  type SqliteDatabase,
} from "../../db";
import type { DurableAction } from "../../orchestration";
import {
  createMissionRuntime,
  type MissionPlannerPort,
  type ResultAwareExecutionPort,
} from "..";

const START = Date.parse("2026-07-17T10:00:00.000Z");
const databases: SqliteDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

class TestClock {
  private value = START;
  now = (): Date => new Date(this.value);
  advance(milliseconds: number): void { this.value += milliseconds; }
}

class NoopExecution implements ResultAwareExecutionPort {
  async dispatch(_action: DurableAction, _signal: AbortSignal): Promise<void> {}
  async resume(_action: DurableAction, _signal: AbortSignal): Promise<void> {}
  async cancelRun(_runId: string, _reason: string): Promise<void> {}
}

function database(): SqliteDatabase {
  const connection = createDatabaseConnection({ filename: ":memory:" });
  databases.push(connection);
  migrateDatabase(connection);
  return connection;
}

function seed(connection: SqliteDatabase, suffix: string): {
  readonly missionId: string;
  readonly runId: string;
} {
  const now = new Date(START).toISOString();
  const missionId = `mission-mutation-lease-${suffix}`;
  const runId = `run-mutation-lease-${suffix}`;
  connection.prepare(`
    INSERT INTO missions (
      id, name, objective, journey, status, authorization_status,
      created_by, created_at, updated_at, control_plane
    ) VALUES (?, 'Mutation lease fixture', 'Preserve mutation authority',
      'autonomous', 'active', 'verified', 'operator:test', ?, ?,
      'command_os_v2')
  `).run(missionId, now, now);
  connection.prepare(`
    INSERT INTO runs (
      id, mission_id, journey, status, status_reason,
      budget_json, budget_usage_json, created_at, updated_at,
      version, control_plane
    ) VALUES (?, ?, 'autonomous', 'planning', 'Awaiting bounded work',
      '{}', '{}', ?, ?, 1, 'command_os_v2')
  `).run(runId, missionId, now, now);
  return { missionId, runId };
}

function runtime(input: {
  readonly database: SqliteDatabase;
  readonly clock: TestClock;
  readonly workerId: string;
}) {
  const planner: MissionPlannerPort = {
    async plan() {
      throw new Error("Mutation lease tests never invoke planning");
    },
  };
  return createMissionRuntime({
    database: input.database,
    planner,
    outcomeEvaluator: {
      async evaluate() {
        throw new Error("Mutation lease tests never evaluate a run");
      },
    },
    execution: new NoopExecution(),
    workerId: input.workerId,
    leaseTtlMs: 5_000,
    now: input.clock.now,
  });
}

function expectLeaseError(
  callback: () => unknown,
  code: ControlPlaneLeaseError["code"],
): void {
  try {
    callback();
    throw new Error("Expected mutation authority to fail closed");
  } catch (error) {
    expect(error).toBeInstanceOf(ControlPlaneLeaseError);
    expect((error as ControlPlaneLeaseError).code).toBe(code);
  }
}

describe("MissionRuntimeEngine production mutation lease bridge", () => {
  test("acquires and heartbeats a non-secret proof only for its current durable lease", async () => {
    const connection = database();
    const clock = new TestClock();
    const fixture = seed(connection, "owner");
    const engine = runtime({ database: connection, clock, workerId: "runtime-owner" });
    try {
      let durableLease = engine.coordinator.acquireRunLease(
        fixture.runId,
        "runtime-owner",
        5_000,
      );
      const first = engine.assertRunMutationLease({
        ...fixture,
        actorId: "operator:test",
      });
      expect(first).toMatchObject({
        runId: fixture.runId,
        controlPlane: "command_os_v2",
        leaseOwner: "runtime-owner",
        version: 1,
      });
      expect(Object.hasOwn(first, "leaseToken")).toBe(false);
      const stored = connection.prepare(`
        SELECT lease_token_hash, acquired_at, version
        FROM control_plane_leases WHERE run_id = ?
      `).get(fixture.runId) as {
        lease_token_hash: string;
        acquired_at: string;
        version: number;
      };
      expect(stored.lease_token_hash).toHaveLength(64);
      expect(JSON.stringify(first)).not.toContain(stored.lease_token_hash);

      clock.advance(1_000);
      durableLease = engine.coordinator.heartbeatRunLease(durableLease, 5_000);
      const second = engine.assertRunMutationLease({
        ...fixture,
        actorId: "operator:test",
      });
      expect(second.acquiredAt).toBe(first.acquiredAt);
      expect(second.heartbeatAt).not.toBe(first.heartbeatAt);
      expect(second.version).toBe(2);
      expect(Date.parse(second.expiresAt)).toBeLessThanOrEqual(Date.parse(durableLease.expiresAt));

      const authorized = new RunMutationAuthorityGuard(connection, clock.now).authorize({
        runId: fixture.runId,
        actorId: "operator:test",
        mode: "lease",
        assertLease: engine.assertRunMutationLease,
      });
      expect(authorized.scope).toEqual(fixture);
      expect(() => authorized.assertCurrent()).not.toThrow();
    } finally {
      await engine.stop();
    }
  });

  test("fails closed for no lease, another worker, an expired lease, and a wrong mission", async () => {
    const connection = database();
    const clock = new TestClock();

    const missing = seed(connection, "missing");
    const missingEngine = runtime({ database: connection, clock, workerId: "runtime-missing" });
    expectLeaseError(
      () => missingEngine.assertRunMutationLease({ ...missing, actorId: "operator:test" }),
      "lease_missing",
    );

    const other = seed(connection, "other");
    missingEngine.coordinator.acquireRunLease(other.runId, "another-worker", 5_000);
    expectLeaseError(
      () => missingEngine.assertRunMutationLease({ ...other, actorId: "operator:test" }),
      "lease_fence_invalid",
    );

    const wrongMission = seed(connection, "wrong-mission");
    missingEngine.coordinator.acquireRunLease(wrongMission.runId, "runtime-missing", 5_000);
    expectLeaseError(
      () => missingEngine.assertRunMutationLease({
        missionId: "mission-not-the-run-owner",
        runId: wrongMission.runId,
        actorId: "operator:test",
      }),
      "control_plane_mismatch",
    );

    const expired = seed(connection, "expired");
    missingEngine.coordinator.acquireRunLease(expired.runId, "runtime-missing", 1_000);
    clock.advance(1_000);
    expectLeaseError(
      () => missingEngine.assertRunMutationLease({ ...expired, actorId: "operator:test" }),
      "lease_expired",
    );

    await missingEngine.stop();
    expectLeaseError(
      () => missingEngine.assertRunMutationLease({ ...wrongMission, actorId: "operator:test" }),
      "lease_missing",
    );
  });

  test("process restart cannot reuse a raw token and fences the prior proof after expiry", async () => {
    const connection = database();
    const clock = new TestClock();
    const fixture = seed(connection, "restart");
    const first = runtime({ database: connection, clock, workerId: "runtime-before-restart" });
    first.coordinator.acquireRunLease(fixture.runId, "runtime-before-restart", 1_000);
    const oldProof = first.assertRunMutationLease({
      ...fixture,
      actorId: "operator:test",
    });

    clock.advance(1_001);
    const restarted = runtime({ database: connection, clock, workerId: "runtime-after-restart" });
    restarted.coordinator.acquireRunLease(fixture.runId, "runtime-after-restart", 5_000);
    const newProof = restarted.assertRunMutationLease({
      ...fixture,
      actorId: "operator:test",
    });
    expect(newProof.leaseOwner).toBe("runtime-after-restart");
    expect(newProof.acquiredAt).not.toBe(oldProof.acquiredAt);
    expect(newProof.version).toBeGreaterThan(oldProof.version);
    expect(() => new ControlPlaneLeaseService(connection)
      .assertCurrentLeaseProof(oldProof, clock.now())).toThrow(ControlPlaneLeaseError);

    await first.stop();
    await restarted.stop();
  });
});
