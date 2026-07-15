import { createHash } from "node:crypto";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createDatabaseConnection, migrateDatabase, type SqliteDatabase } from "../../db";
import { MemoryRepository } from "../../memory";
import { canonicalJson } from "../../missions/canonical";
import { GuidedCommanderRepository } from "../GuidedCommanderRepository";
import { createGuidedCommanderRouter } from "../GuidedCommanderRouter";
import { GuidedCommanderService } from "../GuidedCommanderService";
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

class DeferredPlanningOnlyPort implements GuidedCommanderPort {
  readonly kind = "planning_only" as const;
  readonly supportsToolExecution = false as const;
  readonly providerId = "guided-deferred-test-provider";
  readonly model = "guided-deferred-test-model";
  readonly calls: GuidedCommanderPortInput[] = [];
  readonly started: Promise<void>;
  readonly #pending: Array<(response: GuidedCommanderPortResponse) => void> = [];
  #resolveStarted!: () => void;

  constructor() {
    this.started = new Promise<void>((resolve) => {
      this.#resolveStarted = resolve;
    });
  }

  respond(input: GuidedCommanderPortInput, signal: AbortSignal): Promise<GuidedCommanderPortResponse> {
    if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    this.calls.push(input);
    this.#resolveStarted();
    return new Promise<GuidedCommanderPortResponse>((resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
      this.#pending.push(resolve);
    });
  }

  releaseAll(): void {
    const response: GuidedCommanderPortResponse = {
      body: "The submitted output is interpreted once while the exact Guided step remains operator-controlled.",
      summary: "Interpreted one coalesced Guided result",
      confidence: 0.9,
      observations: ["Concurrent retries produced no duplicate operational state"],
      recommendedNextStep: "Review the same represented action card.",
      contextUse: [],
    };
    for (const resolve of this.#pending.splice(0)) resolve(response);
  }
}

class ExpiringOwnerPort implements GuidedCommanderPort {
  readonly kind = "planning_only" as const;
  readonly supportsToolExecution = false as const;
  readonly providerId = "guided-expired-owner-test-provider";
  readonly calls: GuidedCommanderPortInput[] = [];
  readonly firstStarted: Promise<void>;
  #resolveFirstStarted!: () => void;
  #resolveFirst?: () => void;

  constructor() {
    this.firstStarted = new Promise<void>((resolve) => { this.#resolveFirstStarted = resolve; });
  }

  respond(input: GuidedCommanderPortInput): Promise<GuidedCommanderPortResponse> {
    this.calls.push(input);
    if (this.calls.length === 1) {
      this.#resolveFirstStarted();
      return new Promise<GuidedCommanderPortResponse>((resolve) => {
        this.#resolveFirst = () => resolve(this.response(
          "Expired owner returned after its reservation was replaced.",
          input.memoryContext[0]?.id,
        ));
      });
    }
    return Promise.resolve(this.response(
      "Recovered owner completed after the expired lease.",
      input.memoryContext[0]?.id,
    ));
  }

  releaseFirst(): void {
    this.#resolveFirst?.();
  }

