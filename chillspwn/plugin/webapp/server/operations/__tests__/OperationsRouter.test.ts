import { afterEach, describe, expect, test } from "bun:test";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createDatabaseConnection, migrateDatabase } from "../../db";
import { hashJson } from "../../orchestration/serialization";
import { createOperationsRouter } from "../../routes/operationsRoutes";
import type { OperationsAccessPolicy } from "../types";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

type Db = ReturnType<typeof createDatabaseConnection>;
const A = "2026-07-15T10:00:00.000Z";
const B = "2026-07-15T10:01:00.000Z";
const C = "2026-07-15T10:02:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function seed(database: Db): void {
  const mission = database.prepare(`
    INSERT INTO missions (id, name, objective, journey, engagement_id, created_by, created_at, updated_at)
    VALUES (?, ?, 'Authorized test objective', 'guided', ?, 'operator', ?, ?)
  `);
  mission.run("mission-a", "Engagement A", "eng-a", A, C);
  mission.run("mission-b", "Engagement B", "eng-b", A, C);
  const run = database.prepare(`
    INSERT INTO runs (id, mission_id, journey, status, progress, created_at, updated_at)
    VALUES (?, ?, 'guided', 'running', 0.5, ?, ?)
  `);
  run.run("run-a", "mission-a", A, C);
  run.run("run-b", "mission-b", A, C);
  database.prepare(`
    UPDATE runs SET status = 'completed', progress = 1, retry_count = 1,
      replan_count = 1, status_reason = 'Authorized objective completed', ended_at = ?
    WHERE id = 'run-a'
  `).run(C);

  const agent = database.prepare(`
    INSERT INTO agents (
      id, role, display_name, status, provider_policy_json, tool_policy_json,
      configuration_json, version, last_heartbeat_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, '{}', '1', ?, ?, ?)
  `);
  agent.run("agent-one", "recon", "Recon One", "busy", JSON.stringify({ provider: "grok", api_key: "provider-secret-123" }), JSON.stringify({ allow: ["scan"], token: "tool-secret-123" }), C, A, C);
  agent.run("agent-two", "report", "Report Two", "available", "{}", "{}", C, A, B);
  database.prepare(`INSERT INTO agent_capabilities (agent_id, capability, source, enabled) VALUES ('agent-one', 'network.recon', 'runtime', 1)`).run();
  const assignment = database.prepare(`
    INSERT INTO assignments (
      id, run_id, agent_id, status, lease_owner, last_heartbeat_at,
      lease_expires_at, started_at, created_at, updated_at
    ) VALUES (?, ?, 'agent-one', 'active', 'worker', ?, ?, ?, ?, ?)
  `);
  assignment.run("assignment-a", "run-a", B, "2026-07-15T11:00:00.000Z", A, A, C);
  assignment.run("assignment-b", "run-b", B, "2026-07-15T11:00:00.000Z", A, A, C);

  const evidence = database.prepare(`
    INSERT INTO evidence (
      id, mission_id, run_id, source, acquired_at, target, evidence_type,
      content_hash, provenance_json, confidence, sensitivity, verification_state,
      summary, extracted_text, created_by, created_at
    ) VALUES (?, ?, ?, 'specialist', ?, 'lab.internal', 'service', ?, ?, 0.9, 'private', 'verified', ?, ?, 'agent-one', ?)
  `);
  evidence.run("evidence-a-new", "mission-a", "run-a", C, HASH_A, JSON.stringify({ source: "scan", credential: "provenance-secret-123" }), "Credential service confirmed", "password=raw-secret-123", C); // gitleaks:allow -- synthetic redaction fixture
  evidence.run("evidence-a-old", "mission-a", "run-a", B, HASH_B, "{}", "Older service evidence", null, B);
  evidence.run("evidence-b", "mission-b", "run-b", C, HASH_B, "{}", "Engagement B must remain hidden", null, C);
  database.prepare(`
    INSERT INTO evidence_chain_events (id, evidence_id, event_type, actor, details_json, occurred_at)
    VALUES ('chain-a', 'evidence-a-new', 'acquired', 'agent-one', '{"api_key":"chain-secret-123"}', ?) -- gitleaks:allow: synthetic redaction fixture
  `).run(C);

  const finding = database.prepare(`
    INSERT INTO findings (
      id, mission_id, run_id, title, severity, confidence, affected_scope,
      description, impact, review_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'high', 0.9, 'lab.internal', 'Evidence-backed issue', 'Authorized impact', 'under_review', ?, ?)
  `);
  finding.run("finding-a-empty", "mission-a", "run-a", "No linked evidence", B, B);
  finding.run("finding-a-ready", "mission-a", "run-a", "Ready to verify", B, B);
  finding.run("finding-b", "mission-b", "run-b", "Hidden finding", B, B);
  database.prepare(`INSERT INTO finding_evidence (finding_id, evidence_id, relationship, added_at) VALUES ('finding-a-ready', 'evidence-a-new', 'supports', ?)`).run(C);

  const artifact = database.prepare(`
    INSERT INTO artifacts (
      id, mission_id, run_id, journey, artifact_type, storage_uri, content_hash,
      byte_size, media_type, sensitivity, metadata_json, created_at
    ) VALUES (?, ?, ?, 'guided', ?, ?, ?, 128, 'application/json', 'private', ?, ?)
  `);
  artifact.run("artifact-report-a", "mission-a", "run-a", "mission_report", "https://user:password@storage.invalid/report", HASH_A, JSON.stringify({ title: "Report", access_token: "artifact-secret-123" }), C);
  artifact.run("artifact-data-a", "mission-a", "run-a", "capture", "file:///restricted/capture", HASH_B, "{}", B);
  artifact.run("artifact-report-b", "mission-b", "run-b", "mission_report", "file:///hidden/report", HASH_B, "{}", C);

  const event = database.prepare(`
    INSERT INTO events (
      id, mission_id, run_id, sequence, event_type, occurred_at, actor_type,
      actor_id, summary, payload_json, journey, trace_id, sensitivity, created_at
    ) VALUES (?, ?, ?, 1, 'evidence.added', ?, 'agent', 'agent-one', ?, ?, 'guided', 'trace-shared', 'private', ?)
  `);
  event.run("event-a", "mission-a", "run-a", C, "Evidence added", JSON.stringify({ api_key: "event-secret-123", result: "Bearer event-bearer-secret" }), C);
  event.run("event-b", "mission-b", "run-b", C, "Hidden event", "{}", C);
  const log = database.prepare(`
    INSERT INTO structured_logs (
      id, mission_id, run_id, severity, domain, message, attributes_json,
      trace_id, sensitivity, occurred_at
    ) VALUES (?, ?, ?, 'error', 'runtime', ?, ?, 'trace-shared', 'private', ?)
  `);
  log.run("log-a", "mission-a", "run-a", "Provider error Bearer log-bearer-secret", JSON.stringify({ password: "log-secret-123", category: "timeout" }), C);
  log.run("log-b", "mission-b", "run-b", "Hidden engagement error", "{}", C);
  database.prepare(`
    INSERT INTO health_snapshots (id, component_type, component_id, status, metrics_json, message, captured_at)
    VALUES ('health-agent', 'agent', 'agent-one', 'healthy', '{"token":"health-secret-123","latency":5}', 'Healthy', ?)
  `).run(C);

  database.prepare(`
    INSERT INTO run_evaluations (
      id, mission_id, run_id, journey, scores_json, metrics_json,
      retrospective, evidence_coverage, created_by, created_at
    ) VALUES (?, ?, ?, 'guided', '{"completion":0.9}', '{"retries":0}', 'Evidence-linked evaluation', 0.8, 'evaluator', ?)
  `).run("evaluation-a", "mission-a", "run-a", C);
  database.prepare(`
    INSERT INTO run_evaluations (
      id, mission_id, run_id, journey, scores_json, metrics_json,
      retrospective, evidence_coverage, created_by, created_at
    ) VALUES (?, ?, ?, 'guided', '{}', '{}', 'Hidden evaluation', 0.5, 'evaluator', ?)
  `).run("evaluation-b", "mission-b", "run-b", C);
  const comparison = database.prepare(`
    INSERT INTO run_evaluation_comparisons (
      evaluation_id, run_id, comparison_status, reason, metrics_json, summary, created_at
    ) VALUES (?, ?, 'insufficient_data', 'no_prior_same_scope_evaluation', '[]',
      'Insufficient comparable data: no earlier evaluated run exists in this scope.', ?)
  `);
  comparison.run("evaluation-a", "run-a", C);
  comparison.run("evaluation-b", "run-b", C);

  const lesson = database.prepare(`
    INSERT INTO lessons (
      id, statement, lesson_type, applicability_scope, engagement_id, mission_id,
      confidence, expected_benefit, risk, status, authoring_agent_id, created_at, updated_at
    ) VALUES (?, ?, 'strategy', 'engagement', ?, ?, 0.8, 'Avoid repeated work', 'Low', 'under_review', ?, ?, ?)
  `);
  lesson.run("lesson-ready", "Use confirmed service evidence", "eng-a", "mission-a", "agent-other", B, B);
  lesson.run("lesson-self", "Self-authored lesson", "eng-a", "mission-a", "agent-self", B, B);
  lesson.run("lesson-empty", "Lesson without support", "eng-a", "mission-a", "agent-other", B, B);
  lesson.run("lesson-b", "Hidden lesson", "eng-b", "mission-b", "agent-other", B, B);
  const lessonEvidence = database.prepare(`
    INSERT INTO lesson_evidence (lesson_id, evidence_id, relationship, rationale, created_at)
    VALUES (?, 'evidence-a-new', 'supports', 'Direct supporting evidence', ?)
  `);
  lessonEvidence.run("lesson-ready", C);
  lessonEvidence.run("lesson-self", C);
  database.prepare(`
    INSERT INTO lesson_usage (
      id, lesson_id, mission_id, run_id, influence_summary, measured_impact_json, used_at
    ) VALUES ('usage-a', 'lesson-ready', 'mission-a', 'run-a', 'Changed the plan', '{"savedActions":2}', ?)
  `).run(C);

  const providerTurn = database.prepare(`
    INSERT INTO provider_turns (
      id, run_id, provider, model, status, input_tokens, output_tokens,
      estimated_cost, latency_ms, started_at, ended_at
    ) VALUES (?, ?, 'grok', 'expert', 'completed', 10, 20, 0, 100, ?, ?)
  `);
  providerTurn.run("turn-a", "run-a", B, C);
  providerTurn.run("turn-b", "run-b", B, C);
  database.prepare(`
    INSERT INTO mcp_servers (
      id, name, transport, endpoint_redacted, status, capabilities_json,
      policy_json, last_checked_at, created_at, updated_at
    ) VALUES ('mcp-one', 'Higgsfield', 'http', 'https://mcp.invalid/[redacted]', 'healthy', '["analyze"]', '{"client_secret":"mcp-secret-123","allow":true}', ?, ?, ?)
  `).run(C, A, C);
  database.prepare(`
    INSERT INTO settings (key, value_json, sensitivity, version, updated_by, updated_at)
    VALUES ('policy.execution', '{"authorization":"policy-secret-123","mode":"enforce"}', 'internal', 1, 'admin', ?)
  `).run(C);
  database.prepare(`
    INSERT INTO actions (
      id, mission_id, run_id, action_type, action_class, fingerprint,
      normalized_arguments_json, status, intent_summary, result_summary,
      error_category, retry_count, created_at, updated_at
    ) VALUES (
      'action-a', 'mission-a', 'run-a', 'scan', 'reconnaissance', ?,
      '{"password":"action-secret-123"}', 'succeeded', 'Map approved target', -- gitleaks:allow -- synthetic redaction fixture
      'Unique evidence retained', NULL, 1, ?, ?
    )
  `).run("f".repeat(64), B, C);
  database.prepare(`
    INSERT INTO approvals (
      id, mission_id, run_id, approval_type, status, requested_by,
      decided_by, reason, policy_rule, request_json, decided_at, created_at
    ) VALUES (
      'approval-a', 'mission-a', 'run-a', 'finding_review', 'approved',
      'reviewer-one', 'reviewer-one', 'Reviewed authorization token=approval-secret-123', -- gitleaks:allow -- synthetic redaction fixture
      'evidence.required', '{"credential":"approval-request-secret-123"}', ?, ? -- gitleaks:allow -- synthetic redaction fixture
    )
  `).run(C, B);
  database.prepare(`
    INSERT INTO memory_context_packs (
      id, mission_id, run_id, journey, purpose, query_redacted,
      scope_policy_json, context_budget, retrieval_metrics_json, created_by, created_at
    ) VALUES (
      'context-a', 'mission-a', 'run-a', 'guided', 'Select verified lesson',
      '[REDACTED]', '{}', 512, '{"precision":1}', 'commander', ?
    )
  `).run(B);
  database.prepare("UPDATE actions SET context_pack_id = 'context-a' WHERE id = 'action-a'").run();
  database.prepare("UPDATE artifacts SET action_id = 'action-a' WHERE id = 'artifact-report-a'").run();
}

