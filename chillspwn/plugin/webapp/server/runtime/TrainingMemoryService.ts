/**
 * TrainingMemoryService (8.2) — propose / approve / reject / stale / query AttackLessons, and
 * produce the VERIFIED TRAINING LESSONS planning block. Mirrors MemoryService's safety model:
 *   - propose ALWAYS stores `proposed` (never trusted) — the model can't self-verify;
 *   - approve is the ONLY path to `verified`, and it refuses a lesson that is not promotable
 *     (no provenance, or contains a target-specific secret);
 *   - getRelevantVerifiedLessons returns ONLY `verified` lessons (the planning feed).
 */

import { newId, nowIso } from "./types";
import { EventLog } from "./EventLog";
import { TrainingMemoryStore, type LessonQuery } from "./TrainingMemoryStore";
import {
  validateAndNormalizeLesson,
  isPromotable,
  buildTrainingLessonContext,
  buildLayeredPlanningContext,
  LESSON_SCOPES,
  type AttackLesson,
  type LessonScope,
} from "./AttackLesson";

export class TrainingMemoryError extends Error {
  constructor(message: string, public readonly errors?: string[]) {
    super(message);
    this.name = "TrainingMemoryError";
  }
}

export class TrainingMemoryService {
  constructor(private readonly store: TrainingMemoryStore, private readonly events: EventLog) {}

  /** Propose a lesson — ALWAYS stored `proposed` (unverified). Rejects on validation/secret errors. */
  proposeLesson(raw: unknown): AttackLesson {
    const v = validateAndNormalizeLesson(raw);
    if (!v.ok) throw new TrainingMemoryError(`invalid attack lesson: ${v.errors.join("; ")}`, v.errors);
    const lesson: AttackLesson = {
      ...v.lesson!,
      id: newId("lesson"),
      status: "proposed",
      createdAt: nowIso(),
    };
    this.store.add(lesson);
    this.event("training_lesson_proposed", lesson);
    return lesson;
  }

  /** Approve → `verified`. Refuses a non-promotable lesson (no provenance / contains a secret). */
  approveLesson(id: string, opts: { verifiedBy?: string } = {}): AttackLesson {
    const lesson = this.require(id);
    const p = isPromotable(lesson);
    if (!p.ok) throw new TrainingMemoryError(`cannot verify lesson: ${p.reason}`);
    const updated = this.store.update(id, {
      status: "verified", verifiedAt: nowIso(), verifiedBy: opts.verifiedBy ?? "operator",
    })!;
    this.event("training_lesson_verified", updated);
    return updated;
  }

  rejectLesson(id: string, reason?: string): AttackLesson {
    const updated = this.store.update(this.require(id).id, { status: "rejected" })!;
    this.event("training_lesson_rejected", updated, { reason: reason ?? "" });
    return updated;
  }

  staleLesson(id: string): AttackLesson {
    const updated = this.store.update(this.require(id).id, { status: "stale" })!;
    this.event("training_lesson_stale", updated);
    return updated;
  }

  listLessons(query: LessonQuery = {}): AttackLesson[] {
    return this.store.list(query);
  }

  getLesson(id: string): AttackLesson | null {
    return this.store.get(id);
  }

  /** ONLY verified lessons — the planning feed. Never proposed/rejected/stale. */
  getRelevantVerifiedLessons(query: Omit<LessonQuery, "status"> = {}): AttackLesson[] {
    return this.store.list({ ...query, status: "verified" });
  }

  /** The VERIFIED TRAINING LESSONS planning block (verified-only, evidence-referenced, no secrets). */
  buildPlanningContext(query: Omit<LessonQuery, "status"> = {}): string {
    return buildTrainingLessonContext(this.getRelevantVerifiedLessons(query));
  }

  private require(id: string): AttackLesson {
    const l = this.store.get(id);
    if (!l) throw new TrainingMemoryError(`attack lesson not found: ${id}`);
    return l;
  }

  // ── 15.9/15.12 per-agent + scope promotion ──────────────────────────────────────────────

  /** All lessons owned by a specialist (any status/kind). */
  listAgentLessons(agentId: string, query: Omit<LessonQuery, "agentId"> = {}): AttackLesson[] {
    return this.store.list({ ...query, agentId });
  }

  /**
   * 15.11 — the LAYERED planning context for a specialist task: verified GLOBAL → PROJECT/LAB →
   * SPECIALIST(agentId) lessons + a separate FAILED ATTEMPTS section. Verified-only; no hypotheses,
   * no secrets.
   */
  buildSpecialistPlanningContext(agentId: string, opts: { max?: number } = {}): string {
    return buildLayeredPlanningContext(this.store.list({ status: "verified" }), { agentId, max: opts.max });
  }

  /**
   * 15.12 — promote a VERIFIED lesson to a broader scope (agent→mission→lab→project→global). Requires
   * the lesson be promotable (evidenceIds + sourceRunId + corroboration, no secret), the target be
   * strictly broader, and a reason. Returns the updated lesson.
   */
  promoteScope(id: string, targetScope: LessonScope, opts: { reason?: string; resolvedBy?: string } = {}): AttackLesson {
    const lesson = this.require(id);
    if (lesson.status !== "verified") throw new TrainingMemoryError("only a VERIFIED lesson can be scope-promoted");
    const p = isPromotable(lesson);
    if (!p.ok) throw new TrainingMemoryError(`cannot promote: ${p.reason}`);
    if (!opts.reason || !opts.reason.trim()) throw new TrainingMemoryError("promotion requires a reason");
    if (LESSON_SCOPES.indexOf(targetScope) <= LESSON_SCOPES.indexOf(lesson.scope)) {
      throw new TrainingMemoryError(`promote target '${targetScope}' must be broader than current '${lesson.scope}'`);
    }
    const updated = this.store.update(id, { scope: targetScope, verifiedBy: opts.resolvedBy ?? "operator" })!;
    this.event("training_lesson_verified", updated, { promotion: `${lesson.scope}→${targetScope}`, reason: opts.reason });
    return updated;
  }

  /** 15.12 — demote a lesson to a NARROWER scope (reverse of promote; requires a reason). */
  demoteScope(id: string, targetScope: LessonScope, opts: { reason?: string } = {}): AttackLesson {
    const lesson = this.require(id);
    if (!opts.reason || !opts.reason.trim()) throw new TrainingMemoryError("demotion requires a reason");
    if (LESSON_SCOPES.indexOf(targetScope) >= LESSON_SCOPES.indexOf(lesson.scope)) {
      throw new TrainingMemoryError(`demote target '${targetScope}' must be narrower than current '${lesson.scope}'`);
    }
    const updated = this.store.update(id, { scope: targetScope })!;
    this.event("training_lesson_stale", updated, { demotion: `${lesson.scope}→${targetScope}`, reason: opts.reason });
    return updated;
  }

  private event(type: string, lesson: AttackLesson, extra: Record<string, unknown> = {}): void {
    try {
      this.events.append({
        type: type as never,
        agentRunId: lesson.sourceRunId ?? null,
        sessionId: "training-memory",
        data: { lessonId: lesson.id, technique: lesson.techniqueName, category: lesson.techniqueCategory, status: lesson.status, ...extra } as never,
      });
    } catch {
      /* event logging is best-effort */
    }
  }
}
