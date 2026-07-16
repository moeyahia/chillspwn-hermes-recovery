import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  type FSWatcher,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDatabaseConnection, migrateDatabase } from "../../db/index";
import {
  MemoryRepository,
  type MemoryProvenance,
  updateMemoryControlPolicy,
} from "../../memory/index";
import {
  ObsidianVaultBridge,
  ObsidianVaultWatcher,
  parseObsidianNote,
  VaultPathPolicy,
} from "../index";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "obsidian-bridge-test-"));
  temporaryDirectories.push(directory);
  const db = createDatabaseConnection({ filename: join(directory, "brain.sqlite") });
  migrateDatabase(db);
  const memory = new MemoryRepository(db);
  const policy = new VaultPathPolicy(join(directory, "allowed-vaults"));
  const bridge = new ObsidianVaultBridge(db, memory, policy);
  const connection = bridge.connect({
    id: "vault-test",
    vaultPath: "ChillsPwn-Brain",
    displayName: "Test Brain",
    permissionGranted: true,
  });
  return { directory, db, memory, policy, bridge, connection };
}

function provenance(id: string): MemoryProvenance {
  return {
    method: "operator_statement",
    explanation: "Confirmed by the operator",
    sources: [{ sourceType: "message", sourceId: id, acquiredAt: "2026-07-15T10:00:00.000Z" }],
  };
}

function addNode(memory: MemoryRepository, id: string, title: string) {
  return memory.createNode({
    id,
    nodeType: "technique",
    title,
    summary: `Summary for ${title}`,
    body: `Operational note for ${title}.`,
    scope: { kind: "global" },
    sensitivity: "private",
    confidence: 0.95,
    lifecycleStatus: "confirmed",
    confirmationState: "confirmed",
    provenance: provenance(`source-${id}`),
    authorType: "operator",
    authorId: "operator-1",
  });
}

function addMission(database: ReturnType<typeof createDatabaseConnection>, id = "mission-vault-attachments") {
  const now = "2026-07-15T10:00:00.000Z";
  database.prepare(`
    INSERT INTO missions (
      id, name, objective, journey, status, authorization_status, engagement_id,
      scope_json, success_criteria_json, retention_policy_json, memory_policy_json,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, 'guided', 'active', 'verified', ?, '{}', '[]', '{}', '{}', ?, ?, ?)
  `).run(id, "Attachment test mission", "Verify Obsidian attachment integrity", "engagement-vault", "operator-1", now, now);
  return id;
}

function addMissionNode(
  memory: MemoryRepository,
  id: string,
  title: string,
  missionId: string,
) {
  return memory.createNode({
    id,
    nodeType: "procedure",
    title,
    summary: `Summary for ${title}`,
    body: `Operational note for ${title}.`,
    scope: { kind: "mission", engagementId: "engagement-vault", missionId },
    sensitivity: "private",
    confidence: 0.95,
    lifecycleStatus: "confirmed",
    confirmationState: "confirmed",
    provenance: provenance(`source-${id}`),
    authorType: "operator",
    authorId: "operator-1",
  });
}

