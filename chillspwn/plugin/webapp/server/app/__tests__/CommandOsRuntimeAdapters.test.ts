import { describe, expect, test } from "bun:test";
import { createDatabaseConnection, migrateDatabase, type SqliteDatabase } from "../../db";
import { ActionRepository } from "../../orchestration";
import { MemoryRepository } from "../../memory";
import {
  CommandOsBoundedExecutionPort,
  createGrokMissionPlanner,
  createGrokOutcomeEvaluator,
  type CommandOsToolInventory,
} from "../CommandOsRuntimeAdapters";

const NOW = "2026-07-15T12:00:00.000Z";

function database(): SqliteDatabase {
  const db = createDatabaseConnection({ filename: ":memory:" });
  migrateDatabase(db);
  return db;
}

function seed(db: SqliteDatabase, journey: "autonomous" | "guided" = "autonomous") {
  db.prepare(`
    INSERT INTO missions (
      id, name, objective, journey, status, authorization_status, engagement_id,
      success_criteria_json, memory_policy_json, created_by, created_at, updated_at
    ) VALUES ('mission-1', 'Mission', 'Map the authorized service', ?, 'active',
      'verified', 'eng-1', '["A verified service record exists"]', '{}', 'operator', ?, ?)
  `).run(journey, NOW, NOW);
  db.prepare(`
    INSERT INTO mission_targets (
      id, mission_id, target, target_type, disposition, normalized_target, created_at
    ) VALUES ('target-1', 'mission-1', 'lab.internal', 'domain', 'allowed', 'lab.internal', ?)
  `).run(NOW);
  let contractId: string | null = null;
  if (journey === "autonomous") {
    contractId = "contract-1";
    db.prepare(`
      INSERT INTO mission_contracts (
        id, mission_id, version, state, contract_hash, authorization_json,
        action_policy_json, budgets_json, safe_stop_json, deliverables_json,
        memory_scopes_json, confirmed_by, confirmed_at, created_at
      ) VALUES (?, 'mission-1', 1, 'confirmed', ?, '{}', ?, '{}', '{}', '[]',
        '["engagement_memory"]', 'operator', ?, ?)
    `).run(contractId, "a".repeat(64), JSON.stringify({
      allowedActionClasses: ["reconnaissance"],
      prohibitedActionClasses: [],
      contextNodeIds: ["eng-memory"],
    }), NOW, NOW);
  }
  db.prepare(`
    INSERT INTO runs (
      id, mission_id, journey, status, contract_id, budget_json, budget_usage_json,
      status_reason, created_at, updated_at, version
    ) VALUES ('run-1', 'mission-1', ?, 'planning', ?, '{}', '{}', 'Planning', ?, ?, 1)
  `).run(journey, contractId, NOW, NOW);
  db.prepare(`
    INSERT INTO agents (id, role, display_name, status, version, created_at, updated_at)
    VALUES ('ReconScout', 'reconnaissance', 'ReconScout', 'available', '2.1', ?, ?)
  `).run(NOW, NOW);
  return {
    mission: {
      id: "mission-1",
      name: "Mission",
      objective: "Map the authorized service",
      journey,
      engagementId: "eng-1",
      authorizationStatus: "verified" as const,
      allowedTargets: ["lab.internal"],
      prohibitedTargets: [],
      successCriteria: ["A verified service record exists"],
      memoryPolicy: {},
    },
    run: {
      id: "run-1",
      missionId: "mission-1",
      journey,
      state: "planning" as const,
      replanCount: 0,
      currentPlanVersion: null,
      previousStrategySummary: null,
      stateReason: "Planning",
    },
  };
}

const inventory: readonly CommandOsToolInventory[] = [{
  agentId: "ReconScout",
  role: "reconnaissance",
  description: "Maps services",
  mcpServer: "recon-mcp",
  toolNames: ["nmapScan"],
  safetyBoundaries: ["authorized targets only"],
}];

