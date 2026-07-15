import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { basename, relative } from "node:path";
import { Router, type Request, type Response } from "express";
import type { SqliteDatabase } from "../db/types";
import { getDatabaseHealth } from "../db/health";
import { inImmediateTransaction } from "../db/transaction";
import { MemoryRepository } from "./MemoryRepository";
import { ReusableMemorySafetyError } from "./ReusableMemorySafety";
import { SecondBrainService } from "./SecondBrainService";
import type {
  MemoryCandidate,
  CorrectMemoryNodeInput,
  MemoryEdge,
  MemoryEdgeType,
  MemoryLifecycle,
  MemoryNode,
  MemoryNodeType,
  MemoryScope,
  MemorySensitivity,
} from "./types";
import {
  assertIdentifier,
  deserializeScope,
  validateConfidence,
  validateEdgeType,
  validateLifecycle,
  validateNodeType,
  validateScope,
  validateSensitivity,
} from "./validation";
import { ObsidianVaultBridge } from "../vault/ObsidianVaultBridge";
import { VaultPathPolicy } from "../vault/VaultPathPolicy";
import { parseObsidianNote } from "../vault/ObsidianMarkdown";
import {
  getMemoryControlPolicy,
  memoryCandidateAllowed,
  updateMemoryControlPolicy,
} from "./MemoryControlPolicy";

const SCHEMA_VERSION = "2.1" as const;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,200}$/u;
const STATUS_FILTERS = new Set<MemoryLifecycle>([
  "candidate", "confirmed", "verified", "disputed", "stale", "superseded", "forgotten",
]);
const SENSITIVITY_ORDER: readonly MemorySensitivity[] = [
  "public", "internal", "private", "restricted",
];
const GRAPH_PRESETS = {
  attack_path: {
    nodeTypes: ["mission", "run", "plan", "phase", "step", "tool", "mcp_capability", "tactic", "technique", "procedure", "target", "asset", "decision", "evidence", "finding", "failure", "recovery"] as readonly MemoryNodeType[],
    edgeTypes: ["applies_to", "belongs_to", "used_in", "targets", "produced", "supports", "depends_on", "failed_in", "recovered_by", "influenced"] as readonly MemoryEdgeType[],
  },
  lessons_failures: {
    nodeTypes: ["mission", "run", "failure", "recovery", "evaluation", "lesson", "evidence", "finding", "source"] as readonly MemoryNodeType[],
    edgeTypes: ["used_in", "supports", "contradicts", "derived_from", "learned_from", "failed_in", "recovered_by", "similar_to", "supersedes", "verified_by", "influenced"] as readonly MemoryEdgeType[],
  },
} as const;

type GraphPreset = keyof typeof GRAPH_PRESETS;

interface GraphFilters {
  readonly nodeType?: MemoryNodeType;
  readonly edgeTypes?: readonly MemoryEdgeType[];
  readonly scope?: MemoryScope["kind"];
  readonly engagementId?: string;
  readonly lifecycle?: MemoryLifecycle;
  readonly sensitivity?: MemorySensitivity;
  readonly minConfidence?: number;
  readonly updatedAfter?: string;
  readonly updatedBefore?: string;
  readonly preset?: GraphPreset;
}

export interface MemoryAccessPolicy {
  readonly maximumSensitivity: MemorySensitivity;
  readonly allowGlobal?: boolean;
  readonly allEngagements?: boolean;
  readonly engagementIds?: readonly string[];
  readonly missionIds?: readonly string[];
}

export interface SecondBrainRouterDependencies {
  readonly database: SqliteDatabase;
  readonly resolveActor: (request: Request) => string;
  readonly resolveAccess: (request: Request, actorId: string) => MemoryAccessPolicy;
  /** Server-owned sandbox. Client paths can never expand this root. */
  readonly vaultAllowedRoot?: string;
  readonly vaultPathPolicy?: VaultPathPolicy;
  readonly vaultBridge?: ObsidianVaultBridge;
  readonly onVaultConnectionChanged?: () => void;
}

interface NodeSummary {
  readonly id: string;
  readonly nodeType: MemoryNodeType;
  readonly title: string;
  readonly summary: string;
  readonly scope: MemoryScope;
  readonly sensitivity: MemorySensitivity;
  readonly confidence: number;
  readonly lifecycleStatus: MemoryLifecycle;
  readonly confirmationState: MemoryNode["confirmationState"];
  readonly version: number;
  readonly pinned: boolean;
  readonly expiresAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly edgeCount: number;
  readonly sourceCount: number;
}

interface NodeSummaryRow {
  readonly id: string;
  readonly node_type: MemoryNodeType;
  readonly title: string;
  readonly summary: string;
  readonly scope: string;
  readonly engagement_id: string | null;
  readonly mission_id: string | null;
  readonly sensitivity: MemorySensitivity;
  readonly confidence: number;
  readonly lifecycle_status: MemoryLifecycle;
  readonly confirmation_state: MemoryNode["confirmationState"];
  readonly version: number;
  readonly pinned: number;
  readonly expires_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly edge_count: number;
  readonly source_count: number;
}

interface Cursor {
  readonly updatedAt: string;
  readonly id: string;
}

class BrainApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly category: string,
    readonly remediation?: string,
  ) {
    super(message);
    this.name = "BrainApiError";
  }
}

function traceId(request: Request): string {
  const supplied = request.get("X-Request-ID")?.trim();
  return supplied && /^[A-Za-z0-9._:-]{1,128}$/u.test(supplied) ? supplied : randomUUID();
}

function sendError(response: Response, error: unknown, id: string): void {
  const normalized = normalizeError(error);
  response.status(normalized.status).json({
    error: {
      code: normalized.code,
      message: normalized.message,
      humanMessage: normalized.message,
      retryable: normalized.status >= 500,
      category: normalized.category,
      traceId: id,
      ...(normalized.remediation ? { remediation: normalized.remediation } : {}),
      timestamp: new Date().toISOString(),
    },
  });
}

function normalizeError(error: unknown): BrainApiError {
  if (error instanceof BrainApiError) return error;
  if (error instanceof ReusableMemorySafetyError) {
    return new BrainApiError(
      error.status,
      error.code,
      error.humanMessage,
      error.category,
      error.remediation,
    );
  }
  const message = error instanceof Error ? error.message : "Second Brain request failed";
  if (/not found|does not exist/iu.test(message)) {
    return new BrainApiError(404, "brain_resource_not_found", message, "not_found");
  }
  if (/only pending|conflict|version does not match|already/iu.test(message)) {
    return new BrainApiError(409, "brain_state_conflict", message, "conflict", "Refresh the record and retry against its current version.");
  }
  if (/cross-engagement|outside.*scope|not permitted|path escapes|path traversal|symbolic links/iu.test(message)) {
    return new BrainApiError(403, "memory_scope_denied", message, "policy_denied");
  }
  if (error instanceof TypeError || error instanceof RangeError || /invalid|required|must /iu.test(message)) {
    return new BrainApiError(400, "invalid_brain_request", message, "invalid_input");
  }
  return new BrainApiError(
    500,
    "second_brain_internal_error",
    "Second Brain could not complete the request",
    "internal",
    "Use the trace ID to inspect structured logs before retrying.",
  );
}

function object(value: unknown, label = "request body"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string, maximum = 4_000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new TypeError(`${label} must contain 1-${maximum} characters`);
  }
  return value.trim();
}

function optionalText(value: unknown, label: string, maximum = 4_000): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredText(value, label, maximum);
}

function integer(value: unknown, fallback: number, minimum: number, maximum: number, label: string): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || Number(parsed) < minimum || Number(parsed) > maximum) {
    throw new RangeError(`${label} must be between ${minimum} and ${maximum}`);
  }
  return Number(parsed);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function validatedIdempotencyKey(request: Request): string {
  const value = request.get("Idempotency-Key")?.trim();
  if (!value || !IDEMPOTENCY_KEY.test(value)) {
    throw new BrainApiError(
      400,
      "idempotency_key_required",
      "A valid Idempotency-Key header is required for this memory mutation",
      "invalid_input",
      "Send a stable 8-200 character key and reuse it only for an identical request.",
    );
  }
  return value;
}

function actorAndAccess(
  request: Request,
  dependencies: SecondBrainRouterDependencies,
): { actor: string; access: MemoryAccessPolicy } {
  const actor = dependencies.resolveActor(request).trim();
  if (!actor) {
    throw new BrainApiError(401, "operator_identity_required", "An authenticated operator identity is required", "authentication_missing");
  }
  const access = dependencies.resolveAccess(request, actor);
  validateSensitivity(access.maximumSensitivity);
  for (const id of [...(access.engagementIds ?? []), ...(access.missionIds ?? [])]) {
    assertIdentifier(id, "memory access identifier");
  }
  return { actor, access };
}

function accessSql(alias: string, access: MemoryAccessPolicy): { sql: string; params: unknown[] } {
  const maximum = SENSITIVITY_ORDER.indexOf(access.maximumSensitivity);
  const sensitivities = SENSITIVITY_ORDER.slice(0, maximum + 1);
  const params: unknown[] = [...sensitivities];
  const scope: string[] = [];
  if (access.allowGlobal !== false) scope.push(`${alias}.scope = 'global'`);
  if (access.allEngagements) {
    scope.push(`${alias}.scope IN ('engagement', 'mission')`);
  } else {
    const engagements = [...new Set(access.engagementIds ?? [])];
    const missions = [...new Set(access.missionIds ?? [])];
    if (engagements.length > 0) {
      scope.push(`(${alias}.scope IN ('engagement', 'mission') AND ${alias}.engagement_id IN (${engagements.map(() => "?").join(",")}))`);
      params.push(...engagements);
    }
    if (missions.length > 0) {
      scope.push(`(${alias}.scope = 'mission' AND ${alias}.mission_id IN (${missions.map(() => "?").join(",")}))`);
      params.push(...missions);
    }
  }
  return {
    sql: `${alias}.sensitivity IN (${sensitivities.map(() => "?").join(",")}) AND (${scope.length > 0 ? scope.join(" OR ") : "0"})`,
    params,
  };
}

