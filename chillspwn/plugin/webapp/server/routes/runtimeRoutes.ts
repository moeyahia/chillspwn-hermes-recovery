/**
 * Runtime + runtime-memory routes (extracted from server/index.ts in Phase 6).
 *
 * These are the additive, self-contained REST surfaces from Phases 2–5:
 *   /api/runs*  ·  /api/runtime-memory*  ·  /api/observe/tool  ·  worker-result  ·  cockpit
 *
 * The route HANDLERS moved here unchanged (behavior-identical); the singletons that back
 * them (agentRuntime, memoryService) stay in index.ts because they depend on index.ts
 * internals (boardWrite/bsql/broadcastBoard/RUNTIME_DATA_DIR/auditLog/SECURITY) and are
 * injected via `deps`. Nothing here touches the chat path, spawnClaude, or claude -p.
 */

import { randomUUID } from "crypto";
import type { Express, Request, Response } from "express";
import { AgentRuntime, RuntimeError } from "../runtime/AgentRuntime";
import { MemoryService, MemoryError } from "../runtime/MemoryService";
import type { MemoryQuery } from "../runtime/MemoryStore";
import type { EventLog } from "../runtime/EventLog";
import { buildPlanPrompt } from "../runtime/Planner";
import { isEvidenceKind } from "../runtime/types";
import { validateWorkerResult, wrapWorkerResult } from "../runtime/WorkerContract";
import { buildRunReport, runReportToMarkdown, buildEvidenceBundle } from "../runtime/RunReport";
import { TrainingMemoryService } from "../runtime/TrainingMemoryService";

export interface RuntimeRouteDeps {
  agentRuntime: AgentRuntime;
  auditLog: EventLog;
  memoryService: MemoryService;
  /** Reusable attack-chain proposals emitted by workers (always stored as proposed). */
  trainingMemory?: TrainingMemoryService;
  /** index.ts guardSeg — rejects path-traversal in :name/:id params (HTTP 400). */
  guardSeg: (res: Response, raw: unknown, label?: string) => boolean;
  /** index.ts logger. */
  log: (level: string, msg: string, data?: unknown) => void;
  /** Phase 9: when true, free-form worker output is wrapped into the structured contract. */
  workerContractEnabled?: () => boolean;
  /** Phase 10: when true, runs may propose memory (always unverified) via /propose-memory. */
  liveMemoryEnabled?: () => boolean;
  /** Phase 11: when true, final run reports + evidence export endpoints are enabled. */
  reportsEnabled?: () => boolean;
}

