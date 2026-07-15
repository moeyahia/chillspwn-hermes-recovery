import type { MemoryNodeSummary } from "../domain/types/brain";
import { compactGraphLayout, layoutGraph } from "../features/brain/graphUtils";

interface LayoutRequest {
  requestId: number;
  nodes: MemoryNodeSummary[];
  width: number;
  height: number;
  compact: boolean;
}

self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const { requestId, nodes, width, height, compact } = event.data;
  const layout = layoutGraph(nodes, width, height);
  self.postMessage({ requestId, points: compact ? compactGraphLayout(layout, width, height) : layout });
};
