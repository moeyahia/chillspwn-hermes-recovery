import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import type { SqliteDatabase } from "../db/types";
import { inImmediateTransaction } from "../db/transaction";
import {
  getMemoryControlPolicy,
  memoryCandidateAllowed,
  type MemoryControlPolicy,
} from "../memory/MemoryControlPolicy";
import {
  assertReusableMemoryText,
  MemoryRepository,
  REUSABLE_MEMORY_LIMITS,
  ReusableMemorySafetyError,
  type CreateMemoryEdgeInput,
  type ForgetResult,
  type MemoryNode,
  type MemoryProvenance,
  type ProvenanceSource,
} from "../memory/index";
import {
  parseObsidianNote,
  renderObsidianNote,
  vaultRelativePath,
} from "./ObsidianMarkdown";
import { safeVaultSegment, VaultPathPolicy } from "./VaultPathPolicy";
import { obsidianDeepLink } from "./ObsidianDeepLink";
import { writePortableZip, type PortableZipEntry } from "./PortableZip";
import type {
  VaultConnection,
  VaultImportResult,
  VaultNote,
  VaultPortableExport,
  VaultSyncVerification,
  VaultSyncVerificationItem,
  VaultSyncResult,
} from "./types";

interface ConnectionRow {
  id: string;
  vault_path: string;
  display_name: string;
  status: VaultConnection["status"];
  sync_scope_json: string;
  permission_granted_at: string;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

interface SyncStateRow {
  id: string;
  connection_id: string;
  node_id: string | null;
  relative_path: string;
  database_version: number | null;
  vault_content_hash: string | null;
  database_content_hash: string | null;
  status: string;
  last_scanned_at: string | null;
  last_synced_at: string | null;
  error_message: string | null;
}

interface BridgeOptions {
  readonly clock?: () => Date;
  readonly createId?: (prefix: string) => string;
}

interface CanonicalVaultAttachment {
  readonly artifactId: string;
  readonly missionId: string;
  readonly contentHash: string;
  readonly byteSize: number;
  readonly mediaType?: string;
  readonly extension: string;
  readonly storageUri: string;
  readonly relativePath: string;
}

interface ArtifactRow {
  readonly id: string;
  readonly mission_id: string;
  readonly journey: "autonomous" | "guided";
  readonly artifact_type: string;
  readonly storage_uri: string;
  readonly content_hash: string;
  readonly byte_size: number;
  readonly media_type: string | null;
  readonly sensitivity: MemoryNode["sensitivity"];
  readonly metadata_json: string;
}

const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_NOTE = 32;
const ATTACHMENT_EXTENSIONS = new Map<string, string>([
  [".avif", "image/avif"],
  [".csv", "text/csv"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".json", "application/json"],
  [".log", "text/plain"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".txt", "text/plain"],
  [".webp", "image/webp"],
]);

function hashText(value: string): string {
  return createHash("sha256").update(value.replaceAll("\r\n", "\n"), "utf8").digest("hex");
}

function attachmentExtension(relativePath: string): { extension: string; mediaType: string } {
  if (relativePath.includes("\\") || relativePath.includes("\0")) {
    throw new Error("Vault attachment path is invalid");
  }
  const segments = relativePath.split("/");
  if (segments.length !== 2 || segments[0] !== "Attachments" || !segments[1] || [".", ".."].includes(segments[1])) {
    throw new Error("Vault attachments must be direct files in the managed Attachments directory");
  }
  const extension = extname(segments[1]).toLowerCase();
  const mediaType = ATTACHMENT_EXTENSIONS.get(extension);
  if (!mediaType) throw new Error("Vault attachment type is not permitted");
  return { extension, mediaType };
}

function attachmentStorageUri(connectionId: string, contentHash: string): string {
  return `vault-attachment://${encodeURIComponent(connectionId)}/${contentHash}`;
}

function parseAttachmentStorageUri(value: string): { connectionId: string; contentHash: string } {
  const match = /^vault-attachment:\/\/([^/]+)\/([a-f0-9]{64})$/u.exec(value);
  if (!match) throw new Error("Canonical vault attachment storage reference is invalid");
  let connectionId: string;
  try {
    connectionId = decodeURIComponent(match[1]!);
  } catch {
    throw new Error("Canonical vault attachment connection reference is invalid");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(connectionId)) {
    throw new Error("Canonical vault attachment connection reference is invalid");
  }
  return { connectionId, contentHash: match[2]! };
}

function parseJsonObject(source: string): Record<string, unknown> {
  const value = JSON.parse(source) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Stored vault sync scope is malformed");
  }
  return value as Record<string, unknown>;
}

