import { performance } from "node:perf_hooks";
import type { MemoryNodeSummary } from "../../src/domain/types/brain";
import { compactGraphLayout, layoutGraph } from "../../src/features/brain/graphUtils";

function nodes(count: number): MemoryNodeSummary[] {
  const types: MemoryNodeSummary["nodeType"][] = ["mission", "technique", "tool", "evidence", "failure", "lesson", "agent"];
  return Array.from({ length: count }, (_, index) => ({
    id: `benchmark-node-${index}`,
    nodeType: types[index % types.length]!,
    title: `Benchmark node ${index}`,
    summary: "Synthetic performance fixture; never used as product data.",
    scope: { kind: "global" },
    sensitivity: "internal",
    confidence: 0.9,
    lifecycleStatus: "verified",
    confirmationState: "not_required",
    version: 1,
    pinned: index % 997 === 0,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    edgeCount: index % 32,
    sourceCount: 1,
  }));
}

function measure(count: number) {
  const fixture = nodes(count);
  const start = performance.now();
  const layout = layoutGraph(fixture, 1600, 900);
  const compact = compactGraphLayout(layout, 1600, 900);
  const durationMs = performance.now() - start;
  if (layout.length !== count || compact.length !== count) throw new Error("graph layout dropped nodes");
  return { count, durationMs: Math.round(durationMs * 100) / 100 };
}

const activeNeighborhood = measure(1_000);
const largeVaultCalculation = measure(50_000);
const result = {
  schemaVersion: 1,
  measuredAt: new Date().toISOString(),
  note: "Production graph requests remain bounded to 1,000 nodes; the 50,000-node calculation verifies linear layout behavior before worker cancellation and progressive loading.",
  activeNeighborhood,
  largeVaultCalculation,
  budgets: { activeNeighborhoodMs: 200, largeVaultCalculationMs: 1_500 },
};

if (activeNeighborhood.durationMs > result.budgets.activeNeighborhoodMs || largeVaultCalculation.durationMs > result.budgets.largeVaultCalculationMs) {
  throw new Error(`Second Brain graph layout budget exceeded: ${JSON.stringify(result)}`);
}

console.log(JSON.stringify({ ...result, passed: true }, null, 2));
