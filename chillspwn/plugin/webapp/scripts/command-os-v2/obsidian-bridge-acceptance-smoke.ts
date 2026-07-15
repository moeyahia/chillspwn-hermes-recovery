#!/usr/bin/env bun

/**
 * Opt-in physical-filesystem acceptance smoke for the real Obsidian bridge.
 *
 * The script creates one fresh SQLite database and vault beneath /tmp, never
 * reads deployment configuration, never accepts external paths, and removes
 * the entire workspace after closing SQLite (including on failure).
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { createDatabaseConnection, migrateDatabase, type SqliteDatabase } from "../../server/db/index";
import {
  MemoryRepository,
  MemoryRetrievalService,
  type CreateMemoryEdgeInput,
  type CreateMemoryNodeInput,
  type MemoryNode,
  type MemoryProvenance,
} from "../../server/memory/index";
import {
  ObsidianVaultBridge,
  parseObsidianNote,
  VaultPathPolicy,
} from "../../server/vault/index";
import {
  OBSIDIAN_SMOKE_PREFIX,
  buildObsidianSmokePaths,
  removeObsidianSmokeWorkspace,
  validateObsidianSmokeGate,
} from "./obsidian-bridge-acceptance-smoke-lib";

const ACTOR = "operator-acceptance-smoke";
const ACQUIRED_AT = "2026-07-15T00:00:00.000Z";

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function provenance(sourceId: string, method: MemoryProvenance["method"] = "observation"): MemoryProvenance {
  return {
    method,
    explanation: "Generated inside the isolated Obsidian bridge acceptance workspace",
    sources: [{
      sourceType: "acceptance_smoke",
      sourceId,
      acquiredAt: ACQUIRED_AT,
      sourceHash: sha256(sourceId),
      excerptRedacted: "Synthetic non-sensitive acceptance evidence",
    }],
  };
}

function createNode(
  memory: MemoryRepository,
  input: Pick<CreateMemoryNodeInput, "id" | "nodeType" | "title" | "summary" | "body">
    & Partial<Pick<CreateMemoryNodeInput, "scope" | "lifecycleStatus" | "confirmationState" | "authorType">>,
): MemoryNode {
  const lifecycleStatus = input.lifecycleStatus ?? "confirmed";
  return memory.createNode({
    ...input,
    scope: input.scope ?? { kind: "global" },
    sensitivity: "private",
    confidence: 0.97,
    lifecycleStatus,
    confirmationState: input.confirmationState
      ?? (lifecycleStatus === "confirmed" ? "confirmed" : "not_required"),
    provenance: provenance(`source-${input.id}`),
    authorType: input.authorType ?? "operator",
    authorId: ACTOR,
    retentionPolicy: { allowAutonomous: true, allowGuided: true },
  });
}

function createEdge(
  memory: MemoryRepository,
  input: Pick<CreateMemoryEdgeInput, "id" | "sourceNodeId" | "targetNodeId" | "edgeType" | "title">,
): void {
  memory.createEdge({
    ...input,
    summary: `Synthetic ${input.edgeType} relationship for physical-vault acceptance`,
    scope: { kind: "global" },
    sensitivity: "private",
    confidence: 0.96,
    lifecycleStatus: "confirmed",
    provenance: provenance(`source-${input.id}`, "derived"),
    explanation: `The isolated acceptance graph records ${input.edgeType} between these canonical nodes`,
    authorType: "operator",
    authorId: ACTOR,
  });
}

interface SmokeEvidence {
  readonly passed: true;
  readonly isolation: {
    readonly workspaceKind: "fresh-/tmp-workspace";
    readonly productionConfigurationRead: false;
    cleanupVerified: boolean;
  };
  readonly graph: {
    readonly nodeCount: number;
    readonly nodeTypes: readonly string[];
    readonly edgeCount: number;
    readonly edgeTypes: readonly string[];
  };
  readonly projection: {
    readonly notesExported: number;
    readonly stableIdsVerified: number;
    readonly nativeWikilinksVerified: number;
    readonly attachmentId: string;
    readonly attachmentSha256: string;
    readonly canonicalAttachmentRelativePath: string;
    readonly attachmentReferenceVerified: true;
    readonly originalFilenameExcludedFromMemory: true;
    readonly portableAttachmentVerified: true;
    readonly attachmentMode: "canonical-mission-artifact-lifecycle";
  };
  readonly operatorEdit: {
    readonly nodeId: string;
    readonly syncStatus: "synced";
    readonly versionHistory: readonly number[];
    readonly operatorAttributionPreserved: true;
  };
  readonly conflict: {
    readonly nodeId: string;
    readonly detectedStatus: "conflict";
    readonly resolution: "merged";
    readonly finalStatus: "synced";
    readonly durableConflictStatus: "resolved_merged";
    readonly versionHistory: readonly number[];
  };
  readonly forgetting: {
    readonly nodeId: string;
    readonly projectionRemoved: true;
    readonly retrievalCountBefore: number;
    readonly retrievalCountAfter: 0;
    readonly versionsRemoved: number;
    readonly sourcesRemoved: number;
    readonly edgesRemoved: number;
    readonly tombstoneLifecycle: "forgotten";
  };
  readonly preForgetSyncHealthy: true;
}

async function runSmoke(database: SqliteDatabase, workspaceRoot: string): Promise<SmokeEvidence> {
  const paths = buildObsidianSmokePaths(workspaceRoot);
  migrateDatabase(database);
  const memory = new MemoryRepository(database);
  const retrieval = new MemoryRetrievalService(memory);
  const pathPolicy = new VaultPathPolicy(paths.allowedVaultRoot);
  const bridge = new ObsidianVaultBridge(database, memory, pathPolicy);
  const connection = bridge.connect({
    id: "vault-acceptance-smoke",
    vaultPath: paths.vaultName,
    displayName: "ChillsPwn Brain Acceptance",
    permissionGranted: true,
  });

  const missionId = "mission-obsidian-acceptance-smoke";
  const engagementId = "engagement-obsidian-acceptance-smoke";
  database.prepare(`
    INSERT INTO missions (
      id, name, objective, journey, status, authorization_status, engagement_id,
      scope_json, success_criteria_json, retention_policy_json, memory_policy_json,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, 'guided', 'active', 'verified', ?, '{}', '[]', '{}', '{}', ?, ?, ?)
  `).run(
    missionId,
    "Physical Obsidian attachment acceptance",
    "Verify the mission-scoped content-addressed attachment lifecycle",
    engagementId,
    ACTOR,
    ACQUIRED_AT,
    ACQUIRED_AT,
  );

  const attachmentContent = [
    "ChillsPwn isolated Obsidian acceptance receipt",
    "classification: synthetic",
    "",
  ].join("\n");
  const attachmentSha = sha256(attachmentContent);
  const operatorAttachmentName = "operator-acceptance-receipt.txt";
  const operatorAttachmentRelativePath = `Attachments/${operatorAttachmentName}`;
  const operatorAttachmentPath = pathPolicy.atomicWrite(
    connection.vaultPath,
    operatorAttachmentRelativePath,
    attachmentContent,
  );
  assert.equal(statSync(operatorAttachmentPath).mode & 0o777, 0o600);
  assert.equal(sha256(readFileSync(operatorAttachmentPath)), attachmentSha);

  const nodeInputs: Array<Parameters<typeof createNode>[1]> = [
    {
      id: "mem-operator-primary",
      nodeType: "operator",
      title: "Acceptance Operator",
      summary: "Synthetic operator identity for the isolated vault smoke",
      body: "Owns the temporary acceptance graph.",
    },
    {
      id: "mem-preference-explanation",
      nodeType: "preference",
      title: "Explain Conflict Recovery",
      summary: "Prefers visible conflict explanations",
      body: "Show both changed sides before requesting a merge decision.",
    },
    {
      id: "mem-mission-acceptance",
      nodeType: "mission",
      title: "Physical Vault Acceptance Mission",
      summary: "Validates the real bridge against a disposable filesystem",
      body: "Export, edit, conflict, resolve, retrieve, and forget without production state.",
    },
    {
      id: "mem-technique-evidence",
      nodeType: "technique",
      title: "Hash Before Interpretation",
      summary: "Hash synthetic evidence before linking it",
      body: "Calculate a content digest before attaching evidence to memory.",
    },
    {
      id: "mem-tool-obsidian-bridge",
      nodeType: "tool",
      title: "Obsidian Vault Bridge",
      summary: "Canonical database to human-readable vault projection",
      body: "Uses sandboxed paths, atomic notes, and explicit conflict resolution.",
    },
    {
      id: "mem-evidence-receipt",
      nodeType: "evidence",
      title: "Synthetic Attachment Receipt",
      summary: "Synthetic file proves physical attachment reference integrity",
      body: `A mission-scoped attachment was retained with SHA-256 ${attachmentSha}.`,
      scope: { kind: "mission", engagementId, missionId },
      lifecycleStatus: "verified",
      confirmationState: "not_required",
      authorType: "system",
    },
    {
      id: "mem-failure-stale-sync",
      nodeType: "failure",
      title: "Synthetic Stale Sync Failure",
      summary: "A disposable failed sync sequence used to prove forgetting",
      body: "The failed sequence repeated without a durable checkpoint.",
    },
    {
      id: "mem-recovery-explicit-merge",
      nodeType: "recovery",
      title: "Explicit Three-Way Merge Recovery",
      summary: "Resolve concurrent edits through a visible operator decision",
      body: "Retain both sides until the operator chooses or supplies merged content.",
    },
    {
      id: "mem-lesson-conflict-resolution",
      nodeType: "lesson",
      title: "Preserve Concurrent Edits",
      summary: "Never overwrite simultaneous database and vault changes",
      body: "Open a durable conflict and require an explicit resolution.",
      lifecycleStatus: "verified",
      confirmationState: "not_required",
      authorType: "system",
    },
    {
      id: "mem-artifact-attachment",
      nodeType: "artifact",
      title: "Attachment Integrity Artifact",
      summary: "Stable identity and digest for the synthetic attachment",
      body: "A canonical mission artifact retains the validated attachment bytes by digest.",
      lifecycleStatus: "verified",
      confirmationState: "not_required",
      authorType: "system",
    },
  ];
  const nodes = nodeInputs.map((input) => createNode(memory, input));

  const edgeInputs: Array<Parameters<typeof createEdge>[1]> = [
    { id: "edge-operator-prefers", sourceNodeId: "mem-operator-primary", targetNodeId: "mem-preference-explanation", edgeType: "prefers", title: "Operator prefers visible recovery" },
    { id: "edge-preference-applies", sourceNodeId: "mem-preference-explanation", targetNodeId: "mem-mission-acceptance", edgeType: "applies_to", title: "Preference applies to mission" },
    { id: "edge-mission-uses", sourceNodeId: "mem-mission-acceptance", targetNodeId: "mem-tool-obsidian-bridge", edgeType: "used_in", title: "Bridge used in mission" },
    { id: "edge-technique-produced", sourceNodeId: "mem-technique-evidence", targetNodeId: "mem-evidence-receipt", edgeType: "produced", title: "Technique produced evidence" },
    { id: "edge-evidence-verifies", sourceNodeId: "mem-evidence-receipt", targetNodeId: "mem-artifact-attachment", edgeType: "verified_by", title: "Evidence verified by attachment" },
    { id: "edge-failure-recovered", sourceNodeId: "mem-failure-stale-sync", targetNodeId: "mem-recovery-explicit-merge", edgeType: "recovered_by", title: "Failure recovered by merge" },
    { id: "edge-lesson-derived", sourceNodeId: "mem-lesson-conflict-resolution", targetNodeId: "mem-recovery-explicit-merge", edgeType: "derived_from", title: "Lesson derived from recovery" },
    { id: "edge-lesson-influenced", sourceNodeId: "mem-lesson-conflict-resolution", targetNodeId: "mem-mission-acceptance", edgeType: "influenced", title: "Lesson influenced mission" },
  ];
  edgeInputs.forEach((input) => createEdge(memory, input));

  const exports = nodes.map((node) => bridge.exportNode(connection.id, node.id));
  assert(exports.every((result) => result.status === "synced"));
  let stableIdsVerified = 0;
  let wikilinksVerified = 0;
  for (const result of exports) {
    const notePath = pathPolicy.resolveRelative(connection.vaultPath, result.relativePath);
    const parsed = parseObsidianNote(readFileSync(notePath, "utf8"));
    assert.equal(parsed.id, result.nodeId);
    assert(parsed.aliases.includes(result.nodeId));
    stableIdsVerified += 1;
    for (const edge of parsed.edges) {
      assert(existsSync(pathPolicy.resolveRelative(connection.vaultPath, `${edge.wikilink}.md`)));
      wikilinksVerified += 1;
    }
  }
  assert.equal(wikilinksVerified, edgeInputs.length);

  const evidenceExport = exports.find((item) => item.nodeId === "mem-evidence-receipt");
  assert(evidenceExport);
  const evidenceNote = readFileSync(
    pathPolicy.resolveRelative(connection.vaultPath, evidenceExport.relativePath),
    "utf8",
  );
  pathPolicy.atomicWrite(
    connection.vaultPath,
    evidenceExport.relativePath,
    `${evidenceNote.trimEnd()}\n\n![[${operatorAttachmentRelativePath}]]\n`,
  );
  const attachmentSync = bridge.syncNode(connection.id, "mem-evidence-receipt", ACTOR);
  assert.equal(attachmentSync.status, "synced");

  const artifact = database.prepare(`
    SELECT id, mission_id AS missionId, journey, storage_uri AS storageUri,
      content_hash AS contentHash, byte_size AS byteSize, media_type AS mediaType,
      metadata_json AS metadataJson
    FROM artifacts
    WHERE artifact_type = 'obsidian_attachment' AND mission_id = ?
  `).get(missionId) as {
    id: string;
    missionId: string;
    journey: string;
    storageUri: string;
    contentHash: string;
    byteSize: number;
    mediaType: string;
    metadataJson: string;
  };
  assert(artifact);
  assert.equal(artifact.missionId, missionId);
  assert.equal(artifact.journey, "guided");
  assert.equal(artifact.contentHash, attachmentSha);
  assert.equal(artifact.byteSize, Buffer.byteLength(attachmentContent));
  assert.equal(artifact.mediaType, "text/plain");
  assert(!artifact.storageUri.includes(operatorAttachmentName));
  assert(!artifact.metadataJson.includes(operatorAttachmentName));

  const canonicalAttachmentRelativePath = `Attachments/${attachmentSha}.txt`;
  const canonicalAttachmentPath = pathPolicy.resolveRelative(
    connection.vaultPath,
    `.chillspwn/attachments/${attachmentSha}`,
  );
  const projectedAttachmentPath = pathPolicy.resolveRelative(
    connection.vaultPath,
    canonicalAttachmentRelativePath,
  );
  assert.equal(sha256(readFileSync(canonicalAttachmentPath)), attachmentSha);
  assert.equal(sha256(readFileSync(projectedAttachmentPath)), attachmentSha);

  const normalizedEvidenceNote = readFileSync(
    pathPolicy.resolveRelative(connection.vaultPath, evidenceExport.relativePath),
    "utf8",
  );
  const parsedEvidence = parseObsidianNote(normalizedEvidenceNote);
  assert.equal(parsedEvidence.id, "mem-evidence-receipt");
  assert(!parsedEvidence.body.includes("![[Attachments/"));
  assert(!parsedEvidence.body.includes(operatorAttachmentName));
  assert.deepEqual(parsedEvidence.attachments, [{
    relativePath: canonicalAttachmentRelativePath,
    artifactId: artifact.id,
    contentHash: attachmentSha,
  }]);
  assert(normalizedEvidenceNote.includes(`![[${canonicalAttachmentRelativePath}]]`));
  assert(normalizedEvidenceNote.includes(`chillspwn-attachment:${artifact.id}:${attachmentSha}`));
  assert(!normalizedEvidenceNote.includes(operatorAttachmentName));

  const retainedEvidence = memory.requireNode("mem-evidence-receipt");
  assert.equal(retainedEvidence.scope.kind, "mission");
  assert.equal(retainedEvidence.scope.missionId, missionId);
  assert(!retainedEvidence.body.includes(operatorAttachmentName));
  assert(!retainedEvidence.body.includes("![[Attachments/"));
  assert(database.prepare(`
    SELECT source_id AS sourceId FROM memory_sources
    WHERE node_id = ? AND source_type = 'artifact' AND source_id = ?
  `).get(retainedEvidence.id, artifact.id));
  const reusableRows = database.prepare(`
    SELECT title, summary, body, provenance_json AS provenance
    FROM memory_nodes WHERE id = ?
    UNION ALL
    SELECT title, summary, body, '' AS provenance
    FROM memory_versions WHERE node_id = ?
  `).all(retainedEvidence.id, retainedEvidence.id);
  assert(!JSON.stringify(reusableRows).includes(operatorAttachmentName));

  // Remove the operator-named import surface. The normalized projection and
  // portable export must now be served solely from canonical hashed bytes.
  rmSync(operatorAttachmentPath, { force: true });
  assert.equal(existsSync(operatorAttachmentPath), false);
  const portable = await bridge.createPortableExport(connection.id, [retainedEvidence.id], ACTOR);
  const portableBytes = readFileSync(portable.archivePath);
  assert.equal(portable.fileCount, 3);
  assert(portableBytes.includes(Buffer.from(canonicalAttachmentRelativePath, "utf8")));
  assert(portableBytes.includes(Buffer.from(attachmentContent, "utf8")));
  assert(!portableBytes.includes(Buffer.from(operatorAttachmentName, "utf8")));
  assert.equal(sha256(portableBytes), portable.sha256);

  const preferenceExport = exports.find((item) => item.nodeId === "mem-preference-explanation");
  assert(preferenceExport);
  const preferencePath = pathPolicy.resolveRelative(connection.vaultPath, preferenceExport.relativePath);
  const originalPreference = readFileSync(preferencePath, "utf8");
  pathPolicy.atomicWrite(connection.vaultPath, preferenceExport.relativePath, originalPreference.replace(
    "Show both changed sides before requesting a merge decision.",
    "Operator edit: show both changed sides and the last synchronized base before merge.",
  ));
  const operatorSync = bridge.syncNode(connection.id, "mem-preference-explanation", ACTOR);
  assert.equal(operatorSync.status, "synced");
  const preference = memory.requireNode("mem-preference-explanation");
  assert(preference.body.includes("Operator edit:"));
  assert.equal(preference.authorType, "import");
  assert.equal(preference.authorId, ACTOR);
  const preferenceVersions = memory.listVersions(preference.id);
  assert.deepEqual(preferenceVersions.map((version) => version.version), [1, 2]);

  const lessonExport = exports.find((item) => item.nodeId === "mem-lesson-conflict-resolution");
  assert(lessonExport);
  const lessonPath = pathPolicy.resolveRelative(connection.vaultPath, lessonExport.relativePath);
  const originalLesson = readFileSync(lessonPath, "utf8");
  const vaultLesson = originalLesson.replace(
    "Open a durable conflict and require an explicit resolution.",
    "Vault-side operator edit: retain the local explanation until merge.",
  );
  pathPolicy.atomicWrite(connection.vaultPath, lessonExport.relativePath, vaultLesson);
  memory.correctNode("mem-lesson-conflict-resolution", {
    body: "Database-side agent edit: attach a recovery checkpoint before merge.",
    authorType: "agent",
    authorId: "agent-acceptance-smoke",
    changeReason: "Synthetic concurrent canonical edit",
  });
  const conflict = bridge.syncNode(connection.id, "mem-lesson-conflict-resolution", ACTOR);
  assert.equal(conflict.status, "conflict");
  assert(conflict.conflictId);
  const mergedLesson = vaultLesson.replace(
    "Vault-side operator edit: retain the local explanation until merge.",
    "Merged resolution: retain the operator explanation and attach the canonical recovery checkpoint.",
  );
  const resolved = bridge.resolveConflict(conflict.conflictId, "merged", ACTOR, mergedLesson);
  assert.equal(resolved.status, "synced");
  const conflictRow = database.prepare(`
    SELECT status, resolved_by AS resolvedBy FROM vault_conflicts WHERE id = ?
  `).get(conflict.conflictId) as { status: string; resolvedBy: string };
  assert.equal(conflictRow.status, "resolved_merged");
  assert.equal(conflictRow.resolvedBy, ACTOR);
  const lesson = memory.requireNode("mem-lesson-conflict-resolution");
  assert(lesson.body.includes("Merged resolution:"));
  const lessonVersions = memory.listVersions(lesson.id);
  assert.deepEqual(lessonVersions.map((version) => version.version), [1, 2, 3]);
  assert.equal(lessonVersions[1]?.changeReason, "Synthetic concurrent canonical edit");
  assert(lessonVersions[2]?.changeReason.includes("resolved Obsidian conflict"));

  const verification = bridge.verifyConnection(connection.id);
  assert.equal(verification.healthy, true);
  assert.equal(verification.counts.synced, nodes.length);

  const retrievalPolicy = {
    journey: "guided" as const,
    maximumSensitivity: "private" as const,
    allowedStatuses: ["confirmed", "verified"] as const,
    contextBudget: 10_000,
    limit: 5,
    exactNodeIds: ["mem-failure-stale-sync"],
    exactNodeIdsOnly: true,
    graphDepth: 0 as const,
  };
  const retrievedBefore = retrieval.retrieve("synthetic stale sync failure", retrievalPolicy);
  assert.deepEqual(retrievedBefore.map((item) => item.node.id), ["mem-failure-stale-sync"]);
  const failureExport = exports.find((item) => item.nodeId === "mem-failure-stale-sync");
  assert(failureExport);
  const failureProjection = pathPolicy.resolveRelative(connection.vaultPath, failureExport.relativePath);
  assert(existsSync(failureProjection));
  const forgotten = bridge.forgetMemory(
    "mem-failure-stale-sync",
    ACTOR,
    "Synthetic acceptance erasure",
  );
  assert.equal(existsSync(failureProjection), false);
  assert.equal(memory.getNode("mem-failure-stale-sync"), undefined);
  assert.equal(memory.requireNode("mem-failure-stale-sync", true).lifecycleStatus, "forgotten");
  const retrievedAfter = retrieval.retrieve("synthetic stale sync failure", retrievalPolicy);
  assert.equal(retrievedAfter.length, 0);
  assert(forgotten.removed.versions >= 1);
  assert(forgotten.removed.sources >= 1);
  assert(forgotten.removed.edges >= 1);

  return {
    passed: true,
    isolation: {
      workspaceKind: "fresh-/tmp-workspace",
      productionConfigurationRead: false,
      cleanupVerified: false,
    },
    graph: {
      nodeCount: nodes.length,
      nodeTypes: [...new Set(nodes.map((node) => node.nodeType))].sort(),
      edgeCount: edgeInputs.length,
      edgeTypes: [...new Set(edgeInputs.map((edge) => edge.edgeType))].sort(),
    },
    projection: {
      notesExported: exports.length,
      stableIdsVerified,
      nativeWikilinksVerified: wikilinksVerified,
      attachmentId: artifact.id,
      attachmentSha256: attachmentSha,
      canonicalAttachmentRelativePath,
      attachmentReferenceVerified: true,
      originalFilenameExcludedFromMemory: true,
      portableAttachmentVerified: true,
      attachmentMode: "canonical-mission-artifact-lifecycle",
    },
    operatorEdit: {
      nodeId: preference.id,
      syncStatus: "synced",
      versionHistory: preferenceVersions.map((version) => version.version),
      operatorAttributionPreserved: true,
    },
    conflict: {
      nodeId: lesson.id,
      detectedStatus: "conflict",
      resolution: "merged",
      finalStatus: "synced",
      durableConflictStatus: "resolved_merged",
      versionHistory: lessonVersions.map((version) => version.version),
    },
    forgetting: {
      nodeId: "mem-failure-stale-sync",
      projectionRemoved: true,
      retrievalCountBefore: retrievedBefore.length,
      retrievalCountAfter: 0,
      versionsRemoved: forgotten.removed.versions,
      sourcesRemoved: forgotten.removed.sources,
      edgesRemoved: forgotten.removed.edges,
      tombstoneLifecycle: "forgotten",
    },
    preForgetSyncHealthy: true,
  };
}

validateObsidianSmokeGate(process.env);
const temporaryRoot = realpathSync("/tmp");
const workspaceRoot = mkdtempSync(join(temporaryRoot, OBSIDIAN_SMOKE_PREFIX));
chmodSync(workspaceRoot, 0o700);
const paths = buildObsidianSmokePaths(workspaceRoot, temporaryRoot);
let database: SqliteDatabase | undefined;
let evidence: SmokeEvidence | undefined;
let failure: unknown;
try {
  database = createDatabaseConnection({ filename: paths.databasePath });
  evidence = await runSmoke(database, workspaceRoot);
} catch (error) {
  failure = error;
} finally {
  database?.close();
  try {
    removeObsidianSmokeWorkspace(workspaceRoot, temporaryRoot);
  } catch (cleanupError) {
    failure ??= cleanupError;
  }
}
if (failure) throw failure;
assert(evidence);
evidence.isolation.cleanupVerified = !existsSync(workspaceRoot);
assert.equal(evidence.isolation.cleanupVerified, true);
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
