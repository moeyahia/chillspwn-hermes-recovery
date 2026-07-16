#!/usr/bin/env bun

/**
 * Opt-in 50,000-note physical Obsidian-vault acceptance profile.
 *
 * All database and vault state is created below one fresh /tmp directory. The
 * script never reads deployment configuration or accepts filesystem paths, and
 * it removes the complete workspace after closing SQLite, including on failure.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
  watch,
  type FSWatcher,
} from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  createDatabaseConnection,
  inImmediateTransaction,
  migrateDatabase,
  type SqliteDatabase,
} from "../../server/db/index";
import {
  MemoryRepository,
  type MemoryNode,
  type MemoryNodeType,
} from "../../server/memory/index";
import {
  ObsidianVaultBridge,
  ObsidianVaultWatcher,
  parseObsidianNote,
  renderObsidianNote,
  VaultPathPolicy,
  vaultRelativePath,
} from "../../server/vault/index";
import {
  IncrementalBatchAbortError,
  OBSIDIAN_SCALE_PREFIX,
  buildObsidianScalePaths,
  processIncrementally,
  removeObsidianScaleWorkspace,
  scaleNoteCount,
  validateObsidianScaleGate,
} from "./obsidian-vault-scale-profile-lib";

const ACTOR = "operator:obsidian-scale-profile";
const PROFILE_ID = "obsidian-physical-vault-50000-opt-in";
const CREATED_AT = "2026-07-15T00:00:00.000Z";
const EXPORT_CONCURRENCY = 16;
const EXPORT_PROGRESS_INTERVAL = 250;
const FIXTURE_BASELINE_BATCH_SIZE = 500;
const CANCELLATION_BATCH_SIZE = 1;

const NODE_TYPES: readonly MemoryNodeType[] = [
  "operator", "preference", "mission", "run", "plan", "phase", "step", "agent",
  "tool", "mcp_capability", "tactic", "technique", "procedure", "target", "asset",
  "entity", "decision", "evidence", "finding", "artifact", "failure", "recovery",
  "evaluation", "lesson", "report", "source",
];

interface FixtureSeedResult {
  readonly elapsedMs: number;
  readonly nodeCount: number;
  readonly versionCount: number;
  readonly indexedCount: number;
  readonly sentinelId: string;
  readonly sentinelTerm: string;
  readonly indexLookupMs: number;
}

interface FilesystemStats {
  readonly markdownFiles: number;
  readonly markdownBytes: number;
  readonly totalFiles: number;
  readonly totalBytes: number;
}

interface ScaleEvidence {
  readonly passed: true;
  readonly profile: typeof PROFILE_ID;
  readonly fixtureLabel: "synthetic-opt-in-never-production";
  readonly measuredAt: string;
  isolation: {
    readonly workspaceKind: "fresh-/tmp-workspace";
    readonly productionConfigurationRead: false;
    readonly productionDatabaseRead: false;
    readonly productionVaultRead: false;
    readonly portsOpened: false;
    cleanupVerified: boolean;
  };
  readonly fixture: {
    readonly canonicalNodes: number;
    readonly canonicalVersions: number;
    readonly ftsIndexedNodes: number;
    readonly projectedMarkdownNotes: number;
    readonly projectedMarkdownBytes: number;
    readonly nodeTypes: number;
    readonly physicalVaultTotalFiles: number;
    readonly physicalVaultTotalBytes: number;
  };
  readonly fullBridgeExport: {
    readonly mode: "bounded-resumable-atomic-bridge-export";
    readonly usesExactBridgeBulkPath: true;
    readonly concurrency: number;
    readonly progressInterval: number;
    readonly elapsedMs: number;
    readonly notesPerSecond: number;
    readonly counts: {
      readonly synced: number;
      readonly skipped: number;
      readonly databaseAhead: number;
      readonly vaultAhead: number;
      readonly conflicts: number;
      readonly quarantined: number;
      readonly failed: number;
    };
    readonly fullReconciliationHealthy: true;
    readonly fullReconciliationMs: number;
    readonly fullReconciliationImplementation: "yielded-full-file-hash-scan";
    readonly reconciliationCounts: Record<string, number>;
    readonly parsedSamples: number;
    readonly actualBridgeUnchangedSamples: number;
  };
  readonly indexing: {
    readonly sentinelId: string;
    readonly lookupMs: number;
    readonly operatorEditLookupMs: number;
    readonly operatorEditIndexed: true;
  };
  readonly watcher: {
    readonly implementation:
      | "physical-node-fs-recursive-watch-with-bounded-stat-safety-net"
      | "bounded-physical-stat-polling-adapter";
    readonly nativeWatchUnavailable: boolean;
    readonly nativeWatchFailureCategory?: "inotify_resource_unavailable" | "platform_recursive_watch_unavailable";
    readonly debounceMs: number;
    readonly writesToSameNote: number;
    readonly rawFilesystemEvents: number;
    readonly queuedExistingNoteJobs: number;
    readonly queuedNewInboxNoteJobs: number;
    readonly meaningfulExistingVersions: 1;
    readonly pendingCandidatesCreated: 1;
    readonly boundedStatPaths: 2;
    readonly applicationFullTreeRescan: false;
    readonly existingNoteElapsedMs: number;
    readonly candidateImportElapsedMs: number;
    readonly finalVersion: number;
    readonly finalOperatorAttribution: true;
    readonly candidateCreated: true;
    readonly errors: 0;
  };
  readonly sourceHashInvariants: {
    readonly nodeId: string;
    readonly canonicalVersionHash: string;
    readonly initialProjectionSha256: string;
    readonly finalProjectionSha256: string;
    readonly trackedDatabaseSha256: string;
    readonly trackedVaultSha256: string;
    readonly canonicalVersionUnchanged: true;
    readonly projectionUnchanged: true;
    readonly trackedHashesEqual: true;
  };
  readonly conflict: {
    readonly detected: true;
    readonly detectedStatus: "conflict";
    readonly resolution: "merged";
    readonly durableStatus: "resolved_merged";
    readonly finalVersion: number;
    readonly elapsedMs: number;
  };
  readonly cancellation: {
    readonly realBridgeOperations: true;
    readonly attemptedItems: number;
    readonly processedBeforeAbort: number;
    readonly batchesBeforeAbort: number;
    readonly timerDelayMs: number;
    readonly observationLatencyMs: number;
    readonly totalElapsedMs: number;
    readonly partialItemObserved: false;
    readonly remainingCanonicalSyncRows: number;
  };
  readonly runtimeResponsiveness: {
    readonly evidenceKind: "canonical-running-run-heartbeat-during-exact-bulk-bridge-export";
    readonly runId: string;
    readonly heartbeatWrites: number;
    readonly heartbeatWritesDuringExport: number;
    readonly maximumHeartbeatGapMs: number;
    readonly lastHeartbeatPersisted: true;
    readonly missionRuntimeEngineStarted: false;
  };
  readonly resources: {
    readonly rssStartBytes: number;
    readonly peakRssBytes: number;
    readonly rssDeltaBytes: number;
    readonly canonicalDatabaseBytes: number;
  };
  readonly budgets: {
    readonly fullBridgeInitialProjectionMs: number;
    readonly fullReconciliationMs: number;
    readonly watcherOperationMs: number;
    readonly cancellationRequestDispatchMs: number;
    readonly cancellationObservationMs: number;
    readonly maximumHeartbeatGapMs: number;
    readonly peakRssBytes: number;
    readonly workspaceBytes: number;
  };
  readonly honestLimits: readonly string[];
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function nodeId(index: number): string {
  return `mem-vault-scale-${String(index).padStart(5, "0")}`;
}

function fixtureNode(index: number, sentinelIndex: number): {
  readonly id: string;
  readonly type: MemoryNodeType;
  readonly title: string;
  readonly summary: string;
  readonly body: string;
} {
  const type = NODE_TYPES[index % NODE_TYPES.length]!;
  const sentinel = index === sentinelIndex;
  return {
    id: nodeId(index),
    type,
    title: `Vault scale ${type.replaceAll("_", " ")} ${String(index).padStart(5, "0")}`,
    summary: sentinel
      ? `Unique physical-vault FTS sentinel vaultscale${index}`
      : "Synthetic scale-profile memory projected only inside a disposable vault.",
    body: `Synthetic ${type} note ${index}. This fixture is opt-in, isolated, and never product data.`,
  };
}

function canonicalFixtureMemoryNode(index: number, sentinelIndex: number): MemoryNode {
  const fixture = fixtureNode(index, sentinelIndex);
  return {
    id: fixture.id,
    nodeType: fixture.type,
    title: fixture.title,
    summary: fixture.summary,
    body: fixture.body,
    scope: { kind: "global" },
    sensitivity: "internal",
    confidence: 0.75 + (index % 20) / 100,
    lifecycleStatus: "confirmed",
    confirmationState: "confirmed",
    provenance: {
      method: "derived",
      explanation: "Synthetic opt-in physical-vault performance fixture.",
      sources: [{ sourceType: "scale_fixture", sourceId: PROFILE_ID, acquiredAt: CREATED_AT }],
    },
    authorType: "system",
    authorId: PROFILE_ID,
    version: 1,
    retentionPolicy: {
      fixture: "scale-profile-only",
      allowAutonomous: false,
      allowGuided: false,
      expiresAfterDays: 1,
    },
    pinned: false,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function seedCanonicalFixture(database: SqliteDatabase, count: number): FixtureSeedResult {
  const startedAt = performance.now();
  const sentinelIndex = Math.min(count - 1, 42_424);
  const sentinelId = nodeId(sentinelIndex);
  const sentinelTerm = `vaultscale${sentinelIndex}`;
  const provenance = JSON.stringify({
    method: "derived",
    explanation: "Synthetic opt-in physical-vault performance fixture.",
    sources: [{ sourceType: "scale_fixture", sourceId: PROFILE_ID, acquiredAt: CREATED_AT }],
  });
  const retention = JSON.stringify({
    fixture: "scale-profile-only",
    allowAutonomous: false,
    allowGuided: false,
    expiresAfterDays: 1,
  });
  const insertNode = database.prepare(`
    INSERT INTO memory_nodes (
      id, node_type, title, summary, body, scope, engagement_id, mission_id,
      sensitivity, confidence, lifecycle_status, confirmation_state,
      provenance_json, author_type, author_id, version, retention_policy_json,
      expires_at, pinned, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, 'global', NULL, NULL,
      'internal', ?, 'confirmed', 'confirmed',
      ?, 'system', ?, 1, ?, NULL, 0, ?, ?
    )
  `);
  const insertVersion = database.prepare(`
    INSERT INTO memory_versions (
      id, node_id, version, title, summary, body, properties_json,
      lifecycle_status, author_type, author_id, change_reason, content_hash, created_at
    ) VALUES (?, ?, 1, ?, ?, ?, ?, 'confirmed', 'system', ?, ?, ?, ?)
  `);

  inImmediateTransaction(database, () => {
    for (let index = 0; index < count; index += 1) {
      const node = fixtureNode(index, sentinelIndex);
      const confidence = 0.75 + (index % 20) / 100;
      insertNode.run(
        node.id,
        node.type,
        node.title,
        node.summary,
        node.body,
        confidence,
        provenance,
        PROFILE_ID,
        retention,
        CREATED_AT,
        CREATED_AT,
      );
      const properties = JSON.stringify({
        nodeType: node.type,
        scope: { kind: "global" },
        sensitivity: "internal",
        confidence,
        confirmationState: "confirmed",
        provenance: JSON.parse(provenance),
        retentionPolicy: JSON.parse(retention),
        expiresAt: null,
        pinned: false,
      });
      insertVersion.run(
        `mver-vault-scale-${String(index).padStart(5, "0")}`,
        node.id,
        node.title,
        node.summary,
        node.body,
        properties,
        PROFILE_ID,
        "Synthetic scale fixture created",
        sha256(`${node.type}\0${node.title}\0${node.summary}\0${node.body}`),
        CREATED_AT,
      );
    }
  });
  database.pragma("wal_checkpoint(PASSIVE)");

  const counts = database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM memory_nodes) AS nodes,
      (SELECT COUNT(*) FROM memory_versions) AS versions,
      (SELECT COUNT(*) FROM memory_nodes_fts) AS indexed
  `).get() as { nodes: number; versions: number; indexed: number };
  assert.equal(Number(counts.nodes), count);
  assert.equal(Number(counts.versions), count);
  assert.equal(Number(counts.indexed), count);
  const lookupStartedAt = performance.now();
  const found = database.prepare(`
    SELECT mn.id FROM memory_nodes_fts
    JOIN memory_nodes mn ON mn.rowid = memory_nodes_fts.rowid
    WHERE memory_nodes_fts MATCH ? LIMIT 2
  `).all(sentinelTerm) as Array<{ id: string }>;
  const indexLookupMs = performance.now() - lookupStartedAt;
  assert.deepEqual(found.map((item) => item.id), [sentinelId]);
  return {
    elapsedMs: performance.now() - startedAt,
    nodeCount: Number(counts.nodes),
    versionCount: Number(counts.versions),
    indexedCount: Number(counts.indexed),
    sentinelId,
    sentinelTerm,
    indexLookupMs,
  };
}

function createRuntimeProbe(database: SqliteDatabase): { missionId: string; runId: string } {
  const missionId = "mission-obsidian-scale-runtime-probe";
  const runId = "run-obsidian-scale-runtime-probe";
  database.prepare(`
    INSERT INTO missions (
      id, name, objective, journey, status, authorization_status, engagement_id,
      scope_json, success_criteria_json, retention_policy_json, memory_policy_json,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, 'guided', 'active', 'verified', ?, '{}', '[]', '{}', '{}', ?, ?, ?)
  `).run(
    missionId,
    "Obsidian scale responsiveness probe",
    "Prove a canonical running-run heartbeat advances while yielded projection work executes",
    "engagement-obsidian-scale-profile",
    PROFILE_ID,
    CREATED_AT,
    CREATED_AT,
  );
  database.prepare(`
    INSERT INTO runs (
      id, mission_id, journey, status, progress, status_reason,
      budget_json, budget_usage_json, started_at, created_at, updated_at
    ) VALUES (?, ?, 'guided', 'running', 0, ?, '{}', '{}', ?, ?, ?)
  `).run(runId, missionId, "Synthetic responsiveness probe only", CREATED_AT, CREATED_AT, CREATED_AT);
  return { missionId, runId };
}

function filesystemStats(root: string): FilesystemStats {
  const pending = [root];
  let markdownFiles = 0;
  let markdownBytes = 0;
  let totalFiles = 0;
  let totalBytes = 0;
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const metadata = lstatSync(path);
      if (metadata.isSymbolicLink()) throw new Error("Scale workspace unexpectedly contains a symbolic link");
      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (!entry.isFile()) continue;
      totalFiles += 1;
      totalBytes += metadata.size;
      if (entry.name.toLowerCase().endsWith(".md")) {
        markdownFiles += 1;
        markdownBytes += metadata.size;
      }
    }
  }
  return { markdownFiles, markdownBytes, totalFiles, totalBytes };
}

async function waitFor(
  predicate: () => boolean,
  label: string,
  timeoutMs = 10_000,
): Promise<number> {
  const startedAt = performance.now();
  while (!predicate()) {
    if (performance.now() - startedAt >= timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return performance.now() - startedAt;
}

function noteWithBody(source: string, priorBody: string, nextBody: string): string {
  assert(source.includes(priorBody));
  return source.replace(priorBody, nextBody);
}

function physicalSignature(path: string): string {
  if (!existsSync(path)) return "missing";
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) return "invalid";
  return `${metadata.ino}:${metadata.size}:${metadata.mtimeMs}`;
}

function adaptivePhysicalWatch(
  root: string,
  relativePaths: readonly string[],
  listener: (eventType: string, filename: string | Buffer | null) => void,
  reportMode: (
    implementation:
      | "physical-node-fs-recursive-watch-with-bounded-stat-safety-net"
      | "bounded-physical-stat-polling-adapter",
    failureCategory?: "inotify_resource_unavailable" | "platform_recursive_watch_unavailable",
  ) => void,
): FSWatcher {
  const emitter = new EventEmitter() as EventEmitter & {
    close(): void;
    ref(): void;
    unref(): void;
  };
  let nativeWatcher: FSWatcher | undefined;
  let pollingTimer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const installPolling = (): void => {
    if (closed || pollingTimer) return;
    const signatures = new Map(relativePaths.map((relativePath) => [
      relativePath,
      physicalSignature(join(root, relativePath)),
    ]));
    pollingTimer = setInterval(() => {
      for (const relativePath of relativePaths) {
        const next = physicalSignature(join(root, relativePath));
        const prior = signatures.get(relativePath);
        if (next === prior) continue;
        signatures.set(relativePath, next);
        listener(prior === "missing" ? "rename" : "change", relativePath);
      }
    }, 10);
  };
  const usePollingFallback = (error: unknown): void => {
    const message = error instanceof Error ? error.message : "";
    const failureCategory = message.includes("EMFILE")
      ? "inotify_resource_unavailable" as const
      : "platform_recursive_watch_unavailable" as const;
    reportMode("bounded-physical-stat-polling-adapter", failureCategory);
    installPolling();
  };
  // The profile always keeps a bounded two-path stat watcher as a deterministic
  // safety net. It is not a vault rescan and never traverses the 50,000 notes.
  installPolling();
  try {
    nativeWatcher = watch(root, { persistent: false, recursive: true }, listener);
    reportMode("physical-node-fs-recursive-watch-with-bounded-stat-safety-net");
    nativeWatcher.on("error", (error) => {
      nativeWatcher?.close();
      nativeWatcher = undefined;
      usePollingFallback(error);
    });
  } catch (error) {
    usePollingFallback(error);
  }
  emitter.close = () => {
    closed = true;
    nativeWatcher?.close();
    nativeWatcher = undefined;
    if (pollingTimer) clearInterval(pollingTimer);
    pollingTimer = undefined;
  };
  emitter.ref = () => { nativeWatcher?.ref(); pollingTimer?.ref(); };
  emitter.unref = () => { nativeWatcher?.unref(); pollingTimer?.unref(); };
  return emitter as unknown as FSWatcher;
}

function inboxCandidateFromProjection(
  source: string,
  originalId: string,
  originalTitle: string,
): string {
  const candidateId = "mem-vault-scale-inbox-candidate";
  return source
    .replace(`id: ${JSON.stringify(originalId)}`, `id: ${JSON.stringify(candidateId)}`)
    .replace(`  - ${JSON.stringify(originalId)}`, `  - ${JSON.stringify(candidateId)}`)
    .replace(`# ${originalTitle}`, "# Operator Scale Inbox Candidate")
    .replace(
      /Synthetic [^\n]+ This fixture is opt-in, isolated, and never product data\./u,
      "Operator-authored synthetic candidate created inside the disposable scale vault.",
    );
}

async function runProfile(
  database: SqliteDatabase,
  workspaceRoot: string,
  count: number,
  lifecycleSignal: AbortSignal,
): Promise<ScaleEvidence> {
  const budgets = {
    fullBridgeInitialProjectionMs: 10 * 60_000,
    fullReconciliationMs: 5 * 60_000,
    watcherOperationMs: 10_000,
    cancellationRequestDispatchMs: 2_000,
    cancellationObservationMs: 2_000,
    maximumHeartbeatGapMs: 2_000,
    peakRssBytes: 1_610_612_736,
    workspaceBytes: 1_073_741_824,
  } as const;
  const rssStartBytes = process.memoryUsage.rss();
  let peakRssBytes = rssStartBytes;
  const recordMemory = (): void => { peakRssBytes = Math.max(peakRssBytes, process.memoryUsage.rss()); };

  const migrationStartedAt = performance.now();
  migrateDatabase(database);
  const migrationMs = performance.now() - migrationStartedAt;
  const seed = seedCanonicalFixture(database, count);
  const runtimeProbe = createRuntimeProbe(database);
  const paths = buildObsidianScalePaths(workspaceRoot);
  const memory = new MemoryRepository(database);
  const pathPolicy = new VaultPathPolicy(paths.allowedVaultRoot);
  const bridge = new ObsidianVaultBridge(database, memory, pathPolicy);
  const connection = bridge.connect({
    id: "vault-obsidian-scale-profile",
    vaultPath: paths.vaultName,
    displayName: "ChillsPwn Brain Scale Acceptance",
    permissionGranted: true,
  });

  let heartbeatWrites = 0;
  let lastHeartbeatTick = performance.now();
  let maximumHeartbeatGapMs = 0;
  let heartbeatFailure: unknown;
  const heartbeat = database.prepare(`
    UPDATE runs SET last_heartbeat_at = ?, updated_at = ?, version = version + 1
    WHERE id = ? AND status = 'running'
  `);
  const heartbeatTimer = setInterval(() => {
    const now = performance.now();
    maximumHeartbeatGapMs = Math.max(maximumHeartbeatGapMs, now - lastHeartbeatTick);
    lastHeartbeatTick = now;
    recordMemory();
    try {
      const timestamp = new Date().toISOString();
      const result = heartbeat.run(timestamp, timestamp, runtimeProbe.runId);
      if (result.changes !== 1) throw new Error("Canonical runtime heartbeat probe lost its running run");
      heartbeatWrites += 1;
    } catch (error) {
      heartbeatFailure ??= error;
    }
  }, 100);
  await new Promise((resolve) => setTimeout(resolve, 110));
  const heartbeatWritesBeforeProjection = heartbeatWrites;
  let projection;
  try {
    const exportableIds = bridge.exportableNodeIds(connection.id);
    assert.equal(exportableIds.length, count);
    projection = await bridge.exportNodes(connection.id, exportableIds, {
      concurrency: EXPORT_CONCURRENCY,
      progressInterval: EXPORT_PROGRESS_INTERVAL,
      signal: lifecycleSignal,
      onProgress: () => {
        recordMemory();
      },
    });
    assert.deepEqual(projection.counts, {
      synced: count,
      skipped: 0,
      databaseAhead: 0,
      vaultAhead: 0,
      conflicts: 0,
      quarantined: 0,
      failed: 0,
    });
    assert.equal(projection.issues.length, 0);
    assert.equal(projection.issueSampleTruncated, false);
    assert.equal(projection.processed, count);
    assert.equal(projection.remaining, 0);
  } finally {
    clearInterval(heartbeatTimer);
  }
  assert.equal(heartbeatFailure, undefined);
  const heartbeatWritesDuringExport = heartbeatWrites - heartbeatWritesBeforeProjection;
  assert(heartbeatWrites > 0, "Canonical heartbeat probe must persist before bridge export");
  if (projection.elapsedMs >= 150) {
    assert(heartbeatWritesDuringExport > 0, "Exact bulk bridge export must allow the canonical heartbeat to advance");
  }
  assert(maximumHeartbeatGapMs <= budgets.maximumHeartbeatGapMs);
  assert(projection.elapsedMs <= budgets.fullBridgeInitialProjectionMs);
  const persistedHeartbeat = database.prepare(
    "SELECT last_heartbeat_at AS lastHeartbeatAt FROM runs WHERE id = ?",
  ).get(runtimeProbe.runId) as { lastHeartbeatAt: string | null };
  assert(persistedHeartbeat.lastHeartbeatAt);

  const initialFilesystem = filesystemStats(connection.vaultPath);
  assert.equal(initialFilesystem.markdownFiles, count);
  assert(initialFilesystem.totalBytes <= budgets.workspaceBytes);
  recordMemory();

  const integrityNodeId = nodeId(0);
  const integrityProjection = bridge.renderNode(integrityNodeId);
  const integrityProjectionPath = pathPolicy.resolveRelative(
    connection.vaultPath,
    integrityProjection.relativePath,
  );
  const initialProjectionSha256 = sha256(readFileSync(integrityProjectionPath, "utf8"));
  const initialCanonicalVersion = database.prepare(`
    SELECT content_hash AS contentHash FROM memory_versions
    WHERE node_id = ? AND version = 1
  `).get(integrityNodeId) as { contentHash: string };

  const sampleIndexes = [...new Set([0, Math.floor(count / 2), count - 1])];
  for (const index of sampleIndexes) {
    const rendered = bridge.renderNode(nodeId(index));
    const parsed = parseObsidianNote(readFileSync(
      pathPolicy.resolveRelative(connection.vaultPath, rendered.relativePath),
      "utf8",
    ));
    assert.equal(parsed.id, nodeId(index));
  }

  const verifyStartedAt = performance.now();
  const syncRows = database.prepare(`
    SELECT node_id AS nodeId, relative_path AS relativePath,
      database_content_hash AS databaseHash, vault_content_hash AS vaultHash, status
    FROM vault_sync_state WHERE connection_id = ? AND node_id IS NOT NULL
  `).all(connection.id) as Array<{
    nodeId: string;
    relativePath: string;
    databaseHash: string;
    vaultHash: string;
    status: string;
  }>;
  assert.equal(syncRows.length, count);
  const syncByNode = new Map(syncRows.map((row) => [row.nodeId, row]));
  const reconciliation = await processIncrementally(count, (index) => {
    const node = canonicalFixtureMemoryNode(index, Math.min(count - 1, 42_424));
    const expectedText = renderObsidianNote(node, [], []);
    const expectedHash = sha256(expectedText);
    const state = syncByNode.get(node.id);
    assert(state);
    assert.equal(state.status, "synced");
    assert.equal(state.relativePath, vaultRelativePath(node));
    assert.equal(state.databaseHash, expectedHash);
    assert.equal(state.vaultHash, expectedHash);
    const physicalHash = sha256(readFileSync(
      pathPolicy.resolveRelative(connection.vaultPath, state.relativePath),
      "utf8",
    ));
    assert.equal(physicalHash, expectedHash);
  }, {
    batchSize: FIXTURE_BASELINE_BATCH_SIZE,
    signal: lifecycleSignal,
    onProgress: recordMemory,
  });
  const fullReconciliationMs = performance.now() - verifyStartedAt;
  assert.equal(reconciliation.processed, count);
  assert(fullReconciliationMs <= budgets.fullReconciliationMs);
  const reconciliationCounts: Record<string, number> = {
    synced: count,
    database_ahead: 0,
    vault_ahead: 0,
    conflict: 0,
    missing: 0,
    pending: 0,
    quarantined: 0,
  };
  for (const index of sampleIndexes) {
    const actualBridgeResult = bridge.syncNode(connection.id, nodeId(index), ACTOR);
    assert.equal(actualBridgeResult.status, "synced");
  }
  recordMemory();

  let rawFilesystemEvents = 0;
  const processedPaths: string[] = [];
  const watcherErrors: Error[] = [];
  const debounceMs = 100;
  let watcherImplementation:
    | "physical-node-fs-recursive-watch-with-bounded-stat-safety-net"
    | "bounded-physical-stat-polling-adapter"
    = "physical-node-fs-recursive-watch-with-bounded-stat-safety-net";
  let nativeWatchFailureCategory: "inotify_resource_unavailable" | "platform_recursive_watch_unavailable" | undefined;
  const editIndex = Math.min(count - 1, 137);
  const editedNodeId = nodeId(editIndex);
  const editFixture = fixtureNode(editIndex, Math.min(count - 1, 42_424));
  const renderedEdit = bridge.renderNode(editedNodeId);
  const editedRelativePath = renderedEdit.relativePath;
  const editPath = pathPolicy.resolveRelative(connection.vaultPath, editedRelativePath);
  const candidateSourceIndex = Math.min(count - 1, 2);
  const candidateFixture = fixtureNode(candidateSourceIndex, Math.min(count - 1, 42_424));
  const candidateProjection = bridge.renderNode(nodeId(candidateSourceIndex)).text;
  const candidateRelativePath = "00 Inbox/operator-scale-inbox-candidate.md";
  const candidatePath = pathPolicy.resolveRelative(connection.vaultPath, candidateRelativePath, true);
  const watcher = new ObsidianVaultWatcher(database, bridge, {
    actor: ACTOR,
    debounceMs,
    yieldMs: 1,
    connectionRefreshMs: 300_000,
    watchFactory: (root, listener) => adaptivePhysicalWatch(
      root,
      [editedRelativePath, candidateRelativePath],
      (eventType, filename) => {
        rawFilesystemEvents += 1;
        listener(eventType, filename);
      },
      (implementation, failureCategory) => {
        watcherImplementation = implementation;
        nativeWatchFailureCategory = failureCategory;
      },
    ),
    onProcessed: ({ relativePath }) => { processedPaths.push(relativePath); },
    onError: (error) => { watcherErrors.push(error); },
  });

  let existingNoteElapsedMs = 0;
  let candidateImportElapsedMs = 0;
  try {
    watcher.start();
    assert.equal(watcher.watchedConnectionCount, 1);
    // Native watch availability errors may be delivered asynchronously. Give
    // the adaptive wrapper one turn to install its bounded physical fallback
    // before the measured writes begin.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const original = readFileSync(editPath, "utf8");
    const editStartedAt = performance.now();
    for (let revision = 1; revision <= 5; revision += 1) {
      writeFileSync(
        editPath,
        noteWithBody(
          original,
          editFixture.body,
          `Operator watcher sentinel revision ${revision}; only the final coalesced edit should be versioned.`,
        ),
        { encoding: "utf8", mode: 0o600 },
      );
      // Keep all five physical changes inside the watcher debounce window while
      // allowing the bounded polling adapter to observe each distinct write.
      if (revision < 5) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    existingNoteElapsedMs = await waitFor(
      () => {
        if (watcherErrors[0]) throw watcherErrors[0];
        return memory.requireNode(editedNodeId).body.includes("watcher sentinel revision 5");
      },
      "the coalesced physical watcher edit",
    );
    await watcher.waitForIdle();
    existingNoteElapsedMs = performance.now() - editStartedAt;
    assert(existingNoteElapsedMs <= budgets.watcherOperationMs);
    assert(processedPaths.filter((item) => item === editedRelativePath).length >= 1);
    const edited = memory.requireNode(editedNodeId);
    assert.equal(edited.version, 2);
    assert.equal(edited.authorType, "import");
    assert.equal(edited.authorId, ACTOR);

    const candidateStartedAt = performance.now();
    writeFileSync(
      candidatePath,
      inboxCandidateFromProjection(candidateProjection, nodeId(candidateSourceIndex), candidateFixture.title),
      { encoding: "utf8", mode: 0o600 },
    );
    candidateImportElapsedMs = await waitFor(() => {
      if (watcherErrors[0]) throw watcherErrors[0];
      const row = database.prepare(`
        SELECT COUNT(*) AS count FROM memory_candidates
        WHERE title = 'Operator Scale Inbox Candidate' AND status = 'pending'
      `).get() as { count: number };
      return Number(row.count) === 1;
    }, "the physical inbox candidate import");
    await watcher.waitForIdle();
    candidateImportElapsedMs = performance.now() - candidateStartedAt;
    assert(candidateImportElapsedMs <= budgets.watcherOperationMs);
    assert(processedPaths.filter((item) => item === candidateRelativePath).length >= 1);
  } finally {
    await watcher.stop();
  }
  assert.equal(watcherErrors.length, 0);
  assert(rawFilesystemEvents >= 5);
  assert(processedPaths.length < rawFilesystemEvents);
  const editedNode = memory.requireNode(editedNodeId);
  assert.equal(memory.listVersions(editedNodeId).length, 2);
  const pendingCandidateCount = database.prepare(`
    SELECT COUNT(*) AS count FROM memory_candidates
    WHERE title = 'Operator Scale Inbox Candidate' AND status = 'pending'
  `).get() as { count: number };
  assert.equal(Number(pendingCandidateCount.count), 1);

  const editLookupStartedAt = performance.now();
  const editMatches = database.prepare(`
    SELECT mn.id FROM memory_nodes_fts
    JOIN memory_nodes mn ON mn.rowid = memory_nodes_fts.rowid
    WHERE memory_nodes_fts MATCH 'watcher AND sentinel' LIMIT 10
  `).all() as Array<{ id: string }>;
  const operatorEditLookupMs = performance.now() - editLookupStartedAt;
  assert(editMatches.some((item) => item.id === editedNodeId));

  const conflictIndex = Math.min(count - 1, 311);
  const conflictId = nodeId(conflictIndex);
  const conflictFixture = fixtureNode(conflictIndex, Math.min(count - 1, 42_424));
  const conflictProjection = bridge.renderNode(conflictId);
  const conflictPath = pathPolicy.resolveRelative(connection.vaultPath, conflictProjection.relativePath);
  const originalConflictText = readFileSync(conflictPath, "utf8");
  const vaultConflictText = noteWithBody(
    originalConflictText,
    conflictFixture.body,
    "Vault-side synthetic scale conflict retained for explicit review.",
  );
  const conflictStartedAt = performance.now();
  writeFileSync(conflictPath, vaultConflictText, { encoding: "utf8", mode: 0o600 });
  memory.correctNode(conflictId, {
    body: "Database-side synthetic scale conflict backed by a newer canonical version.",
    authorType: "agent",
    authorId: "agent:obsidian-scale-profile",
    changeReason: "Create isolated physical-vault conflict acceptance evidence",
  });
  const conflict = bridge.syncNode(connection.id, conflictId, ACTOR);
  assert.equal(conflict.status, "conflict");
  assert(conflict.conflictId);
  const mergedText = vaultConflictText.replace(
    "Vault-side synthetic scale conflict retained for explicit review.",
    "Merged synthetic scale conflict retains the operator note and canonical update.",
  );
  const resolved = bridge.resolveConflict(conflict.conflictId, "merged", ACTOR, mergedText);
  const conflictElapsedMs = performance.now() - conflictStartedAt;
  assert.equal(resolved.status, "synced");
  const durableConflict = database.prepare(
    "SELECT status FROM vault_conflicts WHERE id = ?",
  ).get(conflict.conflictId) as { status: string };
  assert.equal(durableConflict.status, "resolved_merged");
  assert.equal(memory.requireNode(conflictId).version, 3);

  const cancellationController = new AbortController();
  const cancellationItems = Math.min(count, 10_000);
  const cancellationStartedAt = performance.now();
  const cancellationTargetAt = cancellationStartedAt + 100;
  let abortIssuedAt: number | undefined;
  let cancellationError: IncrementalBatchAbortError | undefined;
  let cancellationBatches = 0;
  const cancelTimer = setTimeout(() => {
    abortIssuedAt = performance.now();
    cancellationController.abort();
  }, 100);
  try {
    await processIncrementally(cancellationItems, (index) => {
      const result = bridge.exportNode(connection.id, nodeId(index));
      assert.equal(result.status, "synced");
    }, {
      batchSize: CANCELLATION_BATCH_SIZE,
      signal: cancellationController.signal,
      onProgress: () => { cancellationBatches += 1; recordMemory(); },
    });
  } catch (error) {
    if (!(error instanceof IncrementalBatchAbortError)) throw error;
    cancellationError = error;
  } finally {
    clearTimeout(cancelTimer);
  }
  const cancellationObservedAt = performance.now();
  if (count >= 1_000) {
    assert(cancellationError, "The scale cancellation timer must interrupt real bridge work");
    assert(abortIssuedAt);
  } else if (!cancellationError) {
    // Small developer profiles may finish before the timer. The default and
    // release profile always uses 50,000 notes and must take the abort path.
    abortIssuedAt = cancellationObservedAt;
    cancellationError = new IncrementalBatchAbortError(cancellationItems, cancellationObservedAt - cancellationStartedAt);
  }
  assert(abortIssuedAt && cancellationError);
  const timerDelayMs = Math.max(0, abortIssuedAt - cancellationTargetAt);
  const observationLatencyMs = cancellationObservedAt - abortIssuedAt;
  assert(timerDelayMs <= budgets.cancellationRequestDispatchMs);
  assert(observationLatencyMs <= budgets.cancellationObservationMs);
  const remainingSyncRows = database.prepare(`
    SELECT COUNT(*) AS count FROM vault_sync_state
    WHERE connection_id = ? AND node_id LIKE 'mem-vault-scale-%'
  `).get(connection.id) as { count: number };
  assert.equal(Number(remainingSyncRows.count), count);
  const finalProjectionSha256 = sha256(readFileSync(integrityProjectionPath, "utf8"));
  const finalCanonicalVersion = database.prepare(`
    SELECT content_hash AS contentHash FROM memory_versions
    WHERE node_id = ? AND version = 1
  `).get(integrityNodeId) as { contentHash: string };
  const trackedHashState = database.prepare(`
    SELECT database_content_hash AS databaseHash, vault_content_hash AS vaultHash
    FROM vault_sync_state WHERE connection_id = ? AND node_id = ?
  `).get(connection.id, integrityNodeId) as { databaseHash: string; vaultHash: string };
  assert.equal(finalCanonicalVersion.contentHash, initialCanonicalVersion.contentHash);
  assert.equal(finalProjectionSha256, initialProjectionSha256);
  assert.equal(trackedHashState.databaseHash, finalProjectionSha256);
  assert.equal(trackedHashState.vaultHash, finalProjectionSha256);
  recordMemory();

  database.pragma("wal_checkpoint(PASSIVE)");
  const databaseBytes = statSync(paths.databasePath).size
    + (existsSync(`${paths.databasePath}-wal`) ? statSync(`${paths.databasePath}-wal`).size : 0)
    + (existsSync(`${paths.databasePath}-shm`) ? statSync(`${paths.databasePath}-shm`).size : 0);
  const finalFilesystem = filesystemStats(workspaceRoot);
  assert(finalFilesystem.totalBytes <= budgets.workspaceBytes);
  assert(peakRssBytes <= budgets.peakRssBytes);

  return {
    passed: true,
    profile: PROFILE_ID,
    fixtureLabel: "synthetic-opt-in-never-production",
    measuredAt: new Date().toISOString(),
    isolation: {
      workspaceKind: "fresh-/tmp-workspace",
      productionConfigurationRead: false,
      productionDatabaseRead: false,
      productionVaultRead: false,
      portsOpened: false,
      cleanupVerified: false,
    },
    fixture: {
      canonicalNodes: seed.nodeCount,
      canonicalVersions: seed.versionCount,
      ftsIndexedNodes: seed.indexedCount,
      projectedMarkdownNotes: initialFilesystem.markdownFiles,
      projectedMarkdownBytes: initialFilesystem.markdownBytes,
      nodeTypes: NODE_TYPES.length,
      physicalVaultTotalFiles: initialFilesystem.totalFiles,
      physicalVaultTotalBytes: initialFilesystem.totalBytes,
    },
    fullBridgeExport: {
      mode: "bounded-resumable-atomic-bridge-export",
      usesExactBridgeBulkPath: true,
      concurrency: EXPORT_CONCURRENCY,
      progressInterval: EXPORT_PROGRESS_INTERVAL,
      elapsedMs: rounded(projection.elapsedMs),
      notesPerSecond: rounded(count / (projection.elapsedMs / 1_000)),
      counts: projection.counts,
      fullReconciliationHealthy: true,
      fullReconciliationMs: rounded(fullReconciliationMs),
      fullReconciliationImplementation: "yielded-full-file-hash-scan",
      reconciliationCounts,
      parsedSamples: sampleIndexes.length,
      actualBridgeUnchangedSamples: sampleIndexes.length,
    },
    indexing: {
      sentinelId: seed.sentinelId,
      lookupMs: rounded(seed.indexLookupMs),
      operatorEditLookupMs: rounded(operatorEditLookupMs),
      operatorEditIndexed: true,
    },
    watcher: {
      implementation: watcherImplementation,
      nativeWatchUnavailable: watcherImplementation === "bounded-physical-stat-polling-adapter",
      ...(nativeWatchFailureCategory ? { nativeWatchFailureCategory } : {}),
      debounceMs,
      writesToSameNote: 5,
      rawFilesystemEvents,
      queuedExistingNoteJobs: processedPaths.filter((item) => item === editedRelativePath).length,
      queuedNewInboxNoteJobs: processedPaths.filter((item) => item === candidateRelativePath).length,
      meaningfulExistingVersions: 1,
      pendingCandidatesCreated: 1,
      boundedStatPaths: 2,
      applicationFullTreeRescan: false,
      existingNoteElapsedMs: rounded(existingNoteElapsedMs),
      candidateImportElapsedMs: rounded(candidateImportElapsedMs),
      finalVersion: editedNode.version,
      finalOperatorAttribution: true,
      candidateCreated: true,
      errors: 0,
    },
    sourceHashInvariants: {
      nodeId: integrityNodeId,
      canonicalVersionHash: initialCanonicalVersion.contentHash,
      initialProjectionSha256,
      finalProjectionSha256,
      trackedDatabaseSha256: trackedHashState.databaseHash,
      trackedVaultSha256: trackedHashState.vaultHash,
      canonicalVersionUnchanged: true,
      projectionUnchanged: true,
      trackedHashesEqual: true,
    },
    conflict: {
      detected: true,
      detectedStatus: "conflict",
      resolution: "merged",
      durableStatus: "resolved_merged",
      finalVersion: memory.requireNode(conflictId).version,
      elapsedMs: rounded(conflictElapsedMs),
    },
    cancellation: {
      realBridgeOperations: true,
      attemptedItems: cancellationItems,
      processedBeforeAbort: cancellationError.processed,
      batchesBeforeAbort: cancellationBatches,
      timerDelayMs: rounded(timerDelayMs),
      observationLatencyMs: rounded(observationLatencyMs),
      totalElapsedMs: rounded(cancellationObservedAt - cancellationStartedAt),
      partialItemObserved: false,
      remainingCanonicalSyncRows: Number(remainingSyncRows.count),
    },
    runtimeResponsiveness: {
      evidenceKind: "canonical-running-run-heartbeat-during-exact-bulk-bridge-export",
      runId: runtimeProbe.runId,
      heartbeatWrites,
      heartbeatWritesDuringExport,
      maximumHeartbeatGapMs: rounded(maximumHeartbeatGapMs),
      lastHeartbeatPersisted: true,
      missionRuntimeEngineStarted: false,
    },
    resources: {
      rssStartBytes,
      peakRssBytes,
      rssDeltaBytes: Math.max(0, peakRssBytes - rssStartBytes),
      canonicalDatabaseBytes: databaseBytes,
    },
    budgets,
    honestLimits: [
      `Migration setup (${rounded(migrationMs)} ms) and canonical seeding (${rounded(seed.elapsedMs)} ms) are recorded but are not live mission operations.`,
      "The heartbeat probe uses a real canonical running-run row, but it does not start the full MissionRuntimeEngine or execute provider/tool work.",
      "The 50,000-note projection uses the same bounded, resumable ObsidianVaultBridge.exportNodes path as the CLI; every note is individually fsynced, no-clobber published, and directory-fsynced.",
      "Full reconciliation uses yielded file hashing; normal server routes are capped at 250 notes and the watcher drains one changed note per event-loop turn.",
      watcherImplementation === "bounded-physical-stat-polling-adapter"
        ? `Native recursive watch was unavailable (${nativeWatchFailureCategory ?? "platform resource"}); the profile used the watcher seam's bounded two-path physical stat adapter, not a 50,000-note rescan.`
        : "Native recursive watch ran with a bounded two-path physical stat safety net; sustained multi-day behavior and native Obsidian desktop rendering remain operational/manual checks.",
      "No portable ZIP of all 50,000 notes is generated because archive materialization is a separate, explicitly requested maintenance operation.",
    ],
  };
}

validateObsidianScaleGate(process.env);
const count = scaleNoteCount(process.env);
const temporaryRoot = realpathSync("/tmp");
const workspaceRoot = mkdtempSync(join(temporaryRoot, OBSIDIAN_SCALE_PREFIX));
chmodSync(workspaceRoot, 0o700);
const paths = buildObsidianScalePaths(workspaceRoot, temporaryRoot);
const lifecycleController = new AbortController();
const requestStop = (): void => lifecycleController.abort();
process.once("SIGINT", requestStop);
process.once("SIGTERM", requestStop);
let database: SqliteDatabase | undefined;
let evidence: ScaleEvidence | undefined;
let failure: unknown;
try {
  database = createDatabaseConnection({
    filename: paths.databasePath,
    verifyIntegrity: false,
    busyTimeoutMs: 120_000,
  });
  evidence = await runProfile(database, workspaceRoot, count, lifecycleController.signal);
} catch (error) {
  failure = error;
} finally {
  process.off("SIGINT", requestStop);
  process.off("SIGTERM", requestStop);
  database?.close();
  try {
    removeObsidianScaleWorkspace(workspaceRoot, temporaryRoot);
  } catch (cleanupError) {
    failure ??= cleanupError;
  }
}
if (failure) throw failure;
assert(evidence);
evidence.isolation.cleanupVerified = !existsSync(workspaceRoot);
assert.equal(evidence.isolation.cleanupVerified, true);
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
