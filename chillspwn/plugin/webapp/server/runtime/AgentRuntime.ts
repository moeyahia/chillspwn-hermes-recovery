/**
 * AgentRuntime (Phase 2) — the lifecycle engine.
 *
 * The runtime, NOT the model prompt, owns the lifecycle of an objective:
 *   created → planning → awaiting_plan_approval → executing → completed/failed/…
 *
 * Responsibilities in Phase 2:
 *   - own AgentRun status transitions (validated by the state machine);
 *   - validate model-proposed plans and create typed PlanSteps;
 *   - create + update board cards from steps (runtime-owned, not model-driven);
 *   - gate every tool call to a step (reject calls without a stepId / outside the
 *     step's allowedTools) using ToolPolicy;
 *   - record evidence against steps;
 *   - emit every meaningful action as an AgentEvent to the audit log.
 *
 * Explicitly OUT of scope for Phase 2 (and enforced here):
 *   - approval GATES for risky tools (Phase 3) — the gate CLASSIFIES and records, but
 *     does not run an approval workflow or execute tools;
 *   - treating a provider turn ending as the run completing — `recordProviderTurn`
 *     never changes run status. The run completes only via explicit runtime criteria.
 *
 * Pure orchestration over injected dependencies (store / events / board / policy), so
 * it is fully unit-testable with a MemoryBoardSink + a temp-dir store.
 */

import {
  createAgentRun,
  newId,
  nowIso,
  normalizeToolResult,
  type AgentEventData,
  type AgentRun,
  type AgentRunStatus,
  type ApprovalRequest,
  type CreateAgentRunInput,
  MAX_INLINE_OUTPUT,
  type EvidenceItem,
  type EvidenceKind,
  type PlanPreview,
  type PlanStep,
  type ToolCall,
  type ToolResult,
  type WorkerResult,
} from "./types";
import { assertTransition } from "./state";
import { validateWorkerResult } from "./WorkerContract";
import { AgentRunStore } from "./AgentRunStore";
import { EventLog } from "./EventLog";
import type { BoardSink } from "./BoardSink";
import {
  decideTool,
  classifyTool,
  type PolicyConfig,
  DEFAULT_POLICY_CONFIG,
  type ToolDecision,
} from "./ToolPolicy";
import { parseAndValidatePlan, materializePlanSteps } from "./Planner";
import { decideApproval, type ApprovalPolicyConfig } from "./ApprovalPolicy";
import {
  DEFAULT_MCP_APPROVAL_ATTESTATION_TTL_MS,
  MCP_APPROVAL_ATTESTATION_VERSION,
  hashMcpArguments,
  validateMcpApprovalAttestation,
  type LegacyToolApprovalAttestation,
  type McpApprovalVerificationRequest,
  type McpApprovalVerificationResult,
} from "../mcp/McpApprovalAttestation";

export interface AgentRuntimeDeps {
  store: AgentRunStore;
  events: EventLog;
  board: BoardSink;
  policy?: PolicyConfig;
  /** Phase 12: optional artifact store. When present, evidence content over the inline cap is
   * stored as a side-file artifact + the inline content becomes a short preview. */
  artifactStore?: { write(input: { runId: string; stepId?: string; evidenceId?: string; kind?: string; content: string; filename?: string }): { id: string; size: number } };
  /** Phase 16.2: dynamic approval-mode policy (operator-controlled). Absent ⇒ always human. */
  getApprovalPolicy?: () => ApprovalPolicyConfig;
  /** Phase 16.2: map a run to the acting specialist (for agent-scoped auto-approval). */
  agentForRun?: (run: AgentRun) => string | null;
}

/** Thrown for invalid lifecycle operations; REST layer maps to 400/409. */
export class RuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeError";
  }
}

export interface SubmitPlanResult {
  run: AgentRun;
  steps: PlanStep[];
}

export interface ToolRequestResult {
  decision: ToolDecision;
  toolCall: ToolCall;
  /** Phase 16.2 — true when a require_approval action was auto-approved by runtime policy. */
  autoApproved?: boolean;
}

export class AgentRuntime {
  private readonly store: AgentRunStore;
  private readonly events: EventLog;
  private readonly board: BoardSink;
  private readonly policy: PolicyConfig;
  private readonly artifactStore?: AgentRuntimeDeps["artifactStore"];
  private readonly getApprovalPolicy?: () => ApprovalPolicyConfig;
  private readonly agentForRun?: (run: AgentRun) => string | null;

  constructor(deps: AgentRuntimeDeps) {
    this.store = deps.store;
    this.events = deps.events;
    this.board = deps.board;
    this.policy = deps.policy ?? DEFAULT_POLICY_CONFIG;
    this.artifactStore = deps.artifactStore;
    this.getApprovalPolicy = deps.getApprovalPolicy;
    this.agentForRun = deps.agentForRun;
  }

  // ── run creation + planning ─────────────────────────────────────────────────

  createRun(input: CreateAgentRunInput): AgentRun {
    const run = createAgentRun(input);
    this.store.createRun(run);
    this.emit("run_created", run, { objective: run.objective, persona: run.persona });
    return run;
  }

  /**
   * Phase 7: create an OBSERVE-ONLY run attached to a live chat session. It starts
   * directly in `executing` (no plan/approval gate — the runtime does not drive chat) and
   * is tagged source="chat", mode="observe". It carries NO PlanSteps; the SessionObserver
   * records provider turns + observe-only tool classifications against it. The frozen chat
   * path is never touched by this.
   */
  createChatRun(input: CreateAgentRunInput): AgentRun {
    const base = createAgentRun(input);
    const run: AgentRun = { ...base, status: "executing", source: "chat", mode: "observe" };
    this.store.createRun(run);
    this.emit("run_created", run, {
      objective: run.objective, persona: run.persona, source: "chat", mode: "observe",
    });
    return run;
  }