function canAccess(node: MemoryNode, access: MemoryAccessPolicy): boolean {
  if (SENSITIVITY_ORDER.indexOf(node.sensitivity) > SENSITIVITY_ORDER.indexOf(access.maximumSensitivity)) return false;
  if (node.scope.kind === "global") return access.allowGlobal !== false;
  if (access.allEngagements) return true;
  if (node.scope.kind === "engagement") return (access.engagementIds ?? []).includes(node.scope.engagementId!);
  return (access.missionIds ?? []).includes(node.scope.missionId!) || Boolean(
    node.scope.engagementId && (access.engagementIds ?? []).includes(node.scope.engagementId),
  );
}

function nodeSummary(row: NodeSummaryRow): NodeSummary {
  return {
    id: row.id,
    nodeType: row.node_type,
    title: row.title,
    summary: row.summary,
    scope: deserializeScope(row.scope, row.engagement_id, row.mission_id),
    sensitivity: row.sensitivity,
    confidence: row.confidence,
    lifecycleStatus: row.lifecycle_status,
    confirmationState: row.confirmation_state,
    version: row.version,
    pinned: row.pinned === 1,
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    edgeCount: Number(row.edge_count),
    sourceCount: Number(row.source_count),
  };
}

const SUMMARY_COLUMNS = `
  mn.id, mn.node_type, mn.title, mn.summary, mn.scope, mn.engagement_id, mn.mission_id,
  mn.sensitivity, mn.confidence, mn.lifecycle_status, mn.confirmation_state,
  mn.version, mn.pinned, mn.expires_at, mn.created_at, mn.updated_at,
  (SELECT COUNT(*) FROM memory_edges me WHERE me.source_node_id = mn.id OR me.target_node_id = mn.id) AS edge_count,
  (SELECT COUNT(*) FROM memory_sources ms WHERE ms.node_id = mn.id) AS source_count
`;

function encodeCursor(row: Pick<NodeSummaryRow, "updated_at" | "id">): string {
  return Buffer.from(JSON.stringify({ updatedAt: row.updated_at, id: row.id }), "utf8").toString("base64url");
}

function decodeCursor(value: unknown): Cursor | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 1_000) throw new RangeError("cursor is invalid");
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof parsed.updatedAt !== "string" || Number.isNaN(Date.parse(parsed.updatedAt)) || typeof parsed.id !== "string") {
      throw new Error("invalid");
    }
    assertIdentifier(parsed.id, "cursor node ID");
    return { updatedAt: parsed.updatedAt, id: parsed.id };
  } catch {
    throw new RangeError("cursor is invalid");
  }
}

function ftsQuery(source: string): string | undefined {
  const tokens = source.normalize("NFKC").match(/[\p{L}\p{N}_-]+/gu)?.slice(0, 24) ?? [];
  return tokens.length > 0 ? tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" OR ") : undefined;
}

function executeIdempotent<T>(
  database: SqliteDatabase,
  actor: string,
  key: string,
  requestBody: unknown,
  operation: () => T,
): T {
  const settingKey = `idempotency.brain.${sha256(`${actor}:${key}`)}`;
  const requestHash = sha256(canonical(requestBody));
  return inImmediateTransaction(database, () => {
    const stored = database.prepare("SELECT value_json FROM settings WHERE key = ?").get(settingKey) as { value_json: string } | undefined;
    if (stored) {
      const value = JSON.parse(stored.value_json) as { requestHash: string; response: T };
      if (value.requestHash !== requestHash) {
        throw new BrainApiError(
          409,
          "idempotency_key_reused",
          "Idempotency key was already used for a different memory mutation",
          "conflict",
          "Generate a new key for the changed request.",
        );
      }
      return value.response;
    }
    const response = operation();
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO settings (key, value_json, sensitivity, updated_by, updated_at)
      VALUES (?, ?, 'private', ?, ?)
    `).run(settingKey, canonical({ requestHash, response }), actor, now);
    return response;
  });
}

async function executeIdempotentAsync<T>(
  database: SqliteDatabase,
  actor: string,
  key: string,
  requestBody: unknown,
  operation: () => Promise<T>,
): Promise<T> {
  const settingKey = `idempotency.brain.${sha256(`${actor}:${key}`)}`;
  const requestHash = sha256(canonical(requestBody));
  const stored = inImmediateTransaction(database, () => {
    const row = database.prepare("SELECT value_json FROM settings WHERE key = ?").get(settingKey) as { value_json: string } | undefined;
    if (row) {
      const value = JSON.parse(row.value_json) as { requestHash: string; state?: string; response?: T };
      if (value.requestHash !== requestHash) {
        throw new BrainApiError(409, "idempotency_key_reused", "Idempotency key was already used for a different memory mutation", "conflict", "Generate a new key for the changed request.");
      }
      if (value.state === "complete" && value.response !== undefined) return value.response;
      throw new BrainApiError(409, "brain_mutation_in_progress", "An identical memory mutation is already in progress", "conflict", "Wait for the original request to complete before retrying.");
    }
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO settings (key, value_json, sensitivity, updated_by, updated_at)
      VALUES (?, ?, 'private', ?, ?)
    `).run(settingKey, canonical({ requestHash, state: "pending" }), actor, now);
    return undefined;
  });
  if (stored !== undefined) return stored;
  try {
    const response = await operation();
    database.prepare(`
      UPDATE settings SET value_json = ?, updated_by = ?, updated_at = ? WHERE key = ?
    `).run(canonical({ requestHash, state: "complete", response }), actor, new Date().toISOString(), settingKey);
    return response;
  } catch (error) {
    database.prepare("DELETE FROM settings WHERE key = ? AND value_json = ?").run(
      settingKey,
      canonical({ requestHash, state: "pending" }),
    );
    throw error;
  }
}

function requireAccessibleNode(
  repository: MemoryRepository,
  id: string,
  access: MemoryAccessPolicy,
  includeForgotten = false,
): MemoryNode {
  assertIdentifier(id, "memory node ID");
  const node = repository.getNode(id, includeForgotten);
  // A policy miss is intentionally indistinguishable from an absent record.
  if (!node || !canAccess(node, access)) throw new BrainApiError(404, "memory_node_not_found", "Memory node was not found", "not_found");
  return node;
}

function listNodes(
  database: SqliteDatabase,
  access: MemoryAccessPolicy,
  query: Record<string, unknown>,
): { schemaVersion: typeof SCHEMA_VERSION; items: NodeSummary[]; nextCursor: string | null; totalReturned: number } {
  const limit = integer(query.limit, 50, 1, 100, "node page limit");
  const cursor = decodeCursor(query.cursor);
  const accessClause = accessSql("mn", access);
  const clauses = [accessClause.sql];
  const params: unknown[] = [...accessClause.params];
  const search = typeof query.query === "string" && query.query.trim() ? ftsQuery(query.query) : undefined;
  let from = "memory_nodes mn";
  if (search) {
    from = "memory_nodes_fts JOIN memory_nodes mn ON mn.rowid = memory_nodes_fts.rowid";
    clauses.push("memory_nodes_fts MATCH ?");
    params.push(search);
  }
  if (query.nodeType !== undefined) {
    clauses.push("mn.node_type = ?");
    params.push(validateNodeType(query.nodeType));
  }
  if (query.status !== undefined) {
    const status = validateLifecycle(query.status);
    clauses.push("mn.lifecycle_status = ?");
    params.push(status);
  } else {
    clauses.push("mn.lifecycle_status != 'forgotten'");
  }
  if (query.scope !== undefined) {
    const scope = String(query.scope);
    if (!["global", "engagement", "mission"].includes(scope)) throw new TypeError("scope filter is invalid");
    clauses.push("mn.scope = ?");
    params.push(scope);
  }
  if (query.engagementId !== undefined) {
    const id = requiredText(query.engagementId, "engagement filter", 256);
    clauses.push("mn.engagement_id = ?");
    params.push(id);
  }
  if (query.missionId !== undefined) {
    const id = requiredText(query.missionId, "mission filter", 256);
    clauses.push("mn.mission_id = ?");
    params.push(id);
  }
  if (query.sensitivity !== undefined) {
    const sensitivity = validateSensitivity(query.sensitivity);
    if (SENSITIVITY_ORDER.indexOf(sensitivity) > SENSITIVITY_ORDER.indexOf(access.maximumSensitivity)) {
      throw new BrainApiError(403, "memory_sensitivity_denied", "Requested sensitivity exceeds operator access", "policy_denied");
    }
    clauses.push("mn.sensitivity = ?");
    params.push(sensitivity);
  }
  clauses.push("(mn.expires_at IS NULL OR mn.expires_at > ? OR mn.lifecycle_status = 'stale')");
  params.push(new Date().toISOString());
  if (cursor) {
    clauses.push("(mn.updated_at < ? OR (mn.updated_at = ? AND mn.id < ?))");
    params.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
  }
  const rows = database.prepare(`
    SELECT ${SUMMARY_COLUMNS}
    FROM ${from}
    WHERE ${clauses.join(" AND ")}
    ORDER BY mn.updated_at DESC, mn.id DESC
    LIMIT ?
  `).all(...params, limit + 1) as NodeSummaryRow[];
  const page = rows.slice(0, limit);
  return {
    schemaVersion: SCHEMA_VERSION,
    items: page.map(nodeSummary),
    nextCursor: rows.length > limit && page.length > 0 ? encodeCursor(page.at(-1)!) : null,
    totalReturned: page.length,
  };
}

