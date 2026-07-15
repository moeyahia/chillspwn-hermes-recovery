/**
 * MemoryService (Phase 4) — provenance-backed memory with an approval flow.
 *
 * Core safety rule: model output NEVER becomes trusted long-term memory automatically.
 *   - `proposeMemory` validates a proposal and stores it as an **unverified** MemoryItem
 *     (a "proposal"). It is never created `verified`.
 *   - `approveMemory` is the ONLY path to `verified`, and is an explicit operator action.
 *   - `rejectMemory` / `markStale` retire items.
 *
 * Category discipline (enforced by validation + the no-auto-verify rule):
 *   - Evidence/tool observations do NOT auto-become long-term memory — they must be
 *     proposed and approved like anything else.
 *   - Hypotheses are never treated as verified until explicitly approved.
 *   - project/global scope requires real provenance (a run/session/evidence link).
 *
 * Separate from the legacy USER.md/MEMORY.md file projection. The HTTP and
 * provider-context boundaries validate that projection with the same reusable
 * content rules before accepting or injecting it.
 */

import {
  newId,
  nowIso,
  isMemoryItemType,
  isMemoryScope,
  type MemoryItem,
  type MemoryItemType,
  type MemoryScope,
} from "./types";
import { MemoryStore, type MemoryQuery } from "./MemoryStore";
import { EventLog } from "./EventLog";
import {
  findRejectableSecrets,
  findReusableContentIdentifiers,
  redactLessonText,
} from "./AttackLesson";

export function reusableMemoryViolations(content: string): string[] {
  const errors: string[] = [];
  const secrets = findRejectableSecrets(content ?? "");
  if (secrets.length) errors.push(`target-specific secret(s): ${secrets.join(", ")}`);
  const targets = findReusableContentIdentifiers(content ?? "");
  if (targets.length) errors.push(`target-specific identifier(s): ${targets.join(", ")}`);
  if (redactLessonText(content ?? "") !== (content ?? "")) errors.push("credential or token material");
  return errors;
}

/** What a caller submits to proposeMemory (no id/status/timestamp). */
export interface MemoryProposalInput {
  type: MemoryItemType;
  content: string;
  scope: MemoryScope;
  confidence?: number;
  sourceSessionId?: string;
  sourceAgentRunId?: string;
  sourceStepId?: string;
  sourceToolName?: string;
  sourceToolCallId?: string;
  sourceEvidenceId?: string;
  sourceBoardCardId?: string;
}

export type MemoryValidation = { valid: true } | { valid: false; errors: string[] };

export class MemoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryError";
  }
}

export class MemoryService {
  constructor(
    private readonly store: MemoryStore,
    private readonly events: EventLog,
  ) {}

  /** True if the proposal carries any concrete provenance link. */
  private hasAnyProvenance(p: MemoryProposalInput): boolean {
    return !!(p.sourceSessionId || p.sourceAgentRunId || p.sourceStepId || p.sourceEvidenceId || p.sourceToolCallId);
  }