  /**
   * Phase 7.4: create a RUNTIME-MANAGED chat run. Unlike createChatRun (observe-only), this
   * starts in `created` and goes through the FULL managed lifecycle (beginPlanning →
   * submitPlan → awaiting_plan_approval → …). source="chat", mode="managed". The runtime owns
   * the plan + approval gate; tool-execution enforcement is a LATER phase (and never for
   * claude -p). Creating the run does NOT execute anything.
   */
  createManagedChatRun(input: CreateAgentRunInput): AgentRun {
    const base = createAgentRun(input);
    const run: AgentRun = { ...base, source: "chat", mode: "managed" }; // status stays "created"
    this.store.createRun(run);
    this.emit("run_created", run, {
      objective: run.objective, persona: run.persona, source: "chat", mode: "managed",
    });
    return run;
  }

  /**
   * Finalize an observe-only chat run when its session ends. Safe + idempotent: only acts
   * on a run that is still `executing` (a chat run has no steps, so completeRun is legal).
   * Never throws into the caller.
   */
  finalizeChatRun(runId: string, note?: string): void {
    try {
      const run = this.store.getRun(runId);
      if (!run || run.status !== "executing") return;
      this.completeRun(runId, note ?? "Chat session ended (observe-only run).");
    } catch {
      /* finalization is best-effort */
    }
  }

  /**
   * Phase 7.2: attach an ADVISORY, NON-ENFORCED plan preview to an observe-only chat run.
   * Refuses any run that is not source="chat" + mode="observe" — a preview must never be
   * attached to a managed run. NEVER changes mode/status/stepIds; creates no PlanSteps, no
   * ToolCalls, no board cards, no approvals. Purely descriptive.
   */
  setPlanPreview(runId: string, preview: PlanPreview): AgentRun {
    const run = this.store.getRun(runId);
    if (!run) throw new RuntimeError(`run ${runId} not found`);
    if (run.source !== "chat" || run.mode !== "observe") {
      throw new RuntimeError("plan preview is only allowed for observe-only chat runs");
    }
    run.planPreview = preview;
    run.updatedAt = nowIso();
    this.store.saveRun(run);
    this.emit("plan_preview_generated", run, {
      stepCount: preview.steps.length,
      source: preview.source,
      riskLevel: preview.riskLevel,
      enforced: false,
    });
    return run;
  }

  getPlanPreview(runId: string): PlanPreview | null {
    return this.store.getRun(runId)?.planPreview ?? null;
  }

  clearPlanPreview(runId: string): AgentRun {
    const run = this.store.getRun(runId);
    if (!run) throw new RuntimeError(`run ${runId} not found`);
    if (run.planPreview) {
      delete run.planPreview;
      run.updatedAt = nowIso();
      this.store.saveRun(run);
      this.emit("plan_preview_cleared", run, {});
    }
    return run;
  }

  // ── Phase 7.5: observed-execution support (observe-only; no enforcement) ───────────────

  /** The currently-running PlanStep id for a run, or null. Used to map observed activity. */
  getActiveStepId(runId: string): string | null {
    const doc = this.store.getDoc(runId);
    return doc?.steps.find((s) => s.status === "running")?.id ?? null;
  }

  /**
   * Phase 7.5.1: if no step is running, start the FIRST pending step whose dependencies are
   * met (normal audited startStep transition) so observed activity has a step to attach to.
   * Returns the active step id, or null if nothing is startable. NEVER auto-completes.
   */
  startFirstPendingStep(runId: string): string | null {
    const existing = this.getActiveStepId(runId);
    if (existing) return existing;
    const doc = this.store.getDoc(runId);
    if (!doc) return null;
    const startable = doc.steps.find(
      (s) => s.status === "pending" &&
        s.dependencies.every((d) => doc.steps.find((x) => x.id === d)?.status === "completed"),
    );
    if (!startable) return null;
    try {
      this.startStep(runId, startable.id);
      return startable.id;
    } catch {
      return null;
    }
  }

  /** Mark that observed execution has been launched for a run (UI shows it as running). */
  markObservedExecution(runId: string): void {
    const run = this.store.getRun(runId);
    if (!run) return;
    run.metadata = { ...(run.metadata ?? {}), observedExecutionStartedAt: nowIso() };
    run.updatedAt = nowIso();
    this.store.saveRun(run);
  }

  /** Phase 8: record the OR/Codex gate mode on the run so the cockpit can show ENFORCED/DRY RUN. */
  markGateMode(runId: string, mode: "dry-run" | "enforce"): void {
    const run = this.store.getRun(runId);
    if (!run) return;
    run.metadata = { ...(run.metadata ?? {}), gateMode: mode };
    run.updatedAt = nowIso();
    this.store.saveRun(run);
  }

  /**
   * Phase 8.1 — DRY-RUN tool evaluation. Computes the policy/risk decision for a tool WITHOUT
   * creating a ToolCall or an ApprovalRequest, and records a NON-BLOCKING observation event
   * (`enforced:false`, `mode:"dry-run"`). This is what `OPENROUTER_GATE_MODE=dry-run` uses so the
   * cockpit shows "what enforce WOULD do" without ever producing an actionable pending approval
   * for a tool that already executed. Only side effect: one observation event.
   */
  evaluateToolDryRun(args: {
    runId: string;
    stepId: string | null;
    toolName: string;
    arguments?: Record<string, unknown>;
    command?: string;
  }): ToolDecision {
    const run = this.requireRun(args.runId);
    const doc = this.store.getDoc(args.runId)!;
    const step = args.stepId ? doc.steps.find((s) => s.id === args.stepId) ?? null : null;
    // Policy/risk decision only (no allowed-tools binding — same as the enforce gate). No ToolCall.
    const decision = decideTool(
      { toolName: args.toolName, stepId: step?.id ?? args.stepId ?? null, allowedTools: undefined, command: args.command },
      this.policy,
    );
    this.emit("tool_observed", run, {
      toolName: args.toolName,
      wouldDecide: decision.action,
      riskLevel: decision.riskLevel,
      enforced: false,
      mode: "dry-run",
      reason: decision.reason,
    }, step?.id ?? null);
    return decision;
  }

