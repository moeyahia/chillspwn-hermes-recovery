import { describe, expect, test } from "bun:test";
import { createDatabaseConnection, migrateDatabase, type SqliteDatabase } from "../../db";
import { ActionRepository } from "../../orchestration";
import { MemoryRepository } from "../../memory";
import { verifyAndConsumeGuidedExactStepAttestation } from "../../mcp/CommandOsGuidedApproval";
import { createMcpExecutionBinding } from "../../mcp/McpApprovalAttestation";
import { commitPlanningContextAttribution } from "../../command-runtime/PlanningContextAttribution";
import { evaluateProgress } from "../../supervisor";
import {
  autonomousSpecialistTools,
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

function seed(
  db: SqliteDatabase,
  journey: "autonomous" | "guided" = "autonomous",
  preflight: {
    readonly contractState?: "confirmed" | "draft";
    readonly runContract?: "current" | "missing" | "mismatched";
    readonly actionPolicy?: Record<string, unknown>;
  } = {},
) {
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
    const actionPolicy = preflight.actionPolicy ?? {
      allowedActionClasses: ["reconnaissance", "network"],
      prohibitedActionClasses: [],
      specialistAgentIds: ["ReconScout"],
      contextNodeIds: ["eng-memory"],
    };
    db.prepare(`
      INSERT INTO mission_contracts (
        id, mission_id, version, state, contract_hash, authorization_json,
        action_policy_json, budgets_json, safe_stop_json, deliverables_json,
        memory_scopes_json, confirmed_by, confirmed_at, created_at
      ) VALUES (?, 'mission-1', 1, ?, ?, '{}', ?, '{}', '{}', '[]',
        '["engagement_memory"]', 'operator', ?, ?)
    `).run(
      contractId,
      preflight.contractState ?? "confirmed",
      "a".repeat(64),
      JSON.stringify(actionPolicy),
      NOW,
      NOW,
    );
  }
  const runContractId = preflight.runContract === "missing" ? null : contractId;
  db.prepare(`
    INSERT INTO runs (
      id, mission_id, journey, status, contract_id, contract_version_bound,
      contract_hash_bound, budget_json, budget_usage_json,
      status_reason, created_at, updated_at, version
    ) VALUES ('run-1', 'mission-1', ?, 'planning', ?, ?, ?, '{}', '{}', 'Planning', ?, ?, 1)
  `).run(
    journey,
    runContractId,
    runContractId ? 1 : null,
    runContractId
      ? (preflight.runContract === "mismatched" ? "b".repeat(64) : "a".repeat(64))
      : null,
    NOW,
    NOW,
  );
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

function seedLiveGrokHealth(db: SqliteDatabase, attestedAt = NOW): void {
  db.prepare(`
    INSERT INTO health_snapshots (
      id, component_type, component_id, status, metrics_json, message, captured_at
    ) VALUES (?, 'provider', 'grok-acp', 'healthy', ?, 'Live route attested', ?)
  `).run(
    `health-${attestedAt}`,
    JSON.stringify({
      authenticated: true,
      callable: true,
      attestedAt,
      expiresAt: "2026-07-15T12:05:00.000Z",
      circuitState: "closed",
      supportsGuided: true,
      enforcesAutonomousBoundary: true,
      reportsExactTokenUsage: true,
      reportsExactCostUsage: false,
    }),
    attestedAt,
  );
}

const inventory: readonly CommandOsToolInventory[] = [{
  agentId: "ReconScout",
  role: "reconnaissance",
  description: "Maps services",
  mcpServer: "recon-mcp",
  toolNames: ["quick_scan"],
  deterministicToolInputs: { quick_scan: {} },
  deterministicToolInputAttestations: {
    quick_scan: {
      attestationId: "test-reviewed-empty-input-v1",
      templateHash: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    },
  },
  safetyBoundaries: ["authorized targets only"],
}];

const unattestedInventory: readonly CommandOsToolInventory[] = [{
  agentId: "ReconScout",
  role: "reconnaissance",
  description: "Maps services",
  mcpServer: "recon-mcp",
  toolNames: ["quick_scan"],
  safetyBoundaries: ["authorized targets only"],
}];

const ambiguousInventory: readonly CommandOsToolInventory[] = [{
  ...inventory[0]!,
  toolNames: ["quick_scan", "port_scan"],
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
        arguments: { mcpServer: "recon-mcp", toolName: "quick_scan", arguments: { host: "lab.internal" } },
        intentSummary: "Map the approved target",
        kind: "tool",
        idempotent: true,
        destructive: false,
      },
    }],
    contextUsed: [{ id: "eng-memory", influence: "Avoided a previously failed probe." }],
  });
}

function analysisOnlyPlanJson() {
  const plan = JSON.parse(planJson()) as Record<string, any>;
  plan.strategySummary = "Analyze existing mission context";
  plan.steps[0].action.kind = "provider_turn";
  plan.steps[0].action.arguments = { analysisScope: "authorized mission context" };
  return JSON.stringify(plan);
}

function invalidBindingPlanJson(canary?: string) {
  const plan = JSON.parse(planJson()) as Record<string, any>;
  plan.steps[0].action.arguments.mcpServer = "unreviewed-mcp";
  plan.steps[0].action.arguments.toolName = "unreviewed-tool";
  if (canary) plan.discardedRawCanary = canary;
  return JSON.stringify(plan);
}

function seedVerifiedEvidence(db: SqliteDatabase, id = "evidence-verified-1"): string {
  db.prepare(`
    INSERT INTO evidence (
      id, mission_id, run_id, source, acquired_at, target, evidence_type,
      content_hash, provenance_json, confidence, sensitivity, verification_state,
      summary, extracted_text, created_by, created_at
    ) VALUES (?, 'mission-1', 'run-1', 'mcp:recon-mcp.quick_scan', ?, 'lab.internal',
      'tool_result', ?, '{}', 0.95, 'private', 'verified',
      'The approved service record was captured.', '443/tcp open https', 'ReconScout', ?)
  `).run(id, NOW, "e".repeat(64), NOW);
  return id;
}

