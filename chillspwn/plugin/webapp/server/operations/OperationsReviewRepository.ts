import { randomUUID } from "node:crypto";
import type { SqliteDatabase } from "../db";
import { inImmediateTransaction } from "../db";
import { conflict, forbidden, notFound } from "./errors";
import { lessonScopeSql, missionScopeSql, sensitivitySql } from "./scope";
import type { OperationsActor, OperationsAccessPolicy } from "./types";
import { OPERATIONS_SCHEMA_VERSION } from "./types";
import { canonicalJson, sanitizeJson, sha256 } from "./validation";
import { AttackChainLearningService } from "../learning";

type Row = Record<string, any>;

export interface FindingReviewInput {
  readonly expectedVersion: number;
  readonly status: "under_review" | "verified" | "rejected" | "accepted_risk";
  readonly reason: string;
  readonly operatorOverride: boolean;
}

export interface LessonReviewInput {
  readonly expectedUpdatedAt: string;
  readonly status: "under_review" | "verified" | "rejected" | "stale" | "superseded";
  readonly reason: string;
}

const FINDING_TRANSITIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  draft: new Set(["under_review", "rejected"]),
  under_review: new Set(["verified", "rejected", "accepted_risk"]),
  verified: new Set(["under_review"]),
  rejected: new Set(["under_review"]),
  accepted_risk: new Set(["under_review"]),
};

const LESSON_TRANSITIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  proposed: new Set(["under_review", "rejected"]),
  under_review: new Set(["verified", "rejected"]),
  verified: new Set(["stale", "superseded"]),
  rejected: new Set(["under_review"]),
  stale: new Set(["under_review", "superseded"]),
  superseded: new Set(),
};

function settingKey(kind: string, actorId: string, key: string): string {
  return `idempotency.operations.${kind}.${sha256(`${actorId}\u0000${key}`)}`;
}

function nextTimestamp(current: string, clock: () => Date): string {
  const now = clock().getTime();
  const previous = Date.parse(current);
  return new Date(Number.isFinite(previous) ? Math.max(now, previous + 1) : now).toISOString();
}

/** Transactional evidence/lesson review with idempotency and audit chaining. */
export class OperationsReviewRepository {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  reviewFinding(
    findingId: string,
    input: FindingReviewInput,
    idempotencyKey: string,
    actor: OperationsActor,
    access: OperationsAccessPolicy,
  ): Record<string, unknown> {
    if (!access.canReviewFindings) throw forbidden("This identity cannot review findings.");
    return inImmediateTransaction(this.database, () => {
      const scope = missionScopeSql("m", access);
      const row = this.database.prepare(`
        SELECT f.*, m.engagement_id FROM findings f
        JOIN missions m ON m.id = f.mission_id
        WHERE f.id = ? AND ${scope.sql}
      `).get(findingId, ...scope.params) as Row | undefined;
      if (!row) throw notFound("Finding");

      const requestHash = sha256(canonicalJson({ actor: actor.id, findingId, input }));
      const replay = this.idempotencyReplay(settingKey("finding", actor.id, idempotencyKey), requestHash);
      if (replay) return replay;
      if (Number(row.version) !== input.expectedVersion) {
        throw conflict("The finding changed after it was loaded.");
      }
      if (!FINDING_TRANSITIONS[row.review_status]?.has(input.status)) {
        throw conflict(`Finding cannot transition from ${row.review_status} to ${input.status}.`);
      }

      const visibleEvidence = sensitivitySql("e.sensitivity", access);
      const evidenceCount = Number((this.database.prepare(`
        SELECT COUNT(*) AS count FROM finding_evidence fe
        JOIN evidence e ON e.id = fe.evidence_id
        WHERE fe.finding_id = ? AND fe.relationship = 'supports' AND ${visibleEvidence.sql}
      `).get(findingId, ...visibleEvidence.params) as Row).count);
      if (input.status === "verified" && evidenceCount === 0) {
        if (!input.operatorOverride) {
          throw conflict(
            "A finding cannot be verified without linked supporting evidence.",
            "Attach immutable supporting evidence, then retry verification.",
          );
        }
        if (!access.canOverrideEvidenceGate) {
          throw forbidden("This identity cannot override the finding evidence gate.");
        }
      }
      if (input.operatorOverride && input.status !== "verified") {
        throw conflict("Evidence override is valid only while verifying a finding.");
      }

      const updatedAt = nextTimestamp(row.updated_at, this.clock);
      this.database.prepare(`
        UPDATE findings SET review_status = ?, operator_override = ?,
          version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?
      `).run(input.status, input.operatorOverride ? 1 : 0, updatedAt, findingId, input.expectedVersion);

      const response = {
        schemaVersion: OPERATIONS_SCHEMA_VERSION,
        finding: {
          id: findingId,
          missionId: row.mission_id,
          reviewStatus: input.status,
          operatorOverride: input.operatorOverride,
          evidenceCount,
          version: input.expectedVersion + 1,
          reviewedBy: actor.id,
          reviewedAt: updatedAt,
        },
      };
      this.appendAudit({
        missionId: row.mission_id,
        runId: row.run_id,
        actor,
        action: "finding.reviewed",
        resourceType: "finding",
        resourceId: findingId,
        reason: input.reason,
        details: {
          from: row.review_status,
          to: input.status,
          operatorOverride: input.operatorOverride,
          evidenceCount,
          previousVersion: input.expectedVersion,
          version: input.expectedVersion + 1,
        },
        occurredAt: updatedAt,
      });
      this.saveIdempotency(settingKey("finding", actor.id, idempotencyKey), requestHash, response, actor.id, updatedAt);
      return response;
    });
  }

