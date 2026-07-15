import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import type { MemoryEdgeSummary, MemoryNodeSummary } from "../../domain/types/brain";
import type { BrainGraphLabelDensity } from "./brainGraphState";
import { compactGraphLayout, layoutGraph, relatedNodeIds, shortestMemoryPath, type GraphPoint } from "./graphUtils";

const CLUSTER_COLORS: Record<string, string> = {
  operator: "#b8f341", mission: "#61a5ff", attack: "#f3b64b", tool: "#a891ff",
  evidence: "#67d6c2", agent: "#f0f4f1", failure: "#ff667a", lesson: "#9ed972", other: "#8a9690",
};

interface Camera { x: number; y: number; zoom: number }

export function MemoryGraphCanvas({ nodes, edges, selectedId, rootNodeId, onSelect, compact, labelDensity }: {
  nodes: MemoryNodeSummary[];
  edges: MemoryEdgeSummary[];
  selectedId?: string;
  rootNodeId?: string;
  onSelect: (nodeId?: string) => void;
  compact: boolean;
  labelDensity: BrainGraphLabelDensity;
}) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 900, height: 600 });
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [hovered, setHovered] = useState<string>();
  const [points, setPoints] = useState<GraphPoint[]>([]);
  const [layoutPending, setLayoutPending] = useState(false);
  const layoutRequest = useRef(0);
  const drag = useRef<{ x: number; y: number; cameraX: number; cameraY: number; moved: boolean } | undefined>(undefined);
  const pointMap = useMemo(() => new Map(points.map((point) => [point.id, point])), [points]);
  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const related = useMemo(() => relatedNodeIds(edges, selectedId), [edges, selectedId]);
  const path = useMemo(() => rootNodeId && selectedId ? shortestMemoryPath(edges, rootNodeId, selectedId) : [], [edges, rootNodeId, selectedId]);
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
    if (typeof Worker === "undefined") {
      const layout = layoutGraph(nodes, size.width, size.height);
      setPoints(compact ? compactGraphLayout(layout, size.width, size.height) : layout);
      setLayoutPending(false);
      return;
    }
    const worker = new Worker(new URL("../../workers/memoryGraphLayout.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ requestId: number; points: GraphPoint[] }>) => {
      if (event.data.requestId !== requestId || requestId !== layoutRequest.current) return;
      setPoints(event.data.points);
      setLayoutPending(false);
      worker.terminate();
    };
    worker.onerror = () => {
      if (requestId !== layoutRequest.current) return;
      const layout = layoutGraph(nodes, size.width, size.height);
      setPoints(compact ? compactGraphLayout(layout, size.width, size.height) : layout);
      setLayoutPending(false);
      worker.terminate();
    };
    worker.postMessage({ requestId, nodes, width: size.width, height: size.height, compact });
    return () => worker.terminate();
  }, [compact, nodes, size.height, size.width]);

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

    edges.forEach((edge) => {
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
      if (node.pinned) {
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
  }, [camera, edges, hovered, labelDensity, nodeMap, pathEdges, pointMap, points, related, selectedId, size]);

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
    drag.current = { x: event.clientX, y: event.clientY, cameraX: camera.x, cameraY: camera.y, moved: false };
  };
  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const current = drag.current;
    if (current) {
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) current.moved = true;
      setCamera((value) => ({ ...value, x: current.cameraX + dx, y: current.cameraY + dy }));
    } else setHovered(hit(event.clientX, event.clientY));
  };
  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current?.moved) onSelect(hit(event.clientX, event.clientY));
    drag.current = undefined;
  };
  const handleWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const next = Math.max(0.45, Math.min(2.8, camera.zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
    setCamera((value) => ({ ...value, zoom: next }));
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (event.key === "Escape") { onSelect(undefined); return; }
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Enter"].includes(event.key) || nodes.length === 0) return;
    event.preventDefault();
    if (event.key === "Enter" && selectedId) return;
    const current = nodes.findIndex((node) => node.id === selectedId);
    const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    onSelect(nodes[(current + delta + nodes.length) % nodes.length]!.id);
  };

  return (
    <div ref={host} className="brain-canvas-host">
      <canvas ref={canvas} tabIndex={0} role="application" aria-busy={layoutPending} aria-label={`Memory graph with ${nodes.length} nodes and ${edges.length} relationships. Use arrow keys to select nodes, Escape to clear, mouse wheel to zoom, and drag to pan.`} onKeyDown={handleKeyDown} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerLeave={() => { drag.current = undefined; setHovered(undefined); }} onWheel={handleWheel} />
      <div className="brain-canvas-controls" aria-label="Graph viewport controls"><button onClick={() => setCamera((value) => ({ ...value, zoom: Math.min(2.8, value.zoom * 1.2) }))} aria-label="Zoom in">+</button><button onClick={() => setCamera((value) => ({ ...value, zoom: Math.max(0.45, value.zoom / 1.2) }))} aria-label="Zoom out">−</button><button onClick={() => setCamera({ x: 0, y: 0, zoom: 1 })}>Fit</button></div>
      <p className="os-visually-hidden" aria-live="polite">{selectedId ? `Selected ${nodes.find((node) => node.id === selectedId)?.title ?? selectedId}` : "No graph node selected"}</p>
      <p className="os-visually-hidden" role="status" aria-live="polite">{layoutPending ? "Calculating memory graph layout" : "Memory graph layout ready"}</p>
    </div>
  );
}
