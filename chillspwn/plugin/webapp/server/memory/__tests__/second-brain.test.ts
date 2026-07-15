import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDatabaseConnection, migrateDatabase } from "../../db/index";
import {
  MemoryRepository,
  SecondBrainService,
  type CreateMemoryNodeInput,
  type MemoryProvenance,
  type MemoryScope,
} from "../index";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function database() {
  const directory = mkdtempSync(join(tmpdir(), "second-brain-test-"));
  temporaryDirectories.push(directory);
  const db = createDatabaseConnection({ filename: join(directory, "brain.sqlite") });
  migrateDatabase(db);
  return db;
}

function provenance(sourceId: string): MemoryProvenance {
  return {
    method: "operator_statement",
    explanation: "The operator explicitly confirmed this information",
    sources: [{
      sourceType: "message",
      sourceId,
      acquiredAt: "2026-07-15T10:00:00.000Z",
    }],
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function insertMission(db: ReturnType<typeof database>, id: string, engagementId: string): void {
  const now = "2026-07-15T10:00:00.000Z";
  db.prepare(`
    INSERT INTO missions (
      id, name, objective, journey, engagement_id, created_by, created_at, updated_at
    ) VALUES (?, ?, 'Authorized assessment', 'guided', ?, 'operator', ?, ?)
  `).run(id, id, engagementId, now, now);
}

function createNode(
  repository: MemoryRepository,
  id: string,
  scope: MemoryScope,
  title = "Credential discovery pattern",
  body = "Enumerate identity boundaries before selecting the next authorized action.",
): ReturnType<MemoryRepository["createNode"]> {
  const input: CreateMemoryNodeInput = {
    id,
    nodeType: "technique",
    title,
    summary: "A confirmed operational technique for scoped identity discovery",
    body,
    scope,
    sensitivity: "internal",
    confidence: 0.9,
    lifecycleStatus: "confirmed",
    confirmationState: "confirmed",
    provenance: provenance(`source-${id}`),
    authorType: "operator",
    authorId: "operator-1",
    retentionPolicy: { journeys: ["autonomous", "guided"] },
  };
  return repository.createNode(input);
}

describe("Second Brain canonical memory", () => {
  test("hybrid retrieval enforces engagement and mission isolation", () => {
    const db = database();
    try {
      insertMission(db, "mission-a", "eng-a");
      insertMission(db, "mission-b", "eng-b");
      const repository = new MemoryRepository(db);
      const brain = new SecondBrainService(repository);
      createNode(repository, "node-global", { kind: "global" });
      createNode(repository, "node-eng-a", { kind: "engagement", engagementId: "eng-a" });
      createNode(repository, "node-eng-b", { kind: "engagement", engagementId: "eng-b" });
      createNode(repository, "node-mission-a", {
        kind: "mission",
        engagementId: "eng-a",
        missionId: "mission-a",
      });
      createNode(repository, "node-mission-b", {
        kind: "mission",
        engagementId: "eng-b",
        missionId: "mission-b",
      });

      const result = brain.retrieve("credential discovery", {
        engagementId: "eng-a",
        missionId: "mission-a",
        journey: "guided",
        maximumSensitivity: "private",
        contextBudget: 2_000,
        graphDepth: 1,
      });
      const ids = result.map((item) => item.node.id);
      expect(ids).toContain("node-global");
      expect(ids).toContain("node-eng-a");
      expect(ids).toContain("node-mission-a");
      expect(ids).not.toContain("node-eng-b");
      expect(ids).not.toContain("node-mission-b");
      expect(result.every((item) => item.relevanceReason.length > 0)).toBe(true);

      const engagementOnly = brain.retrieve("credential discovery", {
        engagementId: "eng-a",
        missionId: "mission-a",
        allowGlobal: false,
        journey: "autonomous",
        maximumSensitivity: "private",
        contextBudget: 2_000,
        graphDepth: 1,
      }).map((item) => item.node.id);
      expect(engagementOnly).not.toContain("node-global");
      expect(engagementOnly).toContain("node-eng-a");
      expect(engagementOnly).toContain("node-mission-a");

      const exactOnly = brain.retrieve("credential discovery", {
        engagementId: "eng-a",
        missionId: "mission-a",
        journey: "autonomous",
        maximumSensitivity: "private",
        contextBudget: 2_000,
        exactNodeIds: ["node-eng-a", "node-eng-b"],
        exactNodeIdsOnly: true,
        graphDepth: 2,
      }).map((item) => item.node.id);
      expect(exactOnly).toEqual(["node-eng-a"]);
    } finally {
      db.close();
    }
  });

  test("personal candidates require operator confirmation and suppression prevents relearning", () => {
    const db = database();
    try {
      const repository = new MemoryRepository(db);
      const candidateInput = {
        id: "candidate-depth",
        nodeType: "preference" as const,
        title: "Prefers deep explanations",
        summary: "Use detailed teaching for Guided missions",
        body: "Explain prerequisites and expected evidence.",
        scope: { kind: "global" as const },
        sensitivity: "private" as const,
        confidence: 0.75,
        provenance: provenance("message-preference"),
        proposedBy: "agent-commander",
      };
      const candidate = repository.createCandidate(candidateInput);
      expect(candidate.status).toBe("pending");
      expect(repository.getNode("candidate-depth")).toBeUndefined();

      const confirmed = repository.confirmCandidate(candidate.id, "operator-1", {
        summary: "Use detailed, evidence-led teaching for Guided missions",
      });
      expect(confirmed.nodeType).toBe("preference");
      expect(confirmed.lifecycleStatus).toBe("confirmed");
      expect(confirmed.authorType).toBe("operator");
      expect(repository.requireCandidate(candidate.id).status).toBe("edited_confirmed");

      const rejected = repository.createCandidate({ ...candidateInput, id: "candidate-reject", title: "Prefers terse reports" });
      const suppressionId = repository.rejectCandidateAndSuppress(
        rejected.id,
        "operator-1",
        "This preference is incorrect",
      );
      expect(suppressionId.startsWith("msup_")).toBe(true);
      expect(() => repository.createCandidate({ ...candidateInput, id: "candidate-repeat", title: "Prefers terse reports" }))
        .toThrow("suppressed");
    } finally {
      db.close();
    }
  });

  test("persists inspectable context packs and requires used/ignored explanations", () => {
    const db = database();
    try {
      insertMission(db, "mission-context", "eng-context");
      const repository = new MemoryRepository(db);
      const brain = new SecondBrainService(repository);
      createNode(repository, "node-context", { kind: "engagement", engagementId: "eng-context" });

      const pack = brain.retrieveAndPersistContext({
        query: "credential discovery",
        queryRedacted: "credential discovery",
        policy: {
          engagementId: "eng-context",
          missionId: "mission-context",
          journey: "guided",
          maximumSensitivity: "private",
          contextBudget: 1_000,
        },
        purpose: "Explain the next Guided step",
        createdBy: "commander",
        missionId: "mission-context",
      });
      expect(pack.items).toHaveLength(1);
      expect(pack.items[0]?.ignoredReason).toBe("Not yet evaluated");
      expect(() => brain.recordContextUse(pack.id, {
        nodeId: "node-context",
        used: true,
        relevanceReason: "Matched the current phase",
      })).toThrow("influence summary");
      brain.recordContextUse(pack.id, {
        nodeId: "node-context",
        used: true,
        relevanceReason: "Matched the current phase and engagement",
        influenceSummary: "Expanded the prerequisite and evidence explanation",
      });
      const stored = repository.requireContextPack(pack.id);
      expect(stored.items[0]?.used).toBe(true);
      expect(stored.items[0]?.influenceSummary).toContain("prerequisite");
      expect(JSON.stringify(stored)).not.toContain("chain-of-thought");
    } finally {
      db.close();
    }
  });

  test("forgetting erases reusable content and leaves a content-free audit and suppression", () => {
    const db = database();
    try {
      const repository = new MemoryRepository(db);
      const secretPhrase = "uniquely-sensitive-memory-phrase";
      createNode(repository, "node-forget", { kind: "global" }, "Sensitive operator note", secretPhrase);
      createNode(repository, "node-peer", { kind: "global" }, "Peer technique");
      expect(() => repository.createEdge({
        sourceNodeId: "node-forget",
        targetNodeId: "node-peer",
        edgeType: "related" as never,
        title: "Invalid edge should fail",
        summary: "Invalid",
        scope: { kind: "global" },
        sensitivity: "private",
        confidence: 1,
        lifecycleStatus: "confirmed",
        provenance: provenance("edge-source"),
        explanation: "Invalid relationship",
        authorType: "operator",
      })).toThrow("memory edge type is invalid");
    } finally {
      db.close();
    }

    const db2 = database();
    try {
      const repository = new MemoryRepository(db2);
      const brain = new SecondBrainService(repository);
      const secretPhrase = "uniquely-sensitive-memory-phrase";
      createNode(repository, "node-forget", { kind: "global" }, "Sensitive operator note", secretPhrase);
      createNode(repository, "node-peer", { kind: "global" }, "Peer technique");
      repository.createEdge({
        sourceNodeId: "node-forget",
        targetNodeId: "node-peer",
        edgeType: "depends_on",
        title: "Sensitive note depends on peer",
        summary: "Confirmed relationship",
        scope: { kind: "global" },
        sensitivity: "private",
        confidence: 1,
        lifecycleStatus: "confirmed",
        provenance: provenance("edge-source"),
        explanation: "The operator linked these memories",
        authorType: "operator",
      });
      db2.prepare(`
        INSERT INTO memory_embeddings (
          node_id, model, provider, dimensions, embedding, content_hash, created_at
        ) VALUES ('node-forget', 'local-test', 'local', 2, ?, ?, ?)
      `).run(Buffer.from([1, 2]), "a".repeat(64), "2026-07-15T10:00:00.000Z");
      const retrieved = brain.retrieve("sensitive memory", {
        journey: "guided",
        maximumSensitivity: "private",
        contextBudget: 1_000,
      });
      const pack = repository.persistContextPack({
        journey: "guided",
        purpose: "Test forgetting",
        scopePolicy: {
          journey: "guided",
          maximumSensitivity: "private",
          contextBudget: 1_000,
        },
        contextBudget: 1_000,
        createdBy: "test",
        items: retrieved,
      });
      expect(pack.items.some((item) => item.nodeId === "node-forget")).toBe(true);

      const forgotten = brain.forget("node-forget", "operator-1", "Remove this memory everywhere");
      expect(forgotten.removed.versions).toBe(1);
      expect(forgotten.removed.embeddings).toBe(1);
      expect(forgotten.removed.edges).toBe(1);
      expect(forgotten.removed.contextItems).toBe(1);
      const tombstone = repository.requireNode("node-forget", true);
      expect(tombstone.lifecycleStatus).toBe("forgotten");
      expect(tombstone.body).toBe("");
      expect(repository.listVersions("node-forget")).toHaveLength(0);
      expect(db2.prepare("SELECT count(*) AS count FROM memory_sources WHERE node_id = 'node-forget'").get())
        .toEqual({ count: 0 });
      const audit = db2.prepare("SELECT * FROM audit_records WHERE id = ?").get(forgotten.auditRecordId);
      expect(JSON.stringify(audit)).not.toContain(secretPhrase);
      expect(JSON.stringify(audit)).not.toContain("Sensitive operator note");
      expect(brain.retrieve(secretPhrase, {
        journey: "guided",
        maximumSensitivity: "restricted",
        contextBudget: 1_000,
      })).toHaveLength(0);
      // Erasure restores the append-only trigger for all remaining memory.
      expect(() => db2.prepare("DELETE FROM memory_versions WHERE node_id = 'node-peer'").run()).toThrow("append-only");
    } finally {
      db2.close();
    }
  });

  test("mission and run scoped memory audits satisfy migration 007 journey triggers and hash the journey", () => {
    const db = database();
    try {
      const now = "2026-07-15T14:00:00.000Z";
      insertMission(db, "mission-memory-audit", "eng-memory-audit");
      db.prepare(`
        INSERT INTO runs (id, mission_id, journey, status, created_at, updated_at)
        VALUES ('run-memory-audit', 'mission-memory-audit', 'guided', 'running', ?, ?)
      `).run(now, now);
      let sequence = 0;
      const repository = new MemoryRepository(db, {
        clock: () => new Date(now),
        createId: (prefix) => `${prefix}-memory-audit-${++sequence}`,
      });
      repository.createNode({
        id: "node-memory-audit",
        nodeType: "run",
        title: "Run memory projection",
        summary: "Content-free projection linked to the canonical run",
        body: "Retain only the run and evidence identifiers.",
        scope: {
          kind: "mission",
          engagementId: "eng-memory-audit",
          missionId: "mission-memory-audit",
        },
        sensitivity: "private",
        confidence: 1,
        lifecycleStatus: "confirmed",
        confirmationState: "confirmed",
        provenance: {
          method: "derived",
          explanation: "Projected from the canonical run",
          sources: [{ sourceType: "run", sourceId: "run-memory-audit", acquiredAt: now }],
        },
        authorType: "operator",
        authorId: "operator-memory-audit",
      });

      const forgotten = repository.forgetNode("node-memory-audit", "operator-memory-audit");
      const audit = db.prepare(`
        SELECT id, mission_id, run_id, journey, actor_id, action, resource_type,
          resource_id, reason, details_json, previous_hash, record_hash, occurred_at
        FROM audit_records WHERE id = ?
      `).get(forgotten.auditRecordId) as Record<string, string | null>;
      expect(audit).toMatchObject({
        mission_id: "mission-memory-audit",
        run_id: "run-memory-audit",
        journey: "guided",
        previous_hash: null,
      });
      const expectedHash = createHash("sha256").update(canonicalJson({
        id: audit.id,
        actor: audit.actor_id,
        action: audit.action,
        resourceType: audit.resource_type,
        resourceId: audit.resource_id,
        reason: audit.reason,
        details: JSON.parse(audit.details_json!),
        missionId: audit.mission_id,
        runId: audit.run_id,
        journey: audit.journey,
        previousHash: audit.previous_hash,
        occurredAt: audit.occurred_at,
      }), "utf8").digest("hex");
      expect(audit.record_hash).toBe(expectedHash);

      const insert = db.prepare(`
        INSERT INTO audit_records (
          id, mission_id, run_id, journey, actor_type, actor_id, action,
          resource_type, resource_id, reason, details_json, previous_hash,
          record_hash, occurred_at
        ) VALUES (?, 'mission-memory-audit', 'run-memory-audit', ?, 'operator',
          'operator-memory-audit', 'memory.test', 'memory_node', 'node-memory-audit',
          'Trigger test', '{}', ?, ?, ?)
      `);
      expect(() => insert.run("audit-memory-missing", null, audit.record_hash, "missing", now))
        .toThrow("require a journey");
      expect(() => insert.run("audit-memory-mismatch", "autonomous", audit.record_hash, "mismatch", now))
        .toThrow("match run journey");
    } finally {
      db.close();
    }
  });
});