  /**
   * Record OBSERVE-ONLY evidence from an observed tool result (managed observed execution).
   * Best-effort: links to the run + (if it exists) the active step. NEVER creates an enforced
   * ToolCall and never changes run/step status. Content truncated to the inline limit.
   */
  recordObservedEvidence(args: { runId: string; sessionId: string; stepId: string | null; output: string }): void {
    try {
      if (!this.store.getRun(args.runId)) return;
      let stepId: string | null = null;
      if (args.stepId) {
        const doc = this.store.getDoc(args.runId);
        if (doc?.steps.some((s) => s.id === args.stepId)) stepId = args.stepId;
      }
      this.recordEvidence({
        runId: args.runId,
        stepId,
        kind: "command_output",
        label: "observed output (observe-only)",
        content: args.output.slice(0, MAX_INLINE_OUTPUT),
      });
    } catch {
      /* observe-only evidence is best-effort — never throw into the observer */
    }
  }

  beginPlanning(runId: string): AgentRun {
    return this.transition(runId, "planning", "run_status_changed");
  }

  /**
   * Validate a model-proposed plan, create PlanSteps, and create one board card per
   * step. Leaves the run in `awaiting_plan_approval` (Phase 2 lifecycle — distinct from
   * the Phase 3 tool-approval gates).
   */
  submitPlan(runId: string, rawPlan: unknown): SubmitPlanResult {
    const run = this.requireRun(runId);
    if (run.status !== "planning") {
      throw new RuntimeError(`submitPlan requires status 'planning', run is '${run.status}'`);
    }
    const validation = parseAndValidatePlan(rawPlan);
    if (!validation.ok) {
      this.emit("plan_rejected", run, { errors: validation.errors });
      throw new RuntimeError(`plan validation failed: ${validation.errors.join("; ")}`);
    }

    const steps = materializePlanSteps(runId, validation.plan);
    // Runtime-owned board cards — one per step, created automatically.
    for (const step of steps) {
      const cardId = this.board.createCard({
        agentRunId: runId,
        stepId: step.id,
        title: step.title,
        body: `${step.purpose}\n\nSuccess: ${step.successCriteria}`,
        assignee: step.assignedAgent || run.persona,
        status: step.status,
      });
      if (cardId) step.boardCardId = cardId;
    }
    this.store.setSteps(runId, steps);

    run.stepIds = steps.map((s) => s.id);
    assertTransition(run.status, "awaiting_plan_approval");
    run.status = "awaiting_plan_approval";
    run.updatedAt = nowIso();
    this.store.saveRun(run);

    this.emit("plan_generated", run, {
      summary: validation.plan.summary ?? "",
      stepCount: steps.length,
      stepIds: steps.map((s) => s.id),
    });
    return { run, steps };
  }

  approvePlan(runId: string): AgentRun {
    const run = this.requireRun(runId);
    if (run.status !== "awaiting_plan_approval") {
      throw new RuntimeError(`approvePlan requires 'awaiting_plan_approval', run is '${run.status}'`);
    }
    const updated = this.transition(runId, "executing", "plan_approved");
    return updated;
  }

  rejectPlan(runId: string, reason?: string): AgentRun {
    const run = this.requireRun(runId);
    if (run.status !== "awaiting_plan_approval") {
      throw new RuntimeError(`rejectPlan requires 'awaiting_plan_approval', run is '${run.status}'`);
    }
    return this.transition(runId, "planning", "plan_rejected", { reason: reason ?? "" });
  }

  // ── step execution ───────────────────────────────────────────────────────────

  startStep(runId: string, stepId: string): PlanStep {
    const run = this.requireRun(runId);
    if (run.status !== "executing") {
      throw new RuntimeError(`startStep requires run 'executing', run is '${run.status}'`);
    }
    const doc = this.store.getDoc(runId)!;
    const step = this.requireStep(doc.steps, stepId);
    if (step.status !== "pending") {
      throw new RuntimeError(`step ${stepId} is '${step.status}', expected 'pending'`);
    }
    // Dependencies must be completed first.
    const unmet = step.dependencies.filter((dep) => {
      const d = doc.steps.find((s) => s.id === dep);
      return !d || d.status !== "completed";
    });
    if (unmet.length) {
      throw new RuntimeError(`step ${stepId} has unmet dependencies: ${unmet.join(", ")}`);
    }
    const ts = nowIso();
    const updated = this.store.updateStep(runId, stepId, { status: "running", startedAt: ts })!;
    if (step.boardCardId) this.board.updateCard(step.boardCardId, { status: "running" });
    this.emit("step_started", run, { stepId, title: step.title }, stepId);
    return updated;
  }

