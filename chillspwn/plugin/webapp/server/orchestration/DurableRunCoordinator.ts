import { randomUUID } from "node:crypto";
import type { SqliteDatabase } from "../db";
import { inImmediateTransaction } from "../db";
import { EventRepository } from "../events";
import {
  CircuitBreaker,
  RunSupervisor,
  allowedRunTransitions,
  checkBudget,
  classifyFailure,
  classifyInFlightAction,
  isTerminalRunState,
  type BudgetValues,
  type RunState,
  type SupervisedRun,
} from "../supervisor";
import { ActionRepository } from "./ActionRepository";
import { CheckpointRepository } from "./CheckpointRepository";
import { RunRepository } from "./RunRepository";
import {
  DurableOrchestrationError,
  type CompleteActionInput,
  type CompleteActionResult,
  type DurableAction,
  type DurableControlState,
  type DurableRun,
  type DurableTransitionResult,
  type ExecutionPort,
  type RunLeaseToken,
  type StartActionInput,
  type StartActionResult,
  type StartupRecoveryResult,
} from "./types";

export interface DurableRunCoordinatorOptions {
  readonly database: SqliteDatabase;
  readonly execution: ExecutionPort;
  readonly supervisor?: RunSupervisor;
  readonly now?: () => Date;
  readonly leaseTtlMs?: number;
}

function bumpedRun(run: SupervisedRun, now: string, reason: string): SupervisedRun {
  return {
    ...run,
    stateVersion: run.stateVersion + 1,
    stateReason: reason,
    updatedAt: now,
  };
}

function leaseDisposition(state: RunState): "keep" | "clear" {
  return state === "waiting_guided_decision" || state === "blocked" || isTerminalRunState(state)
    ? "clear"
    : "keep";
}

function startBudget(kind: StartActionInput["intent"]["kind"]): BudgetValues {
  switch (kind) {
    case "provider_turn": return { providerTurns: 1, concurrency: 1 };
    case "replan": return { replans: 1 };
    case "delegation": return { concurrency: 1 };
    case "manual": return {};
    default: return { toolCalls: 1, concurrency: 1 };
  }
}

function addBudget(left: BudgetValues, right: BudgetValues): BudgetValues {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  const output: Record<string, number> = {};
  for (const key of keys) {
    const value = (left as Record<string, number | undefined>)[key] ?? 0;
    const increment = (right as Record<string, number | undefined>)[key] ?? 0;
    output[key] = value + increment;
  }
  return output as BudgetValues;
}

function withoutWallClock(delta: BudgetValues): BudgetValues {
  const { wallClockMs: _ignored, ...rest } = delta;
  return rest;
}

function elapsedUsage(run: DurableRun, now: string): BudgetValues {
  const usage = { ...run.control.budget.usage };
  if (run.run.startedAt) {
    const started = Date.parse(run.run.startedAt);
    const current = Date.parse(now);
    if (Number.isFinite(started) && Number.isFinite(current)) {
      // Wall time is an absolute high-water mark, never an accumulation of
      // action latencies. This includes planning, recovery delays, and idle
      // provider/tool time without double counting overlapping work.
      usage.wallClockMs = Math.max(usage.wallClockMs ?? 0, current - started);
    }
  }
  return usage;
}