function summaryForNode(database: SqliteDatabase, id: string): NodeSummary | undefined {
  const row = database.prepare(`SELECT ${SUMMARY_COLUMNS} FROM memory_nodes mn WHERE mn.id = ?`).get(id) as NodeSummaryRow | undefined;
  return row ? nodeSummary(row) : undefined;
}

function edgePayload(edge: MemoryEdge) {
  return {
    id: edge.id,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    edgeType: edge.edgeType,
    title: edge.title,
    summary: edge.summary,
    confidence: edge.confidence,
    lifecycleStatus: edge.lifecycleStatus,
    explanation: edge.explanation,
  };
}

function graphTimestamp(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const timestamp = requiredText(value, label, 40);
  if (!Number.isFinite(Date.parse(timestamp))) throw new TypeError(`${label} must be an ISO timestamp`);
  return new Date(timestamp).toISOString();
}

function graphFilters(query: Record<string, unknown>, access: MemoryAccessPolicy): GraphFilters {
  const preset = query.preset === undefined ? undefined : requiredText(query.preset, "graph preset", 32) as GraphPreset;
  if (preset && !Object.prototype.hasOwnProperty.call(GRAPH_PRESETS, preset)) throw new TypeError("graph preset is invalid");
  const nodeType = query.nodeType === undefined ? undefined : validateNodeType(query.nodeType);
  const selectedEdgeType = query.edgeType === undefined ? undefined : validateEdgeType(query.edgeType);
  const scope = query.scope === undefined ? undefined : String(query.scope) as MemoryScope["kind"];
  if (scope && !["global", "engagement", "mission"].includes(scope)) throw new TypeError("graph scope filter is invalid");
  const engagementId = optionalText(query.engagementId, "graph engagement filter", 256);
  if (engagementId) assertIdentifier(engagementId, "graph engagement filter");
  const lifecycle = query.status === undefined ? undefined : validateLifecycle(query.status);
  if (lifecycle === "forgotten") throw new TypeError("forgotten memories cannot be graphed");
  const sensitivity = query.sensitivity === undefined ? undefined : validateSensitivity(query.sensitivity);
  if (sensitivity && SENSITIVITY_ORDER.indexOf(sensitivity) > SENSITIVITY_ORDER.indexOf(access.maximumSensitivity)) {
    throw new BrainApiError(403, "memory_sensitivity_denied", "Requested sensitivity exceeds operator access", "policy_denied");
  }
  let minConfidence: number | undefined;
  if (query.minConfidence !== undefined) {
    const parsed = typeof query.minConfidence === "string" ? Number(query.minConfidence) : query.minConfidence;
    minConfidence = validateConfidence(parsed);
  }
  const updatedAfter = graphTimestamp(query.updatedAfter, "graph start date");
  const updatedBefore = graphTimestamp(query.updatedBefore, "graph end date");
  if (updatedAfter && updatedBefore && updatedAfter > updatedBefore) throw new TypeError("graph start date must not be after end date");
  return {
    ...(nodeType ? { nodeType } : {}),
    ...(selectedEdgeType ? { edgeTypes: [selectedEdgeType] } : preset ? { edgeTypes: GRAPH_PRESETS[preset].edgeTypes } : {}),
    ...(scope ? { scope } : {}),
    ...(engagementId ? { engagementId } : {}),
    ...(lifecycle ? { lifecycle } : {}),
    ...(sensitivity ? { sensitivity } : {}),
    ...(minConfidence !== undefined ? { minConfidence } : {}),
    ...(updatedAfter ? { updatedAfter } : {}),
    ...(updatedBefore ? { updatedBefore } : {}),
    ...(preset ? { preset } : {}),
  };
}

function appendGraphNodeFilters(
  clauses: string[],
  params: unknown[],
  filters: GraphFilters,
  alias: string,
): void {
  if (filters.preset) {
    const nodeTypes = GRAPH_PRESETS[filters.preset].nodeTypes;
    clauses.push(`${alias}.node_type IN (${nodeTypes.map(() => "?").join(",")})`);
    params.push(...nodeTypes);
  }
  if (filters.nodeType) {
    clauses.push(`${alias}.node_type = ?`);
    params.push(filters.nodeType);
  }
  if (filters.scope) {
    clauses.push(`${alias}.scope = ?`);
    params.push(filters.scope);
  }
  if (filters.engagementId) {
    clauses.push(`${alias}.engagement_id = ?`);
    params.push(filters.engagementId);
  }
  if (filters.lifecycle) {
    clauses.push(`${alias}.lifecycle_status = ?`);
    params.push(filters.lifecycle);
  }
  if (filters.sensitivity) {
    clauses.push(`${alias}.sensitivity = ?`);
    params.push(filters.sensitivity);
  }
  if (filters.minConfidence !== undefined) {
    clauses.push(`${alias}.confidence >= ?`);
    params.push(filters.minConfidence);
  }
  if (filters.updatedAfter) {
    clauses.push(`${alias}.updated_at >= ?`);
    params.push(filters.updatedAfter);
  }
  if (filters.updatedBefore) {
    clauses.push(`${alias}.updated_at <= ?`);
    params.push(filters.updatedBefore);
  }
  if (filters.edgeTypes?.length) {
    clauses.push(`EXISTS (
      SELECT 1 FROM memory_edges graph_filter_edge
      WHERE (graph_filter_edge.source_node_id = ${alias}.id OR graph_filter_edge.target_node_id = ${alias}.id)
        AND graph_filter_edge.edge_type IN (${filters.edgeTypes.map(() => "?").join(",")})
        AND graph_filter_edge.lifecycle_status != 'forgotten'
        AND (graph_filter_edge.expires_at IS NULL OR graph_filter_edge.expires_at > ?)
    )`);
    params.push(...filters.edgeTypes, new Date().toISOString());
  }
}

function graphNodeMatches(node: MemoryNode, filters: GraphFilters): boolean {
  if (filters.preset && !GRAPH_PRESETS[filters.preset].nodeTypes.includes(node.nodeType)) return false;
  if (filters.nodeType && node.nodeType !== filters.nodeType) return false;
  if (filters.scope && node.scope.kind !== filters.scope) return false;
  if (filters.engagementId && node.scope.engagementId !== filters.engagementId) return false;
  if (filters.lifecycle && node.lifecycleStatus !== filters.lifecycle) return false;
  if (filters.sensitivity && node.sensitivity !== filters.sensitivity) return false;
  if (filters.minConfidence !== undefined && node.confidence < filters.minConfidence) return false;
  if (filters.updatedAfter && node.updatedAt < filters.updatedAfter) return false;
  if (filters.updatedBefore && node.updatedAt > filters.updatedBefore) return false;
  return true;
}

