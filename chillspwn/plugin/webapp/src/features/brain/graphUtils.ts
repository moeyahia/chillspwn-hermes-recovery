import type { MemoryEdgeSummary, MemoryNodeSummary } from "../../domain/types/brain";

export interface GraphPoint {
  id: string;
  x: number;
  y: number;
  radius: number;
  cluster: string;
}

const CLUSTER_ORDER = ["operator", "mission", "attack", "tool", "evidence", "agent", "failure", "lesson", "other"];

export function nodeCluster(node: Pick<MemoryNodeSummary, "nodeType">): string {
  if (node.nodeType === "operator" || node.nodeType === "preference") return "operator";
  if (["mission", "run", "plan", "phase", "step", "target", "asset", "entity", "decision"].includes(node.nodeType)) return "mission";
  if (["tactic", "technique", "procedure"].includes(node.nodeType)) return "attack";
  if (node.nodeType === "tool" || node.nodeType === "mcp_capability") return "tool";
  if (["evidence", "finding", "artifact", "report", "source"].includes(node.nodeType)) return "evidence";
  if (node.nodeType === "agent") return "agent";
  if (node.nodeType === "failure" || node.nodeType === "recovery") return "failure";
  if (node.nodeType === "lesson" || node.nodeType === "evaluation") return "lesson";
  return "other";
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

export function layoutGraph(nodes: readonly MemoryNodeSummary[], width: number, height: number): GraphPoint[] {
  const safeWidth = Math.max(320, width);
  const safeHeight = Math.max(260, height);
  const counts = new Map<string, number>();
  return nodes.map((node) => {
    const cluster = nodeCluster(node);
    const index = counts.get(cluster) ?? 0;
    counts.set(cluster, index + 1);
    const clusterIndex = Math.max(0, CLUSTER_ORDER.indexOf(cluster));
    const clusterAngle = (clusterIndex / CLUSTER_ORDER.length) * Math.PI * 2 - Math.PI / 2;
    const centerRadius = Math.min(safeWidth, safeHeight) * 0.28;
    const centerX = safeWidth / 2 + Math.cos(clusterAngle) * centerRadius;
    const centerY = safeHeight / 2 + Math.sin(clusterAngle) * centerRadius;
    const seed = hash(node.id);
    const ring = Math.floor(index / 8) + 1;
    const angle = ((seed % 360) / 180) * Math.PI + (index % 8) * (Math.PI / 4);
    const spread = 18 + ring * 23 + (seed % 13);
    return {
      id: node.id,
      x: Math.max(24, Math.min(safeWidth - 24, centerX + Math.cos(angle) * spread)),
      y: Math.max(24, Math.min(safeHeight - 24, centerY + Math.sin(angle) * spread)),
      radius: Math.max(5, Math.min(15, 5 + Math.sqrt(Math.max(0, node.edgeCount)) * 1.8 + (node.pinned ? 2 : 0))),
      cluster,
    };
  });
}

export function compactGraphLayout(points: readonly GraphPoint[], width: number, height: number): GraphPoint[] {
  return points.map((point) => ({
    ...point,
    x: width / 2 + (point.x - width / 2) * 0.7,
    y: height / 2 + (point.y - height / 2) * 0.7,
  }));
}

export function shortestMemoryPath(
  edges: readonly Pick<MemoryEdgeSummary, "sourceNodeId" | "targetNodeId">[],
  from: string,
  to: string,
): string[] {
  if (from === to) return [from];
  const adjacency = new Map<string, string[]>();
  edges.forEach((edge) => {
    adjacency.set(edge.sourceNodeId, [...(adjacency.get(edge.sourceNodeId) ?? []), edge.targetNodeId]);
    adjacency.set(edge.targetNodeId, [...(adjacency.get(edge.targetNodeId) ?? []), edge.sourceNodeId]);
  });
  const queue = [from];
  const previous = new Map<string, string | null>([[from, null]]);
  while (queue.length) {
    const current = queue.shift()!;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (previous.has(neighbor)) continue;
      previous.set(neighbor, current);
      if (neighbor === to) {
        const path = [to];
        let cursor: string | null = current;
        while (cursor) {
          path.push(cursor);
          cursor = previous.get(cursor) ?? null;
        }
        return path.reverse();
      }
      queue.push(neighbor);
    }
  }
  return [];
}

export function relatedNodeIds(edges: readonly MemoryEdgeSummary[], nodeId?: string): Set<string> {
  if (!nodeId) return new Set();
  const ids = new Set([nodeId]);
  edges.forEach((edge) => {
    if (edge.sourceNodeId === nodeId) ids.add(edge.targetNodeId);
    if (edge.targetNodeId === nodeId) ids.add(edge.sourceNodeId);
  });
  return ids;
}