  /**
   * Step-bound tool gate with full lifecycle enforcement (Phase 3.1). A tool call may
   * only be allowed / moved to awaiting_approval when ALL hold:
   *   - the AgentRun exists and is `executing`;
   *   - a stepId is provided and resolves to a real step of THIS run;
   *   - that PlanStep status is `running`;
   *   - the tool is in the step's allowedTools;
   *   - ToolPolicy allows or requires approval.
   * Any failure produces a recorded, audited rejection (deny) with a clear reason — it
   * never silently passes and never throws into the caller.
   */
  requestTool(args: {
    runId: string;
    stepId: string | null;
    toolName: string;
    arguments?: Record<string, unknown>;
    command?: string;
    /**
     * Phase 8: when false, skip the step's allowed-tools binding and gate on POLICY/RISK only
     * (used by the OpenRouter gate — the model's tool names don't match the plan's allowedTools).
     * The lifecycle + risk-policy gates still apply. Default true preserves managed /api/runs.
     */
    enforceAllowedTools?: boolean;
  }): ToolRequestResult {
    const run = this.requireRun(args.runId);
    const doc = this.store.getDoc(args.runId)!;
    const step = args.stepId ? doc.steps.find((s) => s.id === args.stepId) ?? null : null;

    // ── Lifecycle gates (Phase 3.1) — order matters for the clearest reason. ──
    if (run.status !== "executing") {
      return this.rejectTool(run, args, step ? step.id : null,
        `run is '${run.status}', tool calls require the run to be 'executing'`);
    }
    if (!args.stepId) {
      return this.rejectTool(run, args, null,
        "tool call is not bound to a plan step (stepId required)");
    }
    if (!step) {
      return this.rejectTool(run, args, null,
        `step not found in this run: ${args.stepId}`);
    }
    if (step.status !== "running") {
      return this.rejectTool(run, args, step.id,
        `step ${step.id} is '${step.status}', it must be 'running' to call tools`);
    }

    // ── Policy decision (step confirmed running). ──
    const decision = decideTool(
      {
        toolName: args.toolName,
        stepId: step.id,
        allowedTools: args.enforceAllowedTools === false ? undefined : step.allowedTools,
        command: args.command,
      },
      this.policy,
    );

    // Phase 16.2 — approval-mode policy: a `require_approval` action may be AUTO-approved by the
    // operator-configured runtime policy (never approves a DENY; denials never reach here).
    let autoApproval: { autoApprove: boolean; reason: string } | null = null;
    let approvalMode: "human" | "auto" | "hybrid" = "human";
    if (decision.action === "require_approval" && this.getApprovalPolicy) {
      const apCfg = this.getApprovalPolicy();
      approvalMode = apCfg.mode;
      const agentId = this.agentForRun ? this.agentForRun(run) : null;
      autoApproval = decideApproval({ toolName: args.toolName, riskLevel: decision.riskLevel, agentId }, apCfg);
    }
    const autoApproved = decision.action === "require_approval" && autoApproval?.autoApprove === true;

    const toolCall: ToolCall = {
      id: newId("tool"),
      agentRunId: args.runId,
      stepId: step.id,
      toolName: args.toolName,
      arguments: (args.arguments ?? {}) as ToolCall["arguments"],
      riskLevel: decision.riskLevel,
      status:
        decision.action === "deny"
          ? "rejected"
          : decision.action === "require_approval" && !autoApproved
            ? "awaiting_approval"
            : "approved",
      createdAt: nowIso(),
    };
    this.store.addToolCall(args.runId, toolCall);
    this.emit("tool_requested", run, {
      toolName: args.toolName, stepId: step.id, riskLevel: decision.riskLevel, action: decision.action,
    }, step.id);

    if (decision.action === "deny") {
      this.emit("tool_rejected", run, { toolName: args.toolName, reason: decision.reason }, step.id);
    } else if (decision.action === "allow") {
      this.emit("tool_approved", run, { toolName: args.toolName }, step.id);
    } else {
      // require_approval → create a persisted ApprovalRequest. Auto-granted by runtime policy, or
      // left pending for a human, per the approval mode.
      const approval: ApprovalRequest = {
        id: newId("apr"),
        agentRunId: args.runId,
        stepId: step.id,
        toolCallId: toolCall.id,
        toolName: args.toolName,
        riskLevel: decision.riskLevel,
        summary: `${args.toolName} (${decision.riskLevel}) requires approval: ${decision.reason}`,
        preview: args.command ? args.command.slice(0, 500) : undefined,
        status: autoApproved ? "approved" : "pending",
        createdAt: nowIso(),
        approvalMode,
        autoApproved,
        ...(autoApproved
          ? { resolvedAt: nowIso(), resolvedBy: "runtime:auto-policy", policyReason: autoApproval!.reason }
          : { policyReason: autoApproval?.reason }),
      };
      this.store.addApproval(args.runId, approval);
      this.store.updateToolCall(args.runId, toolCall.id, { approvalId: approval.id });
      toolCall.approvalId = approval.id;
      if (autoApproved) {
        this.emit("approval_auto_granted", run, {
          approvalId: approval.id, toolName: args.toolName, riskLevel: decision.riskLevel, reason: autoApproval!.reason, approvalMode,
        }, step.id);
      } else {
        this.emit("approval_requested", run, {
          approvalId: approval.id, toolName: args.toolName, riskLevel: decision.riskLevel, reason: decision.reason, approvalMode,
        }, step.id);
      }
    }

    return { decision, toolCall, autoApproved };
  }

  /** Record + audit a rejected tool call (lifecycle/binding violation) with a clear reason. */
  private rejectTool(
    run: AgentRun,
    args: { runId: string; toolName: string; arguments?: Record<string, unknown> },
    stepId: string | null,
    reason: string,
  ): ToolRequestResult {
    const riskLevel = classifyTool(args.toolName);
    const toolCall: ToolCall = {
      id: newId("tool"),
      agentRunId: args.runId,
      stepId,
      toolName: args.toolName,
      arguments: (args.arguments ?? {}) as ToolCall["arguments"],
      riskLevel,
      status: "rejected",
      createdAt: nowIso(),
    };
    this.store.addToolCall(args.runId, toolCall);
    this.emit("tool_requested", run, { toolName: args.toolName, stepId, riskLevel, action: "deny" }, stepId);
    this.emit("tool_rejected", run, { toolName: args.toolName, reason }, stepId);
    return { decision: { action: "deny", riskLevel, reason }, toolCall };
  }

  // ── approval workflow (Phase 3) ──────────────────────────────────────────────

  listApprovals(runId: string, onlyPending = false): ApprovalRequest[] {
    // Phase 3.1: a missing run is an error, not an empty list.
    const doc = this.store.getDoc(runId);
    if (!doc) throw new RuntimeError(`AgentRun not found: ${runId}`);
    return onlyPending ? doc.approvals.filter((a) => a.status === "pending") : doc.approvals;
  }

  getApproval(runId: string, approvalId: string): ApprovalRequest | null {
    return this.store.getApproval(runId, approvalId);
  }

