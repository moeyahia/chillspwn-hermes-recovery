/**
 * trainingRoutes (8.2) — HTB Training Memory REST: propose / list / approve / reject / stale
 * AttackLessons. Gated by ENABLE_TRAINING_MEMORY. Proposals are always `proposed` (unverified);
 * approval is the only path to `verified` and refuses non-promotable lessons.
 */

import type { Express, Request, Response } from "express";
import { TrainingMemoryService, TrainingMemoryError } from "../runtime/TrainingMemoryService";
import type { LessonStatus, LessonScope, TechniqueCategory } from "../runtime/AttackLesson";

export interface TrainingRouteDeps {
  trainingMemory: TrainingMemoryService;
  guardSeg: (res: Response, val: string, name: string) => boolean;
  enabled: () => boolean;
}

export function registerTrainingRoutes(app: Express, deps: TrainingRouteDeps): void {
  const { trainingMemory, guardSeg, enabled } = deps;

  const route = (res: Response, fn: () => unknown) => {
    try {
      res.json({ ok: true, ...(fn() as object) });
    } catch (e) {
      const err = e as TrainingMemoryError;
      const status = err.name === "TrainingMemoryError" ? 400 : 500;
      res.status(status).json({ error: err.message || "training memory error", details: err.errors });
    }
  };
  const gate = (res: Response): boolean => {
    if (!enabled()) { res.status(403).json({ error: "training memory is disabled (ENABLE_TRAINING_MEMORY=false)" }); return false; }
    return true;
  };

  app.post("/api/training-memory/lessons/propose", (req: Request, res: Response) => {
    if (!gate(res)) return;
    route(res, () => ({ lesson: trainingMemory.proposeLesson(req.body) })); // always 'proposed'
  });

  app.get("/api/training-memory/lessons", (req: Request, res: Response) => {
    if (!gate(res)) return;
    const q = {
      status: req.query.status as LessonStatus | undefined,
      scope: req.query.scope as LessonScope | undefined,
      techniqueCategory: req.query.category as TechniqueCategory | undefined,
    };
    res.json({ lessons: trainingMemory.listLessons(q) });
  });

  app.get("/api/training-memory/lessons/:id", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "lessonId")) return;
    if (!gate(res)) return;
    const lesson = trainingMemory.getLesson(req.params.id);
    if (!lesson) return res.status(404).json({ error: "lesson not found" });
    res.json({ lesson });
  });

  app.post("/api/training-memory/lessons/:id/approve", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "lessonId")) return;
    if (!gate(res)) return;
    route(res, () => ({ lesson: trainingMemory.approveLesson(req.params.id, { verifiedBy: req.body?.verifiedBy ? String(req.body.verifiedBy) : undefined }) }));
  });

  app.post("/api/training-memory/lessons/:id/reject", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "lessonId")) return;
    if (!gate(res)) return;
    route(res, () => ({ lesson: trainingMemory.rejectLesson(req.params.id, req.body?.reason ? String(req.body.reason) : undefined) }));
  });

  app.post("/api/training-memory/lessons/:id/stale", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "lessonId")) return;
    if (!gate(res)) return;
    route(res, () => ({ lesson: trainingMemory.staleLesson(req.params.id) }));
  });

  // 15.12 — scope promotion/demotion (agent→mission→lab→project→global). Promotion requires the
  // lesson be verified + promotable (evidenceIds+sourceRunId+corroboration, no secret) + a reason.
  app.post("/api/training-memory/lessons/:id/promote-scope", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "lessonId")) return;
    if (!gate(res)) return;
    route(res, () => ({ lesson: trainingMemory.promoteScope(req.params.id, req.body?.targetScope, { reason: req.body?.reason ? String(req.body.reason) : undefined, resolvedBy: req.body?.resolvedBy ? String(req.body.resolvedBy) : undefined }) }));
  });

  app.post("/api/training-memory/lessons/:id/demote-scope", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "lessonId")) return;
    if (!gate(res)) return;
    route(res, () => ({ lesson: trainingMemory.demoteScope(req.params.id, req.body?.targetScope, { reason: req.body?.reason ? String(req.body.reason) : undefined }) }));
  });

  // 15.9 — per-specialist lessons.
  app.get("/api/training-memory/agents/:agentId/lessons", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.agentId, "agentId")) return;
    if (!gate(res)) return;
    const status = req.query.status as LessonStatus | undefined;
    res.json({ agentId: req.params.agentId, lessons: trainingMemory.listAgentLessons(req.params.agentId, status ? { status } : {}) });
  });
}
