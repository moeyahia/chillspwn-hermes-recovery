import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import type { MemoryEdgeSummary, MemoryNodeSummary } from "../../domain/types/brain";
import type { BrainGraphLabelDensity, PinnedGraphPositions } from "./brainGraphState";
import { collapseGraphClusters, compactGraphLayout, layoutGraph, relatedNodeIds, relaxGraphLayout, shortestMemoryPath, type GraphCluster, type GraphPoint } from "./graphUtils";

const CLUSTER_COLORS: Record<string, string> = {
  operator: "#b8f341", mission: "#61a5ff", attack: "#f3b64b", tool: "#a891ff",
  evidence: "#67d6c2", agent: "#f0f4f1", failure: "#ff667a", lesson: "#9ed972", other: "#8a9690",
};

interface Camera { x: number; y: number; zoom: number }

export function MemoryGraphCanvas({
  nodes, edges, selectedId, rootNodeId, pathStartNodeId, onSelect, compact, physics, labelDensity,
  collapsedClusters = [], pinnedPositions = {}, onPinPosition, onClearPinnedPositions, onExpandCluster,
}: {
  nodes: MemoryNodeSummary[];
  edges: MemoryEdgeSummary[];
  selectedId?: string;
  rootNodeId?: string;
  pathStartNodeId?: string;
  onSelect: (nodeId?: string) => void;
  compact: boolean;
  physics: boolean;
  labelDensity: BrainGraphLabelDensity;
  collapsedClusters?: readonly GraphCluster[];
  pinnedPositions?: PinnedGraphPositions;
  onPinPosition?: (nodeId: string, point: { x: number; y: number }) => void;
  onClearPinnedPositions?: (nodeIds: readonly string[]) => void;
  onExpandCluster?: (cluster: GraphCluster) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 900, height: 600 });
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [hovered, setHovered] = useState<string>();
  const [points, setPoints] = useState<GraphPoint[]>([]);
  const [layoutPending, setLayoutPending] = useState(false);
  const layoutRequest = useRef(0);
  const panDrag = useRef<{ x: number; y: number; cameraX: number; cameraY: number; moved: boolean } | undefined>(undefined);
  const nodeDrag = useRef<{ id: string; offsetX: number; offsetY: number; x: number; y: number; moved: boolean } | undefined>(undefined);
  const projection = useMemo(() => collapseGraphClusters(nodes, edges, new Set(collapsedClusters)), [collapsedClusters, edges, nodes]);
  const displayNodes = projection.nodes;
  const displayEdges = projection.edges;
  const pointMap = useMemo(() => new Map(points.map((point) => [point.id, point])), [points]);
  const nodeMap = useMemo(() => new Map(displayNodes.map((node) => [node.id, node])), [displayNodes]);
  const related = useMemo(() => relatedNodeIds(displayEdges, selectedId), [displayEdges, selectedId]);
  const pathOrigin = pathStartNodeId ?? rootNodeId;
  const path = useMemo(() => pathOrigin && selectedId ? shortestMemoryPath(displayEdges, pathOrigin, selectedId) : [], [displayEdges, pathOrigin, selectedId]);
  const pathEdges = useMemo(() => new Set(path.slice(1).map((id, index) => [path[index], id].sort().join("|"))), [path]);

  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSize({ width: Math.max(320, Math.floor(entry.contentRect.width)), height: Math.max(420, Math.floor(entry.contentRect.height)) });
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const requestId = ++layoutRequest.current;
    setLayoutPending(true);
    const withPinned = (layout: GraphPoint[]) => layout.map((point) => {
      const pinned = pinnedPositions[point.id];
      return pinned ? { ...point, x: pinned.x, y: pinned.y } : point;
    });
    if (typeof Worker === "undefined") {
      const initial = layoutGraph(displayNodes, size.width, size.height);
      const layout = physics ? relaxGraphLayout(initial, displayEdges, size.width, size.height) : initial;
      setPoints(withPinned(compact ? compactGraphLayout(layout, size.width, size.height) : layout));
      setLayoutPending(false);
      return;
    }
    const worker = new Worker(new URL("../../workers/memoryGraphLayout.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ requestId: number; points: GraphPoint[] }>) => {
      if (event.data.requestId !== requestId || requestId !== layoutRequest.current) return;
      setPoints(withPinned(event.data.points));
      setLayoutPending(false);
      worker.terminate();
    };
    worker.onerror = () => {
      if (requestId !== layoutRequest.current) return;
      const initial = layoutGraph(displayNodes, size.width, size.height);
      const layout = physics ? relaxGraphLayout(initial, displayEdges, size.width, size.height) : initial;
      setPoints(withPinned(compact ? compactGraphLayout(layout, size.width, size.height) : layout));
      setLayoutPending(false);
      worker.terminate();
    };
    worker.postMessage({ requestId, nodes: displayNodes, edges: displayEdges, width: size.width, height: size.height, compact, physics });
    return () => worker.terminate();
  }, [compact, displayEdges, displayNodes, physics, pinnedPositions, size.height, size.width]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    element.width = Math.floor(size.width * ratio);
    element.height = Math.floor(size.height * ratio);
    element.style.width = `${size.width}px`;
    element.style.height = `${size.height}px`;
    const context = element.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    context.fillStyle = "#090d0f";
    context.fillRect(0, 0, size.width, size.height);
    context.save();
    context.translate(camera.x, camera.y);
    context.scale(camera.zoom, camera.zoom);

    displayEdges.forEach((edge) => {
      const source = pointMap.get(edge.sourceNodeId);
      const target = pointMap.get(edge.targetNodeId);
      if (!source || !target) return;
      const key = [edge.sourceNodeId, edge.targetNodeId].sort().join("|");
      const inPath = pathEdges.has(key);
      const connected = related.has(edge.sourceNodeId) && related.has(edge.targetNodeId);
      context.beginPath();
      context.moveTo(source.x, source.y);
      context.lineTo(target.x, target.y);
      context.lineWidth = (inPath ? 2 : connected ? 1.3 : 0.65) / camera.zoom;
      context.strokeStyle = inPath ? "rgba(184,243,65,.95)" : connected ? "rgba(240,244,241,.44)" : "rgba(240,244,241,.10)";
      context.stroke();
    });

    points.forEach((point) => {
      const node = nodeMap.get(point.id);
      if (!node) return;
      const selected = point.id === selectedId;
      const dimmed = selectedId && !related.has(point.id);
      const color = CLUSTER_COLORS[point.cluster] ?? CLUSTER_COLORS.other;
      context.globalAlpha = dimmed ? 0.18 : 1;
      context.beginPath();
      if (["evidence", "failure"].includes(point.cluster)) {
        context.rect(point.x - point.radius, point.y - point.radius, point.radius * 2, point.radius * 2);
      } else if (point.cluster === "attack") {
        context.moveTo(point.x, point.y - point.radius * 1.2);
        context.lineTo(point.x + point.radius * 1.2, point.y);
        context.lineTo(point.x, point.y + point.radius * 1.2);
        context.lineTo(point.x - point.radius * 1.2, point.y);
        context.closePath();
      } else {
        context.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
      }
      context.fillStyle = color;
      context.fill();
      context.lineWidth = (selected ? 3 : node.lifecycleStatus === "disputed" ? 2 : 1) / camera.zoom;
      context.strokeStyle = selected ? "#ffffff" : node.lifecycleStatus === "disputed" ? "#ff667a" : "rgba(8,11,13,.8)";
      context.stroke();
      if (node.pinned || pinnedPositions[point.id]) {
        context.beginPath();
        context.arc(point.x, point.y, point.radius + 4 / camera.zoom, 0, Math.PI * 2);
        context.strokeStyle = "rgba(184,243,65,.7)";
        context.lineWidth = 1 / camera.zoom;
        context.stroke();
      }
      const showLabel = labelDensity === "all"
        || selected
        || hovered === point.id
        || (labelDensity === "balanced" && (camera.zoom >= 1.15 || node.edgeCount >= 8));
      if (showLabel) {
        context.font = `${selected ? 600 : 500} ${Math.max(9, 11 / camera.zoom)}px Inter, system-ui, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "top";
        context.fillStyle = selected ? "#f0f4f1" : "rgba(240,244,241,.74)";
        const label = node.title.length > 30 ? `${node.title.slice(0, 29)}…` : node.title;
        context.fillText(label, point.x, point.y + point.radius + 7 / camera.zoom);
      }
      context.globalAlpha = 1;
    });
    context.restore();
  }, [camera, displayEdges, hovered, labelDensity, nodeMap, pathEdges, pinnedPositions, pointMap, points, related, selectedId, size]);

  const selectNode = (nodeId?: string) => {
    if (nodeId?.startsWith("cluster:")) {
      onExpandCluster?.(nodeId.slice("cluster:".length) as GraphCluster);
      return;
    }
    onSelect(nodeId);
  };

  const screenToWorld = (clientX: number, clientY: number) => {
    const rect = canvas.current!.getBoundingClientRect();
    return { x: (clientX - rect.left - camera.x) / camera.zoom, y: (clientY - rect.top - camera.y) / camera.zoom };
  };
  const hit = (clientX: number, clientY: number): string | undefined => {
    const cursor = screenToWorld(clientX, clientY);
    return [...points].reverse().find((point) => Math.hypot(cursor.x - point.x, cursor.y - point.y) <= Math.max(12 / camera.zoom, point.radius + 4))?.id;
  };
  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const nodeId = hit(event.clientX, event.clientY);
    if (nodeId) {
      if (nodeId.startsWith("cluster:")) {
        selectNode(nodeId);
        return;
      }
      const cursor = screenToWorld(event.clientX, event.clientY);
      const point = pointMap.get(nodeId)!;
      nodeDrag.current = { id: nodeId, offsetX: cursor.x - point.x, offsetY: cursor.y - point.y, x: point.x, y: point.y, moved: false };
      selectNode(nodeId);
      return;
    }
    panDrag.current = { x: event.clientX, y: event.clientY, cameraX: camera.x, cameraY: camera.y, moved: false };
  };
  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const movingNode = nodeDrag.current;
    if (movingNode) {
      const cursor = screenToWorld(event.clientX, event.clientY);
      const next = { x: cursor.x - movingNode.offsetX, y: cursor.y - movingNode.offsetY };
      const previous = pointMap.get(movingNode.id);
      if (previous && Math.hypot(next.x - previous.x, next.y - previous.y) > 1) movingNode.moved = true;
      movingNode.x = next.x;
      movingNode.y = next.y;
      setPoints((current) => current.map((point) => point.id === movingNode.id ? { ...point, ...next } : point));
      return;
    }
    const current = panDrag.current;
    if (current) {
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) current.moved = true;
      setCamera((value) => ({ ...value, x: current.cameraX + dx, y: current.cameraY + dy }));
    } else setHovered(hit(event.clientX, event.clientY));
  };
  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    if (nodeDrag.current) {
      const moving = nodeDrag.current;
      if (moving.moved) onPinPosition?.(moving.id, { x: moving.x, y: moving.y });
      nodeDrag.current = undefined;
      return;
    }
    if (!panDrag.current?.moved) selectNode(hit(event.clientX, event.clientY));
    panDrag.current = undefined;
  };
  const handleWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const next = Math.max(0.45, Math.min(2.8, camera.zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
    setCamera((value) => ({ ...value, zoom: next }));
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (event.key === "Escape") { selectNode(undefined); return; }
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Enter"].includes(event.key) || displayNodes.length === 0) return;
    event.preventDefault();
    if (event.key === "Enter" && selectedId) return;
    const current = displayNodes.findIndex((node) => node.id === selectedId);
    const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    selectNode(displayNodes[(current + delta + displayNodes.length) % displayNodes.length]!.id);
  };

  return (
    <div ref={host} className="brain-canvas-host">
      <canvas ref={canvas} tabIndex={0} role="application" aria-busy={layoutPending} aria-label={`Memory graph with ${displayNodes.length} nodes and ${displayEdges.length} relationships in the visible projection. Use arrow keys to select nodes, Escape to clear, mouse wheel to zoom, drag empty space to pan, and drag a node to persist its position. Selecting a collapsed cluster expands it.`} onKeyDown={handleKeyDown} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerLeave={() => { panDrag.current = undefined; nodeDrag.current = undefined; setHovered(undefined); }} onWheel={handleWheel} />
      <div className="brain-canvas-controls" aria-label="Graph viewport controls"><button onClick={() => setCamera((value) => ({ ...value, zoom: Math.min(2.8, value.zoom * 1.2) }))} aria-label="Zoom in">+</button><button onClick={() => setCamera((value) => ({ ...value, zoom: Math.max(0.45, value.zoom / 1.2) }))} aria-label="Zoom out">−</button><button onClick={() => setCamera({ x: 0, y: 0, zoom: 1 })}>Fit</button>{onClearPinnedPositions && <button onClick={() => onClearPinnedPositions(nodes.map((node) => node.id))}>Reset layout</button>}</div>
      <p className="os-visually-hidden" aria-live="polite">{selectedId ? `Selected ${displayNodes.find((node) => node.id === selectedId)?.title ?? selectedId}` : "No graph node selected"}</p>
      <p className="os-visually-hidden" aria-live="polite">{pathStartNodeId && selectedId ? path.length > 0 ? `Shortest memory path contains ${path.length} nodes` : "No path connects the selected memories in this bounded view" : "No arbitrary memory path selected"}</p>
      <p className="os-visually-hidden" role="status" aria-live="polite">{layoutPending ? "Calculating memory graph layout" : "Memory graph layout ready"}</p>
    </div>
  );
}