  /**
   * Validate a proposal against the provenance/scope rules. Pure — no side effects.
   *
   * SCOPE OF THIS VALIDATION (Phase 4 / 4.1): it checks the SHAPE and PRESENCE of
   * provenance fields (e.g. project/global scope must carry SOME source link, a
   * tool_observation must name a tool/evidence source). It does NOT verify that the
   * referenced run/step/tool-call/evidence IDs actually EXIST — provenance is not yet
   * referentially verified. Treat a "valid" proposal as well-formed, not as proof that
   * its links resolve. Referential verification is deferred to a later phase (it would
   * require wiring this service to the AgentRunStore / EvidenceStore).
   */
  validateMemoryProposal(p: MemoryProposalInput): MemoryValidation {
    const errors: string[] = [];

    if (!isMemoryItemType(p.type)) errors.push(`invalid memory type '${String(p.type)}'`);
    if (!isMemoryScope(p.scope)) errors.push(`invalid memory scope '${String(p.scope)}'`);
    if (typeof p.content !== "string" || !p.content.trim()) errors.push("content is required");

    const conf = p.confidence ?? 0.5;
    if (typeof conf !== "number" || Number.isNaN(conf) || conf < 0 || conf > 1) {
      errors.push("confidence must be a number in [0,1]");
    }

    // Reusable memory (project/global) must be grounded in real provenance.
    if ((p.scope === "project" || p.scope === "global") && !this.hasAnyProvenance(p)) {
      errors.push(`scope '${p.scope}' requires provenance (a run/session/step/evidence/toolCall link)`);
    }
    // Session-scoped memory must name its session.
    if (p.scope === "session" && !p.sourceSessionId) {
      errors.push("scope 'session' requires sourceSessionId");
    }
    // Engagement memory must come from a session or run.
    if (p.scope === "engagement" && !(p.sourceSessionId || p.sourceAgentRunId)) {
      errors.push("scope 'engagement' requires sourceSessionId or sourceAgentRunId");
    }
    // A tool observation must point at the tool/evidence it came from.
    if (p.type === "tool_observation" && !(p.sourceToolName || p.sourceToolCallId || p.sourceEvidenceId)) {
      errors.push("type 'tool_observation' requires sourceToolName, sourceToolCallId, or sourceEvidenceId");
    }
    if (p.scope === "project" || p.scope === "global") {
      const unsafe = reusableMemoryViolations(p.content ?? "");
      if (unsafe.length) errors.push(`reusable memory must be target-agnostic and secret-free (${unsafe.join("; ")})`);
    }

    return errors.length ? { valid: false, errors } : { valid: true };
  }

  /**
   * Validate + store a proposal as an UNVERIFIED MemoryItem. Throws MemoryError on an
   * invalid proposal. Never creates a verified item — approval is a separate step.
   */
  proposeMemory(p: MemoryProposalInput): MemoryItem {
    const v = this.validateMemoryProposal(p);
    if (!v.valid) throw new MemoryError(`invalid memory proposal: ${v.errors.join("; ")}`);

    const item: MemoryItem = {
      id: newId("mem"),
      type: p.type,
      scope: p.scope,
      content: p.content.trim(),
      sourceSessionId: p.sourceSessionId,
      sourceAgentRunId: p.sourceAgentRunId,
      sourceStepId: p.sourceStepId,
      sourceToolName: p.sourceToolName,
      sourceToolCallId: p.sourceToolCallId,
      sourceEvidenceId: p.sourceEvidenceId,
      sourceBoardCardId: p.sourceBoardCardId,
      timestamp: nowIso(),
      confidence: p.confidence ?? 0.5,
      status: "unverified", // ALWAYS — a proposal is never auto-trusted.
    };
    this.store.add(item);
    this.audit("memory_proposed", item);
    return item;
  }

  /** Promote an unverified proposal to a verified MemoryItem (explicit approval). */
  approveMemory(id: string, opts: { resolvedBy?: string } = {}): MemoryItem {
    const item = this.requireItem(id);
    if (item.status !== "unverified") {
      throw new MemoryError(`memory ${id} is '${item.status}', only an unverified proposal can be approved`);
    }
    const unsafe = reusableMemoryViolations(item.content);
    if (unsafe.length) {
      throw new MemoryError(`memory ${id} cannot be approved: ${unsafe.join("; ")}; keep raw target state in evidence`);
    }
    const updated = this.store.update(id, { status: "verified", resolvedAt: nowIso(), resolvedBy: opts.resolvedBy })!;
    this.audit("memory_written", updated);
    return updated;
  }

  rejectMemory(id: string, reason?: string, opts: { resolvedBy?: string } = {}): MemoryItem {
    const item = this.requireItem(id);
    if (item.status === "rejected") throw new MemoryError(`memory ${id} is already rejected`);
    const updated = this.store.update(id, {
      status: "rejected", rejectionReason: reason ?? "", resolvedAt: nowIso(), resolvedBy: opts.resolvedBy,
    })!;
    this.audit("memory_rejected", updated);
    return updated;
  }

  markStale(id: string): MemoryItem {
    const item = this.requireItem(id);
    const updated = this.store.update(id, { status: "stale", resolvedAt: nowIso() })!;
    this.audit("memory_stale", updated);
    return updated;
  }

  /** Proposals = unverified items awaiting review. */
  listMemoryProposals(query: Omit<MemoryQuery, "status"> = {}): MemoryItem[] {
    return this.store.list({ ...query, status: "unverified" });
  }

