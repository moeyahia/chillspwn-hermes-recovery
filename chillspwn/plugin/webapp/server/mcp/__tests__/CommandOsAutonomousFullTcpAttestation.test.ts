import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createDatabaseConnection, migrateDatabase, type SqliteDatabase } from "../../db";
import { CommandOsBoundedExecutionPort } from "../../app/CommandOsRuntimeAdapters";
import { ActionRepository, type DurableAction } from "../../orchestration";
import {
  createAutonomousFullTcpAttestation,
  verifyAndConsumeAutonomousFullTcpAttestation,
} from "../CommandOsAutonomousFullTcpAttestation";
import {
  createMcpExecutionBinding,
  type AutonomousFullTcpAttestation,
  type McpApprovalVerificationResult,
} from "../McpApprovalAttestation";

const STARTED_AT = "2026-07-18T12:00:00.000Z";
const ISSUED_AT = "2026-07-18T12:02:00.000Z";
const VERIFIED_AT = "2026-07-18T12:02:01.000Z";
const ACTION_FINGERPRINT = "a".repeat(64);
const CONTRACT_HASH = "c".repeat(64);
const TARGET = "10.129.39.191";
const ARGUMENTS = Object.freeze({
  target: TARGET,
  scanTechnique: "Connect",
  ports: "1-65535",
  serviceVersionDetection: false,
  timingTemplate: "T3",
});

function seed(database: SqliteDatabase, options: {
  readonly journey?: "autonomous" | "guided";
  readonly controlPlane?: "legacy" | "command_os_v2";
  readonly includeToolBudget?: boolean;
} = {}): DurableAction {
  const journey = options.journey ?? "autonomous";
  const controlPlane = options.controlPlane ?? "command_os_v2";
  const budget = options.includeToolBudget === false
    ? { wallClockMs: 7_200_000 }
    : { wallClockMs: 7_200_000, toolCalls: 10 };
  database.prepare(`
    INSERT INTO missions (
      id, name, objective, journey, status, authorization_status,
      control_plane, created_by, created_at, updated_at
    ) VALUES ('mission-full-tcp', 'Full TCP', 'Map every TCP port on one authorized host', ?,
      'active', 'verified', ?, 'operator', ?, ?)
  `).run(journey, controlPlane, STARTED_AT, STARTED_AT);
  database.prepare(`
    INSERT INTO mission_targets (
      id, mission_id, target, target_type, disposition,
      normalized_target, metadata_json, created_at
    ) VALUES ('target-full-tcp', 'mission-full-tcp', ?, 'ip', 'allowed', ?, '{}', ?)
  `).run(TARGET, TARGET, STARTED_AT);
  database.prepare(`
    INSERT INTO mission_contracts (
      id, mission_id, version, state, contract_hash, authorization_json,
      action_policy_json, budgets_json, safe_stop_json, deliverables_json,
      confirmed_by, confirmed_at, created_at
    ) VALUES ('contract-full-tcp', 'mission-full-tcp', 4, 'confirmed', ?, '{}', ?, ?,
      '{}', '[]', 'operator', ?, ?)
  `).run(
    CONTRACT_HASH,
    JSON.stringify({
      allowedActionClasses: ["port_service_enumeration"],
      prohibitedActionClasses: [],
      destructivePolicy: "prohibited",
      specialistAgentIds: ["ReconScout"],
    }),
    JSON.stringify(budget),
    STARTED_AT,
    STARTED_AT,
  );
  database.prepare(`
    INSERT INTO runs (
      id, mission_id, journey, status, contract_id, budget_json,
      budget_usage_json, control_plane, status_reason, started_at, created_at, updated_at
    ) VALUES ('run-full-tcp', 'mission-full-tcp', ?, 'running', 'contract-full-tcp', ?, ?, ?,
      'Executing autonomously', ?, ?, ?)
  `).run(
    journey,
    JSON.stringify(budget),
    JSON.stringify({ wallClockMs: 120_000, toolCalls: 1 }),
    controlPlane,
    STARTED_AT,
    STARTED_AT,
    STARTED_AT,
  );
  database.prepare(`
    INSERT INTO plans (
      id, run_id, version, status, strategy_summary, plan_hash,
      created_by, created_at, activated_at
    ) VALUES ('plan-full-tcp', 'run-full-tcp', 3, 'active',
      'Map all TCP ports before targeted service fingerprinting', ?, 'planner', ?, ?)
  `).run("p".repeat(64), STARTED_AT, STARTED_AT);
  database.prepare(`
    INSERT INTO agents (
      id, role, display_name, status, tool_policy_json, version, created_at, updated_at
    ) VALUES ('ReconScout', 'reconnaissance', 'Recon Scout', 'busy', ?, '1', ?, ?)
  `).run(JSON.stringify({
    allowedTools: ["nmapScan"],
    deniedTools: [],
    approvalRequiredTools: [],
  }), STARTED_AT, STARTED_AT);
  database.prepare(`
    INSERT INTO agent_capabilities (agent_id, capability, source, enabled, metadata_json)
    VALUES ('ReconScout', 'nmapScan', 'reviewed-full-tcp-test', 1, '{}')
  `).run();
  database.prepare(`
    INSERT INTO mcp_servers (
      id, name, transport, status, capabilities_json, policy_json,
      last_checked_at, created_at, updated_at
    ) VALUES ('pentest-mcp-recon', 'pentest-mcp-recon', 'stdio', 'healthy', ?, ?, ?, ?, ?)
  `).run(
    JSON.stringify(["nmapScan"]),
    JSON.stringify({
      enabled: true,
      startPermitted: true,
      assignedAgents: ["ReconScout"],
    }),
    STARTED_AT,
    STARTED_AT,
    STARTED_AT,
  );
  database.prepare(`
    INSERT INTO plan_steps (
      id, plan_id, run_id, ordinal, phase, title, objective, status,
      action_class, assigned_agent_id, started_at, created_at, updated_at
    ) VALUES ('step-full-tcp', 'plan-full-tcp', 'run-full-tcp', 0, 'reconnaissance',
      'Map all TCP ports', 'Discover every listening TCP service', 'running',
      'port_service_enumeration', 'ReconScout', ?, ?, ?)
  `).run(STARTED_AT, STARTED_AT, STARTED_AT);
  database.prepare(`
    INSERT INTO assignments (
      id, run_id, step_id, agent_id, status, started_at, created_at, updated_at
    ) VALUES ('assignment-full-tcp', 'run-full-tcp', 'step-full-tcp',
      'ReconScout', 'active', ?, ?, ?)
  `).run(STARTED_AT, STARTED_AT, STARTED_AT);
  database.prepare(`
    UPDATE runs SET current_plan_id = 'plan-full-tcp', current_step_id = 'step-full-tcp'
    WHERE id = 'run-full-tcp'
  `).run();
  return new ActionRepository(database).create({
    intent: {
      missionId: "mission-full-tcp",
      runId: "run-full-tcp",
      stepId: "step-full-tcp",
      planVersion: 3,
      assignmentId: "assignment-full-tcp",
      actionType: "port_service_enumeration",
      actionClass: "port_service_enumeration",
      target: TARGET,
      intentSummary: "Check every TCP port on the current authorized host",
      kind: "tool",
      idempotent: true,
      destructive: false,
      arguments: {
        mcpServer: "pentest-mcp-recon",
        toolName: "nmapScan",
        arguments: ARGUMENTS,
      },
    },
    fingerprint: ACTION_FINGERPRINT,
    contractId: "contract-full-tcp",
    now: STARTED_AT,
  });
}