export class DurableRunCoordinator {
  private readonly runs: RunRepository;
  private readonly actions: ActionRepository;
  private readonly checkpoints: CheckpointRepository;
  private readonly events: EventRepository;
  private readonly supervisor: RunSupervisor;
  private readonly now: () => Date;
  private readonly leaseTtlMs: number;
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    private readonly database: SqliteDatabase,
    private readonly execution: ExecutionPort,
    options: Omit<DurableRunCoordinatorOptions, "database" | "execution"> = {},
  ) {
    this.runs = new RunRepository(database);
    this.actions = new ActionRepository(database);
    this.checkpoints = new CheckpointRepository(database, this.actions);
    this.events = new EventRepository(database);
    this.supervisor = options.supervisor ?? new RunSupervisor();
    this.now = options.now ?? (() => new Date());
    this.leaseTtlMs = options.leaseTtlMs ?? 30_000;
    if (!Number.isFinite(this.leaseTtlMs) || this.leaseTtlMs <= 0) {
      throw new Error("leaseTtlMs must be positive");
    }
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private load(runId: string): DurableRun {
    const run = this.runs.get(runId);
    return {
      ...run,
      control: this.checkpoints.restoreControl(runId, run.control),
    };
  }

  private signal(runId: string): AbortSignal {
    let controller = this.controllers.get(runId);
    if (!controller || controller.signal.aborted) {
      controller = new AbortController();
      this.controllers.set(runId, controller);
    }
    return controller.signal;
  }

  acquireRunLease(runId: string, ownerId: string, ttlMs = this.leaseTtlMs): RunLeaseToken {
    if (!ownerId.trim()) throw new DurableOrchestrationError("invalid_lease_owner", "Lease owner is required");
    return inImmediateTransaction(this.database, () =>
      this.runs.acquire(runId, ownerId.trim(), this.timestamp(), ttlMs));
  }

  heartbeatRunLease(token: RunLeaseToken, ttlMs = this.leaseTtlMs): RunLeaseToken {
    return inImmediateTransaction(this.database, () =>
      this.runs.heartbeat(token, this.timestamp(), ttlMs));
  }

  getRun(runId: string): DurableRun {
    return this.load(runId);
  }

  getLatestCheckpoint(runId: string) {
    return this.checkpoints.latest(runId);
  }

  /** Account a provider/planning turn and the current signed-run elapsed time. */
  accountUsage(input: {
    readonly lease: RunLeaseToken;
    readonly delta?: BudgetValues;
    readonly phase: string;
    readonly providerTurnId?: string;
  }): {
    readonly run: DurableRun;
    readonly allowed: boolean;
    readonly exhausted: readonly string[];
    readonly eventSequence: number;
    readonly checkpointId: string;
  } {
    const now = this.timestamp();
    return inImmediateTransaction(this.database, () => {
      const current = this.load(input.lease.runId);
      this.runs.assertLease(current, input.lease, now);
      const budget = checkBudget({
        limits: current.control.budget.limits,
        usage: elapsedUsage(current, now),
      }, withoutWallClock(input.delta ?? {}));
      const reason = budget.allowed
        ? `${input.phase} usage accounted from canonical runtime telemetry`
        : `Budget safe stop during ${input.phase}: ${budget.exhausted.join(", ")}`;
      const nextRun = budget.allowed
        ? bumpedRun(current.run, now, reason)
        : this.supervisor.transition(current.run, "blocked", { reason, now }).run;
      const control: DurableControlState = {
        ...current.control,
        budget: { limits: current.control.budget.limits, usage: budget.projected },
        ...(budget.allowed ? {} : { recovery: undefined }),
      };
      const persisted = this.runs.persistMutation({
        current,
        nextRun,
        control,
        now,
        lease: budget.allowed ? "keep" : "clear",
      });
      const event = this.events.append({
        missionId: persisted.run.missionId,
        runId: persisted.run.id,
        journey: persisted.run.journey,
        eventType: budget.allowed ? "run.budget_accounted" : "run.budget_exhausted",
        actorType: "system",
        summary: reason,
        payload: {
          phase: input.phase,
          providerTurnId: input.providerTurnId ?? null,
          exactDelta: withoutWallClock(input.delta ?? {}),
          wallClockMs: budget.projected.wallClockMs ?? 0,
          exhausted: [...budget.exhausted],
        },
      });
      const checkpoint = this.checkpoints.create({ run: persisted, eventSequence: event.sequence, now });
      return {
        run: persisted,
        allowed: budget.allowed,
        exhausted: budget.exhausted,
        eventSequence: event.sequence,
        checkpointId: checkpoint.id,
      };
    });
  }

  transitionRun(input: {
    readonly lease: RunLeaseToken;
    readonly to: RunState;
    readonly reason: string;
    readonly guidedDecisionId?: string;
  }): DurableTransitionResult {
    const now = this.timestamp();
    return inImmediateTransaction(this.database, () => {
      const current = this.load(input.lease.runId);
      this.runs.assertLease(current, input.lease, now);
      let contractConfirmed = false;
      if (current.run.journey === "autonomous" && input.to === "running") {
        const contract = this.runs.autonomousContract(current);
        contractConfirmed = Boolean(
          contract &&
          contract.status === "signed" &&
          contract.version === current.run.contractVersion,
        );
      }
      if (current.run.journey === "guided" && input.to === "waiting_guided_decision") {
        const decision = input.guidedDecisionId
          ? this.runs.guidedDecision(input.guidedDecisionId)
          : undefined;
        if (!decision || decision.runId !== current.run.id || decision.status !== "pending") {
          throw new DurableOrchestrationError(
            "guided_decision_not_pending",
            "Guided waiting state requires one real pending decision for this run",
          );
        }
      }
      const result = this.supervisor.transition(current.run, input.to, {
        reason: input.reason,
        now,
        contractConfirmed,
        guidedDecisionId: input.guidedDecisionId,
      });
      const persisted = this.runs.persistMutation({
        current,
        nextRun: result.run,
        control: current.control,
        now,
        lease: leaseDisposition(result.run.state),
      });
      const event = this.events.append({
        missionId: persisted.run.missionId,
        runId: persisted.run.id,
        journey: persisted.run.journey,
        eventType: "run.state_changed",
        actorType: "worker",
        actorId: input.lease.ownerId,
        summary: result.events[0]!.summary,
        payload: {
          from: current.run.state,
          to: persisted.run.state,
          reason: persisted.run.stateReason,
          stateVersion: persisted.run.stateVersion,
        },
      });
      const checkpoint = this.checkpoints.create({ run: persisted, eventSequence: event.sequence, now });
      return { run: persisted, eventSequence: event.sequence, checkpointId: checkpoint.id };
    });
  }

  async startAction(input: StartActionInput): Promise<StartActionResult> {
    const now = this.timestamp();
    const committed = inImmediateTransaction(this.database, () => {
      const current = this.load(input.lease.runId);
      this.runs.assertLease(current, input.lease, now);
      if (input.intent.runId !== current.run.id || input.intent.missionId !== current.run.missionId) {
        throw new DurableOrchestrationError("action_run_mismatch", "Action belongs to another run or mission");
      }
      if (input.intent.kind === "manual") {
        throw new DurableOrchestrationError(
          current.run.journey === "autonomous"
            ? "autonomous_manual_action_forbidden"
            : "guided_manual_action_requires_operator_result",
          current.run.journey === "autonomous"
            ? "Autonomous runs cannot depend on an operator-executed manual action"
            : "Manual Guided actions are completed only by an operator-supplied result",
        );
      }

      let workingRun = current.run;
      let transitionSummary: string | undefined;
      let guidedDecision = input.guidedDecisionId
        ? this.runs.guidedDecision(input.guidedDecisionId)
        : undefined;
      if (current.run.journey === "guided" && current.run.state === "waiting_guided_decision") {
        if (!guidedDecision || guidedDecision.status !== "authorized") {
          throw new DurableOrchestrationError("guided_decision_not_authorized", "The exact Guided decision is not approved");
        }
        const waitingRun = { ...current.run, pendingGuidedDecisionId: guidedDecision.id };
        const transition = this.supervisor.transition(waitingRun, "running", {
          reason: `Operator authorized exact Guided decision ${guidedDecision.id}`,
          now,
          guidedDecisionId: guidedDecision.id,
        });
        workingRun = transition.run;
        transitionSummary = transition.events[0]!.summary;
      }

      const authorization = this.supervisor.authorizeAction({
        run: workingRun,
        action: input.intent,
        now,
        autonomousContract:
          current.run.journey === "autonomous" ? this.runs.autonomousContract(current) : undefined,
        guidedDecision,
      });
      if (!authorization.allowed) {
        throw new DurableOrchestrationError(authorization.reason, authorization.humanMessage);
      }

      const delta = addBudget(startBudget(input.intent.kind), withoutWallClock(input.budgetDelta ?? {}));
      const budget = checkBudget({
        limits: current.control.budget.limits,
        usage: elapsedUsage(current, now),
      }, delta);
      if (!budget.allowed) {
        throw new DurableOrchestrationError(
          "budget_exhausted",
          `Action would exceed budget: ${budget.exhausted.join(", ")}`,
        );
      }
      const control: DurableControlState = {
        ...current.control,
        budget: { limits: current.control.budget.limits, usage: budget.projected },
        recovery: undefined,
      };
      if (workingRun.stateVersion === current.run.stateVersion) {
        workingRun = bumpedRun(workingRun, now, `Authorized action: ${input.intent.intentSummary}`);
      }
      const action = this.actions.create({
        intent: input.intent,
        fingerprint: authorization.actionFingerprint,
        guidedDecisionId: input.guidedDecisionId,
        contractId: current.contractId ?? undefined,
        now,
      });
      const persisted = this.runs.persistMutation({
        current,
        nextRun: workingRun,
        control,
        now,
        lease: "keep",
      });
      if (transitionSummary) {
        this.events.append({
          missionId: persisted.run.missionId,
          runId: persisted.run.id,
          journey: persisted.run.journey,
          eventType: "run.state_changed",
          actorType: "operator",
          summary: transitionSummary,
          payload: { from: current.run.state, to: "running", guidedDecisionId: input.guidedDecisionId ?? null },
        });
      }
      const event = this.events.append({
        missionId: action.missionId,
        runId: action.runId,
        journey: persisted.run.journey,
        eventType: "action.authorized",
        actorType: "worker",
        actorId: input.lease.ownerId,
        summary: `${action.intentSummary} was authorized and durably assigned for execution`,
        ...(action.contextPackId ? { contextPackId: action.contextPackId } : {}),
        payload: {
          actionId: action.id,
          actionFingerprint: action.fingerprint,
          actionType: action.actionType,
          target: action.target,
          contractId: action.contractId,
          guidedDecisionId: action.guidedDecisionId,
          contextPackId: action.contextPackId,
        },
      });
      const checkpoint = this.checkpoints.create({ run: persisted, eventSequence: event.sequence, now });
      if (!persisted.lease) throw new DurableOrchestrationError("lease_lost", "Action mutation unexpectedly released its run lease");
      return {
        action,
        lease: persisted.lease,
        eventSequence: event.sequence,
        checkpointId: checkpoint.id,
      };
    });

    try {
      await this.execution.dispatch(committed.action, this.signal(committed.action.runId));
      return committed;
    } catch (error) {
      await this.completeAction({
        lease: committed.lease,
        actionId: committed.action.id,
        success: false,
        resultSummary: "Execution boundary rejected the persisted action dispatch",
        before: this.load(committed.action.runId).control.progress,
        after: this.load(committed.action.runId).control.progress,
        failure: {
          source: "worker",
          code: "dispatch_failed",
          message: error instanceof Error ? error.message : "Dispatch failed",
        },
      }).catch(() => undefined);
      throw new DurableOrchestrationError("dispatch_failed", "Persisted action could not be dispatched");
    }
  }

  async completeAction(input: CompleteActionInput): Promise<CompleteActionResult> {
    const now = this.timestamp();
    return inImmediateTransaction(this.database, () => {
      const current = this.load(input.lease.runId);
      this.runs.assertLease(current, input.lease, now);
      const pendingAction = this.actions.get(input.actionId);
      if (pendingAction.runId !== current.run.id) {
        throw new DurableOrchestrationError("action_run_mismatch", "Action result belongs to another run");
      }
      const category = input.success
        ? undefined
        : input.failureCategory ?? classifyFailure(input.failure ?? { source: "unknown" });
      const evaluation = this.supervisor.evaluateCompletedAction({
        history: this.actions.observations(current.run.id),
        observation: {
          actionId: pendingAction.id,
          actionFingerprint: pendingAction.fingerprint,
          completedAt: now,
          ...(category ? { errorCategory: category } : {}),
          actionKind: pendingAction.kind,
        },
        before: input.before,
        after: input.after,
        budgetState: {
          limits: current.control.budget.limits,
          usage: elapsedUsage(current, now),
        },
        budgetDelta: withoutWallClock(input.budgetDelta ?? {}),
      });

      const usage = {
        ...evaluation.budget.projected,
        concurrency: Math.max(0, (evaluation.budget.projected.concurrency ?? 0) - 1),
      };
      const circuits = { ...current.control.circuits };
      if (input.circuitKey?.trim()) {
        const key = input.circuitKey.trim();
        const breaker = new CircuitBreaker({}, circuits[key]);
        circuits[key] = input.success
          ? breaker.recordSuccess()
          : breaker.recordFailure(
              Date.parse(now),
              category === "transient_network" ||
                category === "provider_unavailable" ||
                category === "mcp_unavailable" ||
                category === "timeout",
            );
      }

      let targetState: RunState = current.run.state === "recovering" && input.success
        ? "running"
        : current.run.state;
      let directive: CompleteActionResult["directive"] = "continue";
      let reason = evaluation.humanReason;
      let retryIncrement = 0;
      let recoveryState: DurableControlState["recovery"];
      if (!evaluation.budget.allowed) {
        targetState = "blocked";
        directive = "blocked";
        reason = `Budget safe stop: ${evaluation.budget.exhausted.join(", ")}`;
      } else if (evaluation.loops.length > 0) {
        targetState = "blocked";
        directive = "blocked";
        reason = `Loop safe stop: ${evaluation.loops[0]!.summary}`;
      } else if (!input.success) {
        const replanBudgetAvailable =
          current.control.replanCount <
          (current.control.budget.limits.replans ?? Number.POSITIVE_INFINITY);
        const inContract = current.run.journey === "autonomous"
          ? this.runs.autonomousActionRemainsInContract(current, pendingAction)
          : true;
        const materiallyNewReplanAvailable = evaluation.progress.dimensions.includes("evidence_added")
          || evaluation.progress.dimensions.includes("finding_strengthened")
          || evaluation.progress.dimensions.includes("entity_discovered")
          || evaluation.progress.dimensions.includes("dependency_resolved")
          || evaluation.progress.dimensions.includes("uncertainty_reduced");
        const recovery = this.supervisor.decideRecovery({
          journey: current.run.journey,
          category: category ?? "unknown",
          retriesUsed: current.control.retryCount,
          retrySafe:
            pendingAction.idempotent &&
            !pendingAction.destructive &&
            current.control.retryCount <
              (current.control.budget.limits.retries ?? Number.POSITIVE_INFINITY),
          inContract,
          materiallyNewReplanAvailable,
          replanBudgetAvailable,
          retryAfterMs: input.retryAfterMs,
          guidedRecommendation:
            "Prepare one materially different represented action, explain it, and wait for a new exact decision.",
        });
        if (current.run.journey === "autonomous" && recovery.recovery.kind === "retry") {
          targetState = "recovering";
          directive = "retry";
          retryIncrement = 1;
          reason = recovery.recovery.reason;
          recoveryState = {
            kind: "retry",
            failedActionId: pendingAction.id,
            notBefore: new Date(Date.parse(now) + recovery.recovery.delayMs).toISOString(),
            reason,
          };
        } else if (current.run.journey === "autonomous" && recovery.recovery.kind === "replan") {
          targetState = "recovering";
          directive = "replan";
          reason = recovery.recovery.reason;
          recoveryState = {
            kind: "replan",
            failedActionId: pendingAction.id,
            notBefore: now,
            reason,
          };
        } else if (current.run.journey === "guided") {
          if (recovery.recovery.kind === "waiting_guided_decision" && replanBudgetAvailable) {
            // A failed Guided action is never silently repeated. Keep the
            // fenced lease long enough for MissionRuntimeEngine to prepare a
            // materially different represented action and publish a new
            // exact decision. The run enters the user-wait state only after
            // that decision has been durably created.
            targetState = "recovering";
            directive = "recover";
            reason = `${pendingAction.intentSummary} failed (${category ?? "unknown"}). ${recovery.recovery.recommendation}`;
          } else {
            targetState = "blocked";
            directive = "blocked";
            reason = `Guided recovery blocked after ${category ?? "unknown"}: the bounded replan budget is exhausted, so no replacement decision was created.`;
          }
        } else if (recovery.recovery.kind === "safe_stop") {
          targetState = "blocked";
          directive = "blocked";
          reason = `Safe-stopped (${recovery.recovery.exceptionCode}): ${recovery.recovery.reason}`;
        } else {
          targetState = "failed";
          directive = "failed";
          reason = recovery.recovery.reason;
        }
      }

      const action = this.actions.complete({
        actionId: input.actionId,
        success: input.success,
        summary: input.resultSummary,
        category,
        progressSignature: evaluation.progress.afterSignature,
        now,
      });
      const control: DurableControlState = {
        budget: {
          limits: current.control.budget.limits,
          usage: retryIncrement > 0
            ? { ...usage, retries: (usage.retries ?? 0) + retryIncrement }
            : usage,
        },
        retryCount: current.control.retryCount + retryIncrement,
        replanCount: current.control.replanCount,
        circuits,
        progress: input.after,
        recovery: recoveryState,
      };
      let nextRun: SupervisedRun;
      let transitionSummary: string | undefined;
      if (targetState !== current.run.state) {
        const transition = this.supervisor.transition(current.run, targetState, { reason, now });
        nextRun = transition.run;
        transitionSummary = transition.events[0]!.summary;
      } else {
        nextRun = bumpedRun(current.run, now, reason);
      }
      const persisted = this.runs.persistMutation({
        current,
        nextRun,
        control,
        now,
        lease: directive === "retry" || directive === "replan"
          ? "clear"
          : leaseDisposition(nextRun.state),
      });
      if (transitionSummary) {
        this.events.append({
          missionId: persisted.run.missionId,
          runId: persisted.run.id,
          journey: persisted.run.journey,
          eventType: "run.state_changed",
          actorType: "system",
          summary: transitionSummary,
          payload: { from: current.run.state, to: persisted.run.state, reason },
        });
      }
      const event = this.events.append({
        missionId: action.missionId,
        runId: action.runId,
        journey: persisted.run.journey,
        eventType: "action.completed",
        actorType: "worker",
        actorId: input.lease.ownerId,
        summary: input.resultSummary,
        ...(action.contextPackId ? { contextPackId: action.contextPackId } : {}),
        payload: {
          actionId: action.id,
          actionFingerprint: action.fingerprint,
          actionKind: action.kind,
          meaningfulProgress: evaluation.progress.meaningful,
          progressDimensions: [...evaluation.progress.dimensions],
          progressSignatureAfter: evaluation.progress.afterSignature,
          completedAt: now,
          errorCategory: category ?? null,
          loopKinds: evaluation.loops.map((loop) => loop.kind),
          directive,
          contextPackId: action.contextPackId,
          retryNotBefore: recoveryState?.notBefore ?? null,
        },
      });
      const checkpoint = this.checkpoints.create({ run: persisted, eventSequence: event.sequence, now });
      return {
        action,
        run: persisted,
        directive,
        reason,
        loopKinds: evaluation.loops.map((loop) => loop.kind),
        eventSequence: event.sequence,
        checkpointId: checkpoint.id,
      };
    });
  }

  beginReplan(input: { lease: RunLeaseToken; reason: string }): DurableTransitionResult {
    const now = this.timestamp();
    return inImmediateTransaction(this.database, () => {
      const current = this.load(input.lease.runId);
      this.runs.assertLease(current, input.lease, now);
      if (current.run.state !== "recovering") {
        throw new DurableOrchestrationError("replan_requires_recovery", "A bounded replan starts only from recovery");
      }
      if (current.control.recovery?.kind === "retry") {
        throw new DurableOrchestrationError(
          "retry_delay_not_replan",
          "A persisted delayed retry cannot be bypassed by starting a replan",
        );
      }
      const budget = checkBudget(current.control.budget, { replans: 1 });
      if (!budget.allowed) throw new DurableOrchestrationError("replan_budget_exhausted", "Replan budget is exhausted");
      const transition = this.supervisor.transition(current.run, "planning", {
        reason: input.reason,
        now,
      });
      const control: DurableControlState = {
        ...current.control,
        budget: { limits: current.control.budget.limits, usage: budget.projected },
        replanCount: current.control.replanCount + 1,
        recovery: undefined,
      };
      const persisted = this.runs.persistMutation({ current, nextRun: transition.run, control, now, lease: "keep" });
      const event = this.events.append({
        missionId: persisted.run.missionId,
        runId: persisted.run.id,
        journey: persisted.run.journey,
        eventType: "run.replan_started",
        actorType: "worker",
        actorId: input.lease.ownerId,
        summary: input.reason,
        payload: { replanCount: control.replanCount, stateVersion: persisted.run.stateVersion },
      });
      const checkpoint = this.checkpoints.create({ run: persisted, eventSequence: event.sequence, now });
      return { run: persisted, eventSequence: event.sequence, checkpointId: checkpoint.id };
    });
  }

  async recoverOnStartup(workerId: string): Promise<StartupRecoveryResult[]> {
    const now = this.timestamp();
    const expired = this.runs.listExpiredNonterminal(now);
    const results: StartupRecoveryResult[] = [];
    for (const candidate of expired) {
      const prepared = inImmediateTransaction(this.database, () => {
        const current = this.load(candidate.run.id);
        if (!current.lease || current.lease.expiresAt > now) return undefined;
        const inFlight = this.actions.inFlight(current.run.id);
        if (current.run.state === "planning" && inFlight.length === 0) {
          // Planning ACP turns have no execution authority. If their fenced
          // owner disappears, close the durable provider records first, make
          // recovery visible, then release the lease so the normal scheduler
          // can reacquire and plan once. Never classify an action-bearing run
          // through this path.
          const interruptedTurns = this.database.prepare(`
            SELECT id, started_at FROM provider_turns
            WHERE run_id = ? AND status = 'started'
            ORDER BY started_at, id
          `).all(current.run.id) as Array<{ id: string; started_at: string }>;
          const closeTurn = this.database.prepare(`
            UPDATE provider_turns SET status = 'cancelled', error_category = 'process_crash',
              latency_ms = ?, ended_at = ?
            WHERE id = ? AND status = 'started'
          `);
          for (const turn of interruptedTurns) {
            const startedAt = Date.parse(turn.started_at);
            const latency = Number.isFinite(startedAt) ? Math.max(0, Date.parse(now) - startedAt) : 0;
            closeTurn.run(latency, now, turn.id);
          }
          const reason = interruptedTurns.length > 0
            ? "Expired planning lease recovered; interrupted provider work was closed before deterministic replanning"
            : "Expired planning lease recovered before deterministic replanning";
          const persisted = this.runs.persistMutation({
            current,
            nextRun: bumpedRun(current.run, now, reason),
            control: current.control,
            now,
            lease: "clear",
          });
          const event = this.events.append({
            missionId: persisted.run.missionId,
            runId: persisted.run.id,
            journey: persisted.run.journey,
            eventType: "run.recovery_started",
            actorType: "system",
            summary: reason,
            payload: {
              expiredLeaseOwner: current.lease.ownerId,
              interruptedProviderTurnIds: interruptedTurns.map((turn) => turn.id),
              classification: "restart_planning",
            },
          });
          this.checkpoints.create({
            run: persisted,
            eventSequence: event.sequence,
            now,
            inFlightClassification: "restart_planning",
          });
          return { kind: "planning" as const, persisted, reason };
        }
        const safe = inFlight.length > 0 && inFlight.every(
          (action) => classifyInFlightAction({
            idempotent: action.idempotent,
            destructive: action.destructive,
            completionKnown: false,
          }) === "resume_idempotently",
        );
        const canRecover = safe && (
          current.run.state === "running" ||
          current.run.state === "recovering" ||
          current.run.state === "blocked" ||
          current.run.state === "waiting_guided_decision"
        );
        const target: RunState = canRecover
          ? "recovering"
          : allowedRunTransitions(current.run.state, current.run.journey).includes("blocked")
            ? "blocked"
            : "failed";
        const reason = canRecover
          ? "Expired worker lease recovered; only safe idempotent in-flight work will resume"
          : "Expired worker lease requires review because in-flight completion cannot be repeated safely";
        const nextRun = target === current.run.state
          ? bumpedRun(current.run, now, reason)
          : this.supervisor.transition(current.run, target, { reason, now }).run;
        const expiresAt = new Date(Date.parse(now) + this.leaseTtlMs).toISOString();
        const persisted = this.runs.persistMutation({
          current,
          nextRun,
          control: current.control,
          now,
          lease: canRecover ? { ownerId: workerId, expiresAt, acquiredAt: now } : "clear",
        });
        const event = this.events.append({
          missionId: persisted.run.missionId,
          runId: persisted.run.id,
          journey: persisted.run.journey,
          eventType: canRecover ? "run.recovery_started" : "run.recovery_blocked",
          actorType: "system",
          summary: reason,
          payload: {
            expiredLeaseOwner: current.lease.ownerId,
            inFlightActionIds: inFlight.map((action) => action.id),
            classification: canRecover ? "resume_idempotently" : "review_required",
          },
        });
        this.checkpoints.create({
          run: persisted,
          eventSequence: event.sequence,
          now,
          inFlightClassification: canRecover ? "resume_idempotently" : "review_required",
        });
        return { kind: "actions" as const, persisted, inFlight, canRecover, reason };
      });
      if (!prepared) continue;
      if (prepared.kind === "planning") {
        results.push({
          runId: prepared.persisted.run.id,
          disposition: "restarted_planning",
          actionIds: [],
          reason: prepared.reason,
        });
        continue;
      }
      if (!prepared.canRecover || !prepared.persisted.lease) {
        results.push({
          runId: prepared.persisted.run.id,
          disposition: prepared.persisted.run.state === "failed" ? "failed_safely" : "blocked_for_review",
          actionIds: prepared.inFlight.map((action) => action.id),
          reason: prepared.reason,
        });
        continue;
      }
      try {
        for (const action of prepared.inFlight) {
          await this.execution.resume(action, this.signal(action.runId));
        }
        results.push({
          runId: prepared.persisted.run.id,
          disposition: "resumed_idempotently",
          actionIds: prepared.inFlight.map((action) => action.id),
          reason: prepared.reason,
        });
      } catch {
        await this.blockRecoveryFailure(prepared.persisted.lease);
        results.push({
          runId: prepared.persisted.run.id,
          disposition: "blocked_for_review",
          actionIds: prepared.inFlight.map((action) => action.id),
          reason: "The safe resume dispatch failed and the run was blocked without repeating again.",
        });
      }
    }
    return results;
  }

  private async blockRecoveryFailure(lease: RunLeaseToken): Promise<void> {
    const now = this.timestamp();
    inImmediateTransaction(this.database, () => {
      const current = this.load(lease.runId);
      this.runs.assertLease(current, lease, now);
      const reason = "Recovery dispatch failed; no further automatic repeat is permitted";
      const transition = this.supervisor.transition(current.run, "blocked", { reason, now });
      const persisted = this.runs.persistMutation({
        current,
        nextRun: transition.run,
        control: current.control,
        now,
        lease: "clear",
      });
      const event = this.events.append({
        missionId: persisted.run.missionId,
        runId: persisted.run.id,
        journey: persisted.run.journey,
        eventType: "run.recovery_blocked",
        actorType: "system",
        summary: reason,
      });
      this.checkpoints.create({ run: persisted, eventSequence: event.sequence, now });
    });
  }

  async cancelRun(input: { lease: RunLeaseToken; reason: string }): Promise<DurableTransitionResult> {
    const requestedAt = this.timestamp();
    const reservation = inImmediateTransaction(this.database, () => {
      const current = this.load(input.lease.runId);
      this.runs.assertLease(current, input.lease, requestedAt);
      const nextRun = bumpedRun(current.run, requestedAt, `Cancellation requested: ${input.reason}`);
      const persisted = this.runs.persistMutation({
        current,
        nextRun,
        control: current.control,
        now: requestedAt,
        lease: "keep",
      });
      const event = this.events.append({
        missionId: persisted.run.missionId,
        runId: persisted.run.id,
        journey: persisted.run.journey,
        eventType: "run.cancellation_requested",
        actorType: "operator",
        summary: `Cancellation requested: ${input.reason}`,
        payload: { requestId: randomUUID() },
      });
      this.checkpoints.create({ run: persisted, eventSequence: event.sequence, now: requestedAt });
      if (!persisted.lease) throw new DurableOrchestrationError("lease_lost", "Cancellation reservation lost its lease");
      return persisted.lease;
    });

    this.controllers.get(input.lease.runId)?.abort(input.reason);
    try {
      await this.execution.cancelRun(input.lease.runId, input.reason);
    } catch {
      const failedAt = this.timestamp();
      inImmediateTransaction(this.database, () => {
        const current = this.load(reservation.runId);
        this.runs.assertLease(current, reservation, failedAt);
        const target = allowedRunTransitions(current.run.state, current.run.journey).includes("blocked")
          ? "blocked"
          : "failed";
        const reason = "Execution cleanup did not confirm cancellation; run stopped for review";
        const transition = this.supervisor.transition(current.run, target, { reason, now: failedAt });
        const persisted = this.runs.persistMutation({
          current,
          nextRun: transition.run,
          control: current.control,
          now: failedAt,
          lease: "clear",
        });
        const event = this.events.append({
          missionId: persisted.run.missionId,
          runId: persisted.run.id,
          journey: persisted.run.journey,
          eventType: "run.cancellation_failed",
          actorType: "system",
          summary: reason,
        });
        this.checkpoints.create({ run: persisted, eventSequence: event.sequence, now: failedAt });
      });
      throw new DurableOrchestrationError("cancellation_cleanup_failed", "Execution port did not confirm child cleanup");
    }

    const completedAt = this.timestamp();
    return inImmediateTransaction(this.database, () => {
      const current = this.load(reservation.runId);
      this.runs.assertLease(current, reservation, completedAt);
      this.actions.cancelActive(current.run.id, input.reason, completedAt);
      const transition = this.supervisor.transition(current.run, "cancelled", {
        reason: input.reason,
        now: completedAt,
      });
      const persisted = this.runs.persistMutation({
        current,
        nextRun: transition.run,
        control: {
          ...current.control,
          budget: {
            limits: current.control.budget.limits,
            usage: { ...current.control.budget.usage, concurrency: 0 },
          },
        },
        now: completedAt,
        lease: "clear",
      });
      const event = this.events.append({
        missionId: persisted.run.missionId,
        runId: persisted.run.id,
        journey: persisted.run.journey,
        eventType: "run.cancelled",
        actorType: "operator",
        summary: `Run cancelled and child work stopped: ${input.reason}`,
        payload: { activeLeaseReleased: true },
      });
      const checkpoint = this.checkpoints.create({ run: persisted, eventSequence: event.sequence, now: completedAt });
      return { run: persisted, eventSequence: event.sequence, checkpointId: checkpoint.id };
    });
  }
}

export function createDurableRunCoordinator(options: DurableRunCoordinatorOptions): DurableRunCoordinator {
  return new DurableRunCoordinator(options.database, options.execution, options);
}