function graph(
  database: SqliteDatabase,
  repository: MemoryRepository,
  access: MemoryAccessPolicy,
  query: Record<string, unknown>,
) {
  const view = typeof query.view === "string" ? query.view : "global";
  if (!["global", "local", "mission", "operator"].includes(view)) throw new TypeError("graph view is invalid");
  // The client expands a bounded graph in 250-node increments. Keep the hard
  // ceiling modest enough for predictable canvas work, while allowing those
  // progressive requests to succeed instead of failing after the first page.
  const limit = integer(query.limit, 150, 1, 1_000, "graph node limit");
  const depth = integer(query.depth, 1, 0, 2, "graph depth");
  const filters = graphFilters(query, access);
  const selected = new Set<string>();
  let rootNodeId: string | undefined;
  let truncated = false;
  const addIfAccessible = (id: string): boolean => {
    const node = repository.getNode(id);
    if (!node || !canAccess(node, access) || !graphNodeMatches(node, filters) || selected.has(id)) return false;
    if (selected.size >= limit) {
      truncated = true;
      return false;
    }
    selected.add(id);
    return true;
  };

  if (view === "local") {
    rootNodeId = requiredText(query.nodeId, "local graph node ID", 256);
    requireAccessibleNode(repository, rootNodeId, access);
    selected.add(rootNodeId);
    let frontier = [rootNodeId];
    for (let level = 1; level <= depth && frontier.length > 0; level += 1) {
      const placeholders = frontier.map(() => "?").join(",");
      const edgeTypeClause = filters.edgeTypes?.length ? `AND edge_type IN (${filters.edgeTypes.map(() => "?").join(",")})` : "";
      const rows = database.prepare(`
        SELECT source_node_id, target_node_id FROM memory_edges
        WHERE lifecycle_status IN ('confirmed', 'verified')
          AND (expires_at IS NULL OR expires_at > ?)
          ${edgeTypeClause}
          AND (source_node_id IN (${placeholders}) OR target_node_id IN (${placeholders}))
        ORDER BY confidence DESC, updated_at DESC LIMIT 1000
      `).all(new Date().toISOString(), ...(filters.edgeTypes ?? []), ...frontier, ...frontier) as Array<{ source_node_id: string; target_node_id: string }>;
      const next: string[] = [];
      for (const row of rows) {
        for (const id of [row.source_node_id, row.target_node_id]) {
          if (addIfAccessible(id)) next.push(id);
        }
      }
      frontier = next;
    }
  } else {
    const accessClause = accessSql("mn", access);
    const clauses = [
      accessClause.sql,
      ...(filters.lifecycle ? [] : ["mn.lifecycle_status IN ('confirmed', 'verified', 'disputed', 'stale')"]),
      "(mn.expires_at IS NULL OR mn.expires_at > ? OR mn.lifecycle_status = 'stale')",
    ];
    const params: unknown[] = [...accessClause.params];
    params.push(new Date().toISOString());
    appendGraphNodeFilters(clauses, params, filters, "mn");
    if (view === "mission") {
      const missionId = requiredText(query.missionId, "mission graph ID", 256);
      clauses.push("(mn.mission_id = ? OR (mn.node_type = 'mission' AND mn.id = ?))");
      params.push(missionId, missionId);
    } else if (view === "operator") {
      clauses.push("mn.node_type IN ('operator', 'preference')");
    }
    const rows = database.prepare(`
      SELECT mn.id,
        (SELECT COUNT(*) FROM memory_edges me WHERE me.source_node_id = mn.id OR me.target_node_id = mn.id) AS degree
      FROM memory_nodes mn WHERE ${clauses.join(" AND ")}
      ORDER BY mn.pinned DESC, degree DESC, mn.updated_at DESC LIMIT ?
    `).all(...params, limit + 1) as Array<{ id: string; degree: number }>;
    if (rows.length > limit) truncated = true;
    rows.slice(0, limit).forEach((row) => selected.add(row.id));
  }

  const summaries = [...selected].flatMap((id) => {
    const item = summaryForNode(database, id);
    return item ? [item] : [];
  });
  let edges: ReturnType<typeof edgePayload>[] = [];
  if (selected.size > 0) {
    const ids = [...selected];
    const placeholders = ids.map(() => "?").join(",");
    const edgeTypeClause = filters.edgeTypes?.length ? `AND edge_type IN (${filters.edgeTypes.map(() => "?").join(",")})` : "";
    const edgeRows = database.prepare(`
      SELECT id, source_node_id, target_node_id, edge_type, title, summary,
        confidence, lifecycle_status, explanation
      FROM memory_edges
      WHERE source_node_id IN (${placeholders}) AND target_node_id IN (${placeholders})
        AND lifecycle_status != 'forgotten' AND (expires_at IS NULL OR expires_at > ?)
        ${edgeTypeClause}
      ORDER BY confidence DESC, updated_at DESC LIMIT 1000
    `).all(...ids, ...ids, new Date().toISOString(), ...(filters.edgeTypes ?? [])) as Array<{
      id: string;
      source_node_id: string;
      target_node_id: string;
      edge_type: MemoryEdge["edgeType"];
      title: string;
      summary: string;
      confidence: number;
      lifecycle_status: MemoryEdge["lifecycleStatus"];
      explanation: string;
    }>;
    // The selected node set has already passed the access policy. Project the
    // edge rows directly instead of calling listEdges once per edge (an N+1
    // traversal that became quadratic around highly connected graph roots).
    edges = edgeRows.map((edge) => ({
      id: edge.id,
      sourceNodeId: edge.source_node_id,
      targetNodeId: edge.target_node_id,
      edgeType: edge.edge_type,
      title: edge.title,
      summary: edge.summary,
      confidence: edge.confidence,
      lifecycleStatus: edge.lifecycle_status,
      explanation: edge.explanation,
    }));
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    view,
    ...(rootNodeId ? { rootNodeId } : {}),
    nodes: summaries,
    edges,
    truncated,
  };
}

function canAccessMission(database: SqliteDatabase, missionId: string | null, access: MemoryAccessPolicy): boolean {
  if (!missionId) return access.allowGlobal !== false;
  if (access.allEngagements || (access.missionIds ?? []).includes(missionId)) return true;
  const mission = database.prepare("SELECT engagement_id FROM missions WHERE id = ?").get(missionId) as { engagement_id: string | null } | undefined;
  return Boolean(mission?.engagement_id && (access.engagementIds ?? []).includes(mission.engagement_id));
}

function brainSummary(database: SqliteDatabase, access: MemoryAccessPolicy) {
  const clause = accessSql("mn", access);
  const rows = database.prepare(`
    SELECT mn.lifecycle_status AS status, COUNT(*) AS count
    FROM memory_nodes mn WHERE ${clause.sql}
    GROUP BY mn.lifecycle_status
  `).all(...clause.params) as Array<{ status: MemoryLifecycle; count: number }>;
  const counts = new Map(rows.map((row) => [row.status, Number(row.count)]));
  const candidateView = `(
    SELECT id, proposed_scope AS scope, engagement_id, mission_id, sensitivity, status
    FROM memory_candidates
  )`;
  const candidateClause = accessSql("mc", access);
  const candidates = (database.prepare(`
    SELECT COUNT(*) AS count FROM ${candidateView} mc
    WHERE ${candidateClause.sql} AND mc.status = 'pending'
  `).get(...candidateClause.params) as { count: number }).count;
  const edgeClauseA = accessSql("source", access);
  const edgeClauseB = accessSql("target", access);
  const edges = (database.prepare(`
    SELECT COUNT(*) AS count FROM memory_edges me
    JOIN memory_nodes source ON source.id = me.source_node_id
    JOIN memory_nodes target ON target.id = me.target_node_id
    WHERE ${edgeClauseA.sql} AND ${edgeClauseB.sql} AND me.lifecycle_status != 'forgotten'
  `).get(...edgeClauseA.params, ...edgeClauseB.params) as { count: number }).count;
  const packRows = database.prepare("SELECT mission_id FROM memory_context_packs").all() as Array<{ mission_id: string | null }>;
  const vaultRows = database.prepare("SELECT status, last_sync_at FROM vault_connections ORDER BY updated_at DESC").all() as Array<{ status: string; last_sync_at: string | null }>;
  const conflictRows = database.prepare("SELECT node_id FROM vault_conflicts WHERE status = 'open'").all() as Array<{ node_id: string | null }>;
  const conflicts = conflictRows.filter((row) => {
    if (!row.node_id) return false;
    const node = database.prepare(`SELECT ${SUMMARY_COLUMNS} FROM memory_nodes mn WHERE mn.id = ?`).get(row.node_id) as NodeSummaryRow | undefined;
    if (!node) return false;
    const scope = deserializeScope(node.scope, node.engagement_id, node.mission_id);
    return canAccess({ scope, sensitivity: node.sensitivity } as MemoryNode, access);
  }).length;
  const fts = database.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'memory_nodes_fts'").get() as { ok: number } | undefined;
  const databaseHealth = getDatabaseHealth(database);
  const recent = listNodes(database, access, { limit: "8" });
  const vaultStatus = vaultRows.length === 0
    ? "disconnected"
    : vaultRows.some((row) => row.status === "error")
      ? "error"
      : vaultRows.some((row) => row.status === "degraded")
        ? "degraded"
        : "connected";
  return {
    schemaVersion: SCHEMA_VERSION,
    counts: {
      confirmed: counts.get("confirmed") ?? 0,
      candidates,
      stale: counts.get("stale") ?? 0,
      disputed: counts.get("disputed") ?? 0,
      forgotten: counts.get("forgotten") ?? 0,
      edges: Number(edges),
      contextPacks: packRows.filter((row) => canAccessMission(database, row.mission_id, access)).length,
    },
    health: {
      database: databaseHealth.healthy ? "healthy" : "unhealthy",
      fts: fts?.ok === 1 ? "healthy" : "unavailable",
    },
    vault: {
      status: vaultStatus,
      connections: vaultRows.length,
      conflicts: Number(conflicts),
      lastSyncAt: vaultRows.find((row) => row.last_sync_at)?.last_sync_at ?? null,
    },
    recentNodes: recent.items,
  };
}

function nodeDetail(
  database: SqliteDatabase,
  repository: MemoryRepository,
  id: string,
  access: MemoryAccessPolicy,
) {
  const node = requireAccessibleNode(repository, id, access, true);
  const sources = database.prepare(`
    SELECT id, source_type AS sourceType, source_id AS sourceId, source_hash AS sourceHash,
      excerpt_redacted AS excerptRedacted, acquired_at AS acquiredAt, created_at AS createdAt
    FROM memory_sources WHERE node_id = ? ORDER BY acquired_at DESC
  `).all(id) as Array<Record<string, unknown>>;
  const allEdges = node.lifecycleStatus === "forgotten" ? [] : repository.listEdges(id);
  const accessibleEdges = allEdges.filter((edge) => {
    const otherId = edge.sourceNodeId === id ? edge.targetNodeId : edge.sourceNodeId;
    const other = repository.getNode(otherId);
    return Boolean(other && canAccess(other, access));
  });
  const usageRows = database.prepare(`
    SELECT mci.context_pack_id AS contextPackId, mci.rank, mci.retrieval_score AS retrievalScore,
      mci.used, mci.relevance_reason AS relevanceReason, mci.influence_summary AS influenceSummary,
      mci.ignored_reason AS ignoredReason, mci.corrected,
      mcp.mission_id AS missionId, mcp.run_id AS runId, mcp.journey, mcp.purpose, mcp.created_at AS createdAt
    FROM memory_context_items mci JOIN memory_context_packs mcp ON mcp.id = mci.context_pack_id
    WHERE mci.node_id = ? ORDER BY mcp.created_at DESC LIMIT 100
  `).all(id) as Array<Record<string, unknown>>;
  const versions = node.lifecycleStatus === "forgotten" ? [] : database.prepare(`
    SELECT version, title, summary, body, lifecycle_status, author_type, author_id,
      change_reason, content_hash, created_at
    FROM memory_versions WHERE node_id = ? ORDER BY version DESC
  `).all(id) as Array<Record<string, unknown>>;
  return {
    schemaVersion: SCHEMA_VERSION,
    node,
    sources,
    versions: versions.map((version) => ({
      version: Number(version.version),
      title: version.title,
      summary: version.summary,
      body: version.body,
      lifecycleStatus: version.lifecycle_status,
      changedBy: version.author_id ?? version.author_type,
      changeReason: version.change_reason,
      contentHash: version.content_hash,
      changedAt: version.created_at,
    })),
    backlinks: accessibleEdges.filter((edge) => edge.targetNodeId === id).map(edgePayload),
    outgoing: accessibleEdges.filter((edge) => edge.sourceNodeId === id).map(edgePayload),
    usage: usageRows
      .filter((row) => canAccessMission(database, row.missionId ? String(row.missionId) : null, access))
      .map((row) => ({
        contextPackId: row.contextPackId,
        ...(row.missionId ? { missionId: row.missionId } : {}),
        ...(row.runId ? { runId: row.runId } : {}),
        journey: row.journey,
        purpose: row.purpose,
        used: Number(row.used) === 1,
        relevanceReason: row.relevanceReason,
        ...(row.influenceSummary ? { influenceSummary: row.influenceSummary } : {}),
        ...(row.ignoredReason ? { ignoredReason: row.ignoredReason } : {}),
        corrected: Number(row.corrected) === 1,
        retrievalScore: Number(row.retrievalScore),
        rank: Number(row.rank),
        createdAt: row.createdAt,
      })),
  };
}

