import { describe, expect, test } from "bun:test";
import { createDatabaseConnection, migrateDatabase } from "../../db";
import type { DurableAction } from "../../orchestration";
import {
  createGuidedExactStepAttestation,
  verifyAndConsumeGuidedExactStepAttestation,
} from "../CommandOsGuidedApproval";
import { createMcpExecutionBinding } from "../McpApprovalAttestation";

const DECIDED_AT = "2026-07-15T15:00:00.000Z";
const VERIFY_AT = "2026-07-15T15:01:00.000Z";
const EXPIRES_AT = "2026-07-15T15:05:00.000Z";

function setup() {
  const database = createDatabaseConnection({ filename: ":memory:" });
  migrateDatabase(database);
  database.prepare(`
    INSERT INTO missions (
      id, name, objective, journey, status, authorization_status,
      created_by, created_at, updated_at
    ) VALUES ('mission-guided-mcp', 'Guided MCP', 'Inspect the authorized lab',
      'guided', 'active', 'verified', 'operator', ?, ?)
  `).run(DECIDED_AT, DECIDED_AT);
  database.prepare(`
    INSERT INTO runs (
      id, mission_id, journey, status, budget_json, budget_usage_json,
      status_reason, started_at, created_at, updated_at
    ) VALUES ('run-guided-mcp', 'mission-guided-mcp', 'guided', 'running', '{}', '{}',
      'Executing one exact Guided step', ?, ?, ?)
  `).run(DECIDED_AT, DECIDED_AT, DECIDED_AT);
  database.prepare(`
    INSERT INTO plans (
      id, run_id, version, status, strategy_summary, plan_hash,
      created_by, created_at, activated_at
    ) VALUES ('plan-guided-mcp', 'run-guided-mcp', 1, 'active',
      'Run one exact approved observation', 'plan-hash-guided-mcp',
      'operator', ?, ?)
  `).run(DECIDED_AT, DECIDED_AT);
  database.prepare(`
    INSERT INTO plan_steps (
      id, plan_id, run_id, ordinal, phase, title, objective, status,
      created_at, updated_at
    ) VALUES ('step-guided-mcp', 'plan-guided-mcp', 'run-guided-mcp', 0,
      'reconnaissance', 'Map the service', 'Collect one exact result', 'running', ?, ?)
  `).run(DECIDED_AT, DECIDED_AT);
  database.prepare(`
    INSERT INTO agents (id, role, display_name, status, version, created_at, updated_at)
    VALUES ('ReconScout', 'reconnaissance', 'Recon Scout', 'busy', '1', ?, ?)
  `).run(DECIDED_AT, DECIDED_AT);
  database.prepare(`
    INSERT INTO assignments (
      id, run_id, step_id, agent_id, status, started_at, created_at, updated_at
    ) VALUES ('assignment-guided-mcp', 'run-guided-mcp', 'step-guided-mcp',
      'ReconScout', 'active', ?, ?, ?)
  `).run(DECIDED_AT, DECIDED_AT, DECIDED_AT);
  database.prepare(`
    INSERT INTO guided_decisions (
      id, mission_id, run_id, step_id, requested_action_fingerprint,
      requested_parameters_json, rationale, risk_class, reversibility, status,
      decision_actor, decision_reason, decided_at, expires_at, created_at
    ) VALUES ('decision-guided-mcp', 'mission-guided-mcp', 'run-guided-mcp',
      'step-guided-mcp', 'fingerprint-guided-mcp', '{}', 'Run the represented scan',
      'medium', 'Read-only', 'approved', 'operator:local', 'Run this exact step', ?, ?, ?)
  `).run(DECIDED_AT, EXPIRES_AT, DECIDED_AT);
  database.prepare(`
    INSERT INTO actions (
      id, mission_id, run_id, step_id, assignment_id, action_type, action_class,
      fingerprint, normalized_arguments_json, scoped_target, status, intent_summary,
      guided_decision_id, started_at, created_at, updated_at
    ) VALUES ('action-guided-mcp', 'mission-guided-mcp', 'run-guided-mcp',
      'step-guided-mcp', 'assignment-guided-mcp', 'reconnaissance', 'reconnaissance',
      'fingerprint-guided-mcp', ?, 'lab.internal', 'running',
      'Map the exact authorized service', 'decision-guided-mcp', ?, ?, ?)
  `).run(JSON.stringify({
    input: {
      mcpServer: "sechub-reconnaissance",
      toolName: "nmapScan",
      arguments: { target: "lab.internal", ports: [80, 443] },
    },
    orchestration: { kind: "tool", idempotent: true, destructive: false },
  }), DECIDED_AT, DECIDED_AT, DECIDED_AT);

  const action: DurableAction = {
    id: "action-guided-mcp",
    missionId: "mission-guided-mcp",
    runId: "run-guided-mcp",
    stepId: "step-guided-mcp",
    actionType: "reconnaissance",
    actionClass: "reconnaissance",
    fingerprint: "fingerprint-guided-mcp",
    arguments: {
      mcpServer: "sechub-reconnaissance",
      toolName: "nmapScan",
      arguments: { target: "lab.internal", ports: [80, 443] },
    },
    target: "lab.internal",
    kind: "tool",
    intentSummary: "Map the exact authorized service",
    status: "running",
    idempotent: true,
    destructive: false,
    guidedDecisionId: "decision-guided-mcp",
    contractId: null,
    contextPackId: null,
    resultSummary: null,
    errorCategory: null,
    retryCount: 0,
    progressSignature: null,
    createdAt: DECIDED_AT,
    startedAt: DECIDED_AT,
    endedAt: null,
  };
  return { database, action };
}

