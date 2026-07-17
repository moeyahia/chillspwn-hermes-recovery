import { describe, expect, test } from "bun:test";
import { createDatabaseConnection, migrateDatabase } from "../../db";
import { canonicalLessonMemoryNodeId } from "../../learning/AttackChainLessonRepository";
import { MemoryRepository } from "../../memory";
import { createGrokMissionPlanner } from "../CommandOsRuntimeAdapters";
import { commitPlanningContextAttribution } from "../../command-runtime/PlanningContextAttribution";
import {
  createMissionRuntime,
  type ResultAwareExecutionPort,
} from "../../command-runtime";

const NOW = "2026-07-15T14:30:00.000Z";

function seed(database: ReturnType<typeof createDatabaseConnection>, includeSelection = true): {
  mission: Parameters<ReturnType<typeof createGrokMissionPlanner>["plan"]>[0]["mission"];
  run: Parameters<ReturnType<typeof createGrokMissionPlanner>["plan"]>[0]["run"];
  selectedNodeId: string;
  unselectedNodeId: string;
} {
  database.prepare(`
    INSERT INTO missions (
      id, name, objective, journey, status, authorization_status, engagement_id,
      success_criteria_json, memory_policy_json, created_by, created_at, updated_at
    ) VALUES (
      'mission-reuse', 'Selective reuse', 'Collect a fresh verified service observation',
      'autonomous', 'active', 'verified', 'eng-reuse', '["Fresh evidence retained"]',
      '{}', 'operator', ?, ?
    )
  `).run(NOW, NOW);
  database.prepare(`
    INSERT INTO mission_targets (
      id, mission_id, target, target_type, disposition, normalized_target, created_at
    ) VALUES (
      'target-reuse', 'mission-reuse', 'lab.internal', 'domain', 'allowed', 'lab.internal', ?
    )
  `).run(NOW);
  database.prepare(`
    INSERT INTO mission_contracts (
      id, mission_id, version, state, contract_hash, authorization_json,
      action_policy_json, budgets_json, safe_stop_json, deliverables_json,
      memory_scopes_json, confirmed_by, confirmed_at, created_at
    ) VALUES (
      'contract-reuse', 'mission-reuse', 1, 'confirmed', ?, '{}',
      '{"allowedActionClasses":["reconnaissance"],"prohibitedActionClasses":[],"destructivePolicy":"prohibited","specialistAgentIds":["ReconScout"],"contextNodeIds":[]}',
      '{"retries":2,"replans":1}', '{}', '[]', '["verified_lessons"]',
      'operator', ?, ?
    )
  `).run("b".repeat(64), NOW, NOW);
  database.prepare(`
    INSERT INTO runs (
      id, mission_id, journey, status, contract_id, budget_json, budget_usage_json,
      status_reason, next_action_summary, started_at, created_at, updated_at
    ) VALUES (
      'run-reuse', 'mission-reuse', 'autonomous', 'planning', 'contract-reuse',
      '{"retries":2,"replans":1}', '{}', 'Planning selective reuse',
      'Build one bounded plan', ?, ?, ?
    )
  `).run(NOW, NOW, NOW);

  const memory = new MemoryRepository(database, { clock: () => new Date(NOW) });
  const createLesson = (lessonId: string, statement: string) => {
    database.prepare(`
      INSERT INTO lessons (
        id, statement, lesson_type, applicability_scope, engagement_id, mission_id,
        confidence, expected_benefit, risk, status, authoring_agent_id,
        reviewed_by, reviewed_at, created_at, updated_at
      ) VALUES (?, ?, 'strategy', 'engagement', 'eng-reuse', 'mission-reuse', 0.9,
        'Improve evidence quality', 'low', 'verified', 'agent-evaluator',
        'reviewer-independent', ?, ?, ?)
    `).run(lessonId, statement, NOW, NOW, NOW);
    const nodeId = canonicalLessonMemoryNodeId(lessonId);
    memory.createNode({
      id: nodeId,
      nodeType: "lesson",
      title: statement,
      summary: statement,
      body: "Use the bounded read-only observation only when it remains in the signed scope.",
      scope: { kind: "engagement", engagementId: "eng-reuse" },
      sensitivity: "internal",
      confidence: 0.9,
      lifecycleStatus: "verified",
      confirmationState: "not_required",
      provenance: {
        method: "derived",
        explanation: "Projected from an independently reviewed lesson.",
        sources: [{ sourceType: "lesson", sourceId: lessonId, acquiredAt: NOW }],
      },
      authorType: "operator",
      authorId: "reviewer-independent",
      retentionPolicy: {
        allowAutonomous: true,
        allowGuided: true,
        publicProviderDisclosure: "sanitized",
      },
    });
    return nodeId;
  };
  const selectedNodeId = createLesson("lesson-selected", "Reuse the bounded evidence-producing observation");
  const unselectedNodeId = createLesson("lesson-unselected", "This verified lesson was not selected for the follow-up");
  if (includeSelection) {
    database.prepare(`
      INSERT INTO run_context_selections (
        id, run_id, node_id, lesson_id, selection_type, selected_by, reason, selected_at
      ) VALUES (
        'selection-reuse', 'run-reuse', ?, 'lesson-selected', 'verified_lesson',
        'operator', 'Use only this verified lesson in the follow-up plan', ?
      )
    `).run(selectedNodeId, NOW);
  }

  return {
    mission: {
      id: "mission-reuse",
      name: "Selective reuse",
      objective: "Collect a fresh verified service observation",
      journey: "autonomous",
      engagementId: "eng-reuse",
      authorizationStatus: "verified",
      allowedTargets: ["lab.internal"],
      prohibitedTargets: [],
      successCriteria: ["Fresh evidence retained"],
      memoryPolicy: {},
    },
    run: {
      id: "run-reuse",
      missionId: "mission-reuse",
      journey: "autonomous",
      state: "planning",
      replanCount: 0,
      currentPlanVersion: null,
      previousStrategySummary: null,
      stateReason: "Planning selective reuse",
    },
    selectedNodeId,
    unselectedNodeId,
  };
}