function binding(action: DurableAction, argumentsValue: unknown = ARGUMENTS) {
  return createMcpExecutionBinding({
    runId: action.runId,
    stepId: action.stepId,
    specialistAgentId: "ReconScout",
    mcpServer: "pentest-mcp-recon",
    toolName: "nmapScan",
    arguments: argumentsValue,
  });
}

function mint(database: SqliteDatabase, action: DurableAction): AutonomousFullTcpAttestation {
  return createAutonomousFullTcpAttestation({
    database,
    action,
    specialistAgentId: "ReconScout",
    mcpServer: "pentest-mcp-recon",
    toolName: "nmapScan",
    arguments: ARGUMENTS,
    now: ISSUED_AT,
  });
}

describe("contract-bound Autonomous full-TCP attestation", () => {
  test("binds the current action/plan/contract/target/budgets and consumes exactly once", () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    migrateDatabase(database);
    try {
      const action = seed(database);
      const attestation = mint(database, action);
      expect(attestation).toMatchObject({
        kind: "autonomous_full_tcp",
        actionId: action.id,
        actionFingerprint: ACTION_FINGERPRINT,
        missionId: "mission-full-tcp",
        runId: "run-full-tcp",
        stepId: "step-full-tcp",
        assignmentId: "assignment-full-tcp",
        planId: "plan-full-tcp",
        planVersion: 3,
        contractId: "contract-full-tcp",
        contractVersion: 4,
        contractHash: CONTRACT_HASH,
        normalizedTarget: TARGET,
        actionClass: "port_service_enumeration",
        controlPlane: "command_os_v2",
        destructive: false,
        destructivePolicy: "prohibited",
        wallClockLimitMs: 7_200_000,
        remainingWallClockMs: 7_080_000,
        toolCallLimit: 10,
        remainingToolCalls: 9,
      });
      expect(() => mint(database, action)).toThrow("already has an issued capability");
      const request = { attestation, binding: binding(action), verifiedAt: VERIFIED_AT } as const;
      expect(verifyAndConsumeAutonomousFullTcpAttestation(database, request)).toEqual({ approved: true });
      const auditRows = database.prepare(`
        SELECT id, mission_id, run_id, journey, action, previous_hash, record_hash
        FROM audit_records
        WHERE action IN (
          'mcp.autonomous_full_tcp.issued',
          'mcp.autonomous_full_tcp.consumed'
        )
        ORDER BY rowid ASC
      `).all() as Array<{
        id: string;
        mission_id: string;
        run_id: string;
        journey: string;
        action: string;
        previous_hash: string | null;
        record_hash: string;
      }>;
      expect(auditRows).toHaveLength(2);
      expect(auditRows.map((row) => ({
        missionId: row.mission_id,
        runId: row.run_id,
        journey: row.journey,
        action: row.action,
      }))).toEqual([
        {
          missionId: "mission-full-tcp",
          runId: "run-full-tcp",
          journey: "autonomous",
          action: "mcp.autonomous_full_tcp.issued",
        },
        {
          missionId: "mission-full-tcp",
          runId: "run-full-tcp",
          journey: "autonomous",
          action: "mcp.autonomous_full_tcp.consumed",
        },
      ]);
      expect(auditRows[0]?.id).toMatch(/^audit_mcp_full_tcp_issued_[a-f0-9]{64}$/);
      expect(auditRows[1]?.id).toMatch(/^audit_mcp_full_tcp_consumed_[a-f0-9]{64}$/);
      expect(auditRows[1]?.previous_hash).toBe(auditRows[0]?.record_hash);
      for (const row of auditRows) {
        expect(() => database.prepare(
          "UPDATE audit_records SET details_json = '{}' WHERE id = ?",
        ).run(row.id)).toThrow("audit records are immutable");
        expect(() => database.prepare(
          "DELETE FROM audit_records WHERE id = ?",
        ).run(row.id)).toThrow("audit records are immutable");
      }
      expect(verifyAndConsumeAutonomousFullTcpAttestation(database, request)).toEqual({
        approved: false,
        reason: "the exact Autonomous full-TCP action capability was already consumed",
      });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM audit_records
        WHERE action IN (
          'mcp.autonomous_full_tcp.issued',
          'mcp.autonomous_full_tcp.consumed'
        )
      `).get()).toEqual({ count: 2 });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM settings
        WHERE key LIKE 'security.mcp-autonomous-full-tcp-%'
      `).get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  test("rejects forged envelopes, changed arguments/scope, stale plan/contract, and changed budgets", () => {
    for (const mutation of [
      "forged",
      "actor",
      "arguments",
      "scope",
      "plan",
      "contract",
      "budget",
      "exhausted",
    ] as const) {
      const database = createDatabaseConnection({ filename: ":memory:" });
      migrateDatabase(database);
      try {
        const action = seed(database);
        const issued = mint(database, action);
        let attestation: AutonomousFullTcpAttestation = issued;
        let executionBinding = binding(action);
        if (mutation === "forged") {
          attestation = { ...issued, claimId: "mcpclaim_forged" };
        } else if (mutation === "actor") {
          attestation = { ...issued, actorId: "another-runtime-adapter" };
        } else if (mutation === "arguments") {
          executionBinding = binding(action, { ...ARGUMENTS, target: "10.129.39.192" });
        } else if (mutation === "scope") {
          database.prepare(`
            UPDATE mission_targets SET disposition = 'prohibited'
            WHERE id = 'target-full-tcp'
          `).run();
        } else if (mutation === "plan") {
          database.prepare("UPDATE plans SET version = 4 WHERE id = 'plan-full-tcp'").run();
        } else if (mutation === "contract") {
          database.prepare(`
            UPDATE mission_contracts SET state = 'superseded'
            WHERE id = 'contract-full-tcp'
          `).run();
        } else if (mutation === "budget") {
          database.prepare(`
            UPDATE runs SET budget_usage_json = ? WHERE id = 'run-full-tcp'
          `).run(JSON.stringify({ wallClockMs: 120_000, toolCalls: 2 }));
        } else {
          database.prepare(`
            UPDATE runs SET budget_usage_json = ? WHERE id = 'run-full-tcp'
          `).run(JSON.stringify({ wallClockMs: 120_000, toolCalls: 10 }));
        }
        expect(verifyAndConsumeAutonomousFullTcpAttestation(database, {
          attestation,
          binding: executionBinding,
          verifiedAt: VERIFIED_AT,
        }).approved).toBe(false);
        expect(database.prepare(`
          SELECT COUNT(*) AS count FROM audit_records
          WHERE action = 'mcp.autonomous_full_tcp.consumed'
        `).get()).toEqual({ count: 0 });
      } finally {
        database.close();
      }
    }
  });

  test("fails closed for Guided, legacy-control-plane, and missing finite tool budgets", () => {
    for (const options of [
      { journey: "guided" as const },
      { controlPlane: "legacy" as const },
      { includeToolBudget: false },
    ]) {
      const database = createDatabaseConnection({ filename: ":memory:" });
      migrateDatabase(database);
      try {
        const action = seed(database, options);
        expect(() => mint(database, action)).toThrow("Autonomous full-TCP execution denied");
        expect(database.prepare(`
          SELECT COUNT(*) AS count FROM audit_records
          WHERE action = 'mcp.autonomous_full_tcp.issued'
        `).get()).toEqual({ count: 0 });
      } finally {
        database.close();
      }
    }
  });

  test("two database connections racing issuance and consumption each produce one durable winner", async () => {
    const directory = mkdtempSync(join(import.meta.dir, "full-tcp-claim-"));
    const filename = join(directory, "command-os-v2.sqlite");
    const first = createDatabaseConnection({ filename });
    migrateDatabase(first);
    const second = createDatabaseConnection({ filename });
    try {
      const action = seed(first);
      const issuance = await Promise.allSettled([
        Promise.resolve().then(() => mint(first, action)),
        Promise.resolve().then(() => mint(second, action)),
      ]);
      expect(issuance.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(issuance.filter((result) => result.status === "rejected")).toHaveLength(1);
      const attestation = issuance.find((result) => result.status === "fulfilled")!.value;
      expect(first.prepare(`
        SELECT COUNT(*) AS count FROM audit_records
        WHERE action = 'mcp.autonomous_full_tcp.issued'
      `).get()).toEqual({ count: 1 });
      const request = { attestation, binding: binding(action), verifiedAt: VERIFIED_AT } as const;
      const results = await Promise.all([
        Promise.resolve().then(() => verifyAndConsumeAutonomousFullTcpAttestation(first, request)),
        Promise.resolve().then(() => verifyAndConsumeAutonomousFullTcpAttestation(second, request)),
      ]);
      expect(results.filter((result) => result.approved)).toHaveLength(1);
      expect(results.filter((result) => !result.approved)).toHaveLength(1);
      expect(first.prepare(`
        SELECT COUNT(*) AS count FROM audit_records
        WHERE action = 'mcp.autonomous_full_tcp.consumed'
      `).get()).toEqual({ count: 1 });
      expect(verifyAndConsumeAutonomousFullTcpAttestation(second, request)).toEqual({
        approved: false,
        reason: "the exact Autonomous full-TCP action capability was already consumed",
      });
    } finally {
      second.close();
      first.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("the bounded runtime adapter mints only after authorization and passes the claim to dispatch", async () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    migrateDatabase(database);
    try {
      const action = seed(database);
      let captured: AutonomousFullTcpAttestation | undefined;
      let verifierResult: McpApprovalVerificationResult | undefined;
      let resolveResult!: () => void;
      const completed = new Promise<void>((resolve) => { resolveResult = resolve; });
      const port = new CommandOsBoundedExecutionPort({
        database,
        callGrok: async () => "unused",
        trustedNmapReady: true,
        now: () => new Date(VERIFIED_AT),
        inventory: () => [{
          agentId: "ReconScout",
          role: "reconnaissance",
          description: "Maps one authorized host",
          mcpServer: "pentest-mcp-recon",
          toolNames: ["nmapScan"],
          toolInputSchemas: {
            nmapScan: { type: "object", additionalProperties: true },
          },
          safetyBoundaries: ["one concrete contract target"],
        }],
        executeMcp: async (input) => {
          captured = input.approvalAttestation as AutonomousFullTcpAttestation | undefined;
          verifierResult = verifyAndConsumeAutonomousFullTcpAttestation(database, {
            attestation: input.approvalAttestation!,
            binding: createMcpExecutionBinding({
              runId: input.runId,
              stepId: input.stepId,
              specialistAgentId: input.specialistAgentId,
              mcpServer: input.mcpServer,
              toolName: input.toolName,
              arguments: input.arguments,
            }),
            verifiedAt: VERIFIED_AT,
          });
          return {
            success: verifierResult.approved,
            mcpServer: input.mcpServer,
            toolName: input.toolName,
            outputPreview: "Structured no-network fixture result",
            fullOutputBytes: 36,
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
        },
      });
      await port.dispatch(action, new AbortController().signal);
      await completed;
      expect(captured).toMatchObject({
        kind: "autonomous_full_tcp",
        actionId: action.id,
        actionFingerprint: action.fingerprint,
        argumentsHash: binding(action).argumentsHash,
      });
      expect(verifierResult).toEqual({ approved: true });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM audit_records
        WHERE action = 'mcp.autonomous_full_tcp.consumed'
      `).get()).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });
});