describe("Obsidian vault bridge", () => {
  test("round-trips YAML, stable IDs, authorship, and native wikilinks", () => {
    const { db, memory, bridge, connection } = setup();
    try {
      addNode(memory, "node-origin", "Origin Technique");
      addNode(memory, "node-target", "Target Evidence Pattern");
      memory.createEdge({
        sourceNodeId: "node-origin",
        targetNodeId: "node-target",
        edgeType: "depends_on",
        title: "Origin depends on target",
        summary: "The technique requires the evidence pattern",
        scope: { kind: "global" },
        sensitivity: "private",
        confidence: 0.9,
        lifecycleStatus: "confirmed",
        provenance: provenance("edge-source"),
        explanation: "This prerequisite was confirmed during review",
        authorType: "operator",
      });
      const exported = bridge.exportNode(connection.id, "node-origin");
      expect(exported.status).toBe("synced");
      const path = join(connection.vaultPath, exported.relativePath);
      const text = readFileSync(path, "utf8");
      expect(text).not.toContain("[[40 Tools");
      expect(text).toContain("[[30 Attack Patterns/");
      expect(text).toContain("chillspwn-edge:depends_on:node-target");
      const parsed = parseObsidianNote(text);
      expect(parsed.id).toBe("node-origin");
      expect(parsed.authorType).toBe("operator");
      expect(parsed.aliases).toContain("node-origin");
      expect(parsed.edges[0]).toMatchObject({ edgeType: "depends_on", targetNodeId: "node-target" });

      const edited = text.replace(
        "Operational note for Origin Technique.",
        "Operator refined this operational procedure in Obsidian.",
      );
      writeFileSync(path, edited, "utf8");
      const synced = bridge.syncNode(connection.id, "node-origin", "operator-1");
      expect(synced.status).toBe("synced");
      const node = memory.requireNode("node-origin");
      expect(node.body).toContain("refined this operational procedure");
      expect(node.version).toBe(2);
      expect(memory.listVersions(node.id)).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  test("rejects path traversal and vaults outside the configured sandbox", () => {
    const { db, directory, policy, connection } = setup();
    try {
      expect(() => policy.resolveVault("../../outside")).toThrow("escapes");
      expect(() => policy.resolveRelative(connection.vaultPath, "../../auth.json")).toThrow("traversal");
      expect(() => policy.resolveRelative(connection.vaultPath, "/root/.ssh/id_ed25519")).toThrow("relative");
      expect(existsSync(join(directory, "outside"))).toBe(false);
    } finally {
      db.close();
    }
  });

  test("detects concurrent database/vault edits and requires explicit resolution", () => {
    const { db, memory, bridge, connection } = setup();
    try {
      addNode(memory, "node-conflict", "Conflict Technique");
      const exported = bridge.exportNode(connection.id, "node-conflict");
      const path = join(connection.vaultPath, exported.relativePath);
      const vaultText = readFileSync(path, "utf8").replace(
        "Operational note for Conflict Technique.",
        "Vault-side operator edit.",
      );
      writeFileSync(path, vaultText, "utf8");
      memory.correctNode("node-conflict", {
        body: "Database-side agent edit.",
        authorType: "agent",
        authorId: "agent-1",
        changeReason: "New mission evidence",
      });
      const result = bridge.syncNode(connection.id, "node-conflict", "operator-1");
      expect(result.status).toBe("conflict");
      expect(result.conflictId).toBeDefined();
      const conflict = db.prepare("SELECT status FROM vault_conflicts WHERE id = ?").get(result.conflictId) as { status: string };
      expect(conflict.status).toBe("open");
      const resolved = bridge.resolveConflict(result.conflictId!, "database", "operator-1");
      expect(resolved.status).toBe("synced");
      expect(readFileSync(path, "utf8")).toContain("Database-side agent edit");
    } finally {
      db.close();
    }
  });

  test("quarantines malformed notes and removes synchronized projections on forgetting", () => {
    const { db, memory, bridge, connection } = setup();
    try {
      const inbox = join(connection.vaultPath, "00 Inbox", "malformed.md");
      writeFileSync(inbox, "# no frontmatter", "utf8");
      const imported = bridge.importNote(connection.id, "00 Inbox/malformed.md", "operator-1");
      expect(imported.status).toBe("quarantined");
      expect(existsSync(inbox)).toBe(false);
      expect(existsSync(join(connection.vaultPath, imported.quarantinePath!))).toBe(true);

      addNode(memory, "node-forget-vault", "Forget Vault Technique");
      const exported = bridge.exportNode(connection.id, "node-forget-vault");
      const path = join(connection.vaultPath, exported.relativePath);
      expect(existsSync(path)).toBe(true);
      const result = bridge.forgetMemory("node-forget-vault", "operator-1");
      expect(result.vaultProjections).toHaveLength(1);
      expect(existsSync(path)).toBe(false);
      expect(memory.requireNode("node-forget-vault", true).lifecycleStatus).toBe("forgotten");
    } finally {
      db.close();
    }
  });

  test("quarantines authentication material before candidate, correction, or conflict persistence", () => {
    const { db, memory, bridge, connection } = setup();
    try {
      addNode(memory, "node-vault-safety", "Vault Safety Technique");
      const exported = bridge.exportNode(connection.id, "node-vault-safety");
      const projectionPath = join(connection.vaultPath, exported.relativePath);
      const safeProjection = readFileSync(projectionPath, "utf8");
      const sessionMaterial = ["session_token", ": ", "unit-test-session-material-123456789"].join("");

      const inboxRelative = "00 Inbox/unsafe-authentication-note.md";
      const inboxPath = join(connection.vaultPath, inboxRelative);
      writeFileSync(
        inboxPath,
        safeProjection
          .replace('id: "node-vault-safety"', 'id: "candidate-vault-safety"')
          .replace("Operational note for Vault Safety Technique.", sessionMaterial),
        "utf8",
      );
      const imported = bridge.importNote(connection.id, inboxRelative, "operator-1");
      expect(imported.status).toBe("quarantined");
      expect(existsSync(inboxPath)).toBe(false);
      expect((db.prepare("SELECT COUNT(*) AS count FROM memory_candidates").get() as { count: number }).count).toBe(0);
      const importState = db.prepare(
        "SELECT relative_path, status, error_message FROM vault_sync_state WHERE connection_id = ? AND status = 'quarantined' ORDER BY rowid DESC LIMIT 1",
      ).get(connection.id) as { relative_path: string; status: string; error_message: string };
      expect(importState.status).toBe("quarantined");
      expect(importState.relative_path).toBe(imported.quarantinePath);
      expect(importState.relative_path).not.toContain("unsafe-authentication-note");
      expect(importState.error_message).toBe("Vault note rejected by reusable-memory safety policy");
      expect(importState.error_message).not.toContain(sessionMaterial);

      const privateKeyMaterial = [
        ["-----BEGIN OPENSSH ", "PRIVATE KEY-----"].join(""),
        "unit-test-authentication-material",
        ["-----END OPENSSH ", "PRIVATE KEY-----"].join(""),
      ].join("\n");
      writeFileSync(
        projectionPath,
        safeProjection.replace("Operational note for Vault Safety Technique.", privateKeyMaterial),
        "utf8",
      );
      const synchronized = bridge.syncNode(connection.id, "node-vault-safety", "operator-1");
      expect(synchronized.status).toBe("quarantined");
      expect(existsSync(projectionPath)).toBe(false);
      expect(memory.requireNode("node-vault-safety")).toMatchObject({ version: 1, body: "Operational note for Vault Safety Technique." });
      expect(memory.listVersions("node-vault-safety")).toHaveLength(1);
      expect((db.prepare("SELECT COUNT(*) AS count FROM vault_conflicts").get() as { count: number }).count).toBe(0);
      expect(JSON.stringify(db.prepare("SELECT title, summary, body FROM memory_nodes").all()))
        .not.toContain("unit-test-authentication-material");
    } finally {
      db.close();
    }
  });

  test("creates a private portable ZIP and a path-safe Obsidian deep link", async () => {
    const { db, memory, bridge, connection } = setup();
    try {
      addNode(memory, "node-portable", "Portable Technique");
      const exported = bridge.exportNode(connection.id, "node-portable");
      const link = bridge.deepLink(connection.id, exported.relativePath);
      expect(link).toStartWith("obsidian://open?");
      expect(link).toContain("vault=ChillsPwn-Brain");
      expect(link).not.toContain(connection.vaultPath);

      const archive = await bridge.createPortableExport(connection.id, ["node-portable"], "operator-1");
      const bytes = readFileSync(archive.archivePath);
      expect(bytes.subarray(0, 4).toString("hex")).toBe("504b0304");
      expect(bytes.includes(Buffer.from(exported.relativePath, "utf8"))).toBe(true);
      expect(bytes.includes(Buffer.from("chillspwn-vault-manifest.json", "utf8"))).toBe(true);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(archive.sha256);
      expect(statSync(archive.archivePath).mode & 0o777).toBe(0o600);
    } finally {
      db.close();
    }
  });

  test("hashes, deduplicates, projects, and portably exports real attachment bytes", async () => {
    const { db, memory, bridge, connection } = setup();
    try {
      const missionId = addMission(db);
      const seed = addMissionNode(memory, "node-attachment-seed", "Attachment Seed", missionId);
      const attachmentBytes = Buffer.from([
        0x43, 0x68, 0x69, 0x6c, 0x6c, 0x73, 0x50, 0x77, 0x6e, 0x00, 0xff, 0x10, 0x20,
      ]);
      const contentHash = createHash("sha256").update(attachmentBytes).digest("hex");
      const firstAttachmentPath = join(connection.vaultPath, "Attachments", "operator-capture.png");
      writeFileSync(firstAttachmentPath, attachmentBytes);

      const template = bridge.renderNode(seed.id).text;
      const firstRelative = "00 Inbox/attachment-import.md";
      writeFileSync(
        join(connection.vaultPath, firstRelative),
        `${template
          .replace('id: "node-attachment-seed"', 'id: "attachment-import"')
          .replace("# Attachment Seed", "# Imported Attachment")
          .replace("Operational note for Attachment Seed.", "Operator supplied a protected mission artifact.")
        }\n![[Attachments/operator-capture.png]]\n`,
        "utf8",
      );

      const imported = bridge.importNote(connection.id, firstRelative, "operator-1");
      expect(imported.status).toBe("candidate");
      const artifact = db.prepare(`
        SELECT id, storage_uri, content_hash, byte_size, media_type, metadata_json
        FROM artifacts WHERE artifact_type = 'obsidian_attachment'
      `).get() as {
        id: string;
        storage_uri: string;
        content_hash: string;
        byte_size: number;
        media_type: string;
        metadata_json: string;
      };
      expect(artifact.content_hash).toBe(contentHash);
      expect(artifact.byte_size).toBe(attachmentBytes.length);
      expect(artifact.media_type).toBe("image/png");
      expect(artifact.storage_uri).not.toContain("operator-capture");
      expect(artifact.metadata_json).not.toContain("operator-capture");
      expect(readFileSync(join(connection.vaultPath, ".chillspwn", "attachments", contentHash)))
        .toEqual(attachmentBytes);

      const candidate = memory.requireCandidate(imported.candidateId!);
      expect(candidate.body).not.toContain("operator-capture");
      const confirmed = memory.confirmCandidate(candidate.id, "operator-1");
      expect(db.prepare(`
        SELECT source_id FROM memory_sources WHERE node_id = ? AND source_type = 'artifact'
      `).get(confirmed.id)).toEqual({ source_id: artifact.id });

      const exported = bridge.exportNode(connection.id, confirmed.id);
      const projectedNote = readFileSync(join(connection.vaultPath, exported.relativePath), "utf8");
      expect(projectedNote).toContain(`![[Attachments/${contentHash}.png]]`);
      expect(projectedNote).toContain(`chillspwn-attachment:${artifact.id}:${contentHash}`);
      expect(projectedNote).not.toContain("operator-capture");
      expect(readFileSync(join(connection.vaultPath, "Attachments", `${contentHash}.png`)))
        .toEqual(attachmentBytes);

      const duplicateAttachmentPath = join(connection.vaultPath, "Attachments", "duplicate-name.png");
      writeFileSync(duplicateAttachmentPath, attachmentBytes);
      const duplicateRelative = "00 Inbox/attachment-duplicate.md";
      writeFileSync(
        join(connection.vaultPath, duplicateRelative),
        `${template
          .replace('id: "node-attachment-seed"', 'id: "attachment-duplicate"')
          .replace("# Attachment Seed", "# Duplicate Attachment")
        }\n![duplicate](Attachments/duplicate-name.png)\n`,
        "utf8",
      );
      expect(bridge.importNote(connection.id, duplicateRelative, "operator-1").status).toBe("candidate");
      expect((db.prepare(`
        SELECT COUNT(*) AS count FROM artifacts WHERE artifact_type = 'obsidian_attachment'
      `).get() as { count: number }).count).toBe(1);

      const archive = await bridge.createPortableExport(connection.id, [confirmed.id], "operator-1");
      const archiveBytes = readFileSync(archive.archivePath);
      expect(archive.fileCount).toBe(3);
      expect(archiveBytes.includes(Buffer.from(`Attachments/${contentHash}.png`, "utf8"))).toBe(true);
      expect(archiveBytes.includes(attachmentBytes)).toBe(true);
      expect(archiveBytes.includes(Buffer.from("operator-capture", "utf8"))).toBe(false);
    } finally {
      db.close();
    }
  });

  test("quarantines attachment traversal, symlinks, and mismatched integrity markers", () => {
    const { directory, db, memory, bridge, connection } = setup();
    try {
      const missionId = addMission(db, "mission-vault-attachment-rejection");
      const seed = addMissionNode(memory, "node-attachment-rejection", "Attachment Rejection", missionId);
      const template = bridge.renderNode(seed.id).text;
      const outside = join(directory, "outside.png");
      writeFileSync(outside, Buffer.from("outside attachment"));
      symlinkSync(outside, join(connection.vaultPath, "Attachments", "linked.png"));
      const symlinkRelative = "00 Inbox/symlink-attachment.md";
      writeFileSync(
        join(connection.vaultPath, symlinkRelative),
        `${template.replace('id: "node-attachment-rejection"', 'id: "symlink-attachment"')}\n![[Attachments/linked.png]]\n`,
      );
      const symlinkImport = bridge.importNote(connection.id, symlinkRelative, "operator-1");
      expect(symlinkImport.status).toBe("quarantined");
      expect(existsSync(join(connection.vaultPath, symlinkRelative))).toBe(false);

      const safeBytes = Buffer.from("integrity checked attachment");
      writeFileSync(join(connection.vaultPath, "Attachments", "integrity.png"), safeBytes);
      const integrityRelative = "00 Inbox/integrity-attachment.md";
      writeFileSync(
        join(connection.vaultPath, integrityRelative),
        `${template.replace('id: "node-attachment-rejection"', 'id: "integrity-attachment"')}\n![[Attachments/integrity.png]] <!-- chillspwn-attachment:artifact-does-not-exist:${"0".repeat(64)} -->\n`,
      );
      const integrityImport = bridge.importNote(connection.id, integrityRelative, "operator-1");
      expect(integrityImport.status).toBe("quarantined");
      expect((db.prepare(`
        SELECT COUNT(*) AS count FROM artifacts WHERE artifact_type = 'obsidian_attachment'
      `).get() as { count: number }).count).toBe(0);
    } finally {
      db.close();
    }
  });

  test("versions an attachment-only vault edit once and preserves it through conflict resolution", () => {
    const { db, memory, bridge, connection } = setup();
    try {
      const missionId = addMission(db, "mission-vault-attachment-versioning");
      const node = addMissionNode(memory, "node-attachment-versioning", "Attachment Versioning", missionId);
      const exported = bridge.exportNode(connection.id, node.id);
      const notePath = join(connection.vaultPath, exported.relativePath);
      const attachmentBytes = Buffer.from("versioned attachment bytes");
      const contentHash = createHash("sha256").update(attachmentBytes).digest("hex");
      writeFileSync(join(connection.vaultPath, "Attachments", "versioned.txt"), attachmentBytes);
      writeFileSync(
        notePath,
        `${readFileSync(notePath, "utf8")}\n![[Attachments/versioned.txt]]\n`,
        "utf8",
      );

      const synchronized = bridge.syncNode(connection.id, node.id, "operator-1");
      expect(synchronized.status).toBe("synced");
      expect(memory.requireNode(node.id).version).toBe(2);
      expect(memory.listVersions(node.id)).toHaveLength(2);
      const normalized = readFileSync(notePath, "utf8");
      expect(normalized).toContain(`Attachments/${contentHash}.txt`);
      expect(normalized).not.toContain("versioned.txt");

      writeFileSync(
        notePath,
        normalized.replace(
          "Operational note for Attachment Versioning.",
          "Vault-side concurrent edit.",
        ),
        "utf8",
      );
      memory.correctNode(node.id, {
        body: "Database-side concurrent edit.",
        authorType: "operator",
        authorId: "operator-1",
        changeReason: "Create a deterministic conflict",
      });
      const conflict = bridge.syncNode(connection.id, node.id, "operator-1");
      expect(conflict.status).toBe("conflict");
      const resolved = bridge.resolveConflict(conflict.conflictId!, "database", "operator-1");
      expect(resolved.status).toBe("synced");
      const resolvedText = readFileSync(notePath, "utf8");
      expect(resolvedText).toContain("Database-side concurrent edit.");
      expect(resolvedText).toContain(`Attachments/${contentHash}.txt`);
      expect(readFileSync(join(connection.vaultPath, "Attachments", `${contentHash}.txt`)))
        .toEqual(attachmentBytes);
    } finally {
      db.close();
    }
  });

  test("debounces vault edits and stops watching immediately when operator policy disables sync", async () => {
    const { db, memory, bridge, connection } = setup();
    const fake = new EventEmitter() as EventEmitter & { close: () => void; closed: boolean };
    fake.closed = false;
    fake.close = () => { fake.closed = true; };
    let listener: ((eventType: string, filename: string | Buffer | null) => void) | undefined;
    const watcher = new ObsidianVaultWatcher(db, bridge, {
      debounceMs: 10,
      yieldMs: 0,
      watchFactory: (_root, callback) => {
        listener = callback;
        return fake as unknown as FSWatcher;
      },
    });
    try {
      addNode(memory, "node-watched", "Watched Technique");
      const exported = bridge.exportNode(connection.id, "node-watched");
      const path = join(connection.vaultPath, exported.relativePath);
      writeFileSync(path, readFileSync(path, "utf8").replace(
        "Operational note for Watched Technique.",
        "Operator edited this note through the watched vault.",
      ));
      watcher.start();
      expect(watcher.watchedConnectionCount).toBe(1);
      listener?.("change", exported.relativePath);
      await new Promise((resolve) => setTimeout(resolve, 30));
      await watcher.waitForIdle();
      expect(memory.requireNode("node-watched").body).toContain("watched vault");

      const current = bridge.memoryControlPolicy();
      updateMemoryControlPolicy({
        database: db,
        expectedVersion: current.version,
        actor: "operator-1",
        policy: { ...current, obsidianSyncScope: "disabled" },
      });
      watcher.refreshConnections();
      expect(watcher.watchedConnectionCount).toBe(0);
      expect(fake.closed).toBe(true);
      expect(() => bridge.exportNode(connection.id, "node-watched")).toThrow("not permitted");
    } finally {
      await watcher.stop();
      db.close();
    }
  });
});