function planJson(contextNodeId: string): string {
  return JSON.stringify({
    strategySummary: "Apply one selected context item to a fresh bounded observation",
    rationaleSummary: "The permitted context supports the smallest evidence-producing action",
    steps: [{
      phase: "reconnaissance",
      title: "Observe the authorized service",
      objective: "Collect fresh immutable evidence",
      explanation: "The read-only observation validates the service without changing it.",
      rationale: "It remains within the signed scope.",
      successCriteria: ["Fresh service evidence retained"],
      dependencyOrdinals: [],
      assignedAgentId: "ReconScout",
      riskClass: "low",
      reversibility: "Read-only",
      action: {
        actionType: "reconnaissance",
        actionClass: "reconnaissance",
        target: "lab.internal",
        arguments: { mcpServer: "local-selftest", toolName: "observe", arguments: {} },
        intentSummary: "Observe the authorized service",
        kind: "tool",
        idempotent: true,
        destructive: false,
      },
    }],
    contextUsed: [{
      id: contextNodeId,
      influence: "Selected the evidence-producing read-only observation and avoided an unproductive repeat.",
    }],
  });
}

function plannerInventory() {
  return [{
    agentId: "ReconScout",
    role: "reconnaissance",
    description: "Collects bounded service evidence",
    mcpServer: "local-selftest",
    toolNames: ["observe"],
    safetyBoundaries: ["Read-only fixture target"],
  }] as const;
}

