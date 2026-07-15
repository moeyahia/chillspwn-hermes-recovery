import { describe, expect, test } from "bun:test";
import { createDatabaseConnection, migrateDatabase } from "../../db";
import { MemoryRepository, type MemoryNodeType, type MemoryScope } from "../../memory";
import {
  AutonomousReadinessError,
  IdempotencyConflictError,
  MissionRepository,
  MissionService,
  MissionValidationError,
  OverviewRepository,
  ReadinessService,
  validateMissionCreateRequest,
  type AutonomousMissionRequest,
  type GuidedMissionRequest,
  type ReadinessCheckProvider,
} from "../index";

function autonomousRequest(overrides: Partial<AutonomousMissionRequest> = {}): AutonomousMissionRequest {
  return {
    journey: "autonomous",
    launch: true,
    title: "Authorized service assessment",
    objective: "Validate exposed services within the signed lab scope",
    successCriteria: ["Every approved target has evidence-backed service inventory"],
    authorization: {
      engagementId: "engagement-lab",
      allowedTargets: ["10.10.10.0/24"],
      prohibitedTargets: ["10.10.10.1"],
      authorizationConfirmed: true,
      timeWindow: "2026-07-15T00:00:00Z/2026-07-16T00:00:00Z",
      dataHandling: "Keep evidence local",
    },
    contract: {
      allowedActionClasses: ["reconnaissance"],
      prohibitedActionClasses: ["destructive"],
      destructivePolicy: "prohibited",
      evidenceRequirements: ["Hash every retained artifact"],
      timeBudgetMinutes: 60,
      tokenBudget: 50_000,
      costBudget: 10,
      retryBudget: 2,
      replanBudget: 2,
      concurrencyLimit: 3,
      evidenceStorageBudgetBytes: 64 * 1024 * 1024,
      artifactStorageBudgetBytes: 256 * 1024 * 1024,
      notificationPolicy: "in_app_only",
      reportingFormat: "command_os_json",
      dataHandlingPolicy: "local_private",
      retentionPolicy: "operator_managed",
      providerPolicy: "automatic_enforcing_only",
      toolPolicy: "contract_allowlist",
      memoryScopes: ["verified_lessons"],
      contextNodeIds: [],
      safeStopConditions: ["Target resolves outside approved scope"],
      deliverables: ["Evidence-backed mission report"],
    },
    ...overrides,
  };
}

function guidedRequest(overrides: Partial<GuidedMissionRequest> = {}): GuidedMissionRequest {
  return {
    journey: "guided",
    launch: true,
    authorizationConfirmed: true,
    title: "Guided lab assessment",
    objective: "Understand the authorized service exposure one step at a time",
    target: "lab.internal",
    engagementId: "engagement-lab",
    explanationDepth: "deep",
    executionPreference: "manual",
    evidenceExpectations: ["Retain normalized scan output"],
    ...overrides,
  };
}

function provider(
  status: "pass" | "warn" | "fail" = "pass",
  id = "runtime-enforcement",
): ReadinessCheckProvider {
  return {
    id,
    label: "Runtime enforcement",
    journeys: ["autonomous", "guided"],
    evaluate: () => ({
      id,
      label: "Runtime enforcement",
      status,
      journeys: ["autonomous", "guided"],
      impact: status === "pass" ? "Policy boundary is enforceable." : "Policy boundary is unavailable.",
      ...(status === "fail" ? { remediation: "Restore the enforcing runtime." } : {}),
    }),
  };
}

function service(
  database: ReturnType<typeof createDatabaseConnection>,
  readinessProviders: readonly ReadinessCheckProvider[] = [provider()],
): MissionService {
  return new MissionService(
    new MissionRepository(database),
    new OverviewRepository(database),
    new ReadinessService(readinessProviders),
  );
}