function connectionFromRow(row: ConnectionRow): VaultConnection {
  return {
    id: row.id,
    vaultPath: row.vault_path,
    displayName: row.display_name,
    status: row.status,
    syncScope: parseJsonObject(row.sync_scope_json),
    permissionGrantedAt: row.permission_granted_at,
    ...(row.last_sync_at ? { lastSyncAt: row.last_sync_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Obsidian-compatible projection and import bridge. SQLite remains canonical;
 * files are versioned human-editable projections with explicit conflicts.
 */
export class ObsidianVaultBridge {
  readonly #database: SqliteDatabase;
  readonly #memory: MemoryRepository;
  readonly #paths: VaultPathPolicy;
  readonly #clock: () => Date;
  readonly #createId: (prefix: string) => string;

  constructor(
    database: SqliteDatabase,
    memory: MemoryRepository,
    pathPolicy: VaultPathPolicy,
    options: BridgeOptions = {},
  ) {
    this.#database = database;
    this.#memory = memory;
    this.#paths = pathPolicy;
    this.#clock = options.clock ?? (() => new Date());
    this.#createId = options.createId ?? ((prefix) => `${prefix}_${randomUUID()}`);
  }

  #now(): string {
    return this.#clock().toISOString();
  }

  /**
   * Read policy at the point of use so disabling vault synchronization takes
   * effect for API, CLI, and watcher work without a process restart.
   */
  memoryControlPolicy(): MemoryControlPolicy {
    return getMemoryControlPolicy(this.#database);
  }

  vaultSyncEnabled(): boolean {
    const policy = this.memoryControlPolicy();
    return policy.enabled && policy.obsidianSyncScope !== "disabled";
  }

  projectionLifecycleStatuses(): readonly MemoryNode["lifecycleStatus"][] {
    const policy = this.memoryControlPolicy();
    if (!policy.enabled || policy.obsidianSyncScope === "disabled") return [];
    return policy.obsidianSyncScope === "confirmed"
      ? ["confirmed"]
      : ["confirmed", "verified"];
  }

  assertVaultSyncAllowed(): MemoryControlPolicy {
    const policy = this.memoryControlPolicy();
    if (!policy.enabled || policy.obsidianSyncScope === "disabled") {
      throw new Error("Obsidian synchronization is not permitted by the memory control policy");
    }
    return policy;
  }

  #assertProjectionAllowed(node: MemoryNode): void {
    this.assertVaultSyncAllowed();
    if (!this.projectionLifecycleStatuses().includes(node.lifecycleStatus)) {
      throw new Error(
        `Memory lifecycle ${node.lifecycleStatus} is not permitted by the current Obsidian projection scope`,
      );
    }
  }

  connect(input: {
    readonly id?: string;
    readonly vaultPath: string;
    readonly displayName: string;
    readonly syncScope?: Record<string, unknown>;
    readonly permissionGranted: boolean;
  }): VaultConnection {
    this.assertVaultSyncAllowed();
    if (!input.permissionGranted) throw new Error("Explicit filesystem permission is required");
    if (!input.displayName.trim()) throw new TypeError("Vault display name is required");
    const vaultPath = this.#paths.resolveVault(input.vaultPath);
    this.#createVaultFolders(vaultPath);
    const id = input.id ?? this.#createId("vault");
    const now = this.#now();
    this.#database.prepare(`
      INSERT INTO vault_connections (
        id, vault_path, display_name, status, sync_scope_json,
        permission_granted_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'connected', ?, ?, ?, ?)
    `).run(id, vaultPath, input.displayName.trim(), JSON.stringify(input.syncScope ?? {}), now, now, now);
    return this.requireConnection(id);
  }

  #createVaultFolders(vaultRoot: string): void {
    for (const folder of [
      "00 Inbox",
      "10 Operator",
      "20 Missions",
      "30 Attack Patterns",
      "40 Tools and Capabilities",
      "50 Evidence and Findings",
      "60 Failures and Recoveries",
      "70 Lessons",
      "80 Agents",
      "90 Reports",
      "Attachments",
      ".chillspwn/attachments",
      ".chillspwn/quarantine",
      ".chillspwn/forget-staging",
    ]) {
      this.#paths.resolveRelative(vaultRoot, folder, true);
      mkdirSync(this.#paths.resolveRelative(vaultRoot, folder), { recursive: true, mode: 0o700 });
    }
  }

  requireConnection(id: string): VaultConnection {
    const row = this.#database.prepare("SELECT * FROM vault_connections WHERE id = ?").get(id) as ConnectionRow | undefined;
    if (!row) throw new Error(`Vault connection not found: ${id}`);
    const connection = connectionFromRow(row);
    this.#paths.resolveVault(connection.vaultPath);
    return connection;
  }

  markConnectionHealth(connectionId: string, status: "connected" | "degraded" | "error"): void {
    this.requireConnection(connectionId);
    this.#database.prepare(`
      UPDATE vault_connections SET status = ?, updated_at = ? WHERE id = ?
    `).run(status, this.#now(), connectionId);
  }

  deepLink(connectionId: string, relativePath?: string): string {
    const connection = this.requireConnection(connectionId);
    if (relativePath) this.#paths.resolveRelative(connection.vaultPath, relativePath);
    return obsidianDeepLink(connection, relativePath);
  }

  renderNode(nodeId: string): {
    node: MemoryNode;
    text: string;
    relativePath: string;
    attachments: readonly CanonicalVaultAttachment[];
  } {
    const node = this.#memory.requireNode(nodeId);
    const sources = this.#database.prepare(`
      SELECT source_id AS sourceId FROM memory_sources WHERE node_id = ? ORDER BY acquired_at
    `).all(nodeId) as Array<{ sourceId: string }>;
    const rows = this.#database.prepare(`
      SELECT target_node_id FROM memory_edges
      WHERE source_node_id = ? AND lifecycle_status IN ('confirmed', 'verified')
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY created_at
    `).all(nodeId, this.#now()) as Array<{ target_node_id: string }>;
    const outgoing = this.#memory.listEdges(nodeId)
      .filter((edge) => edge.sourceNodeId === nodeId)
      .flatMap((edge) => {
        const target = this.#memory.getNode(edge.targetNodeId);
        return target ? [{ edge, target }] : [];
      });
    // `rows` intentionally causes SQLite to use the directed adjacency index;
    // the repository mapping above supplies validated domain records.
    void rows;
    const attachments = this.#attachmentsForNode(node);
    const text = renderObsidianNote(
      node,
      sources.map((source) => ({ sourceId: source.sourceId })),
      outgoing,
      attachments,
    );
    assertReusableMemoryText([{
      field: "vaultProjection.note",
      value: text,
      maximumBytes: REUSABLE_MEMORY_LIMITS.vaultNote,
    }]);
    return {
      node,
      text,
      relativePath: vaultRelativePath(node),
      attachments,
    };
  }

  exportNode(connectionId: string, nodeId: string): VaultSyncResult {
    const connection = this.requireConnection(connectionId);
    const rendered = this.renderNode(nodeId);
    this.#assertProjectionAllowed(rendered.node);
    const state = this.#stateForNode(connectionId, nodeId);
    const relativePath = state?.relative_path ?? rendered.relativePath;
    const filePath = this.#paths.resolveRelative(connection.vaultPath, relativePath, true);
    const databaseHash = hashText(rendered.text);
    const vaultText = existsSync(filePath) ? readFileSync(filePath, "utf8") : undefined;
    if (vaultText !== undefined) {
      const quarantined = this.#quarantineUnsafeVaultSource(connection, rendered.node, relativePath, vaultText);
      if (quarantined) return quarantined;
    }
    const vaultHash = vaultText === undefined ? undefined : hashText(vaultText);

    if (!state && vaultText !== undefined && vaultHash !== databaseHash) {
      return this.#createConflict(connection, undefined, rendered.node, relativePath, rendered.text, vaultText);
    }
    if (state) {
      const databaseChanged = state.database_content_hash !== databaseHash;
      const vaultChanged = vaultHash !== undefined && state.vault_content_hash !== vaultHash;
      if (databaseChanged && vaultChanged && vaultHash !== databaseHash && vaultText !== undefined) {
        return this.#createConflict(connection, state, rendered.node, relativePath, rendered.text, vaultText);
      }
      if (!databaseChanged && vaultChanged && vaultText !== undefined) {
        this.#updateState(state.id, "vault_ahead", rendered.node.version, databaseHash, vaultHash, undefined, false);
        return {
          connectionId,
          nodeId,
          relativePath,
          status: "vault_ahead",
          message: "The Obsidian note changed and is ready to import",
        };
      }
    }

    this.#projectAttachments(connection, rendered.attachments);
    this.#paths.atomicWrite(connection.vaultPath, relativePath, rendered.text);
    this.#upsertSyncedState(connectionId, rendered.node, relativePath, databaseHash);
    this.#touchConnection(connectionId);
    return {
      connectionId,
      nodeId,
      relativePath,
      status: "synced",
      message: "Memory note exported atomically",
    };
  }

  syncNode(connectionId: string, nodeId: string, actor: string): VaultSyncResult {
    const connection = this.requireConnection(connectionId);
    const rendered = this.renderNode(nodeId);
    this.#assertProjectionAllowed(rendered.node);
    const state = this.#stateForNode(connectionId, nodeId);
    if (!state) return this.exportNode(connectionId, nodeId);
    const path = this.#paths.resolveRelative(connection.vaultPath, state.relative_path);
    if (!existsSync(path)) return this.exportNode(connectionId, nodeId);
    const vaultText = readFileSync(path, "utf8");
    const quarantined = this.#quarantineUnsafeVaultSource(
      connection,
      rendered.node,
      state.relative_path,
      vaultText,
    );
    if (quarantined) return quarantined;
    const databaseHash = hashText(rendered.text);
    const vaultHash = hashText(vaultText);
    const databaseChanged = state.database_content_hash !== databaseHash;
    const vaultChanged = state.vault_content_hash !== vaultHash;
    if (databaseChanged && vaultChanged && databaseHash !== vaultHash) {
      return this.#createConflict(connection, state, rendered.node, state.relative_path, rendered.text, vaultText);
    }
    if (vaultChanged && !databaseChanged) {
      const imported = this.importNote(connectionId, state.relative_path, actor, true);
      if (imported.status === "quarantined") {
        return {
          connectionId,
          nodeId,
          relativePath: state.relative_path,
          status: "quarantined",
          message: "Malformed vault note was quarantined",
        };
      }
      const normalized = this.renderNode(nodeId);
      const normalizedHash = hashText(normalized.text);
      this.#projectAttachments(connection, normalized.attachments);
      this.#paths.atomicWrite(connection.vaultPath, state.relative_path, normalized.text);
      this.#upsertSyncedState(connectionId, normalized.node, state.relative_path, normalizedHash);
      this.#touchConnection(connectionId);
      return {
        connectionId,
        nodeId,
        relativePath: state.relative_path,
        status: "synced",
        message: imported.status === "updated"
          ? "Vault edit was versioned in the database and the projection was normalized"
          : "Vault note is synchronized",
      };
    }
    return this.exportNode(connectionId, nodeId);
  }

  importNote(
    connectionId: string,
    relativePath: string,
    actor: string,
    allowExistingUpdate = false,
  ): VaultImportResult {
    const memoryPolicy = this.assertVaultSyncAllowed();
    const connection = this.requireConnection(connectionId);
    const path = this.#paths.resolveRelative(connection.vaultPath, relativePath);
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error("Vault note does not exist");
    const source = readFileSync(path, "utf8");
    const sourceHash = hashText(source);
    const priorState = this.#stateForPath(connectionId, relativePath);
    if (
      !allowExistingUpdate
      && priorState?.node_id === null
      && priorState.vault_content_hash === sourceHash
      && priorState.status === "pending"
    ) {
      return { relativePath, status: "unchanged" };
    }
    try {
      assertReusableMemoryText([{
        field: "vaultNote.relativePath",
        value: relativePath,
        maximumBytes: 1_000,
      }]);
      this.#assertVaultSourceSafe(source);
    } catch (error) {
      if (!(error instanceof ReusableMemorySafetyError)) throw error;
      const quarantinePath = this.#quarantine(
        connection,
        relativePath,
        "Vault note rejected by reusable-memory safety policy",
        true,
      );
      return { relativePath, status: "quarantined", quarantinePath };
    }
    let note: VaultNote;
    try {
      note = parseObsidianNote(source);
      this.#assertVaultNoteSafe(note);
    } catch (error) {
      const quarantinePath = this.#quarantine(
        connection,
        relativePath,
        error instanceof ReusableMemorySafetyError
          ? "Vault note rejected by reusable-memory safety policy"
          : error instanceof Error ? error.message : String(error),
        error instanceof ReusableMemorySafetyError,
      );
      return { relativePath, status: "quarantined", quarantinePath };
    }
    const existing = this.#memory.getNode(note.id);
    const candidateImport = !existing || relativePath.startsWith("00 Inbox/");
    if (candidateImport && !memoryCandidateAllowed(memoryPolicy, note.nodeType)) {
      throw new Error("This Obsidian note type is not permitted by the current memory candidate policy");
    }
    let attachmentSources: readonly ProvenanceSource[];
    try {
      attachmentSources = this.#importAttachments(connection, note);
    } catch {
      const quarantinePath = this.#quarantine(
        connection,
        relativePath,
        "Vault attachment rejected by integrity policy",
        true,
      );
      return { relativePath, status: "quarantined", quarantinePath };
    }
    const provenance: MemoryProvenance = {
      method: "imported",
      explanation: "Imported from an explicitly connected Obsidian vault",
      sources: [
        {
          sourceType: "obsidian_note",
          sourceId: `${connectionId}:${relativePath}`,
          sourceHash,
          acquiredAt: this.#now(),
        },
        ...attachmentSources,
      ],
    };
    if (candidateImport) {
      const candidate = this.#memory.createCandidate({
        nodeType: note.nodeType,
        title: note.title,
        summary: note.summary,
        body: note.body,
        scope: note.scope,
        sensitivity: note.sensitivity,
        confidence: note.confidence,
        provenance,
        proposedBy: actor,
      });
      this.#upsertPendingImportState(connectionId, relativePath, sourceHash);
      return { relativePath, status: "candidate", candidateId: candidate.id };
    }
    if (!allowExistingUpdate) {
      throw new Error("Updating an existing memory requires a version-aware sync operation");
    }
    this.#assertProjectionAllowed(existing);
    if (note.nodeType !== existing.nodeType || JSON.stringify(note.scope) !== JSON.stringify(existing.scope)) {
      throw new Error("Node type and memory scope cannot be changed through automatic vault sync");
    }
    if (note.version !== existing.version) {
      throw new Error("Vault note version does not match the canonical memory version");
    }
    const existingSourceKeys = new Set(
      existing.provenance.sources.map((item) => `${item.sourceType}\0${item.sourceId}`),
    );
    const newAttachmentSources = attachmentSources.filter(
      (item) => !existingSourceKeys.has(`${item.sourceType}\0${item.sourceId}`),
    );
    if (
      note.title === existing.title && note.summary === existing.summary && note.body === existing.body &&
      note.sensitivity === existing.sensitivity && note.confidence === existing.confidence &&
      newAttachmentSources.length === 0
    ) {
      return { relativePath, status: "unchanged", nodeId: existing.id };
    }
    const updated = this.#memory.correctNode(existing.id, {
      title: note.title,
      summary: note.summary,
      body: note.body,
      sensitivity: note.sensitivity,
      confidence: note.confidence,
      expiresAt: note.expiresAt ?? null,
      additionalProvenanceSources: newAttachmentSources,
      authorType: "import",
      authorId: actor,
      changeReason: "Operator edited synchronized Obsidian note",
    });
    this.#importEdges(updated, note, provenance, actor);
    return { relativePath, status: "updated", nodeId: updated.id };
  }

  /**
   * Process one debounced path. Unchanged bridge-authored writes are ignored,
   * deletions are restored from SQLite, and new notes enter candidate review.
   */
  syncChangedPath(
    connectionId: string,
    relativePath: string,
    actor: string,
  ): VaultSyncResult | VaultImportResult | null {
    this.assertVaultSyncAllowed();
    const connection = this.requireConnection(connectionId);
    if (!relativePath.toLowerCase().endsWith(".md")) return null;
    const path = this.#paths.resolveRelative(connection.vaultPath, relativePath);
    const state = this.#stateForPath(connectionId, relativePath);
    if (state?.node_id) {
      if (existsSync(path)) {
        const currentHash = hashText(readFileSync(path, "utf8"));
        if (state.vault_content_hash === currentHash) return null;
      }
      return this.syncNode(connectionId, state.node_id, actor);
    }
    if (!existsSync(path)) return null;
    const currentHash = hashText(readFileSync(path, "utf8"));
    if (state?.vault_content_hash === currentHash && ["pending", "quarantined"].includes(state.status)) return null;
    return this.importNote(connectionId, relativePath, actor);
  }

  async createPortableExport(
    connectionId: string,
    nodeIds: readonly string[],
    actor: string,
  ): Promise<VaultPortableExport> {
    this.assertVaultSyncAllowed();
    const connection = this.requireConnection(connectionId);
    const createdAt = this.#now();
    const uniqueIds = [...new Set(nodeIds)];
    const entries: PortableZipEntry[] = [];
    const portableAttachments = new Map<string, PortableZipEntry>();
    for (const nodeId of uniqueIds) {
      const rendered = this.renderNode(nodeId);
      this.#assertProjectionAllowed(rendered.node);
      entries.push({ name: rendered.relativePath, data: rendered.text });
      for (const attachment of rendered.attachments) {
        if (portableAttachments.has(attachment.contentHash)) continue;
        portableAttachments.set(attachment.contentHash, {
          name: attachment.relativePath,
          filePath: this.#canonicalAttachmentPath(attachment),
        });
      }
    }
    entries.push(...portableAttachments.values());
    const manifest = {
      schemaVersion: "2.1",
      product: "ChillsPwn Command OS",
      sourceOfTruth: "canonical-sqlite",
      vault: connection.displayName,
      generatedAt: createdAt,
      generatedBy: actor,
      noteCount: uniqueIds.length,
      attachmentCount: portableAttachments.size,
      includesObsidianSettings: false,
    };
    entries.push({ name: "chillspwn-vault-manifest.json", data: `${JSON.stringify(manifest, null, 2)}\n` });
    const stamp = createdAt.replace(/[:.]/gu, "-");
    const archiveName = `chillspwn-brain-${stamp}-${randomUUID()}.zip`;
    const archivePath = this.#paths.resolveRelative(
      connection.vaultPath,
      `.chillspwn/exports/${archiveName}`,
      true,
    );
    const result = await writePortableZip(entries, archivePath, new Date(createdAt));
    return {
      connectionId,
      archiveName,
      archivePath,
      sha256: result.sha256,
      byteSize: result.byteSize,
      fileCount: result.fileCount,
      createdAt,
    };
  }

  portableExportPath(connectionId: string, archiveName: string): string {
    const connection = this.requireConnection(connectionId);
    if (!/^chillspwn-brain-[A-Za-z0-9._-]+\.zip$/u.test(archiveName) || basename(archiveName) !== archiveName) {
      throw new TypeError("Portable vault archive name is invalid");
    }
    const path = this.#paths.resolveRelative(connection.vaultPath, `.chillspwn/exports/${archiveName}`);
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error("Portable vault archive was not found");
    return path;
  }

  /** Compare canonical content, tracked hashes, and projection files read-only. */
  verifyConnection(connectionId: string): VaultSyncVerification {
    const connection = this.requireConnection(connectionId);
    const rows = this.#database.prepare(`
      SELECT * FROM vault_sync_state WHERE connection_id = ? ORDER BY relative_path
    `).all(connectionId) as SyncStateRow[];
    const items: VaultSyncVerificationItem[] = rows.map((state) => {
      const path = this.#paths.resolveRelative(connection.vaultPath, state.relative_path);
      if (state.status === "quarantined") {
        return { relativePath: state.relative_path, ...(state.node_id ? { nodeId: state.node_id } : {}), status: "quarantined" };
      }
      if (!state.node_id) {
        return {
          relativePath: state.relative_path,
          status: existsSync(path) ? "pending" : "missing",
        };
      }
      const node = this.#memory.getNode(state.node_id, true);
      if (!node || node.lifecycleStatus === "forgotten") {
        return { relativePath: state.relative_path, nodeId: state.node_id, status: existsSync(path) ? "vault_ahead" : "missing" };
      }
      const rendered = this.renderNode(node.id);
      const databaseHash = hashText(rendered.text);
      if (!existsSync(path)) return { relativePath: state.relative_path, nodeId: node.id, status: "missing" };
      const vaultHash = hashText(readFileSync(path, "utf8"));
      const databaseChanged = state.database_content_hash !== databaseHash;
      const vaultChanged = state.vault_content_hash !== vaultHash;
      const status: VaultSyncVerificationItem["status"] = databaseChanged && vaultChanged && databaseHash !== vaultHash
        ? "conflict"
        : databaseChanged
          ? "database_ahead"
          : vaultChanged
            ? "vault_ahead"
            : "synced";
      return { relativePath: state.relative_path, nodeId: node.id, status };
    });
    const statuses: VaultSyncVerificationItem["status"][] = [
      "synced", "database_ahead", "vault_ahead", "conflict", "missing", "pending", "quarantined",
    ];
    const counts = Object.fromEntries(statuses.map((status) => [status, items.filter((item) => item.status === status).length])) as Record<VaultSyncVerificationItem["status"], number>;
    return {
      connectionId,
      healthy: counts.database_ahead === 0 && counts.vault_ahead === 0 && counts.conflict === 0 && counts.missing === 0 && counts.quarantined === 0,
      checkedAt: this.#now(),
      counts,
      items,
    };
  }

  #attachmentFromArtifactRow(row: ArtifactRow): CanonicalVaultAttachment {
    if (row.artifact_type !== "obsidian_attachment") {
      throw new Error("Memory attachment source is not an Obsidian attachment artifact");
    }
    const contentHash = row.content_hash.toLowerCase();
    if (!/^[a-f0-9]{64}$/u.test(contentHash) || row.byte_size < 0 || row.byte_size > MAX_ATTACHMENT_BYTES) {
      throw new Error("Canonical vault attachment metadata is invalid");
    }
    const storage = parseAttachmentStorageUri(row.storage_uri);
    if (storage.contentHash !== contentHash) {
      throw new Error("Canonical vault attachment storage hash does not match its artifact record");
    }
    const metadata = parseJsonObject(row.metadata_json);
    if (typeof metadata.extension !== "string") {
      throw new Error("Canonical vault attachment extension metadata is missing");
    }
    const checked = attachmentExtension(`Attachments/attachment${metadata.extension}`);
    if (row.media_type && row.media_type !== checked.mediaType) {
      throw new Error("Canonical vault attachment media type does not match its extension");
    }
    return {
      artifactId: row.id,
      missionId: row.mission_id,
      contentHash,
      byteSize: row.byte_size,
      ...(row.media_type ? { mediaType: row.media_type } : {}),
      extension: checked.extension,
      storageUri: row.storage_uri,
      relativePath: `Attachments/${contentHash}${checked.extension}`,
    };
  }

  #attachmentsForNode(node: MemoryNode): readonly CanonicalVaultAttachment[] {
    const rows = this.#database.prepare(`
      SELECT a.id, a.mission_id, a.journey, a.artifact_type, a.storage_uri, a.content_hash,
        a.byte_size, a.media_type, a.sensitivity, a.metadata_json
      FROM memory_sources ms
      JOIN artifacts a ON a.id = ms.source_id
      WHERE ms.node_id = ? AND ms.source_type = 'artifact'
        AND a.artifact_type = 'obsidian_attachment'
      ORDER BY ms.acquired_at, a.id
    `).all(node.id) as ArtifactRow[];
    if (rows.length === 0) return [];
    if (node.scope.kind !== "mission" || !node.scope.missionId) {
      throw new Error("Obsidian attachments require mission-scoped memory");
    }
    if (rows.length > MAX_ATTACHMENTS_PER_NOTE) {
      throw new Error("Memory note exceeds the attachment count limit");
    }
    return rows.map((row) => {
      if (row.mission_id !== node.scope.missionId) {
        throw new Error("Memory attachment crosses its canonical mission boundary");
      }
      return this.#attachmentFromArtifactRow(row);
    });
  }

  #canonicalAttachmentPath(attachment: CanonicalVaultAttachment): string {
    const storage = parseAttachmentStorageUri(attachment.storageUri);
    if (storage.contentHash !== attachment.contentHash) {
      throw new Error("Canonical vault attachment storage reference is inconsistent");
    }
    const sourceConnection = this.requireConnection(storage.connectionId);
    const path = this.#paths.resolveRelative(
      sourceConnection.vaultPath,
      `.chillspwn/attachments/${attachment.contentHash}`,
    );
    if (!existsSync(path)) throw new Error("Canonical vault attachment bytes are missing");
    const metadata = lstatSync(path);
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size !== attachment.byteSize) {
      throw new Error("Canonical vault attachment is not a matching regular file");
    }
    const actualHash = createHash("sha256").update(readFileSync(path)).digest("hex");
    if (actualHash !== attachment.contentHash) {
      throw new Error("Canonical vault attachment failed its SHA-256 integrity check");
    }
    return path;
  }

  #projectAttachments(
    connection: VaultConnection,
    attachments: readonly CanonicalVaultAttachment[],
  ): void {
    for (const attachment of attachments) {
      const sourcePath = this.#canonicalAttachmentPath(attachment);
      const destination = this.#paths.resolveRelative(
        connection.vaultPath,
        attachment.relativePath,
        true,
      );
      if (existsSync(destination)) {
        const metadata = lstatSync(destination);
        if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size !== attachment.byteSize) {
          throw new Error("Projected vault attachment conflicts with a non-matching file");
        }
        const existingHash = createHash("sha256").update(readFileSync(destination)).digest("hex");
        if (existingHash !== attachment.contentHash) {
          throw new Error("Projected vault attachment failed its SHA-256 integrity check");
        }
        continue;
      }
      this.#paths.atomicWriteBytes(connection.vaultPath, attachment.relativePath, readFileSync(sourcePath));
    }
  }

  #importAttachments(
    connection: VaultConnection,
    note: VaultNote,
  ): readonly ProvenanceSource[] {
    if (note.attachments.length === 0) return [];
    if (note.attachments.length > MAX_ATTACHMENTS_PER_NOTE) {
      throw new Error("Vault note exceeds the attachment count limit");
    }
    if (note.scope.kind !== "mission" || !note.scope.missionId) {
      throw new Error("Vault attachments require mission-scoped memory");
    }
    const missionId = note.scope.missionId;
    const mission = this.#database.prepare("SELECT id, journey FROM missions WHERE id = ?").get(missionId) as
      | { id: string; journey: "autonomous" | "guided" }
      | undefined;
    if (!mission) throw new Error("Vault attachment mission does not exist");

    const now = this.#now();
    const sources = new Map<string, ProvenanceSource>();
    for (const reference of note.attachments) {
      const { extension, mediaType } = attachmentExtension(reference.relativePath);
      const sourcePath = this.#paths.resolveRelative(connection.vaultPath, reference.relativePath);
      if (!existsSync(sourcePath)) throw new Error("Referenced vault attachment does not exist");
      const sourceMetadata = lstatSync(sourcePath);
      if (sourceMetadata.isSymbolicLink() || !sourceMetadata.isFile()) {
        throw new Error("Vault attachment must be a regular non-symbolic-link file");
      }
      if (sourceMetadata.size > MAX_ATTACHMENT_BYTES) {
        throw new Error("Vault attachment exceeds the byte-size limit");
      }
      const bytes = readFileSync(sourcePath);
      const contentHash = createHash("sha256").update(bytes).digest("hex");
      if (reference.contentHash && reference.contentHash !== contentHash) {
        throw new Error("Vault attachment marker failed its SHA-256 integrity check");
      }

      const artifact = inImmediateTransaction(this.#database, () => {
        let row: ArtifactRow | undefined;
        if (reference.artifactId) {
          row = this.#database.prepare(`
            SELECT id, mission_id, journey, artifact_type, storage_uri, content_hash,
              byte_size, media_type, sensitivity, metadata_json
            FROM artifacts WHERE id = ?
          `).get(reference.artifactId) as ArtifactRow | undefined;
          if (!row) throw new Error("Vault attachment marker references an unknown artifact");
        } else {
          row = this.#database.prepare(`
            SELECT id, mission_id, journey, artifact_type, storage_uri, content_hash,
              byte_size, media_type, sensitivity, metadata_json
            FROM artifacts
            WHERE mission_id = ? AND artifact_type = 'obsidian_attachment' AND content_hash = ?
            ORDER BY created_at, id LIMIT 1
          `).get(missionId, contentHash) as ArtifactRow | undefined;
        }
        if (row) {
          const canonical = this.#attachmentFromArtifactRow(row);
          if (
            canonical.missionId !== missionId ||
            row.journey !== mission.journey ||
            canonical.contentHash !== contentHash ||
            canonical.byteSize !== bytes.length
          ) {
            throw new Error("Vault attachment marker does not match its canonical artifact");
          }
          this.#canonicalAttachmentPath(canonical);
          return canonical;
        }

        const artifactId = this.#createId("artifact");
        const canonicalRelativePath = `.chillspwn/attachments/${contentHash}`;
        const canonicalPath = this.#paths.resolveRelative(
          connection.vaultPath,
          canonicalRelativePath,
          true,
        );
        if (existsSync(canonicalPath)) {
          const canonicalMetadata = lstatSync(canonicalPath);
          if (canonicalMetadata.isSymbolicLink() || !canonicalMetadata.isFile()) {
            throw new Error("Canonical attachment destination is not a regular file");
          }
          const canonicalHash = createHash("sha256").update(readFileSync(canonicalPath)).digest("hex");
          if (canonicalHash !== contentHash || canonicalMetadata.size !== bytes.length) {
            throw new Error("Canonical attachment destination failed its integrity check");
          }
        } else {
          this.#paths.atomicWriteBytes(connection.vaultPath, canonicalRelativePath, bytes);
        }
        const storageUri = attachmentStorageUri(connection.id, contentHash);
        this.#database.prepare(`
          INSERT INTO artifacts (
            id, mission_id, journey, artifact_type, storage_uri, content_hash,
            byte_size, media_type, sensitivity, metadata_json, created_at
          ) VALUES (?, ?, ?, 'obsidian_attachment', ?, ?, ?, ?, ?, ?, ?)
        `).run(
          artifactId,
          missionId,
          mission.journey,
          storageUri,
          contentHash,
          bytes.length,
          mediaType,
          note.sensitivity,
          JSON.stringify({ extension, source: "obsidian_vault" }),
          now,
        );
        return {
          artifactId,
          missionId,
          contentHash,
          byteSize: bytes.length,
          mediaType,
          extension,
          storageUri,
          relativePath: `Attachments/${contentHash}${extension}`,
        } satisfies CanonicalVaultAttachment;
      });

      sources.set(artifact.artifactId, {
        sourceType: "artifact",
        sourceId: artifact.artifactId,
        sourceHash: artifact.contentHash,
        acquiredAt: now,
      });
    }
    return [...sources.values()];
  }

  #importEdges(source: MemoryNode, note: VaultNote, provenance: MemoryProvenance, actor: string): void {
    const existing = this.#memory.listEdges(source.id);
    for (const noteEdge of note.edges) {
      const target = this.#memory.getNode(noteEdge.targetNodeId);
      if (!target) continue;
      if (existing.some((edge) =>
        edge.sourceNodeId === source.id && edge.targetNodeId === target.id && edge.edgeType === noteEdge.edgeType
      )) continue;
      const scope = source.scope.kind === "global" ? target.scope : source.scope;
      const input: CreateMemoryEdgeInput = {
        sourceNodeId: source.id,
        targetNodeId: target.id,
        edgeType: noteEdge.edgeType,
        title: `${source.title} ${noteEdge.edgeType} ${target.title}`,
        summary: "Relationship imported from an operator-edited Obsidian note",
        scope,
        sensitivity: source.sensitivity,
        confidence: Math.min(source.confidence, target.confidence),
        lifecycleStatus: "confirmed",
        provenance,
        explanation: "Operator preserved this relationship as a native Obsidian wikilink",
        authorType: "import",
        authorId: actor,
      };
      this.#memory.createEdge(input);
    }
  }

  #quarantine(
    connection: VaultConnection,
    relativePath: string,
    errorMessage: string,
    redactOriginalPath = false,
  ): string {
    const source = this.#paths.resolveRelative(connection.vaultPath, relativePath);
    // Use a content-free filename. The original filename may itself contain a
    // credential value and must not be copied into diagnostics or projections.
    const quarantineRelative = `.chillspwn/quarantine/${Date.now()}-note-${hashText(relativePath).slice(0, 16)}-${randomUUID()}.md`;
    const destination = this.#paths.resolveRelative(connection.vaultPath, quarantineRelative, true);
    renameSync(source, destination);
    const now = this.#now();
    const state = this.#database.prepare(`
      SELECT id FROM vault_sync_state WHERE connection_id = ? AND relative_path = ?
    `).get(connection.id, relativePath) as { id: string } | undefined;
    if (state) {
      this.#database.prepare(`
        UPDATE vault_sync_state SET status = 'quarantined', error_message = ?, last_scanned_at = ? WHERE id = ?
      `).run(errorMessage.slice(0, 1_000), now, state.id);
    } else {
      this.#database.prepare(`
        INSERT INTO vault_sync_state (
          id, connection_id, relative_path, status, last_scanned_at, error_message
        ) VALUES (?, ?, ?, 'quarantined', ?, ?)
      `).run(
        this.#createId("vsync"),
        connection.id,
        redactOriginalPath ? quarantineRelative : relativePath,
        now,
        errorMessage.slice(0, 1_000),
      );
    }
    return quarantineRelative;
  }

  #assertVaultNoteSafe(note: VaultNote): void {
    if (note.attachments.length > MAX_ATTACHMENTS_PER_NOTE) {
      throw new Error("Vault note exceeds the attachment count limit");
    }
    for (const attachment of note.attachments) attachmentExtension(attachment.relativePath);
    assertReusableMemoryText([
      { field: "vaultNote.title", value: note.title, maximumBytes: REUSABLE_MEMORY_LIMITS.title },
      { field: "vaultNote.summary", value: note.summary, maximumBytes: REUSABLE_MEMORY_LIMITS.summary },
      { field: "vaultNote.body", value: note.body, maximumBytes: REUSABLE_MEMORY_LIMITS.body },
      ...note.sourceIds.map((sourceId, index) => ({
        field: `vaultNote.sourceIds[${index}]`,
        value: sourceId,
        maximumBytes: REUSABLE_MEMORY_LIMITS.provenanceIdentifier,
      })),
      ...note.aliases.map((alias, index) => ({
        field: `vaultNote.aliases[${index}]`,
        value: alias,
        maximumBytes: REUSABLE_MEMORY_LIMITS.provenanceIdentifier,
      })),
      ...note.tags.map((tag, index) => ({
        field: `vaultNote.tags[${index}]`,
        value: tag,
        maximumBytes: REUSABLE_MEMORY_LIMITS.provenanceIdentifier,
      })),
      ...note.attachments.flatMap((attachment, index) => [
        {
          field: `vaultNote.attachments[${index}].relativePath`,
          value: attachment.relativePath,
          maximumBytes: 1_000,
        },
        {
          field: `vaultNote.attachments[${index}].artifactId`,
          value: attachment.artifactId,
          maximumBytes: REUSABLE_MEMORY_LIMITS.provenanceIdentifier,
        },
        {
          field: `vaultNote.attachments[${index}].contentHash`,
          value: attachment.contentHash,
          maximumBytes: 64,
        },
      ]),
    ]);
  }

  #assertVaultSourceSafe(source: string): void {
    assertReusableMemoryText([{
      field: "vaultNote.source",
      value: source,
      maximumBytes: REUSABLE_MEMORY_LIMITS.vaultNote,
    }]);
    try {
      this.#assertVaultNoteSafe(parseObsidianNote(source));
    } catch (error) {
      // Syntax errors are handled by the existing malformed-note quarantine.
      // Safety errors propagate so valid oversized fields cannot enter a conflict.
      if (error instanceof ReusableMemorySafetyError) throw error;
    }
  }

  #quarantineUnsafeVaultSource(
    connection: VaultConnection,
    node: MemoryNode,
    relativePath: string,
    source: string,
  ): VaultSyncResult | undefined {
    try {
      this.#assertVaultSourceSafe(source);
      return undefined;
    } catch (error) {
      if (!(error instanceof ReusableMemorySafetyError)) throw error;
      this.#quarantine(connection, relativePath, "Vault note rejected by reusable-memory safety policy", true);
      return {
        connectionId: connection.id,
        nodeId: node.id,
        relativePath,
        status: "quarantined",
        message: "Vault note was quarantined because reusable memory cannot retain authentication material or oversized payloads",
      };
    }
  }

  #createConflict(
    connection: VaultConnection,
    state: SyncStateRow | undefined,
    node: MemoryNode,
    relativePath: string,
    databaseText: string,
    vaultText: string,
  ): VaultSyncResult {
    this.#assertVaultSourceSafe(databaseText);
    this.#assertVaultSourceSafe(vaultText);
    const now = this.#now();
    const syncStateId = state?.id ?? this.#createId("vsync");
    const databaseHash = hashText(databaseText);
    const vaultHash = hashText(vaultText);
    return inImmediateTransaction(this.#database, () => {
      if (state) {
        this.#updateState(state.id, "conflict", node.version, databaseHash, vaultHash, "Concurrent database and vault edits", false);
      } else {
        this.#database.prepare(`
          INSERT INTO vault_sync_state (
            id, connection_id, node_id, relative_path, database_version,
            vault_content_hash, database_content_hash, status, last_scanned_at, error_message
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'conflict', ?, ?)
        `).run(
          syncStateId, connection.id, node.id, relativePath, node.version,
          vaultHash, databaseHash, now, "Existing unmanaged note conflicts with canonical memory",
        );
      }
      const existing = this.#database.prepare(`
        SELECT id FROM vault_conflicts WHERE sync_state_id = ? AND status = 'open'
      `).get(syncStateId) as { id: string } | undefined;
      const conflictId = existing?.id ?? this.#createId("vconf");
      if (!existing) {
        this.#database.prepare(`
          INSERT INTO vault_conflicts (
            id, connection_id, sync_state_id, node_id, base_hash, database_hash,
            vault_hash, database_version_json, vault_version_text, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
        `).run(
          conflictId, connection.id, syncStateId, node.id,
          state?.database_content_hash ?? null, databaseHash, vaultHash,
          JSON.stringify({ node, markdown: databaseText }), vaultText, now,
        );
      }
      return {
        connectionId: connection.id,
        nodeId: node.id,
        relativePath,
        status: "conflict",
        conflictId,
        message: "Database and vault changes conflict; operator resolution is required",
      };
    });
  }

  resolveConflict(
    conflictId: string,
    resolution: "database" | "vault" | "merged",
    actor: string,
    mergedText?: string,
  ): VaultSyncResult {
    this.assertVaultSyncAllowed();
    const row = this.#database.prepare(`
      SELECT vc.*, vs.relative_path FROM vault_conflicts vc
      JOIN vault_sync_state vs ON vs.id = vc.sync_state_id
      WHERE vc.id = ? AND vc.status = 'open'
    `).get(conflictId) as Record<string, unknown> | undefined;
    if (!row) throw new Error("Open vault conflict not found");
    const connectionId = String(row.connection_id);
    const nodeId = String(row.node_id);
    this.#assertProjectionAllowed(this.#memory.requireNode(nodeId));
    const connection = this.requireConnection(connectionId);
    const relativePath = String(row.relative_path);
    let result: VaultSyncResult;
    if (resolution === "database") {
      const rendered = this.renderNode(nodeId);
      this.#projectAttachments(connection, rendered.attachments);
      this.#paths.atomicWrite(connection.vaultPath, relativePath, rendered.text);
      const hash = hashText(rendered.text);
      this.#upsertSyncedState(connectionId, rendered.node, relativePath, hash);
      result = {
        connectionId,
        nodeId,
        relativePath,
        status: "synced",
        message: "Conflict resolved using the canonical database version",
      };
    } else {
      const selectedText = resolution === "merged" ? mergedText : String(row.vault_version_text);
      if (!selectedText) throw new Error("Merged conflict resolution requires note content");
      this.#assertVaultSourceSafe(selectedText);
      // Validate before replacing the current note. Import is version-aware and
      // creates a new immutable memory version attributed to the resolver.
      const note = parseObsidianNote(selectedText);
      this.#assertVaultNoteSafe(note);
      const current = this.#memory.requireNode(nodeId);
      if (note.id !== current.id || note.nodeType !== current.nodeType || JSON.stringify(note.scope) !== JSON.stringify(current.scope)) {
        throw new Error("Conflict resolution cannot change stable identity, node type, or memory scope");
      }
      const attachmentSources = this.#importAttachments(connection, note);
      const existingSourceKeys = new Set(
        current.provenance.sources.map((item) => `${item.sourceType}\0${item.sourceId}`),
      );
      const updated = this.#memory.correctNode(current.id, {
        title: note.title,
        summary: note.summary,
        body: note.body,
        sensitivity: note.sensitivity,
        confidence: note.confidence,
        expiresAt: note.expiresAt ?? null,
        additionalProvenanceSources: attachmentSources.filter(
          (item) => !existingSourceKeys.has(`${item.sourceType}\0${item.sourceId}`),
        ),
        authorType: "import",
        authorId: actor,
        changeReason: `Operator resolved Obsidian conflict using the ${resolution} content`,
      });
      this.#importEdges(updated, note, {
        method: "imported",
        explanation: "Imported through explicit Obsidian conflict resolution",
        sources: [{
          sourceType: "obsidian_conflict",
          sourceId: conflictId,
          sourceHash: hashText(selectedText),
          acquiredAt: this.#now(),
        }],
      }, actor);
      const normalized = this.renderNode(nodeId);
      const hash = hashText(normalized.text);
      this.#projectAttachments(connection, normalized.attachments);
      this.#paths.atomicWrite(connection.vaultPath, relativePath, normalized.text);
      this.#upsertSyncedState(connectionId, normalized.node, relativePath, hash);
      result = {
        connectionId,
        nodeId,
        relativePath,
        status: "synced",
        message: `Conflict resolved using ${resolution} content and recorded as a memory version`,
      };
    }
    this.#database.prepare(`
      UPDATE vault_conflicts SET status = ?, resolution_reason = ?, resolved_by = ?, resolved_at = ?
      WHERE id = ?
    `).run(
      resolution === "database" ? "resolved_database" : resolution === "vault" ? "resolved_vault" : "resolved_merged",
      `Operator selected ${resolution} version`, actor, this.#now(), conflictId,
    );
    this.#touchConnection(connectionId);
    return result;
  }

  /** Stages synchronized files, erases canonical memory, then removes stages. */
  forgetMemory(nodeId: string, actor: string, reason?: string): ForgetResult {
    const projections = this.#database.prepare(`
      SELECT vs.connection_id, vs.relative_path, vc.vault_path
      FROM vault_sync_state vs JOIN vault_connections vc ON vc.id = vs.connection_id
      WHERE vs.node_id = ?
    `).all(nodeId) as Array<{ connection_id: string; relative_path: string; vault_path: string }>;
    const staged: Array<{ original: string; staged: string }> = [];
    try {
      for (const projection of projections) {
        const connection = this.requireConnection(projection.connection_id);
        const original = this.#paths.resolveRelative(connection.vaultPath, projection.relative_path);
        if (!existsSync(original)) continue;
        const stagedRelative = `.chillspwn/forget-staging/${safeVaultSegment(nodeId, "node")}-${randomUUID()}.md`;
        const stagedPath = this.#paths.resolveRelative(connection.vaultPath, stagedRelative, true);
        renameSync(original, stagedPath);
        staged.push({ original, staged: stagedPath });
      }
      const result = this.#memory.forgetNode(nodeId, actor, reason);
      for (const item of staged) rmSync(item.staged, { force: true });
      return result;
    } catch (error) {
      for (const item of [...staged].reverse()) {
        if (existsSync(item.staged)) {
          mkdirSync(dirname(item.original), { recursive: true, mode: 0o700 });
          renameSync(item.staged, item.original);
        }
      }
      throw error;
    }
  }

  #stateForNode(connectionId: string, nodeId: string): SyncStateRow | undefined {
    return this.#database.prepare(`
      SELECT * FROM vault_sync_state WHERE connection_id = ? AND node_id = ?
    `).get(connectionId, nodeId) as SyncStateRow | undefined;
  }

  #stateForPath(connectionId: string, relativePath: string): SyncStateRow | undefined {
    return this.#database.prepare(`
      SELECT * FROM vault_sync_state WHERE connection_id = ? AND relative_path = ?
    `).get(connectionId, relativePath) as SyncStateRow | undefined;
  }

  #upsertPendingImportState(connectionId: string, relativePath: string, vaultHash: string): void {
    const existing = this.#stateForPath(connectionId, relativePath);
    const now = this.#now();
    if (existing) {
      this.#database.prepare(`
        UPDATE vault_sync_state SET node_id = NULL, status = 'pending', vault_content_hash = ?,
          database_content_hash = NULL, database_version = NULL, error_message = NULL,
          last_scanned_at = ? WHERE id = ?
      `).run(vaultHash, now, existing.id);
      return;
    }
    this.#database.prepare(`
      INSERT INTO vault_sync_state (
        id, connection_id, relative_path, vault_content_hash, status, last_scanned_at
      ) VALUES (?, ?, ?, ?, 'pending', ?)
    `).run(this.#createId("vsync"), connectionId, relativePath, vaultHash, now);
  }

  #upsertSyncedState(connectionId: string, node: MemoryNode, relativePath: string, hash: string): void {
    const now = this.#now();
    const existing = this.#stateForNode(connectionId, node.id);
    if (existing) {
      this.#updateState(existing.id, "synced", node.version, hash, hash, undefined, true);
      return;
    }
    this.#database.prepare(`
      INSERT INTO vault_sync_state (
        id, connection_id, node_id, relative_path, database_version,
        vault_content_hash, database_content_hash, status, last_scanned_at, last_synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?)
    `).run(this.#createId("vsync"), connectionId, node.id, relativePath, node.version, hash, hash, now, now);
  }

  #updateState(
    id: string,
    status: string,
    databaseVersion: number,
    databaseHash: string,
    vaultHash: string | undefined,
    error: string | undefined,
    synced: boolean,
  ): void {
    const now = this.#now();
    this.#database.prepare(`
      UPDATE vault_sync_state SET status = ?, database_version = ?, database_content_hash = ?,
        vault_content_hash = ?, error_message = ?, last_scanned_at = ?,
        last_synced_at = CASE WHEN ? = 1 THEN ? ELSE last_synced_at END WHERE id = ?
    `).run(status, databaseVersion, databaseHash, vaultHash ?? null, error ?? null, now, synced ? 1 : 0, now, id);
  }

  #touchConnection(connectionId: string): void {
    const now = this.#now();
    this.#database.prepare(`
      UPDATE vault_connections SET last_sync_at = ?, updated_at = ?, status = 'connected' WHERE id = ?
    `).run(now, now, connectionId);
  }
}