function candidateAccessible(candidate: MemoryCandidate, access: MemoryAccessPolicy): boolean {
  const asNode = {
    scope: candidate.scope,
    sensitivity: candidate.sensitivity,
  } as Pick<MemoryNode, "scope" | "sensitivity">;
  return canAccess(asNode as MemoryNode, access);
}

function listCandidates(
  database: SqliteDatabase,
  repository: MemoryRepository,
  access: MemoryAccessPolicy,
  query: Record<string, unknown>,
) {
  const limit = integer(query.limit, 50, 1, 100, "candidate page limit");
  const status = query.status === undefined ? "pending" : requiredText(query.status, "candidate status", 30);
  if (!["pending", "confirmed", "edited_confirmed", "merged", "rejected", "suppressed"].includes(status)) {
    throw new TypeError("candidate status filter is invalid");
  }
  const cursor = decodeCursor(query.cursor);
  const candidateView = `(
    SELECT id, proposed_scope AS scope, engagement_id, mission_id, sensitivity,
      status, created_at FROM memory_candidates
  )`;
  const accessClause = accessSql("mc", access);
  const clauses = [accessClause.sql, "mc.status = ?"];
  const params: unknown[] = [...accessClause.params, status];
  if (cursor) {
    clauses.push("(mc.created_at < ? OR (mc.created_at = ? AND mc.id < ?))");
    params.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
  }
  const rows = database.prepare(`
    SELECT mc.id, mc.created_at AS updated_at FROM ${candidateView} mc
    WHERE ${clauses.join(" AND ")} ORDER BY mc.created_at DESC, mc.id DESC LIMIT ?
  `).all(...params, limit + 1) as Array<{ id: string; updated_at: string }>;
  const accessible = rows.flatMap((row) => {
    const candidate = repository.getCandidate(row.id);
    return candidate && candidateAccessible(candidate, access) ? [{ candidate, row }] : [];
  });
  const page = accessible.slice(0, limit);
  return {
    schemaVersion: SCHEMA_VERSION,
    items: page.map((item) => item.candidate),
    nextCursor: rows.length > limit && page.length > 0 ? encodeCursor(page.at(-1)!.row) : null,
  };
}

function parseScopeBody(value: unknown): MemoryScope {
  const body = object(value, "memory scope");
  return validateScope({
    kind: requiredText(body.kind, "memory scope kind", 30) as MemoryScope["kind"],
    ...(body.engagementId ? { engagementId: requiredText(body.engagementId, "engagement ID", 256) } : {}),
    ...(body.missionId ? { missionId: requiredText(body.missionId, "mission ID", 256) } : {}),
  });
}

function correctionInput(body: Record<string, unknown>, actor: string): CorrectMemoryNodeInput {
  const lifecycleStatus = body.lifecycleStatus === undefined
    ? undefined
    : validateLifecycle(body.lifecycleStatus);
  if (lifecycleStatus === "forgotten") throw new TypeError("Use the dedicated forget operation for erasure");
  const expiresAt = body.expiresAt === null
    ? null
    : optionalText(body.expiresAt, "memory expiry", 100);
  if (expiresAt && Number.isNaN(Date.parse(expiresAt))) throw new TypeError("memory expiry must be an ISO timestamp");
  return {
    ...(body.title === undefined ? {} : { title: requiredText(body.title, "memory title", 500) }),
    ...(body.summary === undefined ? {} : { summary: requiredText(body.summary, "memory summary", 4_000) }),
    ...(body.body === undefined ? {} : { body: typeof body.body === "string" ? body.body : requiredText(body.body, "memory body", 1_000_000) }),
    ...(body.scope === undefined ? {} : { scope: parseScopeBody(body.scope) }),
    ...(body.sensitivity === undefined ? {} : { sensitivity: validateSensitivity(body.sensitivity) }),
    ...(body.confidence === undefined ? {} : { confidence: validateConfidence(body.confidence) }),
    ...(lifecycleStatus ? { lifecycleStatus: lifecycleStatus as Exclude<MemoryLifecycle, "forgotten"> } : {}),
    ...(body.confirmationState === undefined ? {} : {
      confirmationState: (() => {
        const value = requiredText(body.confirmationState, "confirmation state", 30);
        if (!["not_required", "pending", "confirmed", "rejected"].includes(value)) {
          throw new TypeError("confirmation state is invalid");
        }
        return value as MemoryNode["confirmationState"];
      })(),
    }),
    ...(body.retentionPolicy === undefined ? {} : { retentionPolicy: object(body.retentionPolicy, "retention policy") }),
    ...(body.expiresAt === undefined ? {} : { expiresAt }),
    ...(body.pinned === undefined ? {} : {
      pinned: typeof body.pinned === "boolean" ? body.pinned : (() => { throw new TypeError("pinned must be boolean"); })(),
    }),
    authorType: "operator",
    authorId: actor,
    changeReason: requiredText(body.reason, "memory change reason", 2_000),
  };
}

function expectedVersion(body: Record<string, unknown>, node: MemoryNode): void {
  const expected = body.expectedVersion;
  if (!Number.isSafeInteger(expected) || Number(expected) < 1) throw new TypeError("expectedVersion must be a positive integer");
  if (Number(expected) !== node.version) {
    throw new BrainApiError(409, "memory_version_conflict", "Memory changed after it was loaded", "conflict", "Refresh the node before applying this change.");
  }
}

function contextPackDetail(
  database: SqliteDatabase,
  repository: MemoryRepository,
  id: string,
  access: MemoryAccessPolicy,
) {
  const pack = repository.requireContextPack(id);
  if (!canAccessMission(database, pack.missionId ?? null, access)) {
    throw new BrainApiError(404, "context_pack_not_found", "Context pack was not found", "not_found");
  }
  const items = pack.items.map((item) => {
    const node = repository.getNode(item.nodeId);
    if (!node || !canAccess(node, access)) {
      throw new BrainApiError(404, "context_pack_not_found", "Context pack was not found", "not_found");
    }
    return { ...item, node: summaryForNode(database, node.id)! };
  });
  return { schemaVersion: SCHEMA_VERSION, ...pack, items };
}

function boundedMarkdownFiles(
  policy: VaultPathPolicy,
  vaultRoot: string,
  maximum = 251,
): string[] {
  const files: string[] = [];
  const visit = (relativeDirectory: string): void => {
    if (files.length >= maximum) return;
    const absolute = policy.resolveRelative(vaultRoot, relativeDirectory || ".");
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (files.length >= maximum) return;
      if (entry.isSymbolicLink()) throw new BrainApiError(403, "vault_symlink_denied", "Symbolic links are not permitted in managed vault paths", "policy_denied");
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === ".chillspwn" || entry.name === ".obsidian" || entry.name === "Attachments") continue;
        visit(relativePath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        files.push(relativePath);
      }
    }
  };
  visit("");
  return files;
}

/**
 * Mount with `app.use(createSecondBrainRouter(dependencies))` after JSON body
 * parsing. The caller owns authentication and supplies explicit memory scope.
 */
