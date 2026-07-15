import { createHash } from "node:crypto";
import { afterEach, describe, expect, test } from "bun:test";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createDatabaseConnection, migrateDatabase, type SqliteDatabase } from "../../db";
import { MemoryRepository } from "../../memory";
import { canonicalJson } from "../../missions/canonical";
import { createGuidedCommanderRouter } from "../GuidedCommanderRouter";
import type {
  GuidedCommanderPort,
  GuidedCommanderPortInput,
  GuidedCommanderPortResponse,
} from "../types";

const servers: Server[] = [];
const FINGERPRINT = "a".repeat(64);
const IDS = {
  mission: "mission-guided-commander",
  run: "run-guided-commander",
  plan: "plan-guided-commander",
  step: "step-guided-commander",
  assignment: "assignment-guided-commander",
  decision: "decision-guided-commander",
  agent: "agent-guided-commander",
  conversation: "conversation-guided-commander",
  initialMessage: "message-guided-initial",
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

class PlanningOnlyPort implements GuidedCommanderPort {
  readonly kind = "planning_only" as const;
  readonly supportsToolExecution = false as const;
  readonly providerId = "guided-test-provider";
  readonly model = "guided-test-model";
  readonly calls: GuidedCommanderPortInput[] = [];
  response?: (input: GuidedCommanderPortInput) => GuidedCommanderPortResponse;

  async respond(input: GuidedCommanderPortInput, signal: AbortSignal): Promise<GuidedCommanderPortResponse> {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    this.calls.push(input);
    if (this.response) return this.response(input);
    const remembered = input.memoryContext[0];
    return {
      body: input.action === "interpret_result"
        ? "The submitted output adds evidence for the current step, but the operator must still decide what to run next."
        : "This step gathers bounded evidence for the current objective. No command was executed and the represented action is unchanged.",
      summary: "Explained the current represented Guided step",
      confidence: 0.86,
      observations: ["The mission remains paused at the exact represented step"],
      recommendedNextStep: "Review the existing action card and choose one deliberate control.",
      contextUse: remembered ? [{
        nodeId: remembered.id,
        used: true,
        relevanceReason: "Confirmed preference applies to Guided explanations",
        influenceSummary: "Kept the explanation concise and evidence-led",
      }] : [],
    };
  }
}

function seedGuidedRuntime(database: SqliteDatabase): void {
  const now = "2026-07-15T10:00:00.000Z";
  database.prepare(`
    INSERT INTO missions (
      id, name, objective, journey, status, authorization_status, engagement_id,
      scope_json, created_by, created_at, updated_at
    ) VALUES (?, 'Guided Commander mission', 'Validate lab evidence carefully', 'guided',
      'active', 'verified', 'eng-guided', ?, 'operator-test', ?, ?)
  `).run(IDS.mission, canonicalJson({ target: "lab.internal" }), now, now);
  database.prepare(`
    INSERT INTO agents (
      id, role, display_name, status, version, created_at, updated_at
    ) VALUES (?, 'recon', 'Recon Specialist', 'available', '1', ?, ?)
  `).run(IDS.agent, now, now);
  database.prepare(`
    INSERT INTO runs (
      id, mission_id, journey, status, current_plan_id, current_step_id,
      current_owner_id, progress, status_reason, next_action_summary,
      created_at, updated_at
    ) VALUES (?, ?, 'guided', 'waiting_guided_decision', ?, ?, ?, 0,
      'Waiting for one exact operator decision', 'Review the represented step', ?, ?)
  `).run(IDS.run, IDS.mission, IDS.plan, IDS.step, IDS.agent, now, now);
  database.prepare(`
    INSERT INTO plans (
      id, run_id, version, status, strategy_summary, rationale_summary,
      plan_hash, created_by, created_at, activated_at
    ) VALUES (?, ?, 1, 'active', 'Gather evidence in bounded steps',
      'Avoid unrepresented work', ?, 'runtime-planner', ?, ?)
  `).run(IDS.plan, IDS.run, "b".repeat(64), now, now);
  database.prepare(`
    INSERT INTO plan_steps (
      id, plan_id, run_id, ordinal, phase, title, objective, status,
      success_criteria_json, dependencies_json, action_class, risk_class,
      assigned_agent_id, created_at, updated_at
    ) VALUES (?, ?, ?, 0, 'Reconnaissance', 'Inspect the approved service',
      'Determine the exposed service without changing it', 'waiting_guided_decision',
      ?, '[]', 'reconnaissance', 'low', ?, ?, ?)
  `).run(
    IDS.step,
    IDS.plan,
    IDS.run,
    canonicalJson(["A service banner is retained as evidence"]),
    IDS.agent,
    now,
    now,
  );
  database.prepare(`
    INSERT INTO assignments (
      id, run_id, step_id, agent_id, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'queued', ?, ?)
  `).run(IDS.assignment, IDS.run, IDS.step, IDS.agent, now, now);
  database.prepare(`
    INSERT INTO mission_constraints (
      id, mission_id, constraint_type, value_json, source, created_at
    ) VALUES ('constraint-guided-representation', ?, 'represented_action', ?, ?, ?)
  `).run(
    IDS.mission,
    canonicalJson({
      action: {
        actionType: "service_banner",
        actionClass: "reconnaissance",
        target: "lab.internal",
        arguments: { target: "lab.internal", ports: [443] },
        intentSummary: "Inspect the approved service banner",
        kind: "tool",
        idempotent: true,
        destructive: false,
      },
      explanation: "Inspect one approved service without expanding scope.",
      rationale: "A banner can identify the next evidence-led branch.",
      reversibility: "Read-only and reversible.",
      dependencies: [],
    }),
    IDS.step,
    now,
  );
  database.prepare(`
    INSERT INTO guided_decisions (
      id, mission_id, run_id, step_id, requested_action_fingerprint,
      requested_parameters_json, rationale, risk_class, reversibility,
      status, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'Inspect the approved service', 'low',
      'Read-only', 'pending', '2026-07-16T10:00:00.000Z', ?)
  `).run(
    IDS.decision,
    IDS.mission,
    IDS.run,
    IDS.step,
    FINGERPRINT,
    canonicalJson({ target: "lab.internal", ports: [443] }),
    now,
  );
  database.prepare(`
    INSERT INTO conversations (
      id, mission_id, run_id, step_id, conversation_type, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'guided', ?, ?)
  `).run(IDS.conversation, IDS.mission, IDS.run, IDS.step, now, now);
  database.prepare(`
    INSERT INTO messages (
      id, conversation_id, role, body, structured_content_json, created_at
    ) VALUES (?, ?, 'assistant', 'Review the first represented Guided step.', ?, ?)
  `).run(
    IDS.initialMessage,
    IDS.conversation,
    canonicalJson({ kind: "guided_step", stepId: IDS.step, actionFingerprint: FINGERPRINT }),
    now,
  );
  new MemoryRepository(database).createNode({
    id: "memory-guided-explanation",
    nodeType: "preference",
    title: "Validate lab evidence with concise explanations",
    summary: "Use concise evidence-led explanations in Guided missions",
    body: "Explain why the evidence matters before presenting the deliberate next step.",
    scope: { kind: "global" },
    sensitivity: "private",
    confidence: 1,
    lifecycleStatus: "confirmed",
    confirmationState: "confirmed",
    provenance: {
      method: "operator_statement",
      explanation: "Confirmed by the operator",
      sources: [{
        sourceType: "message",
        sourceId: "preference-source",
        acquiredAt: now,
      }],
    },
    authorType: "operator",
    authorId: "operator-test",
    retentionPolicy: { allowGuided: true },
  });
}

async function application(port = new PlanningOnlyPort()) {
  const database = createDatabaseConnection({ filename: ":memory:" });
  migrateDatabase(database);
  seedGuidedRuntime(database);
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.use(createGuidedCommanderRouter({
    database,
    port,
    resolveActor: () => "operator-test",
  }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  return {
    database,
    port,
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
}

function actionBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId: IDS.run,
    stepId: IDS.step,
    expectedFingerprint: FINGERPRINT,
    ...extra,
  };
}

function mutation(key: string, body: unknown): RequestInit {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify(body),
  };
}

async function responseJson(response: Response): Promise<Record<string, any>> {
  return response.json() as Promise<Record<string, any>>;
}

describe("Guided Commander durable HTTP boundary", () => {
  test("explains the exact represented step, persists context use, and replays idempotently", async () => {
    const { database, port, url } = await application();
    try {
      const request = mutation("guided-explain-0001", actionBody());
      const firstResponse = await fetch(
        `${url}/api/v2/guided/${IDS.mission}/commander/explain-more`,
        request,
      );
      expect(firstResponse.status).toBe(200);
      const first = await responseJson(firstResponse);
      expect(first.result).toMatchObject({
        action: "explain_more",
        actionFingerprint: FINGERPRINT,
        assistantMessage: {
          structuredContent: {
            executionPerformed: false,
            planMutated: false,
            nextConsequentialActionRequiresDecision: true,
          },
        },
      });
      expect(port.calls).toHaveLength(1);
      expect(port.calls[0]).toMatchObject({
        action: "explain_more",
        constraints: { executeTools: false, mutatePlan: false },
        step: { id: IDS.step, actionFingerprint: FINGERPRINT },
      });
      expect(port.calls[0]!.memoryContext[0]).toMatchObject({ id: "memory-guided-explanation" });
      expect(port.calls[0]!.presentationPreferences).toEqual([expect.objectContaining({
        nodeId: "memory-guided-explanation",
        directive: expect.stringContaining("concise evidence-led explanations"),
        confidence: 1,
      })]);

      const replay = await responseJson(await fetch(
        `${url}/api/v2/guided/${IDS.mission}/commander/explain-more`,
        request,
      ));
      expect(replay).toEqual(first);
      expect(port.calls).toHaveLength(1);
      expect(database.prepare("SELECT COUNT(*) AS count FROM messages").get()).toEqual({ count: 3 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM actions").get()).toEqual({ count: 0 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM tool_calls").get()).toEqual({ count: 0 });
      expect(database.prepare(`
        SELECT used, influence_summary FROM memory_context_items
        WHERE context_pack_id = ? AND node_id = 'memory-guided-explanation'
      `).get(first.result.contextPackId)).toMatchObject({ used: 1, influence_summary: expect.any(String) });

      const transcript = await responseJson(await fetch(
        `${url}/api/v2/guided/${IDS.mission}/commander/transcript?runId=${IDS.run}`,
      ));
      expect(transcript.currentStep).toMatchObject({ id: IDS.step, actionFingerprint: FINGERPRINT });
      expect(transcript.items).toHaveLength(3);
      expect(transcript.items.map((item: { role: string }) => item.role)).toEqual([
        "assistant",
        "operator",
        "assistant",
      ]);
    } finally {
      database.close();
    }
  });

  test("rejects a stale fingerprint before calling the planning provider", async () => {
    const { database, port, url } = await application();
    try {
      const response = await fetch(
        `${url}/api/v2/guided/${IDS.mission}/commander/show-next-step`,
        mutation("guided-stale-0001", actionBody({ expectedFingerprint: "c".repeat(64) })),
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "guided_action_changed" } });
      expect(port.calls).toHaveLength(0);
      expect(database.prepare("SELECT COUNT(*) AS count FROM actions").get()).toEqual({ count: 0 });
      expect(database.prepare("SELECT status FROM guided_decisions WHERE id = ?").get(IDS.decision))
        .toEqual({ status: "pending" });
    } finally {
      database.close();
    }
  });

  test("requires mutation idempotency and enforces the bounded text-only ingestion contract", async () => {
    const { database, port, url } = await application();
    try {
      const missingKey = await fetch(
        `${url}/api/v2/guided/${IDS.mission}/commander/explain-more`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(actionBody()),
        },
      );
      expect(missingKey.status).toBe(400);
      expect(await missingKey.json()).toMatchObject({ error: { code: "idempotency_key_required" } });

      const oversized = "x".repeat(128 * 1024 + 1);
      const tooLarge = await fetch(
        `${url}/api/v2/guided/${IDS.mission}/commander/interpret-result`,
        mutation("guided-oversized-0001", actionBody({
          result: { source: "paste", mediaType: "text/plain", text: oversized },
        })),
      );
      expect(tooLarge.status).toBe(413);
      expect(await tooLarge.json()).toMatchObject({ error: { code: "guided_result_too_large" } });
      expect(port.calls).toHaveLength(0);
      expect(database.prepare("SELECT COUNT(*) AS count FROM evidence").get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  test("content-addresses and redacts a bounded text result without retaining authentication material", async () => {
    const { database, port, url } = await application();
    try {
      const raw = [
        "443/tcp open https",
        "Authorization: Bearer very-secret-bearer-value-12345",
        "password=hunter2",
      ].join("\n");
      const request = mutation("guided-interpret-0001", actionBody({
        result: {
          source: "paste",
          mediaType: "text/plain",
          byteSize: Buffer.byteLength(raw, "utf8"),
          text: raw,
        },
      }));
      const firstResponse = await fetch(
        `${url}/api/v2/guided/${IDS.mission}/commander/interpret-result`,
        request,
      );
      expect(firstResponse.status).toBe(200);
      const first = await responseJson(firstResponse);
      const evidenceId = String(first.result.evidenceId);
      expect(first).toMatchObject({
        ingestion: { multipartSupported: false, rawContentRetained: false },
        result: { actionFingerprint: FINGERPRINT },
      });
      expect(evidenceId).toStartWith("evidence_");
      expect(port.calls).toHaveLength(1);
      const providerPayload = JSON.stringify(port.calls[0]);
      expect(providerPayload).not.toContain("very-secret-bearer-value-12345");
      expect(providerPayload).not.toContain("hunter2");
      expect(providerPayload).toContain("REDACTED AUTHENTICATION MATERIAL");

      const evidence = database.prepare(`
        SELECT content_hash, provenance_json, extracted_text FROM evidence WHERE id = ?
      `).get(evidenceId) as {
        content_hash: string;
        provenance_json: string;
        extracted_text: string;
      };
      expect(evidence.content_hash).toBe(createHash("sha256").update(raw).digest("hex"));
      expect(evidence.extracted_text).not.toContain("hunter2");
      expect(evidence.extracted_text).not.toContain("very-secret");
      expect(JSON.parse(evidence.provenance_json)).toMatchObject({
        rawContentRetained: false,
        redactionCount: 2,
      });
      const serializedPersistence = [
        ...database.prepare("SELECT body AS value FROM messages").all() as Array<{ value: string }>,
        ...database.prepare("SELECT structured_content_json AS value FROM messages").all() as Array<{ value: string }>,
        ...database.prepare("SELECT value_json AS value FROM settings").all() as Array<{ value: string }>,
        ...database.prepare("SELECT payload_json AS value FROM events").all() as Array<{ value: string }>,
      ].map((row) => row.value).join("\n");
      expect(serializedPersistence).not.toContain("hunter2");
      expect(serializedPersistence).not.toContain("very-secret-bearer-value-12345");

      const replay = await responseJson(await fetch(
        `${url}/api/v2/guided/${IDS.mission}/commander/interpret-result`,
        request,
      ));
      expect(replay).toEqual(first);
      expect(port.calls).toHaveLength(1);
      expect(database.prepare("SELECT COUNT(*) AS count FROM evidence").get()).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });

  test("creates only a reviewable memory candidate and supports do-not-relearn suppression", async () => {
    const { database, url } = await application();
    try {
      const rememberRequest = mutation("guided-remember-0001", actionBody({
        sourceMessageId: IDS.initialMessage,
        nodeType: "preference",
        title: "Prefer concise evidence explanations",
        summary: "Keep Guided explanations concise and evidence-led",
        content: "Explain why the evidence matters before the next represented action.",
        scope: "global",
        sensitivity: "private",
      }));
      const rememberedResponse = await fetch(
        `${url}/api/v2/guided/${IDS.mission}/commander/remember`,
        rememberRequest,
      );
      expect(rememberedResponse.status).toBe(201);
      const remembered = await responseJson(rememberedResponse);
      expect(remembered.result).toMatchObject({ status: "pending", sourceMessageId: IDS.initialMessage });
      expect(database.prepare(`
        SELECT status, proposed_scope FROM memory_candidates WHERE id = ?
      `).get(remembered.result.candidateId)).toEqual({ status: "pending", proposed_scope: "global" });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM memory_nodes WHERE title = 'Prefer concise evidence explanations'
      `).get()).toEqual({ count: 0 });
      const rememberReplay = await responseJson(await fetch(
        `${url}/api/v2/guided/${IDS.mission}/commander/remember`,
        rememberRequest,
      ));
      expect(rememberReplay).toEqual(remembered);
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM memory_candidates WHERE title = 'Prefer concise evidence explanations'
      `).get()).toEqual({ count: 1 });
      const memoryAudit = database.prepare(`
        SELECT id, mission_id, run_id, journey, actor_id, action, resource_type,
          resource_id, reason, details_json, previous_hash, record_hash, occurred_at
        FROM audit_records WHERE action = 'memory.candidate_created'
      `).get() as Record<string, string | null>;
      expect(memoryAudit).toMatchObject({
        mission_id: IDS.mission,
        run_id: IDS.run,
        journey: "guided",
      });
      const expectedAuditHash = createHash("sha256").update(canonicalJson({
        id: memoryAudit.id,
        previousHash: memoryAudit.previous_hash,
        missionId: memoryAudit.mission_id,
        runId: memoryAudit.run_id,
        journey: memoryAudit.journey,
        actorId: memoryAudit.actor_id,
        action: memoryAudit.action,
        resourceType: memoryAudit.resource_type,
        resourceId: memoryAudit.resource_id,
        reason: memoryAudit.reason,
        details: JSON.parse(memoryAudit.details_json!),
        occurredAt: memoryAudit.occurred_at,
      }), "utf8").digest("hex");
      expect(memoryAudit.record_hash).toBe(expectedAuditHash);

      const suppressedResponse = await fetch(
        `${url}/api/v2/guided/${IDS.mission}/commander/do-not-remember`,
        mutation("guided-suppress-0001", actionBody({
          candidateId: remembered.result.candidateId,
          reason: "Do not retain this collaboration preference",
        })),
      );
      expect(suppressedResponse.status).toBe(200);
      const suppressed = await responseJson(suppressedResponse);
      expect(suppressed.result).toMatchObject({
        candidateId: remembered.result.candidateId,
        status: "suppressed",
        suppressionId: expect.any(String),
      });
      expect(database.prepare("SELECT status FROM memory_candidates WHERE id = ?")
        .get(remembered.result.candidateId)).toEqual({ status: "suppressed" });

      const sensitive = await fetch(
        `${url}/api/v2/guided/${IDS.mission}/commander/remember`,
        mutation("guided-remember-secret-0001", actionBody({
          sourceMessageId: IDS.initialMessage,
          nodeType: "preference",
          title: "Unsafe candidate",
          summary: "api_key=do-not-store-this-value",
          scope: "global",
          sensitivity: "private",
        })),
      );
      expect(sensitive.status).toBe(422);
      expect(await sensitive.json()).toMatchObject({ error: { code: "sensitive_material_not_retained" } });
    } finally {
      database.close();
    }
  });

  test("an alternative request stays conversational and cannot mutate the plan or decision", async () => {
    const port = new PlanningOnlyPort();
    port.response = () => ({
      body: "A different in-scope strategy can be proposed, but it requires a versioned plan update before any action.",
      summary: "Compared an alternative without applying it",
      confidence: 0.72,
      recommendedNextStep: "Review whether to request a versioned plan change.",
      contextUse: [],
    });
    const { database, url } = await application(port);
    try {
      const response = await fetch(
        `${url}/api/v2/guided/${IDS.mission}/commander/use-another-approach`,
        mutation("guided-alternative-0001", actionBody({ note: "Prefer a passive validation path" })),
      );
      expect(response.status).toBe(200);
      const body = await responseJson(response);
      expect(body.result.assistantMessage.structuredContent).toMatchObject({
        action: "use_another_approach",
        executionPerformed: false,
        planMutated: false,
      });
      expect(database.prepare("SELECT status FROM runs WHERE id = ?").get(IDS.run))
        .toEqual({ status: "waiting_guided_decision" });
      expect(database.prepare("SELECT status FROM plans WHERE id = ?").get(IDS.plan))
        .toEqual({ status: "active" });
      expect(database.prepare("SELECT status FROM guided_decisions WHERE id = ?").get(IDS.decision))
        .toEqual({ status: "pending" });
      expect(database.prepare("SELECT COUNT(*) AS count FROM actions").get()).toEqual({ count: 0 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM tool_calls").get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });
});