  reviewLesson(
    lessonId: string,
    input: LessonReviewInput,
    idempotencyKey: string,
    actor: OperationsActor,
    access: OperationsAccessPolicy,
  ): Record<string, unknown> {
    if (!access.canReviewLessons) throw forbidden("This identity cannot review lessons.");
    return inImmediateTransaction(this.database, () => {
      const scope = lessonScopeSql("l", access);
      const row = this.database.prepare(`SELECT * FROM lessons l WHERE l.id = ? AND ${scope.sql}`)
        .get(lessonId, ...scope.params) as Row | undefined;
      if (!row) throw notFound("Lesson");

      const requestHash = sha256(canonicalJson({ actor: actor.id, lessonId, input }));
      const key = settingKey("lesson", actor.id, idempotencyKey);
      const replay = this.idempotencyReplay(key, requestHash);
      if (replay) return replay;
      if (row.updated_at !== input.expectedUpdatedAt) {
        throw conflict("The lesson changed after it was loaded.");
      }
      if (!LESSON_TRANSITIONS[row.status]?.has(input.status)) {
        throw conflict(`Lesson cannot transition from ${row.status} to ${input.status}.`);
      }
      if (input.status === "verified" && row.authoring_agent_id === actor.id) {
        throw forbidden(
          "An agent cannot approve its own lesson.",
          "Ask a different authorized reviewer to verify the evidence-linked lesson.",
        );
      }
      const visibleEvidence = sensitivitySql("e.sensitivity", access);
      const supportCount = Number((this.database.prepare(`
        SELECT COUNT(*) AS count FROM lesson_evidence le
        LEFT JOIN evidence e ON e.id = le.evidence_id
        WHERE le.lesson_id = ? AND le.relationship = 'supports'
          AND (le.evidence_id IS NULL OR ${visibleEvidence.sql})
      `).get(lessonId, ...visibleEvidence.params) as Row).count);
      if (input.status === "verified" && supportCount === 0) {
        throw conflict(
          "A lesson cannot be verified without linked supporting evidence or a supporting run.",
          "Attach supporting evidence and have an independent reviewer retry verification.",
        );
      }
      if (input.status === "verified" && row.lesson_type === "attack_chain") {
        const details = new AttackChainLearningService(this.database, { clock: this.clock })
          .detailsForReview(lessonId);
        const sourceCounts = this.database.prepare(`
          SELECT
            SUM(evidence_id IS NOT NULL AND relationship = 'supports') AS evidence_count,
            SUM(run_id IS NOT NULL AND relationship = 'supports') AS run_count
          FROM lesson_evidence WHERE lesson_id = ?
        `).get(lessonId) as { evidence_count: number | null; run_count: number | null };
        if (!details || Number(sourceCounts.evidence_count ?? 0) === 0 || Number(sourceCounts.run_count ?? 0) === 0) {
          throw conflict(
            "An attack chain cannot be verified without complete executable details, verified evidence, and a source run.",
            "Attach the canonical chain details and both evidence/run provenance before independent review.",
          );
        }
      }

      const updatedAt = nextTimestamp(row.updated_at, this.clock);
      const reviewed = input.status === "under_review" ? null : actor.id;
      const reviewedAt = input.status === "under_review" ? null : updatedAt;
      this.database.prepare(`
        UPDATE lessons SET status = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
        WHERE id = ? AND updated_at = ?
      `).run(input.status, reviewed, reviewedAt, updatedAt, lessonId, input.expectedUpdatedAt);
      const memoryNodeId = new AttackChainLearningService(this.database, { clock: this.clock })
        .synchronizeMemoryLifecycle(lessonId, input.status, actor.id);

      const response = {
        schemaVersion: OPERATIONS_SCHEMA_VERSION,
        lesson: {
          id: lessonId,
          status: input.status,
          supportingEvidenceCount: supportCount,
          reviewedBy: reviewed,
          reviewedAt,
          updatedAt,
          memoryNodeId,
        },
      };
      this.appendAudit({
        missionId: row.mission_id,
        runId: null,
        actor,
        action: "lesson.reviewed",
        resourceType: "lesson",
        resourceId: lessonId,
        reason: input.reason,
        details: { from: row.status, to: input.status, supportCount },
        occurredAt: updatedAt,
      });
      this.saveIdempotency(key, requestHash, response, actor.id, updatedAt);
      return response;
    });
  }

