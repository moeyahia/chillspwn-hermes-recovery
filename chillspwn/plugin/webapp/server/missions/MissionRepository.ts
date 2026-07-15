import { randomUUID } from "node:crypto";
import type { SqliteDatabase } from "../db";
import { inImmediateTransaction } from "../db";
import { EventRepository } from "../events";
import { getMemoryControlPolicy, MemoryRepository, type MemoryNode } from "../memory";
import { autonomousContractHash, canonicalJson, hashCanonical, sha256 } from "./canonical";
import { IdempotencyConflictError } from "./errors";
import type {
  AutonomousContextCandidate,
  AutonomousMissionRequest,
  CreatedMission,
  Journey,
  MissionCreateRequest,
  MissionListPage,
  MissionSummary,
} from "./types";

interface IdempotencyRow {
  readonly value_json: string;
}

interface StoredIdempotency {
  readonly requestHash: string;
  readonly response: CreatedMission;
}

interface MissionSummaryRow {
  readonly id: string;
  readonly title: string;
  readonly journey: Journey;
  readonly mission_status: string;
  readonly run_status: string | null;
  readonly updated_at: string;
  readonly current_phase: string | null;
  readonly progress: number | null;
  readonly next_action: string | null;
}

interface CursorValue {
  readonly updatedAt: string;
  readonly id: string;
}

export interface ListMissionsOptions {
  readonly cursor?: string;
  readonly limit?: number;
  readonly journey?: Journey;
  readonly status?: string;
  readonly query?: string;
}

export interface CreateMissionOptions {
  readonly request: MissionCreateRequest;
  readonly requestHash: string;
  readonly idempotencyKey: string;
  readonly actorId: string;
}

function json(value: unknown): string {
  return canonicalJson(value);
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function idempotencySettingKey(key: string): string {
  return `idempotency.mission.${sha256(key)}`;
}

function targetType(target: string): string {
  if (/^https?:\/\//iu.test(target)) return "url";
  if (/^[0-9a-f:.]+\/\d+$/iu.test(target)) return "cidr";
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(target) || target.includes(":")) return "ip";
  if (target.includes("*") || target.includes("?")) return "pattern";
  if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/iu.test(target)) return "domain";
  return "other";
}

function normalizeTarget(target: string): string {
  const trimmed = target.trim().normalize("NFKC");
  try {
    const url = new URL(trimmed);
    url.hostname = url.hostname.toLocaleLowerCase("en-US");
    return url.toString();
  } catch {
    return trimmed.toLocaleLowerCase("en-US");
  }
}

function mapSummary(row: MissionSummaryRow): MissionSummary {
  return {
    id: row.id,
    title: row.title,
    journey: row.journey,
    status: row.run_status ?? row.mission_status,
    updatedAt: row.updated_at,
    ...(row.current_phase ? { currentPhase: row.current_phase } : {}),
    ...(row.progress === null ? {} : { progress: Math.round(row.progress * 10_000) / 100 }),
    ...(row.next_action ? { nextAction: row.next_action } : {}),
  };
}

function autonomousContextEligible(
  node: MemoryNode,
  request: AutonomousMissionRequest,
  requirePermittedScope = true,
): boolean {
  const expectedStatus = node.nodeType === "preference" ? "confirmed" : "verified";
  if ((node.nodeType !== "preference" && node.nodeType !== "lesson") || node.lifecycleStatus !== expectedStatus) {
    return false;
  }
  if (node.nodeType === "preference" && node.confirmationState !== "confirmed") return false;
  if (node.sensitivity === "restricted") return false;
  if (node.expiresAt && Date.parse(node.expiresAt) <= Date.now()) return false;
  if (node.retentionPolicy.allowAutonomous === false) return false;
  if (node.retentionPolicy.journeys && !node.retentionPolicy.journeys.includes("autonomous")) return false;
  if (node.scope.kind === "mission") return false;
  if (node.scope.kind === "engagement" && node.scope.engagementId !== request.authorization.engagementId) {
    return false;
  }
  if (requirePermittedScope) {
    const scopes = new Set(request.contract.memoryScopes);
    if (node.nodeType === "preference" && !scopes.has("confirmed_preferences")) return false;
    if (node.nodeType === "lesson" && !scopes.has("verified_lessons")) return false;
    if (node.scope.kind === "engagement" && !scopes.has("engagement_memory")) return false;
  }
  return true;
}

