import {
  MEMORY_EDGE_TYPES,
  MEMORY_LIFECYCLE_STATES,
  MEMORY_NODE_TYPES,
  MEMORY_SENSITIVITIES,
  type MemoryEdgeType,
  type MemoryGraphQuery,
  type MemoryGraphView,
  type MemoryLifecycle,
  type MemoryNodeType,
  type MemoryScope,
  type MemorySensitivity,
} from "../../domain/types/brain";

export const BRAIN_GRAPH_PRESETS = ["attack_path", "lessons_failures"] as const;
export const BRAIN_GRAPH_LABEL_DENSITIES = ["minimal", "balanced", "all"] as const;
export const BRAIN_GRAPH_URL_KEYS = [
  "view", "root", "mission", "selected", "search", "nodeType", "edgeType", "scope",
  "engagement", "lifecycle", "sensitivity", "confidence", "from", "to", "preset",
  "labels", "layout", "table", "limit",
] as const;

export type BrainGraphPreset = (typeof BRAIN_GRAPH_PRESETS)[number] | "";
export type BrainGraphLabelDensity = (typeof BRAIN_GRAPH_LABEL_DENSITIES)[number];

export interface BrainGraphState {
  view: MemoryGraphView;
  rootNodeId: string;
  missionId: string;
  selectedId: string;
  search: string;
  nodeType: MemoryNodeType | "";
  edgeType: MemoryEdgeType | "";
  scope: MemoryScope["kind"] | "";
  engagementId: string;
  lifecycle: MemoryLifecycle | "";
  sensitivity: MemorySensitivity | "";
  minConfidence: number;
  updatedAfter: string;
  updatedBefore: string;
  preset: BrainGraphPreset;
  labelDensity: BrainGraphLabelDensity;
  compact: boolean;
  table: boolean;
  limit: number;
}

export interface SavedBrainGraphView {
  id: string;
  name: string;
  state: BrainGraphState;
  createdAt: string;
  updatedAt: string;
}

const VIEWS: readonly MemoryGraphView[] = ["global", "local", "mission", "operator"];
const SCOPES: readonly MemoryScope["kind"][] = ["global", "engagement", "mission"];
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

function member<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === "string" && values.includes(value as T) ? value as T : fallback;
}

function boundedText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function identifier(value: unknown): string {
  const candidate = boundedText(value, 256);
  return IDENTIFIER.test(candidate) ? candidate : "";
}

function date(value: unknown): string {
  const candidate = boundedText(value, 10);
  if (!DATE.test(candidate)) return "";
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate ? candidate : "";
}

function confidence(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : 0;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? Math.round(parsed * 100) / 100 : 0;
}

function limit(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 250;
  if (!Number.isSafeInteger(parsed)) return 250;
  return Math.max(250, Math.min(1_000, Math.ceil(parsed / 250) * 250));
}

export function parseBrainGraphState(values: Readonly<Record<string, unknown>>, fallbackRoot = ""): BrainGraphState {
  const rootNodeId = identifier(values.root) || identifier(fallbackRoot);
  const preset = member(values.preset, BRAIN_GRAPH_PRESETS, "" as BrainGraphPreset);
  const requestedView = member(values.view, VIEWS, preset ? "global" : rootNodeId ? "local" : "global");
  const view = requestedView === "local" && !rootNodeId ? "global" : requestedView;
  return {
    view,
    rootNodeId,
    missionId: identifier(values.mission),
    selectedId: identifier(values.selected),
    search: boundedText(values.search, 240),
    nodeType: member(values.nodeType, MEMORY_NODE_TYPES, "" as MemoryNodeType | ""),
    edgeType: member(values.edgeType, MEMORY_EDGE_TYPES, "" as MemoryEdgeType | ""),
    scope: member(values.scope, SCOPES, "" as MemoryScope["kind"] | ""),
    engagementId: identifier(values.engagement),
    lifecycle: member(values.lifecycle, MEMORY_LIFECYCLE_STATES, "" as MemoryLifecycle | ""),
    sensitivity: member(values.sensitivity, MEMORY_SENSITIVITIES, "" as MemorySensitivity | ""),
    minConfidence: confidence(values.confidence),
    updatedAfter: date(values.from),
    updatedBefore: date(values.to),
    preset,
    labelDensity: member(values.labels, BRAIN_GRAPH_LABEL_DENSITIES, "balanced"),
    compact: values.layout === "compact" || values.layout === true,
    table: values.table === "1" || values.table === true,
    limit: limit(values.limit),
  };
}

