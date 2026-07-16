import { createDatabaseConnection, inImmediateTransaction, migrateDatabase } from "../../../server/db";

export const BRAIN_SCALE_NODE_COUNT = 50_000;
export const BRAIN_SCALE_EDGE_COUNT = BRAIN_SCALE_NODE_COUNT - 1;
export const BRAIN_SCALE_SENTINEL_INDEX = 42_424;
export const BRAIN_SCALE_SENTINEL_ID = `mem-scale-${String(BRAIN_SCALE_SENTINEL_INDEX).padStart(5, "0")}`;
export const BRAIN_SCALE_SENTINEL_TERM = `sentinel${BRAIN_SCALE_SENTINEL_INDEX}`;

const NODE_TYPES = [
  "operator",
  "preference",
  "mission",
  "run",
  "plan",
  "phase",
  "step",
  "agent",
  "tool",
  "mcp_capability",
  "tactic",
  "technique",
  "procedure",
  "target",
  "asset",
  "entity",
  "decision",
  "evidence",
  "finding",
  "artifact",
  "failure",
  "recovery",
  "evaluation",
  "lesson",
  "report",
  "source",
] as const;

const EDGE_TYPES = [
  "prefers",
  "applies_to",
  "belongs_to",
  "executed_by",
  "delegated_to",
  "used_in",
  "targets",
  "produced",
  "supports",
  "contradicts",
  "depends_on",
  "derived_from",
  "learned_from",
  "failed_in",
  "recovered_by",
  "similar_to",
  "supersedes",
  "verified_by",
  "mentioned_in",
  "influenced",
] as const;

function nodeId(index: number): string {
  return `mem-scale-${String(index).padStart(5, "0")}`;
}

/**
 * E2E-only scale fixture. It writes the real canonical schema in a temporary
 * database created by start-server.ts; no production path imports this module.
 */
export function seedSecondBrainScaleFixtures(databasePath: string): void {
  const startedAt = performance.now();
  const database = createDatabaseConnection({
    filename: databasePath,
    verifyIntegrity: false,
    busyTimeoutMs: 120_000,
  });

  try {
    migrateDatabase(database);
    const insertNode = database.prepare(`
      INSERT INTO memory_nodes (
        id, node_type, title, summary, body, scope, engagement_id, mission_id,
        sensitivity, confidence, lifecycle_status, confirmation_state,
        provenance_json, author_type, author_id, version,
        retention_policy_json, expires_at, pinned, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, 'global', NULL, NULL,
        'internal', ?, 'confirmed', 'not_required',
        ?, 'system', 'e2e-brain-scale-fixture', 1,
        '{"fixture":"e2e-only","retention":"ephemeral"}', NULL, 0, ?, ?
      )
    `);
    const insertEdge = database.prepare(`
      INSERT INTO memory_edges (
        id, source_node_id, target_node_id, edge_type, title, summary, scope,
        sensitivity, confidence, lifecycle_status, provenance_json,
        explanation, author_type, author_id, version, expires_at,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, 'E2E scale relationship',
        'Deterministic bounded-neighborhood relationship for browser acceptance.',
        'global', 'internal', 0.9, 'confirmed', ?,
        'Connects adjacent canonical fixture nodes without creating an unbounded hub.',
        'system', 'e2e-brain-scale-fixture', 1, NULL, ?, ?
      )
    `);
    const provenance = JSON.stringify({
      method: "derived",
      explanation: "E2E-only deterministic scale fixture in an isolated temporary database.",
      sources: [{
        sourceType: "e2e_fixture",
        sourceId: "second-brain-50000-node-profile",
        acquiredAt: "2026-07-15T00:00:00.000Z",
      }],
    });
    const baseTime = Date.parse("2026-07-15T00:00:00.000Z");

    inImmediateTransaction(database, () => {
      for (let index = 0; index < BRAIN_SCALE_NODE_COUNT; index += 1) {
        const id = nodeId(index);
        const sentinel = index === BRAIN_SCALE_SENTINEL_INDEX;
        const timestamp = new Date(baseTime + index * 1_000).toISOString();
        insertNode.run(
          id,
          NODE_TYPES[index % NODE_TYPES.length],
          sentinel ? `Scale search ${BRAIN_SCALE_SENTINEL_TERM}` : `Scale memory ${String(index).padStart(5, "0")}`,
          sentinel
            ? "Unique FTS sentinel used to prove search across records outside the initial graph segment."
            : "Canonical E2E-only node used to prove bounded graph loading and local expansion.",
          `Fixture node ${index}; this content exists only in the isolated browser acceptance database.`,
          0.75 + (index % 20) / 100,
          provenance,
          timestamp,
          timestamp,
        );
        if (index === 0) continue;
        insertEdge.run(
          `edge-scale-${String(index - 1).padStart(5, "0")}`,
          nodeId(index - 1),
          id,
          EDGE_TYPES[(index - 1) % EDGE_TYPES.length],
          provenance,
          timestamp,
          timestamp,
        );
      }
    });
    database.pragma("wal_checkpoint(TRUNCATE)");

    const counts = database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM memory_nodes) AS nodes,
        (SELECT COUNT(*) FROM memory_edges) AS edges,
        (SELECT COUNT(*) FROM memory_nodes_fts) AS indexed_nodes
    `).get() as { nodes: number; edges: number; indexed_nodes: number };
    if (
      Number(counts.nodes) !== BRAIN_SCALE_NODE_COUNT
      || Number(counts.edges) !== BRAIN_SCALE_EDGE_COUNT
      || Number(counts.indexed_nodes) !== BRAIN_SCALE_NODE_COUNT
    ) {
      throw new Error(`Brain scale fixture reconciliation failed: ${JSON.stringify(counts)}`);
    }

    const elapsedMs = Math.round((performance.now() - startedAt) * 100) / 100;
    console.log(
      `[e2e-only:brain-scale] seeded ${counts.nodes} canonical memory nodes, ${counts.edges} edges, and ${counts.indexed_nodes} FTS rows in ${elapsedMs}ms`,
    );
  } finally {
    database.close();
  }
}