  getToolCall(runId: string, toolCallId: string): ToolCall | null {
    return this.store.getToolCall(runId, toolCallId);
  }

  /**
   * Claim one exact, durably approved legacy MCP tool call before dispatch.
   * The claim is persisted together with the ToolCall and changes its status to
   * `executing`, so a second caller cannot mint another attestation.
   */
  claimApprovedMcpToolCall(input: {
    runId: string;
    stepId: string;
    toolCallId: string;
    specialistAgentId: string;
    mcpServer: string;
    toolName: string;
    arguments?: unknown;
    approvalTtlMs?: number;
  }): LegacyToolApprovalAttestation {
    const run = this.requireRun(input.runId);
    const toolCall = this.store.getToolCall(input.runId, input.toolCallId);
    if (!toolCall) throw new RuntimeError(`tool call not found in this run: ${input.toolCallId}`);
    if (toolCall.status !== "approved") {
      throw new RuntimeError(`tool call ${input.toolCallId} is '${toolCall.status}', not available for an approval claim`);
    }
    if (!toolCall.stepId || toolCall.stepId !== input.stepId) {
      throw new RuntimeError("approved tool call does not match the requested run step");
    }
    if (toolCall.toolName !== input.toolName || !toolCall.approvalId) {
      throw new RuntimeError("approved tool call does not match an approval-gated tool binding");
    }
    const approval = this.store.getApproval(input.runId, toolCall.approvalId);
    if (
      !approval ||
      approval.status !== "approved" ||
      approval.toolCallId !== toolCall.id ||
      approval.stepId !== toolCall.stepId ||
      approval.toolName !== toolCall.toolName ||
      !approval.resolvedAt ||
      !approval.resolvedBy
    ) {
      throw new RuntimeError("the durable approval is missing, unresolved, or no longer matches this tool call");
    }
    const stored = toolCall.arguments as Record<string, unknown>;
    const {
      __mcpServer: storedServer,
      __specialist: storedSpecialist,
      ...storedArguments
    } = stored;
    if (storedServer !== input.mcpServer || storedSpecialist !== input.specialistAgentId) {
      throw new RuntimeError("approved tool call does not match the requested specialist MCP binding");
    }
    const argumentsHash = hashMcpArguments(input.arguments);
    if (hashMcpArguments(storedArguments) !== argumentsHash) {
      throw new RuntimeError("approved tool call arguments changed after approval");
    }
    const ttlMs = input.approvalTtlMs ?? DEFAULT_MCP_APPROVAL_ATTESTATION_TTL_MS;
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 15 * 60_000) {
      throw new RuntimeError("MCP approval attestation TTL is outside the supported bounds");
    }
    const nowMs = Date.now();
    const resolvedAtMs = Date.parse(approval.resolvedAt);
    const expiresAtMs = resolvedAtMs + ttlMs;
    if (!Number.isFinite(resolvedAtMs) || resolvedAtMs > nowMs || expiresAtMs <= nowMs) {
      throw new RuntimeError("the durable MCP approval has expired");
    }
    const attestation: LegacyToolApprovalAttestation = {
      version: MCP_APPROVAL_ATTESTATION_VERSION,
      kind: "legacy_tool_approval",
      claimId: newId("mcpclaim"),
      runId: input.runId,
      stepId: input.stepId,
      toolCallId: toolCall.id,
      approvalId: approval.id,
      specialistAgentId: input.specialistAgentId,
      mcpServer: input.mcpServer,
      toolName: input.toolName,
      argumentsHash,
      actorId: approval.resolvedBy,
      resolvedAt: approval.resolvedAt,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
    const claimed = this.store.claimApprovedMcpToolCall(input.runId, input.toolCallId, attestation);
    if (!claimed) throw new RuntimeError("the approved MCP tool call was already claimed or changed concurrently");
    this.emit("security_event", run, {
      event: "mcp_approval_claimed",
      claimId: attestation.claimId,
      toolCallId: attestation.toolCallId,
      approvalId: attestation.approvalId,
      specialistAgentId: attestation.specialistAgentId,
      mcpServer: attestation.mcpServer,
      toolName: attestation.toolName,
      argumentsHash: attestation.argumentsHash,
      expiresAt: attestation.expiresAt,
    }, input.stepId);
    return attestation;
  }

  /**
   * Durable verifier for the bridge's `legacy_tool_approval` kind. A production
   * bridge composes this with the canonical Guided verifier and routes by kind.
   */
  verifyAndConsumeMcpApprovalAttestation(
    request: McpApprovalVerificationRequest,
  ): McpApprovalVerificationResult {
    const { attestation, binding, verifiedAt } = request;
    if (attestation.kind !== "legacy_tool_approval") {
      return { approved: false, reason: "the legacy runtime cannot verify this approval kind" };
    }
    const invalid = validateMcpApprovalAttestation(attestation, binding, verifiedAt);
    if (invalid) return { approved: false, reason: invalid };
    const run = this.store.getRun(attestation.runId);
    const toolCall = this.store.getToolCall(attestation.runId, attestation.toolCallId);
    const approval = this.store.getApproval(attestation.runId, attestation.approvalId);
    const claim = toolCall?.mcpApprovalClaim;
    if (
      !run ||
      !toolCall ||
      toolCall.status !== "executing" ||
      toolCall.stepId !== attestation.stepId ||
      toolCall.toolName !== attestation.toolName ||
      toolCall.approvalId !== attestation.approvalId ||
      !claim ||
      claim.consumedAt ||
      claim.claimId !== attestation.claimId ||
      claim.argumentsHash !== attestation.argumentsHash ||
      claim.specialistAgentId !== attestation.specialistAgentId ||
      claim.mcpServer !== attestation.mcpServer ||
      claim.toolName !== attestation.toolName ||
      claim.actorId !== attestation.actorId ||
      claim.resolvedAt !== attestation.resolvedAt ||
      claim.expiresAt !== attestation.expiresAt ||
      !approval ||
      approval.status !== "approved" ||
      approval.toolCallId !== toolCall.id ||
      approval.stepId !== toolCall.stepId ||
      approval.toolName !== toolCall.toolName ||
      approval.resolvedAt !== attestation.resolvedAt ||
      approval.resolvedBy !== attestation.actorId
    ) {
      return { approved: false, reason: "the durable approval claim is missing, changed, or already consumed" };
    }
    const consumed = this.store.consumeMcpApprovalClaim(
      attestation.runId,
      attestation.toolCallId,
      attestation.claimId,
      verifiedAt,
    );
    if (!consumed) return { approved: false, reason: "the durable approval claim was already consumed" };
    this.emit("security_event", run, {
      event: "mcp_approval_consumed",
      claimId: attestation.claimId,
      toolCallId: attestation.toolCallId,
      approvalId: attestation.approvalId,
      argumentsHash: attestation.argumentsHash,
    }, attestation.stepId);
    return { approved: true };
  }