describe("canonical Guided MCP approval attestation", () => {
  test("mints from the exact durable decision and atomically consumes only once", () => {
    const { database, action } = setup();
    try {
      const arguments_ = { target: "lab.internal", ports: [80, 443] };
      const attestation = createGuidedExactStepAttestation({
        database,
        action,
        specialistAgentId: "ReconScout",
        mcpServer: "sechub-reconnaissance",
        toolName: "nmapScan",
        arguments: arguments_,
        now: VERIFY_AT,
      });
      expect(attestation).toMatchObject({
        kind: "guided_exact_step",
        actionId: action.id,
        guidedDecisionId: action.guidedDecisionId,
        actorId: "operator:local",
        resolvedAt: DECIDED_AT,
        expiresAt: EXPIRES_AT,
      });
      const binding = createMcpExecutionBinding({
        runId: action.runId,
        stepId: action.stepId,
        specialistAgentId: "ReconScout",
        mcpServer: "sechub-reconnaissance",
        toolName: "nmapScan",
        arguments: arguments_,
      });
      const request = { attestation, binding, verifiedAt: VERIFY_AT } as const;
      expect(verifyAndConsumeGuidedExactStepAttestation(database, request)).toEqual({ approved: true });
      expect(verifyAndConsumeGuidedExactStepAttestation(database, request)).toEqual({
        approved: false,
        reason: "the exact Guided decision claim was already consumed",
      });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM settings
        WHERE key LIKE 'security.mcp-guided-claim.%'
      `).get()).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });

  test("changed parameters and expired or non-approved decisions fail before consumption", () => {
    const { database, action } = setup();
    try {
      expect(() => createGuidedExactStepAttestation({
        database,
        action,
        specialistAgentId: "ReconScout",
        mcpServer: "sechub-reconnaissance",
        toolName: "nmapScan",
        arguments: { target: "other.internal", ports: [80, 443] },
        now: VERIFY_AT,
      })).toThrow("arguments changed");

      database.prepare(`
        UPDATE guided_decisions SET status = 'expired' WHERE id = 'decision-guided-mcp'
      `).run();
      expect(() => createGuidedExactStepAttestation({
        database,
        action,
        specialistAgentId: "ReconScout",
        mcpServer: "sechub-reconnaissance",
        toolName: "nmapScan",
        arguments: { target: "lab.internal", ports: [80, 443] },
        now: VERIFY_AT,
      })).toThrow("no longer matches");
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM settings
        WHERE key LIKE 'security.mcp-guided-claim.%'
      `).get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });
});
