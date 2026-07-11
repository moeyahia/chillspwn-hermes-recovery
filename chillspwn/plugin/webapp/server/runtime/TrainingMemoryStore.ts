/**
 * TrainingMemoryStore (8.2) — persistence for AttackLessons (HTB training memory), as a single
 * JSON array written atomically. Mirrors MemoryStore. Lives under runtime/training/lessons.json.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import type { AttackLesson, LessonStatus, LessonScope, TechniqueCategory } from "./AttackLesson";

export interface LessonQuery {
  status?: LessonStatus;
  scope?: LessonScope;
  techniqueCategory?: TechniqueCategory;
  sourceRunId?: string;
  agentId?: string; // 15.9 — per-specialist namespace filter
  kind?: "attack_lesson" | "failed_attempt"; // 15.10
}

export class TrainingMemoryStore {
  private readonly dir: string;
  private readonly path: string;

  constructor(runtimeDir: string) {
    this.dir = resolve(runtimeDir, "training");
    this.path = join(this.dir, "lessons.json");
  }

  private ensureDir(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  private readAll(): AttackLesson[] {
    if (!existsSync(this.path)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf-8"));
      return Array.isArray(parsed) ? (parsed as AttackLesson[]) : [];
    } catch {
      return [];
    }
  }

  private writeAll(lessons: AttackLesson[]): void {
    this.ensureDir();
    const tmp = this.path + ".tmp";
    writeFileSync(tmp, JSON.stringify(lessons, null, 2));
    renameSync(tmp, this.path);
  }

  list(query: LessonQuery = {}): AttackLesson[] {
    return this.readAll()
      .filter((l) => (query.status ? l.status === query.status : true))
      .filter((l) => (query.scope ? l.scope === query.scope : true))
      .filter((l) => (query.techniqueCategory ? l.techniqueCategory === query.techniqueCategory : true))
      .filter((l) => (query.sourceRunId ? l.sourceRunId === query.sourceRunId : true))
      .filter((l) => (query.agentId ? (l.agentId || "").toLowerCase() === query.agentId.toLowerCase() : true))
      .filter((l) => (query.kind ? (l.kind ?? "attack_lesson") === query.kind : true));
  }

  get(id: string): AttackLesson | null {
    return this.readAll().find((l) => l.id === id) ?? null;
  }

  add(lesson: AttackLesson): AttackLesson {
    const all = this.readAll();
    all.push(lesson);
    this.writeAll(all);
    return lesson;
  }

  update(id: string, patch: Partial<AttackLesson>): AttackLesson | null {
    const all = this.readAll();
    const i = all.findIndex((l) => l.id === id);
    if (i === -1) return null;
    all[i] = { ...all[i], ...patch, id: all[i].id };
    this.writeAll(all);
    return all[i];
  }
}
