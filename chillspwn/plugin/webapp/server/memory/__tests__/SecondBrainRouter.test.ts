import { afterEach, describe, expect, test } from "bun:test";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
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

function insertMission(database: ReturnType<typeof createDatabaseConnection>, id: string, engagementId: string): void {
  const now = "2026-07-15T10:00:00.000Z";
  database.prepare(`
    INSERT INTO missions (
      id, name, objective, journey, engagement_id, created_by, created_at, updated_at
    ) VALUES (?, ?, 'Authorized scope', 'guided', ?, 'operator', ?, ?)
  `).run(id, id, engagementId, now, now);
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
  insertMission(database, "mission-b", "eng-b");
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
    resolveActor: () => "operator-route-test",
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
    const { database, url } = await application();
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

      const denied = await fetch(`${url}/api/v2/brain/candidates/candidate-b/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "confirm-candidate-b-0001",
        },
        body: JSON.stringify({}),
      });
      expect(denied.status).toBe(404);

      const rejected = await fetch(`${url}/api/v2/brain/candidates/candidate-b/reject`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "reject-candidate-b-0001",
          "X-Test-Access": "b",
        },
        body: JSON.stringify({ reason: "Operator rejected this engagement-specific preference" }),
      });
      expect(rejected.status).toBe(200);
      expect(await rejected.json()).toMatchObject({ status: "suppressed", suppressionId: expect.any(String) });
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
      const detail = await json(await fetch(`${url}/api/v2/brain/context-packs/${pack.id}`));
      expect(detail.items[0]).toMatchObject({
        used: true,
        influenceSummary: "Expanded the evidence validation guidance",
        node: { id: "node-mission-a" },
      });
      const denied = await fetch(`${url}/api/v2/brain/context-packs/${pack.id}`, { headers: { "X-Test-Access": "b" } });
      expect(denied.status).toBe(404);
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

      const exported = await fetch(`${url}/api/v2/brain/vault/export`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "export-vault-safe-0001",
        },
        body: JSON.stringify({ connectionId: connected.connection.id }),
      });
      expect(exported.status).toBe(200);
      expect(await exported.json()).toMatchObject({ result: { connectionId: connected.connection.id, status: "synced" } });
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
