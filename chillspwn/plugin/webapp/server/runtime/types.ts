/**
 * ChillsPwn Agent Runtime — core type model (Phase 1).
 *
 * These types make the runtime — not the model prompt — the owner of objectives,
 * plans, steps, tool calls, evidence, memory, and approvals. Phase 1 introduces the
 * SHAPES (and a few pure helpers + a state-transition table) only. The lifecycle
 * engine that drives them lands in Phase 2; enforcement (tool policy / approvals)
 * lands in Phase 3. Nothing here imports Node APIs except `crypto` for id minting,
 * so the whole module is trivially unit-testable.
 *
 * Design rules:
 *  - Discriminated unions over loose `any`.
 *  - Every record carries provenance (ids + timestamps) so the audit log and the
 *    cockpit UI can reconstruct exactly what happened, when, and under which step.
 *  - `as const` arrays back every string union so runtime guards can validate input.
 */

import { randomUUID } from "crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Shared primitives
// ─────────────────────────────────────────────────────────────────────────────

/** ISO-8601 timestamp string (always produced via `nowIso()`). */
export type IsoTimestamp = string;

export function nowIso(): IsoTimestamp {
  return new Date().toISOString();
}

/** Prefixed, collision-resistant id. Prefix makes ids self-describing in logs. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk classification (consumed by ToolPolicy in Phase 3)
// ─────────────────────────────────────────────────────────────────────────────

export const RISK_LEVELS = [
  "read-only",
  "file-write",
  "terminal",
  "network",
  "destructive",
  "credential-sensitive",
  "exploit-sensitive",
] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export function isRiskLevel(v: unknown): v is RiskLevel {
  return typeof v === "string" && (RISK_LEVELS as readonly string[]).includes(v);
}

// ─────────────────────────────────────────────────────────────────────────────
// AgentRun — the lifecycle of a single user objective
// ─────────────────────────────────────────────────────────────────────────────

export const AGENT_RUN_STATUSES = [
  "created",
  "planning",
  "awaiting_plan_approval",
  "executing",
  "awaiting_user_input",
  "blocked",
  "completed",
  "failed",
  "cancelled",
] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export function isAgentRunStatus(v: unknown): v is AgentRunStatus {
  return typeof v === "string" && (AGENT_RUN_STATUSES as readonly string[]).includes(v);
}

/** Terminal states never transition further. */
export const TERMINAL_RUN_STATUSES: readonly AgentRunStatus[] = [
  "completed",
  "failed",
  "cancelled",
];

export function isTerminalRunStatus(s: AgentRunStatus): boolean {
  return TERMINAL_RUN_STATUSES.includes(s);
}

export interface AgentRun {
  id: string;
  /** The chat/conversation session this run belongs to (ties runtime ↔ existing sessions). */
  sessionId: string;
  /** Persona / agent identity driving the run. */
  persona: string;
  /** Provider kind backing the run (claude | openrouter | openai-codex). */
  providerKind: ProviderKind;
  /** The user's objective, verbatim. */
  objective: string;
  status: AgentRunStatus;
  /** Ordered plan step ids (the plan itself lives in PlanStep records). */
  stepIds: string[];
  /** Engagement / working directory context, if any. */
  engagement?: string;
  cwd?: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  /** Set when the run reaches a terminal state. */
  endedAt?: IsoTimestamp;
  /** Short machine reason for the terminal state (e.g. "completed", "loop_detected"). */
  endReason?: string;
  /** Final human-facing summary / deliverable, populated on completion. */
  finalReport?: string;
  /**
   * How the run was created (Phase 7). "api" = driven via /api/runs (enforced/managed);
   * "chat" = attached to a live chat session (observe-only). Absent ⇒ "api" (back-compat).
   */
  source?: "api" | "chat";
  /** "managed" = runtime owns execution + enforcement; "observe" = read-only observation. */
  mode?: "managed" | "observe";
  /**
   * Phase 7.2: an ADVISORY, NON-ENFORCED plan preview for an observe-only chat run. Lives
   * here (NOT in stepIds / the managed steps array) so it can never drive or gate anything.
   * Absent ⇒ no preview generated yet.
   */
  planPreview?: PlanPreview;
  /** Free-form metadata bag (kept narrow on purpose; promote fields when they stabilize). */
  metadata?: Record<string, string | number | boolean>;
}

export interface CreateAgentRunInput {
  sessionId: string;
  persona: string;
  providerKind: ProviderKind;
  objective: string;
  engagement?: string;
  cwd?: string;
  metadata?: Record<string, string | number | boolean>;
}