async function application() {
  const database = createDatabaseConnection({ filename: ":memory:" });
  migrateDatabase(database);
  seed(database);
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.use(createOperationsRouter({
    database,
    clock: () => new Date("2026-07-15T10:30:00.000Z"),
    resolveActor: (request) => {
      const id = request.get("X-Test-Actor") ?? "reviewer-one";
      return { id, type: id.startsWith("agent-") ? "agent" : "reviewer" };
    },
    resolveAccess: (request): OperationsAccessPolicy => request.get("X-Test-Access") === "all"
      ? {
          maximumSensitivity: "restricted", allEngagements: true,
          allowUnscopedSystemData: true, allowGlobalKnowledge: true,
          canReviewFindings: true, canOverrideEvidenceGate: true, canReviewLessons: true,
        }
      : {
          maximumSensitivity: "private", engagementIds: ["eng-a"], missionIds: ["mission-a"],
          allowUnscopedSystemData: true, allowGlobalKnowledge: true,
          canReviewFindings: true, canOverrideEvidenceGate: true, canReviewLessons: true,
        },
  }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  return { database, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

async function body(response: Response): Promise<any> {
  return response.json() as Promise<any>;
}

describe("canonical operations HTTP API", () => {
  test("projects canonical Guided recovery evidence, checkpoint budgets, memory links, and only real controls", async () => {
    const { database, url } = await application();
    try {
      database.prepare(`
        INSERT INTO runs (
          id, mission_id, journey, status, current_step_id, progress, status_reason,
          next_action_summary, budget_json, budget_usage_json, retry_count, replan_count,
          created_at, updated_at
        ) VALUES (
          'run-recovery-a', 'mission-a', 'guided', 'blocked', NULL, 0.25,
          'Guided recovery blocked after timeout; a new exact decision is ready.',
          'Review the replacement action', ?, ?, 1, 0, ?, ?
        )
      `).run(JSON.stringify({ retryBudget: 2, replanBudget: 1 }), JSON.stringify({ retries: 1 }), A, C);
      database.prepare(`
        INSERT INTO plans (id, run_id, version, status, strategy_summary, plan_hash, created_by, created_at)
        VALUES ('plan-recovery-a', 'run-recovery-a', 1, 'active', 'Bounded recovery plan', ?, 'commander', ?)
      `).run("1".repeat(64), A);
      database.prepare(`
        INSERT INTO plan_steps (
          id, plan_id, run_id, ordinal, phase, title, objective, status,
          success_criteria_json, dependencies_json, action_class, risk_class,
          assigned_agent_id, created_at, updated_at
        ) VALUES (
          'step-recovery-a', 'plan-recovery-a', 'run-recovery-a', 0, 'recovery',
          'Try bounded alternative', 'Collect different evidence', 'waiting_guided_decision',
          '[]', '[]', 'reconnaissance', 'low', 'agent-one', ?, ?
        )
      `).run(A, C);
      database.prepare(`UPDATE runs SET current_plan_id = 'plan-recovery-a', current_step_id = 'step-recovery-a', current_owner_id = 'agent-one' WHERE id = 'run-recovery-a'`).run();
      database.prepare(`
        INSERT INTO guided_decisions (
          id, mission_id, run_id, step_id, requested_action_fingerprint,
          requested_parameters_json, rationale, risk_class, reversibility,
          status, expires_at, created_at
        ) VALUES (
          'decision-recovery-a', 'mission-a', 'run-recovery-a', 'step-recovery-a', ?,
          '{}', 'Use a materially different bounded check', 'low', 'Read-only',
          'pending', '2026-07-16T10:00:00.000Z', ?
        )
      `).run("2".repeat(64), C);
      database.prepare(`
        INSERT INTO actions (
          id, mission_id, run_id, step_id, action_type, action_class, fingerprint,
          normalized_arguments_json, status, intent_summary, result_summary,
          error_category, retry_count, ended_at, created_at, updated_at
        ) VALUES (
          'action-recovery-a', 'mission-a', 'run-recovery-a', 'step-recovery-a',
          'scan', 'reconnaissance', ?, '{}', 'timed_out', 'Map the approved service',
          'Provider timed out without evidence', 'timeout', 0, ?, ?, ?
        )
      `).run("3".repeat(64), B, A, B);
      database.prepare(`
        INSERT INTO events (
          id, mission_id, run_id, sequence, event_type, occurred_at, actor_type,
          summary, payload_json, journey, sensitivity, created_at
        ) VALUES (
          'event-recovery-a', 'mission-a', 'run-recovery-a', 1, 'action.completed', ?,
          'worker', 'Bounded action timed out; Guided recovery prepared',
          '{"directive":"recover","errorCategory":"timeout"}', 'guided', 'internal', ?
        )
      `).run(B, B);
      const state = {
        schemaVersion: 1,
        run: { id: "run-recovery-a", missionId: "mission-a", journey: "guided", state: "blocked", stateVersion: 1, reason: "Guided recovery blocked after timeout", leaseOwner: null, leaseExpiresAt: null },
        control: { budget: { limits: { retries: 2, replans: 1 }, usage: { retries: 1 } }, retryCount: 1, replanCount: 0, circuits: {}, progress: {} },
        completedActionIds: [], inFlightActions: [], lastEventSequence: 1,
      };
      database.prepare(`
        INSERT INTO checkpoints (
          id, mission_id, run_id, journey, event_sequence, plan_version, state_json,
          state_hash, in_flight_classification, created_at
        ) VALUES ('checkpoint-recovery-a', 'mission-a', 'run-recovery-a', 'guided', 1, 1, ?, ?, 'safe_no_in_flight_action', ?)
      `).run(JSON.stringify(state), hashJson(state), B);
      database.prepare(`
        INSERT INTO memory_nodes (
          id, node_type, title, summary, body, scope, engagement_id, mission_id,
          sensitivity, confidence, lifecycle_status, confirmation_state,
          provenance_json, author_type, created_at, updated_at
        ) VALUES (
          'memory-failure-a', 'failure', 'Timeout produced no evidence', 'Avoid an identical retry', '',
          'mission', 'eng-a', 'mission-a', 'private', 0.9, 'verified', 'not_required',
          '{}', 'system', ?, ?
        )
      `).run(B, B);
      database.prepare(`
        INSERT INTO memory_sources (
          id, node_id, source_type, source_id, mission_id, run_id, acquired_at, created_at
        ) VALUES ('source-failure-a', 'memory-failure-a', 'run', 'run-recovery-a', 'mission-a', 'run-recovery-a', ?, ?)
      `).run(B, B);
      database.prepare(`
        INSERT INTO lessons (
          id, statement, lesson_type, applicability_scope, engagement_id, mission_id,
          failure_category, retry_conditions, confidence, expected_benefit, risk,
          status, authoring_agent_id, created_at, updated_at
        ) VALUES (
          'lesson-failure-a', 'Use a different provider only after policy validation', 'failed_attempt',
          'mission', 'eng-a', 'mission-a', 'timeout', 'Provider health materially changes',
          0.8, 'Avoid repeated timeout', 'Low', 'under_review', 'agent-one', ?, ?
        )
      `).run(B, B);
      database.prepare(`
        INSERT INTO lesson_evidence (lesson_id, run_id, relationship, rationale, created_at)
        VALUES ('lesson-failure-a', 'run-recovery-a', 'supports', 'Canonical failed run', ?)
      `).run(B);

      const response = await fetch(`${url}/api/v2/operations/runs/run-recovery-a/recovery`);
      expect(response.status).toBe(200);
      const recovery = await body(response);
      expect(recovery).toMatchObject({
        schemaVersion: "2.1",
        recoveryRequired: true,
        run: { id: "run-recovery-a", journey: "guided", status: "blocked" },
        detection: { category: "timeout", failedActions: [{ id: "action-recovery-a", status: "timed_out" }] },
        checkpoint: { id: "checkpoint-recovery-a", eventSequence: 1, planVersion: 1 },
        attempts: { retryCount: 1, retryLimit: 2, retriesRemaining: 1, replanCount: 0, replanLimit: 1, replansRemaining: 1 },
        proposedRecovery: { kind: "guided_decision" },
        guidedDecision: { id: "decision-recovery-a", stepId: "step-recovery-a" },
      });
      expect(recovery.failedAttemptMemories.map((item: any) => `${item.kind}:${item.id}`).sort()).toEqual([
        "lesson:lesson-failure-a", "memory:memory-failure-a",
      ]);
      expect(recovery.actions.find((item: any) => item.kind === "resume")).toMatchObject({ available: true, command: "resume" });
      expect(recovery.actions.find((item: any) => item.kind === "terminate")).toMatchObject({ available: true, command: "cancel" });
      for (const kind of ["replan", "reassign", "change_provider"]) {
        expect(recovery.actions.find((item: any) => item.kind === kind)).toMatchObject({ available: false, command: null });
      }
      expect((await fetch(`${url}/api/v2/operations/runs/run-b/recovery`)).status).toBe(404);
    } finally { database.close(); }
  });

  test("labels an out-of-contract Autonomous terminal state as a safe stop", async () => {
    const { database, url } = await application();
    try {
      database.prepare(`
        INSERT INTO missions (id, name, objective, journey, engagement_id, created_by, created_at, updated_at)
        VALUES ('mission-auto-a', 'Autonomous A', 'Stay in authorized scope', 'autonomous', 'eng-a', 'operator', ?, ?)
      `).run(A, C);
      database.prepare(`
        INSERT INTO runs (
          id, mission_id, journey, status, progress, status_reason, budget_json,
          budget_usage_json, retry_count, replan_count, ended_at, created_at, updated_at
        ) VALUES (
          'run-auto-safe-stop', 'mission-auto-a', 'autonomous', 'failed', 0.4,
          'No in-contract path remains after scope policy denial',
          '{"retryBudget":2,"replanBudget":2}', '{}', 0, 0, ?, ?, ?
        )
      `).run(C, A, C);
      const recovery = await body(await fetch(`${url}/api/v2/operations/runs/run-auto-safe-stop/recovery`));
      expect(recovery).toMatchObject({
        recoveryRequired: true,
        run: { journey: "autonomous", status: "failed" },
        proposedRecovery: { kind: "safe_stop" },
      });
      expect(recovery.proposedRecovery.impact.scope).toContain("contract remains unchanged");
      expect(recovery.actions.find((item: any) => item.kind === "terminate")).toMatchObject({ available: false, command: null });
    } finally { database.close(); }
  });

  test("cursor pagination and assignment projections remain engagement scoped", async () => {
    const { database, url } = await application();
    try {
      const first = await body(await fetch(`${url}/api/v2/agents?limit=1`));
      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).toEqual(expect.any(String));
      const second = await body(await fetch(`${url}/api/v2/agents?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`));
      expect(second.items).toHaveLength(1);
      expect(second.items[0].id).not.toBe(first.items[0].id);

      const assignments = await body(await fetch(`${url}/api/v2/agents/agent-one/assignments`));
      expect(assignments.items.map((item: any) => item.id)).toEqual(["assignment-a"]);
      expect(JSON.stringify(assignments)).not.toContain("assignment-b");

      const evidenceFirst = await body(await fetch(`${url}/api/v2/intelligence/evidence?limit=1`));
      expect(evidenceFirst.items[0].id).toBe("evidence-a-new");
      const evidenceSecond = await body(await fetch(`${url}/api/v2/intelligence/evidence?limit=1&cursor=${encodeURIComponent(evidenceFirst.nextCursor)}`));
      expect(evidenceSecond.items[0].id).toBe("evidence-a-old");
      expect(JSON.stringify(evidenceFirst)).not.toContain("Engagement B");
      const searched = await body(await fetch(`${url}/api/v2/intelligence/evidence?query=Credential`));
      expect(searched.items.map((item: any) => item.id)).toEqual(["evidence-a-new"]);
      const findings = await body(await fetch(`${url}/api/v2/intelligence/findings?query=Ready`));
      expect(findings.items.map((item: any) => item.id)).toEqual(["finding-a-ready"]);
    } finally { database.close(); }
  });

  test("correlated observability and system projections redact secrets", async () => {
    const { database, url } = await application();
    try {
      const events = await body(await fetch(`${url}/api/v2/observability/events?traceId=trace-shared`));
      expect(events.items.map((item: any) => item.id)).toEqual(["event-a"]);
      expect(events.items[0].correlation.traceId).toBe("trace-shared");
      const logs = await body(await fetch(`${url}/api/v2/observability/logs?traceId=trace-shared&query=Provider`));
      expect(logs.items.map((item: any) => item.id)).toEqual(["log-a"]);
      const agent = await body(await fetch(`${url}/api/v2/agents/agent-one`));
      const evidence = await body(await fetch(`${url}/api/v2/intelligence/evidence/evidence-a-new`));
      const policies = await body(await fetch(`${url}/api/v2/system/policies`));
      const mcp = await body(await fetch(`${url}/api/v2/system/mcp`));
      const report = await body(await fetch(`${url}/api/v2/reports`));
      expect(report.items.map((item: any) => item.id)).toEqual(["artifact-report-a"]);
      expect(report.items[0].storage).toEqual({ scheme: "https", available: true });
      expect(report.items[0].contextPackIds).toEqual(["context-a"]);
      expect((await fetch(`${url}/api/v2/reports/artifact-data-a`)).status).toBe(404);
      const providers = await body(await fetch(`${url}/api/v2/system/providers`));
      expect(providers.items).toMatchObject([{ provider: "grok", model: "expert", turnCount: 1 }]);
      const health = await body(await fetch(`${url}/api/v2/system/health`));
      expect(health.items).toMatchObject([{ componentType: "agent", componentId: "agent-one", status: "healthy" }]);
      const evaluations = await body(await fetch(`${url}/api/v2/learning/evaluations`));
      expect(evaluations.items.map((item: any) => item.id)).toEqual(["evaluation-a"]);
      expect(evaluations.items[0].comparison).toMatchObject({
        status: "insufficient_data",
        reason: "no_prior_same_scope_evaluation",
        prior: null,
        metrics: [],
      });
      const combined = JSON.stringify({ events, logs, agent, evidence, policies, mcp, report });
      for (const secret of [
        "provider-secret-123", "tool-secret-123", "event-secret-123", "event-bearer-secret",
        "log-bearer-secret", "log-secret-123", "raw-secret-123", "provenance-secret-123", // gitleaks:allow -- synthetic redaction fixtures
        "chain-secret-123", "artifact-secret-123", "mcp-secret-123", "policy-secret-123", // gitleaks:allow -- synthetic redaction fixtures
        "user:password", "/restricted/capture",
      ]) expect(combined).not.toContain(secret);
      expect(combined).toContain("[REDACTED]");
    } finally { database.close(); }
  });

  test("returns the canonical prior-run comparison with real metrics", async () => {
    const { database, url } = await application();
    try {
      database.prepare(`
        INSERT INTO runs (
          id, mission_id, journey, status, progress, started_at, ended_at, created_at, updated_at
        ) VALUES ('run-a-prior', 'mission-a', 'guided', 'completed', 1, ?, ?, ?, ?)
      `).run(A, B, A, B);
      database.prepare(`
        INSERT INTO run_evaluations (
          id, mission_id, run_id, journey, scores_json, metrics_json,
          retrospective, evidence_coverage, created_by, created_at
        ) VALUES (
          'evaluation-a-prior', 'mission-a', 'run-a-prior', 'guided',
          '{"objectiveCompletion":1,"evidenceQuality":0.5}',
          '{"durationMs":120000,"repeatedActionRate":0.5}',
          'Earlier canonical evaluation', 0.5, 'evaluator', ?
        )
      `).run(B);
      database.prepare(`
        INSERT INTO runs (
          id, mission_id, journey, status, progress, started_at, ended_at, created_at, updated_at
        ) VALUES ('run-a-current', 'mission-a', 'guided', 'completed', 1, ?, ?, ?, ?)
      `).run(B, C, B, C);
      database.prepare(`
        INSERT INTO run_evaluations (
          id, mission_id, run_id, journey, scores_json, metrics_json,
          retrospective, evidence_coverage, created_by, created_at
        ) VALUES (
          'evaluation-a-current', 'mission-a', 'run-a-current', 'guided',
          '{"objectiveCompletion":1,"evidenceQuality":0.8}',
          '{"durationMs":60000,"repeatedActionRate":0}',
          'Current canonical evaluation', 0.8, 'evaluator', ?
        )
      `).run(C);
      database.prepare(`
        INSERT INTO run_evaluation_comparisons (
          evaluation_id, run_id, comparison_status, basis, reason,
          prior_evaluation_id, prior_run_id, prior_terminal_status,
          terminal_status_match, metrics_json, summary, created_at
        ) VALUES (
          'evaluation-a-current', 'run-a-current', 'available', 'same_mission_and_journey',
          'canonical_prior_selected', 'evaluation-a-prior', 'run-a-prior', 'completed', 1,
          ?, 'Compared with one earlier same-mission guided run. This descriptive comparison does not establish that the system improved.', ?
        )
      `).run(JSON.stringify([{
        key: "durationMs", label: "Elapsed time", unit: "milliseconds",
        favorableDirection: "lower", current: 60_000, prior: 120_000,
        delta: -60_000, relativeDelta: -0.5, movement: "favorable",
      }]), C);

      const response = await body(await fetch(`${url}/api/v2/learning/evaluations?runId=run-a-current`));
      expect(response.items).toHaveLength(1);
      expect(response.items[0].comparison).toMatchObject({
        status: "available",
        basis: "same_mission_and_journey",
        prior: { evaluationId: "evaluation-a-prior", runId: "run-a-prior", terminalStatus: "completed" },
        terminalStatusMatch: true,
        metrics: [{ key: "durationMs", current: 60_000, prior: 120_000, movement: "favorable" }],
      });
      expect(response.items[0].comparison.summary).toContain("does not establish that the system improved");
    } finally { database.close(); }
  });

  test("finding verification is evidence-gated, idempotent, versioned, and audited", async () => {
    const { database, url } = await application();
    try {
      const headers = { "Content-Type": "application/json", "Idempotency-Key": "finding-review-empty-001" };
      const denied = await fetch(`${url}/api/v2/intelligence/findings/finding-a-empty/review`, {
        method: "POST", headers,
        body: JSON.stringify({ expectedVersion: 1, status: "verified", reason: "No evidence is linked", operatorOverride: false }),
      });
      expect(denied.status).toBe(409);
      expect(await body(denied)).toMatchObject({ error: { code: "operations_state_conflict" } });

      const request = {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "finding-review-ready-001" },
        body: JSON.stringify({ expectedVersion: 1, status: "verified", reason: "Reviewed immutable supporting evidence token=review-secret-123", operatorOverride: false }),
      };
      const firstResponse = await fetch(`${url}/api/v2/intelligence/findings/finding-a-ready/review`, request);
      const first = await body(firstResponse);
      expect(firstResponse.status).toBe(200);
      expect(first.finding).toMatchObject({ reviewStatus: "verified", evidenceCount: 1, version: 2 });
      expect(await body(await fetch(`${url}/api/v2/intelligence/findings/finding-a-ready/review`, request))).toEqual(first);
      const stale = await fetch(`${url}/api/v2/intelligence/findings/finding-a-ready/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "finding-review-ready-002" },
        body: JSON.stringify({ expectedVersion: 1, status: "rejected", reason: "Stale review" }),
      });
      expect(stale.status).toBe(409);
      expect(database.prepare("SELECT COUNT(*) AS count FROM audit_records WHERE resource_id = 'finding-a-ready'").get()).toEqual({ count: 1 });
      expect(JSON.stringify(database.prepare("SELECT reason, details_json FROM audit_records WHERE resource_id = 'finding-a-ready'").get())).not.toContain("review-secret-123");
    } finally { database.close(); }
  });

  test("lesson verification requires support and denies author self-approval", async () => {
    const { database, url } = await application();
    try {
      const self = await fetch(`${url}/api/v2/learning/lessons/lesson-self/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "lesson-self-review-001", "X-Test-Actor": "agent-self" },
        body: JSON.stringify({ expectedUpdatedAt: B, status: "verified", reason: "Attempt self approval" }),
      });
      expect(self.status).toBe(403);
      expect(await body(self)).toMatchObject({ error: { code: "operations_policy_denied" } });

      const noEvidence = await fetch(`${url}/api/v2/learning/lessons/lesson-empty/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "lesson-empty-review-001" },
        body: JSON.stringify({ expectedUpdatedAt: B, status: "verified", reason: "Independent review" }),
      });
      expect(noEvidence.status).toBe(409);

      const request = {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "lesson-ready-review-001" },
        body: JSON.stringify({ expectedUpdatedAt: B, status: "verified", reason: "Independent evidence review" }),
      };
      const firstResponse = await fetch(`${url}/api/v2/learning/lessons/lesson-ready/review`, request);
      const first = await body(firstResponse);
      expect(firstResponse.status).toBe(200);
      expect(first.lesson).toMatchObject({ status: "verified", supportingEvidenceCount: 1, reviewedBy: "reviewer-one" });
      expect(await body(await fetch(`${url}/api/v2/learning/lessons/lesson-ready/review`, request))).toEqual(first);
      const list = await body(await fetch(`${url}/api/v2/learning/lessons`));
      expect(list.items.map((item: any) => item.id)).not.toContain("lesson-b");
      const usage = await body(await fetch(`${url}/api/v2/learning/usage`));
      expect(usage.items.map((item: any) => item.id)).toEqual(["usage-a"]);
    } finally { database.close(); }
  });

  test("terminal completion export is scoped, metadata-only, redacted, and downloadable", async () => {
    const { database, url } = await application();
    try {
      const response = await fetch(`${url}/api/v2/reports/runs/run-a/export`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(response.headers.get("content-disposition")).toBe('attachment; filename="chillspwn-run-a-completion.json"');
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
      const exported = await body(response);
      expect(exported).toMatchObject({
        schemaVersion: "2.1",
        exportKind: "run_completion_metadata",
        mission: { id: "mission-a", journey: "guided", authorizationStatus: "unverified" },
        run: { id: "run-a", status: "completed", retryCount: 1, replanCount: 1 },
        privacy: { metadataOnly: true },
        integrity: { algorithm: "sha256" },
      });
      expect(exported.evidence.map((item: any) => item.id)).toEqual(["evidence-a-new", "evidence-a-old"]);
      expect(exported.findings.map((item: any) => item.id).sort()).toEqual(["finding-a-empty", "finding-a-ready"]);
      expect(exported.reports.map((item: any) => item.id)).toEqual(["artifact-report-a"]);
      expect(exported.actions).toMatchObject([{ id: "action-a", retryCount: 1 }]);
      expect(exported.decisions).toMatchObject([{ id: "approval-a", decisionType: "administrative", status: "approved" }]);
      expect(exported.memoryContext).toMatchObject([{ id: "context-a", purpose: "Select verified lesson" }]);
      expect(exported.integrity.digest).toMatch(/^[a-f0-9]{64}$/u);
      expect(exported.events[0]).not.toHaveProperty("payload");
      expect(exported.evidence[0]).not.toHaveProperty("extractedText");
      expect(exported.evidence[0]).not.toHaveProperty("provenance");
      expect(exported.artifacts[0]).not.toHaveProperty("metadata");
      expect(exported.artifacts[0]).not.toHaveProperty("storage");
      expect(database.prepare(`
        SELECT actor_id, action, resource_type, resource_id, record_hash
        FROM audit_records WHERE action = 'run.completion_exported'
      `).get()).toMatchObject({
        actor_id: "reviewer-one", action: "run.completion_exported",
        resource_type: "run", resource_id: "run-a", record_hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      });
      const serialized = JSON.stringify(exported);
      for (const secret of [
        "raw-secret-123", "provenance-secret-123", "event-secret-123", // gitleaks:allow -- synthetic redaction fixtures
        "artifact-secret-123", "action-secret-123", "approval-secret-123", // gitleaks:allow -- synthetic redaction fixtures
        "approval-request-secret-123", "Engagement B must remain hidden", "artifact-report-b", // gitleaks:allow -- synthetic redaction fixtures
      ]) expect(serialized).not.toContain(secret);

      expect((await fetch(`${url}/api/v2/reports/runs/run-b/export`)).status).toBe(404);
      const nonterminal = await fetch(`${url}/api/v2/reports/runs/run-b/export`, { headers: { "X-Test-Access": "all" } });
      expect(nonterminal.status).toBe(409);
      expect(await body(nonterminal)).toMatchObject({ error: { code: "operations_state_conflict" } });
    } finally { database.close(); }
  });
});
