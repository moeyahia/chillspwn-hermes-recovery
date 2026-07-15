import type {
  MemoryEdgeType,
  MemoryLifecycle,
  MemoryNodeType,
  MemoryScope,
  MemorySensitivity,
} from "../memory/types";

export interface VaultConnection {
  readonly id: string;
  readonly vaultPath: string;
  readonly displayName: string;
  readonly status: "disconnected" | "connecting" | "connected" | "degraded" | "error";
  readonly syncScope: Record<string, unknown>;
  readonly permissionGrantedAt: string;
  readonly lastSyncAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface VaultNoteEdge {
  readonly edgeType: MemoryEdgeType;
  readonly targetNodeId: string;
  readonly targetTitle: string;
  readonly wikilink: string;
}

export interface VaultNoteAttachment {
  readonly relativePath: string;
  readonly artifactId?: string;
  readonly contentHash?: string;
}

export interface VaultNote {
  readonly id: string;
  readonly nodeType: MemoryNodeType;
  readonly lifecycleStatus: MemoryLifecycle;
  readonly scope: MemoryScope;
  readonly sensitivity: MemorySensitivity;
  readonly confidence: number;
  readonly confirmationState: "not_required" | "pending" | "confirmed" | "rejected";
  readonly title: string;
  readonly summary: string;
  readonly body: string;
  readonly authorType: "operator" | "agent" | "system" | "import";
  readonly authorId?: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt?: string;
  readonly sourceIds: readonly string[];
  readonly aliases: readonly string[];
  readonly tags: readonly string[];
  readonly edges: readonly VaultNoteEdge[];
  readonly attachments: readonly VaultNoteAttachment[];
}

export interface VaultSyncResult {
  readonly connectionId: string;
  readonly nodeId: string;
  readonly relativePath: string;
  readonly status: "synced" | "database_ahead" | "vault_ahead" | "conflict" | "quarantined";
  readonly conflictId?: string;
  readonly message: string;
}

export interface VaultImportResult {
  readonly relativePath: string;
  readonly status: "candidate" | "updated" | "unchanged" | "quarantined";
  readonly nodeId?: string;
  readonly candidateId?: string;
  readonly quarantinePath?: string;
}

export interface VaultPortableExport {
  readonly connectionId: string;
  readonly archiveName: string;
  readonly archivePath: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly fileCount: number;
  readonly createdAt: string;
}

export interface VaultSyncVerificationItem {
  readonly relativePath: string;
  readonly nodeId?: string;
  readonly status: "synced" | "database_ahead" | "vault_ahead" | "conflict" | "missing" | "pending" | "quarantined";
}

export interface VaultSyncVerification {
  readonly connectionId: string;
  readonly healthy: boolean;
  readonly checkedAt: string;
  readonly counts: Readonly<Record<VaultSyncVerificationItem["status"], number>>;
  readonly items: readonly VaultSyncVerificationItem[];
}