export function createAgentRun(input: CreateAgentRunInput): AgentRun {
  const ts = nowIso();
  return {
    id: newId("run"),
    sessionId: input.sessionId,
    persona: input.persona,
    providerKind: input.providerKind,
    objective: input.objective,
    status: "created",
    stepIds: [],
    engagement: input.engagement,
    cwd: input.cwd,
    createdAt: ts,
    updatedAt: ts,
    metadata: input.metadata,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PlanStep — a single unit of the runtime-owned plan
// ─────────────────────────────────────────────────────────────────────────────

export const PLAN_STEP_STATUSES = [
  "pending",
  "running",
  "blocked",
  "completed",
  "failed",
  "skipped",
] as const;
export type PlanStepStatus = (typeof PLAN_STEP_STATUSES)[number];

export function isPlanStepStatus(v: unknown): v is PlanStepStatus {
  return typeof v === "string" && (PLAN_STEP_STATUSES as readonly string[]).includes(v);
}

export interface PlanStep {
  id: string;
  agentRunId: string;
  /** 0-based position in the plan. */
  index: number;
  title: string;
  purpose: string;
  successCriteria: string;
  /** Tool names this step is permitted to use (subset of the persona's toolset). */
  allowedTools: string[];
  riskLevel: RiskLevel;
  /** Step ids that must complete before this one may run. */
  dependencies: string[];
  /** Persona/agent this step is delegated to, if not the orchestrator itself. */
  assignedAgent?: string;
  status: PlanStepStatus;
  /** Evidence ids produced while executing this step. */
  evidenceRefs: string[];
  /** Kanban card id mirroring this step (runtime owns the linkage — Phase 2). */
  boardCardId?: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  startedAt?: IsoTimestamp;
  endedAt?: IsoTimestamp;
  /** Short result/summary when the step ends. */
  summary?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// PlanPreview (Phase 7.2) — an ADVISORY, NON-ENFORCED plan attached to an observe-only
// chat run. Deliberately a SEPARATE type from PlanStep, living in its own
// AgentRun.planPreview field — never in AgentRun.stepIds / the managed steps array — so it
// can never be mistaken for runtime-controlled execution. Preview steps carry NO id, NO
// status, NO board card, NO approval; nothing reads them to gate or drive anything.
// ─────────────────────────────────────────────────────────────────────────────

export interface PreviewStep {
  title: string;
  purpose: string;
  successCriteria: string;
  /** Tools the model SUGGESTS (advisory only — not an allow-list, not enforced). */
  suggestedTools: string[];
  riskLevel: RiskLevel;
  /** Indices of earlier preview steps this one likely follows (advisory). */
  dependsOn: number[];
}

export interface PlanPreview {
  title: string;
  /** The objective this preview addresses (mirrors the run objective at generation time). */
  purpose: string;
  /** Overall "done" heuristic for the previewed work (advisory). */
  successCriteria: string;
  steps: PreviewStep[];
  /** Max risk across steps (advisory). */
  riskLevel: RiskLevel;
  /** Union of suggested tools across steps (advisory). */
  suggestedTools: string[];
  /** 0..1 heuristic — this is a PREVIEW, not a measured confidence. */
  confidence: number;
  createdAt: IsoTimestamp;
  /** "preview" = model-generated advisory plan; "inferred" = derived from observed activity. */
  source: "preview" | "inferred";
  /** Model id / generator label, for transparency. NEVER implies control. */
  generatedBy?: string;
  /** Always false: a preview is never enforced. Present so the shape is self-describing. */
  enforced: false;
}

// ─────────────────────────────────────────────────────────────────────────────
// AgentEvent — the normalized, append-only event stream (audit + UI feed)
// ─────────────────────────────────────────────────────────────────────────────

export const AGENT_EVENT_TYPES = [
  // run lifecycle
  "run_created",
  "run_status_changed",
  "plan_generated",
  "plan_approved",
  "plan_rejected",
  "step_started",
  "step_completed",
  "step_failed",
  "step_blocked",
  // model / provider
  "model_text",
  "model_thinking",
  "provider_error",
  // A provider TURN finished. This is NOT the same as the AgentRun completing — a run
  // spans many turns. The AgentRuntime (Phase 2) decides run completion against its own
  // criteria; the normalizer must never conflate a provider result with run completion.
  "provider_turn_completed",
  "provider_turn_failed",
  // tools
  "tool_requested",
  "tool_approved",
  "tool_rejected",
  "tool_executed",
  "tool_result",
  // observe-only classification of a tool call the runtime did NOT execute/gate
  // (e.g. live chat). Recorded for visibility; never blocks. enforced=false.
  "tool_observed",
  // evidence & memory
  "evidence_stored",
  "memory_proposed",
  "memory_written",
  "memory_rejected",
  "memory_stale",
  // a delegated worker returned a structured result (Phase 4)
  "worker_result_recorded",
  // advisory plan preview for an observe-only chat run (Phase 7.2 — NOT enforced)
  "plan_preview_generated",
  "plan_preview_cleared",
  // approvals & interaction
  "approval_requested",
  "approval_resolved",
  "approval_auto_granted",
  "approval_expired", // 8.3 — OpenRouter gate approval timed out (no longer pending)
  "user_question",
  "user_interruption",
  // 8.2 — HTB training memory lesson lifecycle
  "training_lesson_proposed",
  "training_lesson_verified",
  "training_lesson_rejected",
  "training_lesson_stale",
  // run end
  "run_completed",
  "run_failed",
  // security / audit (Phase 1 emits these from the security layer)
  "security_event",
] as const;
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export function isAgentEventType(v: unknown): v is AgentEventType {
  return typeof v === "string" && (AGENT_EVENT_TYPES as readonly string[]).includes(v);
}

export interface AgentEvent {
  id: string;
  type: AgentEventType;
  /** Null for events that precede a run (e.g. raw security audit at startup). */
  agentRunId: string | null;
  sessionId: string | null;
  /** The step this event belongs to, when applicable. */
  stepId?: string | null;
  timestamp: IsoTimestamp;
  /** Structured payload — shape depends on `type`. Kept as a typed bag, not `any`. */
  data: AgentEventData;
}

/** Loose-but-not-`any` payload: JSON-serializable values only. */
export type AgentEventData = Record<string, JsonValue>;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface NewAgentEventInput {
  type: AgentEventType;
  agentRunId?: string | null;
  sessionId?: string | null;
  stepId?: string | null;
  data?: AgentEventData;
}

export function createAgentEvent(input: NewAgentEventInput): AgentEvent {
  return {
    id: newId("evt"),
    type: input.type,
    agentRunId: input.agentRunId ?? null,
    sessionId: input.sessionId ?? null,
    stepId: input.stepId ?? null,
    timestamp: nowIso(),
    data: input.data ?? {},
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ToolCall + normalized ToolResult
// ─────────────────────────────────────────────────────────────────────────────

export const TOOL_CALL_STATUSES = [
  "requested",
  "awaiting_approval",
  "approved",
  "rejected",
  "executing",
  "succeeded",
  "failed",
] as const;
export type ToolCallStatus = (typeof TOOL_CALL_STATUSES)[number];

export interface ToolCall {
  id: string;
  agentRunId: string;
  /** Phase 3 enforces: a tool call WITHOUT a stepId is rejected. */
  stepId: string | null;
  toolName: string;
  /** JSON-serializable arguments as supplied by the model. */
  arguments: AgentEventData;
  riskLevel: RiskLevel;
  status: ToolCallStatus;
  /** Set when the tool requires approval. */
  approvalId?: string;
  createdAt: IsoTimestamp;
  resolvedAt?: IsoTimestamp;
  result?: ToolResult;
}

/** The normalized shape every tool execution funnels into. */
export interface ToolResult {
  success: boolean;
  output: string;
  artifacts?: JsonValue[];
  evidenceRefs?: string[];
  error?: string;
  suggestedNextStep?: string;
}

/**
 * Max characters of `output` stored inline in the run JSON (Phase 3.1). Larger output is
 * truncated with a marker to keep run docs from bloating. NOTE: full artifact storage
 * (writing the complete output to a side file and referencing it) is intentionally
 * deferred to a later phase; `artifacts` are stored as-is for now.
 */
export const MAX_INLINE_OUTPUT = 20000;

function capInlineOutput(s: string): string {
  if (s.length <= MAX_INLINE_OUTPUT) return s;
  const dropped = s.length - MAX_INLINE_OUTPUT;
  return s.slice(0, MAX_INLINE_OUTPUT) +
    `\n…[truncated ${dropped} chars of ${s.length}; full artifact storage deferred to a later phase]`;
}

export function normalizeToolResult(raw: Partial<ToolResult> & { success: boolean }): ToolResult {
  return {
    success: raw.success,
    output: capInlineOutput(typeof raw.output === "string" ? raw.output : ""),
    artifacts: raw.artifacts,
    evidenceRefs: raw.evidenceRefs,
    error: raw.error,
    suggestedNextStep: raw.suggestedNextStep,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EvidenceItem — a durable, attributable observation from a tool
// ─────────────────────────────────────────────────────────────────────────────

export const EVIDENCE_KINDS = [
  "command_output",
  "file",
  "screenshot",
  "http_response",
  "finding",
  "artifact",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export function isEvidenceKind(v: unknown): v is EvidenceKind {
  return typeof v === "string" && (EVIDENCE_KINDS as readonly string[]).includes(v);
}

export interface EvidenceItem {
  id: string;
  agentRunId: string;
  stepId: string | null;
  kind: EvidenceKind;
  /** Where it came from. */
  sourceToolName?: string;
  sourceToolCallId?: string;
  /** A short label for the cockpit list. */
  label: string;
  /** Inline content (truncated) — large blobs are referenced via `path`/`artifactId`. */
  content?: string;
  path?: string;
  /** Phase 12: side-file artifact id holding the full content (when it exceeded the inline cap). */
  artifactId?: string;
  createdAt: IsoTimestamp;
  metadata?: Record<string, string | number | boolean>;
}

// ─────────────────────────────────────────────────────────────────────────────
// MemoryItem — provenance-bearing memory (Phase 4 wires the proposal flow)
// ─────────────────────────────────────────────────────────────────────────────

export const MEMORY_ITEM_TYPES = [
  "user_preference",
  "engagement_fact",
  "finding",
  "tool_observation",
  "hypothesis",
] as const;
export type MemoryItemType = (typeof MEMORY_ITEM_TYPES)[number];

export function isMemoryItemType(v: unknown): v is MemoryItemType {
  return typeof v === "string" && (MEMORY_ITEM_TYPES as readonly string[]).includes(v);
}

export const MEMORY_STATUSES = ["unverified", "verified", "rejected", "stale"] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export function isMemoryStatus(v: unknown): v is MemoryStatus {
  return typeof v === "string" && (MEMORY_STATUSES as readonly string[]).includes(v);
}

/**
 * Memory scope (Phase 4). Ascending reach: a session note is the most ephemeral; global
 * is reusable across engagements. Promotion to project/global requires provenance +
 * explicit approval (see MemoryService).
 */
export const MEMORY_SCOPES = ["session", "engagement", "project", "global"] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export function isMemoryScope(v: unknown): v is MemoryScope {
  return typeof v === "string" && (MEMORY_SCOPES as readonly string[]).includes(v);
}

export interface MemoryItem {
  id: string;
  type: MemoryItemType;
  scope: MemoryScope;
  content: string;
  // ── Provenance — where this memory came from (Phase 4 finalized) ──
  sourceSessionId?: string;
  sourceAgentRunId?: string;
  sourceStepId?: string;
  sourceToolName?: string;
  sourceToolCallId?: string;
  sourceEvidenceId?: string;
  sourceBoardCardId?: string;
  timestamp: IsoTimestamp;
  /** 0..1 confidence. */
  confidence: number;
  /** unverified = a proposal; verified = approved; rejected/stale = retired. */
  status: MemoryStatus;
  /** Set when status becomes rejected. */
  rejectionReason?: string;
  /** When the status last changed (approve/reject/stale). */
  resolvedAt?: IsoTimestamp;
  resolvedBy?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Delegated worker result contract (Phase 4)
// ─────────────────────────────────────────────────────────────────────────────

export const WORKER_STATUSES = ["complete", "blocked", "failed"] as const;
export type WorkerStatus = (typeof WORKER_STATUSES)[number];

export function isWorkerStatus(v: unknown): v is WorkerStatus {
  return typeof v === "string" && (WORKER_STATUSES as readonly string[]).includes(v);
}

/**
 * The structured result a delegated worker / sub-agent / board card must return — so the
 * runtime stops relying on free-form prose. `evidence` holds EvidenceItems the worker
 * produced; `artifacts` are opaque outputs (files, blobs) referenced by the worker.
 */
export interface WorkerResult {
  status: WorkerStatus;
  summary: string;
  evidence: EvidenceItem[];
  artifacts: JsonValue[];
  /** 0..1 worker self-confidence. */
  confidence: number;
  assumptions: string[];
  recommendedNextSteps: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// ApprovalRequest — a runtime-owned gate for risky actions (Phase 3 enforces)
// ─────────────────────────────────────────────────────────────────────────────

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "expired"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export interface ApprovalRequest {
  id: string;
  agentRunId: string;
  stepId: string | null;
  /** The tool call this approval gates. */
  toolCallId: string;
  /** What needs approving. */
  toolName: string;
  riskLevel: RiskLevel;
  summary: string;
  /** Redacted preview of the action (e.g. the command) for the operator. */
  preview?: string;
  status: ApprovalStatus;
  createdAt: IsoTimestamp;
  resolvedAt?: IsoTimestamp;
  resolvedBy?: string;
  rejectionReason?: string;
  // Phase 16.2 — approval-mode provenance.
  approvalMode?: "human" | "auto" | "hybrid";
  autoApproved?: boolean;
  policyReason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider kind (shared by runtime + provider layer)
// ─────────────────────────────────────────────────────────────────────────────

export const PROVIDER_KINDS = ["claude", "openrouter", "openai-codex", "gemini", "xai-grok"] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export function isProviderKind(v: unknown): v is ProviderKind {
  return typeof v === "string" && (PROVIDER_KINDS as readonly string[]).includes(v);
}
