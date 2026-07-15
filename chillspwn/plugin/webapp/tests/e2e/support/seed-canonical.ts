import { createHash } from "node:crypto";
import { createDatabaseConnection, migrateDatabase } from "../../../server/db";
import { MemoryRepository } from "../../../server/memory";
import { canonicalJson, hashJson } from "../../../server/orchestration/serialization";

const CREATED = "2026-07-15T08:00:00.000Z";
const UPDATED = "2026-07-15T08:08:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function representation(input: {
  title: string;
  target: string;
  kind: "tool" | "manual";
  actionClass: string;
}): string {
  return canonicalJson({
    explanation: `This bounded fixture step explains ${input.title.toLocaleLowerCase()} before any consequential action.`,
    rationale: "The represented action is scoped, reversible, and produces a clear verification signal.",
    reversibility: "Read-only; no target state is changed.",
    dependencies: [],
    action: {
      actionType: input.kind === "manual" ? "manual_verification" : "evidence_review",
      actionClass: input.actionClass,
      target: input.target,
      arguments: input.kind === "manual" ? { procedure: "Review the supplied isolated result" } : {},
      intentSummary: input.title,
      kind: input.kind,
      idempotent: true,
      destructive: false,
    },
  });
}

/**
 * Explicit browser-test fixtures. They are written only inside the random E2E
 * state directory and are visibly named as fixtures. Production server paths
 * never call this helper.
 */
