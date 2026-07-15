import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import type { SqliteDatabase } from "../db";
import { inImmediateTransaction } from "../db";
import type { VaultPathPolicy } from "../vault";
import { conflict, forbidden, notFound } from "./errors";
import { missionScopeSql, sensitivitySql } from "./scope";
import type {
  OperationsAccessPolicy,
  OperationsActor,
  OperationsSensitivity,
} from "./types";
import { OPERATIONS_SCHEMA_VERSION } from "./types";
import {
  canonicalJson,
  parseJson,
  sanitizeJson,
  sha256,
} from "./validation";

type Row = Record<string, unknown>;

const DEFAULT_MAXIMUM_ARTIFACT_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAXIMUM_EXPORT_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAXIMUM_EXPORT_RECORDS = 1_000;
const MAXIMUM_STRING_LENGTH = 4_096;
const LOCATION_URI = /\b[a-z][a-z0-9+.-]*:\/\/[^\s,;)'"<>]+/giu;
const POSIX_LOCATION = /(^|[\s'"(])\/(?:[^/\s'"()]+\/)*[^/\s'"()]+/gu;
const WINDOWS_LOCATION = /\b[A-Za-z]:\\(?:[^\\\s'"()]+\\)*[^\\\s'"()]+/gu;

interface RunScopeRow {
  readonly id: string;
  readonly mission_id: string;
  readonly mission_name: string;
  readonly engagement_id: string | null;
  readonly journey: "autonomous" | "guided";
  readonly status: string;
}

interface ArtifactStorageReference {
  readonly connectionId: string;
  readonly contentHash: string;
}

interface DownloadArtifactRow {
  readonly id: string;
  readonly mission_id: string;
  readonly run_id: string | null;
  readonly journey: "autonomous" | "guided";
  readonly artifact_type: string;
  readonly storage_uri: string;
  readonly content_hash: string;
  readonly byte_size: number;
}

interface VaultConnectionRow {
  readonly id: string;
  readonly vault_path: string;
  readonly status: "disconnected" | "connecting" | "connected" | "degraded" | "error";
  readonly permission_granted_at: string;
}

export interface SecureArtifactDownload {
  readonly artifactId: string;
  readonly missionId: string;
  readonly runId: string | null;
  readonly body: Buffer;
  readonly byteSize: number;
  readonly contentHash: string;
  readonly filename: string;
  /** Content is deliberately served as an inert attachment, never inline. */
  readonly mediaType: "application/octet-stream";
}

export interface SecureExportServiceOptions {
  readonly vaultPathPolicy?: VaultPathPolicy;
  readonly maximumArtifactBytes?: number;
  readonly maximumExportBytes?: number;
  readonly maximumExportRecords?: number;
  readonly clock?: () => Date;
}

function configuredBound(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`Secure export bound must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function parseVaultAttachmentStorageUri(value: string): ArtifactStorageReference {
  const match = /^vault-attachment:\/\/([^/?#]+)\/([a-f0-9]{64})$/u.exec(value);
  if (!match) {
    throw conflict(
      "This artifact storage scheme is not available through the canonical content-delivery boundary.",
      "Use a content-addressed Obsidian attachment or export the artifact metadata instead.",
    );
  }
  let connectionId: string;
  try {
    connectionId = decodeURIComponent(match[1]!);
  } catch {
    throw conflict("The canonical artifact storage reference is malformed.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(connectionId)) {
    throw conflict("The canonical artifact storage reference is malformed.");
  }
  return { connectionId, contentHash: match[2]! };
}

function boundedSanitized(value: unknown, depth = 0): unknown {
  const sanitized = depth === 0 ? sanitizeJson(value) : value;
  if (depth > 8) return "[REDACTED: depth limit]";
  if (typeof sanitized === "string") {
    const redacted = sanitized
      .replace(LOCATION_URI, "[REDACTED LOCATION]")
      .replace(POSIX_LOCATION, "$1[REDACTED LOCATION]")
      .replace(WINDOWS_LOCATION, "[REDACTED LOCATION]");
    return redacted.length <= MAXIMUM_STRING_LENGTH
      ? redacted
      : `${redacted.slice(0, MAXIMUM_STRING_LENGTH)}[TRUNCATED]`;
  }
  if (Array.isArray(sanitized)) {
    return sanitized.slice(0, 100).map((item) => boundedSanitized(item, depth + 1));
  }
  if (sanitized && typeof sanitized === "object") {
    return Object.fromEntries(
      Object.entries(sanitized as Record<string, unknown>)
        .slice(0, 100)
        .map(([key, item]) => [key, boundedSanitized(item, depth + 1)]),
    );
  }
  return sanitized;
}

function safeDownloadId(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/gu, "_").slice(0, 96) || "export";
}

/**
 * Narrow delivery boundary for canonical V2 exports and the one artifact
 * storage scheme with a configured, content-addressed filesystem root.
 */
export class SecureExportService {
  readonly #database: SqliteDatabase;
  readonly #vaultPathPolicy?: VaultPathPolicy;
  readonly #maximumArtifactBytes: number;
  readonly #maximumExportBytes: number;
  readonly #maximumExportRecords: number;
  readonly #clock: () => Date;

  constructor(database: SqliteDatabase, options: SecureExportServiceOptions = {}) {
    this.#database = database;
    this.#vaultPathPolicy = options.vaultPathPolicy;
    this.#maximumArtifactBytes = configuredBound(
      options.maximumArtifactBytes,
      DEFAULT_MAXIMUM_ARTIFACT_BYTES,
      256 * 1024 * 1024,
    );
    this.#maximumExportBytes = configuredBound(
      options.maximumExportBytes,
      DEFAULT_MAXIMUM_EXPORT_BYTES,
      64 * 1024 * 1024,
    );
    this.#maximumExportRecords = configuredBound(
      options.maximumExportRecords,
      DEFAULT_MAXIMUM_EXPORT_RECORDS,
      10_000,
    );
    this.#clock = options.clock ?? (() => new Date());
  }

  downloadArtifact(
    artifactId: string,
    actor: OperationsActor,
    access: OperationsAccessPolicy,
  ): SecureArtifactDownload {
    if (!access.canDownloadArtifactContent) {
      throw forbidden("This identity cannot download artifact content.");
    }
    const scope = missionScopeSql("m", access);
    const sensitivity = sensitivitySql("a.sensitivity", access);
    const artifact = this.#database.prepare(`
      SELECT a.*, m.engagement_id, m.name AS mission_name
      FROM artifacts a
      JOIN missions m ON m.id = a.mission_id
      WHERE a.id = ? AND ${scope.sql} AND ${sensitivity.sql}
    `).get(artifactId, ...scope.params, ...sensitivity.params) as DownloadArtifactRow | undefined;
    if (!artifact) throw notFound("Artifact");
    if (artifact.artifact_type !== "obsidian_attachment") {
      throw conflict(
        "This artifact has no approved canonical content-delivery adapter.",
        "Only content-addressed Obsidian attachment artifacts are downloadable. Use the metadata export for other storage schemes.",
      );
    }
    if (!this.#vaultPathPolicy) {
      throw conflict(
        "Canonical artifact delivery is not configured for this deployment.",
        "Configure the same explicit vault root used by the Obsidian bridge before enabling content downloads.",
      );
    }

    const expectedHash = String(artifact.content_hash).toLowerCase();
    const expectedSize = Number(artifact.byte_size);
    if (
      !/^[a-f0-9]{64}$/u.test(expectedHash)
      || !Number.isSafeInteger(expectedSize)
      || expectedSize < 0
      || expectedSize > this.#maximumArtifactBytes
    ) {
      throw conflict("Canonical artifact integrity metadata is invalid or exceeds the download limit.");
    }
    const storage = parseVaultAttachmentStorageUri(String(artifact.storage_uri));
    if (storage.contentHash !== expectedHash) {
      throw conflict("The artifact storage reference does not match its canonical SHA-256 record.");
    }
    const connection = this.#database.prepare(`
      SELECT id, vault_path, status, permission_granted_at
      FROM vault_connections WHERE id = ?
    `).get(storage.connectionId) as VaultConnectionRow | undefined;
    if (
      !connection
      || !connection.permission_granted_at
      || !["connected", "degraded"].includes(connection.status)
    ) {
      throw conflict("The canonical vault connection is not available for artifact delivery.");
    }

    let descriptor: number | undefined;
    let body: Buffer;
    try {
      const vaultRoot = this.#vaultPathPolicy.resolveExistingVault(connection.vault_path);
      const path = this.#vaultPathPolicy.resolveRelative(
        vaultRoot,
        `.chillspwn/attachments/${expectedHash}`,
      );
      descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const before = fstatSync(descriptor);
      if (!before.isFile() || before.size !== expectedSize || before.size > this.#maximumArtifactBytes) {
        throw new Error("artifact_size_or_type_mismatch");
      }
      body = readFileSync(descriptor);
      const after = fstatSync(descriptor);
      if (!after.isFile() || after.size !== before.size || body.length !== expectedSize) {
        throw new Error("artifact_changed_during_verification");
      }
      const actualHash = createHash("sha256").update(body).digest("hex");
      if (actualHash !== expectedHash) throw new Error("artifact_hash_mismatch");
    } catch {
      throw conflict(
        "The canonical artifact failed containment or integrity verification.",
        "Restore the content-addressed regular file from a trusted backup and verify the vault before retrying.",
      );
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }

    const now = this.#clock().toISOString();
    this.#appendAudit({
      missionId: artifact.mission_id,
      runId: artifact.run_id,
      journey: artifact.journey,
      actor,
      action: "artifact.content_downloaded",
      resourceType: "artifact",
      resourceId: artifact.id,
      reason: "Authorized operator downloaded verified canonical artifact content.",
      details: {
        storageScheme: "vault-attachment",
        contentHash: expectedHash,
        byteSize: expectedSize,
        inertAttachment: true,
      },
      occurredAt: now,
    });
    return {
      artifactId: artifact.id,
      missionId: artifact.mission_id,
      runId: artifact.run_id,
      body,
      byteSize: expectedSize,
      contentHash: expectedHash,
      filename: `chillspwn-artifact-${safeDownloadId(artifact.id)}.bin`,
      mediaType: "application/octet-stream",
    };
  }

  exportEvidenceBundle(
    runId: string,
    actor: OperationsActor,
    access: OperationsAccessPolicy,
  ): Record<string, unknown> {
    if (!access.canExportEvidenceBundles) {
      throw forbidden("This identity cannot export evidence bundles.");
    }
    const run = this.#requireRun(runId, access);
    const sensitivity = sensitivitySql("e.sensitivity", access);
    const evidenceRows = this.#database.prepare(`
      SELECT e.*
      FROM evidence e
      WHERE e.run_id = ? AND e.mission_id = ? AND ${sensitivity.sql}
      ORDER BY e.acquired_at, e.id
      LIMIT ?
    `).all(runId, run.mission_id, ...sensitivity.params, this.#maximumExportRecords + 1) as Row[];
    const visibleEvidence = evidenceRows.slice(0, this.#maximumExportRecords);
    const visibleEvidenceIdList = visibleEvidence.map((row) => String(row.id));
    const evidenceIdPlaceholders = visibleEvidenceIdList.map(() => "?").join(",");

    const artifactSensitivity = sensitivitySql("a.sensitivity", access);
    const artifactEvidenceSensitivity = sensitivitySql("e.sensitivity", access);
    const artifactRows = visibleEvidenceIdList.length === 0
      ? []
      : this.#database.prepare(`
          SELECT DISTINCT a.id, a.artifact_type, a.content_hash, a.byte_size,
            a.media_type, a.sensitivity, a.storage_uri, a.created_at
          FROM artifacts a
          JOIN evidence e ON e.artifact_id = a.id
          WHERE e.run_id = ? AND e.mission_id = ?
            AND e.id IN (${evidenceIdPlaceholders})
            AND ${artifactSensitivity.sql} AND ${artifactEvidenceSensitivity.sql}
          ORDER BY a.created_at, a.id
          LIMIT ?
        `).all(
          runId,
          run.mission_id,
          ...visibleEvidenceIdList,
          ...artifactSensitivity.params,
          ...artifactEvidenceSensitivity.params,
          this.#maximumExportRecords + 1,
        ) as Row[];
    const visibleArtifacts = artifactRows.slice(0, this.#maximumExportRecords);
    const visibleArtifactIds = new Set(visibleArtifacts.map((row) => String(row.id)));

    const chainSensitivity = sensitivitySql("e.sensitivity", access);
    const chainRows = visibleEvidenceIdList.length === 0
      ? []
      : this.#database.prepare(`
          SELECT ce.id, ce.evidence_id, ce.event_type, ce.actor, ce.occurred_at
          FROM evidence_chain_events ce
          JOIN evidence e ON e.id = ce.evidence_id
          WHERE e.run_id = ? AND e.mission_id = ?
            AND e.id IN (${evidenceIdPlaceholders}) AND ${chainSensitivity.sql}
          ORDER BY ce.occurred_at, ce.id
          LIMIT ?
        `).all(
          runId,
          run.mission_id,
          ...visibleEvidenceIdList,
          ...chainSensitivity.params,
          this.#maximumExportRecords + 1,
        ) as Row[];
    const chain = chainRows.slice(0, this.#maximumExportRecords);

    const linkSensitivity = sensitivitySql("e.sensitivity", access);
    const findingLinkRows = visibleEvidenceIdList.length === 0
      ? []
      : this.#database.prepare(`
          SELECT fe.finding_id, fe.evidence_id, fe.relationship,
            f.title, f.severity, f.review_status
          FROM finding_evidence fe
          JOIN evidence e ON e.id = fe.evidence_id
          JOIN findings f ON f.id = fe.finding_id
          WHERE e.run_id = ? AND e.mission_id = ?
            AND e.id IN (${evidenceIdPlaceholders}) AND ${linkSensitivity.sql}
          ORDER BY f.updated_at, fe.finding_id, fe.evidence_id
          LIMIT ?
        `).all(
          runId,
          run.mission_id,
          ...visibleEvidenceIdList,
          ...linkSensitivity.params,
          this.#maximumExportRecords + 1,
        ) as Row[];
    const findingLinks = findingLinkRows.slice(0, this.#maximumExportRecords);

    const generatedAt = this.#clock().toISOString();
    const metadata = {
      schemaVersion: OPERATIONS_SCHEMA_VERSION,
      exportKind: "run_evidence_metadata" as const,
      generatedAt,
      mission: {
        id: run.mission_id,
        name: boundedSanitized(run.mission_name),
        engagementId: run.engagement_id,
      },
      run: { id: run.id, journey: run.journey, status: run.status },
      evidence: visibleEvidence.map((row) => ({
        id: row.id,
        acquiredAt: row.acquired_at,
        source: boundedSanitized(row.source),
        target: boundedSanitized(row.target),
        evidenceType: row.evidence_type,
        contentHash: row.content_hash,
        confidence: row.confidence === null ? null : Number(row.confidence),
        sensitivity: row.sensitivity as OperationsSensitivity,
        verificationState: row.verification_state,
        summary: boundedSanitized(row.summary),
        artifactId: row.artifact_id && visibleArtifactIds.has(String(row.artifact_id))
          ? row.artifact_id
          : null,
        createdBy: boundedSanitized(row.created_by),
        createdAt: row.created_at,
      })),
      chainOfCustody: chain.map((row) => ({
        id: row.id,
        evidenceId: row.evidence_id,
        eventType: row.event_type,
        actor: boundedSanitized(row.actor),
        occurredAt: row.occurred_at,
      })),
      findingLinks: findingLinks.map((row) => ({
        findingId: row.finding_id,
        evidenceId: row.evidence_id,
        relationship: row.relationship,
        title: boundedSanitized(row.title),
        severity: row.severity,
        reviewStatus: row.review_status,
      })),
      artifacts: visibleArtifacts.map((row) => ({
        id: row.id,
        artifactType: row.artifact_type,
        contentHash: row.content_hash,
        byteSize: Number(row.byte_size),
        mediaType: row.media_type,
        sensitivity: row.sensitivity,
        storageScheme: /^([a-z][a-z0-9+.-]*):/iu.exec(String(row.storage_uri))?.[1]?.toLowerCase() ?? "unknown",
        createdAt: row.created_at,
      })),
      truncation: {
        evidence: evidenceRows.length > this.#maximumExportRecords,
        chainOfCustody: chainRows.length > this.#maximumExportRecords,
        findingLinks: findingLinkRows.length > this.#maximumExportRecords,
        artifacts: artifactRows.length > this.#maximumExportRecords,
      },
      privacy: {
        metadataOnly: true as const,
        omitted: [
          "raw evidence and extracted text",
          "provenance payloads and chain-event details",
          "artifact paths, URLs, metadata, and file contents",
          "provider, tool, authentication, and conversation payloads",
        ],
      },
    };
    const exported = {
      ...metadata,
      integrity: { algorithm: "sha256" as const, digest: sha256(canonicalJson(metadata)) },
    };
    this.#assertExportSize(exported);
    this.#appendAudit({
      missionId: run.mission_id,
      runId: run.id,
      journey: run.journey,
      actor,
      action: "evidence.bundle_exported",
      resourceType: "run",
      resourceId: run.id,
      reason: "Authorized operator exported a bounded redacted evidence metadata bundle.",
      details: {
        exportHash: exported.integrity.digest,
        evidenceCount: visibleEvidence.length,
        artifactCount: visibleArtifacts.length,
        truncation: exported.truncation,
        metadataOnly: true,
      },
      occurredAt: generatedAt,
    });
    return exported;
  }

  exportAuditRecords(
    runId: string,
    actor: OperationsActor,
    access: OperationsAccessPolicy,
  ): Record<string, unknown> {
    if (!access.canExportAuditRecords) {
      throw forbidden("This identity cannot export immutable audit records.");
    }
    if (access.maximumSensitivity !== "restricted") {
      throw forbidden(
        "Audit-record exports require restricted-sensitivity access.",
        "Use a reviewer identity explicitly authorized for restricted operational audit data.",
      );
    }
    const run = this.#requireRun(runId, access);
    const rows = this.#database.prepare(`
      SELECT ar.id, ar.actor_type, ar.actor_id, ar.action, ar.resource_type,
        ar.resource_id, ar.reason, ar.details_json, ar.previous_hash,
        ar.record_hash, ar.occurred_at
      FROM audit_records ar
      WHERE ar.run_id = ? AND ar.mission_id = ?
      ORDER BY ar.occurred_at, ar.id
      LIMIT ?
    `).all(run.id, run.mission_id, this.#maximumExportRecords + 1) as Row[];
    const visible = rows.slice(0, this.#maximumExportRecords);
    const generatedAt = this.#clock().toISOString();
    const metadata = {
      schemaVersion: OPERATIONS_SCHEMA_VERSION,
      exportKind: "run_audit_records" as const,
      generatedAt,
      mission: {
        id: run.mission_id,
        name: boundedSanitized(run.mission_name),
        engagementId: run.engagement_id,
      },
      run: { id: run.id, journey: run.journey, status: run.status },
      records: visible.map((row) => ({
        id: row.id,
        actorType: row.actor_type,
        actorId: boundedSanitized(row.actor_id),
        action: row.action,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        reason: boundedSanitized(row.reason),
        details: boundedSanitized(parseJson(
          typeof row.details_json === "string" ? row.details_json : null,
        )),
        previousHash: row.previous_hash,
        recordHash: row.record_hash,
        occurredAt: row.occurred_at,
      })),
      selection: {
        scope: "exact_run" as const,
        globalChainSubset: true as const,
        note: "The canonical audit chain is global; omitted records can make adjacent exported hashes non-contiguous.",
      },
      truncation: { records: rows.length > this.#maximumExportRecords },
      privacy: {
        redacted: true as const,
        omitted: [
          "audit records for other missions and runs",
          "credential-like values in reasons and details",
          "raw operational payloads not retained by the audit record",
        ],
      },
    };
    const exported = {
      ...metadata,
      integrity: { algorithm: "sha256" as const, digest: sha256(canonicalJson(metadata)) },
    };
    this.#assertExportSize(exported);
    this.#appendAudit({
      missionId: run.mission_id,
      runId: run.id,
      journey: run.journey,
      actor,
      action: "audit.records_exported",
      resourceType: "run",
      resourceId: run.id,
      reason: "Authorized reviewer exported a bounded redacted run-scoped audit record subset.",
      details: {
        exportHash: exported.integrity.digest,
        recordCount: visible.length,
        truncated: exported.truncation.records,
        restrictedAccessRequired: true,
      },
      occurredAt: generatedAt,
    });
    return exported;
  }

  #requireRun(runId: string, access: OperationsAccessPolicy): RunScopeRow {
    const scope = missionScopeSql("m", access);
    const run = this.#database.prepare(`
      SELECT r.id, r.mission_id, r.journey, r.status,
        m.name AS mission_name, m.engagement_id
      FROM runs r
      JOIN missions m ON m.id = r.mission_id
      WHERE r.id = ? AND ${scope.sql}
    `).get(runId, ...scope.params) as RunScopeRow | undefined;
    if (!run) throw notFound("Run");
    return run;
  }

  #assertExportSize(exported: unknown): void {
    if (Buffer.byteLength(JSON.stringify(exported), "utf8") + 1 > this.#maximumExportBytes) {
      throw conflict(
        "The redacted export exceeds the configured response-size limit.",
        "Narrow the requested run or reduce retained metadata before retrying.",
      );
    }
  }

  #appendAudit(input: {
    readonly missionId: string;
    readonly runId: string | null;
    readonly journey: "autonomous" | "guided";
    readonly actor: OperationsActor;
    readonly action: string;
    readonly resourceType: string;
    readonly resourceId: string;
    readonly reason: string;
    readonly details: unknown;
    readonly occurredAt: string;
  }): void {
    inImmediateTransaction(this.#database, () => {
      const previous = this.#database.prepare(`
        SELECT record_hash FROM audit_records
        ORDER BY occurred_at DESC, id DESC LIMIT 1
      `).get() as { readonly record_hash: string } | undefined;
      const id = `audit_${randomUUID()}`;
      const details = boundedSanitized(input.details);
      const record = {
        id,
        missionId: input.missionId,
        runId: input.runId,
        journey: input.journey,
        actorType: input.actor.type,
        actorId: input.actor.id,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        reason: input.reason,
        details,
        previousHash: previous?.record_hash ?? null,
        occurredAt: input.occurredAt,
      };
      const recordHash = sha256(`${previous?.record_hash ?? ""}\n${canonicalJson(record)}`);
      this.#database.prepare(`
        INSERT INTO audit_records (
          id, mission_id, run_id, journey, actor_type, actor_id, action,
          resource_type, resource_id, reason, details_json, previous_hash,
          record_hash, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.missionId,
        input.runId,
        input.journey,
        input.actor.type,
        input.actor.id,
        input.action,
        input.resourceType,
        input.resourceId,
        input.reason,
        canonicalJson(details),
        previous?.record_hash ?? null,
        recordHash,
        input.occurredAt,
      );
    });
  }
}