export function createSecondBrainRouter(dependencies: SecondBrainRouterDependencies): Router {
  const router = Router();
  const repository = new MemoryRepository(dependencies.database);
  const brain = new SecondBrainService(repository);
  const pathPolicy = dependencies.vaultPathPolicy ?? (dependencies.vaultAllowedRoot
    ? new VaultPathPolicy(dependencies.vaultAllowedRoot)
    : undefined);
  const vault = dependencies.vaultBridge ?? (pathPolicy
    ? new ObsidianVaultBridge(dependencies.database, repository, pathPolicy)
    : undefined);
  if (vault && !pathPolicy) throw new Error("A vault bridge requires its matching path policy");

  const queryObject = (request: Request): Record<string, unknown> => request.query as Record<string, unknown>;
  const handle = (
    request: Request,
    response: Response,
    operation: (actor: string, access: MemoryAccessPolicy) => unknown,
    status = 200,
  ): void => {
    const requestTraceId = traceId(request);
    response.setHeader("X-Request-ID", requestTraceId);
    try {
      const { actor, access } = actorAndAccess(request, dependencies);
      response.status(status).json(operation(actor, access));
    } catch (error) {
      sendError(response, error, requestTraceId);
    }
  };
  const mutate = (
    request: Request,
    response: Response,
    operation: (actor: string, access: MemoryAccessPolicy) => unknown,
    status = 200,
  ): void => {
    handle(request, response, (actor, access) => {
      const key = validatedIdempotencyKey(request);
      return executeIdempotent(
        dependencies.database,
        actor,
        key,
        { path: request.path, params: request.params, body: request.body },
        () => operation(actor, access),
      );
    }, status);
  };

  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get("/api/v2/brain/summary", (request, response) => {
    handle(request, response, (_actor, access) => brainSummary(dependencies.database, access));
  });

  router.get("/api/v2/brain/control", (request, response) => {
    handle(request, response, () => ({
      schemaVersion: SCHEMA_VERSION,
      policy: getMemoryControlPolicy(dependencies.database),
    }));
  });

  router.put("/api/v2/brain/control", (request, response) => {
    mutate(request, response, (actor) => {
      const body = object(request.body);
      const expected = integer(body.expectedVersion, -1, 0, Number.MAX_SAFE_INTEGER, "expectedVersion");
      const policy = updateMemoryControlPolicy({
        database: dependencies.database,
        expectedVersion: expected,
        actor,
        policy: object(body.policy, "memory control policy"),
      });
      return { schemaVersion: SCHEMA_VERSION, policy };
    });
  });

  router.get("/api/v2/brain/health", (request, response) => {
    handle(request, response, () => {
      const databaseHealth = getDatabaseHealth(dependencies.database);
      const fts = dependencies.database.prepare(
        "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'memory_nodes_fts'",
      ).get() as { ok: number } | undefined;
      const vaultConnections = (dependencies.database.prepare(
        "SELECT COUNT(*) AS count FROM vault_connections WHERE status = 'connected'",
      ).get() as { count: number }).count;
      return {
        schemaVersion: SCHEMA_VERSION,
        status: databaseHealth.healthy && fts?.ok === 1 ? "healthy" : "degraded",
        database: {
          status: databaseHealth.healthy ? "healthy" : "unhealthy",
          integrity: databaseHealth.integrity,
          journalMode: databaseHealth.journalMode,
          foreignKeys: databaseHealth.foreignKeys,
        },
        search: { status: fts?.ok === 1 ? "healthy" : "unavailable" },
        vault: { enabled: Boolean(vault), connected: Number(vaultConnections) },
      };
    });
  });

  router.get("/api/v2/brain/nodes", (request, response) => {
    handle(request, response, (_actor, access) => listNodes(dependencies.database, access, queryObject(request)));
  });

  router.get("/api/v2/brain/graph", (request, response) => {
    handle(request, response, (_actor, access) => graph(
      dependencies.database,
      repository,
      access,
      queryObject(request),
    ));
  });

  router.get("/api/v2/brain/nodes/:nodeId", (request, response) => {
    handle(request, response, (_actor, access) => nodeDetail(
      dependencies.database,
      repository,
      request.params.nodeId!,
      access,
    ));
  });

  router.get("/api/v2/brain/candidates", (request, response) => {
    handle(request, response, (_actor, access) => listCandidates(
      dependencies.database,
      repository,
      access,
      queryObject(request),
    ));
  });

  router.post("/api/v2/brain/candidates/:candidateId/confirm", (request, response) => {
    mutate(request, response, (actor, access) => {
      const candidate = repository.requireCandidate(request.params.candidateId!);
      if (!candidateAccessible(candidate, access)) throw new BrainApiError(404, "memory_candidate_not_found", "Memory candidate was not found", "not_found");
      const control = getMemoryControlPolicy(dependencies.database);
      if (!memoryCandidateAllowed(control, candidate.nodeType)) {
        throw new BrainApiError(403, "memory_retention_disabled", "This memory category is disabled by operator controls", "policy_denied", "Review the Second Brain Memory Control Center before confirming this candidate.");
      }
      const body = object(request.body);
      const edits = body.edits === undefined ? {} : object(body.edits, "candidate edits");
      const node = brain.confirmCandidate(candidate.id, actor, {
        ...(edits.title === undefined ? {} : { title: requiredText(edits.title, "candidate title", 500) }),
        ...(edits.summary === undefined ? {} : { summary: requiredText(edits.summary, "candidate summary", 4_000) }),
        ...(edits.body === undefined ? {} : { body: typeof edits.body === "string" ? edits.body : requiredText(edits.body, "candidate body", 1_000_000) }),
        ...(edits.scope === undefined ? {} : { scope: parseScopeBody(edits.scope) }),
        ...(edits.sensitivity === undefined ? {} : { sensitivity: validateSensitivity(edits.sensitivity) }),
        ...(edits.confidence === undefined ? {} : { confidence: validateConfidence(edits.confidence) }),
      });
      if (!canAccess(node, access)) throw new BrainApiError(403, "memory_scope_denied", "Confirmed memory falls outside operator scope", "policy_denied");
      return { schemaVersion: SCHEMA_VERSION, node };
    }, 201);
  });

  router.post("/api/v2/brain/candidates/:candidateId/reject", (request, response) => {
    mutate(request, response, (actor, access) => {
      const candidate = repository.requireCandidate(request.params.candidateId!);
      if (!candidateAccessible(candidate, access)) throw new BrainApiError(404, "memory_candidate_not_found", "Memory candidate was not found", "not_found");
      const suppressionId = brain.rejectAndDoNotRelearn(
        candidate.id,
        actor,
        requiredText(object(request.body).reason, "candidate rejection reason", 1_000),
      );
      return { schemaVersion: SCHEMA_VERSION, candidateId: candidate.id, suppressionId, status: "suppressed" };
    });
  });

  router.post("/api/v2/brain/nodes/:nodeId/correct", (request, response) => {
    mutate(request, response, (actor, access) => {
      const current = requireAccessibleNode(repository, request.params.nodeId!, access);
      const body = object(request.body);
      expectedVersion(body, current);
      const node = repository.correctNode(current.id, correctionInput(body, actor));
      if (!canAccess(node, access)) throw new BrainApiError(403, "memory_scope_denied", "Corrected memory falls outside operator scope", "policy_denied");
      return { schemaVersion: SCHEMA_VERSION, node };
    });
  });

  router.post("/api/v2/brain/nodes/:nodeId/dispute", (request, response) => {
    mutate(request, response, (actor, access) => {
      const current = requireAccessibleNode(repository, request.params.nodeId!, access);
      const body = object(request.body);
      expectedVersion(body, current);
      const node = repository.correctNode(current.id, {
        lifecycleStatus: "disputed",
        authorType: "operator",
        authorId: actor,
        changeReason: requiredText(body.reason, "dispute reason", 2_000),
      });
      return { schemaVersion: SCHEMA_VERSION, node };
    });
  });

  router.post("/api/v2/brain/nodes/:nodeId/pin", (request, response) => {
    mutate(request, response, (actor, access) => {
      const current = requireAccessibleNode(repository, request.params.nodeId!, access);
      const body = object(request.body);
      expectedVersion(body, current);
      if (typeof body.pinned !== "boolean") throw new TypeError("pinned must be boolean");
      const node = repository.correctNode(current.id, {
        pinned: body.pinned,
        authorType: "operator",
        authorId: actor,
        changeReason: body.pinned ? "Operator pinned memory" : "Operator unpinned memory",
      });
      return { schemaVersion: SCHEMA_VERSION, node };
    });
  });

  router.post("/api/v2/brain/nodes/:nodeId/expire", (request, response) => {
    mutate(request, response, (actor, access) => {
      const current = requireAccessibleNode(repository, request.params.nodeId!, access);
      const body = object(request.body);
      expectedVersion(body, current);
      const expiresAt = requiredText(body.expiresAt, "memory expiry", 100);
      if (Number.isNaN(Date.parse(expiresAt))) throw new TypeError("memory expiry must be an ISO timestamp");
      const node = repository.correctNode(current.id, {
        expiresAt,
        lifecycleStatus: Date.parse(expiresAt) <= Date.now() ? "stale" : current.lifecycleStatus as Exclude<MemoryLifecycle, "forgotten">,
        authorType: "operator",
        authorId: actor,
        changeReason: requiredText(body.reason ?? "Operator set memory expiry", "expiry reason", 2_000),
      });
      return { schemaVersion: SCHEMA_VERSION, node };
    });
  });

  router.post("/api/v2/brain/nodes/:nodeId/forget", (request, response) => {
    mutate(request, response, (actor, access) => {
      const current = requireAccessibleNode(repository, request.params.nodeId!, access);
      const body = object(request.body);
      expectedVersion(body, current);
      const result = vault
        ? vault.forgetMemory(current.id, actor, optionalText(body.reason, "forget reason", 1_000))
        : brain.forget(current.id, actor, optionalText(body.reason, "forget reason", 1_000));
      return { schemaVersion: SCHEMA_VERSION, result };
    });
  });

  router.get("/api/v2/brain/context-packs/:contextPackId", (request, response) => {
    handle(request, response, (_actor, access) => contextPackDetail(
      dependencies.database,
      repository,
      request.params.contextPackId!,
      access,
    ));
  });

  router.get("/api/v2/brain/vault", (request, response) => {
    handle(request, response, (_actor, access) => {
      if (!vault || !pathPolicy) {
        return {
          schemaVersion: SCHEMA_VERSION,
          enabled: false,
          connections: [],
          syncStates: [],
          conflicts: [],
        };
      }
      const connections = dependencies.database.prepare(`
        SELECT id, vault_path, display_name, status, sync_scope_json,
          permission_granted_at, last_sync_at, created_at, updated_at
        FROM vault_connections ORDER BY updated_at DESC
      `).all() as Array<Record<string, unknown>>;
      const connectionById = new Map(connections.map((item) => [String(item.id), item]));
      const states = dependencies.database.prepare(`
        SELECT id, connection_id, node_id, relative_path, database_version, status,
          last_scanned_at, last_synced_at, error_message
        FROM vault_sync_state ORDER BY COALESCE(last_scanned_at, '') DESC LIMIT 250
      `).all() as Array<Record<string, unknown>>;
      const conflicts = dependencies.database.prepare(`
        SELECT vc.id, vc.connection_id, vc.sync_state_id, vc.node_id, vc.base_hash,
          vc.database_hash, vc.vault_hash, vc.status, vc.resolution_reason,
          vc.resolved_by, vc.resolved_at, vc.created_at, vs.database_version
        FROM vault_conflicts vc JOIN vault_sync_state vs ON vs.id = vc.sync_state_id
        ORDER BY vc.created_at DESC LIMIT 100
      `).all() as Array<Record<string, unknown>>;
      return {
        schemaVersion: SCHEMA_VERSION,
        enabled: true,
        syncEnabled: vault.vaultSyncEnabled(),
        projectionLifecycleStatuses: vault.projectionLifecycleStatuses(),
        allowedRootLabel: basename(pathPolicy.allowedRoot),
        connections: connections.map((item) => ({
          id: item.id,
          displayName: item.display_name,
          status: item.status,
          vaultPath: relative(pathPolicy.allowedRoot, String(item.vault_path)) || ".",
          syncScope: JSON.parse(String(item.sync_scope_json)),
          permissionGrantedAt: item.permission_granted_at,
          lastSyncAt: item.last_sync_at,
          createdAt: item.created_at,
          updatedAt: item.updated_at,
          obsidianUrl: vault.deepLink(String(item.id)),
        })),
        syncStates: states.flatMap<Record<string, unknown>>((item) => {
          if (!item.node_id) return access.allEngagements ? [{
            id: item.id,
            connectionId: item.connection_id,
            nodeId: null,
            relativePath: item.relative_path,
            databaseVersion: item.database_version,
            status: item.status,
            lastScannedAt: item.last_scanned_at,
            lastSyncedAt: item.last_synced_at,
            errorMessage: item.error_message,
            obsidianUrl: vault.deepLink(String(item.connection_id), String(item.relative_path)),
          }] : [];
          const node = repository.getNode(String(item.node_id), true);
          if (!node || !canAccess(node, access)) return [];
          return [{
          id: item.id,
          connectionId: item.connection_id,
          nodeId: item.node_id,
          relativePath: item.relative_path,
          databaseVersion: item.database_version,
          status: item.status,
          lastScannedAt: item.last_scanned_at,
          lastSyncedAt: item.last_synced_at,
          errorMessage: item.error_message,
          obsidianUrl: connectionById.has(String(item.connection_id))
            ? vault.deepLink(String(item.connection_id), String(item.relative_path))
            : undefined,
          }];
        }),
        conflicts: conflicts.flatMap((item) => {
          if (!item.node_id) return [];
          const node = repository.getNode(String(item.node_id), true);
          if (!node || !canAccess(node, access)) return [];
          return [{
          id: item.id,
          connectionId: item.connection_id,
          syncStateId: item.sync_state_id,
          nodeId: item.node_id,
          baseHash: item.base_hash,
          databaseHash: item.database_hash,
          vaultHash: item.vault_hash,
            status: item.status === "open" ? "open" : item.status === "dismissed" ? "dismissed" : "resolved",
            databaseVersion: item.database_version,
            resolutionReason: item.resolution_reason,
            resolvedBy: item.resolved_by,
            resolvedAt: item.resolved_at,
            detectedAt: item.created_at,
          }];
        }),
      };
    });
  });

  router.post("/api/v2/brain/vault/connect", (request, response) => {
    mutate(request, response, () => {
      if (!vault) throw new BrainApiError(503, "vault_bridge_disabled", "Obsidian vault integration is not configured", "dependency_missing");
      const body = object(request.body);
      if (body.permissionGranted !== true) throw new TypeError("Explicit vault filesystem permission is required");
      const connection = vault.connect({
        vaultPath: requiredText(body.vaultPath, "vault path", 1_000),
        displayName: requiredText(body.displayName, "vault display name", 200),
        syncScope: body.syncScope === undefined ? {} : object(body.syncScope, "vault sync scope"),
        permissionGranted: true,
      });
      dependencies.onVaultConnectionChanged?.();
      return {
        schemaVersion: SCHEMA_VERSION,
        connection: {
          ...connection,
          vaultPath: pathPolicy ? relative(pathPolicy.allowedRoot, connection.vaultPath) || "." : ".",
        },
      };
    }, 201);
  });

  router.post("/api/v2/brain/vault/export", (request, response) => {
    mutate(request, response, (_actor, access) => {
      if (!vault) throw new BrainApiError(503, "vault_bridge_disabled", "Obsidian vault integration is not configured", "dependency_missing");
      const body = object(request.body);
      vault.assertVaultSyncAllowed();
      const connectionId = requiredText(body.connectionId, "vault connection ID", 256);
      const nodeId = optionalText(body.nodeId, "memory node ID", 256);
      if (nodeId) {
        requireAccessibleNode(repository, nodeId, access);
        return { schemaVersion: SCHEMA_VERSION, result: vault.exportNode(connectionId, nodeId) };
      }
      const clause = accessSql("mn", access);
      const lifecycleStatuses = vault.projectionLifecycleStatuses();
      const lifecyclePlaceholders = lifecycleStatuses.map(() => "?").join(",");
      const rows = dependencies.database.prepare(`
        SELECT mn.id FROM memory_nodes mn WHERE ${clause.sql}
          AND mn.lifecycle_status IN (${lifecyclePlaceholders})
        ORDER BY mn.updated_at DESC LIMIT 251
      `).all(...clause.params, ...lifecycleStatuses) as Array<{ id: string }>;
      const bounded = rows.slice(0, 250);
      const results = bounded.map((item) => vault.exportNode(connectionId, item.id));
      const conflictCount = results.filter((item) => item.status === "conflict").length;
      const result = {
        connectionId,
        status: conflictCount > 0 ? "conflict" : rows.length > 250 ? "partial" : "synced",
        message: rows.length > 250
          ? `Exported the first 250 accessible notes; continue with targeted export for the remaining records.`
          : `Exported ${results.length} accessible canonical notes${conflictCount > 0 ? `; ${conflictCount} require conflict resolution` : ""}.`,
      };
      return { schemaVersion: SCHEMA_VERSION, result };
    });
  });

  router.post("/api/v2/brain/vault/import", (request, response) => {
    mutate(request, response, (actor, access) => {
      if (!vault || !pathPolicy) throw new BrainApiError(503, "vault_bridge_disabled", "Obsidian vault integration is not configured", "dependency_missing");
      const body = object(request.body);
      vault.assertVaultSyncAllowed();
      const connectionId = requiredText(body.connectionId, "vault connection ID", 256);
      const connection = vault.requireConnection(connectionId);
      const requestedPath = optionalText(body.relativePath, "vault note path", 1_000);
      const paths = requestedPath ? [requestedPath] : boundedMarkdownFiles(pathPolicy, connection.vaultPath);
      const importOne = (relativePath: string) => {
        const path = pathPolicy.resolveRelative(connection.vaultPath, relativePath);
        let note;
        try {
          note = parseObsidianNote(readFileSync(path, "utf8"));
        } catch {
          // The bridge owns malformed-note quarantine; privacy validation cannot
          // inspect malformed content and deliberately delegates only that case.
          return vault.importNote(connectionId, relativePath, actor);
        }
        const policyProbe = { scope: note.scope, sensitivity: note.sensitivity } as MemoryNode;
        if (!canAccess(policyProbe, access)) {
          throw new BrainApiError(403, "memory_scope_denied", "Imported note scope exceeds operator access", "policy_denied");
        }
        const existing = repository.getNode(note.id);
        if (existing && !relativePath.startsWith("00 Inbox/")) {
          const state = dependencies.database.prepare(`
            SELECT id FROM vault_sync_state WHERE connection_id = ? AND node_id = ?
          `).get(connectionId, existing.id);
          return state
            ? vault.syncNode(connectionId, existing.id, actor)
            : vault.exportNode(connectionId, existing.id);
        }
        return vault.importNote(connectionId, relativePath, actor);
      };
      if (requestedPath) {
        const imported = importOne(requestedPath);
        const result = {
          connectionId,
          nodeId: imported.nodeId,
          relativePath: imported.relativePath,
          status: imported.status,
          message: imported.status === "candidate"
            ? "Vault note was imported as a reviewable memory candidate."
            : imported.status === "quarantined"
              ? "Malformed vault note was quarantined for review."
              : "Vault note was imported and versioned.",
        };
        return { schemaVersion: SCHEMA_VERSION, result };
      }
      const bounded = paths.slice(0, 250);
      const results = bounded.map(importOne);
      const quarantined = results.filter((item) => item.status === "quarantined").length;
      const result = {
        connectionId,
        status: quarantined > 0 ? "quarantined" : paths.length > 250 ? "partial" : "synced",
        message: paths.length > 250
          ? "Imported the first 250 vault notes; use targeted import for the remaining files."
          : `Processed ${results.length} vault notes${quarantined > 0 ? `; ${quarantined} malformed notes were quarantined` : ""}.`,
      };
      return { schemaVersion: SCHEMA_VERSION, result };
    });
  });

  router.post("/api/v2/brain/vault/sync", (request, response) => {
    mutate(request, response, (actor, access) => {
      if (!vault) throw new BrainApiError(503, "vault_bridge_disabled", "Obsidian vault integration is not configured", "dependency_missing");
      const body = object(request.body);
      vault.assertVaultSyncAllowed();
      const connectionId = requiredText(body.connectionId, "vault connection ID", 256);
      const nodeId = optionalText(body.nodeId, "memory node ID", 256);
      if (nodeId) {
        requireAccessibleNode(repository, nodeId, access);
        return { schemaVersion: SCHEMA_VERSION, result: vault.syncNode(connectionId, nodeId, actor) };
      }
      const clause = accessSql("mn", access);
      const lifecycleStatuses = vault.projectionLifecycleStatuses();
      const lifecyclePlaceholders = lifecycleStatuses.map(() => "?").join(",");
      const rows = dependencies.database.prepare(`
        SELECT vs.node_id FROM vault_sync_state vs
        JOIN memory_nodes mn ON mn.id = vs.node_id
        WHERE vs.connection_id = ? AND vs.node_id IS NOT NULL AND vs.status != 'deleted'
          AND ${clause.sql}
          AND mn.lifecycle_status IN (${lifecyclePlaceholders})
        ORDER BY COALESCE(vs.last_scanned_at, '') ASC LIMIT 251
      `).all(connectionId, ...clause.params, ...lifecycleStatuses) as Array<{ node_id: string }>;
      const accessible = rows.map((item) => item.node_id);
      const results = accessible.slice(0, 250).map((id) => vault.syncNode(connectionId, id, actor));
      const conflicts = results.filter((item) => item.status === "conflict").length;
      const result = {
        connectionId,
        status: conflicts > 0 ? "conflict" : accessible.length > 250 ? "partial" : "synced",
        message: accessible.length > 250
          ? "Synchronized the first 250 tracked notes; continue with targeted synchronization."
          : `Synchronized ${results.length} tracked notes${conflicts > 0 ? `; ${conflicts} require conflict resolution` : ""}.`,
      };
      return { schemaVersion: SCHEMA_VERSION, result };
    });
  });

  router.get("/api/v2/brain/vault/deep-link", (request, response) => {
    handle(request, response, (_actor, access) => {
      if (!vault) throw new BrainApiError(503, "vault_bridge_disabled", "Obsidian vault integration is not configured", "dependency_missing");
      const connectionId = requiredText(request.query.connectionId, "vault connection ID", 256);
      const nodeId = optionalText(request.query.nodeId, "memory node ID", 256);
      const requestedPath = optionalText(request.query.relativePath, "vault note path", 1_000);
      if (nodeId && requestedPath) throw new TypeError("Choose nodeId or relativePath, not both");
      let relativePath = requestedPath;
      if (nodeId) {
        requireAccessibleNode(repository, nodeId, access);
        const state = dependencies.database.prepare(`
          SELECT relative_path FROM vault_sync_state WHERE connection_id = ? AND node_id = ?
        `).get(connectionId, nodeId) as { relative_path: string } | undefined;
        relativePath = state?.relative_path ?? vault.renderNode(nodeId).relativePath;
      }
      return { schemaVersion: SCHEMA_VERSION, url: vault.deepLink(connectionId, relativePath) };
    });
  });

  router.post("/api/v2/brain/vault/portable-export", async (request, response) => {
    const requestTraceId = traceId(request);
    response.setHeader("X-Request-ID", requestTraceId);
    try {
      const idempotencyKey = validatedIdempotencyKey(request);
      if (!vault) throw new BrainApiError(503, "vault_bridge_disabled", "Obsidian vault integration is not configured", "dependency_missing");
      const { actor, access } = actorAndAccess(request, dependencies);
      const body = object(request.body);
      const connectionId = requiredText(body.connectionId, "vault connection ID", 256);
      vault.requireConnection(connectionId);
      const payload = await executeIdempotentAsync(
        dependencies.database,
        actor,
        idempotencyKey,
        { path: request.path, params: request.params, body },
        async () => {
          vault.assertVaultSyncAllowed();
          const clause = accessSql("mn", access);
          const lifecycleStatuses = vault.projectionLifecycleStatuses();
          const lifecyclePlaceholders = lifecycleStatuses.map(() => "?").join(",");
          const rows = dependencies.database.prepare(`
            SELECT mn.id FROM memory_nodes mn WHERE ${clause.sql}
              AND mn.lifecycle_status IN (${lifecyclePlaceholders})
            ORDER BY mn.updated_at DESC, mn.id
          `).all(...clause.params, ...lifecycleStatuses) as Array<{ id: string }>;
          const result = await vault.createPortableExport(connectionId, rows.map((row) => row.id), actor);
          return {
            schemaVersion: SCHEMA_VERSION,
            result: {
              connectionId,
              status: "ready",
              message: `Portable Obsidian archive contains ${result.fileCount - 1} canonical notes and a provenance manifest.`,
              archiveName: result.archiveName,
              downloadUrl: `/api/v2/brain/vault/portable-exports/${encodeURIComponent(connectionId)}/${encodeURIComponent(result.archiveName)}`,
              byteSize: result.byteSize,
              fileCount: result.fileCount,
              sha256: result.sha256,
              createdAt: result.createdAt,
            },
          };
        },
      );
      response.json(payload);
    } catch (error) {
      sendError(response, error, requestTraceId);
    }
  });

  router.get("/api/v2/brain/vault/portable-exports/:connectionId/:archiveName", (request, response) => {
    const requestTraceId = traceId(request);
    response.setHeader("X-Request-ID", requestTraceId);
    response.setHeader("Cache-Control", "no-store");
    try {
      actorAndAccess(request, dependencies);
      if (!vault) throw new BrainApiError(503, "vault_bridge_disabled", "Obsidian vault integration is not configured", "dependency_missing");
      const archiveName = requiredText(request.params.archiveName, "portable archive name", 300);
      const archivePath = vault.portableExportPath(request.params.connectionId!, archiveName);
      response.download(archivePath, archiveName, { dotfiles: "deny" }, (error) => {
        if (error && !response.headersSent) sendError(response, error, requestTraceId);
      });
    } catch (error) {
      sendError(response, error, requestTraceId);
    }
  });

  router.get("/api/v2/brain/vault/conflicts", (request, response) => {
    handle(request, response, (_actor, access) => {
      if (!vault) throw new BrainApiError(503, "vault_bridge_disabled", "Obsidian vault integration is not configured", "dependency_missing");
      const rows = dependencies.database.prepare(`
        SELECT vc.id, vc.connection_id, vc.node_id, vc.base_hash, vc.database_hash,
          vc.vault_hash, vc.status, vc.created_at, vs.relative_path
        FROM vault_conflicts vc JOIN vault_sync_state vs ON vs.id = vc.sync_state_id
        ORDER BY vc.created_at DESC LIMIT 250
      `).all() as Array<Record<string, unknown>>;
      return {
        schemaVersion: SCHEMA_VERSION,
        items: rows.flatMap((row) => {
          if (!row.node_id) return [];
          const node = repository.getNode(String(row.node_id));
          if (!node || !canAccess(node, access)) return [];
          return [{
            id: row.id,
            connectionId: row.connection_id,
            nodeId: row.node_id,
            relativePath: row.relative_path,
            baseHash: row.base_hash,
            databaseHash: row.database_hash,
            vaultHash: row.vault_hash,
            status: row.status,
            createdAt: row.created_at,
          }];
        }),
      };
    });
  });

  router.get("/api/v2/brain/vault/conflicts/:conflictId", (request, response) => {
    handle(request, response, (_actor, access) => {
      if (!vault) throw new BrainApiError(503, "vault_bridge_disabled", "Obsidian vault integration is not configured", "dependency_missing");
      const row = dependencies.database.prepare(`
        SELECT vc.*, vs.relative_path FROM vault_conflicts vc
        JOIN vault_sync_state vs ON vs.id = vc.sync_state_id WHERE vc.id = ?
      `).get(request.params.conflictId!) as Record<string, unknown> | undefined;
      if (!row) throw new BrainApiError(404, "vault_conflict_not_found", "Vault conflict was not found", "not_found");
      if (!row.node_id) throw new BrainApiError(404, "vault_conflict_not_found", "Vault conflict was not found", "not_found");
      requireAccessibleNode(repository, String(row.node_id), access);
      return {
        schemaVersion: SCHEMA_VERSION,
        conflict: {
          id: row.id,
          connectionId: row.connection_id,
          nodeId: row.node_id,
          relativePath: row.relative_path,
          baseHash: row.base_hash,
          databaseHash: row.database_hash,
          vaultHash: row.vault_hash,
          databaseVersion: JSON.parse(String(row.database_version_json)),
          vaultVersionText: row.vault_version_text,
          status: row.status,
          createdAt: row.created_at,
        },
      };
    });
  });

  router.post("/api/v2/brain/vault/conflicts/:conflictId/resolve", (request, response) => {
    mutate(request, response, (actor, access) => {
      if (!vault) throw new BrainApiError(503, "vault_bridge_disabled", "Obsidian vault integration is not configured", "dependency_missing");
      const conflict = dependencies.database.prepare(
        "SELECT node_id FROM vault_conflicts WHERE id = ? AND status = 'open'",
      ).get(request.params.conflictId!) as { node_id: string | null } | undefined;
      if (!conflict?.node_id) throw new BrainApiError(404, "vault_conflict_not_found", "Open vault conflict was not found", "not_found");
      requireAccessibleNode(repository, conflict.node_id, access);
      const body = object(request.body);
      const resolution = requiredText(body.resolution, "conflict resolution", 30);
      if (resolution !== "database" && resolution !== "vault" && resolution !== "merged") {
        throw new TypeError("conflict resolution must be database, vault, or merged");
      }
      const result = vault.resolveConflict(
        request.params.conflictId!,
        resolution,
        actor,
        optionalText(body.mergedText, "merged vault note", 1_000_000),
      );
      return { schemaVersion: SCHEMA_VERSION, result };
    });
  });

  return router;
}
