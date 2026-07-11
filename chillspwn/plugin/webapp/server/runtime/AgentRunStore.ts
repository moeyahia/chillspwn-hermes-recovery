/**
 * AgentRunStore (Phase 2).
 *
 * Durable home for AgentRuns and everything attached to them (plan steps, tool calls,
 * evidence). One JSON document per run under `<dir>/runs/<runId>.json`, written
 * atomically (temp + rename). No DB dependency; fine for the run volumes this
 * dashboard sees, and trivially inspectable/testable.
 *
 * The append-only AgentEvent stream lives separately in EventLog — this store holds
 * current state, EventLog holds history.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import type { AgentRun, PlanStep, ToolCall, EvidenceItem, ApprovalRequest, WorkerResult } from "./types";

/** A delegated worker result attached to a run (and usually a step). */
export interface WorkerResultRecord {
  stepId: string | null;
  result: WorkerResult;
  /** Phase 4.1: ids of the run-owned EvidenceItems folded in from result.evidence. */
  evidenceIds: string[];
  recordedAt: string;
}

/** The full persisted document for one run. */
export interface AgentRunDoc {
  run: AgentRun;
  steps: PlanStep[];
  toolCalls: ToolCall[];
  evidence: EvidenceItem[];
  /** Phase 3: approval requests gating risky tool calls. */
  approvals: ApprovalRequest[];
  /** Phase 4: structured results from delegated workers. */
  workerResults: WorkerResultRecord[];
}

export class AgentRunStore {
  private readonly dir: string;
  private ensured = false;

  constructor(baseDir: string) {
    this.dir = join(baseDir, "runs");
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  createRun(run: AgentRun): AgentRunDoc {
    const doc: AgentRunDoc = { run, steps: [], toolCalls: [], evidence: [], approvals: [], workerResults: [] };
    this.writeDoc(doc);
    return doc;
  }

  getDoc(runId: string): AgentRunDoc | null {
    const p = this.docPath(runId);
    if (!existsSync(p)) return null;
    try {
      const doc = JSON.parse(readFileSync(p, "utf-8")) as AgentRunDoc;
      // Tolerate docs written before a field existed (e.g. pre-Phase-3 approvals).
      doc.steps ??= [];
      doc.toolCalls ??= [];
      doc.evidence ??= [];
      doc.approvals ??= [];
      doc.workerResults ??= [];
      // Phase 4.1: older worker-result records predate evidenceIds — default to [].
      for (const wr of doc.workerResults) wr.evidenceIds ??= [];
      return doc;
    } catch {
      return null;
    }
  }

  getRun(runId: string): AgentRun | null {
    return this.getDoc(runId)?.run ?? null;
  }

  /** Run summaries, newest first. */
  listRuns(): AgentRun[] {
    if (!existsSync(this.dir)) return [];
    const runs: AgentRun[] = [];
    for (const f of readdirSync(this.dir)) {
      if (!f.endsWith(".json")) continue;
      const doc = this.getDoc(f.slice(0, -5));
      if (doc) runs.push(doc.run);
    }
    return runs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  deleteRun(runId: string): void {
    const p = this.docPath(runId);
    try { if (existsSync(p)) unlinkSync(p); } catch {}
  }

  // ── mutations (read-modify-write the whole doc; single-writer process) ──────

  saveRun(run: AgentRun): void {
    this.mutate(run.id, (doc) => { doc.run = run; });
  }

  setSteps(runId: string, steps: PlanStep[]): void {
    this.mutate(runId, (doc) => { doc.steps = steps; });
  }

  updateStep(runId: string, stepId: string, patch: Partial<PlanStep>): PlanStep | null {
    let updated: PlanStep | null = null;
    this.mutate(runId, (doc) => {
      const idx = doc.steps.findIndex((s) => s.id === stepId);
      if (idx === -1) return;
      doc.steps[idx] = { ...doc.steps[idx], ...patch, updatedAt: new Date().toISOString() };
      updated = doc.steps[idx];
    });
    return updated;
  }

  getStep(runId: string, stepId: string): PlanStep | null {
    return this.getDoc(runId)?.steps.find((s) => s.id === stepId) ?? null;
  }

  addToolCall(runId: string, tc: ToolCall): void {
    this.mutate(runId, (doc) => { doc.toolCalls.push(tc); });
  }

  updateToolCall(runId: string, toolCallId: string, patch: Partial<ToolCall>): void {
    this.mutate(runId, (doc) => {
      const idx = doc.toolCalls.findIndex((t) => t.id === toolCallId);
      if (idx !== -1) doc.toolCalls[idx] = { ...doc.toolCalls[idx], ...patch };
    });
  }

  addEvidence(runId: string, ev: EvidenceItem): void {
    this.mutate(runId, (doc) => { doc.evidence.push(ev); });
  }

  addApproval(runId: string, ap: ApprovalRequest): void {
    this.mutate(runId, (doc) => { doc.approvals.push(ap); });
  }

  updateApproval(runId: string, approvalId: string, patch: Partial<ApprovalRequest>): ApprovalRequest | null {
    let updated: ApprovalRequest | null = null;
    this.mutate(runId, (doc) => {
      const idx = doc.approvals.findIndex((a) => a.id === approvalId);
      if (idx === -1) return;
      doc.approvals[idx] = { ...doc.approvals[idx], ...patch };
      updated = doc.approvals[idx];
    });
    return updated;
  }

  getApproval(runId: string, approvalId: string): ApprovalRequest | null {
    return this.getDoc(runId)?.approvals.find((a) => a.id === approvalId) ?? null;
  }

  getToolCall(runId: string, toolCallId: string): ToolCall | null {
    return this.getDoc(runId)?.toolCalls.find((t) => t.id === toolCallId) ?? null;
  }

  addWorkerResult(runId: string, rec: WorkerResultRecord): void {
    this.mutate(runId, (doc) => { doc.workerResults.push(rec); });
  }

  // ── internals ───────────────────────────────────────────────────────────────

  private mutate(runId: string, fn: (doc: AgentRunDoc) => void): void {
    const doc = this.getDoc(runId);
    if (!doc) throw new Error(`AgentRun not found: ${runId}`);
    fn(doc);
    this.writeDoc(doc);
  }

  private writeDoc(doc: AgentRunDoc): void {
    this.ensureDir();
    const p = this.docPath(doc.run.id);
    const tmp = `${p}.tmp-${randomUUID()}`;
    writeFileSync(tmp, JSON.stringify(doc, null, 2));
    renameSync(tmp, p); // atomic on the same filesystem
  }

  private docPath(runId: string): string {
    // runId is minted by the runtime (run_<uuid>); guard against separators anyway.
    const safe = runId.replace(/[^A-Za-z0-9_.-]/g, "_");
    return join(this.dir, `${safe}.json`);
  }

  private ensureDir(): void {
    if (this.ensured) return;
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    this.ensured = true;
  }
}