  private response(body: string, nodeId?: string): GuidedCommanderPortResponse {
    return {
      body,
      summary: "One durable owner committed the Guided response",
      confidence: 0.9,
      observations: ["The idempotency reservation fenced the final exchange"],
      recommendedNextStep: "Review the existing exact action card.",
      contextUse: nodeId ? [{
        nodeId,
        used: true,
        relevanceReason: "Confirmed preference applies to this Guided response",
        influenceSummary: "Kept the response concise and evidence-led",
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

  test("coalesces concurrent result interpretation before evidence, context, provider, or exchange side effects", async () => {
    const port = new DeferredPlanningOnlyPort();
    const { database, url } = await application(port);
    const key = "guided-concurrent-interpret-0001";
    const resultText = "443/tcp open https\nserver: bounded-lab";
    const request = mutation(key, actionBody({
      result: {
        source: "paste",
        mediaType: "text/plain",
        byteSize: Buffer.byteLength(resultText, "utf8"),
        text: resultText,
      },
    }));
    const counts = () => ({
      evidence: (database.prepare("SELECT COUNT(*) AS count FROM evidence").get() as { count: number }).count,
      contextPacks: (database.prepare("SELECT COUNT(*) AS count FROM memory_context_packs").get() as { count: number }).count,
      providerTurns: (database.prepare("SELECT COUNT(*) AS count FROM provider_turns").get() as { count: number }).count,
      messages: (database.prepare("SELECT COUNT(*) AS count FROM messages").get() as { count: number }).count,
    });
    try {
      const endpoint = `${url}/api/v2/guided/${IDS.mission}/commander/interpret-result`;
      const firstPending = fetch(endpoint, request);
      await port.started;
      expect(port.calls).toHaveLength(1);
      expect(counts()).toEqual({ evidence: 1, contextPacks: 1, providerTurns: 1, messages: 1 });

      const identicalPending = fetch(endpoint, request);
      const beforeConflict = counts();
      const conflictingText = "8443/tcp open https-alt";
      const conflictResponse = await fetch(endpoint, mutation(key, actionBody({
        result: {
          source: "paste",
          mediaType: "text/plain",
          byteSize: Buffer.byteLength(conflictingText, "utf8"),
          text: conflictingText,
        },
      })));
      expect(conflictResponse.status).toBe(409);
      expect(await conflictResponse.json()).toMatchObject({
        error: { code: "idempotency_key_conflict", retryable: false },
      });
      expect(port.calls).toHaveLength(1);
      expect(counts()).toEqual(beforeConflict);

      port.releaseAll();
      const [firstResponse, identicalResponse] = await Promise.all([firstPending, identicalPending]);
      expect(firstResponse.status).toBe(200);
      expect(identicalResponse.status).toBe(200);
      const [first, identical] = await Promise.all([
        responseJson(firstResponse),
        responseJson(identicalResponse),
      ]);
      expect(identical).toEqual(first);
      expect(port.calls).toHaveLength(1);
      expect(counts()).toEqual({ evidence: 1, contextPacks: 1, providerTurns: 1, messages: 3 });
      expect(database.prepare("SELECT status FROM provider_turns").get()).toEqual({ status: "completed" });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM messages WHERE role IN ('operator', 'assistant')
          AND id != ?
      `).get(IDS.initialMessage)).toEqual({ count: 2 });
    } finally {
      port.releaseAll();
      database.close();
    }
  });

  test("durably fences two Guided service instances before provider or conversation side effects", async () => {
    const directory = mkdtempSync(join(tmpdir(), "guided-commander-reservation-"));
    const filename = join(directory, "command-os.db");
    const database = createDatabaseConnection({ filename });
    migrateDatabase(database);
    seedGuidedRuntime(database);
    const secondDatabase = createDatabaseConnection({ filename });
    const port = new DeferredPlanningOnlyPort();
    const firstService = new GuidedCommanderService({
      repository: new GuidedCommanderRepository(database),
      port,
    });
    const secondService = new GuidedCommanderService({
      repository: new GuidedCommanderRepository(secondDatabase),
      port,
    });
    const request = {
      runId: IDS.run,
      stepId: IDS.step,
      expectedFingerprint: FINGERPRINT,
    };
    const key = "guided-cross-process-reservation-0001";
    const invoke = (service: GuidedCommanderService, note?: string) => service.respond({
      missionId: IDS.mission,
      action: "explain_more",
      request: { ...request, ...(note ? { note } : {}) },
      idempotencyKey: key,
      actorId: "operator-test",
      signal: new AbortController().signal,
    });
    const counts = () => ({
      contextPacks: (database.prepare("SELECT COUNT(*) AS count FROM memory_context_packs").get() as { count: number }).count,
      providerTurns: (database.prepare("SELECT COUNT(*) AS count FROM provider_turns").get() as { count: number }).count,
      messages: (database.prepare("SELECT COUNT(*) AS count FROM messages").get() as { count: number }).count,
      events: (database.prepare("SELECT COUNT(*) AS count FROM events WHERE event_type = 'guided.commander.explain_more'").get() as { count: number }).count,
    });
    try {
      const firstPending = invoke(firstService);
      await port.started;
      expect(port.calls).toHaveLength(1);
      expect(counts()).toEqual({ contextPacks: 1, providerTurns: 1, messages: 1, events: 0 });

      await expect(invoke(secondService)).rejects.toMatchObject({
        status: 409,
        code: "guided_commander_request_in_progress",
        options: { retryable: true, details: { retryAfterMs: expect.any(Number) } },
      });
      await expect(invoke(secondService, "A conflicting request")).rejects.toMatchObject({
        status: 409,
        code: "idempotency_key_conflict",
      });
      expect(port.calls).toHaveLength(1);
      expect(counts()).toEqual({ contextPacks: 1, providerTurns: 1, messages: 1, events: 0 });

      port.releaseAll();
      const first = await firstPending;
      const replay = await invoke(secondService);
      expect(replay).toEqual(first);
      expect(port.calls).toHaveLength(1);
      expect(counts()).toEqual({ contextPacks: 1, providerTurns: 1, messages: 3, events: 1 });
    } finally {
      port.releaseAll();
      secondDatabase.close();
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("a failed durable owner releases only its own reservation so the same key can retry", async () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    migrateDatabase(database);
    seedGuidedRuntime(database);
    const port = new PlanningOnlyPort();
    port.response = () => {
      if (port.calls.length === 1) throw new Error("bounded provider failure");
      return {
        body: "The retry completed under a new durable owner without executing the represented action.",
        summary: "Guided explanation completed after a safe retry",
        confidence: 0.9,
        contextUse: [],
      };
    };
    const service = new GuidedCommanderService({
      repository: new GuidedCommanderRepository(database),
      port,
    });
    const request = {
      missionId: IDS.mission,
      action: "explain_more" as const,
      request: { runId: IDS.run, stepId: IDS.step, expectedFingerprint: FINGERPRINT },
      idempotencyKey: "guided-owner-failure-release-0001",
      actorId: "operator-test",
      signal: new AbortController().signal,
    };
    try {
      await expect(service.respond(request)).rejects.toMatchObject({
        code: "guided_commander_provider_failed",
      });
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM settings
        WHERE key LIKE 'idempotency.guided-commander.%'
      `).get()).toEqual({ count: 0 });

      const completed = await service.respond(request);
      expect(completed.action).toBe("explain_more");
      expect(port.calls).toHaveLength(2);
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM settings
        WHERE key LIKE 'idempotency.guided-commander.%'
      `).get()).toEqual({ count: 1 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM messages").get()).toEqual({ count: 3 });
    } finally {
      database.close();
    }
  });

  test("an expired Guided provider reservation is taken over and the stale owner cannot duplicate completion", async () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    migrateDatabase(database);
    seedGuidedRuntime(database);
    let nowMs = Date.parse("2026-07-15T10:00:00.000Z");
    const clock = () => new Date(nowMs);
    const port = new ExpiringOwnerPort();
    const firstRepository = new GuidedCommanderRepository(database, { clock });
    const secondRepository = new GuidedCommanderRepository(database, { clock });
    const firstService = new GuidedCommanderService({
      repository: firstRepository,
      port,
      options: { providerMutationLeaseMs: 1_000 },
    });
    const secondService = new GuidedCommanderService({
      repository: secondRepository,
      port,
      options: { providerMutationLeaseMs: 1_000 },
    });
    const request = {
      missionId: IDS.mission,
      action: "show_next_step" as const,
      request: { runId: IDS.run, stepId: IDS.step, expectedFingerprint: FINGERPRINT },
      idempotencyKey: "guided-expired-reservation-0001",
      actorId: "operator-test",
      signal: new AbortController().signal,
    };
    try {
      const stalePending = firstService.respond(request);
      await port.firstStarted;
      expect(port.calls).toHaveLength(1);

      nowMs += 1_001;
      const recovered = await secondService.respond(request);
      expect(port.calls).toHaveLength(2);
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM events
        WHERE event_type = 'guided.commander.show_next_step'
      `).get()).toEqual({ count: 1 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM messages").get()).toEqual({ count: 3 });

      port.releaseFirst();
      const stale = await stalePending;
      expect(stale).toEqual(recovered);
      expect(database.prepare("SELECT COUNT(*) AS count FROM messages").get()).toEqual({ count: 3 });
      expect(database.prepare(`
        SELECT status, error_category FROM provider_turns ORDER BY rowid
      `).all()).toEqual([
        { status: "cancelled", error_category: "idempotent_replay" },
        { status: "completed", error_category: null },
      ]);
      expect(database.prepare(`
        SELECT p.message_id, i.used, i.influence_summary
        FROM memory_context_packs p
        JOIN memory_context_items i ON i.context_pack_id = p.id
        ORDER BY p.rowid
      `).all()).toEqual([
        { message_id: null, used: 0, influence_summary: null },
        { message_id: expect.any(String), used: 1, influence_summary: expect.any(String) },
      ]);

      // A stale owner cannot release a newer in-progress takeover.
      const directKey = "guided-owner-release-fence-0001";
      const directHash = "d".repeat(64);
      const oldOwner = firstRepository.reserveProviderMutation({
        scope: `explain_more:${IDS.mission}`,
        key: directKey,
        requestHash: directHash,
        actorId: "operator-test",
        leaseMs: 1_000,
      });
      expect(oldOwner.status).toBe("reserved");
      nowMs += 1_001;
      const newOwner = secondRepository.reserveProviderMutation({
        scope: `explain_more:${IDS.mission}`,
        key: directKey,
        requestHash: directHash,
        actorId: "operator-test",
        leaseMs: 1_000,
      });
      expect(newOwner.status).toBe("reserved");
      if (oldOwner.status !== "reserved" || newOwner.status !== "reserved") throw new Error("reservation fixture failed");
      expect(firstRepository.releaseProviderMutationReservation({
        scope: `explain_more:${IDS.mission}`,
        key: directKey,
        requestHash: directHash,
        ownerToken: oldOwner.ownerToken,
      })).toBe(false);
      expect(secondRepository.reserveProviderMutation({
        scope: `explain_more:${IDS.mission}`,
        key: directKey,
        requestHash: directHash,
        actorId: "operator-test",
        leaseMs: 1_000,
      })).toMatchObject({ status: "in_progress" });
      expect(secondRepository.releaseProviderMutationReservation({
        scope: `explain_more:${IDS.mission}`,
        key: directKey,
        requestHash: directHash,
        ownerToken: newOwner.ownerToken,
      })).toBe(true);
    } finally {
      port.releaseFirst();
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