function contextCandidate(node: MemoryNode): AutonomousContextCandidate {
  return {
    id: node.id,
    nodeType: node.nodeType as "preference" | "lesson",
    title: node.title,
    summary: node.summary,
    lifecycleStatus: node.lifecycleStatus as "confirmed" | "verified",
    scope: node.scope.kind === "engagement"
      ? { kind: "engagement", engagementId: node.scope.engagementId }
      : { kind: "global" },
    sensitivity: node.sensitivity as "public" | "internal" | "private",
    confidence: node.confidence,
    provenanceExplanation: node.provenance.explanation,
    updatedAt: node.updatedAt,
  };
}

function decodeCursor(cursor: string | undefined): CursorValue | undefined {
  if (!cursor) return undefined;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (!value || typeof value !== "object") throw new Error("invalid cursor");
    const candidate = value as Record<string, unknown>;
    if (
      typeof candidate.updatedAt !== "string" ||
      Number.isNaN(Date.parse(candidate.updatedAt)) ||
      typeof candidate.id !== "string" ||
      !candidate.id
    ) {
      throw new Error("invalid cursor");
    }
    return { updatedAt: candidate.updatedAt, id: candidate.id };
  } catch {
    throw new RangeError("cursor is invalid");
  }
}

function encodeCursor(row: MissionSummaryRow): string {
  return Buffer.from(JSON.stringify({ updatedAt: row.updated_at, id: row.id }), "utf8").toString(
    "base64url",
  );
}

function parseStoredIdempotency(value: string): StoredIdempotency {
  const parsed = JSON.parse(value) as StoredIdempotency;
  if (!parsed.requestHash || !parsed.response?.mission?.id || !parsed.response?.run?.id) {
    throw new Error("Stored mission idempotency record is corrupt");
  }
  return parsed;
}

const SUMMARY_SELECT = `
  WITH ranked_runs AS (
    SELECT r.*,
      ROW_NUMBER() OVER (PARTITION BY r.mission_id ORDER BY r.created_at DESC, r.id DESC) AS rank
    FROM runs r
  )
  SELECT
    m.id,
    m.name AS title,
    m.journey,
    m.status AS mission_status,
    r.status AS run_status,
    m.updated_at,
    ps.phase AS current_phase,
    r.progress,
    r.next_action_summary AS next_action
  FROM missions m
  LEFT JOIN ranked_runs r ON r.mission_id = m.id AND r.rank = 1
  LEFT JOIN plan_steps ps ON ps.id = r.current_step_id
`;

/** Transactional persistence for mission aggregate creation and portfolio reads. */
export class MissionRepository {
  private readonly events: EventRepository;

  constructor(private readonly database: SqliteDatabase) {
    this.events = new EventRepository(database);
  }

  /**
   * Returns only real, currently eligible memory. Selected IDs are validated
   * independently of the bounded preview so older valid nodes remain usable.
   */
  autonomousContextPreview(request: AutonomousMissionRequest): {
    readonly candidates: readonly AutonomousContextCandidate[];
    readonly selectedNodeIds: readonly string[];
    readonly invalidSelectedNodeIds: readonly string[];
  } {
    const control = getMemoryControlPolicy(this.database);
    if (!control.enabled || !control.autonomousUse) {
      return {
        candidates: [],
        selectedNodeIds: [],
        invalidSelectedNodeIds: [...request.contract.contextNodeIds],
      };
    }
    const memory = new MemoryRepository(this.database);
    const eligible = (node: MemoryNode | undefined, requirePermittedScope = true): node is MemoryNode => Boolean(
      node
      && (control.operationalMemoryEnabled || node.nodeType === "preference")
      && autonomousContextEligible(node, request, requirePermittedScope),
    );
    const invalidSelectedNodeIds = request.contract.contextNodeIds.filter((nodeId) => {
      const node = memory.getNode(nodeId);
      return !eligible(node);
    });
    const selectedNodeIds = request.contract.contextNodeIds.filter(
      (nodeId) => !invalidSelectedNodeIds.includes(nodeId),
    );
    const rows = this.database.prepare(`
      SELECT id FROM memory_nodes
      WHERE node_type IN ('preference', 'lesson')
        AND lifecycle_status IN ('confirmed', 'verified')
        AND sensitivity IN ('public', 'internal', 'private')
        AND (expires_at IS NULL OR expires_at > ?)
        AND (scope = 'global' OR (scope = 'engagement' AND engagement_id = ?))
      ORDER BY pinned DESC, updated_at DESC, id DESC LIMIT 200
    `).all(new Date().toISOString(), request.authorization.engagementId ?? "") as Array<{ id: string }>;
    const listed = rows.flatMap(({ id: nodeId }) => {
      const node = memory.getNode(nodeId);
      return eligible(node, false) ? [contextCandidate(node)] : [];
    });
    const selectedCandidates = selectedNodeIds.flatMap((nodeId) => {
      const node = memory.getNode(nodeId);
      return eligible(node) ? [contextCandidate(node)] : [];
    });
    const selectedSet = new Set(selectedCandidates.map((candidate) => candidate.id));
    const candidates = [
      ...selectedCandidates,
      ...listed.filter((candidate) => !selectedSet.has(candidate.id)),
    ].slice(0, Math.max(100, selectedCandidates.length));
    return { candidates, selectedNodeIds, invalidSelectedNodeIds };
  }