function planJson() {
  return JSON.stringify({
    strategySummary: "Run one bounded scan",
    rationaleSummary: "The exact MCP tool produces the required record",
    steps: [{
      phase: "reconnaissance",
      title: "Map service",
      objective: "Collect a service record",
      explanation: "Inspect the approved target.",
      rationale: "This is the smallest read-only step.",
      successCriteria: ["A verified result exists"],
      dependencyOrdinals: [],
      assignedAgentId: "ReconScout",
      riskClass: "low",
      reversibility: "Read-only",
      action: {
        actionType: "reconnaissance",
        actionClass: "network",
        target: "lab.internal",
        arguments: { mcpServer: "recon-mcp", toolName: "nmapScan", arguments: { host: "lab.internal" } },
        intentSummary: "Map the approved target",
        kind: "tool",
        idempotent: true,
        destructive: false,
      },
    }],
    contextUsed: [{ id: "eng-memory", influence: "Avoided a previously failed probe." }],
  });
}

describe("Command OS production runtime adapters", () => {
  test("Autonomous planning retrieves only contract-permitted engagement memory and validates the MCP binding", async () => {
    const db = database();
    try {
      const state = seed(db);
      const memory = new MemoryRepository(db);
      const base = {
        nodeType: "technique" as const,
        title: "Prior probe",
        summary: "Use the verified probe",
        body: "Use nmapScan with the approved host.",
        sensitivity: "internal" as const,
        confidence: 0.9,
        lifecycleStatus: "confirmed" as const,
        confirmationState: "confirmed" as const,
        provenance: { method: "operator_statement" as const, explanation: "Confirmed", sources: [{ sourceType: "message" as const, sourceId: "msg-1", acquiredAt: NOW }] },
        authorType: "operator" as const,
        authorId: "operator",
        retentionPolicy: { journeys: ["autonomous" as const] },
      };
      memory.createNode({ ...base, id: "global-memory", scope: { kind: "global" } });
      memory.createNode({ ...base, id: "eng-memory", scope: { kind: "engagement", engagementId: "eng-1" } });
      let suppliedPrompt = "";
      const planner = createGrokMissionPlanner({
        database: db,
        inventory: () => inventory,
        callGrok: async (prompt) => {
          suppliedPrompt = prompt;
          return planJson().replace('"riskClass":"low"', '"riskClass":"informational"');
        },
      });
      const plan = await planner.plan(state, new AbortController().signal);
      expect(plan.steps[0]?.assignedAgentId).toBe("ReconScout");
      expect(plan.steps[0]?.riskClass).toBe("low");
      expect(suppliedPrompt).toContain("riskClass MUST be exactly one of: low, medium, high, critical");
      expect(suppliedPrompt).toContain("eng-memory");
      expect(suppliedPrompt).not.toContain("global-memory");
      const items = db.prepare(`
        SELECT node_id, used FROM memory_context_items ORDER BY node_id
      `).all();
      expect(items).toEqual([{ node_id: "eng-memory", used: 1 }]);
      expect(db.prepare("SELECT provider, model, status FROM provider_turns").get()).toEqual({
        provider: "xai-grok-oauth",
        model: "grok-4.5",
        status: "completed",
      });
    } finally {
      db.close();
    }
  });

  test("persists and correlates only exact provider-reported planning usage", async () => {
    const db = database();
    try {
      const state = seed(db);
      const planner = createGrokMissionPlanner({
        database: db,
        inventory: () => inventory,
        callGrok: async () => ({
          text: planJson(),
          usage: {
            inputTokens: 120,
            outputTokens: 30,
            providerTokens: 150,
          },
        }),
      });
      const plan = await planner.plan(state, new AbortController().signal);
      expect("plan" in plan ? plan.plan.providerUsage : plan.providerUsage).toMatchObject({
        providerTokens: 150,
        exactTokenUsage: true,
        exactCostUsage: false,
      });
      const turn = db.prepare(`
        SELECT id, input_tokens, output_tokens, estimated_cost, status FROM provider_turns
      `).get() as Record<string, unknown>;
      expect(turn).toMatchObject({
        input_tokens: 120,
        output_tokens: 30,
        estimated_cost: null,
        status: "completed",
      });
      const usage = "plan" in plan ? plan.usage : plan.providerUsage;
      expect(usage?.providerTurnId).toBe(turn.id);
    } finally {
      db.close();
    }
  });

  test("repairs one incomplete plan without replaying raw output and accounts both OAuth turns", async () => {
    const db = database();
    try {
      const state = seed(db);
      const invalid = JSON.parse(planJson()) as Record<string, any>;
      delete invalid.steps[0].reversibility;
      invalid.discardedRawCanary = "NEVER_REPLAY_THIS_PROVIDER_VALUE";
      const prompts: string[] = [];
      const planner = createGrokMissionPlanner({
        database: db,
        inventory: () => inventory,
        callGrok: async (prompt) => {
          prompts.push(prompt);
          return prompts.length === 1
            ? { text: JSON.stringify(invalid), usage: { inputTokens: 10, outputTokens: 5, providerTokens: 15 } }
            : { text: planJson(), usage: { inputTokens: 12, outputTokens: 8, providerTokens: 20 } };
        },
      });

      const plan = await planner.plan(state, new AbortController().signal);
      expect(prompts).toHaveLength(2);
      expect(prompts[1]).toContain("SCHEMA_REPAIR_ATTEMPT=1_OF_1");
      expect(prompts[1]).toContain("REJECTED_FIELD=steps[0].reversibility");
      expect(prompts[1]).not.toContain("NEVER_REPLAY_THIS_PROVIDER_VALUE");
      expect(plan.providerUsage).toMatchObject({
        providerTurns: 2,
        providerTokens: 35,
        exactTokenUsage: true,
        exactCostUsage: false,
      });
      expect(db.prepare("SELECT COUNT(*) AS count FROM provider_turns WHERE status = 'completed'").get())
        .toEqual({ count: 2 });
      const repairLog = db.prepare(`
        SELECT message, attributes_json FROM structured_logs
        WHERE run_id = 'run-1' AND domain = 'command-runtime.planner'
      `).get() as { message: string; attributes_json: string };
      expect(repairLog.message).toContain("one bounded schema repair");
      expect(JSON.parse(repairLog.attributes_json)).toEqual({
        code: "invalid_plan",
        validationField: "steps[0].reversibility",
        validationRule: "required_nonempty_string",
        repairAttempt: 1,
        rawProviderOutputPersisted: false,
      });
    } finally {
      db.close();
    }
  });

  test("does not repair secret-bearing plans or exceed a one-turn provider budget", async () => {
    const secretDb = database();
    try {
      const state = seed(secretDb);
      const secretPlan = JSON.parse(planJson()) as Record<string, any>;
      secretPlan.steps[0].action.arguments.api_key = "provider-must-discard-this";
      let calls = 0;
      const planner = createGrokMissionPlanner({
        database: secretDb,
        inventory: () => inventory,
        callGrok: async () => { calls += 1; return JSON.stringify(secretPlan); },
      });
      await expect(planner.plan(state, new AbortController().signal)).rejects.toMatchObject({
        code: "plan_contains_secret_material",
      });
      expect(calls).toBe(1);
      expect(secretDb.prepare("SELECT COUNT(*) AS count FROM structured_logs").get()).toEqual({ count: 0 });
    } finally {
      secretDb.close();
    }

    const limitedDb = database();
    try {
      const state = seed(limitedDb);
      limitedDb.prepare("UPDATE runs SET budget_json = ? WHERE id = 'run-1'")
        .run(JSON.stringify({ providerTurns: 1 }));
      const invalid = JSON.parse(planJson()) as Record<string, any>;
      delete invalid.steps[0].reversibility;
      let calls = 0;
      const planner = createGrokMissionPlanner({
        database: limitedDb,
        inventory: () => inventory,
        callGrok: async () => { calls += 1; return JSON.stringify(invalid); },
      });
      await expect(planner.plan(state, new AbortController().signal)).rejects.toMatchObject({
        code: "invalid_plan",
      });
      expect(calls).toBe(1);
      expect(limitedDb.prepare("SELECT COUNT(*) AS count FROM structured_logs").get()).toEqual({ count: 0 });
    } finally {
      limitedDb.close();
    }
  });

  test("the execution port invokes only the persisted specialist MCP binding and retains immutable evidence", async () => {
    const db = database();
    try {
      seed(db);
      db.prepare(`
        INSERT INTO plans (id, run_id, version, status, strategy_summary, plan_hash, created_by, created_at, activated_at)
        VALUES ('plan-1', 'run-1', 1, 'active', 'Bounded scan', ?, 'planner', ?, ?)
      `).run("b".repeat(64), NOW, NOW);
      db.prepare(`
        INSERT INTO plan_steps (
          id, plan_id, run_id, ordinal, phase, title, objective, status,
          assigned_agent_id, created_at, updated_at
        ) VALUES ('step-1', 'plan-1', 'run-1', 0, 'recon', 'Scan', 'Map', 'running', 'ReconScout', ?, ?)
      `).run(NOW, NOW);
      db.prepare(`
        INSERT INTO assignments (id, run_id, step_id, agent_id, status, created_at, updated_at)
        VALUES ('assignment-1', 'run-1', 'step-1', 'ReconScout', 'active', ?, ?)
      `).run(NOW, NOW);
      const actions = new ActionRepository(db);
      const action = actions.create({
        intent: {
          missionId: "mission-1", runId: "run-1", stepId: "step-1", planVersion: 1,
          assignmentId: "assignment-1", actionType: "reconnaissance", actionClass: "network",
          target: "lab.internal", intentSummary: "Map approved service", kind: "tool",
          idempotent: true, destructive: false,
          arguments: { mcpServer: "recon-mcp", toolName: "nmapScan", arguments: { host: "lab.internal" } },
        },
        fingerprint: "fingerprint-1",
        contractId: "contract-1",
        now: NOW,
      });
      let invocation: unknown;
      let resolveResult!: (value: unknown) => void;
      const received = new Promise((resolve) => { resolveResult = resolve; });
      const port = new CommandOsBoundedExecutionPort({
        database: db,
        inventory: () => inventory,
        callGrok: async () => "unused",
        executeMcp: async (input) => {
          invocation = input;
          return {
            success: true, mcpServer: input.mcpServer, toolName: input.toolName,
            outputPreview: "443/tcp open https", fullOutputBytes: 18, evidenceIds: [],
            error: null, isError: false, durationMs: 10,
          };
        },
      });
      port.bindResultSink({
        async acceptExecutionResult(result) { resolveResult(result); return { accepted: true, duplicate: false, actionId: result.actionId, runId: result.runId, runState: "running", nextAction: null }; },
      });
      await port.dispatch(action, new AbortController().signal);
      const result = await received as {
        success: boolean;
        progress: { evidenceIds?: string[] };
        usage: { evidenceBytes?: number; artifactBytes?: number };
      };
      expect(result.success).toBe(true);
      expect(invocation).toMatchObject({ specialistAgentId: "ReconScout", mcpServer: "recon-mcp", toolName: "nmapScan", arguments: { host: "lab.internal" } });
      expect(result.progress.evidenceIds).toHaveLength(1);
      expect(result.usage.evidenceBytes).toBe(Buffer.byteLength("443/tcp open https", "utf8"));
      expect(result.usage.artifactBytes).toBe(0);
      expect(db.prepare("SELECT verification_state, source FROM evidence").get())
        .toEqual({ verification_state: "verified", source: "mcp:recon-mcp.nmapScan" });
      expect(() => db.prepare("UPDATE evidence SET summary = 'changed'").run()).toThrow("immutable");
    } finally {
      db.close();
    }
  });

  test("success evaluation rejects provider claims that do not cite verified canonical evidence", async () => {
    const db = database();
    try {
      const state = seed(db);
      const evaluator = createGrokOutcomeEvaluator({
        database: db,
        callGrok: async () => JSON.stringify({
          summary: "Claimed success",
          criteria: [{ criterion: "A verified service record exists", satisfied: true, explanation: "Claim", evidenceIds: ["made-up"] }],
        }),
      });
      const result = await evaluator.evaluate({
        mission: state.mission,
        run: state.run,
        planId: "plan-1",
        completedActionIds: ["action-1"],
      }, new AbortController().signal);
      expect(result.success).toBe(false);
      expect(result.criteria[0]?.evidenceIds).toEqual([]);
      expect(db.prepare("SELECT status FROM provider_turns").get()).toEqual({ status: "completed" });
    } finally {
      db.close();
    }
  });
});
