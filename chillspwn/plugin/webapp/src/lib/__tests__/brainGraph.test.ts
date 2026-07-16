import { describe, expect, test } from "bun:test";
import {
  MAX_PINNED_GRAPH_POSITIONS,
  brainGraphStateToQuery,
  brainGraphStateToUrl,
  parseBrainGraphState,
  parsePinnedGraphPositions,
  parseSavedBrainGraphViews,
  persistPinnedGraphPositions,
} from "../../features/brain/brainGraphState";
import { collapseGraphClusters, compactGraphLayout, layoutGraph, nodeCluster, relaxGraphLayout, shortestMemoryPath } from "../../features/brain/graphUtils";
import type { MemoryNodeSummary } from "../../domain/types/brain";

function node(id: string, nodeType: MemoryNodeSummary["nodeType"], edgeCount = 0): MemoryNodeSummary {
  return {
    id, nodeType, title: id, summary: "", scope: { kind: "global" }, sensitivity: "internal",
    confidence: 1, lifecycleStatus: "confirmed", confirmationState: "confirmed", version: 1,
    pinned: false, createdAt: "2026-07-15T00:00:00Z", updatedAt: "2026-07-15T00:00:00Z",
    edgeCount, sourceCount: 1,
  };
}

describe("Second Brain graph utilities", () => {
  test("uses stable semantic clusters and bounded deterministic positions", () => {
    const nodes = [node("operator", "operator"), node("mission", "mission"), node("finding", "finding", 12)];
    expect(nodeCluster(nodes[0]!)).toBe("operator");
    expect(nodeCluster(nodes[1]!)).toBe("mission");
    expect(nodeCluster(nodes[2]!)).toBe("evidence");
    const first = layoutGraph(nodes, 900, 600);
    const second = layoutGraph(nodes, 900, 600);
    expect(first).toEqual(second);
    expect(first.every((point) => point.x >= 24 && point.x <= 876 && point.y >= 24 && point.y <= 576)).toBe(true);
    expect(first[2]!.radius).toBeGreaterThan(first[0]!.radius);
  });

  test("finds the shortest explanatory path without assuming edge direction", () => {
    const edges = [
      { sourceNodeId: "operator", targetNodeId: "preference" },
      { sourceNodeId: "preference", targetNodeId: "mission" },
      { sourceNodeId: "mission", targetNodeId: "evidence" },
      { sourceNodeId: "operator", targetNodeId: "detour" },
    ];
    expect(shortestMemoryPath(edges, "operator", "evidence")).toEqual(["operator", "preference", "mission", "evidence"]);
    expect(shortestMemoryPath(edges, "evidence", "operator")).toEqual(["evidence", "mission", "preference", "operator"]);
    expect(shortestMemoryPath(edges, "operator", "missing")).toEqual([]);
  });

  test("normalizes shareable URL state into bounded canonical graph queries", () => {
    const state = parseBrainGraphState({
      view: "mission", mission: "mission-01", selected: "node-01", pathFrom: "node-origin", edgeType: "supports",
      scope: "engagement", engagement: "eng-01", lifecycle: "verified", confidence: "0.75",
      from: "2026-07-01", to: "2026-07-15", preset: "attack_path", labels: "all",
      layout: "compact", physics: "1", collapsed: "evidence,lesson,invalid", table: "1", limit: "9999",
    });
    expect(state).toMatchObject({
      view: "mission", missionId: "mission-01", selectedId: "node-01", pathFromId: "node-origin", edgeType: "supports",
      scope: "engagement", engagementId: "eng-01", lifecycle: "verified", minConfidence: 0.75,
      preset: "attack_path", labelDensity: "all", compact: true, physics: true, collapsedClusters: ["evidence", "lesson"], table: true, limit: 1000,
    });
    expect(brainGraphStateToQuery(state)).toMatchObject({
      view: "mission", missionId: "mission-01", edgeType: "supports", engagementId: "eng-01",
      minConfidence: 0.75, updatedAfter: "2026-07-01T00:00:00.000Z",
      updatedBefore: "2026-07-15T23:59:59.999Z", limit: 1000,
    });
    expect(brainGraphStateToUrl(state)).toMatchObject({ mission: "mission-01", pathFrom: "node-origin", labels: "all", layout: "compact", physics: "1", collapsed: "evidence,lesson", table: "1" });
    const presetWithLegacyRoot = parseBrainGraphState({ preset: "attack_path" }, "legacy-node");
    expect(presetWithLegacyRoot.view).toBe("global");
    expect(brainGraphStateToUrl({ ...presetWithLegacyRoot, view: "global" }).root).toBeUndefined();
  });

  test("rejects malformed URL and browser-saved view values without retaining hidden state", () => {
    expect(parseBrainGraphState({ view: "private-mode", root: "../secret", confidence: "4", from: "2026-02-30", labels: "noisy" })).toMatchObject({
      view: "global", rootNodeId: "", minConfidence: 0, updatedAfter: "", labelDensity: "balanced",
    });
    const saved = parseSavedBrainGraphViews(JSON.stringify([{
      id: "view-01", name: "Evidence path", createdAt: "2026-07-15T00:00:00Z", updatedAt: "2026-07-15T01:00:00Z",
      state: { view: "local", rootNodeId: "node-01", edgeType: "supports", labelDensity: "minimal", compact: true, limit: 500 },
    }, { id: "../bad", name: "Rejected", createdAt: "never", updatedAt: "never", state: {} }]));
    expect(saved).toHaveLength(1);
    expect(saved[0]!.state).toMatchObject({ view: "local", rootNodeId: "node-01", edgeType: "supports", labelDensity: "minimal", compact: true, limit: 500 });
  });

  test("compacts deterministic worker layout around the same viewport center", () => {
    const points = layoutGraph([node("one", "mission"), node("two", "lesson")], 800, 600);
    const compact = compactGraphLayout(points, 800, 600);
    expect(compact).toHaveLength(points.length);
    expect(Math.abs(compact[0]!.x - 400)).toBeLessThanOrEqual(Math.abs(points[0]!.x - 400));
    expect(Math.abs(compact[0]!.y - 300)).toBeLessThanOrEqual(Math.abs(points[0]!.y - 300));
  });

  test("relaxes linked nodes with a bounded deterministic one-shot physics layout", () => {
    const nodes = [node("one", "mission"), node("two", "evidence"), node("three", "lesson")];
    const initial = layoutGraph(nodes, 800, 600);
    const edges = [{ sourceNodeId: "one", targetNodeId: "two" }, { sourceNodeId: "two", targetNodeId: "three" }];
    const relaxed = relaxGraphLayout(initial, edges, 800, 600);
    expect(relaxed).toEqual(relaxGraphLayout(initial, edges, 800, 600));
    expect(relaxed).not.toEqual(initial);
    expect(relaxed.every((point) => point.x >= 24 && point.x <= 776 && point.y >= 24 && point.y <= 576)).toBe(true);
  });

  test("collapses real cluster members into deterministic canvas-only aggregates", () => {
    const nodes = [node("mission", "mission"), node("evidence-a", "evidence"), node("evidence-b", "finding")];
    const edge = (id: string, sourceNodeId: string, targetNodeId: string) => ({
      id, sourceNodeId, targetNodeId, edgeType: "supports" as const, title: "supports",
      summary: "Canonical support", confidence: 1, lifecycleStatus: "verified" as const,
      explanation: "Evidence supports the mission",
    });
    const collapsed = collapseGraphClusters(nodes, [
      edge("edge-a", "evidence-a", "mission"),
      edge("edge-b", "evidence-b", "mission"),
      edge("edge-internal", "evidence-a", "evidence-b"),
    ], new Set(["evidence"]));
    expect(collapsed.nodes.map((item) => item.id).sort()).toEqual(["cluster:evidence", "mission"]);
    expect(collapsed.nodes.find((item) => item.id === "cluster:evidence")?.summary).toContain("2 canonical memories");
    expect(collapsed.edges).toHaveLength(1);
    expect(collapsed.edges[0]).toMatchObject({ sourceNodeId: "cluster:evidence", targetNodeId: "mission", summary: "2 canonical supports relationships" });
  });

  test("restores only bounded, content-free pinned graph positions", () => {
    const parsed = parsePinnedGraphPositions(JSON.stringify({
      "node-01": { x: 123.456, y: -40.126, updatedAt: "2026-07-15T12:00:00.000Z" },
      "../escape": { x: 1, y: 2, updatedAt: "2026-07-15T12:00:00.000Z" },
      huge: { x: 9_000_000, y: 2, updatedAt: "2026-07-15T12:00:00.000Z" },
      stale: { x: 1, y: 2, updatedAt: "never" },
    }));
    expect(parsed).toEqual({
      "node-01": { x: 123.46, y: -40.13, updatedAt: "2026-07-15T12:00:00.000Z" },
    });
    expect(parsePinnedGraphPositions("not-json")).toEqual({});
  });

  test("prunes persisted positions by recency and survives quota or security failures", () => {
    const positions = Object.fromEntries(Array.from(
      { length: MAX_PINNED_GRAPH_POSITIONS + 2 },
      (_, index) => [
        `node-${String(index).padStart(4, "0")}`,
        {
          x: index,
          y: -index,
          updatedAt: new Date(Date.UTC(2026, 6, 15, 0, 0, index)).toISOString(),
        },
      ],
    ));
    let stored = "";
    const success = persistPinnedGraphPositions(
      { setItem: (_key, value) => { stored = value; } },
      "graph-positions",
      positions,
    );
    expect(success.persisted).toBe(true);
    expect(Object.keys(success.positions)).toHaveLength(MAX_PINNED_GRAPH_POSITIONS);
    expect(success.positions["node-0000"]).toBeUndefined();
    expect(success.positions[`node-${String(MAX_PINNED_GRAPH_POSITIONS + 1).padStart(4, "0")}`]).toBeDefined();
    expect(Object.keys(parsePinnedGraphPositions(stored))).toHaveLength(MAX_PINNED_GRAPH_POSITIONS);

    for (const exceptionName of ["QuotaExceededError", "SecurityError"]) {
      const failed = persistPinnedGraphPositions(
        { setItem: () => { throw new DOMException("Storage unavailable", exceptionName); } },
        "graph-positions",
        positions,
      );
      expect(failed.persisted).toBe(false);
      expect(Object.keys(failed.positions)).toHaveLength(MAX_PINNED_GRAPH_POSITIONS);
    }
  });
});
