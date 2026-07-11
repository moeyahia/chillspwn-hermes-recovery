/**
 * Cockpit pure helpers (Phase 5) — all logic that maps runtime snapshots to display, with
 * NO React/DOM so it is unit-testable with `bun test`. The cockpit component renders these.
 *
 * Critical rule (tested): observe-only events (live chat / frozen claude -p) are NEVER
 * labeled "ENFORCED". The runtime only enforces inside /api/runs.
 */

import type {
  AgentRunStatus,
  PlanStepStatus,
  RiskLevel,
  PlanStep,
  ToolCall,
  ApprovalRequest,
  AgentEvent,
} from "./runtimeTypes";

export interface Badge {
  label: string;
  color: string;
}

const GREY = "#9aa6b6";
const LIME = "#b6f23a";
const GREEN = "#2bd47f";
const AMBER = "#ffae42";
const RED = "#ff4d63";
const ORANGE = "#ff8844";

export function runStatusBadge(status: AgentRunStatus): Badge {
  switch (status) {
    case "executing": return { label: "EXECUTING", color: LIME };
    case "completed": return { label: "COMPLETED", color: GREEN };
    case "failed": return { label: "FAILED", color: RED };
    case "cancelled": return { label: "CANCELLED", color: RED };
    case "blocked": return { label: "BLOCKED", color: AMBER };
    case "awaiting_user_input": return { label: "AWAITING INPUT", color: AMBER };
    case "awaiting_plan_approval": return { label: "PLAN REVIEW", color: AMBER };
    case "planning": return { label: "PLANNING", color: GREY };
    case "created":
    default: return { label: "CREATED", color: GREY };
  }
}

export function stepStatusBadge(status: PlanStepStatus): Badge {
  switch (status) {
    case "running": return { label: "RUNNING", color: LIME };
    case "completed": return { label: "DONE", color: GREEN };
    case "failed": return { label: "FAILED", color: RED };
    case "blocked": return { label: "BLOCKED", color: AMBER };
    case "skipped": return { label: "SKIPPED", color: GREY };
    case "pending":
    default: return { label: "PENDING", color: GREY };
  }
}

export function riskBadge(risk: RiskLevel): Badge {
  switch (risk) {
    case "read-only": return { label: "read-only", color: GREEN };
    case "network": return { label: "network", color: LIME };
    case "file-write": return { label: "file-write", color: AMBER };
    case "terminal": return { label: "terminal", color: ORANGE };
    case "destructive": return { label: "destructive", color: RED };
    case "credential-sensitive": return { label: "credential", color: RED };
    case "exploit-sensitive": return { label: "exploit", color: RED };
    default: return { label: String(risk), color: GREY };
  }
}

/** Plan progress — `done` counts terminal-success steps (completed + skipped). */
export function stepProgress(steps: PlanStep[]): { done: number; total: number; pct: number } {
  const total = steps.length;
  const done = steps.filter((s) => s.status === "completed" || s.status === "skipped").length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return { done, total, pct };
}

/** The first running step (the one the agent is actively on), or null. */
export function activeStep(steps: PlanStep[]): PlanStep | null {
  return steps.find((s) => s.status === "running") ?? null;
}

/** The most recent in-flight tool call (approved/executing without a result yet), or null. */
export function activeToolCall(toolCalls: ToolCall[]): ToolCall | null {
  const inFlight = toolCalls.filter(
    (t) => (t.status === "approved" || t.status === "executing") && !t.result,
  );
  return inFlight.length ? inFlight[inFlight.length - 1] : null;
}

export function pendingApprovals(approvals: ApprovalRequest[]): ApprovalRequest[] {
  return approvals.filter((a) => a.status === "pending");
}

/** Phase 16.2 — provenance badge for an approval: AUTO-APPROVED vs human-approved vs pending. */
export function approvalProvenanceBadge(a: ApprovalRequest): Badge {
  if (a.status === "approved" && (a as { autoApproved?: boolean }).autoApproved) return { label: "AUTO-APPROVED", color: AMBER };
  if (a.status === "approved") return { label: "HUMAN-APPROVED", color: GREEN };
  if (a.status === "rejected") return { label: "REJECTED", color: RED };
  if (a.status === "expired") return { label: "EXPIRED", color: GREY };
  return { label: "PENDING", color: AMBER };
}