  /** Items, filtered. Default returns everything; pass `{ status: "verified" }` for trusted only. */
  listMemoryItems(query: MemoryQuery = {}): MemoryItem[] {
    return this.store.list(query);
  }

  getMemory(id: string): MemoryItem | null {
    return this.store.get(id);
  }

  /**
   * Phase 10: memory to feed into a NEW run's context. Returns ONLY `verified` items, filtered
   * by relevance (scope / run / session). This is the safety boundary — it can never return
   * unverified hypotheses, rejected items, or stale items.
   */
  getRelevantVerifiedMemory(query: Omit<MemoryQuery, "status"> = {}): MemoryItem[] {
    return this.store.list({ ...query, status: "verified" })
      .filter((item) => reusableMemoryViolations(item.content).length === 0);
  }

  /**
   * Phase 10: referential provenance validation — confirm that referenced run/step/evidence IDs
   * actually EXIST (where a checker is provided). Complements the structural validateMemoryProposal.
   * Checkers are injected so MemoryService stays decoupled from the run store; references with NO
   * checker provided remain structural-only (documented). Never throws.
   */
  validateMemoryReferences(
    p: MemoryProposalInput,
    checks: {
      runExists?: (runId: string) => boolean;
      stepExists?: (runId: string, stepId: string) => boolean;
      evidenceExists?: (runId: string, evidenceId: string) => boolean;
    },
  ): MemoryValidation {
    const errors: string[] = [];
    const runId = p.sourceAgentRunId;
    if (runId && checks.runExists && !checks.runExists(runId)) {
      errors.push(`referenced run '${runId}' does not exist`);
    }
    if (runId && p.sourceStepId && checks.stepExists && !checks.stepExists(runId, p.sourceStepId)) {
      errors.push(`referenced step '${p.sourceStepId}' does not exist in run '${runId}'`);
    }
    if (runId && p.sourceEvidenceId && checks.evidenceExists && !checks.evidenceExists(runId, p.sourceEvidenceId)) {
      errors.push(`referenced evidence '${p.sourceEvidenceId}' does not exist in run '${runId}'`);
    }
    return errors.length ? { valid: false, errors } : { valid: true };
  }

  private requireItem(id: string): MemoryItem {
    const item = this.store.get(id);
    if (!item) throw new MemoryError(`memory item not found: ${id}`);
    return item;
  }

  private audit(type: "memory_proposed" | "memory_written" | "memory_rejected" | "memory_stale", item: MemoryItem): void {
    this.events.append({
      type,
      agentRunId: item.sourceAgentRunId ?? null,
      sessionId: item.sourceSessionId ?? null,
      stepId: item.sourceStepId ?? null,
      data: {
        memoryId: item.id, memType: item.type, scope: item.scope, status: item.status, confidence: item.confidence,
      },
    });
  }
}

/**
 * Phase 8.1 — format operator-VERIFIED memory into an auditable planning-context block. Defensive:
 * includes ONLY status==="verified" items, EXCLUDES session-scoped (run-specific) memory, caps the
 * count, and returns "" when there is nothing. NEVER includes unverified / rejected / stale items
 * or hypotheses — those can never reach a run's planning context through this function.
 */
export function buildVerifiedMemoryContext(items: MemoryItem[], opts: { max?: number } = {}): string {
  const max = opts.max ?? 25;
  const usable = items
    .filter((m) => m.status === "verified") // defensive — never trust a non-verified item
    .filter((m) => m.scope !== "session") // session scope = run-specific, not reusable context
    .filter((m) => m.type !== "hypothesis") // 8.2: a hypothesis is NOT a fact, even when verified —
    //                                          it must never appear under "you may TRUST these"
    .filter((m) => reusableMemoryViolations(m.content).length === 0)
    .slice(0, max);
  if (!usable.length) return "";
  return [
    "=== VERIFIED MEMORY (operator-approved facts — you may TRUST these) ===",
    "These are durable facts an operator explicitly verified. Unverified/rejected/stale items and",
    "hypotheses are deliberately excluded. Plan with these in mind; do not re-discover them.",
    ...usable.map((m) => `- [${m.type}/${m.scope}] ${m.content}`),
    "=== END VERIFIED MEMORY ===",
  ].join("\n");
}