  /**
   * Resolve a pending approval. On approve, the gated ToolCall becomes 'approved'
   * (executable); on reject it becomes 'rejected'. Every outcome is audited.
   */
  resolveApproval(
    runId: string,
    approvalId: string,
    action: "approve" | "reject",
    opts: { resolvedBy?: string; reason?: string } = {},
  ): { approval: ApprovalRequest; toolCall: ToolCall | null } {
    const run = this.requireRun(runId);
    const approval = this.store.getApproval(runId, approvalId);
    if (!approval) throw new RuntimeError(`approval not found: ${approvalId}`);
    if (approval.status !== "pending") {
      throw new RuntimeError(`approval ${approvalId} is already '${approval.status}'`);
    }
    const ts = nowIso();
    const updated = this.store.updateApproval(runId, approvalId, {
      status: action === "approve" ? "approved" : "rejected",
      resolvedAt: ts,
      resolvedBy: opts.resolvedBy,
      rejectionReason: action === "reject" ? (opts.reason ?? "") : undefined,
    })!;
    this.store.updateToolCall(runId, approval.toolCallId, {
      status: action === "approve" ? "approved" : "rejected",
      resolvedAt: ts,
    });
    const toolCall = this.store.getToolCall(runId, approval.toolCallId);
    this.emit("approval_resolved", run, { approvalId, action, resolvedBy: opts.resolvedBy ?? "" }, approval.stepId);
    this.emit(action === "approve" ? "tool_approved" : "tool_rejected",
      run, { toolName: approval.toolName, approvalId }, approval.stepId);
    return { approval: updated, toolCall };
  }

  /**
   * 8.3 — expire a gated tool call whose approval TIMED OUT (the OpenRouter gate stopped waiting).
   * Marks the ApprovalRequest `expired` and the ToolCall `rejected`, emits an audit event, and so
   * removes it from the pending-approval queue (cockpit no longer shows "action required").
   * Idempotent + safe: a tool call already in a terminal state is a no-op.
   */
  expireToolCall(runId: string, toolCallId: string, reason?: string): { toolCall: ToolCall | null; approvalId: string | null } {
    const run = this.requireRun(runId);
    const tc = this.store.getToolCall(runId, toolCallId);
    if (!tc) throw new RuntimeError(`tool call not found in this run: ${toolCallId}`);
    if (tc.status === "rejected" || tc.status === "succeeded" || tc.status === "failed") {
      return { toolCall: tc, approvalId: tc.approvalId ?? null }; // already terminal — no-op
    }
    const ts = nowIso();
    this.store.updateToolCall(runId, toolCallId, { status: "rejected", resolvedAt: ts });
    const approvalId: string | null = tc.approvalId ?? null;
    if (tc.approvalId) {
      const approval = this.store.getApproval(runId, tc.approvalId);
      if (approval && approval.status === "pending") {
        this.store.updateApproval(runId, tc.approvalId, { status: "expired", resolvedAt: ts, resolvedBy: "timeout" });
      }
    }
    this.emit("approval_expired", run, { toolCallId, approvalId, toolName: tc.toolName, reason: reason ?? "gate approval timed out" }, tc.stepId);
    return { toolCall: this.store.getToolCall(runId, toolCallId), approvalId };
  }

  /**
   * Record the normalized result of a tool call (the provider executed it elsewhere).
   * Phase 3 enforces that the tool call was APPROVED first — a result cannot be recorded
   * for a denied or still-awaiting-approval call. Optionally creates an EvidenceItem from
   * the output, linking ToolResult ↔ ToolCall ↔ PlanStep ↔ EvidenceItem ↔ board card.
   */
  recordToolResult(
    runId: string,
    toolCallId: string,
    raw: Partial<ToolResult> & { success: boolean },
    opts: { createEvidence?: boolean; evidenceKind?: EvidenceKind; evidenceLabel?: string } = {},
  ): ToolResult {
    const run = this.requireRun(runId);
    // getToolCall is scoped to THIS run's doc, so a null result also covers
    // "tool call does not belong to this run".
    const tc = this.store.getToolCall(runId, toolCallId);
    if (!tc) throw new RuntimeError(`tool call not found in this run: ${toolCallId}`);
    if (tc.status !== "approved" && tc.status !== "executing") {
      throw new RuntimeError(
        `cannot record result: tool call ${toolCallId} is '${tc.status}', not approved`,
      );
    }
    // Phase 3.1: the related step must still exist and must not be terminal. Late results
    // for a completed/failed/skipped step are rejected (no documented reason to accept
    // them — the step's outcome is already recorded).
    if (tc.stepId) {
      const step = this.store.getStep(runId, tc.stepId);
      if (!step) throw new RuntimeError(`cannot record result: related step ${tc.stepId} no longer exists`);
      if (step.status === "completed" || step.status === "failed" || step.status === "skipped") {
        throw new RuntimeError(
          `cannot record result: related step ${tc.stepId} is terminal ('${step.status}') — late result rejected`,
        );
      }
    }
    const result = normalizeToolResult(raw);

    if (opts.createEvidence) {
      const ev = this.recordEvidence({
        runId,
        stepId: tc.stepId,
        kind: opts.evidenceKind ?? (result.success ? "command_output" : "finding"),
        label: opts.evidenceLabel ?? `${tc.toolName} result`,
        content: result.output ? result.output.slice(0, 8000) : undefined,
        sourceToolName: tc.toolName,
        sourceToolCallId: tc.id,
      });
      result.evidenceRefs = [...(result.evidenceRefs ?? []), ev.id];
    }

    this.store.updateToolCall(runId, toolCallId, {
      status: result.success ? "succeeded" : "failed",
      resolvedAt: nowIso(),
      result,
    });
    this.emit("tool_result", run, { toolCallId, success: result.success, evidenceRefs: result.evidenceRefs ?? [] }, tc.stepId);
    return result;
  }