/** Phase 16.2 — label + color for the active approval mode (shown at the top of the Cockpit). */
export function approvalModeBadge(mode: string): Badge {
  if (mode === "auto") return { label: "AUTO-APPROVE", color: AMBER };
  if (mode === "hybrid") return { label: "HYBRID APPROVE", color: LIME };
  return { label: "HUMAN APPROVE", color: GREEN };
}

/** Human-facing blockers: blocked steps + pending approvals + a blocked/awaiting run. */
export function blockers(
  runStatus: AgentRunStatus,
  steps: PlanStep[],
  approvals: ApprovalRequest[],
): string[] {
  const out: string[] = [];
  if (runStatus === "blocked") out.push("Run is blocked");
  if (runStatus === "awaiting_user_input") out.push("Run is awaiting user input");
  if (runStatus === "awaiting_plan_approval") out.push("Plan is awaiting approval");
  for (const s of steps) {
    if (s.status === "blocked") out.push(`Step blocked: ${s.title}${s.summary ? ` — ${s.summary}` : ""}`);
  }
  const pend = pendingApprovals(approvals);
  if (pend.length) out.push(`${pend.length} tool approval${pend.length > 1 ? "s" : ""} pending`);
  return out;
}

/** Truncate long content for an inline preview. */
export function previewText(s: string | undefined | null, n = 400): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + ` …(+${s.length - n} chars)` : s;
}

/** True for an observe-only classification event (NOT enforced). */
export function isObserveOnlyEvent(e: AgentEvent): boolean {
  return e.type === "tool_observed" && (e.data as Record<string, unknown>)?.enforced === false;
}

/**
 * Enforcement label for a tool-related event. Observe-only events are NEVER labeled
 * ENFORCED — the runtime only enforces inside /api/runs.
 */
export function enforcementLabel(e: AgentEvent): "ENFORCED" | "OBSERVE-ONLY" {
  return isObserveOnlyEvent(e) ? "OBSERVE-ONLY" : "ENFORCED";
}

/**
 * Phase 7.2 — badges for the advisory plan preview. A preview is ALWAYS labeled PREVIEW +
 * NOT ENFORCED so the UI can never imply the agent is following or controlled by it.
 */
export function previewBadges(): Badge[] {
  return [
    { label: "PREVIEW", color: "#ffae42" },
    { label: "NOT ENFORCED", color: "#ff8844" },
  ];
}

/**
 * Phase 7.5.1: message shown after a managed plan is approved. Observed execution now EXISTS,
 * so this must NOT imply execution is a future phase.
 */
export const MANAGED_PLAN_APPROVED_MSG = "Plan approved — you can now start observed execution.";

// ── Phase 13 — cockpit navigation + unambiguous safety labels ──────────────────────────

/** Filter/search the run list by free-text + status + source. Pure. */
export function filterRuns<T extends { objective: string; persona: string; id: string; status: string; source?: string }>(
  runs: T[],
  opts: { query?: string; status?: string; source?: string },
): T[] {
  let r = runs;
  if (opts.status && opts.status !== "all") r = r.filter((x) => x.status === opts.status);
  if (opts.source && opts.source !== "all") r = r.filter((x) => (x.source ?? "api") === opts.source);
  const q = (opts.query ?? "").trim().toLowerCase();
  if (q) r = r.filter((x) => x.objective.toLowerCase().includes(q) || x.persona.toLowerCase().includes(q) || x.id.toLowerCase().includes(q));
  return r;
}

const TERMINAL_RUN_STATES = new Set(["completed", "failed", "cancelled"]);
export function isArchivedRun(run: { status: string }): boolean {
  return TERMINAL_RUN_STATES.has(run.status);
}

/**
 * The single source of truth for a run's enforcement label — impossible to confuse. Order matters:
 * an OR-gated run is ENFORCED; a managed Claude run is MANAGED but observe-only for tools; an
 * observe/preview chat run is NOT ENFORCED; a runtime-owned /api/runs run is ENFORCED.
 */