export function seedCanonicalE2eFixtures(databasePath: string): void {
  const database = createDatabaseConnection({ filename: databasePath });
  try {
    migrateDatabase(database);
    const insertMission = database.prepare(`
      INSERT INTO missions (
        id, name, objective, journey, status, authorization_status, engagement_id,
        scope_json, success_criteria_json, retention_policy_json, memory_policy_json,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'verified', 'eng-e2e', ?, ?, '{}', ?, 'e2e-fixture', ?, ?)
    `);
    insertMission.run(
      "mission-e2e-auto-complete",
      "[E2E fixture] Completed Autonomous review",
      "Validate the isolated fixture evidence and produce an evidence-linked report.",
      "autonomous",
      "completed",
      canonicalJson({ authorized: true, fixture: true }),
      canonicalJson(["Verified fixture evidence retained"]),
      canonicalJson({ allowedScopes: ["verified_lessons"] }),
      CREATED,
      UPDATED,
    );
    insertMission.run(
      "mission-e2e-safe-stop",
      "[E2E fixture] Autonomous safe stop",
      "Demonstrate a visible safe stop when work would exceed the signed fixture contract.",
      "autonomous",
      "failed",
      canonicalJson({ authorized: true, fixture: true }),
      canonicalJson(["No out-of-contract action executes"]),
      canonicalJson({ allowedScopes: [] }),
      CREATED,
      UPDATED,
    );
    insertMission.run(
      "mission-e2e-guided",
      "[E2E fixture] Guided evidence lesson",
      "Explain one bounded evidence-review step and wait for the operator's deliberate decision.",
      "guided",
      "active",
      canonicalJson({ authorized: true, fixture: true }),
      canonicalJson(["Operator deliberately records the interpreted result"]),
      canonicalJson({ guidedUse: true }),
      CREATED,
      UPDATED,
    );

    const target = database.prepare(`
      INSERT INTO mission_targets (
        id, mission_id, target, target_type, disposition, normalized_target,
        metadata_json, created_at
      ) VALUES (?, ?, 'fixture.local', 'hostname', 'allowed', 'fixture.local', '{}', ?)
    `);
    target.run("target-e2e-complete", "mission-e2e-auto-complete", CREATED);
    target.run("target-e2e-stop", "mission-e2e-safe-stop", CREATED);
    target.run("target-e2e-guided", "mission-e2e-guided", CREATED);

    database.prepare(`
      INSERT INTO agents (
        id, role, display_name, status, provider_policy_json, tool_policy_json,
        configuration_json, version, last_heartbeat_at, created_at, updated_at
      ) VALUES (
        'agent-e2e-recon', 'recon', 'Fixture Recon Specialist', 'available',
        '{}', '{}', '{"fixture":true}', 'e2e', ?, ?, ?
      )
    `).run(UPDATED, CREATED, UPDATED);

    const insertRun = database.prepare(`
      INSERT INTO runs (
        id, mission_id, journey, status, current_plan_id, current_step_id,
        current_owner_id, progress, status_reason, next_action_summary,
        budget_json, budget_usage_json, retry_count, replan_count,
        last_heartbeat_at, started_at, ended_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'agent-e2e-recon', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertRun.run(
      "run-e2e-auto-complete", "mission-e2e-auto-complete", "autonomous", "completed",
      "plan-e2e-auto-complete", "step-e2e-auto-complete", 1,
      "Completed autonomously with fixture evidence.", "Completion review available",
      canonicalJson({ wallClockMs: 900_000, retries: 2, replans: 1, toolCalls: 5 }),
      canonicalJson({ wallClockMs: 480_000, retries: 0, replans: 0, toolCalls: 1 }),
      0, 0, UPDATED, CREATED, UPDATED, CREATED, UPDATED,
    );
    insertRun.run(
      "run-e2e-safe-stop", "mission-e2e-safe-stop", "autonomous", "failed",
      "plan-e2e-safe-stop", "step-e2e-safe-stop", 0.4,
      "Safe-stopped: requested action is outside the signed contract.", "Review the contract exception",
      canonicalJson({ wallClockMs: 900_000, retries: 1, replans: 1, toolCalls: 3 }),
      canonicalJson({ wallClockMs: 160_000, retries: 0, replans: 0, toolCalls: 0 }),
      0, 0, UPDATED, CREATED, UPDATED, CREATED, UPDATED,
    );
    insertRun.run(
      "run-e2e-guided", "mission-e2e-guided", "guided", "waiting_guided_decision",
      "plan-e2e-guided", "step-e2e-guided", 0.25,
      "Waiting for the exact represented Guided decision.", "Operator chooses the bounded fixture step",
      canonicalJson({ wallClockMs: 1_800_000, retries: 2, replans: 1, toolCalls: 4 }),
      canonicalJson({ wallClockMs: 45_000, retries: 0, replans: 0, toolCalls: 0 }),
      0, 0, UPDATED, CREATED, null, CREATED, UPDATED,
    );

    const insertPlan = database.prepare(`
      INSERT INTO plans (
        id, run_id, version, status, strategy_summary, rationale_summary,
        plan_hash, created_by, created_at, activated_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?, 'e2e-fixture', ?, ?)
    `);
    insertPlan.run("plan-e2e-auto-complete", "run-e2e-auto-complete", "completed", "Review immutable evidence and report the verified outcome", "A single bounded specialist step was sufficient.", hash("plan-complete"), CREATED, CREATED);
    insertPlan.run("plan-e2e-safe-stop", "run-e2e-safe-stop", "abandoned", "Attempt only work allowed by the signed contract", "The next proposed action was out of contract and was not executed.", hash("plan-stop"), CREATED, CREATED);
    insertPlan.run("plan-e2e-guided", "run-e2e-guided", "active", "Explain, recommend, wait, interpret, and record", "The operator retains control of each consequential step.", hash("plan-guided"), CREATED, CREATED);

    const insertStep = database.prepare(`
      INSERT INTO plan_steps (
        id, plan_id, run_id, ordinal, phase, title, objective, status,
        success_criteria_json, dependencies_json, action_class, risk_class,
        assigned_agent_id, started_at, ended_at, created_at, updated_at
      ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, '[]', ?, 'low', 'agent-e2e-recon', ?, ?, ?, ?)
    `);
    insertStep.run("step-e2e-auto-complete", "plan-e2e-auto-complete", "run-e2e-auto-complete", "Verification", "Verify retained fixture evidence", "Confirm the immutable evidence hash and report linkage.", "completed", canonicalJson(["Evidence hash and report are linked"]), "analysis", CREATED, UPDATED, CREATED, UPDATED);
    insertStep.run("step-e2e-safe-stop", "plan-e2e-safe-stop", "run-e2e-safe-stop", "Contract enforcement", "Reject out-of-contract work", "Stop without executing work outside the signed contract.", "failed", canonicalJson(["No action is dispatched"]), "analysis", CREATED, UPDATED, CREATED, UPDATED);
    insertStep.run("step-e2e-guided", "plan-e2e-guided", "run-e2e-guided", "Evidence review", "Inspect the bounded fixture result", "Learn what the supplied evidence establishes before advancing.", "waiting_guided_decision", canonicalJson(["The operator can explain the result"]), "analysis", null, null, CREATED, UPDATED);

    const constraint = database.prepare(`
      INSERT INTO mission_constraints (
        id, mission_id, constraint_type, value_json, source, created_at
      ) VALUES (?, ?, 'represented_action', ?, ?, ?)
    `);
    constraint.run("constraint-e2e-complete", "mission-e2e-auto-complete", representation({ title: "Verify retained fixture evidence", target: "fixture.local", kind: "tool", actionClass: "analysis" }), "step-e2e-auto-complete", CREATED);
    constraint.run("constraint-e2e-stop", "mission-e2e-safe-stop", representation({ title: "Reject out-of-contract work", target: "fixture.local", kind: "tool", actionClass: "analysis" }), "step-e2e-safe-stop", CREATED);
    constraint.run("constraint-e2e-guided", "mission-e2e-guided", representation({ title: "Inspect the bounded fixture result", target: "fixture.local", kind: "manual", actionClass: "analysis" }), "step-e2e-guided", CREATED);

    const assignment = database.prepare(`
      INSERT INTO assignments (
        id, run_id, step_id, agent_id, status, started_at, ended_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'agent-e2e-recon', ?, ?, ?, ?, ?)
    `);
    assignment.run("assignment-e2e-complete", "run-e2e-auto-complete", "step-e2e-auto-complete", "completed", CREATED, UPDATED, CREATED, UPDATED);
    assignment.run("assignment-e2e-stop", "run-e2e-safe-stop", "step-e2e-safe-stop", "failed", CREATED, UPDATED, CREATED, UPDATED);
    assignment.run("assignment-e2e-guided", "run-e2e-guided", "step-e2e-guided", "queued", null, null, CREATED, UPDATED);

    const guidedFingerprint = hash("guided-e2e-exact-step");
    database.prepare(`
      INSERT INTO guided_decisions (
        id, mission_id, run_id, step_id, requested_action_fingerprint,
        requested_parameters_json, rationale, risk_class, reversibility,
        status, expires_at, created_at
      ) VALUES (
        'decision-e2e-guided', 'mission-e2e-guided', 'run-e2e-guided',
        'step-e2e-guided', ?, ?, 'Interpret one bounded fixture result', 'low',
        'Read-only and skippable', 'pending', '2099-01-01T00:00:00.000Z', ?
      )
    `).run(guidedFingerprint, canonicalJson({ procedure: "Review the supplied isolated result" }), CREATED);

    database.prepare(`
      INSERT INTO conversations (
        id, mission_id, run_id, step_id, conversation_type, created_at, updated_at
      ) VALUES (
        'conversation-e2e-guided', 'mission-e2e-guided', 'run-e2e-guided',
        'step-e2e-guided', 'guided', ?, ?
      )
    `).run(CREATED, UPDATED);
    database.prepare(`
      INSERT INTO messages (
        id, conversation_id, role, body, structured_content_json, created_at
      ) VALUES (
        'message-e2e-guided', 'conversation-e2e-guided', 'assistant', ?, ?, ?
      )
    `).run(
      "We are in evidence review. The goal is to establish what the bounded fixture result proves. I recommend inspecting one read-only result because it has a clear success pattern and cannot change the target. Choose whether to run, complete manually, skip, or stop.",
      canonicalJson({ kind: "guided_step", stepId: "step-e2e-guided", decisionId: "decision-e2e-guided" }),
      CREATED,
    );

    database.prepare(`
      INSERT INTO actions (
        id, mission_id, run_id, step_id, assignment_id, action_type, action_class,
        fingerprint, normalized_arguments_json, scoped_target, status,
        intent_summary, result_summary, retry_count, trace_id,
        started_at, ended_at, created_at, updated_at
      ) VALUES (
        'action-e2e-complete', 'mission-e2e-auto-complete', 'run-e2e-auto-complete',
        'step-e2e-auto-complete', 'assignment-e2e-complete', 'evidence_review',
        'analysis', ?, '{}', 'fixture.local', 'succeeded',
        'Verify retained fixture evidence', 'One unique verified evidence record retained',
        0, 'trace-e2e-complete', ?, ?, ?, ?
      )
    `).run(HASH_A, CREATED, UPDATED, CREATED, UPDATED);

    database.prepare(`
      INSERT INTO evidence (
        id, mission_id, run_id, step_id, action_id, source, acquired_at, target,
        evidence_type, content_hash, provenance_json, confidence, sensitivity,
        verification_state, summary, created_by, created_at
      ) VALUES (
        'evidence-e2e-complete', 'mission-e2e-auto-complete', 'run-e2e-auto-complete',
        'step-e2e-auto-complete', 'action-e2e-complete', 'fixture:safe', ?,
        'fixture.local', 'verification', ?, '{"fixture":true}', 1, 'internal',
        'verified', 'Fixture evidence hash verified', 'agent-e2e-recon', ?
      )
    `).run(UPDATED, HASH_B, UPDATED);
    database.prepare(`
      INSERT INTO findings (
        id, mission_id, run_id, title, severity, confidence, affected_scope,
        description, impact, remediation, review_status, created_at, updated_at
      ) VALUES (
        'finding-e2e-complete', 'mission-e2e-auto-complete', 'run-e2e-auto-complete',
        'Fixture evidence chain is complete', 'informational', 1, 'fixture.local',
        'The bounded verification evidence is linked and immutable.',
        'The completion claim can be independently reviewed.', 'No remediation required.',
        'verified', ?, ?
      )
    `).run(CREATED, UPDATED);
    database.prepare(`
      INSERT INTO finding_evidence (finding_id, evidence_id, relationship, added_at)
      VALUES ('finding-e2e-complete', 'evidence-e2e-complete', 'supports', ?)
    `).run(UPDATED);
    database.prepare(`
      INSERT INTO artifacts (
        id, mission_id, run_id, action_id, journey, artifact_type, storage_uri,
        content_hash, byte_size, media_type, sensitivity, metadata_json, created_at
      ) VALUES (
        'report-e2e-complete', 'mission-e2e-auto-complete', 'run-e2e-auto-complete',
        'action-e2e-complete', 'autonomous', 'mission_report', 'artifact://e2e/report',
        ?, 256, 'application/json', 'internal', '{"fixture":true}', ?
      )
    `).run(HASH_A, UPDATED);

    database.prepare(`
      INSERT INTO run_evaluations (
        id, mission_id, run_id, journey, scores_json, metrics_json,
        retrospective, evidence_coverage, created_by, created_at
      ) VALUES (
        'evaluation-e2e-complete', 'mission-e2e-auto-complete',
        'run-e2e-auto-complete', 'autonomous', ?, ?,
        'The fixture run met its single evidence-backed success criterion without retries.',
        1, 'e2e-evaluator', ?
      )
    `).run(
      canonicalJson({ objectiveCompletion: 1, policyCompliance: 1, evidenceQuality: 1 }),
      canonicalJson({ duplicateActionRate: 0, retryRate: 0, journeyAdherence: 1 }),
      UPDATED,
    );
    database.prepare(`
      INSERT INTO run_evaluation_comparisons (
        evaluation_id, run_id, comparison_status, reason, metrics_json, summary, created_at
      ) VALUES (
        'evaluation-e2e-complete', 'run-e2e-auto-complete', 'insufficient_data',
        'no_prior_same_scope_evaluation', '[]',
        'No prior fixture run exists in the same scope and journey.', ?
      )
    `).run(UPDATED);

    const insertEvent = database.prepare(`
      INSERT INTO events (
        id, mission_id, run_id, sequence, event_type, occurred_at, actor_type,
        actor_id, summary, payload_json, schema_version, journey, context_pack_id,
        sensitivity, redaction_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'internal', '{}', ?)
    `);
    insertEvent.run("event-e2e-complete", "mission-e2e-auto-complete", "run-e2e-auto-complete", 1, "run.completed", UPDATED, "system", "run-supervisor", "Completed autonomously with verified fixture evidence", canonicalJson({ evidenceDelta: 1, next: "Completion review" }), "autonomous", "context-e2e-complete", UPDATED);
    insertEvent.run("event-e2e-safe-stop", "mission-e2e-safe-stop", "run-e2e-safe-stop", 1, "run.safe_stopped", UPDATED, "system", "run-supervisor", "Safe-stopped: outside the signed fixture contract", canonicalJson({ outsideContract: true, actionDispatched: false }), "autonomous", null, UPDATED);
    insertEvent.run("event-e2e-guided", "mission-e2e-guided", "run-e2e-guided", 1, "guided.decision_requested", UPDATED, "agent", "guided-commander", "Guided Commander explained one bounded step and is waiting for the operator", canonicalJson({ decisionId: "decision-e2e-guided" }), "guided", null, UPDATED);

    const stoppedState = {
      schemaVersion: 1,
      run: {
        id: "run-e2e-safe-stop", missionId: "mission-e2e-safe-stop", journey: "autonomous",
        state: "failed", stateVersion: 1,
        reason: "Safe-stopped: requested action is outside the signed contract.",
        leaseOwner: null, leaseExpiresAt: null,
      },
      control: {
        budget: { limits: { wallClockMs: 900_000, retries: 1, replans: 1, toolCalls: 3 }, usage: { wallClockMs: 160_000, retries: 0, replans: 0, toolCalls: 0 } },
        retryCount: 0, replanCount: 0, circuits: {}, progress: {},
      },
      completedActionIds: [], inFlightActions: [], lastEventSequence: 1,
    };
    database.prepare(`
      INSERT INTO checkpoints (
        id, mission_id, run_id, journey, event_sequence, plan_version,
        state_json, state_hash, in_flight_classification, created_at
      ) VALUES (
        'checkpoint-e2e-safe-stop', 'mission-e2e-safe-stop', 'run-e2e-safe-stop',
        'autonomous', 1, 1, ?, ?, 'safe_no_in_flight_action', ?
      )
    `).run(canonicalJson(stoppedState), hashJson(stoppedState), UPDATED);

    const memory = new MemoryRepository(database, {
      clock: () => new Date(UPDATED),
      createId: (prefix) => `${prefix}_e2e_${Math.random().toString(16).slice(2)}`,
    });
    const provenance = (sourceId: string) => ({
      method: "derived" as const,
      explanation: "Generated from an explicit, isolated browser acceptance fixture.",
      sources: [{ sourceType: "e2e_fixture", sourceId, acquiredAt: UPDATED, sourceHash: hash(sourceId) }],
    });
    const nodes = [
      memory.createNode({ id: "mem-e2e-operator", nodeType: "operator", title: "Fixture operator", summary: "Operator root for browser acceptance", scope: { kind: "global" }, sensitivity: "private", confidence: 1, lifecycleStatus: "confirmed", confirmationState: "confirmed", provenance: provenance("operator"), authorType: "operator", authorId: "e2e-operator" }),
      memory.createNode({ id: "mem-e2e-preference", nodeType: "preference", title: "Explain before acting", summary: "Use concise explanations before each Guided step", body: "Explain purpose, risk, expected evidence, and verification before presenting a bounded action.", scope: { kind: "global" }, sensitivity: "private", confidence: 1, lifecycleStatus: "confirmed", confirmationState: "confirmed", provenance: provenance("preference"), authorType: "operator", authorId: "e2e-operator", pinned: true }),
      memory.createNode({ id: "mem-e2e-mission", nodeType: "mission", title: "Completed Autonomous fixture mission", summary: "Evidence-backed fixture mission cluster", scope: { kind: "mission", engagementId: "eng-e2e", missionId: "mission-e2e-auto-complete" }, sensitivity: "internal", confidence: 1, lifecycleStatus: "verified", confirmationState: "not_required", provenance: provenance("mission"), authorType: "system" }),
      memory.createNode({ id: "mem-e2e-technique", nodeType: "technique", title: "Immutable evidence verification", summary: "Validate hashes and provenance before a completion claim", scope: { kind: "global" }, sensitivity: "internal", confidence: 0.95, lifecycleStatus: "verified", confirmationState: "not_required", provenance: provenance("technique"), authorType: "agent", authorId: "agent-e2e-recon" }),
      memory.createNode({ id: "mem-e2e-evidence", nodeType: "evidence", title: "Verified fixture evidence", summary: "Immutable evidence linked to the completed run", scope: { kind: "mission", engagementId: "eng-e2e", missionId: "mission-e2e-auto-complete" }, sensitivity: "internal", confidence: 1, lifecycleStatus: "verified", confirmationState: "not_required", provenance: provenance("evidence"), authorType: "system" }),
      memory.createNode({ id: "mem-e2e-failure", nodeType: "failure", title: "Out-of-contract action rejected", summary: "The Autonomous fixture did not expand its signed scope", scope: { kind: "mission", engagementId: "eng-e2e", missionId: "mission-e2e-safe-stop" }, sensitivity: "internal", confidence: 1, lifecycleStatus: "verified", confirmationState: "not_required", provenance: provenance("failure"), authorType: "system" }),
      memory.createNode({ id: "mem-e2e-recovery", nodeType: "recovery", title: "Contract safe stop", summary: "Stop safely and explain the blocked boundary", scope: { kind: "mission", engagementId: "eng-e2e", missionId: "mission-e2e-safe-stop" }, sensitivity: "internal", confidence: 1, lifecycleStatus: "verified", confirmationState: "not_required", provenance: provenance("recovery"), authorType: "system" }),
      memory.createNode({ id: "mem-e2e-lesson", nodeType: "lesson", title: "Verify before declaring completion", summary: "Evidence coverage must support the stated criterion", scope: { kind: "global" }, sensitivity: "internal", confidence: 0.98, lifecycleStatus: "verified", confirmationState: "not_required", provenance: provenance("lesson"), authorType: "agent", authorId: "e2e-evaluator" }),
    ];
    const edge = (id: string, sourceNodeId: string, targetNodeId: string, edgeType: "prefers" | "belongs_to" | "supports" | "recovered_by" | "learned_from") => memory.createEdge({ id, sourceNodeId, targetNodeId, edgeType, title: edgeType.replaceAll("_", " "), summary: "Fixture relationship with explicit provenance", scope: { kind: "global" }, sensitivity: "internal", confidence: 1, lifecycleStatus: "verified", provenance: provenance(id), explanation: "This relationship is asserted only by the isolated acceptance fixture.", authorType: "system" });
    edge("edge-e2e-preference", nodes[0]!.id, nodes[1]!.id, "prefers");
    edge("edge-e2e-mission", nodes[2]!.id, nodes[3]!.id, "belongs_to");
    edge("edge-e2e-evidence", nodes[4]!.id, nodes[2]!.id, "supports");
    edge("edge-e2e-recovery", nodes[5]!.id, nodes[6]!.id, "recovered_by");
    edge("edge-e2e-lesson", nodes[7]!.id, nodes[2]!.id, "learned_from");

    database.prepare(`
      INSERT INTO memory_context_packs (
        id, mission_id, run_id, action_id, journey, purpose, query_redacted,
        scope_policy_json, context_budget, retrieval_metrics_json, created_by, created_at
      ) VALUES (
        'context-e2e-complete', 'mission-e2e-auto-complete', 'run-e2e-auto-complete',
        'action-e2e-complete', 'autonomous', 'Verify fixture evidence using a permitted lesson',
        '[fixture query redacted]', '{"engagementIsolation":true}', 512,
        '{"fixture":true}', 'e2e-planner', ?
      )
    `).run(UPDATED);
    const contextItem = database.prepare(`
      INSERT INTO memory_context_items (
        context_pack_id, node_id, rank, retrieval_score, used,
        relevance_reason, influence_summary, corrected
      ) VALUES ('context-e2e-complete', ?, ?, ?, 1, ?, ?, 0)
    `);
    contextItem.run("mem-e2e-preference", 0, 1, "The confirmed explanation preference applies globally.", "The Guided explanation was structured before the action.");
    contextItem.run("mem-e2e-lesson", 1, 0.95, "The verified lesson matches the evidence-verification phase.", "The completion gate required evidence coverage.");
    database.prepare("UPDATE actions SET context_pack_id = 'context-e2e-complete' WHERE id = 'action-e2e-complete'").run();

    database.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    database.close();
  }
}