  getIdempotentCreate(
    idempotencyKey: string,
    requestHash: string,
  ): CreatedMission | undefined {
    const row = this.database
      .prepare("SELECT value_json FROM settings WHERE key = ?")
      .get(idempotencySettingKey(idempotencyKey)) as IdempotencyRow | undefined;
    if (!row) return undefined;
    const stored = parseStoredIdempotency(row.value_json);
    if (stored.requestHash !== requestHash) throw new IdempotencyConflictError();
    return stored.response;
  }

  create(options: CreateMissionOptions): CreatedMission {
    return inImmediateTransaction(this.database, () => {
      const replay = this.getIdempotentCreate(options.idempotencyKey, options.requestHash);
      if (replay) return replay;

      const now = new Date().toISOString();
      const missionId = id("mission");
      const runId = id("run");
      const { request } = options;
      const autonomous = request.journey === "autonomous";
      const engagementId = autonomous
        ? request.authorization.engagementId
        : request.engagementId;
      const scope = autonomous
        ? {
            allowedTargets: request.authorization.allowedTargets,
            prohibitedTargets: request.authorization.prohibitedTargets,
            timeWindow: request.authorization.timeWindow ?? null,
            dataHandling: request.authorization.dataHandling ?? null,
          }
        : { target: request.target ?? null };
      const memoryPolicy = autonomous
        ? {
            allowedScopes: request.contract.memoryScopes,
            exactContextNodeIds: request.contract.contextNodeIds,
          }
        : { preferenceUse: "confirmed_or_consent_governed" };
      const retentionPolicy = autonomous
        ? {
            mode: request.contract.retentionPolicy,
            dataHandling: request.contract.dataHandlingPolicy,
          }
        : {};

      this.database
        .prepare(`
          INSERT INTO missions (
            id, name, objective, journey, status, authorization_status,
            engagement_id, scope_json, success_criteria_json,
            retention_policy_json, memory_policy_json, created_by,
            version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `)
        .run(
          missionId,
          request.title,
          request.objective,
          request.journey,
          "verified",
          engagementId ?? null,
          json(scope),
          json(autonomous ? request.successCriteria : []),
          json(retentionPolicy),
          json(memoryPolicy),
          options.actorId,
          now,
          now,
        );

      const insertTarget = this.database.prepare(`
        INSERT INTO mission_targets (
          id, mission_id, target, target_type, disposition,
          normalized_target, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, '{}', ?)
      `);
      if (autonomous) {
        for (const target of request.authorization.allowedTargets) {
          insertTarget.run(
            id("target"),
            missionId,
            target,
            targetType(target),
            "allowed",
            normalizeTarget(target),
            now,
          );
        }
        for (const target of request.authorization.prohibitedTargets) {
          insertTarget.run(
            id("target"),
            missionId,
            target,
            targetType(target),
            "prohibited",
            normalizeTarget(target),
            now,
          );
        }
      } else if (request.target) {
        insertTarget.run(
          id("target"),
          missionId,
          request.target,
          targetType(request.target),
          "allowed",
          normalizeTarget(request.target),
          now,
        );
      }

      const insertConstraint = this.database.prepare(`
        INSERT INTO mission_constraints (
          id, mission_id, constraint_type, value_json, source, created_at
        ) VALUES (?, ?, ?, ?, 'operator', ?)
      `);
      if (autonomous) {
        insertConstraint.run(
          id("constraint"),
          missionId,
          "authorization",
          json(request.authorization),
          now,
        );
        insertConstraint.run(
          id("constraint"),
          missionId,
          "action_policy",
          json({
            allowedActionClasses: request.contract.allowedActionClasses,
            prohibitedActionClasses: request.contract.prohibitedActionClasses,
            destructivePolicy: request.contract.destructivePolicy,
          }),
          now,
        );
        insertConstraint.run(
          id("constraint"),
          missionId,
          "evidence_requirements",
          json(request.contract.evidenceRequirements),
          now,
        );
        insertConstraint.run(
          id("constraint"),
          missionId,
          "data_retention",
          json({
            dataHandlingPolicy: request.contract.dataHandlingPolicy,
            retentionPolicy: request.contract.retentionPolicy,
            operatorConstraints: request.authorization.dataHandling ?? null,
          }),
          now,
        );
        insertConstraint.run(
          id("constraint"),
          missionId,
          "delivery_policy",
          json({
            notificationPolicy: request.contract.notificationPolicy,
            reportingFormat: request.contract.reportingFormat,
            providerPolicy: request.contract.providerPolicy,
            toolPolicy: request.contract.toolPolicy,
          }),
          now,
        );
      } else {
        insertConstraint.run(
          id("constraint"),
          missionId,
          "guided_collaboration",
          json({
            explanationDepth: request.explanationDepth,
            executionPreference: request.executionPreference,
            evidenceExpectations: request.evidenceExpectations,
          }),
          now,
        );
      }

      let contractId: string | null = null;
      let contractHash: string | null = null;
      const budget = autonomous
        ? {
            timeBudgetMinutes: request.contract.timeBudgetMinutes,
            tokenBudget: request.contract.tokenBudget ?? null,
            costBudget: request.contract.costBudget ?? null,
            retryBudget: request.contract.retryBudget,
            replanBudget: request.contract.replanBudget,
            concurrencyLimit: request.contract.concurrencyLimit,
            evidenceBytes: request.contract.evidenceStorageBudgetBytes,
            artifactBytes: request.contract.artifactStorageBudgetBytes,
          }
        : {};
      if (autonomous) {
        contractId = id("contract");
        contractHash = autonomousContractHash(request);
        this.database
          .prepare(`
            INSERT INTO mission_contracts (
              id, mission_id, version, state, contract_hash,
              authorization_json, action_policy_json, budgets_json,
              safe_stop_json, deliverables_json, memory_scopes_json,
              confirmed_by, confirmed_at, created_at
            ) VALUES (?, ?, 1, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            contractId,
            missionId,
            contractHash,
            json(request.authorization),
            json({
              allowedActionClasses: request.contract.allowedActionClasses,
              prohibitedActionClasses: request.contract.prohibitedActionClasses,
              destructivePolicy: request.contract.destructivePolicy,
              evidenceRequirements: request.contract.evidenceRequirements,
              notificationPolicy: request.contract.notificationPolicy,
              reportingFormat: request.contract.reportingFormat,
              dataHandlingPolicy: request.contract.dataHandlingPolicy,
              retentionPolicy: request.contract.retentionPolicy,
              providerPolicy: request.contract.providerPolicy,
              toolPolicy: request.contract.toolPolicy,
              contextNodeIds: request.contract.contextNodeIds,
            }),
            json(budget),
            json({ conditions: request.contract.safeStopConditions }),
            json(request.contract.deliverables),
            json(request.contract.memoryScopes),
            options.actorId,
            now,
            now,
          );
      }

      const nextAction = autonomous
        ? "Build and version the first in-contract plan"
        : "Explain the assessment path and recommend the first bounded step";
      this.database
        .prepare(`
          INSERT INTO runs (
            id, mission_id, journey, status, contract_id,
            progress, status_reason, next_action_summary,
            budget_json, budget_usage_json, started_at,
            created_at, updated_at, version
          ) VALUES (?, ?, ?, 'planning', ?, 0, ?, ?, ?, '{}', ?, ?, ?, 1)
        `)
        .run(
          runId,
          missionId,
          request.journey,
          contractId,
          autonomous
            ? "Autonomous contract confirmed; durable planning may proceed without routine input."
            : "Guided mission created; an explained first step must precede any consequential action.",
          nextAction,
          json(budget),
          now,
          now,
          now,
        );

      this.events.append({
        missionId,
        runId,
        journey: request.journey,
        eventType: "mission.created",
        actorType: "operator",
        actorId: options.actorId,
        summary: `${autonomous ? "Autonomous" : "Guided"} mission created as a durable objective`,
        payload: {
          missionId,
          runId,
          journey: request.journey,
          authorizationStatus: "verified",
        },
      });
      this.events.append({
        missionId,
        runId,
        journey: request.journey,
        eventType: autonomous ? "run.autonomous_planning_started" : "run.guided_planning_started",
        actorType: "system",
        summary: autonomous
          ? "Autonomous planning started under the confirmed mission contract"
          : "Guided planning started and must produce an explained operator decision",
        payload: {
          status: "planning",
          nextAction,
          ...(contractHash ? { contractHash } : {}),
        },
      });

      const response: CreatedMission = {
        mission: {
          id: missionId,
          title: request.title,
          journey: request.journey,
          status: "active",
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
        run: { id: runId, status: "planning", journey: request.journey },
        nextUrl: autonomous ? `/missions/${missionId}` : `/guided/${missionId}`,
      };

      const auditDetails = {
        journey: request.journey,
        runId,
        contractHash,
        idempotentMutation: true,
      };
      const previous = this.database
        .prepare("SELECT record_hash FROM audit_records ORDER BY occurred_at DESC, id DESC LIMIT 1")
        .get() as { record_hash: string } | undefined;
      const auditId = id("audit");
      const auditHash = hashCanonical({
        id: auditId,
        previousHash: previous?.record_hash ?? null,
        journey: request.journey,
        actor: options.actorId,
        action: "mission.created",
        resourceId: missionId,
        details: auditDetails,
        occurredAt: now,
      });
      this.database
        .prepare(`
          INSERT INTO audit_records (
            id, mission_id, run_id, journey, actor_type, actor_id, action,
            resource_type, resource_id, reason, details_json,
            previous_hash, record_hash, occurred_at
          ) VALUES (?, ?, ?, ?, 'operator', ?, 'mission.created', 'mission', ?, ?, ?, ?, ?, ?)
        `)
        .run(
          auditId,
          missionId,
          runId,
          request.journey,
          options.actorId,
          missionId,
          autonomous ? "Confirmed Autonomous contract" : "Created Guided mission",
          json(auditDetails),
          previous?.record_hash ?? null,
          auditHash,
          now,
        );

      this.database
        .prepare(`
          INSERT INTO settings (
            key, value_json, sensitivity, version, updated_by, updated_at
          ) VALUES (?, ?, 'private', 1, ?, ?)
        `)
        .run(
          idempotencySettingKey(options.idempotencyKey),
          json({ requestHash: options.requestHash, response }),
          options.actorId,
          now,
        );

      return response;
    });
  }

  list(options: ListMissionsOptions = {}): MissionListPage {
    const limit = options.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError("limit must be an integer between 1 and 100");
    }
    const cursor = decodeCursor(options.cursor);
    const where: string[] = ["m.status != 'archived'"];
    const parameters: unknown[] = [];
    if (cursor) {
      where.push("(m.updated_at < ? OR (m.updated_at = ? AND m.id < ?))");
      parameters.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
    }
    if (options.journey) {
      where.push("m.journey = ?");
      parameters.push(options.journey);
    }
    if (options.status) {
      where.push("COALESCE(r.status, m.status) = ?");
      parameters.push(options.status);
    }
    if (options.query) {
      where.push(`instr(lower(
        m.id || ' ' || m.name || ' ' || m.objective || ' ' || m.journey || ' ' ||
        COALESCE(r.id, '') || ' ' || COALESCE(r.status, '') || ' ' ||
        COALESCE(ps.phase, '') || ' ' || COALESCE(r.next_action_summary, '')
      ), lower(?)) > 0`);
      parameters.push(options.query);
    }
    parameters.push(limit + 1);
    const rows = this.database
      .prepare(`${SUMMARY_SELECT} WHERE ${where.join(" AND ")} ORDER BY m.updated_at DESC, m.id DESC LIMIT ?`)
      .all(...parameters) as MissionSummaryRow[];
    const hasMore = rows.length > limit;
    const visible = rows.slice(0, limit);
    return {
      schemaVersion: "2.1",
      items: visible.map(mapSummary),
      nextCursor: hasMore && visible.length > 0 ? encodeCursor(visible[visible.length - 1]!) : null,
    };
  }

  listRecent(limit = 12): MissionSummary[] {
    return [...this.list({ limit }).items];
  }
}