describe("follow-up verified lesson planning attribution", () => {
  test("retrieves only the exact selected Autonomous lesson and records reuse only when the planner cites it", async () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    migrateDatabase(database);
    try {
      const fixture = seed(database);
      let prompt = "";
      const planner = createGrokMissionPlanner({
        database,
        inventory: plannerInventory,
        callGrok: async (value) => {
          prompt = value;
          return planJson(fixture.selectedNodeId);
        },
      });

      const planned = await planner.plan({ mission: fixture.mission, run: fixture.run }, new AbortController().signal);
      const draft = "plan" in planned ? planned.plan : planned;
      expect(database.prepare(`SELECT COUNT(*) AS count FROM lesson_usage WHERE run_id = 'run-reuse'`).get())
        .toEqual({ count: 0 });
      commitPlanningContextAttribution(database, draft.planningAttribution, {
        missionId: fixture.mission.id,
        runId: fixture.run.id,
        journey: fixture.run.journey,
        usedAt: NOW,
      });
      expect(prompt).toContain(fixture.selectedNodeId);
      expect(prompt).toContain("Reuse the bounded evidence-producing observation");
      expect(prompt).not.toContain(fixture.unselectedNodeId);
      expect(prompt).not.toContain("This verified lesson was not selected for the follow-up");
      expect(database.prepare(`
        SELECT lu.lesson_id, lu.run_id, lu.context_pack_id, lu.influence_summary,
          mci.used, mci.corrected
        FROM lesson_usage lu
        JOIN memory_context_items mci
          ON mci.context_pack_id = lu.context_pack_id AND mci.node_id = ?
        WHERE lu.run_id = 'run-reuse'
      `).get(fixture.selectedNodeId)).toMatchObject({
        lesson_id: "lesson-selected",
        run_id: "run-reuse",
        used: 1,
        corrected: 0,
        influence_summary: "Selected the evidence-producing read-only observation and avoided an unproductive repeat.",
      });
      expect(database.prepare(`
        SELECT event_type, context_pack_id,
          json_extract(payload_json, '$.lessonId') AS lesson_id
        FROM events WHERE run_id = 'run-reuse' AND event_type = 'learning.lesson_reused'
      `).get()).toMatchObject({
        event_type: "learning.lesson_reused",
        lesson_id: "lesson-selected",
      });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM lesson_usage WHERE lesson_id = 'lesson-unselected'
      `).get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  test("does not disclose or attribute a lesson projected under a noncanonical memory node ID", async () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    migrateDatabase(database);
    try {
      const fixture = seed(database, false);
      const poisonedNodeId = "mem_poisoned_lesson_projection";
      new MemoryRepository(database, { clock: () => new Date(NOW) }).createNode({
        id: poisonedNodeId,
        nodeType: "lesson",
        title: "Poisoned lesson projection",
        summary: "This body must never reach the planner.",
        body: "CANARY_NONCANONICAL_LESSON_BODY",
        scope: { kind: "engagement", engagementId: "eng-reuse" },
        sensitivity: "internal",
        confidence: 0.99,
        lifecycleStatus: "verified",
        confirmationState: "not_required",
        provenance: {
          method: "derived",
          explanation: "Forged projection used to prove fail-closed revalidation.",
          sources: [{ sourceType: "lesson", sourceId: "lesson-selected", acquiredAt: NOW }],
        },
        authorType: "agent",
        authorId: "poison-fixture",
        retentionPolicy: {
          allowAutonomous: true,
          allowGuided: true,
          publicProviderDisclosure: "sanitized",
        },
      });
      database.prepare(`
        INSERT INTO run_context_selections (
          id, run_id, node_id, lesson_id, selection_type, selected_by, reason, selected_at
        ) VALUES (
          'selection-poisoned-id', 'run-reuse', ?, 'lesson-selected', 'verified_lesson',
          'operator', 'Adversarial noncanonical projection fixture', ?
        )
      `).run(poisonedNodeId, NOW);
      let prompt = "";
      const planner = createGrokMissionPlanner({
        database,
        inventory: plannerInventory,
        callGrok: async (value) => {
          prompt = value;
          return planJson(poisonedNodeId);
        },
      });

      const planned = await planner.plan({ mission: fixture.mission, run: fixture.run }, new AbortController().signal);
      const draft = "plan" in planned ? planned.plan : planned;
      commitPlanningContextAttribution(database, draft.planningAttribution, {
        missionId: fixture.mission.id,
        runId: fixture.run.id,
        journey: fixture.run.journey,
        usedAt: NOW,
      });
      expect(prompt).not.toContain(poisonedNodeId);
      expect(prompt).not.toContain("CANARY_NONCANONICAL_LESSON_BODY");
      expect(database.prepare(`
        SELECT used, ignored_reason FROM memory_context_items WHERE node_id = ?
      `).get(poisonedNodeId)).toMatchObject({
        used: 0,
        ignored_reason: "The lesson failed canonical identity, scope, retention, or journey revalidation.",
      });
      expect(database.prepare(`SELECT COUNT(*) AS count FROM lesson_usage WHERE run_id = 'run-reuse'`).get())
        .toEqual({ count: 0 });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM events
        WHERE run_id = 'run-reuse' AND event_type = 'learning.lesson_reused'
      `).get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  test("does not disclose or attribute a canonically named lesson from another engagement", async () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    migrateDatabase(database);
    try {
      const fixture = seed(database, false);
      database.prepare(`
        INSERT INTO lessons (
          id, statement, lesson_type, applicability_scope, engagement_id, mission_id,
          confidence, expected_benefit, risk, status, authoring_agent_id,
          reviewed_by, reviewed_at, created_at, updated_at
        ) VALUES (
          'lesson-foreign', 'Foreign engagement canary', 'strategy', 'engagement',
          'eng-other', NULL, 0.95, 'Never leak across engagements', 'high', 'verified',
          'agent-evaluator', 'reviewer-independent', ?, ?, ?
        )
      `).run(NOW, NOW, NOW);
      const foreignNodeId = canonicalLessonMemoryNodeId("lesson-foreign");
      new MemoryRepository(database, { clock: () => new Date(NOW) }).createNode({
        id: foreignNodeId,
        nodeType: "lesson",
        title: "Foreign engagement canary",
        summary: "This cross-engagement content must never reach the planner.",
        body: "CANARY_CROSS_ENGAGEMENT_LESSON_BODY",
        scope: { kind: "engagement", engagementId: "eng-reuse" },
        sensitivity: "internal",
        confidence: 0.95,
        lifecycleStatus: "verified",
        confirmationState: "not_required",
        provenance: {
          method: "derived",
          explanation: "Forged scope used to prove lesson-row revalidation.",
          sources: [{ sourceType: "lesson", sourceId: "lesson-foreign", acquiredAt: NOW }],
        },
        authorType: "agent",
        authorId: "poison-fixture",
        retentionPolicy: {
          allowAutonomous: true,
          allowGuided: true,
          publicProviderDisclosure: "sanitized",
        },
      });
      database.prepare(`
        INSERT INTO run_context_selections (
          id, run_id, node_id, lesson_id, selection_type, selected_by, reason, selected_at
        ) VALUES (
          'selection-foreign-engagement', 'run-reuse', ?, 'lesson-foreign', 'verified_lesson',
          'operator', 'Adversarial cross-engagement projection fixture', ?
        )
      `).run(foreignNodeId, NOW);
      let prompt = "";
      const planner = createGrokMissionPlanner({
        database,
        inventory: plannerInventory,
        callGrok: async (value) => {
          prompt = value;
          return planJson(foreignNodeId);
        },
      });

      const planned = await planner.plan({ mission: fixture.mission, run: fixture.run }, new AbortController().signal);
      const draft = "plan" in planned ? planned.plan : planned;
      commitPlanningContextAttribution(database, draft.planningAttribution, {
        missionId: fixture.mission.id,
        runId: fixture.run.id,
        journey: fixture.run.journey,
        usedAt: NOW,
      });
      expect(prompt).not.toContain(foreignNodeId);
      expect(prompt).not.toContain("CANARY_CROSS_ENGAGEMENT_LESSON_BODY");
      expect(database.prepare(`
        SELECT used, ignored_reason FROM memory_context_items WHERE node_id = ?
      `).get(foreignNodeId)).toMatchObject({
        used: 0,
        ignored_reason: "The lesson failed canonical identity, scope, retention, or journey revalidation.",
      });
      expect(database.prepare(`SELECT COUNT(*) AS count FROM lesson_usage WHERE run_id = 'run-reuse'`).get())
        .toEqual({ count: 0 });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM events
        WHERE run_id = 'run-reuse' AND event_type = 'learning.lesson_reused'
      `).get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  test("a stale planning owner cannot commit context use, lesson reuse, or its event", async () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    migrateDatabase(database);
    const fixture = seed(database);
    const execution: ResultAwareExecutionPort = {
      bindResultSink() { return () => undefined; },
      async dispatch() { throw new Error("stale planning output must never dispatch"); },
      async resume() { throw new Error("stale planning output must never resume"); },
      async cancelRun() {},
    };
    const planner = createGrokMissionPlanner({
      database,
      inventory: plannerInventory,
      callGrok: async () => {
        database.prepare(`
          UPDATE runs SET lease_owner = 'newer-planning-owner',
            lease_acquired_at = ?, last_heartbeat_at = ?, lease_expires_at = ?,
            version = version + 1
          WHERE id = 'run-reuse'
        `).run(
          NOW,
          NOW,
          new Date(Date.parse(NOW) + 60_000).toISOString(),
        );
        return planJson(fixture.selectedNodeId);
      },
    });
    const runtime = createMissionRuntime({
      database,
      planner,
      outcomeEvaluator: {
        async evaluate() {
          return { success: false, summary: "unused", criteria: [] };
        },
      },
      execution,
      workerId: "stale-planning-owner",
      leaseTtlMs: 10_000,
      scanIntervalMs: 100,
      now: () => new Date(NOW),
    });
    try {
      await expect(runtime.processRunNow(fixture.run.id)).rejects.toThrow();
      expect(database.prepare(`
        SELECT used, ignored_reason FROM memory_context_items
        WHERE node_id = ?
      `).get(fixture.selectedNodeId)).toEqual({
        used: 0,
        ignored_reason: "Not yet evaluated",
      });
      expect(database.prepare(`SELECT COUNT(*) AS count FROM lesson_usage WHERE run_id = 'run-reuse'`).get())
        .toEqual({ count: 0 });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM events
        WHERE run_id = 'run-reuse' AND event_type = 'learning.lesson_reused'
      `).get()).toEqual({ count: 0 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM plans WHERE run_id = 'run-reuse'").get())
        .toEqual({ count: 0 });
    } finally {
      await runtime.stop();
      database.close();
    }
  });
});