  // ── observe-only (Phase 3): classify a tool call we do NOT execute or gate ────

  /**
   * Classify a tool call observed elsewhere (e.g. the frozen live chat path) WITHOUT
   * enforcing anything. Records what the policy WOULD have decided, marked enforced=false.
   * Never throws, never blocks, never mutates run state — it does not even require a run.
   * This is the seam a future SessionObserver feeds; it gives the cockpit visibility
   * without creating a false sense of protection.
   */
  observeToolCall(args: {
    sessionId?: string | null;
    runId?: string | null;
    stepId?: string | null;
    toolName: string;
    command?: string;
  }): { wouldDecide: "allow" | "deny" | "require_approval"; riskLevel: string; reason: string; enforced: false } {
    // Relax step-binding for observation — we're classifying someone else's call.
    const observePolicy = { ...this.policy, requireStepBinding: false };
    const decision = decideTool(
      { toolName: args.toolName, stepId: args.stepId ?? null, command: args.command },
      observePolicy,
    );
    this.events.append({
      type: "tool_observed",
      agentRunId: args.runId ?? null,
      sessionId: args.sessionId ?? null,
      stepId: args.stepId ?? null,
      data: {
        toolName: args.toolName,
        wouldDecide: decision.action,
        riskLevel: decision.riskLevel,
        reason: decision.reason,
        enforced: false,
      },
    });
    return { wouldDecide: decision.action, riskLevel: decision.riskLevel, reason: decision.reason, enforced: false };
  }

  recordEvidence(args: {
    runId: string;
    stepId: string | null;
    kind: EvidenceKind;
    label: string;
    content?: string;
    sourceToolName?: string;
    sourceToolCallId?: string;
  }): EvidenceItem {
    const run = this.requireRun(args.runId);
    // Phase 3.1: if a stepId is given it MUST resolve to a step of this run (getStep is
    // run-scoped, so a null result also covers "step belongs to another run").
    let step: PlanStep | null = null;
    if (args.stepId) {
      step = this.store.getStep(args.runId, args.stepId);
      if (!step) throw new RuntimeError(`cannot record evidence: step not found in this run: ${args.stepId}`);
    }
    const evId = newId("ev");
    // Phase 12: large content → side-file artifact + short inline preview (keeps run JSON small).
    let content = args.content;
    let artifactId: string | undefined;
    if (this.artifactStore && typeof content === "string" && content.length > MAX_INLINE_OUTPUT) {
      try {
        const art = this.artifactStore.write({ runId: args.runId, stepId: args.stepId ?? undefined, evidenceId: evId, kind: args.kind, content, filename: `${args.label}.txt` });
        artifactId = art.id;
        content = content.slice(0, 2000) + `\n… [truncated — full ${content.length} bytes in artifact ${art.id}]`;
      } catch { /* fall back to inline (truncated) content */ content = content.slice(0, MAX_INLINE_OUTPUT); }
    }
    const ev: EvidenceItem = {
      id: evId,
      agentRunId: args.runId,
      stepId: args.stepId ?? null,
      kind: args.kind,
      label: args.label,
      content,
      artifactId,
      sourceToolName: args.sourceToolName,
      sourceToolCallId: args.sourceToolCallId,
      createdAt: nowIso(),
    };
    this.store.addEvidence(args.runId, ev);

    if (step) {
      const refs = [...step.evidenceRefs, ev.id];
      this.store.updateStep(args.runId, step.id, { evidenceRefs: refs });
      if (step.boardCardId) this.board.updateCard(step.boardCardId, { evidenceRefs: refs });
    }
    this.emit("evidence_stored", run, { evidenceId: ev.id, kind: ev.kind, label: ev.label }, args.stepId ?? null);
    return ev;
  }

  completeStep(runId: string, stepId: string, summary: string): PlanStep {
    const step = this.transitionStep(runId, stepId, "completed", { summary });
    if (step.boardCardId) this.board.updateCard(step.boardCardId, { status: "completed", summary });
    this.emit("step_completed", this.requireRun(runId), { stepId, summary }, stepId);
    return step;
  }

  failStep(runId: string, stepId: string, reason: string): PlanStep {
    const step = this.transitionStep(runId, stepId, "failed", { summary: reason });
    if (step.boardCardId) this.board.updateCard(step.boardCardId, { status: "failed", summary: reason });
    this.emit("step_failed", this.requireRun(runId), { stepId, reason }, stepId);
    return step;
  }

  blockStep(runId: string, stepId: string, reason: string): PlanStep {
    const step = this.transitionStep(runId, stepId, "blocked", { summary: reason });
    if (step.boardCardId) this.board.updateCard(step.boardCardId, { status: "blocked" });
    this.emit("step_blocked", this.requireRun(runId), { stepId, reason }, stepId);
    return step;
  }

  // ── delegated worker results (Phase 4) ──────────────────────────────────────