  private idempotencyReplay(key: string, requestHash: string): Record<string, unknown> | undefined {
    const row = this.database.prepare("SELECT value_json FROM settings WHERE key = ?").get(key) as Row | undefined;
    if (!row) return undefined;
    const value = JSON.parse(row.value_json) as { requestHash?: string; response?: Record<string, unknown> };
    if (value.requestHash !== requestHash || !value.response) {
      throw conflict("The idempotency key was already used for a different review request.", "Use a new Idempotency-Key for a materially different request.");
    }
    return value.response;
  }

  private saveIdempotency(
    key: string,
    requestHash: string,
    response: Record<string, unknown>,
    actorId: string,
    now: string,
  ): void {
    this.database.prepare(`
      INSERT INTO settings (key, value_json, sensitivity, version, updated_by, updated_at)
      VALUES (?, ?, 'restricted', 1, ?, ?)
    `).run(key, canonicalJson({ requestHash, response }), actorId, now);
  }

  private appendAudit(input: {
    readonly missionId: string | null;
    readonly runId: string | null;
    readonly actor: OperationsActor;
    readonly action: string;
    readonly resourceType: string;
    readonly resourceId: string;
    readonly reason: string;
    readonly details: Record<string, unknown>;
    readonly occurredAt: string;
  }): void {
    const journey = this.resolveAuditJourney(input.missionId, input.runId);
    const previous = this.database.prepare("SELECT record_hash FROM audit_records ORDER BY occurred_at DESC, id DESC LIMIT 1").get() as Row | undefined;
    const id = `audit_${randomUUID()}`;
    const details = sanitizeJson(input.details) as Record<string, unknown>;
    const reason = String(sanitizeJson(input.reason));
    const hashInput = {
      id,
      missionId: input.missionId,
      runId: input.runId,
      journey,
      actorType: input.actor.type,
      actorId: input.actor.id,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      reason,
      details,
      previousHash: previous?.record_hash ?? null,
      occurredAt: input.occurredAt,
    };
    const recordHash = sha256(`${previous?.record_hash ?? ""}\n${canonicalJson(hashInput)}`);
    this.database.prepare(`
      INSERT INTO audit_records (
        id, mission_id, run_id, journey, actor_type, actor_id, action,
        resource_type, resource_id, reason, details_json,
        previous_hash, record_hash, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.missionId,
      input.runId,
      journey,
      input.actor.type,
      input.actor.id,
      input.action,
      input.resourceType,
      input.resourceId,
      reason,
      canonicalJson(details),
      previous?.record_hash ?? null,
      recordHash,
      input.occurredAt,
    );
  }

  private resolveAuditJourney(
    missionId: string | null,
    runId: string | null,
  ): "autonomous" | "guided" | null {
    const row = runId
      ? this.database.prepare("SELECT journey FROM runs WHERE id = ?").get(runId) as Row | undefined
      : missionId
        ? this.database.prepare("SELECT journey FROM missions WHERE id = ?").get(missionId) as Row | undefined
        : undefined;
    const journey = row?.journey;
    if (journey === "autonomous" || journey === "guided") return journey;
    if (missionId || runId) throw new Error("Scoped audit record has no canonical journey");
    return null;
  }
}
