import { describe, expect, test } from "bun:test";
import { parseBrainSummary, parseMemoryControlPolicy, parseMemoryGraph } from "../../domain/schemas/brain";

const node = {
  id: "mem-technique", nodeType: "technique", title: "Evidence-led enumeration", summary: "Confirm services before selecting a procedure.",
  scope: { kind: "engagement", engagementId: "eng-1" }, sensitivity: "internal", confidence: 0.92,
  lifecycleStatus: "verified", confirmationState: "not_required", version: 3, pinned: true,
  createdAt: "2026-07-15T00:00:00.000Z", updatedAt: "2026-07-15T01:00:00.000Z", edgeCount: 4, sourceCount: 2,
};

describe("Second Brain API schema validation", () => {
  test("validates a canonical summary and wrapped response", () => {
    const result = parseBrainSummary({ data: {
      schemaVersion: "2.1",
      counts: { confirmed: 4, candidates: 1, stale: 0, disputed: 0, forgotten: 0, edges: 3, contextPacks: 2 },
      health: { database: "healthy", fts: "ready" },
      vault: { status: "connected", connections: 1, conflicts: 0, lastSyncAt: null },
      recentNodes: [node],
    } });
    expect(result.recentNodes[0]?.scope).toEqual({ kind: "engagement", engagementId: "eng-1" });
    expect(result.counts.contextPacks).toBe(2);
  });

  test("validates graph relationships and rejects cross-version or invalid sensitivity data", () => {
    const graph = parseMemoryGraph({
      schemaVersion: "2.1", view: "local", rootNodeId: "mem-technique", nodes: [node], edges: [], truncated: false,
    });
    expect(graph.rootNodeId).toBe("mem-technique");
    expect(() => parseMemoryGraph({ schemaVersion: "2.0", view: "global", nodes: [], edges: [], truncated: false })).toThrow("unsupported");
    expect(() => parseMemoryGraph({ schemaVersion: "2.1", view: "global", nodes: [{ ...node, sensitivity: "secret" }], edges: [], truncated: false })).toThrow("sensitivity");
  });

  test("requires the locked safety invariants in memory-control responses", () => {
    const policy = parseMemoryControlPolicy({ schemaVersion: "2.1", policy: {
      enabled: true,
      personalPreferencePolicy: "candidate_only",
      operationalMemoryEnabled: true,
      engagementIsolation: true,
      defaultRetentionDays: 365,
      autonomousUse: true,
      guidedUse: true,
      obsidianSyncScope: "confirmed_and_verified",
      secretsNeverRetained: true,
      version: 2,
      updatedBy: "operator",
      updatedAt: "2026-07-15T01:00:00.000Z",
    } });
    expect(policy).toMatchObject({ version: 2, personalPreferencePolicy: "candidate_only" });
    expect(() => parseMemoryControlPolicy({ policy: { ...policy, engagementIsolation: false } })).toThrow("safety invariants");
    expect(() => parseMemoryControlPolicy({ policy: { ...policy, defaultRetentionDays: 0 } })).toThrow("retention");
  });
});