  /**
   * Validate + store a structured delegated-worker result, linking it to a step. Any
   * EvidenceItems the worker returned are folded into the run's evidence (and the step /
   * board card). Throws on an invalid contract. This is callable now via REST; wiring the
   * live board-card / orchestrator workers to RETURN this shape is the documented future
   * integration point (not done in Phase 4).
   */
  recordWorkerResult(runId: string, stepId: string | null, raw: unknown): {
    result: WorkerResult;
    evidenceIds: string[];
  } {
    const run = this.requireRun(runId);
    if (stepId) {
      const step = this.store.getStep(runId, stepId);
      if (!step) throw new RuntimeError(`worker result: step not found in this run: ${stepId}`);
    }
    const v = validateWorkerResult(raw);
    if (!v.ok) throw new RuntimeError(`invalid worker result: ${v.errors.join("; ")}`);

    // Fold worker-reported evidence into the run (gives it proper provenance + linkage).
    const evidenceIds: string[] = [];
    for (const e of v.result.evidence) {
      const ev = this.recordEvidence({
        runId,
        stepId,
        kind: (e.kind as EvidenceKind) ?? "finding",
        label: e.label,
        content: e.content,
        sourceToolName: e.sourceToolName,
      });
      evidenceIds.push(ev.id);
    }
    // Store the result together with the generated run-owned evidence ids (Phase 4.1).
    const stored: WorkerResult = { ...v.result, evidence: v.result.evidence };
    this.store.addWorkerResult(runId, { stepId, result: stored, evidenceIds, recordedAt: nowIso() });

    this.emit("worker_result_recorded", run, {
      stepId, status: v.result.status, confidence: v.result.confidence,
      evidenceIds, assumptions: v.result.assumptions.length, recommendedNextSteps: v.result.recommendedNextSteps.length,
    }, stepId);
    return { result: v.result, evidenceIds };
  }

  // ── provider turns vs run completion (kept strictly distinct) ────────────────

  /**
   * Record that a PROVIDER turn ended. This NEVER changes the AgentRun status — a run
   * spans many provider turns, and only explicit runtime criteria (completeRun) end it.
   * Phase 1.1 split provider_turn_* from run_completed/run_failed; this enforces it.
   */
  recordProviderTurn(runId: string, kind: "completed" | "failed", detail?: Record<string, unknown>): void {
    const run = this.requireRun(runId);
    this.events.append({
      type: kind === "completed" ? "provider_turn_completed" : "provider_turn_failed",
      agentRunId: runId,
      sessionId: run.sessionId,
      data: (detail ?? {}) as unknown as AgentEventData,
    });
    // Intentionally NO status change.
  }

  // ── run termination (explicit criteria only) ────────────────────────────────

  /** Complete the run. Requires every step to be in a terminal state (done/failed/skipped). */
  completeRun(runId: string, finalReport: string): AgentRun {
    const run = this.requireRun(runId);
    const doc = this.store.getDoc(runId)!;
    const unfinished = doc.steps.filter(
      (s) => s.status !== "completed" && s.status !== "failed" && s.status !== "skipped",
    );
    if (unfinished.length) {
      throw new RuntimeError(
        `completeRun blocked: ${unfinished.length} step(s) not terminal (${unfinished.map((s) => s.id).join(", ")})`,
      );
    }
    assertTransition(run.status, "completed");
    run.status = "completed";
    run.finalReport = finalReport;
    run.endedAt = nowIso();
    run.endReason = "completed";
    run.updatedAt = run.endedAt;
    this.store.saveRun(run);
    this.emit("run_completed", run, { finalReport });
    return run;
  }

  failRun(runId: string, reason: string): AgentRun {
    const updated = this.transition(runId, "failed", "run_failed", { reason });
    const run = this.store.getRun(runId)!;
    run.endReason = reason;
    run.endedAt = nowIso();
    this.store.saveRun(run);
    return updated;
  }

  cancelRun(runId: string): AgentRun {
    return this.transition(runId, "cancelled", "run_status_changed", { reason: "cancelled" });
  }

  // ── reads ────────────────────────────────────────────────────────────────────

  getRun(runId: string): AgentRun | null {
    return this.store.getRun(runId);
  }
  getDoc(runId: string) {
    return this.store.getDoc(runId);
  }
  listRuns(): AgentRun[] {
    return this.store.listRuns();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private transition(
    runId: string,
    to: AgentRunStatus,
    eventType: Parameters<EventLog["append"]>[0]["type"],
    extra: Record<string, unknown> = {},
  ): AgentRun {
    const run = this.requireRun(runId);
    assertTransition(run.status, to);
    const from = run.status;
    run.status = to;
    run.updatedAt = nowIso();
    this.store.saveRun(run);
    this.emit(eventType, run, { from, to, ...extra });
    return run;
  }

  private transitionStep(
    runId: string,
    stepId: string,
    to: PlanStep["status"],
    patch: Partial<PlanStep> = {},
  ): PlanStep {
    this.requireRun(runId);
    const step = this.store.getStep(runId, stepId);
    if (!step) throw new RuntimeError(`step not found: ${stepId}`);
    if (step.status !== "running") {
      throw new RuntimeError(`step ${stepId} is '${step.status}', must be 'running' to ${to}`);
    }
    return this.store.updateStep(runId, stepId, { status: to, endedAt: nowIso(), ...patch })!;
  }

  private requireRun(runId: string): AgentRun {
    const run = this.store.getRun(runId);
    if (!run) throw new RuntimeError(`AgentRun not found: ${runId}`);
    return run;
  }

  private requireStep(steps: PlanStep[], stepId: string): PlanStep {
    const step = steps.find((s) => s.id === stepId);
    if (!step) throw new RuntimeError(`step not found: ${stepId}`);
    return step;
  }

  private emit(
    type: Parameters<EventLog["append"]>[0]["type"],
    run: AgentRun,
    data: Record<string, unknown>,
    stepId: string | null = null,
  ): void {
    this.events.append({
      type,
      agentRunId: run.id,
      sessionId: run.sessionId,
      stepId,
      data: data as unknown as AgentEventData,
    });
  }
}
