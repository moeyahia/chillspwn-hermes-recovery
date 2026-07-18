import { describe, expect, test } from "bun:test";
import { createDatabaseConnection, migrateDatabase } from "../../db";
import { RuntimeContinuationRepository } from "../RuntimeContinuationRepository";

function fixture() {
  const database = createDatabaseConnection({ filename: ":memory:" });
  migrateDatabase(database);
  const now = "2026-07-15T00:00:00.000Z";
  database.prepare(`
    INSERT INTO missions (
      id, name, objective, journey, status, authorization_status,
      success_criteria_json, memory_policy_json, created_by, created_at, updated_at
    ) VALUES ('mission-continuation', 'Continuation mission', 'Exercise continuation fencing',
      'guided', 'active', 'verified', '[]', '{}', 'operator', ?, ?)
  `).run(now, now);
  database.prepare(`
    INSERT INTO runs (
      id, mission_id, journey, status, budget_json, budget_usage_json,
      status_reason, created_at, updated_at, version
    ) VALUES ('run-continuation', 'mission-continuation', 'guided', 'running',
      '{}', '{}', 'Continuation fixture', ?, ?, 1)
  `).run(now, now);
  return { database, repository: new RuntimeContinuationRepository(database), now };
}

describe("RuntimeContinuationRepository", () => {
  test("post-claim writes fail closed when either run or mission ownership transfers", () => {
    for (const ownership of ["run", "mission"] as const) {
      for (const operation of ["heartbeat", "complete", "retry", "fail"] as const) {
        const { database, repository, now } = fixture();
        try {
          const pending = repository.enqueue({
            runId: "run-continuation",
            kind: "evaluation_pending",
            sourceId: `plan-${ownership}-${operation}`,
            now,
          });
          const claimed = repository.claimNext({
            runId: pending.runId,
            workerId: "worker-before-transfer",
            now,
            leaseTtlMs: 1_000,
          })!;
          database.prepare(`UPDATE ${ownership === "run" ? "runs" : "missions"}
            SET control_plane = 'legacy' WHERE id = ?`)
            .run(ownership === "run" ? pending.runId : "mission-continuation");

          const invoke = () => {
            if (operation === "heartbeat") {
              return repository.heartbeat(
                pending.id,
                claimed.leaseOwner!,
                "2026-07-15T00:00:00.100Z",
                1_000,
              );
            }
            if (operation === "complete") {
              return repository.complete(
                pending.id,
                claimed.leaseOwner!,
                "2026-07-15T00:00:00.100Z",
              );
            }
            if (operation === "retry") {
              return repository.retry({
                id: pending.id,
                ownerToken: claimed.leaseOwner!,
                now: "2026-07-15T00:00:00.100Z",
                availableAt: "2026-07-15T00:00:02.000Z",
                error: "retry only while V2 owns the run",
              });
            }
            return repository.fail({
              id: pending.id,
              ownerToken: claimed.leaseOwner!,
              now: "2026-07-15T00:00:00.100Z",
              error: "fail only while V2 owns the run",
            });
          };

          const fenceLabel = operation === "complete"
            ? "completion"
            : operation === "fail"
              ? "failure"
              : operation;
          expect(invoke).toThrow(`${fenceLabel} fence lost`);
          expect(repository.get(pending.id)).toMatchObject({
            status: "processing",
            leaseOwner: claimed.leaseOwner,
            leaseExpiresAt: claimed.leaseExpiresAt,
            completedAt: null,
            lastError: null,
          });
        } finally {
          database.close();
        }
      }

      const { database, repository, now } = fixture();
      try {
        const pending = repository.enqueue({
          runId: "run-continuation",
          kind: "evaluation_pending",
          sourceId: `plan-${ownership}-cancel`,
          now,
        });
        const claimed = repository.claimNext({
          runId: pending.runId,
          workerId: "worker-before-transfer",
          now,
          leaseTtlMs: 1_000,
        })!;
        database.prepare(`UPDATE ${ownership === "run" ? "runs" : "missions"}
          SET control_plane = 'legacy' WHERE id = ?`)
          .run(ownership === "run" ? pending.runId : "mission-continuation");

        expect(repository.cancelOpen(
          pending.runId,
          "2026-07-15T00:00:00.100Z",
          "terminal state observed after transfer",
        )).toBe(0);
        expect(repository.get(pending.id)).toMatchObject({
          status: "processing",
          leaseOwner: claimed.leaseOwner,
          leaseExpiresAt: claimed.leaseExpiresAt,
          lastError: null,
        });
      } finally {
        database.close();
      }
    }
  });

  test("deduplicates source transitions and owner-fences an expired processing claim", () => {
    const { database, repository, now } = fixture();
    try {
      const first = repository.enqueue({
        runId: "run-continuation",
        kind: "action_result_to_advance",
        sourceId: "action-1",
        payload: { actionId: "action-1", stepId: "step-1" },
        now,
      });
      const replay = repository.enqueue({
        runId: "run-continuation",
        kind: "action_result_to_advance",
        sourceId: "action-1",
        payload: { ignored: true },
        now,
      });
      expect(replay.id).toBe(first.id);
      expect(replay.payload).toEqual({ actionId: "action-1", stepId: "step-1" });
      expect(repository.listForRun("run-continuation")).toHaveLength(1);

      const ownerA = repository.claimNext({
        runId: "run-continuation",
        workerId: "worker-a",
        now,
        leaseTtlMs: 1_000,
      });
      expect(ownerA).toMatchObject({ status: "processing", attemptCount: 1 });
      expect(ownerA!.leaseOwner).toContain(`worker-a:${first.id}:1`);
      expect(repository.readyRunIds("2026-07-15T00:00:00.500Z")).toEqual([]);

      expect(() => repository.complete(
        first.id,
        ownerA!.leaseOwner!,
        "2026-07-15T00:00:01.001Z",
      )).toThrow("completion fence lost");

      const ownerB = repository.claimNext({
        runId: "run-continuation",
        workerId: "worker-b",
        now: "2026-07-15T00:00:01.001Z",
        leaseTtlMs: 1_000,
      });
      expect(ownerB).toMatchObject({ status: "processing", attemptCount: 2 });
      expect(ownerB!.leaseOwner).toContain(`worker-b:${first.id}:2`);
      expect(() => repository.complete(first.id, ownerA!.leaseOwner!, "2026-07-15T00:00:01.002Z"))
        .toThrow("completion fence lost");

      const completed = repository.complete(
        first.id,
        ownerB!.leaseOwner!,
        "2026-07-15T00:00:01.003Z",
      );
      expect(completed).toMatchObject({ status: "completed", attemptCount: 2 });
      expect(completed.leaseOwner).toBeNull();
      expect(repository.readyRunIds("2026-07-15T00:00:02.000Z")).toEqual([]);
    } finally {
      database.close();
    }
  });

  test("releases a failed handler without leaking raw error length", () => {
    const { database, repository, now } = fixture();
    try {
      const pending = repository.enqueue({
        runId: "run-continuation",
        kind: "evaluation_pending",
        sourceId: "plan-1",
        now,
      });
      const claimed = repository.claimNext({
        runId: pending.runId,
        workerId: "worker-a",
        now,
        leaseTtlMs: 1_000,
      })!;
      const retry = repository.retry({
        id: pending.id,
        ownerToken: claimed.leaseOwner!,
        now,
        availableAt: "2026-07-15T00:00:05.000Z",
        error: `Authorization: Bearer supersecret1234567890 ${"x".repeat(2_000)}`,
      });
      expect(retry.status).toBe("pending");
      expect(retry.lastError!.length).toBeLessThanOrEqual(512);
      expect(retry.lastError).toContain("REDACTED AUTHENTICATION MATERIAL");
      expect(retry.lastError).not.toContain("supersecret1234567890");
      expect(repository.readyRunIds("2026-07-15T00:00:04.999Z")).toEqual([]);
      expect(repository.readyRunIds("2026-07-15T00:00:05.000Z")).toEqual([pending.runId]);
    } finally {
      database.close();
    }
  });
});
