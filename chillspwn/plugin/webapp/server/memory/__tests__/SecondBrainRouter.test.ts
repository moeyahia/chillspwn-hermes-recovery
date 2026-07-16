import { afterEach, describe, expect, test } from "bun:test";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDatabaseConnection, migrateDatabase } from "../../db/index";
import { MemoryRepository } from "../MemoryRepository";
import { createSecondBrainRouter, type MemoryAccessPolicy } from "../SecondBrainRouter";
import type { MemoryProvenance, MemoryScope } from "../types";

const servers: Server[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

function provenance(id: string): MemoryProvenance {
  return {
    method: "operator_statement",
    explanation: "Confirmed by the authorized operator",
    sources: [{
      sourceType: "message",
      sourceId: id,
      acquiredAt: "2026-07-15T10:00:00.000Z",
    }],
  };
}

function insertMission(
  database: ReturnType<typeof createDatabaseConnection>,
  id: string,
  engagementId: string,
  journey: "autonomous" | "guided" = "guided",
): void {
  const now = "2026-07-15T10:00:00.000Z";
  database.prepare(`
    INSERT INTO missions (
      id, name, objective, journey, engagement_id, created_by, created_at, updated_at
    ) VALUES (?, ?, 'Authorized scope', ?, ?, 'operator', ?, ?)
  `).run(id, id, journey, engagementId, now, now);
}

function node(
  repository: MemoryRepository,
  id: string,
  scope: MemoryScope,
  title: string,
) {
  return repository.createNode({
    id,
    nodeType: "technique",
    title,
    summary: `Evidence-backed memory for ${title}`,
    body: `Procedure details for ${title}`,
    scope,
    sensitivity: "private",
    confidence: 0.9,
    lifecycleStatus: "confirmed",
    confirmationState: "confirmed",
    provenance: provenance(`source-${id}`),
    authorType: "operator",
    authorId: "operator-route-test",
  });
}

async function application() {
  const directory = mkdtempSync(join(tmpdir(), "brain-router-test-"));
  directories.push(directory);
  const database = createDatabaseConnection({ filename: join(directory, "brain.sqlite") });
  migrateDatabase(database);
  insertMission(database, "mission-a", "eng-a");
  insertMission(database, "mission-b", "eng-b", "autonomous");
  const repository = new MemoryRepository(database);
  node(repository, "node-global", { kind: "global" }, "Global evidence method");
  node(repository, "node-a", { kind: "engagement", engagementId: "eng-a" }, "Engagement A credential path");
  node(repository, "node-b", { kind: "engagement", engagementId: "eng-b" }, "Engagement B credential path");
  node(repository, "node-mission-a", {
    kind: "mission",
    engagementId: "eng-a",
    missionId: "mission-a",
  }, "Mission A attack path");
  repository.createEdge({
    sourceNodeId: "node-global",
    targetNodeId: "node-a",
    edgeType: "applies_to",
    title: "Global method applies to engagement A",
    summary: "Scoped operational relationship",
    scope: { kind: "engagement", engagementId: "eng-a" },
    sensitivity: "private",
    confidence: 0.8,
    lifecycleStatus: "confirmed",
    provenance: provenance("edge-a"),
    explanation: "The evidence method was reused in this engagement",
    authorType: "operator",
  });
  repository.createCandidate({
    id: "candidate-a",
    nodeType: "preference",
    title: "Use deeper evidence explanations",
    summary: "Candidate Guided teaching preference",
    scope: { kind: "engagement", engagementId: "eng-a" },
    sensitivity: "private",
    confidence: 0.75,
    provenance: provenance("candidate-a-source"),
    proposedBy: "agent",
  });
  repository.createCandidate({
    id: "candidate-b",
    nodeType: "preference",
    title: "Engagement B preference",
    summary: "Must not cross the tenant boundary",
    scope: { kind: "engagement", engagementId: "eng-b" },
    sensitivity: "private",
    confidence: 0.75,
    provenance: provenance("candidate-b-source"),
    proposedBy: "agent",
  });

  const policy = (access: string | undefined): MemoryAccessPolicy => {
    if (access === "all") return { maximumSensitivity: "restricted", allEngagements: true };
    if (access === "b") return { maximumSensitivity: "private", engagementIds: ["eng-b"] };
    return { maximumSensitivity: "private", engagementIds: ["eng-a"], missionIds: ["mission-a"] };
  };
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(createSecondBrainRouter({
    database,
    vaultAllowedRoot: join(directory, "vaults"),
    resolveActor: (request) => request.get("X-Test-Actor") ?? "operator-route-test",
    resolveAccess: (request) => policy(request.get("X-Test-Access")),
  }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  return { database, repository, directory, url: `http://127.0.0.1:${port}` };
}

async function json(response: Response): Promise<Record<string, any>> {
  return response.json() as Promise<Record<string, any>>;
}

describe("Second Brain HTTP boundary", () => {
  test("memory controls are versioned, idempotent, and cannot disable safety invariants", async () => {
    const { database, url } = await application();
    try {
      const initial = await json(await fetch(`${url}/api/v2/brain/control`));
      expect(initial.policy).toMatchObject({ version: 0, enabled: true, engagementIsolation: true, secretsNeverRetained: true });
      const request = {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "memory-control-update-0001" },
        body: JSON.stringify({
          expectedVersion: 0,
          policy: {
            enabled: true,
            personalPreferencePolicy: "disabled",
            operationalMemoryEnabled: true,
            engagementIsolation: true,
            defaultRetentionDays: 90,
            autonomousUse: false,
            guidedUse: true,
            obsidianSyncScope: "confirmed",
            secretsNeverRetained: true,
          },
        }),
      };
      const saved = await json(await fetch(`${url}/api/v2/brain/control`, request));
      expect(saved.policy).toMatchObject({ version: 1, autonomousUse: false, personalPreferencePolicy: "disabled" });
      expect(await json(await fetch(`${url}/api/v2/brain/control`, request))).toEqual(saved);

      const unsafe = await fetch(`${url}/api/v2/brain/control`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "memory-control-unsafe-0001" },
        body: JSON.stringify({ expectedVersion: 1, policy: { ...saved.policy, engagementIsolation: false } }),
      });
      expect(unsafe.status).toBe(400);

      const candidateConfirm = await fetch(`${url}/api/v2/brain/candidates/candidate-a/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "confirm-disabled-preference-0001" },
        body: JSON.stringify({}),
      });
      expect(candidateConfirm.status).toBe(403);
      expect(await candidateConfirm.json()).toMatchObject({ error: { code: "memory_retention_disabled" } });
    } finally {
      database.close();
    }
  });

  test("summary, search, graph, and detail never leak another engagement", async () => {
    const { database, url } = await application();
    try {
      const summary = await json(await fetch(`${url}/api/v2/brain/summary`));
      expect(summary).toMatchObject({
        schemaVersion: "2.1",
        counts: { confirmed: 3, candidates: 1, edges: 1 },
        health: { database: "healthy", fts: "healthy" },
      });

      const nodes = await json(await fetch(`${url}/api/v2/brain/nodes?query=credential&limit=20`));
      expect(nodes.items.map((item: { id: string }) => item.id)).toEqual(["node-a"]);
      expect(JSON.stringify(nodes)).not.toContain("Engagement B");

      const graph = await json(await fetch(`${url}/api/v2/brain/graph?view=global&limit=50`));
      expect(graph.nodes.map((item: { id: string }) => item.id)).toContain("node-a");
      expect(graph.nodes.map((item: { id: string }) => item.id)).not.toContain("node-b");
      expect(graph.edges).toHaveLength(1);

      // The graph workspace expands its bounded view in 250-node increments.
      // Keep that public contract covered even when the fixture is smaller.
      const expandedGraph = await fetch(`${url}/api/v2/brain/graph?view=global&limit=500`);
      expect(expandedGraph.status).toBe(200);

      const denied = await fetch(`${url}/api/v2/brain/nodes/node-b`);
      expect(denied.status).toBe(404);
      expect(await denied.json()).toMatchObject({ error: { code: "memory_node_not_found" } });
      const detail = await json(await fetch(`${url}/api/v2/brain/nodes/node-a`));
      expect(detail.node).toMatchObject({ id: "node-a", scope: { engagementId: "eng-a" } });
      expect(detail.sources[0]).toMatchObject({ sourceId: "source-node-a" });
      expect(detail.versions).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  test("graph metadata filters execute inside the bounded access-controlled query", async () => {
    const { database, url } = await application();
    try {
      const relationship = await json(await fetch(`${url}/api/v2/brain/graph?view=global&edgeType=applies_to&limit=50`));
      expect(relationship.nodes.map((item: { id: string }) => item.id).sort()).toEqual(["node-a", "node-global"]);
      expect(relationship.edges.map((item: { edgeType: string }) => item.edgeType)).toEqual(["applies_to"]);

      const scoped = await json(await fetch(`${url}/api/v2/brain/graph?view=global&scope=engagement&engagementId=eng-a&status=confirmed&minConfidence=0.75&limit=50`));
      expect(scoped.nodes.map((item: { id: string }) => item.id)).toEqual(["node-a"]);
      expect(JSON.stringify(scoped)).not.toContain("Engagement B");

      const future = await json(await fetch(`${url}/api/v2/brain/graph?view=global&updatedAfter=2099-01-01T00%3A00%3A00.000Z&limit=50`));
      expect(future.nodes).toEqual([]);
      const preset = await json(await fetch(`${url}/api/v2/brain/graph?view=global&preset=lessons_failures&limit=50`));
      expect(preset.nodes).toEqual([]);

      const invalidConfidence = await fetch(`${url}/api/v2/brain/graph?view=global&minConfidence=1.5`);
      expect(invalidConfidence.status).toBe(400);
      const inheritedPreset = await fetch(`${url}/api/v2/brain/graph?view=global&preset=constructor`);
      expect(inheritedPreset.status).toBe(400);
      const invalidRange = await fetch(`${url}/api/v2/brain/graph?view=global&updatedAfter=2026-07-15T00%3A00%3A00Z&updatedBefore=2026-07-01T00%3A00%3A00Z`);
      expect(invalidRange.status).toBe(400);
    } finally {
      database.close();
    }
  });

  test("candidate consent mutations require idempotency and cannot cross scope", async () => {
    const { database, repository, url } = await application();
    try {
      const inbox = await json(await fetch(`${url}/api/v2/brain/candidates`));
      expect(inbox.items.map((item: { id: string }) => item.id)).toEqual(["candidate-a"]);

      const missingKey = await fetch(`${url}/api/v2/brain/candidates/candidate-a/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(missingKey.status).toBe(400);
      expect(await missingKey.json()).toMatchObject({ error: { code: "idempotency_key_required" } });

      const mutation = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "confirm-candidate-a-0001",
        },
        body: JSON.stringify({ edits: { summary: "Operator-confirmed deep evidence preference" } }),
      };
      const first = await fetch(`${url}/api/v2/brain/candidates/candidate-a/confirm`, mutation);
      expect(first.status).toBe(201);
      const confirmed = await json(first);
      expect(confirmed.node).toMatchObject({ nodeType: "preference", lifecycleStatus: "confirmed" });
      const replay = await json(await fetch(`${url}/api/v2/brain/candidates/candidate-a/confirm`, mutation));
      expect(replay).toEqual(confirmed);

      const revokedReplay = await fetch(`${url}/api/v2/brain/candidates/candidate-a/confirm`, {
        ...mutation,
        headers: { ...mutation.headers, "X-Test-Access": "b" },
      });
      expect(revokedReplay.status).toBe(404);
      const revokedBody = await json(revokedReplay);
      expect(revokedBody).toMatchObject({ error: { category: "not_found" } });
      expect(JSON.stringify(revokedBody)).not.toContain("Operator-confirmed deep evidence preference");
      expect(repository.getNode(confirmed.node.id)).toMatchObject({ version: 1 });

      const otherActor = await fetch(`${url}/api/v2/brain/candidates/candidate-a/confirm`, {
        ...mutation,
        headers: { ...mutation.headers, "X-Test-Actor": "operator-route-test-other" },
      });
      expect(otherActor.status).toBe(409);
      expect(JSON.stringify(await otherActor.json())).not.toContain("Operator-confirmed deep evidence preference");

      const denied = await fetch(`${url}/api/v2/brain/candidates/candidate-b/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "confirm-candidate-b-0001",
        },
        body: JSON.stringify({}),
      });
      expect(denied.status).toBe(404);

      const rejectRequest = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "reject-candidate-b-0001",
          "X-Test-Access": "b",
        },
        body: JSON.stringify({ reason: "Operator rejected this engagement-specific preference" }),
      };
      const rejected = await fetch(`${url}/api/v2/brain/candidates/candidate-b/reject`, rejectRequest);
      expect(rejected.status).toBe(200);
      const rejectedBody = await json(rejected);
      expect(rejectedBody.status).toBe("suppressed");
      expect(typeof rejectedBody.suppressionId).toBe("string");
      const suppressionId = rejectedBody.suppressionId as string;
      expect(suppressionId.length).toBeGreaterThan(0);
      const rejectedReplay = await fetch(`${url}/api/v2/brain/candidates/candidate-b/reject`, {
        ...rejectRequest,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "reject-candidate-b-0001",
        },
      });
      expect(rejectedReplay.status).toBe(404);
      expect(JSON.stringify(await rejectedReplay.json())).not.toContain(suppressionId);
      expect(database.prepare("SELECT COUNT(*) AS count FROM memory_suppressions").get()).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });

  test("run-filtered candidates require exact canonical provenance and remain scope isolated", async () => {
    const { database, repository, url } = await application();
    try {
      const now = "2026-07-15T10:00:00.000Z";
      const insertRun = database.prepare(`
        INSERT INTO runs (id, mission_id, journey, status, created_at, updated_at)
        VALUES (?, ?, ?, 'completed', ?, ?)
      `);
      insertRun.run("run-a-one", "mission-a", "guided", now, now);
      insertRun.run("run-a-two", "mission-a", "guided", now, now);
      insertRun.run("run-b-one", "mission-b", "autonomous", now, now);
      insertMission(database, "mission-a-other", "eng-a");
      const insertConversation = database.prepare(`
        INSERT INTO conversations (id, mission_id, run_id, conversation_type, created_at, updated_at)
        VALUES (?, ?, ?, 'guided', ?, ?)
      `);
      insertConversation.run("conversation-a-one", "mission-a", "run-a-one", now, now);
      insertConversation.run("conversation-a-two", "mission-a", "run-a-two", now, now);
      insertConversation.run("conversation-b-one", "mission-b", "run-b-one", now, now);
      const insertMessage = database.prepare(`
        INSERT INTO messages (id, conversation_id, role, body, created_at)
        VALUES (?, ?, 'assistant', 'Bounded reusable insight', ?)
      `);
      insertMessage.run("message-a-one", "conversation-a-one", now);
      insertMessage.run("message-a-two", "conversation-a-two", now);
      insertMessage.run("message-b-one", "conversation-b-one", now);
      for (const [id, missionId, messageId] of [
        ["candidate-run-a-one", "mission-a", "message-a-one"],
        ["candidate-run-a-two", "mission-a", "message-a-two"],
        ["candidate-run-b-one", "mission-b", "message-b-one"],
      ] as const) {
        repository.createCandidate({
          id,
          nodeType: "procedure",
          title: `Procedure from ${id}`,
          summary: "Reviewable exact-run procedure",
          scope: id === "candidate-run-a-one"
            ? { kind: "engagement", engagementId: "eng-a" }
            : { kind: "mission", missionId },
          sensitivity: "private",
          confidence: 0.8,
          provenance: {
            method: "operator_statement",
            explanation: "Created from one exact Guided message.",
            sources: [{ sourceType: "message", sourceId: messageId, acquiredAt: now }],
          },
          proposedBy: "operator-route-test",
        });
      }

      for (const [id, scope, messageId] of [
        ["candidate-run-a-global", { kind: "global" }, "message-a-one"],
        ["candidate-run-a-wrong-mission", {
          kind: "mission",
          engagementId: "eng-a",
          missionId: "mission-a-other",
        }, "message-a-one"],
        ["candidate-run-a-wrong-engagement", {
          kind: "engagement",
          engagementId: "eng-b",
        }, "message-a-one"],
        ["candidate-global-other-run", { kind: "global" }, "message-a-two"],
      ] as const) {
        repository.createCandidate({
          id,
          nodeType: "procedure",
          title: `Procedure from ${id}`,
          summary: "Reviewable scope-isolation procedure",
          scope,
          sensitivity: "private",
          confidence: 0.8,
          provenance: {
            method: "operator_statement",
            explanation: "Created from one exact Guided message.",
            sources: [{ sourceType: "message", sourceId: messageId, acquiredAt: now }],
          },
          proposedBy: "operator-route-test",
        });
      }

      const exact = await json(await fetch(`${url}/api/v2/brain/candidates?missionId=mission-a&runId=run-a-one`, {
        headers: { "X-Test-Access": "all" },
      }));
      expect(exact.items.map((item: { id: string }) => item.id).sort()).toEqual([
        "candidate-run-a-global",
        "candidate-run-a-one",
      ]);
      expect(JSON.stringify(exact)).not.toContain("candidate-run-a-two");
      expect(JSON.stringify(exact)).not.toContain("candidate-run-b-one");
      expect(JSON.stringify(exact)).not.toContain("candidate-run-a-wrong-mission");
      expect(JSON.stringify(exact)).not.toContain("candidate-run-a-wrong-engagement");
      expect(JSON.stringify(exact)).not.toContain("candidate-global-other-run");

      const inaccessible = await json(await fetch(`${url}/api/v2/brain/candidates?runId=run-b-one`));
      expect(inaccessible.items).toEqual([]);
      const mismatched = await json(await fetch(`${url}/api/v2/brain/candidates?missionId=mission-a&runId=run-b-one`, {
        headers: { "X-Test-Access": "all" },
      }));
      expect(mismatched.items).toEqual([]);
    } finally {
      database.close();
    }
  });

  test("versioned node mutations reject stale writes and forgetting is idempotent", async () => {
    const { database, url } = await application();
    try {
      const correctedResponse = await fetch(`${url}/api/v2/brain/nodes/node-a/correct`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "correct-node-a-0001",
        },
        body: JSON.stringify({
          expectedVersion: 1,
          summary: "Corrected engagement A memory",
          reason: "Operator corrected the summary",
        }),
      });
      expect(correctedResponse.status).toBe(200);
      const corrected = await json(correctedResponse);
      expect(corrected.node).toMatchObject({ version: 2, summary: "Corrected engagement A memory" });

      const stale = await fetch(`${url}/api/v2/brain/nodes/node-a/pin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "pin-node-a-stale-0001",
        },
        body: JSON.stringify({ expectedVersion: 1, pinned: true }),
      });
      expect(stale.status).toBe(409);

      const forgetRequest = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "forget-node-a-0001",
        },
        body: JSON.stringify({ expectedVersion: 2, reason: "Privacy request" }),
      };
      const forgotten = await json(await fetch(`${url}/api/v2/brain/nodes/node-a/forget`, forgetRequest));
      expect(forgotten.result).toMatchObject({ nodeId: "node-a", removed: { versions: 2 } });
      const replay = await json(await fetch(`${url}/api/v2/brain/nodes/node-a/forget`, forgetRequest));
      expect(replay).toEqual(forgotten);
      expect((await fetch(`${url}/api/v2/brain/nodes/node-a`)).status).toBe(200);
      expect((await json(await fetch(`${url}/api/v2/brain/nodes/node-a`))).node.lifecycleStatus).toBe("forgotten");
    } finally {
      database.close();
    }
  });

  test("cached node mutations reauthorize the current canonical resource before replay", async () => {
    const { database, repository, url } = await application();
    try {
      const request = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "correct-node-resource-reauth-0001",
        },
        body: JSON.stringify({
          expectedVersion: 1,
          summary: "Scoped result that must not survive revoked access",
          reason: "Exercise replay authorization",
        }),
      };
      const firstResponse = await fetch(`${url}/api/v2/brain/nodes/node-a/correct`, request);
      expect(firstResponse.status).toBe(200);
      const first = await json(firstResponse);
      expect(first.node).toMatchObject({ id: "node-a", version: 2 });
      expect(await json(await fetch(`${url}/api/v2/brain/nodes/node-a/correct`, request))).toEqual(first);

      repository.correctNode("node-a", {
        scope: { kind: "engagement", engagementId: "eng-b" },
        authorType: "operator",
        authorId: "scope-administrator",
        changeReason: "Resource moved outside the original operator scope",
      });
      const denied = await fetch(`${url}/api/v2/brain/nodes/node-a/correct`, request);
      expect(denied.status).toBe(404);
      const deniedBody = await json(denied);
      expect(deniedBody).toMatchObject({ error: { category: "not_found" } });
      expect(JSON.stringify(deniedBody)).not.toContain("Scoped result that must not survive revoked access");
      expect(repository.getNode("node-a")).toMatchObject({ version: 3, scope: { engagementId: "eng-b" } });
    } finally {
      database.close();
    }
  });

  test("context-pack detail enforces mission scope and exposes concise use explanations", async () => {
    const { database, repository, url } = await application();
    try {
      const item = repository.requireNode("node-mission-a");
      const pack = repository.persistContextPack({
        id: "ctx-route-a",
        missionId: "mission-a",
        journey: "guided",
        purpose: "Explain the next step",
        scopePolicy: {
          engagementId: "eng-a",
          missionId: "mission-a",
          journey: "guided",
          maximumSensitivity: "private",
          contextBudget: 1_000,
        },
        contextBudget: 1_000,
        createdBy: "commander",
        items: [{ node: item, score: 1, relevanceReason: "Same mission", signals: ["exact"] }],
      });
      repository.setContextItemDisposition(pack.id, {
        nodeId: item.id,
        used: true,
        relevanceReason: "Same mission and phase",
        influenceSummary: "Expanded the evidence validation guidance",
      });
      repository.persistContextPack({
        id: "ctx-route-b",
        missionId: "mission-b",
        journey: "autonomous",
        purpose: "Hidden engagement planning context",
        scopePolicy: {
          engagementId: "eng-b",
          missionId: "mission-b",
          journey: "autonomous",
          maximumSensitivity: "private",
          contextBudget: 1_000,
        },
        contextBudget: 1_000,
        createdBy: "commander",
        items: [{ node: repository.requireNode("node-b"), score: 1, relevanceReason: "Other engagement" }],
      });
      database.prepare(`
        INSERT INTO runs (id, mission_id, journey, status, created_at, updated_at)
        VALUES ('run-b', 'mission-b', 'autonomous', 'planning', ?, ?)
      `).run("2026-07-15T10:00:00.000Z", "2026-07-15T10:00:00.000Z");
      repository.persistContextPack({
        id: "ctx-route-b-linked",
        runId: "run-b",
        journey: "autonomous",
        purpose: "Run-linked hidden engagement planning context",
        scopePolicy: {
          engagementId: "eng-b",
          missionId: "mission-b",
          journey: "autonomous",
          maximumSensitivity: "private",
          contextBudget: 1_000,
        },
        contextBudget: 1_000,
        createdBy: "commander",
        items: [{ node: repository.requireNode("node-b"), score: 1, relevanceReason: "Other engagement run" }],
      });
      database.prepare(`
        INSERT INTO runs (id, mission_id, journey, status, created_at, updated_at)
        VALUES ('run-a', 'mission-a', 'guided', 'planning', ?, ?)
      `).run("2026-07-15T10:00:00.000Z", "2026-07-15T10:00:00.000Z");
      repository.persistContextPack({
        id: "ctx-route-a-linked",
        runId: "run-a",
        journey: "guided",
        purpose: "Run-linked visible planning context",
        scopePolicy: {
          engagementId: "eng-a",
          missionId: "mission-a",
          journey: "guided",
          maximumSensitivity: "private",
          contextBudget: 1_000,
        },
        contextBudget: 1_000,
        createdBy: "commander",
        items: [{ node: item, score: 1, relevanceReason: "Same engagement run" }],
      });
      const summaryA = await json(await fetch(`${url}/api/v2/brain/summary`));
      const summaryB = await json(await fetch(`${url}/api/v2/brain/summary`, {
        headers: { "X-Test-Access": "b" },
      }));
      expect(summaryA.counts.contextPacks).toBe(2);
      expect(summaryB.counts.contextPacks).toBe(2);
      const listed = await json(await fetch(`${url}/api/v2/brain/context-packs?missionId=mission-a`));
      expect(listed.schemaVersion).toBe("2.1");
      expect(listed.totalReturned).toBe(2);
      expect(listed.items.map((entry: { id: string }) => entry.id).sort()).toEqual(["ctx-route-a", "ctx-route-a-linked"]);
      expect(listed.items.find((entry: { id: string }) => entry.id === "ctx-route-a")).toMatchObject({
        missionId: "mission-a", journey: "guided", purpose: "Explain the next step",
        retrievedItemCount: 1, usedItemCount: 1, correctedItemCount: 0,
      });
      expect(listed.items.find((entry: { id: string }) => entry.id === "ctx-route-a-linked"))
        .toMatchObject({ missionId: "mission-a", runId: "run-a" });
      const visibleToA = JSON.stringify(await json(await fetch(`${url}/api/v2/brain/context-packs`)));
      expect(visibleToA).not.toContain("ctx-route-b");
      expect(visibleToA).not.toContain("ctx-route-b-linked");
      const detail = await json(await fetch(`${url}/api/v2/brain/context-packs/${pack.id}`));
      expect(detail.items[0]).toMatchObject({
        used: true,
        influenceSummary: "Expanded the evidence validation guidance",
        node: { id: "node-mission-a" },
      });
      const denied = await fetch(`${url}/api/v2/brain/context-packs/${pack.id}`, { headers: { "X-Test-Access": "b" } });
      expect(denied.status).toBe(404);
      const linkedDenied = await fetch(`${url}/api/v2/brain/context-packs/ctx-route-b-linked`);
      expect(linkedDenied.status).toBe(404);
      const engagementB = await json(await fetch(`${url}/api/v2/brain/context-packs`, { headers: { "X-Test-Access": "b" } }));
      expect(engagementB.items.map((item: { id: string }) => item.id).sort()).toEqual(["ctx-route-b", "ctx-route-b-linked"]);
    } finally {
      database.close();
    }
  });

  test("vault connection remains inside the configured root", async () => {
    const { database, directory, url } = await application();
    try {
      const connect = await fetch(`${url}/api/v2/brain/vault/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "connect-vault-safe-0001",
        },
        body: JSON.stringify({
          vaultPath: "Operator-Brain",
          displayName: "Operator Brain",
          permissionGranted: true,
        }),
      });
      expect(connect.status).toBe(201);
      const connected = await json(connect);
      expect(connected).toMatchObject({ connection: { vaultPath: "Operator-Brain", status: "connected" } });

      const exportRequest = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "export-vault-safe-0001",
        },
        body: JSON.stringify({ connectionId: connected.connection.id }),
      };
      const exported = await fetch(`${url}/api/v2/brain/vault/export`, exportRequest);
      expect(exported.status).toBe(200);
      const exportedPayload = await json(exported);
      expect(exportedPayload).toMatchObject({ result: { connectionId: connected.connection.id, status: "synced" } });
      expect(await json(await fetch(`${url}/api/v2/brain/vault/export`, exportRequest))).toEqual(exportedPayload);
      const revokedExportReplay = await fetch(`${url}/api/v2/brain/vault/export`, {
        ...exportRequest,
        headers: { ...exportRequest.headers, "X-Test-Access": "b" },
      });
      expect(revokedExportReplay.status).toBe(404);
      expect(JSON.stringify(await revokedExportReplay.json())).not.toContain("Exported 3 accessible canonical notes");
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM audit_records
        WHERE action = 'memory.exported' AND resource_type = 'memory_node'
      `).get()).toEqual({ count: 3 });
      const snapshot = await json(await fetch(`${url}/api/v2/brain/vault`));
      expect(snapshot.syncStates.length).toBe(3);
      expect(JSON.stringify(snapshot)).not.toContain(join(directory, "vaults"));

      const synchronized = await fetch(`${url}/api/v2/brain/vault/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "sync-vault-safe-0001",
        },
        body: JSON.stringify({ connectionId: connected.connection.id }),
      });
      expect(synchronized.status).toBe(200);
      expect(await synchronized.json()).toMatchObject({ result: { status: "synced" } });

      const traversal = await fetch(`${url}/api/v2/brain/vault/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "connect-vault-escape-0001",
        },
        body: JSON.stringify({
          vaultPath: "../../outside",
          displayName: "Outside",
          permissionGranted: true,
        }),
      });
      expect([400, 403]).toContain(traversal.status);
      expect(JSON.stringify(await traversal.json())).not.toContain(directory.replaceAll("\\", "/"));
    } finally {
      database.close();
    }
  });

  test("portable exports bind downloads and idempotent replay to owner, access, and live nodes", async () => {
    const { database, repository, directory, url } = await application();
    try {
      const connect = await fetch(`${url}/api/v2/brain/vault/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "connect-portable-vault-0001",
        },
        body: JSON.stringify({
          vaultPath: "Portable-Brain",
          displayName: "Portable Brain",
          permissionGranted: true,
        }),
      });
      expect(connect.status).toBe(201);
      const connected = await json(connect);
      const portableRequest = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "portable-export-owner-bound-0001",
        },
        body: JSON.stringify({ connectionId: connected.connection.id }),
      };
      const createdResponse = await fetch(`${url}/api/v2/brain/vault/portable-export`, portableRequest);
      expect(createdResponse.status).toBe(200);
      const created = await json(createdResponse);
      const archiveName = String(created.result.archiveName);
      expect(created.result.status).toBe("ready");
      expect(archiveName).toMatch(/\.zip$/u);
      expect(await json(await fetch(`${url}/api/v2/brain/vault/portable-export`, portableRequest))).toEqual(created);

      const authorizedDownload = await fetch(`${url}${created.result.downloadUrl}`);
      expect(authorizedDownload.status).toBe(200);
      expect(authorizedDownload.headers.get("content-type")).toContain("application/zip");
      expect(authorizedDownload.headers.get("content-disposition")).toBe(
        `attachment; filename="${archiveName}"`,
      );
      expect(authorizedDownload.headers.get("x-content-type-options")).toBe("nosniff");
      expect(authorizedDownload.headers.get("cross-origin-resource-policy")).toBe("same-origin");
      expect(authorizedDownload.headers.get("content-security-policy")).toBe("sandbox");
      expect(authorizedDownload.headers.get("referrer-policy")).toBe("no-referrer");

      const crossActorDownload = await fetch(`${url}${created.result.downloadUrl}`, {
        headers: { "X-Test-Actor": "operator-route-test-other" },
      });
      expect(crossActorDownload.status).toBe(404);
      expect(JSON.stringify(await crossActorDownload.json())).not.toContain(archiveName);

      const revokedDownload = await fetch(`${url}${created.result.downloadUrl}`, {
        headers: { "X-Test-Access": "b" },
      });
      expect(revokedDownload.status).toBe(404);
      expect(JSON.stringify(await revokedDownload.json())).not.toContain(archiveName);

      const revokedReplay = await fetch(`${url}/api/v2/brain/vault/portable-export`, {
        ...portableRequest,
        headers: { ...portableRequest.headers, "X-Test-Access": "b" },
      });
      expect(revokedReplay.status).toBe(404);
      expect(JSON.stringify(await revokedReplay.json())).not.toContain(archiveName);

      const archivePath = join(directory, "vaults", "Portable-Brain", ".chillspwn", "exports", archiveName);
      const originalArchive = readFileSync(archivePath);
      const tamperedArchive = Buffer.from(originalArchive);
      tamperedArchive[0] = tamperedArchive[0]! ^ 0xff;
      writeFileSync(archivePath, tamperedArchive);
      const tamperedDownload = await fetch(`${url}${created.result.downloadUrl}`);
      expect(tamperedDownload.status).toBe(404);
      expect(JSON.stringify(await tamperedDownload.json())).not.toContain(archiveName);
      writeFileSync(archivePath, originalArchive);

      repository.forgetNode("node-a", "operator-route-test", "Exercise portable-export resource revocation");
      const forgottenNodeDownload = await fetch(`${url}${created.result.downloadUrl}`);
      expect(forgottenNodeDownload.status).toBe(404);
      expect(JSON.stringify(await forgottenNodeDownload.json())).not.toContain(archiveName);
    } finally {
      database.close();
    }
  });

  test("candidate confirmation and manual correction reject authentication material with safe metadata", async () => {
    const { database, repository, url } = await application();
    try {
      const sessionMaterial = ["session_token", ": ", "unit-test-session-material-123456789"].join("");
      const confirm = await fetch(`${url}/api/v2/brain/candidates/candidate-a/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "confirm-candidate-secret-denied-0001",
        },
        body: JSON.stringify({ edits: { body: sessionMaterial } }),
      });
      expect(confirm.status).toBe(422);
      const confirmBody = await json(confirm);
      expect(confirmBody).toMatchObject({
        error: {
          code: "sensitive_material_not_retained",
          category: "policy_denied",
          retryable: false,
        },
      });
      expect(JSON.stringify(confirmBody)).not.toContain(sessionMaterial);
      expect(repository.requireCandidate("candidate-a").status).toBe("pending");
      expect(repository.requireCandidate("candidate-a").proposedNodeId).toBeUndefined();

      const current = repository.requireNode("node-a");
      const correct = await fetch(`${url}/api/v2/brain/nodes/node-a/correct`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "correct-node-secret-denied-0001",
        },
        body: JSON.stringify({
          expectedVersion: current.version,
          body: sessionMaterial,
          reason: "Operator correction",
        }),
      });
      expect(correct.status).toBe(422);
      const correctionBody = await json(correct);
      expect(correctionBody.error.code).toBe("sensitive_material_not_retained");
      expect(JSON.stringify(correctionBody)).not.toContain(sessionMaterial);
      expect(repository.requireNode("node-a")).toMatchObject({ version: current.version, body: current.body });
      expect(repository.listVersions("node-a")).toHaveLength(1);

      const safe = await fetch(`${url}/api/v2/brain/nodes/node-a/correct`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "correct-node-placeholder-safe-0001",
        },
        body: JSON.stringify({
          expectedVersion: current.version,
          body: "Use Authorization: Bearer <TOKEN> and retain only evidence ID evidence-route-001.",
          reason: "Document safe credential indirection",
        }),
      });
      expect(safe.status).toBe(200);
      expect((await json(safe)).node.body).toContain("Bearer <TOKEN>");
    } finally {
      database.close();
    }
  });
});
