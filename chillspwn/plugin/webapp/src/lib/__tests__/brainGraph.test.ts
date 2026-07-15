import { describe, expect, test } from "bun:test";
import { brainGraphStateToQuery, brainGraphStateToUrl, parseBrainGraphState, parseSavedBrainGraphViews } from "../../features/brain/brainGraphState";
import { compactGraphLayout, layoutGraph, nodeCluster, shortestMemoryPath } from "../../features/brain/graphUtils";
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
      view: "mission", mission: "mission-01", selected: "node-01", edgeType: "supports",
      scope: "engagement", engagement: "eng-01", lifecycle: "verified", confidence: "0.75",
      from: "2026-07-01", to: "2026-07-15", preset: "attack_path", labels: "all",
      layout: "compact", table: "1", limit: "9999",
    });
    expect(state).toMatchObject({
      view: "mission", missionId: "mission-01", selectedId: "node-01", edgeType: "supports",
      scope: "engagement", engagementId: "eng-01", lifecycle: "verified", minConfidence: 0.75,
      preset: "attack_path", labelDensity: "all", compact: true, table: true, limit: 1000,
    });
    expect(brainGraphStateToQuery(state)).toMatchObject({
      view: "mission", missionId: "mission-01", edgeType: "supports", engagementId: "eng-01",
      minConfidence: 0.75, updatedAfter: "2026-07-01T00:00:00.000Z",
      updatedBefore: "2026-07-15T23:59:59.999Z", limit: 1000,
    });
    expect(brainGraphStateToUrl(state)).toMatchObject({ mission: "mission-01", labels: "all", layout: "compact", table: "1" });
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
});