function count(database: ReturnType<typeof createDatabaseConnection>, table: string): number {
  return (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function memoryNode(
  database: ReturnType<typeof createDatabaseConnection>,
  input: { id: string; nodeType: MemoryNodeType; scope: MemoryScope; status: "confirmed" | "verified" },
): void {
  new MemoryRepository(database).createNode({
    id: input.id,
    nodeType: input.nodeType,
    title: `${input.nodeType} ${input.id}`,
    summary: `Canonical ${input.status} context`,
    scope: input.scope,
    sensitivity: "private",
    confidence: 0.9,
    lifecycleStatus: input.status,
    confirmationState: input.nodeType === "preference" ? "confirmed" : "not_required",
    provenance: {
      method: "operator_statement",
      explanation: "Confirmed in the focused contract test",
      sources: [{ sourceType: "test", sourceId: input.id, acquiredAt: new Date().toISOString() }],
    },
    authorType: "operator",
    retentionPolicy: { allowAutonomous: true },
  });
}

describe("Command OS mission vertical slice", () => {
  test("accepts exactly Autonomous and Guided as journeys", () => {
    expect(() =>
      validateMissionCreateRequest({
        ...guidedRequest(),
        journey: "ask",
      }),
    ).toThrow(MissionValidationError);
    expect(() =>
      validateMissionCreateRequest({
        ...guidedRequest(),
        journey: "supervised",
      }),
    ).toThrow(MissionValidationError);
    expect(validateMissionCreateRequest(guidedRequest()).journey).toBe("guided");
    expect(validateMissionCreateRequest(autonomousRequest()).journey).toBe("autonomous");
  });

  test("requires an explicit authorization assertion for Guided creation", () => {
    expect(() => validateMissionCreateRequest({
      ...guidedRequest(),
      authorizationConfirmed: false,
    })).toThrow(MissionValidationError);
  });

  test("rejects incomplete Autonomous authority, scope, action policy, budgets, and deliverables", () => {
    expect(() =>
      validateMissionCreateRequest({
        ...autonomousRequest(),
        authorization: {
          allowedTargets: [],
          prohibitedTargets: [],
          authorizationConfirmed: false,
        },
        contract: {
          ...autonomousRequest().contract,
          allowedActionClasses: [],
          timeBudgetMinutes: 0,
          concurrencyLimit: 0,
          safeStopConditions: [],
          deliverables: [],
        },
      }),
    ).toThrow(MissionValidationError);
  });

  test("rejects cross-engagement memory use without an engagement boundary and canonical target overlap", () => {
    expect(() =>
      validateMissionCreateRequest({
        ...autonomousRequest(),
        authorization: {
          ...autonomousRequest().authorization,
          engagementId: undefined,
        },
        contract: {
          ...autonomousRequest().contract,
          memoryScopes: ["engagement_memory"],
        },
      }),
    ).toThrow(MissionValidationError);
    expect(() =>
      validateMissionCreateRequest({
        ...autonomousRequest(),
        authorization: {
          ...autonomousRequest().authorization,
          allowedTargets: ["HTTP://LAB.INTERNAL"],
          prohibitedTargets: ["http://lab.internal/"],
        },
      }),
    ).toThrow(MissionValidationError);
  });

  test("creates an Autonomous aggregate, confirmed contract, targets, constraints, events, and audit atomically", async () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    try {
      migrateDatabase(database);
      const created = await service(database).create(
        autonomousRequest(),
        "autonomous-request-0001",
        "operator-1",
      );
      expect(created.run).toMatchObject({ journey: "autonomous", status: "planning" });
      expect(created.nextUrl).toBe(`/missions/${created.mission.id}`);

      const run = database
        .prepare("SELECT journey, status, contract_id FROM runs WHERE id = ?")
        .get(created.run.id) as { journey: string; status: string; contract_id: string | null };
      expect(run).toMatchObject({ journey: "autonomous", status: "planning" });
      expect(run.contract_id).not.toBeNull();
      expect(count(database, "mission_contracts")).toBe(1);
      expect(count(database, "mission_targets")).toBe(2);
      expect(count(database, "mission_constraints")).toBe(5);
      const persisted = database.prepare(`
        SELECT m.retention_policy_json, m.memory_policy_json,
          mc.contract_hash, mc.action_policy_json, mc.budgets_json
        FROM missions m JOIN runs r ON r.mission_id = m.id
        JOIN mission_contracts mc ON mc.id = r.contract_id WHERE r.id = ?
      `).get(created.run.id) as Record<string, string>;
      expect(JSON.parse(persisted.retention_policy_json)).toEqual({
        dataHandling: "local_private",
        mode: "operator_managed",
      });
      expect(JSON.parse(persisted.memory_policy_json)).toMatchObject({ exactContextNodeIds: [] });
      expect(JSON.parse(persisted.action_policy_json)).toMatchObject({
        notificationPolicy: "in_app_only",
        reportingFormat: "command_os_json",
        providerPolicy: "automatic_enforcing_only",
        toolPolicy: "contract_allowlist",
      });
      expect(JSON.parse(persisted.budgets_json)).toMatchObject({
        evidenceBytes: 64 * 1024 * 1024,
        artifactBytes: 256 * 1024 * 1024,
      });
      expect(persisted.contract_hash).toMatch(/^[a-f0-9]{64}$/u);
      expect(count(database, "events")).toBe(2);
      expect(count(database, "event_outbox")).toBe(2);
      expect(count(database, "audit_records")).toBe(1);
      expect(
        database.prepare("SELECT COUNT(*) AS count FROM runs WHERE status = 'waiting_guided_decision'").get(),
      ).toEqual({ count: 0 });
      const journeys = database
        .prepare("SELECT DISTINCT journey FROM events")
        .all() as Array<{ journey: string }>;
      expect(journeys).toEqual([{ journey: "autonomous" }]);
    } finally {
      database.close();
    }
  });

  test("previews and fail-closed validates exact confirmed preferences and verified lessons", async () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    try {
      migrateDatabase(database);
      memoryNode(database, { id: "mem-preference", nodeType: "preference", scope: { kind: "global" }, status: "confirmed" });
      memoryNode(database, { id: "mem-lesson", nodeType: "lesson", scope: { kind: "engagement", engagementId: "engagement-lab" }, status: "verified" });
      memoryNode(database, { id: "mem-cross-scope", nodeType: "lesson", scope: { kind: "engagement", engagementId: "other-engagement" }, status: "verified" });
      const missionService = service(database);
      const requested = autonomousRequest({
        contract: {
          ...autonomousRequest().contract,
          memoryScopes: ["confirmed_preferences", "verified_lessons", "engagement_memory"],
          contextNodeIds: ["mem-preference", "mem-lesson"],
        },
      });
      const preview = await missionService.preflightAutonomous(requested);
      expect(preview.readiness.status).toBe("ready");
      expect(preview.context.candidates.map((candidate) => candidate.id).sort()).toEqual([
        "mem-lesson",
        "mem-preference",
      ]);
      expect(preview.context.selectedNodeIds).toEqual(["mem-preference", "mem-lesson"]);
      expect(preview.context.invalidSelectedNodeIds).toEqual([]);

      const invalid = await missionService.preflightAutonomous({
        ...requested,
        contract: { ...requested.contract, contextNodeIds: ["mem-cross-scope"] },
      });
      expect(invalid.readiness.status).toBe("blocked");
      expect(invalid.context.invalidSelectedNodeIds).toEqual(["mem-cross-scope"]);

      const created = await missionService.create(
        { ...requested, contractReview: preview.contract },
        "exact-memory-contract-001",
        "operator-1",
      );
      const policy = database.prepare(`
        SELECT mc.action_policy_json FROM runs r
        JOIN mission_contracts mc ON mc.id = r.contract_id WHERE r.id = ?
      `).get(created.run.id) as { action_policy_json: string };
      expect(JSON.parse(policy.action_policy_json).contextNodeIds).toEqual(["mem-preference", "mem-lesson"]);
    } finally {
      database.close();
    }
  });

  test("creates a durable Guided mission without inventing an Autonomous contract", async () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    try {
      migrateDatabase(database);
      const created = await service(database).create(
        guidedRequest(),
        "guided-request-0000001",
        "operator-1",
      );
      expect(created.run).toEqual({
        id: created.run.id,
        journey: "guided",
        status: "planning",
      });
      expect(created.nextUrl).toBe(`/guided/${created.mission.id}`);
      expect(count(database, "mission_contracts")).toBe(0);
      expect(count(database, "mission_targets")).toBe(1);
      expect(count(database, "mission_constraints")).toBe(1);
      const mission = database
        .prepare("SELECT authorization_status FROM missions WHERE id = ?")
        .get(created.mission.id) as { authorization_status: string };
      expect(mission.authorization_status).toBe("verified");
    } finally {
      database.close();
    }
  });

  test("blocks Autonomous launch on a real failed readiness check without partial writes", async () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    try {
      migrateDatabase(database);
      const action = service(database, [provider("fail")]).create(
        autonomousRequest(),
        "blocked-request-00001",
        "operator-1",
      );
      await expect(action).rejects.toBeInstanceOf(AutonomousReadinessError);
      expect(count(database, "missions")).toBe(0);
      expect(count(database, "runs")).toBe(0);
      expect(count(database, "settings")).toBe(0);
    } finally {
      database.close();
    }
  });

  test("replays one successful idempotent mutation and rejects key reuse with a different contract", async () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    try {
      migrateDatabase(database);
      let checks = 0;
      const dynamicProvider: ReadinessCheckProvider = {
        ...provider(),
        evaluate: () => {
          checks += 1;
          return provider(checks === 1 ? "pass" : "fail").evaluate({});
        },
      };
      const missionService = service(database, [dynamicProvider]);
      const first = await missionService.create(
        autonomousRequest(),
        "stable-request-key-001",
        "operator-1",
      );
      const replay = await missionService.create(
        autonomousRequest(),
        "stable-request-key-001",
        "operator-1",
      );
      expect(replay).toEqual(first);
      expect(checks).toBe(1);
      expect(count(database, "missions")).toBe(1);
      expect(count(database, "events")).toBe(2);
      await expect(
        missionService.create(
          autonomousRequest({ title: "Different mission" }),
          "stable-request-key-001",
          "operator-1",
        ),
      ).rejects.toBeInstanceOf(IdempotencyConflictError);
    } finally {
      database.close();
    }
  });

  test("rolls back the entire aggregate when durable event delivery cannot be recorded", async () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    try {
      migrateDatabase(database);
      database.exec(`
        CREATE TRIGGER reject_mission_outbox
        BEFORE INSERT ON event_outbox BEGIN
          SELECT RAISE(ABORT, 'mission outbox unavailable');
        END;
      `);
      await service(database)
        .create(autonomousRequest(), "rollback-request-001", "operator-1")
        .catch((error: unknown) => expect(String(error)).toContain("mission outbox unavailable"));
      for (const table of [
        "missions",
        "runs",
        "mission_targets",
        "mission_constraints",
        "mission_contracts",
        "events",
        "audit_records",
        "settings",
      ]) {
        expect(count(database, table)).toBe(0);
      }
    } finally {
      database.close();
    }
  });

  test("paginates missions with opaque cursors and returns real overview state", async () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    try {
      migrateDatabase(database);
      const missionService = service(database, [provider("warn")]);
      await missionService.create(guidedRequest({ title: "Mission A" }), "page-request-0001", "operator");
      await missionService.create(guidedRequest({ title: "Mission B" }), "page-request-0002", "operator");
      await missionService.create(guidedRequest({ title: "Mission C" }), "page-request-0003", "operator");

      const first = missionService.list({ limit: 2 });
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();
      const second = missionService.list({ limit: 2, cursor: first.nextCursor! });
      expect(second.items).toHaveLength(1);
      expect(second.nextCursor).toBeNull();
      expect(new Set([...first.items, ...second.items].map((mission) => mission.id)).size).toBe(3);

      const overview = await missionService.getOverview();
      expect(overview.schemaVersion).toBe("2.1");
      expect(overview.readiness).toMatchObject({ status: "degraded", score: 65 });
      expect(overview.summary.activeMissions).toBe(3);
      expect(overview.missions).toHaveLength(3);
      expect(overview.system.database).toBe("healthy");
      expect(overview.system.providers).toBe("unknown");
      expect(overview.agents).toEqual([]);
    } finally {
      database.close();
    }
  });
});
