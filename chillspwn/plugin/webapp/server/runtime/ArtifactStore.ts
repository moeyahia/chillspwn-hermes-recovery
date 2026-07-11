/**
 * ArtifactStore (Phase 12) — side-file storage for large tool outputs / attachments, so run JSON
 * stays small. Artifacts are stored by a generated id (NEVER a user-controlled path), with a
 * sha256 + size + mime + an index. Retrieval validates the id shape to prevent path traversal.
 */

import { createHash } from "crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { newId, nowIso } from "./types";

export interface ArtifactMeta {
  id: string;
  runId: string;
  stepId?: string;
  toolCallId?: string;
  evidenceId?: string;
  kind: string;
  filename: string;
  mimeType: string;
  size: number;
  sha256: string;
  createdAt: string;
}

/** A safe artifact id: `art_` + uuid-ish. Used to reject path traversal at retrieval. */
export function isSafeArtifactId(id: unknown): id is string {
  return typeof id === "string" && /^art_[A-Za-z0-9-]{4,64}$/.test(id);
}

/** Strip any path components from a display filename. */
export function safeFilename(name: string): string {
  return (name || "artifact").replace(/[\\/]+/g, "_").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "artifact";
}

export class ArtifactStore {
  private readonly dir: string;
  private readonly indexPath: string;

  constructor(runtimeDir: string) {
    this.dir = resolve(runtimeDir, "artifacts");
    this.indexPath = join(this.dir, "index.jsonl");
  }

  private ensureDir(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  write(input: {
    runId: string;
    stepId?: string;
    toolCallId?: string;
    evidenceId?: string;
    kind?: string;
    content: string | Buffer;
    filename?: string;
    mimeType?: string;
  }): ArtifactMeta {
    this.ensureDir();
    const id = newId("art");
    const buf = Buffer.isBuffer(input.content) ? input.content : Buffer.from(String(input.content), "utf-8");
    const sha256 = createHash("sha256").update(buf).digest("hex");
    // Stored by id only — no user-controlled path component ⇒ no traversal possible.
    writeFileSync(join(this.dir, id), buf);
    const meta: ArtifactMeta = {
      id,
      runId: input.runId,
      stepId: input.stepId,
      toolCallId: input.toolCallId,
      evidenceId: input.evidenceId,
      kind: input.kind || "blob",
      filename: safeFilename(input.filename || `${id}.txt`),
      mimeType: input.mimeType || "text/plain; charset=utf-8",
      size: buf.length,
      sha256,
      createdAt: nowIso(),
    };
    appendFileSync(this.indexPath, JSON.stringify(meta) + "\n");
    return meta;
  }

  /** Read an artifact by id. Returns null for a missing or UNSAFE id (path-traversal guard). */
  read(id: string): { meta: ArtifactMeta; content: Buffer } | null {
    if (!isSafeArtifactId(id)) return null;
    const file = join(this.dir, id);
    if (!existsSync(file)) return null;
    const meta = this.meta(id);
    if (!meta) return null;
    return { meta, content: readFileSync(file) };
  }

  meta(id: string): ArtifactMeta | null {
    if (!isSafeArtifactId(id)) return null;
    return this.list().find((m) => m.id === id) ?? null;
  }

  list(runId?: string): ArtifactMeta[] {
    if (!existsSync(this.indexPath)) return [];
    const out: ArtifactMeta[] = [];
    for (const line of readFileSync(this.indexPath, "utf-8").split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const m = JSON.parse(t) as ArtifactMeta;
        if (!runId || m.runId === runId) out.push(m);
      } catch {
        /* skip corrupt line */
      }
    }
    return out;
  }
}