export function registerRuntimeRoutes(app: Express, deps: RuntimeRouteDeps): void {
  const { agentRuntime, auditLog, memoryService, trainingMemory, guardSeg, log } = deps;
  const workerContractEnabled = deps.workerContractEnabled ?? (() => false);
  const liveMemoryEnabled = deps.liveMemoryEnabled ?? (() => true);
  const reportsEnabled = deps.reportsEnabled ?? (() => true);

  // ── Phase 11: final run report + evidence export (generate on-the-fly; no run mutation) ──
  app.get("/api/runs/:id/report", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "runId")) return;
    if (!reportsEnabled()) return res.status(403).json({ error: "final run reports are disabled" });
    const doc = agentRuntime.getDoc(req.params.id);
    if (!doc) return res.status(404).json({ error: "run not found" });
    const redact = req.query.redact !== "false";
    const report = buildRunReport(doc, { memory: memoryService.listMemoryItems({ sourceAgentRunId: req.params.id }), redact });
    const fmt = String(req.query.format || "json");
    if (fmt === "md" || fmt === "markdown") {
      res.type("text/markdown; charset=utf-8").send(runReportToMarkdown(report));
    } else {
      res.json({ report });
    }
  });

  app.get("/api/runs/:id/evidence-bundle", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "runId")) return;
    if (!reportsEnabled()) return res.status(403).json({ error: "final run reports are disabled" });
    const doc = agentRuntime.getDoc(req.params.id);
    if (!doc) return res.status(404).json({ error: "run not found" });
    res.json(buildEvidenceBundle(doc, { redact: req.query.redact !== "false" }));
  });

  // Map runtime errors (invalid lifecycle ops) to 400; everything else to 500.
  function runtimeRoute(res: Response, fn: () => any): void {
    try {
      res.json({ ok: true, ...fn() });
    } catch (e: any) {
      if (e instanceof RuntimeError) return void res.status(400).json({ error: e.message });
      log("warn", "agent-runtime route error", { error: e?.message });
      res.status(500).json({ error: String(e?.message || e) });
    }
  }

  app.get("/api/runs", (_req: Request, res: Response) => res.json({ runs: agentRuntime.listRuns() }));

  app.get("/api/runs/plan-prompt", (req: Request, res: Response) => {
    const objective = String(req.query.objective || "");
    if (!objective.trim()) return res.status(400).json({ error: "objective required" });
    res.json({ prompt: buildPlanPrompt(objective) });
  });

  app.post("/api/runs", (req: Request, res: Response) => {
    const { persona, objective, sessionId, providerKind, engagement, cwd } = req.body || {};
    if (!persona || !objective) return res.status(400).json({ error: "persona and objective required" });
    runtimeRoute(res, () => ({
      run: agentRuntime.createRun({
        sessionId: String(sessionId || randomUUID()),
        persona: String(persona),
        providerKind: providerKind === "claude" || providerKind === "openai-codex" ? providerKind : "openrouter",
        objective: String(objective),
        engagement: engagement ? String(engagement) : undefined,
        cwd: cwd ? String(cwd) : undefined,
      }),
    }));
  });

  app.get("/api/runs/:id", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "runId")) return;
    const doc = agentRuntime.getDoc(req.params.id);
    if (!doc) return res.status(404).json({ error: "run not found" });
    res.json(doc);
  });

  app.get("/api/runs/:id/events", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "runId")) return;
    res.json({ events: auditLog.queryByRun(req.params.id) });
  });

  // Phase 5: composite read-only snapshot for the Agent Cockpit — run doc + audit events +
  // related memory in one call (reduces UI round-trips).
  app.get("/api/runs/:id/cockpit", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "runId")) return;
    const doc = agentRuntime.getDoc(req.params.id);
    if (!doc) return res.status(404).json({ error: "run not found" });
    const runMem = memoryService.listMemoryItems({ sourceAgentRunId: req.params.id });
    const sessMem = memoryService
      .listMemoryItems({ sourceSessionId: doc.run.sessionId })
      .filter((m) => !runMem.some((x) => x.id === m.id));
    res.json({ doc, events: auditLog.queryByRun(req.params.id), memory: [...runMem, ...sessMem] });
  });

  // Submit a model-proposed plan. Auto-advances created→planning so a client can post a
  // plan in one call. The runtime VALIDATES it before any step or board card is created.
  app.post("/api/runs/:id/plan", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "runId")) return;
    runtimeRoute(res, () => {
      const run = agentRuntime.getRun(req.params.id);
      if (!run) throw new RuntimeError(`AgentRun not found: ${req.params.id}`);
      if (run.status === "created") agentRuntime.beginPlanning(req.params.id);
      return agentRuntime.submitPlan(req.params.id, req.body?.plan);
    });
  });

  app.post("/api/runs/:id/approve", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "runId")) return;
    runtimeRoute(res, () => ({ run: agentRuntime.approvePlan(req.params.id) }));
  });

  app.post("/api/runs/:id/reject", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "runId")) return;
    runtimeRoute(res, () => ({ run: agentRuntime.rejectPlan(req.params.id, req.body?.reason) }));
  });

  app.post("/api/runs/:id/steps/:stepId/start", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "runId")) return;
    if (!guardSeg(res, req.params.stepId, "stepId")) return;
    runtimeRoute(res, () => ({ step: agentRuntime.startStep(req.params.id, req.params.stepId) }));
  });

  app.post("/api/runs/:id/steps/:stepId/complete", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "runId")) return;
    if (!guardSeg(res, req.params.stepId, "stepId")) return;
    runtimeRoute(res, () => ({ step: agentRuntime.completeStep(req.params.id, req.params.stepId, String(req.body?.summary || "")) }));
  });

  app.post("/api/runs/:id/steps/:stepId/fail", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "runId")) return;
    if (!guardSeg(res, req.params.stepId, "stepId")) return;
    runtimeRoute(res, () => ({ step: agentRuntime.failStep(req.params.id, req.params.stepId, String(req.body?.reason || "")) }));
  });

  // Step-bound tool gate (Phase 2/3.1): a request without a valid running step / with a tool
  // outside the step's allowedTools is REJECTED.
  app.post("/api/runs/:id/tools", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "runId")) return;
    const { stepId, toolName, arguments: toolArgs, command } = req.body || {};
    if (!toolName) return res.status(400).json({ error: "toolName required" });
    runtimeRoute(res, () =>
      agentRuntime.requestTool({
        runId: req.params.id,
        stepId: stepId ? String(stepId) : null,
        toolName: String(toolName),
        arguments: toolArgs && typeof toolArgs === "object" ? toolArgs : {},
        command: command ? String(command) : undefined,
      }),
    );
  });

  // ── Phase 3: approval workflow + normalized tool results ──
  app.get("/api/runs/:id/approvals", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "runId")) return;
    if (!agentRuntime.getRun(req.params.id)) return res.status(404).json({ error: "run not found" });
    const onlyPending = req.query.pending === "1" || req.query.pending === "true";
    res.json({ approvals: agentRuntime.listApprovals(req.params.id, onlyPending) });
  });

  app.post("/api/runs/:id/approvals/:approvalId/approve", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "runId")) return;
    if (!guardSeg(res, req.params.approvalId, "approvalId")) return;
    runtimeRoute(res, () =>
      agentRuntime.resolveApproval(req.params.id, req.params.approvalId, "approve", {
        resolvedBy: req.body?.resolvedBy ? String(req.body.resolvedBy) : undefined,
      }),
    );
  });

  app.post("/api/runs/:id/approvals/:approvalId/reject", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "runId")) return;
    if (!guardSeg(res, req.params.approvalId, "approvalId")) return;
    runtimeRoute(res, () =>
      agentRuntime.resolveApproval(req.params.id, req.params.approvalId, "reject", {
        resolvedBy: req.body?.resolvedBy ? String(req.body.resolvedBy) : undefined,
        reason: req.body?.reason ? String(req.body.reason) : undefined,
      }),
    );
  });

  // Record a normalized ToolResult for an APPROVED tool call. Optionally mints an
  // EvidenceItem linked to the run/step/toolCall/board card.
  app.post("/api/runs/:id/tools/:toolCallId/result", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "runId")) return;
    if (!guardSeg(res, req.params.toolCallId, "toolCallId")) return;
    const b = req.body || {};
    if (typeof b.success !== "boolean") return res.status(400).json({ error: "success (boolean) required" });
    if (b.evidenceKind !== undefined && !isEvidenceKind(b.evidenceKind)) {
      return res.status(400).json({ error: `invalid evidenceKind '${String(b.evidenceKind)}'` });
    }
    runtimeRoute(res, () => ({
      result: agentRuntime.recordToolResult(
        req.params.id,
        req.params.toolCallId,
        {
          success: b.success,
          output: typeof b.output === "string" ? b.output : "",
          artifacts: Array.isArray(b.artifacts) ? b.artifacts : undefined,
          error: b.error != null ? String(b.error) : undefined,
          suggestedNextStep: b.suggestedNextStep != null ? String(b.suggestedNextStep) : undefined,
        },
        {
          createEvidence: b.createEvidence === true,
          evidenceKind: isEvidenceKind(b.evidenceKind) ? b.evidenceKind : undefined,
          evidenceLabel: b.evidenceLabel != null ? String(b.evidenceLabel) : undefined,
        },
      ),
    }));
  });

  app.post("/api/runs/:id/evidence", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "runId")) return;
    const { stepId, kind, label, content, sourceToolName } = req.body || {};
    if (!label) return res.status(400).json({ error: "label required" });
    if (kind !== undefined && kind !== null && !isEvidenceKind(kind)) {
      return res.status(400).json({ error: `invalid evidence kind '${String(kind)}'` });
    }
    runtimeRoute(res, () => ({
      evidence: agentRuntime.recordEvidence({
        runId: req.params.id,
        stepId: stepId ? String(stepId) : null,
        kind: isEvidenceKind(kind) ? kind : "finding",
        label: String(label),
        content: content != null ? String(content) : undefined,
        sourceToolName: sourceToolName ? String(sourceToolName) : undefined,
      }),
    }));
  });

  app.post("/api/runs/:id/complete", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "runId")) return;
    runtimeRoute(res, () => ({ run: agentRuntime.completeRun(req.params.id, String(req.body?.finalReport || "")) }));
  });

  // ── Phase 3: OBSERVE-ONLY classification (e.g. live chat / frozen claude -p) ──
  // Records what ToolPolicy WOULD decide; never blocks, never requires a run, never
  // touches the claude path.
  app.post("/api/observe/tool", (req: Request, res: Response) => {
    const b = req.body || {};
    if (!b.toolName) return res.status(400).json({ error: "toolName required" });
    res.json({
      ...agentRuntime.observeToolCall({
        sessionId: b.sessionId ? String(b.sessionId) : null,
        runId: b.runId ? String(b.runId) : null,
        stepId: b.stepId ? String(b.stepId) : null,
        toolName: String(b.toolName),
        command: b.command != null ? String(b.command) : undefined,
      }),
      note: "observe-only — classification recorded, NOT enforced",
    });
  });

  // ── Phase 4: delegated worker result (structured contract) ──
  app.post("/api/runs/:id/worker-result", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "runId")) return;
    const b = req.body || {};
    const stepId = b.stepId ? String(b.stepId) : null;
    if (stepId && !guardSeg(res, stepId, "stepId")) return;
    // Phase 9: when the worker-contract flag is on, accept FREE-FORM worker output and wrap it
    // into the structured contract (conservative). Off ⇒ strict (Phase 4 behavior, rejects free-form).
    runtimeRoute(res, () => {
      let result = b.result;
      let wrapped = false;
      if (workerContractEnabled() && !validateWorkerResult(b.result).ok) {
        const w = wrapWorkerResult(b.result);
        result = w.result;
        wrapped = w.wrapped;
      }
      const rec = agentRuntime.recordWorkerResult(req.params.id, stepId, result);
      const proposedLessonIds: string[] = [];
      const proposalErrors: string[] = [];
      if (trainingMemory) {
        for (const candidate of rec.result.proposedAttackChains ?? []) {
          try {
            const raw = (candidate && typeof candidate === "object" && !Array.isArray(candidate)) ? candidate as Record<string, unknown> : {};
            const lesson = trainingMemory.proposeLesson({
              ...raw,
              kind: "attack_chain",
              // Runtime-owned provenance overrides anything claimed by the worker.
              sourceRunId: req.params.id,
              sourceStepIds: stepId ? [stepId] : [],
              evidenceIds: rec.evidenceIds,
              sourceBoxOrLab: undefined,
            });
            proposedLessonIds.push(lesson.id);
          } catch (e: any) {
            proposalErrors.push(String(e?.message || e));
          }
        }
      }
      return { ...rec, wrapped, proposedLessonIds, proposalErrors };
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // RUNTIME MEMORY (Phase 4) — provenance-backed memory with an approval flow.
  // Namespaced under /api/runtime-memory/* so it never collides with the legacy file
  // memory (/api/memory → broker-filtered USER.md/MEMORY.md), which is
  // registered by LegacyMemoryBroker and is read-only at the whole-file API.
  // ════════════════════════════════════════════════════════════════════════════
  function memoryRoute(res: Response, fn: () => any): void {
    try {
      res.json({ ok: true, ...fn() });
    } catch (e: any) {
      if (e instanceof MemoryError) return void res.status(400).json({ error: e.message });
      log("warn", "runtime-memory route error", { error: e?.message });
      res.status(500).json({ error: String(e?.message || e) });
    }
  }

  function memQuery(req: Request): MemoryQuery {
    const q: MemoryQuery = {};
    if (typeof req.query.scope === "string") q.scope = req.query.scope as MemoryQuery["scope"];
    if (typeof req.query.status === "string") q.status = req.query.status as MemoryQuery["status"];
    if (typeof req.query.runId === "string") q.sourceAgentRunId = req.query.runId;
    if (typeof req.query.sessionId === "string") q.sourceSessionId = req.query.sessionId;
    return q;
  }

  app.post("/api/runtime-memory/propose", (req: Request, res: Response) => {
    const b = req.body || {};
    if (!b.type || !b.content || !b.scope) return res.status(400).json({ error: "type, content, scope required" });
    memoryRoute(res, () => ({ item: memoryService.proposeMemory(b) }));
  });

  app.get("/api/runtime-memory/proposals", (req: Request, res: Response) => {
    res.json({ proposals: memoryService.listMemoryProposals(memQuery(req)) });
  });

  app.get("/api/runtime-memory/items", (req: Request, res: Response) => {
    res.json({ items: memoryService.listMemoryItems(memQuery(req)) });
  });

  app.get("/api/runtime-memory/:id", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "memoryId")) return;
    const item = memoryService.getMemory(req.params.id);
    if (!item) return res.status(404).json({ error: "memory item not found" });
    res.json({ item });
  });

  // Phase 10: propose memory FROM a live run (always UNVERIFIED). Stamps the run as provenance +
  // referentially validates run/step/evidence references before proposing.
  app.post("/api/runs/:id/propose-memory", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "runId")) return;
    if (!liveMemoryEnabled()) return res.status(403).json({ error: "live memory proposals are disabled" });
    const run = agentRuntime.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: "run not found" });
    const b = req.body || {};
    memoryRoute(res, () => {
      const proposal = {
        type: b.type,
        content: String(b.content ?? ""),
        scope: b.scope ?? "engagement",
        confidence: typeof b.confidence === "number" ? b.confidence : undefined,
        sourceAgentRunId: run.id,
        sourceSessionId: run.sessionId,
        sourceStepId: b.stepId ? String(b.stepId) : (agentRuntime.getActiveStepId(run.id) ?? undefined),
        sourceEvidenceId: b.evidenceId ? String(b.evidenceId) : undefined,
      };
      const ref = memoryService.validateMemoryReferences(proposal, {
        runExists: (id) => !!agentRuntime.getRun(id),
        stepExists: (rid, sid) => !!agentRuntime.getDoc(rid)?.steps.some((s) => s.id === sid),
        evidenceExists: (rid, eid) => !!agentRuntime.getDoc(rid)?.evidence.some((e) => e.id === eid),
      });
      if (!ref.valid) throw new MemoryError(`referential validation failed: ${ref.errors.join("; ")}`);
      return { item: memoryService.proposeMemory(proposal) }; // always unverified
    });
  });

  // Phase 10: the VERIFIED + relevant memory that would be fed into a new run (never unverified/
  // rejected/stale). Drives "what context this run trusts".
  app.get("/api/runs/:id/verified-memory", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "runId")) return;
    const run = agentRuntime.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: "run not found" });
    res.json({ items: memoryService.getRelevantVerifiedMemory({ sourceAgentRunId: run.id }) });
  });

  app.post("/api/runtime-memory/:id/approve", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "memoryId")) return;
    memoryRoute(res, () => ({ item: memoryService.approveMemory(req.params.id, { resolvedBy: req.body?.resolvedBy ? String(req.body.resolvedBy) : undefined }) }));
  });

  app.post("/api/runtime-memory/:id/reject", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "memoryId")) return;
    memoryRoute(res, () => ({ item: memoryService.rejectMemory(req.params.id, req.body?.reason ? String(req.body.reason) : undefined, { resolvedBy: req.body?.resolvedBy ? String(req.body.resolvedBy) : undefined }) }));
  });

  app.post("/api/runtime-memory/:id/stale", (req: Request, res: Response) => {
    if (!guardSeg(res, req.params.id, "memoryId")) return;
    memoryRoute(res, () => ({ item: memoryService.markStale(req.params.id) }));
  });
}