export function brainGraphStateToUrl(state: BrainGraphState): Record<string, string | undefined> {
  return {
    view: state.view === "global" ? undefined : state.view,
    root: state.view === "local" ? state.rootNodeId || undefined : undefined,
    mission: state.missionId || undefined,
    selected: state.selectedId || undefined,
    search: state.search || undefined,
    nodeType: state.nodeType || undefined,
    edgeType: state.edgeType || undefined,
    scope: state.scope || undefined,
    engagement: state.engagementId || undefined,
    lifecycle: state.lifecycle || undefined,
    sensitivity: state.sensitivity || undefined,
    confidence: state.minConfidence > 0 ? String(state.minConfidence) : undefined,
    from: state.updatedAfter || undefined,
    to: state.updatedBefore || undefined,
    preset: state.preset || undefined,
    labels: state.labelDensity === "balanced" ? undefined : state.labelDensity,
    layout: state.compact ? "compact" : undefined,
    table: state.table ? "1" : undefined,
    limit: state.limit > 250 ? String(state.limit) : undefined,
  };
}

export function brainGraphStateToQuery(state: BrainGraphState): MemoryGraphQuery {
  const requestView = state.view === "mission" && !state.missionId ? "global" : state.view;
  return {
    view: requestView,
    ...(requestView === "local" && state.rootNodeId ? { nodeId: state.rootNodeId } : {}),
    ...(requestView === "mission" && state.missionId ? { missionId: state.missionId } : {}),
    depth: 2,
    limit: state.limit,
    ...(state.nodeType ? { nodeType: state.nodeType } : {}),
    ...(state.edgeType ? { edgeType: state.edgeType } : {}),
    ...(state.scope ? { scope: state.scope } : {}),
    ...(state.engagementId ? { engagementId: state.engagementId } : {}),
    ...(state.lifecycle ? { status: state.lifecycle } : {}),
    ...(state.sensitivity ? { sensitivity: state.sensitivity } : {}),
    ...(state.minConfidence > 0 ? { minConfidence: state.minConfidence } : {}),
    ...(state.updatedAfter ? { updatedAfter: `${state.updatedAfter}T00:00:00.000Z` } : {}),
    ...(state.updatedBefore ? { updatedBefore: `${state.updatedBefore}T23:59:59.999Z` } : {}),
    ...(state.preset ? { preset: state.preset } : {}),
  };
}

export function parseSavedBrainGraphViews(raw: string | null): SavedBrainGraphView[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 24).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const id = identifier(record.id);
      const name = boundedText(record.name, 80);
      const createdAt = boundedText(record.createdAt, 40);
      const updatedAt = boundedText(record.updatedAt, 40);
      if (!id || !name || !Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))) return [];
      const stored = record.state && typeof record.state === "object" ? record.state as Record<string, unknown> : {};
      const state = parseBrainGraphState({
        view: stored.view,
        root: stored.rootNodeId,
        mission: stored.missionId,
        selected: stored.selectedId,
        search: stored.search,
        nodeType: stored.nodeType,
        edgeType: stored.edgeType,
        scope: stored.scope,
        engagement: stored.engagementId,
        lifecycle: stored.lifecycle,
        sensitivity: stored.sensitivity,
        confidence: stored.minConfidence,
        from: stored.updatedAfter,
        to: stored.updatedBefore,
        preset: stored.preset,
        labels: stored.labelDensity,
        layout: stored.compact,
        table: stored.table,
        limit: stored.limit,
      });
      return [{ id, name, state, createdAt, updatedAt }];
    });
  } catch {
    return [];
  }
}