export function runModeLabel(run: { source?: string; mode?: string; providerKind?: string; metadata?: Record<string, unknown> }): { label: string; enforced: boolean; color: string } {
  const gate = run.metadata?.gateMode;
  if (gate === "enforce") return { label: "OR GATED · ENFORCED", enforced: true, color: "#2bd47f" };
  if (gate === "dry-run") return { label: "OR GATED · DRY RUN (not enforced)", enforced: false, color: "#ffae42" };
  if (run.source === "chat" && run.mode === "managed") {
    // 8.2: provider-aware — a managed OpenRouter/Codex run (no gating) is NOT a Claude run.
    const orLike = run.providerKind === "openrouter" || run.providerKind === "openai-codex" || run.providerKind === "gemini" || run.providerKind === "xai-grok";
    if (run.providerKind === "xai-grok") return { label: "MANAGED · GROK ACP OBSERVE-ONLY", enforced: false, color: "#3ad0c0" };
    return orLike
      ? { label: "MANAGED · OPENROUTER OBSERVE-ONLY", enforced: false, color: "#3ad0c0" }
      : { label: "MANAGED · CLAUDE OBSERVE-ONLY", enforced: false, color: "#3ad0c0" };
  }
  if (run.source === "chat") return { label: "CHAT · OBSERVE-ONLY", enforced: false, color: "#ffae42" };
  return { label: "RUNTIME API · ENFORCED", enforced: true, color: "#2bd47f" };
}

// ── Phase 8.1 — dry-run gate observations (NON-blocking; never an actionable approval) ──

/** True for a dry-run gate observation event (recorded what enforce WOULD do; never blocked). */
export function isDryRunGateEvent(e: AgentEvent): boolean {
  return e.type === "tool_observed" && (e.data as Record<string, unknown>)?.mode === "dry-run";
}

/**
 * Label for an observe-only / dry-run classification. A dry-run gate observation is shown as
 * "DRY RUN" (optionally "WOULD REQUIRE APPROVAL") — NEVER "ENFORCED", and it is never an
 * actionable pending approval (no ApprovalRequest is created for dry-run).
 */
export function observeEventLabel(e: AgentEvent): string {
  if (isDryRunGateEvent(e)) {
    const would = (e.data as Record<string, unknown>)?.wouldDecide;
    return would === "require_approval" ? "DRY RUN · WOULD REQUIRE APPROVAL · NOT ENFORCED" : "DRY RUN · NOT ENFORCED";
  }
  return "OBSERVE-ONLY · NOT ENFORCED";
}

/**
 * 8.2 — provider-aware one-line description of what tool enforcement actually applies to a
 * managed run, so the UI never says "Claude" for an OpenRouter/Codex run (or claims observe-only
 * when gating is enforcing).
 */
export function executionEnforcementNote(run: { providerKind?: string; metadata?: Record<string, unknown> }): string {
  const gate = run.metadata?.gateMode;
  const orLike = run.providerKind === "openrouter" || run.providerKind === "openai-codex" || run.providerKind === "gemini";
  if (gate === "enforce") return "OpenRouter/Codex tools are ENFORCED — denied or approval-gated by runtime policy.";
  if (gate === "dry-run") return "OpenRouter/Codex gating is in DRY RUN — decisions are recorded but tools are NOT blocked.";
  if (orLike) return "OpenRouter tools are OBSERVE-ONLY (gating off) — classified, not blocked.";
  if (run.providerKind === "xai-grok") return "Grok ACP tools are OBSERVE-ONLY — recorded in the Chillspwn runtime and governed by Grok's ACP permissions.";
  return "Claude tools are OBSERVE-ONLY — enforcement is impossible on the frozen claude -p path.";
}

/** A short relative-ish timestamp for the UI (HH:MM:SS from an ISO string). */
export function shortTime(iso: string | undefined): string {
  if (!iso) return "";
  const t = iso.indexOf("T");
  return t === -1 ? iso : iso.slice(t + 1, t + 9);
}