describe("Command OS production runtime adapters", () => {
  test("projects only approval-free specialist tools into the Autonomous planner inventory", () => {
    expect(autonomousSpecialistTools("ReconScout", ["quick_scan", "nmapScan", "hashcat"]))
      .toEqual(["quick_scan"]);
  });

  test("fails before a provider turn when no runtime specialist matches the signed Autonomous pool", async () => {
    const db = database();
    try {
      const state = seed(db);
      db.prepare(`
        UPDATE mission_contracts SET action_policy_json = ? WHERE id = 'contract-1'
      `).run(JSON.stringify({
        allowedActionClasses: ["reconnaissance"],
        prohibitedActionClasses: [],
        specialistAgentIds: ["agent-not-in-runtime"],
        contextNodeIds: ["eng-memory"],
      }));
      let providerCalls = 0;
      const planner = createGrokMissionPlanner({
        database: db,
        inventory: () => inventory,
        callGrok: async () => {
          providerCalls += 1;
          return planJson();
        },
      });

      await expect(planner.plan(state, new AbortController().signal))
        .rejects.toThrow("No specialist execution inventory matches the signed mission contract");
      expect(providerCalls).toBe(0);
      expect(db.prepare(`SELECT COUNT(*) AS count FROM provider_turns`).get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  test("fails before a provider turn when the Autonomous specialist pool is empty while Guided still uses available inventory", async () => {
    const autonomousDb = database();
    try {
      const state = seed(autonomousDb);
      autonomousDb.prepare(`
        UPDATE mission_contracts SET action_policy_json = ? WHERE id = 'contract-1'
      `).run(JSON.stringify({
        allowedActionClasses: ["reconnaissance", "network"],
        prohibitedActionClasses: [],
        specialistAgentIds: [],
        contextNodeIds: ["eng-memory"],
      }));
      let providerCalls = 0;
      const planner = createGrokMissionPlanner({
        database: autonomousDb,
        inventory: () => inventory,
        callGrok: async () => { providerCalls += 1; return planJson(); },
      });

      await expect(planner.plan(state, new AbortController().signal)).rejects.toMatchObject({
        code: "autonomous_specialist_pool_missing",
        options: { category: "dependency_missing" },
      });
      expect(providerCalls).toBe(0);
      expect(autonomousDb.prepare("SELECT COUNT(*) AS count FROM provider_turns").get())
        .toEqual({ count: 0 });
    } finally {
      autonomousDb.close();
    }

    const guidedDb = database();
    try {
      const state = seed(guidedDb, "guided");
      let providerCalls = 0;
      const planner = createGrokMissionPlanner({
        database: guidedDb,
        inventory: () => inventory,
        callGrok: async () => { providerCalls += 1; return planJson(); },
      });

      await expect(planner.plan(state, new AbortController().signal)).resolves.toMatchObject({
        steps: [{ assignedAgentId: "ReconScout" }],
      });
      expect(providerCalls).toBe(1);
    } finally {
      guidedDb.close();
    }
  });

  test("rejects invalid Autonomous contract preflight states without a provider turn", async () => {
    const cases: readonly {
      name: string;
      preflight: Parameters<typeof seed>[2];
      code: string;
    }[] = [
      {
        name: "missing contract",
        preflight: { runContract: "missing" },
        code: "autonomous_contract_not_confirmed",
      },
      {
        name: "unconfirmed contract",
        preflight: { contractState: "draft" },
        code: "autonomous_contract_not_confirmed",
      },
      {
        name: "contract binding mismatch",
        preflight: { runContract: "mismatched" },
        code: "autonomous_contract_not_current",
      },
      {
        name: "empty action pool",
        preflight: {
          actionPolicy: {
            allowedActionClasses: [],
            prohibitedActionClasses: [],
            specialistAgentIds: ["ReconScout"],
          },
        },
        code: "autonomous_action_pool_missing",
      },
    ];

    for (const testCase of cases) {
      const db = database();
      try {
        const state = seed(db, "autonomous", testCase.preflight);
        let providerCalls = 0;
        const planner = createGrokMissionPlanner({
          database: db,
          inventory: () => inventory,
          callGrok: async () => { providerCalls += 1; return planJson(); },
        });

        await expect(planner.plan(state, new AbortController().signal), testCase.name)
          .rejects.toMatchObject({ code: testCase.code });
        expect(providerCalls, testCase.name).toBe(0);
        expect(db.prepare("SELECT COUNT(*) AS count FROM provider_turns").get(), testCase.name)
          .toEqual({ count: 0 });
      } finally {
        db.close();
      }
    }
  });

  test("Autonomous planning retrieves only contract-permitted engagement memory and validates the MCP binding", async () => {
    const db = database();
    try {
      const state = seed(db);
      const memory = new MemoryRepository(db);
      const base = {
        nodeType: "technique" as const,
        title: "Prior probe",
        summary: "Use the verified probe",
        body: "Use quick_scan with the approved host.",
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
      expect(items).toEqual([{ node_id: "eng-memory", used: 0 }]);
      const draft = "plan" in plan ? plan.plan : plan;
      commitPlanningContextAttribution(db, draft.planningAttribution, {
        missionId: state.mission.id,
        runId: state.run.id,
        journey: state.run.journey,
        usedAt: NOW,
      });
      expect(db.prepare(`
        SELECT node_id, used FROM memory_context_items ORDER BY node_id
      `).all()).toEqual([{ node_id: "eng-memory", used: 1 }]);
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
      expect(prompts[1]).toContain("SCHEMA_REPAIR_ATTEMPT=1_OF_2");
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
      expect(repairLog.message).toContain("a bounded schema repair");
      expect(JSON.parse(repairLog.attributes_json)).toEqual({
        code: "invalid_plan",
        validationField: "steps[0].reversibility",
        validationRule: "required_nonempty_string",
        repairAttempt: "1/2",
        rawProviderOutputPersisted: false,
      });
    } finally {
      db.close();
    }
  });

  test("repairs empty steps then projects the sole reviewed binding without a third provider turn", async () => {
    const db = database();
    try {
      const state = seed(db);
      const empty = JSON.parse(planJson()) as Record<string, any>;
      empty.steps = [];
      empty.discardedRawCanary = "NEVER_REPLAY_EMPTY_PLAN";
      const invalidBinding = JSON.parse(planJson()) as Record<string, any>;
      invalidBinding.steps[0].action.arguments.mcpServer = "unreviewed-mcp";
      invalidBinding.steps[0].action.arguments.toolName = "unreviewed-tool";
      invalidBinding.discardedRawCanary = "NEVER_REPLAY_INVALID_BINDING";
      const prompts: string[] = [];
      const planner = createGrokMissionPlanner({
        database: db,
        inventory: () => inventory,
        callGrok: async (prompt) => {
          prompts.push(prompt);
          return prompts.length === 1 ? JSON.stringify(empty) : JSON.stringify(invalidBinding);
        },
      });

      const plan = await planner.plan(state, new AbortController().signal);
      expect(plan).toMatchObject({
        steps: [{ assignedAgentId: "ReconScout" }],
      });
      expect(plan.providerUsage).toMatchObject({ providerTurns: 2 });
      expect(plan.steps[0]?.action.arguments).toMatchObject({
        mcpServer: "recon-mcp",
        toolName: "quick_scan",
      });
      expect(prompts).toHaveLength(2);
      expect(prompts[0]).toContain("REVIEWED_TOOL_BINDING_PROJECTIONS=");
      expect(prompts[0]).toContain('"assignedAgentId":"ReconScout","action":{"kind":"tool","arguments":{"mcpServer":"recon-mcp","toolName":"quick_scan"}}');
      expect(prompts[0]).toContain("Do not infer a binding from INVENTORY.toolNames");
      expect(prompts[1]).toContain("SCHEMA_REPAIR_ATTEMPT=1_OF_2");
      expect(prompts[1]).toContain("REJECTED_FIELD=steps");
      expect(prompts[1]).toContain("REJECTED_RULE=bounded_nonempty_array");
      expect(prompts[1]).not.toContain("NEVER_REPLAY_EMPTY_PLAN");
      expect(prompts[1]).not.toContain("NEVER_REPLAY_INVALID_BINDING");
      expect(prompts[1]).not.toContain("unreviewed-mcp");
      expect(prompts[1]).not.toContain("unreviewed-tool");
      expect(db.prepare("SELECT COUNT(*) AS count FROM provider_turns").get()).toEqual({ count: 2 });
      const repairLogs = (db.prepare(`
        SELECT attributes_json FROM structured_logs
        WHERE run_id = 'run-1' AND domain = 'command-runtime.planner'
        ORDER BY occurred_at, id
      `).all() as Array<{ attributes_json: string }>).map((row) => row.attributes_json);
      expect(repairLogs).toHaveLength(1);
      expect(repairLogs.join("\n")).not.toContain("NEVER_REPLAY_EMPTY_PLAN");
      expect(repairLogs.join("\n")).not.toContain("NEVER_REPLAY_INVALID_BINDING");
      expect(repairLogs.map((value) => JSON.parse(value).repairAttempt)).toEqual(["1/2"]);
      const bindingLog = db.prepare(`
        SELECT attributes_json FROM structured_logs
        WHERE run_id = 'run-1' AND domain = 'command-runtime.planner.binding'
      `).get() as { attributes_json: string };
      expect(JSON.parse(bindingLog.attributes_json)).toEqual({
        code: "unambiguous_reviewed_tool_binding_projected",
        stepIndex: 0,
        assignedAgentId: "ReconScout",
        mcpServer: "recon-mcp",
        toolName: "quick_scan",
        rawProviderOutputPersisted: false,
      });
      expect(bindingLog.attributes_json).not.toContain("NEVER_REPLAY_INVALID_BINDING");
    } finally {
      db.close();
    }
  });

  test("fails closed after the third invalid planner response without a fourth turn", async () => {
    const db = database();
    try {
      const state = seed(db);
      const empty = JSON.parse(planJson()) as Record<string, any>;
      empty.steps = [];
      let providerCalls = 0;
      const planner = createGrokMissionPlanner({
        database: db,
        inventory: () => ambiguousInventory,
        callGrok: async () => {
          providerCalls += 1;
          return providerCalls === 1 ? JSON.stringify(empty) : invalidBindingPlanJson();
        },
      });

      await expect(planner.plan(state, new AbortController().signal)).rejects.toMatchObject({
        code: "invalid_plan",
        options: {
          details: {
            validationField: "steps[0].action.arguments",
            validationRule: "available_specialist_mcp_binding",
          },
        },
      });
      expect(providerCalls).toBe(3);
      expect(db.prepare("SELECT COUNT(*) AS count FROM provider_turns").get()).toEqual({ count: 3 });
      expect(db.prepare(`
        SELECT COUNT(*) AS count FROM structured_logs
        WHERE domain = 'command-runtime.planner'
      `).get()).toEqual({ count: 2 });
    } finally {
      db.close();
    }
  });

  test("a finite two-turn budget permits one planner repair but not a second", async () => {
    const db = database();
    try {
      const state = seed(db);
      db.prepare("UPDATE runs SET budget_json = ? WHERE id = 'run-1'")
        .run(JSON.stringify({ providerTurns: 2 }));
      const empty = JSON.parse(planJson()) as Record<string, any>;
      empty.steps = [];
      let providerCalls = 0;
      const planner = createGrokMissionPlanner({
        database: db,
        inventory: () => ambiguousInventory,
        callGrok: async () => {
          providerCalls += 1;
          if (providerCalls === 1) return JSON.stringify(empty);
          if (providerCalls === 2) return invalidBindingPlanJson();
          return planJson();
        },
      });

      await expect(planner.plan(state, new AbortController().signal)).rejects.toMatchObject({
        code: "invalid_plan",
        options: {
          details: { validationRule: "available_specialist_mcp_binding" },
        },
      });
      expect(providerCalls).toBe(2);
      expect(db.prepare("SELECT COUNT(*) AS count FROM provider_turns").get()).toEqual({ count: 2 });
      expect(db.prepare(`
        SELECT COUNT(*) AS count FROM structured_logs
        WHERE domain = 'command-runtime.planner'
      `).get()).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });

  test("a finite three-turn budget permits both bounded planner repairs", async () => {
    const db = database();
    try {
      const state = seed(db);
      db.prepare("UPDATE runs SET budget_json = ? WHERE id = 'run-1'")
        .run(JSON.stringify({ providerTurns: 3 }));
      const empty = JSON.parse(planJson()) as Record<string, any>;
      empty.steps = [];
      let providerCalls = 0;
      const planner = createGrokMissionPlanner({
        database: db,
        inventory: () => ambiguousInventory,
        callGrok: async () => {
          providerCalls += 1;
          if (providerCalls === 1) return JSON.stringify(empty);
          if (providerCalls === 2) return invalidBindingPlanJson();
          return planJson();
        },
      });

      await expect(planner.plan(state, new AbortController().signal)).resolves.toMatchObject({
        steps: [{ action: { kind: "tool" } }],
        providerUsage: { providerTurns: 3 },
      });
      expect(providerCalls).toBe(3);
      expect(db.prepare("SELECT COUNT(*) AS count FROM provider_turns").get()).toEqual({ count: 3 });
    } finally {
      db.close();
    }
  });

  test("repairs a cyclic dependency fault exactly once using its safe diagnostic", async () => {
    const db = database();
    try {
      const state = seed(db);
      const invalid = JSON.parse(planJson()) as Record<string, any>;
      invalid.steps[0].dependencyOrdinals = [0];
      const prompts: string[] = [];
      const planner = createGrokMissionPlanner({
        database: db,
        inventory: () => inventory,
        callGrok: async (prompt) => {
          prompts.push(prompt);
          return prompts.length === 1 ? JSON.stringify(invalid) : planJson();
        },
      });

      await expect(planner.plan(state, new AbortController().signal)).resolves.toMatchObject({
        steps: [{ dependencyOrdinals: [] }],
      });
      expect(prompts).toHaveLength(2);
      expect(prompts[1]).toContain("REJECTED_FIELD=steps[0].dependencyOrdinals");
      expect(prompts[1]).toContain("REJECTED_RULE=array_of_prior_step_ordinals");
      expect(db.prepare("SELECT COUNT(*) AS count FROM provider_turns").get()).toEqual({ count: 2 });
    } finally {
      db.close();
    }
  });

  test("compiles the live-shaped single analysis step into the sole reviewed Autonomous evidence tool", async () => {
    const db = database();
    try {
      const state = seed(db);
      const canary = "NEVER_REPLAY_ANALYSIS_ONLY_PLAN";
      const first = JSON.parse(analysisOnlyPlanJson()) as Record<string, any>;
      first.discardedRawCanary = canary;
      const prompts: string[] = [];
      const planner = createGrokMissionPlanner({
        database: db,
        inventory: () => inventory,
        callGrok: async (prompt) => {
          prompts.push(prompt);
          return JSON.stringify(first);
        },
      });

      const plan = await planner.plan(state, new AbortController().signal);
      expect(plan.steps[0]?.action.kind).toBe("tool");
      expect(plan.steps[0]?.action.arguments).toMatchObject({
        mcpServer: "recon-mcp",
        toolName: "quick_scan",
        arguments: {},
      });
      expect(plan.steps[0]?.action.arguments).toMatchObject({
        analysisScope: "authorized mission context",
      });
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain("CANONICAL_VERIFIED_EVIDENCE_AVAILABLE=false");
      expect(prompts[0]).toContain("AUTONOMOUS_TOOL_EVIDENCE_PATH_REQUIRED=true");
      expect(prompts[0]).not.toContain("deterministicToolInputs");
      expect(prompts[0]).not.toContain("deterministicToolInputAttestations");
      expect(prompts[0]).not.toContain("test-reviewed-empty-input-v1");
      expect(prompts[0]).not.toContain("44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a");
      expect(JSON.stringify(plan)).not.toContain(canary);
      expect(db.prepare("SELECT COUNT(*) AS count FROM provider_turns").get()).toEqual({ count: 1 });
      const marker = db.prepare(`
        SELECT attributes_json FROM structured_logs
        WHERE domain = 'command-runtime.planner.binding'
      `).get() as { attributes_json: string };
      expect(JSON.parse(marker.attributes_json)).toEqual({
        code: "unambiguous_autonomous_evidence_tool_compiled",
        stepIndex: 0,
        originalKind: "provider_turn",
        assignedAgentId: "ReconScout",
        mcpServer: "recon-mcp",
        toolName: "quick_scan",
        attestationId: "test-reviewed-empty-input-v1",
        templateHash: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
        rawProviderOutputPersisted: false,
      });
      expect(marker.attributes_json).not.toContain(canary);
    } finally {
      db.close();
    }
  });

  test("the evidence compiler refuses multiple steps, cross-agent inference, and non-object arguments", async () => {
    const cases = [
      { name: "multiple", rule: "autonomous_verified_evidence_tool_path" },
      { name: "cross-agent", rule: "available_specialist" },
      { name: "non-object-arguments", rule: "required_json_object" },
      { name: "no-input-attestation", rule: "autonomous_verified_evidence_tool_path" },
      { name: "existing-nested-input", rule: "autonomous_verified_evidence_tool_path" },
      { name: "wrong-flat-binding", rule: "autonomous_verified_evidence_tool_path" },
      { name: "outside-contract", rule: "signed_allowed_target" },
      { name: "non-idempotent", rule: "autonomous_verified_evidence_tool_path" },
      { name: "destructive", rule: "signed_destructive_policy" },
    ] as const;
    for (const testCase of cases) {
      const db = database();
      try {
        const state = seed(db);
        const invalid = JSON.parse(analysisOnlyPlanJson()) as Record<string, any>;
        const canary = `NEVER_REPLAY_EVIDENCE_COMPILER_${testCase.name}`;
        invalid.discardedRawCanary = canary;
        if (testCase.name === "multiple") {
          const second = JSON.parse(JSON.stringify(invalid.steps[0])) as Record<string, any>;
          second.title = "Analyze again";
          second.dependencyOrdinals = [0];
          second.action.kind = "delegation";
          invalid.steps.push(second);
        } else if (testCase.name === "cross-agent") {
          invalid.steps[0].assignedAgentId = "WebBreaker";
        } else if (testCase.name === "non-object-arguments") {
          invalid.steps[0].action.arguments = null;
        } else if (testCase.name === "existing-nested-input") {
          invalid.steps[0].action.arguments.arguments = { host: "lab.internal" };
        } else if (testCase.name === "wrong-flat-binding") {
          invalid.steps[0].action.arguments.mcpServer = "unreviewed-mcp";
          invalid.steps[0].action.arguments.toolName = "unreviewed-tool";
        } else if (testCase.name === "outside-contract") {
          invalid.steps[0].action.target = "outside.invalid";
        } else if (testCase.name === "non-idempotent") {
          invalid.steps[0].action.idempotent = false;
        } else if (testCase.name === "destructive") {
          invalid.steps[0].action.destructive = true;
        }
        const prompts: string[] = [];
        const planner = createGrokMissionPlanner({
          database: db,
          inventory: () => testCase.name === "no-input-attestation"
            ? unattestedInventory
            : inventory,
          callGrok: async (prompt) => {
            prompts.push(prompt);
            return prompts.length === 1 ? JSON.stringify(invalid) : planJson();
          },
        });

        await expect(planner.plan(state, new AbortController().signal)).resolves.toMatchObject({
          steps: [{ action: { kind: "tool" } }],
        });
        expect(prompts).toHaveLength(2);
        expect(prompts[1]).toContain(`REJECTED_RULE=${testCase.rule}`);
        expect(prompts[1]).not.toContain(canary);
        expect(db.prepare(`
          SELECT COUNT(*) AS count FROM structured_logs
          WHERE domain = 'command-runtime.planner.binding'
        `).get()).toEqual({ count: 0 });
      } finally {
        db.close();
      }
    }
  });

  test("revalidates a changed specialist inventory after the provider turn instead of compiling from a stale snapshot", async () => {
    const db = database();
    try {
      const state = seed(db);
      let inventoryReads = 0;
      const prompts: string[] = [];
      const planner = createGrokMissionPlanner({
        database: db,
        inventory: () => {
          inventoryReads += 1;
          return inventoryReads === 1 ? inventory : ambiguousInventory;
        },
        callGrok: async (prompt) => {
          prompts.push(prompt);
          return prompts.length === 1 ? analysisOnlyPlanJson() : planJson();
        },
      });

      await expect(planner.plan(state, new AbortController().signal)).resolves.toMatchObject({
        steps: [{ action: { kind: "tool" } }],
        providerUsage: { providerTurns: 2 },
      });
      expect(inventoryReads).toBe(3);
      expect(prompts[1]).toContain("REJECTED_RULE=autonomous_verified_evidence_tool_path");
      expect(db.prepare(`
        SELECT COUNT(*) AS count FROM structured_logs
        WHERE domain = 'command-runtime.planner.binding'
      `).get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  test("fails closed after two repairs when an Autonomous plan remains analysis-only", async () => {
    const db = database();
    try {
      const state = seed(db);
      let providerCalls = 0;
      const planner = createGrokMissionPlanner({
        database: db,
        inventory: () => ambiguousInventory,
        callGrok: async () => {
          providerCalls += 1;
          return analysisOnlyPlanJson();
        },
      });

      await expect(planner.plan(state, new AbortController().signal)).rejects.toMatchObject({
        code: "invalid_plan_evidence_path",
        options: {
          category: "invalid_input",
          details: {
            validationField: "steps[].action.kind",
            validationRule: "autonomous_verified_evidence_tool_path",
          },
        },
      });
      expect(providerCalls).toBe(3);
      expect(db.prepare("SELECT COUNT(*) AS count FROM provider_turns").get()).toEqual({ count: 3 });
      expect(db.prepare(`
        SELECT COUNT(*) AS count FROM structured_logs
        WHERE domain = 'command-runtime.planner'
      `).get()).toEqual({ count: 2 });
    } finally {
      db.close();
    }
  });

  test("permits an Autonomous analysis-only plan when canonical verified evidence already exists", async () => {
    const db = database();
    try {
      const state = seed(db);
      seedVerifiedEvidence(db);
      const prompts: string[] = [];
      const planner = createGrokMissionPlanner({
        database: db,
        inventory: () => inventory,
        callGrok: async (prompt) => {
          prompts.push(prompt);
          return analysisOnlyPlanJson();
        },
      });

      const plan = await planner.plan(state, new AbortController().signal);
      expect(plan.steps[0]?.action.kind).toBe("provider_turn");
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain("CANONICAL_VERIFIED_EVIDENCE_AVAILABLE=true");
      expect(prompts[0]).toContain("AUTONOMOUS_TOOL_EVIDENCE_PATH_REQUIRED=false");
    } finally {
      db.close();
    }
  });

  test("permits an Autonomous analysis-only plan when success criteria are empty", async () => {
    const db = database();
    try {
      const seeded = seed(db);
      db.prepare("UPDATE missions SET success_criteria_json = '[]' WHERE id = 'mission-1'").run();
      const state = {
        ...seeded,
        mission: { ...seeded.mission, successCriteria: [] },
      };
      const prompts: string[] = [];
      const planner = createGrokMissionPlanner({
        database: db,
        inventory: () => inventory,
        callGrok: async (prompt) => {
          prompts.push(prompt);
          return analysisOnlyPlanJson();
        },
      });

      const plan = await planner.plan(state, new AbortController().signal);
      expect(plan.steps[0]?.action.kind).toBe("provider_turn");
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain("CANONICAL_VERIFIED_EVIDENCE_AVAILABLE=false");
      expect(prompts[0]).toContain("AUTONOMOUS_TOOL_EVIDENCE_PATH_REQUIRED=false");
    } finally {
      db.close();
    }
  });

  test("repairs malformed planner JSON once without replaying discarded provider output", async () => {
    const db = database();
    try {
      const state = seed(db);
      const discardedRawCanary = "NEVER_REPLAY_MALFORMED_PROVIDER_VALUE";
      const prompts: string[] = [];
      const planner = createGrokMissionPlanner({
        database: db,
        inventory: () => inventory,
        callGrok: async (prompt) => {
          prompts.push(prompt);
          return prompts.length === 1
            ? `{ malformed ${discardedRawCanary}`
            : planJson();
        },
      });

      await expect(planner.plan(state, new AbortController().signal)).resolves.toMatchObject({
        strategySummary: "Run one bounded scan",
      });
      expect(prompts).toHaveLength(2);
      expect(prompts[1]).toContain("SCHEMA_REPAIR_ATTEMPT=1_OF_2");
      expect(prompts[1]).toContain("REJECTED_FIELD=provider_response");
      expect(prompts[1]).toContain("REJECTED_RULE=valid_json_object");
      expect(prompts[1]).not.toContain(discardedRawCanary);
      const repairLog = db.prepare(`
        SELECT attributes_json FROM structured_logs
        WHERE run_id = 'run-1' AND domain = 'command-runtime.planner'
      `).get() as { attributes_json: string };
      expect(JSON.parse(repairLog.attributes_json)).toMatchObject({
        code: "invalid_plan",
        validationField: "provider_response",
        validationRule: "valid_json_object",
        rawProviderOutputPersisted: false,
      });
    } finally {
      db.close();
    }
  });

  test("projects a missing or wrong MCP binding only from the assigned specialist's sole reviewed pair", async () => {
    const db = database();
    try {
      const state = seed(db);
      const invalid = JSON.parse(planJson()) as Record<string, any>;
      invalid.steps[0].action.arguments.mcpServer = "unavailable-mcp";
      delete invalid.steps[0].action.arguments.toolName;
      invalid.discardedRawCanary = "NEVER_REPLAY_INVENTORY_PROVIDER_VALUE";
      const prompts: string[] = [];
      const planner = createGrokMissionPlanner({
        database: db,
        inventory: () => inventory,
        callGrok: async (prompt) => {
          prompts.push(prompt);
          return JSON.stringify(invalid);
        },
      });

      const plan = await planner.plan(state, new AbortController().signal);
      expect(plan.steps[0]?.action.arguments).toMatchObject({
        mcpServer: "recon-mcp",
        toolName: "quick_scan",
      });
      expect(prompts).toHaveLength(1);
      expect(JSON.stringify(plan)).not.toContain("NEVER_REPLAY_INVENTORY_PROVIDER_VALUE");
      expect(db.prepare(`
        SELECT COUNT(*) AS count FROM structured_logs
        WHERE domain = 'command-runtime.planner'
      `).get()).toEqual({ count: 0 });
      const marker = db.prepare(`
        SELECT attributes_json FROM structured_logs
        WHERE domain = 'command-runtime.planner.binding'
      `).get() as { attributes_json: string };
      expect(marker.attributes_json).not.toContain("unavailable-mcp");
      expect(marker.attributes_json).not.toContain("NEVER_REPLAY_INVENTORY_PROVIDER_VALUE");
      expect(JSON.parse(marker.attributes_json)).toMatchObject({
        assignedAgentId: "ReconScout",
        mcpServer: "recon-mcp",
        toolName: "quick_scan",
        rawProviderOutputPersisted: false,
      });
    } finally {
      db.close();
    }
  });

  test("does not choose between ambiguous reviewed bindings and uses the bounded repair path without raw replay", async () => {
    const db = database();
    try {
      const state = seed(db);
      const invalid = JSON.parse(invalidBindingPlanJson()) as Record<string, any>;
      const canary = "NEVER_REPLAY_AMBIGUOUS_BINDING";
      invalid.discardedRawCanary = canary;
      const prompts: string[] = [];
      const planner = createGrokMissionPlanner({
        database: db,
        inventory: () => ambiguousInventory,
        callGrok: async (prompt) => {
          prompts.push(prompt);
          return prompts.length === 1 ? JSON.stringify(invalid) : planJson();
        },
      });

      await expect(planner.plan(state, new AbortController().signal)).resolves.toMatchObject({
        steps: [{ action: { arguments: { mcpServer: "recon-mcp", toolName: "quick_scan" } } }],
      });
      expect(prompts).toHaveLength(2);
      expect(prompts[1]).toContain("REJECTED_RULE=available_specialist_mcp_binding");
      expect(prompts[1]).not.toContain(canary);
      expect(prompts[1]).not.toContain("unreviewed-mcp");
      expect(prompts[1]).not.toContain("unreviewed-tool");
      expect(db.prepare(`
        SELECT COUNT(*) AS count FROM structured_logs
        WHERE domain = 'command-runtime.planner.binding'
      `).get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  test("never infers a binding across agents or creates a missing arguments object", async () => {
    for (const mutation of ["other-agent", "missing-arguments"] as const) {
      const db = database();
      try {
        const state = seed(db);
        const invalid = JSON.parse(planJson()) as Record<string, any>;
        if (mutation === "other-agent") invalid.steps[0].assignedAgentId = "WebBreaker";
        else delete invalid.steps[0].action.arguments;
        const prompts: string[] = [];
        const planner = createGrokMissionPlanner({
          database: db,
          inventory: () => inventory,
          callGrok: async (prompt) => {
            prompts.push(prompt);
            return prompts.length === 1 ? JSON.stringify(invalid) : planJson();
          },
        });

        await expect(planner.plan(state, new AbortController().signal)).resolves.toMatchObject({
          steps: [{ assignedAgentId: "ReconScout" }],
        });
        expect(prompts).toHaveLength(2);
        expect(prompts[1]).toContain(mutation === "other-agent"
          ? "REJECTED_RULE=available_specialist"
          : "REJECTED_RULE=required_json_object");
        expect(db.prepare(`
          SELECT COUNT(*) AS count FROM structured_logs
          WHERE domain = 'command-runtime.planner.binding'
        `).get()).toEqual({ count: 0 });
      } finally {
        db.close();
      }
    }
  });

  test("repairs one otherwise-valid plan whose action class is outside the signed Autonomous boundary", async () => {
    const db = database();
    try {
      const state = seed(db);
      const invalid = JSON.parse(planJson()) as Record<string, any>;
      invalid.steps[0].action.actionClass = "credential-access";
      invalid.discardedRawCanary = "NEVER_REPLAY_OUT_OF_CONTRACT_VALUE";
      const prompts: string[] = [];
      const planner = createGrokMissionPlanner({
        database: db,
        inventory: () => inventory,
        callGrok: async (prompt) => {
          prompts.push(prompt);
          return prompts.length === 1 ? JSON.stringify(invalid) : planJson();
        },
      });

      const plan = await planner.plan(state, new AbortController().signal);
      expect(plan.steps[0]?.action.actionClass).toBe("network");
      expect(prompts).toHaveLength(2);
      expect(prompts[0]).toContain("BOTH action.actionType AND action.actionClass must EACH exactly equal");
      expect(prompts[0]).toContain("copy one complete case-sensitive REVIEWED_TOOL_BINDING_PROJECTION");
      expect(prompts[1]).toContain("SCHEMA_REPAIR_ATTEMPT=1_OF_2");
      expect(prompts[1]).toContain("REJECTED_FIELD=steps[0].action.actionClass");
      expect(prompts[1]).toContain("REJECTED_RULE=signed_allowed_action_value");
      expect(prompts[1]).not.toContain("credential-access");
      expect(prompts[1]).not.toContain("NEVER_REPLAY_OUT_OF_CONTRACT_VALUE");
      expect(db.prepare("SELECT COUNT(*) AS count FROM provider_turns WHERE status = 'completed'").get())
        .toEqual({ count: 2 });
    } finally {
      db.close();
    }
  });

  test("fails closed after two repairs when the regenerated target remains outside the signed boundary", async () => {
    const db = database();
    try {
      const state = seed(db);
      const discardedCanaries = ["FIRST_OUTSIDE_TARGET", "SECOND_OUTSIDE_TARGET", "THIRD_OUTSIDE_TARGET"];
      const prompts: string[] = [];
      const planner = createGrokMissionPlanner({
        database: db,
        inventory: () => inventory,
        callGrok: async (prompt) => {
          prompts.push(prompt);
          const invalid = JSON.parse(planJson()) as Record<string, any>;
          invalid.steps[0].action.target = prompts.length === 1 ? "other.internal" : "still-other.internal";
          invalid.discardedRawCanary = discardedCanaries[prompts.length - 1];
          return JSON.stringify(invalid);
        },
      });

      await expect(planner.plan(state, new AbortController().signal)).rejects.toMatchObject({
        code: "invalid_plan",
        options: {
          category: "invalid_input",
          details: {
            validationField: "steps[0].action.target",
            validationRule: "signed_allowed_target",
          },
        },
      });
      expect(prompts).toHaveLength(3);
      expect(prompts[1]).toContain("REJECTED_FIELD=steps[0].action.target");
      expect(prompts[1]).toContain("REJECTED_RULE=signed_allowed_target");
      expect(prompts[1]).not.toContain("other.internal");
      expect(prompts[1]).not.toContain(discardedCanaries[0]);
      expect(prompts[2]).not.toContain(discardedCanaries[0]);
      expect(prompts[2]).not.toContain(discardedCanaries[1]);
      expect(db.prepare("SELECT COUNT(*) AS count FROM provider_turns WHERE status = 'completed'").get())
        .toEqual({ count: 3 });
      expect(db.prepare(`
        SELECT COUNT(*) AS count FROM structured_logs
        WHERE run_id = 'run-1' AND domain = 'command-runtime.planner'
      `).get()).toEqual({ count: 2 });
    } finally {
      db.close();
    }
  });

  test("repairs a destructive plan once and fails closed when the repair still violates the signed destructive policy", async () => {
    const repairDb = database();
    try {
      const state = seed(repairDb);
      repairDb.prepare(`
        UPDATE mission_contracts SET action_policy_json = ? WHERE id = 'contract-1'
      `).run(JSON.stringify({
        allowedActionClasses: ["reconnaissance", "network"],
        prohibitedActionClasses: [],
        specialistAgentIds: ["ReconScout"],
        destructivePolicy: "prohibited",
        contextNodeIds: ["eng-memory"],
      }));
      const prompts: string[] = [];
      const planner = createGrokMissionPlanner({
        database: repairDb,
        inventory: () => inventory,
        callGrok: async (prompt) => {
          prompts.push(prompt);
          const candidate = JSON.parse(planJson()) as Record<string, any>;
          candidate.steps[0].action.destructive = prompts.length === 1;
          if (prompts.length === 1) candidate.discardedRawCanary = "NEVER_REPLAY_DESTRUCTIVE_PLAN";
          return JSON.stringify(candidate);
        },
      });

      await expect(planner.plan(state, new AbortController().signal)).resolves.toMatchObject({
        steps: [{ action: { destructive: false } }],
      });
      expect(prompts).toHaveLength(2);
      expect(prompts[0]).toContain("DESTRUCTIVE_POLICY=\"prohibited\"");
      expect(prompts[0]).toContain("action.destructive must be false unless DESTRUCTIVE_POLICY is exactly contract_only");
      expect(prompts[1]).toContain("REJECTED_FIELD=steps[0].action.destructive");
      expect(prompts[1]).toContain("REJECTED_RULE=signed_destructive_policy");
      expect(prompts[1]).not.toContain("NEVER_REPLAY_DESTRUCTIVE_PLAN");
    } finally {
      repairDb.close();
    }

    const failClosedDb = database();
    try {
      const state = seed(failClosedDb);
      failClosedDb.prepare(`
        UPDATE mission_contracts SET action_policy_json = ? WHERE id = 'contract-1'
      `).run(JSON.stringify({
        allowedActionClasses: ["reconnaissance", "network"],
        prohibitedActionClasses: [],
        specialistAgentIds: ["ReconScout"],
        destructivePolicy: "prohibited",
        contextNodeIds: ["eng-memory"],
      }));
      let providerCalls = 0;
      const planner = createGrokMissionPlanner({
        database: failClosedDb,
        inventory: () => inventory,
        callGrok: async () => {
          providerCalls += 1;
          const candidate = JSON.parse(planJson()) as Record<string, any>;
          candidate.steps[0].action.destructive = true;
          return JSON.stringify(candidate);
        },
      });

      await expect(planner.plan(state, new AbortController().signal)).rejects.toMatchObject({
        code: "invalid_plan",
        options: {
          category: "invalid_input",
          details: {
            validationField: "steps[0].action.destructive",
            validationRule: "signed_destructive_policy",
          },
        },
      });
      expect(providerCalls).toBe(3);
      expect(failClosedDb.prepare(`
        SELECT COUNT(*) AS count FROM structured_logs
        WHERE run_id = 'run-1' AND domain = 'command-runtime.planner'
      `).get()).toEqual({ count: 2 });
    } finally {
      failClosedDb.close();
    }
  });

  test("does not repair secret-bearing plans or exceed a one-turn provider budget", async () => {
    const secretDb = database();
    try {
      const state = seed(secretDb);
      const secretPlan = JSON.parse(analysisOnlyPlanJson()) as Record<string, any>;
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

  test("does not repair an Autonomous manual-action policy denial", async () => {
    const db = database();
    try {
      const state = seed(db);
      const manualPlan = JSON.parse(planJson()) as Record<string, any>;
      manualPlan.steps[0].action.kind = "manual";
      let providerCalls = 0;
      const planner = createGrokMissionPlanner({
        database: db,
        inventory: () => inventory,
        callGrok: async () => {
          providerCalls += 1;
          return JSON.stringify(manualPlan);
        },
      });

      await expect(planner.plan(state, new AbortController().signal)).rejects.toMatchObject({
        code: "autonomous_manual_action_forbidden",
        options: { category: "policy_denied" },
      });
      expect(providerCalls).toBe(1);
      expect(db.prepare(`
        SELECT COUNT(*) AS count FROM structured_logs
        WHERE domain = 'command-runtime.planner'
      `).get()).toEqual({ count: 0 });
      expect(db.prepare(`
        SELECT COUNT(*) AS count FROM structured_logs
        WHERE domain = 'command-runtime.planner.binding'
      `).get()).toEqual({ count: 0 });
    } finally {
      db.close();
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
      db.prepare(`
        UPDATE runs SET status = 'running', current_plan_id = 'plan-1',
          current_step_id = 'step-1' WHERE id = 'run-1'
      `).run();
      const actions = new ActionRepository(db);
      const action = actions.create({
        intent: {
          missionId: "mission-1", runId: "run-1", stepId: "step-1", planVersion: 1,
          assignmentId: "assignment-1", actionType: "reconnaissance", actionClass: "network",
          target: "lab.internal", intentSummary: "Map approved service", kind: "tool",
          idempotent: true, destructive: false,
          arguments: { mcpServer: "sechub-reconnaissance", toolName: "quick_scan", arguments: { host: "lab.internal" } },
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
      expect(invocation).toMatchObject({ specialistAgentId: "ReconScout", mcpServer: "sechub-reconnaissance", toolName: "quick_scan", arguments: { host: "lab.internal" } });
      expect(result.progress.evidenceIds).toHaveLength(1);
      expect(result.usage.evidenceBytes).toBe(Buffer.byteLength("443/tcp open https", "utf8"));
      expect(result.usage.artifactBytes).toBe(0);
      expect(db.prepare("SELECT verification_state, source FROM evidence").get())
        .toEqual({ verification_state: "verified", source: "mcp:sechub-reconnaissance.quick_scan" });
      expect(() => db.prepare("UPDATE evidence SET summary = 'changed'").run()).toThrow("immutable");
    } finally {
      db.close();
    }
  });

  test("repeated identical MCP failures retain one evidence fact and do not manufacture progress", async () => {
    const db = database();
    try {
      seed(db);
      db.prepare(`
        INSERT INTO plans (id, run_id, version, status, strategy_summary, plan_hash, created_by, created_at, activated_at)
        VALUES ('plan-repeat', 'run-1', 1, 'active', 'Bounded repeated observation', ?, 'planner', ?, ?)
      `).run("d".repeat(64), NOW, NOW);
      db.prepare(`
        INSERT INTO plan_steps (
          id, plan_id, run_id, ordinal, phase, title, objective, status,
          assigned_agent_id, created_at, updated_at
        ) VALUES ('step-repeat', 'plan-repeat', 'run-1', 0, 'recon', 'Observe', 'Retain one fact', 'running', 'ReconScout', ?, ?)
      `).run(NOW, NOW);
      db.prepare(`
        INSERT INTO assignments (id, run_id, step_id, agent_id, status, created_at, updated_at)
        VALUES ('assignment-repeat', 'run-1', 'step-repeat', 'ReconScout', 'active', ?, ?)
      `).run(NOW, NOW);
      db.prepare(`
        UPDATE runs SET status = 'running', current_plan_id = 'plan-repeat',
          current_step_id = 'step-repeat' WHERE id = 'run-1'
      `).run();

      const actions = new ActionRepository(db);
      const createAction = () => actions.create({
        intent: {
          missionId: "mission-1", runId: "run-1", stepId: "step-repeat", planVersion: 1,
          assignmentId: "assignment-repeat", actionType: "reconnaissance", actionClass: "network",
          target: "lab.internal", intentSummary: "Repeat the same bounded observation", kind: "tool",
          idempotent: true, destructive: false,
          arguments: {
            mcpServer: "sechub-reconnaissance",
            toolName: "quick_scan",
            arguments: { host: "lab.internal" },
          },
        },
        fingerprint: "same-failed-observation",
        contractId: "contract-1",
        now: NOW,
      });
      const results: Array<{
        success: boolean;
        progress: { evidenceIds?: string[] };
        usage: { evidenceBytes?: number };
      }> = [];
      let release!: () => void;
      const completed = new Promise<void>((resolve) => { release = resolve; });
      const port = new CommandOsBoundedExecutionPort({
        database: db,
        inventory: () => inventory,
        callGrok: async () => "unused",
        executeMcp: async (input) => ({
          success: false,
          mcpServer: input.mcpServer,
          toolName: input.toolName,
          outputPreview: "connection refused by the same endpoint",
          fullOutputBytes: 39,
          evidenceIds: [],
          error: "connection refused",
          isError: true,
          durationMs: 10,
        }),
      });
      port.bindResultSink({
        async acceptExecutionResult(result) {
          results.push(result);
          if (results.length === 2) release();
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

      await port.dispatch(createAction(), new AbortController().signal);
      await port.dispatch(createAction(), new AbortController().signal);
      await completed;

      expect(results).toHaveLength(2);
      expect(results.every((result) => result.success === false)).toBe(true);
      expect(db.prepare("SELECT COUNT(*) AS count FROM evidence").get()).toEqual({ count: 1 });
      expect(db.prepare(`
        SELECT event_type, COUNT(*) AS count FROM evidence_chain_events GROUP BY event_type ORDER BY event_type
      `).all()).toEqual([
        { event_type: "acquired", count: 1 },
        { event_type: "observed_again", count: 1 },
      ]);
      expect(results[0]!.usage.evidenceBytes).toBeGreaterThan(0);
      expect(results[1]!.usage.evidenceBytes).toBe(0);
      expect(evaluateProgress(results[0]!.progress, results[1]!.progress)).toMatchObject({
        meaningful: false,
        dimensions: [],
      });
    } finally {
      db.close();
    }
  });

  test("Autonomous execution rejects approval-required and denied tools before MCP dispatch", async () => {
    const db = database();
    try {
      seed(db);
      db.prepare(`
        INSERT INTO plans (id, run_id, version, status, strategy_summary, plan_hash, created_by, created_at, activated_at)
        VALUES ('plan-policy', 'run-1', 1, 'active', 'Policy boundary', ?, 'planner', ?, ?)
      `).run("c".repeat(64), NOW, NOW);
      db.prepare(`
        INSERT INTO plan_steps (
          id, plan_id, run_id, ordinal, phase, title, objective, status,
          assigned_agent_id, created_at, updated_at
        ) VALUES ('step-policy', 'plan-policy', 'run-1', 0, 'recon', 'Policy', 'Enforce', 'running', 'ReconScout', ?, ?)
      `).run(NOW, NOW);
      db.prepare(`
        INSERT INTO assignments (id, run_id, step_id, agent_id, status, created_at, updated_at)
        VALUES ('assignment-policy', 'run-1', 'step-policy', 'ReconScout', 'active', ?, ?)
      `).run(NOW, NOW);
      const actions = new ActionRepository(db);
      const createAction = (toolName: string, fingerprint: string) => actions.create({
        intent: {
          missionId: "mission-1", runId: "run-1", stepId: "step-policy", planVersion: 1,
          assignmentId: "assignment-policy", actionType: "reconnaissance", actionClass: "network",
          target: "lab.internal", intentSummary: `Attempt ${toolName}`, kind: "tool",
          idempotent: true, destructive: false,
          arguments: { mcpServer: "sechub-reconnaissance", toolName, arguments: { host: "lab.internal" } },
        },
        fingerprint,
        contractId: "contract-1",
        now: NOW,
      });
      const approvalRequired = createAction("nmapScan", "fingerprint-approval-required");
      const denied = createAction("hashcat", "fingerprint-denied");
      let mcpCalls = 0;
      const results: Array<{
        success: boolean;
        failureCategory?: string;
        failure?: { code: string };
      }> = [];
      let resolveResults!: () => void;
      const received = new Promise<void>((resolve) => { resolveResults = resolve; });
      const port = new CommandOsBoundedExecutionPort({
        database: db,
        inventory: () => inventory,
        callGrok: async () => "unused",
        executeMcp: async (input) => {
          mcpCalls += 1;
          return {
            success: true, mcpServer: input.mcpServer, toolName: input.toolName,
            outputPreview: "must not be reached", fullOutputBytes: 0, evidenceIds: [],
            error: null, isError: false, durationMs: 0,
          };
        },
      });
      port.bindResultSink({
        async acceptExecutionResult(result) {
          results.push(result);
          if (results.length === 2) resolveResults();
          return { accepted: true, duplicate: false, actionId: result.actionId, runId: result.runId, runState: "blocked", nextAction: null };
        },
      });

      await port.dispatch(approvalRequired, new AbortController().signal);
      await port.dispatch(denied, new AbortController().signal);
      await received;

      expect(mcpCalls).toBe(0);
      expect(results).toHaveLength(2);
      expect(results.map((result) => result.failure?.code).sort()).toEqual([
        "autonomous_tool_requires_approval",
        "specialist_tool_denied",
      ]);
      expect(results.every((result) => !result.success && result.failureCategory === "policy_denied")).toBe(true);
      expect(db.prepare("SELECT COUNT(*) AS count FROM tool_calls").get()).toEqual({ count: 0 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM evidence").get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  test("rechecks Autonomous authorization after action reservation immediately before MCP execution", async () => {
    const db = database();
    try {
      seed(db);
      db.prepare(`
        INSERT INTO plans (id, run_id, version, status, strategy_summary, plan_hash, created_by, created_at, activated_at)
        VALUES ('plan-race-autonomous', 'run-1', 1, 'active', 'Race boundary', ?, 'planner', ?, ?)
      `).run("e".repeat(64), NOW, NOW);
      db.prepare(`
        INSERT INTO plan_steps (
          id, plan_id, run_id, ordinal, phase, title, objective, status,
          assigned_agent_id, created_at, updated_at
        ) VALUES ('step-race-autonomous', 'plan-race-autonomous', 'run-1', 0, 'recon',
          'Reserved scan', 'Prove current authority', 'running', 'ReconScout', ?, ?)
      `).run(NOW, NOW);
      db.prepare(`
        INSERT INTO assignments (id, run_id, step_id, agent_id, status, created_at, updated_at)
        VALUES ('assignment-race-autonomous', 'run-1', 'step-race-autonomous', 'ReconScout', 'active', ?, ?)
      `).run(NOW, NOW);
      db.prepare(`
        UPDATE runs SET status = 'running', current_plan_id = 'plan-race-autonomous',
          current_step_id = 'step-race-autonomous' WHERE id = 'run-1'
      `).run();
      const action = new ActionRepository(db).create({
        intent: {
          missionId: "mission-1", runId: "run-1", stepId: "step-race-autonomous", planVersion: 1,
          assignmentId: "assignment-race-autonomous", actionType: "reconnaissance", actionClass: "network",
          target: "lab.internal", intentSummary: "Run the already-reserved scan", kind: "tool",
          idempotent: true, destructive: false,
          arguments: {
            mcpServer: "sechub-reconnaissance",
            toolName: "quick_scan",
            arguments: { target: "lab.internal" },
          },
        },
        fingerprint: "fingerprint-race-autonomous",
        contractId: "contract-1",
        now: NOW,
      });
      db.prepare("UPDATE missions SET authorization_status = 'revoked' WHERE id = 'mission-1'").run();

      let mcpCalls = 0;
      let resolveResult!: (value: unknown) => void;
      const received = new Promise((resolve) => { resolveResult = resolve; });
      const port = new CommandOsBoundedExecutionPort({
        database: db,
        inventory: () => inventory,
        callGrok: async () => "unused",
        executeMcp: async (input) => {
          mcpCalls += 1;
          return {
            success: true, mcpServer: input.mcpServer, toolName: input.toolName,
            outputPreview: "must not execute", fullOutputBytes: 0, evidenceIds: [],
            error: null, isError: false, durationMs: 0,
          };
        },
      });
      port.bindResultSink({
        async acceptExecutionResult(result) {
          resolveResult(result);
          return { accepted: true, duplicate: false, actionId: result.actionId, runId: result.runId, runState: "blocked", nextAction: null };
        },
      });
      await port.dispatch(action, new AbortController().signal);
      const result = await received as { success: boolean; failureCategory?: string; failure?: { code: string } };
      expect(result).toMatchObject({
        success: false,
        failureCategory: "authorization_denied",
        failure: { code: "mission_authorization_not_verified" },
      });
      expect(mcpCalls).toBe(0);
      expect(db.prepare("SELECT COUNT(*) AS count FROM tool_calls").get()).toEqual({ count: 0 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM evidence").get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  test("rechecks Guided target scope after exact-step reservation immediately before MCP execution", async () => {
    const db = database();
    try {
      seed(db, "guided");
      db.prepare("UPDATE runs SET status = 'running' WHERE id = 'run-1'").run();
      db.prepare(`
        INSERT INTO plans (id, run_id, version, status, strategy_summary, plan_hash, created_by, created_at, activated_at)
        VALUES ('plan-race-guided', 'run-1', 1, 'active', 'Guided race boundary', ?, 'planner', ?, ?)
      `).run("f".repeat(64), NOW, NOW);
      db.prepare(`
        INSERT INTO plan_steps (
          id, plan_id, run_id, ordinal, phase, title, objective, status,
          assigned_agent_id, created_at, updated_at
        ) VALUES ('step-race-guided', 'plan-race-guided', 'run-1', 0, 'recon',
          'Reserved Guided scan', 'Prove current scope', 'running', 'ReconScout', ?, ?)
      `).run(NOW, NOW);
      db.prepare(`
        INSERT INTO assignments (id, run_id, step_id, agent_id, status, created_at, updated_at)
        VALUES ('assignment-race-guided', 'run-1', 'step-race-guided', 'ReconScout', 'active', ?, ?)
      `).run(NOW, NOW);
      db.prepare(`
        UPDATE runs SET current_plan_id = 'plan-race-guided', current_step_id = 'step-race-guided'
        WHERE id = 'run-1'
      `).run();
      db.prepare(`
        INSERT INTO guided_decisions (
          id, mission_id, run_id, step_id, requested_action_fingerprint,
          requested_parameters_json, rationale, risk_class, reversibility, status,
          decision_actor, decision_reason, decided_at, expires_at, created_at
        ) VALUES ('decision-race-guided', 'mission-1', 'run-1', 'step-race-guided',
          'fingerprint-race-guided', '{}', 'Run the exact scan', 'low', 'Read-only',
          'approved', 'operator:test', 'Run this step', ?, ?, ?)
      `).run(NOW, "2026-07-15T12:05:00.000Z", NOW);
      const action = new ActionRepository(db).create({
        intent: {
          missionId: "mission-1", runId: "run-1", stepId: "step-race-guided", planVersion: 1,
          assignmentId: "assignment-race-guided", actionType: "reconnaissance", actionClass: "network",
          target: "lab.internal", intentSummary: "Run one approved Guided scan", kind: "tool",
          idempotent: true, destructive: false,
          arguments: {
            mcpServer: "sechub-reconnaissance",
            toolName: "quick_scan",
            arguments: { target: "lab.internal" },
          },
        },
        fingerprint: "fingerprint-race-guided",
        guidedDecisionId: "decision-race-guided",
        now: NOW,
      });
      db.prepare("UPDATE mission_targets SET disposition = 'prohibited' WHERE id = 'target-1'").run();

      let mcpCalls = 0;
      let resolveResult!: (value: unknown) => void;
      const received = new Promise((resolve) => { resolveResult = resolve; });
      const port = new CommandOsBoundedExecutionPort({
        database: db,
        inventory: () => inventory,
        callGrok: async () => "unused",
        executeMcp: async (input) => {
          mcpCalls += 1;
          return {
            success: true, mcpServer: input.mcpServer, toolName: input.toolName,
            outputPreview: "must not execute", fullOutputBytes: 0, evidenceIds: [],
            error: null, isError: false, durationMs: 0,
          };
        },
      });
      port.bindResultSink({
        async acceptExecutionResult(result) {
          resolveResult(result);
          return { accepted: true, duplicate: false, actionId: result.actionId, runId: result.runId, runState: "blocked", nextAction: null };
        },
      });
      await port.dispatch(action, new AbortController().signal);
      const result = await received as { success: boolean; failureCategory?: string; failure?: { code: string } };
      expect(result).toMatchObject({
        success: false,
        failureCategory: "scope_conflict",
        failure: { code: "mission_target_not_authorized" },
      });
      expect(mcpCalls).toBe(0);
      expect(db.prepare("SELECT COUNT(*) AS count FROM tool_calls").get()).toEqual({ count: 0 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM evidence").get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  test("rechecks current plan, step, assignment, and agent health immediately before every dispatch", async () => {
    const cases: Array<{
      name: string;
      journey: "autonomous" | "guided";
      kind?: "tool" | "delegation";
      mutate: (db: SqliteDatabase) => void;
    }> = [
      {
        name: "assignment cancelled",
        journey: "autonomous",
        mutate: (db) => { db.prepare("UPDATE assignments SET status = 'cancelled' WHERE id = 'assignment-race-current'").run(); },
      },
      {
        name: "specialist quarantined",
        journey: "guided",
        mutate: (db) => { db.prepare("UPDATE agents SET status = 'quarantined' WHERE id = 'ReconScout'").run(); },
      },
      {
        name: "step reassigned",
        journey: "autonomous",
        mutate: (db) => { db.prepare("UPDATE plan_steps SET assigned_agent_id = NULL WHERE id = 'step-race-current'").run(); },
      },
      {
        name: "plan superseded",
        journey: "guided",
        mutate: (db) => { db.prepare("UPDATE plans SET status = 'superseded' WHERE id = 'plan-race-current'").run(); },
      },
      {
        name: "current plan changed",
        journey: "autonomous",
        mutate: (db) => { db.prepare("UPDATE runs SET current_plan_id = NULL WHERE id = 'run-1'").run(); },
      },
      {
        name: "provider specialist offline",
        journey: "autonomous",
        kind: "delegation",
        mutate: (db) => { db.prepare("UPDATE agents SET status = 'offline' WHERE id = 'ReconScout'").run(); },
      },
    ];

    for (const testCase of cases) {
      const db = database();
      try {
        seed(db, testCase.journey);
        db.prepare("UPDATE runs SET status = 'running' WHERE id = 'run-1'").run();
        db.prepare(`
          INSERT INTO plans (
            id, run_id, version, status, strategy_summary, plan_hash,
            created_by, created_at, activated_at
          ) VALUES ('plan-race-current', 'run-1', 1, 'active',
            'Current assignment boundary', ?, 'planner', ?, ?)
        `).run("7".repeat(64), NOW, NOW);
        db.prepare(`
          INSERT INTO plan_steps (
            id, plan_id, run_id, ordinal, phase, title, objective, status,
            assigned_agent_id, created_at, updated_at
          ) VALUES ('step-race-current', 'plan-race-current', 'run-1', 0,
            'recon', 'Reserved current scan', 'Prove current ownership',
            'running', 'ReconScout', ?, ?)
        `).run(NOW, NOW);
        db.prepare(`
          INSERT INTO assignments (
            id, run_id, step_id, agent_id, status, created_at, updated_at
          ) VALUES ('assignment-race-current', 'run-1', 'step-race-current',
            'ReconScout', 'active', ?, ?)
        `).run(NOW, NOW);
        db.prepare(`
          UPDATE runs SET current_plan_id = 'plan-race-current',
            current_step_id = 'step-race-current' WHERE id = 'run-1'
        `).run();
        const fingerprint = `fingerprint-current-${testCase.name.replaceAll(" ", "-")}`;
        if (testCase.journey === "guided") {
          db.prepare(`
            INSERT INTO guided_decisions (
              id, mission_id, run_id, step_id, requested_action_fingerprint,
              requested_parameters_json, rationale, risk_class, reversibility,
              status, decision_actor, decision_reason, decided_at, expires_at, created_at
            ) VALUES ('decision-race-current', 'mission-1', 'run-1',
              'step-race-current', ?, '{}', 'Run the exact current scan', 'low',
              'Read-only', 'approved', 'operator:test', 'Run this step', ?, ?, ?)
          `).run(fingerprint, NOW, "2026-07-15T12:05:00.000Z", NOW);
        }
        const action = new ActionRepository(db).create({
          intent: {
            missionId: "mission-1",
            runId: "run-1",
            stepId: "step-race-current",
            planVersion: 1,
            assignmentId: "assignment-race-current",
            actionType: "reconnaissance",
            actionClass: "network",
            target: "lab.internal",
            intentSummary: "Run the already-reserved current scan",
            kind: testCase.kind ?? "tool",
            idempotent: true,
            destructive: false,
            arguments: testCase.kind === "delegation"
              ? { question: "Summarize the bounded evidence gap" }
              : {
                  mcpServer: "sechub-reconnaissance",
                  toolName: "quick_scan",
                  arguments: { target: "lab.internal" },
                },
          },
          fingerprint,
          ...(testCase.journey === "autonomous"
            ? { contractId: "contract-1" }
            : { guidedDecisionId: "decision-race-current" }),
          now: NOW,
        });
        testCase.mutate(db);

        let mcpCalls = 0;
        let providerCalls = 0;
        let resolveResult!: (value: unknown) => void;
        const received = new Promise((resolve) => { resolveResult = resolve; });
        const port = new CommandOsBoundedExecutionPort({
          database: db,
          inventory: () => inventory,
          callGrok: async () => {
            providerCalls += 1;
            return "must not execute";
          },
          executeMcp: async (input) => {
            mcpCalls += 1;
            return {
              success: true,
              mcpServer: input.mcpServer,
              toolName: input.toolName,
              outputPreview: "must not execute",
              fullOutputBytes: 0,
              evidenceIds: [],
              error: null,
              isError: false,
              durationMs: 0,
            };
          },
        });
        port.bindResultSink({
          async acceptExecutionResult(result) {
            resolveResult(result);
            return {
              accepted: true,
              duplicate: false,
              actionId: result.actionId,
              runId: result.runId,
              runState: "blocked",
              nextAction: null,
            };
          },
        });

        await port.dispatch(action, new AbortController().signal);
        const result = await received as {
          success: boolean;
          failureCategory?: string;
          failure?: { code: string };
        };
        expect(result).toMatchObject({
          success: false,
          failureCategory: "policy_denied",
          failure: { code: "action_assignment_no_longer_authorized" },
        });
        expect(mcpCalls).toBe(0);
        expect(providerCalls).toBe(0);
        expect(db.prepare("SELECT COUNT(*) AS count FROM tool_calls").get()).toEqual({ count: 0 });
        expect(db.prepare("SELECT COUNT(*) AS count FROM evidence").get()).toEqual({ count: 0 });
      } finally {
        db.close();
      }
    }
  });

  test("the default provider route also requires a fresh live attestation at dispatch", async () => {
    for (const testCase of [
      { name: "missing", attestedAt: null, expectedSuccess: false, expectedCode: "provider_route_unhealthy" },
      { name: "stale", attestedAt: "2026-07-15T11:00:00.000Z", expectedSuccess: false, expectedCode: "provider_route_health_stale" },
      { name: "fresh", attestedAt: NOW, expectedSuccess: true, expectedCode: undefined },
    ] as const) {
      const db = database();
      try {
        seed(db);
        db.prepare(`
          INSERT INTO plans (id, run_id, version, status, strategy_summary, plan_hash, created_by, created_at, activated_at)
          VALUES ('plan-provider-live', 'run-1', 1, 'active', 'Bounded provider analysis', ?, 'planner', ?, ?)
        `).run("e".repeat(64), NOW, NOW);
        db.prepare(`
          INSERT INTO plan_steps (
            id, plan_id, run_id, ordinal, phase, title, objective, status,
            assigned_agent_id, created_at, updated_at
          ) VALUES ('step-provider-live', 'plan-provider-live', 'run-1', 0, 'analysis',
            'Analyze evidence', 'Produce one bounded analysis', 'running', 'ReconScout', ?, ?)
        `).run(NOW, NOW);
        db.prepare(`
          INSERT INTO assignments (id, run_id, step_id, agent_id, status, created_at, updated_at)
          VALUES ('assignment-provider-live', 'run-1', 'step-provider-live', 'ReconScout', 'active', ?, ?)
        `).run(NOW, NOW);
        db.prepare(`
          UPDATE runs SET status = 'running', current_plan_id = 'plan-provider-live',
            current_step_id = 'step-provider-live' WHERE id = 'run-1'
        `).run();
        if (testCase.attestedAt) seedLiveGrokHealth(db, testCase.attestedAt);
        const action = new ActionRepository(db).create({
          intent: {
            missionId: "mission-1", runId: "run-1", stepId: "step-provider-live", planVersion: 1,
            assignmentId: "assignment-provider-live", actionType: "reconnaissance", actionClass: "network",
            target: "lab.internal", intentSummary: "Interpret the bounded evidence", kind: "delegation",
            idempotent: true, destructive: false, arguments: { question: "What does the service record prove?" },
          },
          fingerprint: `provider-live-${testCase.name}`,
          contractId: "contract-1",
          now: NOW,
        });
        let providerCalls = 0;
        let resolveResult!: (value: unknown) => void;
        const received = new Promise((resolve) => { resolveResult = resolve; });
        const port = new CommandOsBoundedExecutionPort({
          database: db,
          inventory: () => inventory,
          now: () => new Date(NOW),
          callGrok: async () => {
            providerCalls += 1;
            return "Bounded provider analysis";
          },
          executeMcp: async () => { throw new Error("MCP must not be called"); },
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
        const result = await received as { success: boolean; failure?: { code: string } };
        expect({ success: result.success, providerCalls, code: result.failure?.code }).toEqual({
          success: testCase.expectedSuccess,
          providerCalls: testCase.expectedSuccess ? 1 : 0,
          code: testCase.expectedCode,
        });
      } finally {
        db.close();
      }
    }
  });

  test("Guided approval-required execution carries and consumes the exact durable step attestation", async () => {
    const db = database();
    try {
      seed(db, "guided");
      db.prepare("UPDATE runs SET status = 'running' WHERE id = 'run-1'").run();
      db.prepare(`
        INSERT INTO plans (id, run_id, version, status, strategy_summary, plan_hash, created_by, created_at, activated_at)
        VALUES ('plan-guided-tool', 'run-1', 1, 'active', 'Exact Guided tool', ?, 'planner', ?, ?)
      `).run("d".repeat(64), NOW, NOW);
      db.prepare(`
        INSERT INTO plan_steps (
          id, plan_id, run_id, ordinal, phase, title, objective, status,
          assigned_agent_id, created_at, updated_at
        ) VALUES ('step-guided-tool', 'plan-guided-tool', 'run-1', 0, 'recon',
          'Exact scan', 'Collect one approved result', 'running', 'ReconScout', ?, ?)
      `).run(NOW, NOW);
      db.prepare(`
        INSERT INTO assignments (id, run_id, step_id, agent_id, status, created_at, updated_at)
        VALUES ('assignment-guided-tool', 'run-1', 'step-guided-tool', 'ReconScout', 'active', ?, ?)
      `).run(NOW, NOW);
      db.prepare(`
        UPDATE runs SET current_plan_id = 'plan-guided-tool',
          current_step_id = 'step-guided-tool' WHERE id = 'run-1'
      `).run();
      db.prepare(`
        INSERT INTO guided_decisions (
          id, mission_id, run_id, step_id, requested_action_fingerprint,
          requested_parameters_json, rationale, risk_class, reversibility, status,
          decision_actor, decision_reason, decided_at, expires_at, created_at
        ) VALUES ('decision-guided-tool', 'mission-1', 'run-1', 'step-guided-tool',
          'fingerprint-guided-tool', '{}', 'Run the exact represented scan', 'medium',
          'Read-only', 'approved', 'operator:test', 'Run this step', ?, ?, ?)
      `).run(NOW, "2026-07-15T12:05:00.000Z", NOW);
      const action = new ActionRepository(db).create({
        intent: {
          missionId: "mission-1", runId: "run-1", stepId: "step-guided-tool", planVersion: 1,
          assignmentId: "assignment-guided-tool", actionType: "reconnaissance", actionClass: "network",
          target: "lab.internal", intentSummary: "Run the exact Guided scan", kind: "tool",
          idempotent: true, destructive: false,
          arguments: {
            mcpServer: "sechub-reconnaissance",
            toolName: "nmapScan",
            arguments: { target: "lab.internal", ports: [443] },
          },
        },
        fingerprint: "fingerprint-guided-tool",
        guidedDecisionId: "decision-guided-tool",
        now: NOW,
      });
      let verifierResult: unknown;
      let capturedAttestation: unknown;
      let resolveResult!: () => void;
      const received = new Promise<void>((resolve) => { resolveResult = resolve; });
      const port = new CommandOsBoundedExecutionPort({
        database: db,
        inventory: () => inventory,
        callGrok: async () => "unused",
        now: () => new Date("2026-07-15T12:01:00.000Z"),
        executeMcp: async (input) => {
          capturedAttestation = input.approvalAttestation;
          verifierResult = verifyAndConsumeGuidedExactStepAttestation(db, {
            attestation: input.approvalAttestation!,
            binding: createMcpExecutionBinding({
              runId: input.runId,
              stepId: input.stepId,
              specialistAgentId: input.specialistAgentId,
              mcpServer: input.mcpServer,
              toolName: input.toolName,
              arguments: input.arguments,
            }),
            verifiedAt: "2026-07-15T12:01:00.000Z",
          });
          return {
            success: (verifierResult as { approved: boolean }).approved,
            mcpServer: input.mcpServer,
            toolName: input.toolName,
            outputPreview: "443/tcp open https",
            fullOutputBytes: 18,
            evidenceIds: [],
            error: null,
            isError: false,
            durationMs: 1,
          };
        },
      });
      port.bindResultSink({
        async acceptExecutionResult(result) {
          expect(result.success).toBe(true);
          resolveResult();
          return {
            accepted: true, duplicate: false, actionId: result.actionId,
            runId: result.runId, runState: "running", nextAction: null,
          };
        },
      });
      await port.dispatch(action, new AbortController().signal);
      await received;
      expect(capturedAttestation).toMatchObject({
        kind: "guided_exact_step",
        actionId: action.id,
        guidedDecisionId: "decision-guided-tool",
        actorId: "operator:test",
      });
      expect(verifierResult).toEqual({ approved: true });
      expect(db.prepare(`
        SELECT COUNT(*) AS count FROM settings
        WHERE key LIKE 'security.mcp-guided-claim.%'
      `).get()).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });

  test("accepts a terminal evaluation that cites an exact canonical verified-evidence ID on the first turn", async () => {
    const db = database();
    try {
      const state = seed(db);
      const evidenceId = seedVerifiedEvidence(db);
      let providerCalls = 0;
      const evaluator = createGrokOutcomeEvaluator({
        database: db,
        callGrok: async () => {
          providerCalls += 1;
          return {
            text: JSON.stringify({
              summary: "The verified service record satisfies the criterion.",
              criteria: [{
                criterion: "A verified service record exists",
                satisfied: true,
                explanation: "The canonical tool result records the approved service.",
                evidenceIds: [evidenceId],
              }],
            }),
            usage: { inputTokens: 10, outputTokens: 5, providerTokens: 15 },
          };
        },
      });
      const result = await evaluator.evaluate({
        mission: state.mission,
        run: state.run,
        planId: "plan-1",
        completedActionIds: ["action-1"],
      }, new AbortController().signal);
      expect(result.success).toBe(true);
      expect(result.criteria[0]?.evidenceIds).toEqual([evidenceId]);
      expect(result.providerUsage).toMatchObject({
        providerTurns: 1,
        providerTokens: 15,
        exactTokenUsage: true,
        exactCostUsage: false,
      });
      expect(providerCalls).toBe(1);
      expect(db.prepare("SELECT status FROM provider_turns").get()).toEqual({ status: "completed" });
    } finally {
      db.close();
    }
  });

  test("repairs one ungrounded evaluator response without replaying or logging discarded raw output", async () => {
    const db = database();
    try {
      const state = seed(db);
      const evidenceId = seedVerifiedEvidence(db);
      const canary = "NEVER_REPLAY_EVALUATOR_RAW_CANARY";
      const prompts: string[] = [];
      const evaluator = createGrokOutcomeEvaluator({
        database: db,
        callGrok: async (prompt) => {
          prompts.push(prompt);
          return prompts.length === 1
            ? {
                text: JSON.stringify({
                  summary: "Ungrounded claim",
                  criteria: [{
                    criterion: "A verified service record exists",
                    satisfied: false,
                    explanation: "No citation was attached.",
                    evidenceIds: [],
                  }],
                  discardedRawCanary: canary,
                }),
                usage: { inputTokens: 10, outputTokens: 5, providerTokens: 15 },
              }
            : {
                text: JSON.stringify({
                  summary: "The criterion is grounded in the verified record.",
                  criteria: [{
                    criterion: "A verified service record exists",
                    satisfied: true,
                    explanation: "The canonical tool result records the approved service.",
                    evidenceIds: [evidenceId],
                  }],
                }),
                usage: { inputTokens: 12, outputTokens: 8, providerTokens: 20 },
              };
        },
      });

      const result = await evaluator.evaluate({
        mission: state.mission,
        run: state.run,
        planId: "plan-1",
        completedActionIds: ["action-1"],
      }, new AbortController().signal);

      expect(result.success).toBe(true);
      expect(result.criteria[0]?.evidenceIds).toEqual([evidenceId]);
      expect(result.providerUsage).toMatchObject({
        providerTurns: 2,
        providerTokens: 35,
        exactTokenUsage: true,
        exactCostUsage: false,
      });
      expect(prompts).toHaveLength(2);
      expect(prompts[1]).toContain("EVIDENCE_CITATION_REPAIR_ATTEMPT=1_OF_1");
      expect(prompts[1]).toContain("REJECTED_RULE=cite_supplied_verified_evidence");
      expect(prompts[1]).toContain(evidenceId);
      expect(prompts[1]).not.toContain(canary);
      expect(db.prepare("SELECT COUNT(*) AS count FROM provider_turns WHERE status = 'completed'").get())
        .toEqual({ count: 2 });
      const repairLog = db.prepare(`
        SELECT attributes_json FROM structured_logs
        WHERE run_id = 'run-1' AND domain = 'command-runtime.evaluator'
      `).get() as { attributes_json: string };
      expect(repairLog.attributes_json).not.toContain(canary);
      expect(JSON.parse(repairLog.attributes_json)).toEqual({
        code: "evaluation_evidence_citation_missing",
        validationField: "criteria[0].evidenceIds",
        validationRule: "cite_supplied_verified_evidence",
        repairAttempt: 1,
        rawProviderOutputPersisted: false,
      });
    } finally {
      db.close();
    }
  });

  test("fails closed after one repair when the second evaluator response is invalid", async () => {
    const db = database();
    try {
      const state = seed(db);
      seedVerifiedEvidence(db);
      let providerCalls = 0;
      const evaluator = createGrokOutcomeEvaluator({
        database: db,
        callGrok: async () => {
          providerCalls += 1;
          return providerCalls === 1
            ? JSON.stringify({
                summary: "Ungrounded claim",
                criteria: [{
                  criterion: "A verified service record exists",
                  satisfied: true,
                  explanation: "The response cites an unknown record.",
                  evidenceIds: ["unknown-evidence"],
                }],
              })
            : "not valid JSON after repair";
        },
      });

      const result = await evaluator.evaluate({
        mission: state.mission,
        run: state.run,
        planId: "plan-1",
        completedActionIds: ["action-1"],
      }, new AbortController().signal);

      expect(result.success).toBe(false);
      expect(result.summary).toBe("Mission success criteria could not be validated against canonical verified evidence.");
      expect(result.criteria).toEqual([{
        criterion: "A verified service record exists",
        satisfied: false,
        explanation: "No sufficient verified evidence was cited.",
        evidenceIds: [],
      }]);
      expect(result.providerUsage).toMatchObject({ providerTurns: 2 });
      expect(providerCalls).toBe(2);
    } finally {
      db.close();
    }
  });

  test("does not request a citation repair when canonical verified evidence is empty", async () => {
    const db = database();
    try {
      const state = seed(db);
      let providerCalls = 0;
      const evaluator = createGrokOutcomeEvaluator({
        database: db,
        callGrok: async () => {
          providerCalls += 1;
          return JSON.stringify({
            summary: "Claimed success without canonical evidence",
            criteria: [{
              criterion: "A verified service record exists",
              satisfied: true,
              explanation: "No canonical record exists.",
              evidenceIds: ["made-up"],
            }],
          });
        },
      });

      const result = await evaluator.evaluate({
        mission: state.mission,
        run: state.run,
        planId: "plan-1",
        completedActionIds: ["action-1"],
      }, new AbortController().signal);

      expect(result.success).toBe(false);
      expect(result.criteria[0]?.evidenceIds).toEqual([]);
      expect(result.providerUsage).toMatchObject({ providerTurns: 1 });
      expect(providerCalls).toBe(1);
      expect(db.prepare(`
        SELECT COUNT(*) AS count FROM structured_logs
        WHERE domain = 'command-runtime.evaluator'
      `).get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  test("does not exceed the signed provider-turn budget to repair evaluator citations", async () => {
    const db = database();
    try {
      const state = seed(db);
      seedVerifiedEvidence(db);
      db.prepare("UPDATE runs SET budget_json = ? WHERE id = 'run-1'")
        .run(JSON.stringify({ providerTurns: 1 }));
      let providerCalls = 0;
      const evaluator = createGrokOutcomeEvaluator({
        database: db,
        callGrok: async () => {
          providerCalls += 1;
          return JSON.stringify({
            summary: "Ungrounded claim",
            criteria: [{
              criterion: "A verified service record exists",
              satisfied: true,
              explanation: "No citation was attached.",
              evidenceIds: [],
            }],
          });
        },
      });

      const result = await evaluator.evaluate({
        mission: state.mission,
        run: state.run,
        planId: "plan-1",
        completedActionIds: ["action-1"],
      }, new AbortController().signal);

      expect(result.success).toBe(false);
      expect(result.providerUsage).toMatchObject({ providerTurns: 1 });
      expect(providerCalls).toBe(1);
    } finally {
      db.close();
    }
  });
});
