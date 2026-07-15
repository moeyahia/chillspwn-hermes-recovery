import { randomUUID } from "node:crypto";
import type { SqliteDatabase } from "../db";
import { inImmediateTransaction } from "../db";
import {
  ActionRepository,
  CheckpointRepository,
  DurableOrchestrationError,
  DurableRunCoordinator,
  type DurableAction,
  type RunLeaseToken,
} from "../orchestration";
import { RunRepository } from "../orchestration";
import { canonicalJson } from "../orchestration/serialization";
import { RunLearningService } from "../learning";
import {
  classifyFailure,
  fingerprintAction,
  isTerminalRunState,
  transitionRun as transitionSupervisedRun,
  type FailureCategory,
  type ProgressSnapshot,
  type RunState,
} from "../supervisor";
import { RuntimeRepository } from "./RuntimeRepository";
import type {
  ExecutionResult,
  ExecutionResultReceipt,
  ExecutionResultSink,
  GuidedDecisionSkipResult,
  MissionCompletionEvaluation,
  MissionCompletionPortResult,
  MissionPlanDraft,
  MissionPlanPortResult,
  MissionRuntimeOptions,
  ProviderUsageReport,
  RuntimeActionContext,
  RuntimeLifecycleResult,
} from "./types";
import { CommandRuntimeError } from "./types";
import { validateExecutionResultSummary, validateMissionPlanDraft, validateReason } from "./validation";

interface HeartbeatLease {
  token(): Promise<RunLeaseToken>;
  stop(): Promise<RunLeaseToken>;
}

function planResult(value: MissionPlanDraft | MissionPlanPortResult): MissionPlanPortResult {
  return "plan" in value ? value : { plan: value, usage: value.providerUsage };
}

function completionResult(
  value: MissionCompletionEvaluation | MissionCompletionPortResult,
): MissionCompletionPortResult {
  return "evaluation" in value ? value : { evaluation: value, usage: value.providerUsage };
}

function asRuntimeError(error: unknown): CommandRuntimeError {
  if (error instanceof CommandRuntimeError) return error;
  if (error instanceof DurableOrchestrationError) {
    return new CommandRuntimeError(409, error.code, error.message, {
      humanMessage: error.message,
      category: error.code.includes("contract") || error.code.includes("decision")
        ? "policy_denied"
        : "runtime",
    });
  }
  const message = error instanceof Error ? error.message : "";
  const category = classifyFailure({
    code: error instanceof Error ? error.name : undefined,
    message,
    source: /grok|provider|acp|oauth/i.test(message) ? "provider" : "unknown",
  });
  const explanations: Record<FailureCategory, { humanMessage: string; remediation: string }> = {
    transient_network: {
      humanMessage: "The planning provider lost its network connection before it could produce a durable result.",
      remediation: "Restore network connectivity, then resume from the last checkpoint.",
    },
    rate_limit: {
      humanMessage: "The planning provider is rate-limited and no result was committed.",
      remediation: "Wait for the provider retry window, then resume the run.",
    },
    provider_unavailable: {
      humanMessage: "The planning provider or its enforced ACP boundary is unavailable.",
      remediation: "Check provider health and the Grok ACP boundary attestation before retrying.",
    },
    mcp_unavailable: {
      humanMessage: "A required MCP capability is unavailable.",
      remediation: "Restore the reviewed MCP server and rerun readiness before resuming.",
    },
    timeout: {
      humanMessage: "The planning operation exceeded its bounded timeout without committing a result.",
      remediation: "Check provider latency and resume only when the dependency is healthy.",
    },
    worker_lost: {
      humanMessage: "The assigned worker heartbeat expired before the operation completed.",
      remediation: "Inspect the last checkpoint and reassign or resume the bounded step.",
    },
    process_crash: {
      humanMessage: "The isolated planning process exited before completing.",
      remediation: "Check the provider process health and resume from the last checkpoint.",
    },
    invalid_input: {
      humanMessage: "The planning provider returned data that did not satisfy the mission contract.",
      remediation: "Inspect the validation event and amend the plan input before retrying.",
    },
    deterministic_tool_error: {
      humanMessage: "The represented tool action failed deterministically.",
      remediation: "Change the action or its validated parameters before retrying.",
    },
    authorization_denied: {
      humanMessage: "Execution stopped because authorization could not be verified.",
      remediation: "Review and confirm the exact authorized scope before creating a new run.",
    },
    policy_denied: {
      humanMessage: "Execution stopped because the requested operation is outside enforced policy.",
      remediation: "Choose an in-policy alternative or create a reviewed contract amendment.",
    },
    authentication_missing: {
      humanMessage: "The planning provider has no valid refreshable OAuth authentication state.",
      remediation: "Authenticate Grok for the service account and verify the protected OAuth file ownership and mode.",
    },
    dependency_missing: {
      humanMessage: "A required planning dependency is missing or does not satisfy the trusted-file boundary.",
      remediation: "Restore the root-controlled Grok binary and required boundary assets, then rerun readiness.",
    },
    scope_conflict: {
      humanMessage: "The requested operation conflicts with the authorized mission scope.",
      remediation: "Use an in-scope alternative; do not expand scope implicitly.",
    },
    evidence_insufficient: {
      humanMessage: "The run does not have enough verified evidence to support the requested conclusion.",
      remediation: "Collect one bounded evidence item or finish with an explicit inconclusive outcome.",
    },
    operator_rejection: {
      humanMessage: "The represented Guided action was rejected by the operator.",
      remediation: "Explain a materially different in-scope alternative and wait for a new decision.",
    },
    unknown: {
      humanMessage: "The runtime stopped safely because an unclassified planning failure occurred.",
      remediation: "Use the correlated provider turn and runtime event to diagnose the dependency before retrying.",
    },
  };
  const explanation = explanations[category];
  return new CommandRuntimeError(500, `mission_runtime_${category}`, "Mission runtime operation failed", {
    humanMessage: explanation.humanMessage,
    category,
    remediation: explanation.remediation,
  });
}

export class MissionRuntimeEngine implements ExecutionResultSink {
  readonly repository: RuntimeRepository;
  readonly coordinator: DurableRunCoordinator;
  readonly learning: RunLearningService;
  private readonly database: SqliteDatabase;
  private readonly workerId: string;
  private readonly scanIntervalMs: number;
  private readonly leaseTtlMs: number;
  private readonly decisionTtlMs: number;
  private readonly maxPlanSteps: number;
  private readonly now: () => Date;
  private readonly processing = new Map<string, Promise<void>>();
  private readonly actionContexts = new Map<string, RuntimeActionContext>();
  private readonly controllers = new Map<string, AbortController>();
  private scanTimer?: ReturnType<typeof setInterval>;
  private stopping = false;
  private unbindResultSink?: () => void;

  constructor(private readonly options: MissionRuntimeOptions) {
    this.database = options.database;
    this.now = options.now ?? (() => new Date());
    this.repository = new RuntimeRepository(options.database);
    this.learning = new RunLearningService(options.database, {
      clock: this.now,
      events: this.repository.events,
    });
    this.workerId = options.workerId?.trim() || `command-runtime-${randomUUID()}`;
    this.scanIntervalMs = options.scanIntervalMs ?? 500;
    this.leaseTtlMs = options.leaseTtlMs ?? 30_000;
    this.decisionTtlMs = options.decisionTtlMs ?? 24 * 60 * 60 * 1_000;
    this.maxPlanSteps = options.maxPlanSteps ?? 32;
    if (this.scanIntervalMs < 50 || this.leaseTtlMs < 500 || this.decisionTtlMs < 1_000) {
      throw new RangeError("Runtime scan, lease, or decision timing is below its safe minimum");
    }
    this.coordinator = new DurableRunCoordinator(options.database, options.execution, {
      now: this.now,
      leaseTtlMs: this.leaseTtlMs,
    });
    const unbind = options.execution.bindResultSink?.(this);
    if (typeof unbind === "function") this.unbindResultSink = unbind;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private controller(runId: string): AbortController {
    let controller = this.controllers.get(runId);
    if (!controller || controller.signal.aborted) {
      controller = new AbortController();
      this.controllers.set(runId, controller);
    }
    return controller;
  }

  private heartbeat(initial: RunLeaseToken): HeartbeatLease {
    let lease = initial;
    let stopped = false;
    let chain = Promise.resolve();
    const renew = () => {
      if (stopped) return;
      chain = chain.then(() => {
        if (!stopped) lease = this.coordinator.heartbeatRunLease(lease, this.leaseTtlMs);
      });
    };
    const timer = setInterval(renew, Math.max(250, Math.floor(this.leaseTtlMs / 3)));
    return {
      token: async () => { await chain; return lease; },
      stop: async () => {
        stopped = true;
        clearInterval(timer);
        await chain;
        return lease;
      },
    };
  }

  private accountProviderUsage(
    lease: RunLeaseToken,
    usage: ProviderUsageReport | undefined,
    phase: string,
  ): RunLeaseToken {
    const durable = this.coordinator.getRun(lease.runId);
    const tokenLimit = durable.control.budget.limits.providerTokens ?? 0;
    const costLimit = durable.control.budget.limits.estimatedCost ?? 0;
    if (tokenLimit > 0 && usage?.exactTokenUsage !== true) {
      throw new CommandRuntimeError(409, "exact_token_usage_unavailable", "Provider did not report exact token usage", {
        humanMessage: `Safe-stopped during ${phase}: the signed token budget cannot be enforced because this provider turn did not report exact usage.`,
        category: "dependency_missing",
        remediation: "Use an enforcing provider path with exact token telemetry or remove the finite token budget through a reviewed contract amendment.",
      });
    }
    if (costLimit > 0 && usage?.exactCostUsage !== true) {
      throw new CommandRuntimeError(409, "exact_cost_usage_unavailable", "Provider did not report exact cost usage", {
        humanMessage: `Safe-stopped during ${phase}: the signed cost budget cannot be enforced because this provider turn did not report exact cost telemetry.`,
        category: "dependency_missing",
        remediation: "Use an enforcing provider path with exact cost telemetry or remove the finite cost budget through a reviewed contract amendment.",
      });
    }
    const accounted = this.coordinator.accountUsage({
      lease,
      phase,
      ...(usage ? {
        delta: {
          providerTurns: usage?.providerTurns ?? 1,
          ...(usage.exactTokenUsage && usage.providerTokens !== undefined
            ? { providerTokens: usage.providerTokens }
            : {}),
          ...(usage.exactCostUsage && usage.estimatedCost !== undefined
            ? { estimatedCost: usage.estimatedCost }
            : {}),
        },
      } : {}),
      ...(usage?.providerTurnId ? { providerTurnId: usage.providerTurnId } : {}),
    });
    if (!accounted.allowed || !accounted.run.lease) {
      throw new CommandRuntimeError(409, "run_budget_exhausted", "Signed run budget was exhausted", {
        humanMessage: `Safe-stopped during ${phase}: ${accounted.exhausted.join(", ")} budget exhausted.`,
        category: "policy_denied",
      });
    }
    return accounted.run.lease;
  }

  async start(): Promise<RuntimeLifecycleResult> {
    if (this.scanTimer) return { recoveredRuns: 0, scheduledRuns: 0 };
    this.stopping = false;
    const recovered = await this.recover();
    // Recovery must classify every expired lease before the scheduler can
    // reclaim planning work. In particular, this closes an interrupted ACP
    // provider turn and checkpoints run.recovery_started before a fresh
    // planning lease is acquired.
    const scheduledRuns = await this.scanOnce();
    this.scanTimer = setInterval(() => {
      void this.scanOnce().catch(() => undefined);
    }, this.scanIntervalMs);
    return { recoveredRuns: recovered, scheduledRuns };
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.scanTimer) clearInterval(this.scanTimer);
    this.scanTimer = undefined;
    for (const controller of this.controllers.values()) controller.abort("Command OS runtime stopped");
    await Promise.allSettled([...this.processing.values()]);
    // Active actions are owned by the execution port, not by the planning
    // promises above. Confirm child cleanup before unbinding the result sink;
    // leave their durable action/lease records nonterminal so startup recovery
    // can classify them instead of pretending shutdown completed the work.
    const activeRunIds = [...new Set(
      [...this.actionContexts.values()].map((context) => context.action.runId),
    )];
    await Promise.allSettled(activeRunIds.map((runId) =>
      this.options.execution.cancelRun(runId, "Command OS runtime is shutting down")));
    for (const context of this.actionContexts.values()) {
      if (context.heartbeat) clearInterval(context.heartbeat);
    }
    this.actionContexts.clear();
    this.unbindResultSink?.();
    this.unbindResultSink = undefined;
  }

  /** Recover expired in-flight work through the coordinator's idempotency classifier. */
  async recover(): Promise<number> {
    const results = await this.coordinator.recoverOnStartup(this.workerId);
    const actions = new ActionRepository(this.database);
    for (const result of results) {
      if (result.disposition !== "resumed_idempotently") continue;
      const durable = this.coordinator.getRun(result.runId);
      if (!durable.lease) continue;
      for (const actionId of result.actionIds) {
        const action = actions.get(actionId);
        const context: RuntimeActionContext = {
          action,
          lease: durable.lease,
          before: durable.control.progress,
          completing: false,
        };
        this.actionContexts.set(actionId, context);
        this.actionHeartbeat(context);
      }
    }
    return results.length;
  }

  async scanOnce(): Promise<number> {
    if (this.stopping) return 0;
    const candidates = this.repository.listRunnableRuns(this.timestamp());
    let scheduled = 0;
    for (const runId of candidates) {
      if (this.processing.has(runId)) continue;
      const work = this.processRun(runId)
        .catch(() => undefined)
        .finally(() => this.processing.delete(runId));
      this.processing.set(runId, work);
      scheduled += 1;
    }
    return scheduled;
  }

  async processRunNow(runId: string): Promise<void> {
    const existing = this.processing.get(runId);
    if (existing) return existing;
    const work = this.processRun(runId).finally(() => this.processing.delete(runId));
    this.processing.set(runId, work);
    return work;
  }

  private async processRun(runId: string): Promise<void> {
    let planningRun = this.repository.getPlanningRun(runId);
    if (planningRun.state !== "planning" && planningRun.state !== "recovering") return;
    const mission = this.repository.getMission(planningRun.missionId);
    const guidedRecovery = planningRun.journey === "guided"
      ? this.repository.latestGuidedRecovery(runId)
      : null;
    const durableAtStart = this.coordinator.getRun(runId);
    const recovery = durableAtStart.control.recovery;
    if (
      planningRun.journey === "autonomous" && planningRun.state === "recovering" &&
      recovery?.kind === "retry" && Date.parse(recovery.notBefore) > Date.parse(this.timestamp())
    ) return;
    let lease = durableAtStart.lease?.ownerId === this.workerId
      ? durableAtStart.lease
      : this.coordinator.acquireRunLease(runId, this.workerId, this.leaseTtlMs);
    if (planningRun.journey === "autonomous" && planningRun.state === "recovering" && recovery?.kind === "retry") {
      try {
        const accounted = this.coordinator.accountUsage({ lease, phase: "delayed retry readiness" });
        if (!accounted.allowed || !accounted.run.lease) {
          throw new CommandRuntimeError(409, "run_budget_exhausted", "Signed run budget was exhausted during recovery", {
            humanMessage: `Safe-stopped before retry: ${accounted.exhausted.join(", ")} budget exhausted.`,
            category: "policy_denied",
          });
        }
        const running = this.coordinator.transitionRun({
          lease: accounted.run.lease,
          to: "running",
          reason: `Bounded retry delay elapsed for ${recovery.failedActionId}; re-authorizing the unchanged in-contract action`,
        });
        if (!running.run.lease) throw new CommandRuntimeError(500, "retry_lease_lost", "Retry lost its run lease");
        const failed = new ActionRepository(this.database).get(recovery.failedActionId);
        await this.startRepresentedAction(this.repository.getStepIntent(failed.stepId), running.run.lease);
        return;
      } catch (error) {
        const runtimeError = asRuntimeError(error);
        const latest = this.coordinator.getRun(runId);
        const stopLease = latest.lease?.ownerId === this.workerId ? latest.lease : lease;
        await this.safeStopPlanning(runId, stopLease, runtimeError);
        throw runtimeError;
      }
    }
    if (planningRun.journey === "autonomous" && planningRun.state === "recovering" && recovery?.kind === "replan") {
      try {
        const accounted = this.coordinator.accountUsage({ lease, phase: "bounded replan readiness" });
        if (!accounted.allowed || !accounted.run.lease) {
          throw new CommandRuntimeError(409, "run_budget_exhausted", "Signed run budget was exhausted before replanning", {
            humanMessage: `Safe-stopped before replan: ${accounted.exhausted.join(", ")} budget exhausted.`,
            category: "policy_denied",
          });
        }
        const failed = new ActionRepository(this.database).get(recovery.failedActionId);
        const bounded = this.coordinator.beginReplan({
          lease: accounted.run.lease,
          reason: `${recovery.reason} Failed action: ${failed.intentSummary}`,
        });
        if (!bounded.run.lease) throw new CommandRuntimeError(500, "replan_lease_lost", "Autonomous replan lost its run lease");
        lease = bounded.run.lease;
        planningRun = this.repository.getPlanningRun(runId);
      } catch (error) {
        const runtimeError = asRuntimeError(error);
        const latest = this.coordinator.getRun(runId);
        const stopLease = latest.lease?.ownerId === this.workerId ? latest.lease : lease;
        await this.safeStopPlanning(runId, stopLease, runtimeError);
        throw runtimeError;
      }
    }
    if (planningRun.journey === "guided" && planningRun.state === "recovering" && guidedRecovery) {
      try {
        const bounded = this.coordinator.beginReplan({
          lease,
          reason: `Bounded Guided recovery planning after ${guidedRecovery.errorCategory}; the failed action will not be repeated`,
        });
        if (!bounded.run.lease) {
          throw new CommandRuntimeError(500, "guided_recovery_lease_lost", "Guided recovery lost its run lease");
        }
        lease = bounded.run.lease;
      } catch (error) {
        const runtimeError = asRuntimeError(error);
        await this.safeStopPlanning(runId, lease, runtimeError);
        throw runtimeError;
      }
    }
    const heartbeat = this.heartbeat(lease);
    let heartbeatStopped = false;
    const signal = this.controller(runId).signal;
    try {
      if (mission.authorizationStatus !== "verified") {
        throw new CommandRuntimeError(409, "authorization_not_verified", "Mission authorization is not verified", {
          humanMessage: "Execution stopped because the mission authorization is not currently valid.",
          category: "authorization_denied",
        });
      }
      const planned = planResult(await this.options.planner.plan({
          mission,
          run: planningRun,
          ...(guidedRecovery ? {
            rejectionReason: `The represented action "${guidedRecovery.attemptedActionSummary}" failed with ${guidedRecovery.errorCategory}: ${guidedRecovery.failureSummary}. Propose one materially different in-scope action; do not repeat the failed parameters.`,
          } : planningRun.state === "recovering" ? { rejectionReason: planningRun.stateReason } : {}),
        }, signal));
      const draft = validateMissionPlanDraft(
        planned.plan,
        this.maxPlanSteps,
        planningRun.journey,
      );
      lease = await heartbeat.stop();
      heartbeatStopped = true;
      lease = this.accountProviderUsage(lease, planned.usage, "mission planning");
      const committed = inImmediateTransaction(this.database, () => {
        const plan = this.repository.persistPlanRecords({
          mission,
          run: planningRun,
          lease,
          plan: draft,
          now: this.timestamp(),
          decisionTtlMs: this.decisionTtlMs,
          ...(guidedRecovery ? { guidedRecovery } : {}),
        });
        if (planningRun.journey === "guided") {
          this.database.prepare(`
            UPDATE plan_steps SET status = 'waiting_guided_decision', updated_at = ? WHERE id = ?
          `).run(this.timestamp(), plan.firstStepId);
        }
        let transition = this.coordinator.transitionRun({
          lease,
          to: "running",
          reason: planningRun.journey === "autonomous"
            ? "Confirmed Autonomous plan activated; executing without routine operator input"
            : "Guided plan activated so the first represented decision can be published",
        });
        if (planningRun.journey === "guided") {
          if (!plan.guidedDecisionId || !transition.run.lease) {
            throw new CommandRuntimeError(500, "guided_decision_missing", "Guided planning did not produce a durable decision");
          }
          transition = this.coordinator.transitionRun({
            lease: transition.run.lease,
            to: "waiting_guided_decision",
            reason: "The first Guided step is explained and awaits one exact operator decision",
            guidedDecisionId: plan.guidedDecisionId,
          });
        }
        return { plan, transition };
      });
      if (planningRun.journey === "autonomous") {
        const runLease = committed.transition.run.lease;
        if (!runLease) throw new CommandRuntimeError(500, "runtime_lease_lost", "Autonomous launch lost its lease");
        await this.startRepresentedAction(committed.plan.firstIntent, runLease);
      }
    } catch (error) {
      if (!heartbeatStopped) lease = await heartbeat.stop().catch(() => lease);
      const runtimeError = asRuntimeError(error);
      await this.safeStopPlanning(runId, lease, runtimeError);
      throw runtimeError;
    }
  }

  private async safeStopPlanning(runId: string, lease: RunLeaseToken, error: CommandRuntimeError): Promise<void> {
    try {
      const current = this.coordinator.getRun(runId);
      if (isTerminalRunState(current.run.state) || current.run.state === "blocked") return;
      const transition = this.coordinator.transitionRun({
        lease,
        to: "blocked",
        reason: error.options.humanMessage ?? error.message,
      });
      this.repository.events.append({
        missionId: transition.run.run.missionId,
        runId,
        journey: transition.run.run.journey,
        eventType: transition.run.run.journey === "autonomous"
          ? "run.autonomous_safe_stopped"
          : "run.guided_blocked",
        actorType: "system",
        summary: error.options.humanMessage ?? error.message,
        payload: {
          code: error.code,
          category: error.options.category ?? "runtime",
          ...(error.code === "invalid_plan" && error.options.details
            && typeof error.options.details === "object" && !Array.isArray(error.options.details)
            && typeof error.options.details.validationField === "string"
            && typeof error.options.details.validationRule === "string"
            ? {
                validationField: error.options.details.validationField,
                validationRule: error.options.details.validationRule,
              }
            : {}),
        },
      });
    } catch {
      // A newer fenced owner won the race; never overwrite it with stale planning output.
    }
  }

  private actionHeartbeat(context: RuntimeActionContext): void {
    if (context.heartbeat) clearInterval(context.heartbeat);
    context.heartbeat = setInterval(() => {
      if (context.completing) return;
      try {
        context.lease = this.coordinator.heartbeatRunLease(context.lease, this.leaseTtlMs);
      } catch {
        if (context.heartbeat) clearInterval(context.heartbeat);
      }
    }, Math.max(250, Math.floor(this.leaseTtlMs / 3)));
  }

  private async startRepresentedAction(
    intent: Parameters<DurableRunCoordinator["startAction"]>[0]["intent"],
    lease: RunLeaseToken,
    guidedDecisionId?: string,
  ): Promise<DurableAction> {
    const now = this.timestamp();
    this.repository.transaction(() => this.repository.markStepRunning(intent.stepId, now));
    try {
      const before = this.coordinator.getRun(intent.runId).control.progress;
      const started = await this.coordinator.startAction({
        lease,
        intent,
        ...(guidedDecisionId ? { guidedDecisionId } : {}),
      });
      const row = this.database.prepare("SELECT status FROM actions WHERE id = ?")
        .get(started.action.id) as { status: string } | undefined;
      if (row?.status === "running") {
        const context: RuntimeActionContext = {
          action: started.action,
          lease: started.lease,
          before,
          completing: false,
        };
        this.actionContexts.set(started.action.id, context);
        this.actionHeartbeat(context);
      }
      return started.action;
    } catch (error) {
      const runtimeError = asRuntimeError(error);
      if (
        runtimeError.code === "autonomous_action_not_allowed" ||
        runtimeError.code === "autonomous_target_not_allowed" ||
        runtimeError.code === "autonomous_contract_not_signed" ||
        runtimeError.code === "autonomous_manual_action_forbidden"
      ) {
        await this.safeStopPlanning(intent.runId, lease, new CommandRuntimeError(409, runtimeError.code, runtimeError.message, {
          humanMessage: "Safe-stopped: the next action is outside the signed Autonomous contract.",
          category: "scope_conflict",
        }));
      }
      throw runtimeError;
    }
  }

  async acceptExecutionResult(result: ExecutionResult): Promise<ExecutionResultReceipt> {
    const summary = validateExecutionResultSummary(result.summary);
    const row = this.database.prepare(`
      SELECT id, run_id, step_id, fingerprint, status FROM actions WHERE id = ?
    `).get(result.actionId) as {
      id: string; run_id: string; step_id: string; fingerprint: string; status: string;
    } | undefined;
    if (!row) throw new CommandRuntimeError(404, "action_not_found", `Action not found: ${result.actionId}`);
    if (row.run_id !== result.runId || row.fingerprint !== result.actionFingerprint) {
      throw new CommandRuntimeError(409, "execution_result_mismatch", "Execution result correlation did not match", {
        humanMessage: "A stale or mismatched provider result was rejected.",
        category: "conflict",
      });
    }
    if (row.status !== "running") {
      const run = this.repository.getRunProjection(result.runId);
      return {
        accepted: true,
        duplicate: true,
        actionId: result.actionId,
        runId: result.runId,
        runState: run.status,
        nextAction: run.nextAction,
      };
    }

    let context = this.actionContexts.get(result.actionId);
    if (context?.completing) {
      throw new CommandRuntimeError(409, "execution_result_in_progress", "This action result is already being committed", {
        retryable: true,
        category: "conflict",
      });
    }
    if (!context) {
      const durable = this.coordinator.getRun(result.runId);
      let lease = durable.lease;
      if (!lease || Date.parse(lease.expiresAt) <= Date.parse(this.timestamp())) {
        lease = this.coordinator.acquireRunLease(result.runId, this.workerId, this.leaseTtlMs);
      } else if (lease.ownerId !== this.workerId) {
        throw new CommandRuntimeError(409, "execution_result_worker_conflict", "Another worker owns this result", {
          humanMessage: "The result reached a non-owning worker and was not applied.",
          retryable: true,
          category: "conflict",
        });
      }
      const actions = new ActionRepository(this.database);
      context = {
        action: actions.get(result.actionId),
        lease,
        before: durable.control.progress,
        completing: false,
      };
      this.actionContexts.set(result.actionId, context);
    }
    context.completing = true;
    if (context.heartbeat) clearInterval(context.heartbeat);
    const after: ProgressSnapshot = {
      ...context.before,
      ...result.progress,
      stepStates: {
        ...(context.before.stepStates ?? {}),
        ...(result.progress.stepStates ?? {}),
        [row.step_id]: result.success ? "completed" : "failed",
      },
      verifiedWorkerResultIds: result.success
        ? [...new Set([...(context.before.verifiedWorkerResultIds ?? []), ...(result.progress.verifiedWorkerResultIds ?? []), result.actionId])]
        : result.progress.verifiedWorkerResultIds ?? context.before.verifiedWorkerResultIds,
    };
    let completionCommitted = false;
    try {
      const completed = await this.coordinator.completeAction({
        lease: context.lease,
        actionId: result.actionId,
        success: result.success,
        resultSummary: summary,
        before: context.before,
        after,
        ...(result.failure ? { failure: result.failure } : {}),
        ...(result.failureCategory ? { failureCategory: result.failureCategory } : {}),
        ...(result.retryAfterMs === undefined ? {} : { retryAfterMs: result.retryAfterMs }),
        ...(result.usage ? { budgetDelta: result.usage } : {}),
        ...(result.circuitKey ? { circuitKey: result.circuitKey } : {}),
      });
      completionCommitted = true;
      this.actionContexts.delete(result.actionId);
      if (!result.success && completed.run.run.journey === "guided") {
        // Make the failed attempt and taxonomy visible before any recovery
        // planning begins. This mutation never creates, approves, or executes
        // a replacement action.
        this.repository.transaction(() => {
          this.repository.recordGuidedActionFailure(result.actionId, this.timestamp());
        });
      }
      if (result.success && completed.directive === "continue" && completed.run.lease) {
        try {
          await this.advanceAfterSuccess(completed.run.lease, result.actionId, row.step_id);
        } catch (error) {
          await this.safeStopPlanning(result.runId, completed.run.lease, asRuntimeError(error));
          throw error;
        }
      } else if (completed.directive === "recover") {
        void this.processRunNow(result.runId).catch(() => undefined);
      } else if (completed.run.run.state === "failed") {
        inImmediateTransaction(this.database, () => {
          this.database.prepare(`
            UPDATE missions SET status = 'failed', updated_at = ? WHERE id = ?
          `).run(this.timestamp(), completed.run.run.missionId);
          this.learning.recordTerminalEvaluation({
            runId: result.runId,
            terminalStatus: "failed",
            createdBy: "run-supervisor",
          });
        });
      }
      const projection = this.repository.getRunProjection(result.runId);
      return {
        accepted: true,
        duplicate: false,
        actionId: result.actionId,
        runId: result.runId,
        runState: projection.status,
        nextAction: projection.nextAction,
      };
    } catch (error) {
      if (!completionCommitted) {
        context.completing = false;
        this.actionHeartbeat(context);
      } else {
        this.actionContexts.delete(result.actionId);
      }
      throw asRuntimeError(error);
    }
  }

  private async advanceAfterSuccess(lease: RunLeaseToken, actionId: string, stepId: string): Promise<void> {
    const durable = this.coordinator.getRun(lease.runId);
    const advanced = inImmediateTransaction(this.database, () =>
      this.repository.advanceSuccessfulStep({
        runId: lease.runId,
        stepId,
        actionId,
        journey: durable.run.journey,
        now: this.timestamp(),
        decisionTtlMs: this.decisionTtlMs,
      }));
    if (advanced.completed) {
      await this.evaluateAndFinish(lease);
      return;
    }
    if (durable.run.journey === "guided") {
      if (!advanced.guidedDecisionId) throw new CommandRuntimeError(500, "guided_decision_missing", "Next Guided decision was not created");
      this.coordinator.transitionRun({
        lease,
        to: "waiting_guided_decision",
        reason: "The previous result was interpreted and the next explained step is ready",
        guidedDecisionId: advanced.guidedDecisionId,
      });
      return;
    }
    if (!advanced.nextIntent) throw new CommandRuntimeError(500, "next_action_missing", "Next Autonomous action is missing");
    await this.startRepresentedAction(advanced.nextIntent, lease);
  }

  private async evaluateAndFinish(initialLease: RunLeaseToken): Promise<void> {
    const heartbeat = this.heartbeat(initialLease);
    let heartbeatStopped = false;
    let lease = initialLease;
    try {
      const run = this.repository.getPlanningRun(initialLease.runId);
      const mission = this.repository.getMission(run.missionId);
      const projection = this.repository.getRunProjection(run.id);
      if (!projection.currentPlanId) throw new CommandRuntimeError(500, "active_plan_missing", "Run has no plan to evaluate");
      const actionIds = (this.database.prepare(`
        SELECT id FROM actions WHERE run_id = ? AND status = 'succeeded' ORDER BY ended_at, id
      `).all(run.id) as Array<{ id: string }>).map((row) => row.id);
      const evaluated = completionResult(await this.options.outcomeEvaluator.evaluate({
        mission,
        run,
        planId: projection.currentPlanId,
        completedActionIds: actionIds,
      }, this.controller(run.id).signal));
      const evaluation = evaluated.evaluation;
      if (
        !evaluation || typeof evaluation.success !== "boolean" || !evaluation.summary?.trim() ||
        !Array.isArray(evaluation.criteria)
      ) {
        throw new CommandRuntimeError(422, "invalid_completion_evaluation", "Outcome evaluator returned an invalid result");
      }
      lease = await heartbeat.stop();
      heartbeatStopped = true;
      lease = this.accountProviderUsage(lease, evaluated.usage, "success evaluation");
      inImmediateTransaction(this.database, () => {
        const target: "completed" | "failed" = evaluation.success ? "completed" : "failed";
        const transition = this.coordinator.transitionRun({
          lease,
          to: target,
          reason: evaluation.summary.trim(),
        });
        this.database.prepare(`
          UPDATE missions SET status = ?, updated_at = ? WHERE id = ?
        `).run(evaluation.success ? "completed" : "failed", this.timestamp(), mission.id);
        this.repository.events.append({
          missionId: mission.id,
          runId: run.id,
          journey: run.journey,
          eventType: evaluation.success ? "run.success_validated" : "run.success_criteria_failed",
          actorType: "agent",
          actorId: "outcome-evaluator",
          summary: evaluation.summary.trim(),
          payload: {
            success: evaluation.success,
            criteria: evaluation.criteria.map((criterion) => ({
              criterion: criterion.criterion,
              satisfied: criterion.satisfied,
              explanation: criterion.explanation,
              evidenceIds: [...criterion.evidenceIds],
            })),
            checkpointId: transition.checkpointId,
          },
        });
        this.learning.recordTerminalEvaluation({
          runId: run.id,
          terminalStatus: target,
          createdBy: "outcome-evaluator",
          outcome: evaluation,
        });
      });
    } catch (error) {
      if (!heartbeatStopped) lease = await heartbeat.stop().catch(() => lease);
      const runtimeError = asRuntimeError(error);
      await this.safeStopPlanning(initialLease.runId, lease, runtimeError);
      throw runtimeError;
    }
  }

  private controlLease(runId: string): RunLeaseToken {
    const context = [...this.actionContexts.values()].find((candidate) => candidate.action.runId === runId);
    if (context) return context.lease;
    const run = this.coordinator.getRun(runId);
    if (run.lease && run.lease.ownerId === this.workerId) return run.lease;
    return this.coordinator.acquireRunLease(runId, this.workerId, this.leaseTtlMs);
  }

  async approveGuidedDecision(decisionId: string, actorId: string, reason?: string): Promise<DurableAction> {
    const decision = this.repository.getDecision(decisionId);
    if (decision.status !== "pending") {
      const existing = this.database.prepare(`
        SELECT id FROM actions WHERE guided_decision_id = ? ORDER BY created_at LIMIT 1
      `).get(decisionId) as { id: string } | undefined;
      if (decision.status === "approved" && existing) return new ActionRepository(this.database).get(existing.id);
      throw new CommandRuntimeError(409, "guided_decision_not_pending", "Only a pending Guided decision can be approved");
    }
    const representedIntent = this.repository.getStepIntent(decision.stepId);
    if (representedIntent.kind === "manual") {
      throw new CommandRuntimeError(
        409,
        "guided_manual_action_requires_operator_result",
        "A manual Guided action cannot be dispatched through the execution boundary",
        {
          humanMessage: "This represented step is manual. Run it yourself, then use ‘I ran it’ to record the exact result.",
          category: "policy_denied",
          remediation: "Complete the documented manual procedure and submit its result against this unchanged decision fingerprint.",
        },
      );
    }
    if (Date.parse(decision.expiresAt) <= Date.parse(this.timestamp())) {
      this.database.prepare("UPDATE guided_decisions SET status = 'expired' WHERE id = ? AND status = 'pending'").run(decisionId);
      throw new CommandRuntimeError(409, "guided_decision_expired", "The Guided decision expired");
    }
    const now = this.timestamp();
    inImmediateTransaction(this.database, () => {
      const updated = this.database.prepare(`
        UPDATE guided_decisions SET status = 'approved', decision_actor = ?, decision_reason = ?, decided_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(actorId, reason?.trim() || "Approved exact represented step", now, decisionId);
      if (updated.changes !== 1) throw new CommandRuntimeError(409, "guided_decision_conflict", "Decision changed concurrently");
      this.repository.events.append({
        missionId: decision.missionId,
        runId: decision.runId,
        journey: "guided",
        eventType: "guided.decision_approved",
        actorType: "operator",
        actorId,
        summary: "Operator approved the exact represented Guided action",
        payload: { decisionId, actionFingerprint: decision.actionFingerprint },
      });
      this.repository.appendAudit({
        missionId: decision.missionId, runId: decision.runId, actorId,
        action: "guided.decision_approved", resourceType: "guided_decision",
        resourceId: decisionId, reason: reason?.trim() || "Approved exact represented step",
        details: { actionFingerprint: decision.actionFingerprint }, now,
      });
    });
    const lease = this.controlLease(decision.runId);
    return this.startRepresentedAction(representedIntent, lease, decisionId);
  }

  async skipGuidedDecision(
    decisionId: string,
    actorId: string,
    reason: string,
  ): Promise<GuidedDecisionSkipResult> {
    const normalizedReason = validateReason(reason);
    const decision = this.repository.getDecision(decisionId);
    const skipped = this.database.prepare(`
      SELECT ps.status AS step_status,
        EXISTS(
          SELECT 1 FROM events
          WHERE run_id = ? AND event_type = 'guided.decision_skipped'
            AND json_extract(payload_json, '$.decisionId') = ?
        ) AS has_skip_event
      FROM plan_steps ps WHERE ps.id = ?
    `).get(decision.runId, decision.id, decision.stepId) as {
      step_status: string;
      has_skip_event: number;
    } | undefined;
    if (
      decision.status === "cancelled" &&
      skipped?.step_status === "skipped" &&
      skipped.has_skip_event === 1
    ) {
      const projection = this.repository.getRunProjection(decision.runId);
      const pending = this.database.prepare(`
        SELECT id FROM guided_decisions
        WHERE run_id = ? AND status = 'pending' AND step_id = ?
        ORDER BY created_at DESC LIMIT 1
      `).get(decision.runId, projection.currentStepId) as { id: string } | undefined;
      return {
        decisionId,
        status: "cancelled",
        skippedStepId: decision.stepId,
        nextDecisionId: pending?.id ?? null,
        runId: decision.runId,
        runState: projection.status,
        nextAction: projection.nextAction,
        duplicate: true,
      };
    }
    if (decision.status !== "pending") {
      throw new CommandRuntimeError(409, "guided_decision_not_pending", "Only the current pending Guided decision can be skipped");
    }
    const projection = this.repository.getRunProjection(decision.runId);
    if (
      projection.journey !== "guided" ||
      projection.status !== "waiting_guided_decision" ||
      projection.currentStepId !== decision.stepId
    ) {
      throw new CommandRuntimeError(409, "guided_decision_not_current", "Decision is not the current represented Guided step", {
        humanMessage: "This decision is stale and no longer owns the Guided checkpoint.",
        category: "conflict",
        remediation: "Refresh the Guided workspace and use the current decision card.",
      });
    }
    const representedIntent = this.repository.getStepIntent(decision.stepId);
    if (
      fingerprintAction(representedIntent).hash !== decision.actionFingerprint ||
      canonicalJson(representedIntent) !== canonicalJson(decision.requestedParameters)
    ) {
      throw new CommandRuntimeError(409, "guided_action_changed", "The represented Guided action changed", {
        humanMessage: "The decision no longer represents the exact current step and cannot be skipped from this card.",
        category: "conflict",
        remediation: "Refresh the Guided workspace and decide on the newly represented step.",
      });
    }

    const lease = this.controlLease(decision.runId);
    const now = this.timestamp();
    const committed = inImmediateTransaction(this.database, () => {
      const runs = new RunRepository(this.database);
      const current = runs.get(decision.runId);
      runs.assertLease(current, lease, now);
      if (current.run.journey !== "guided" || current.run.state !== "waiting_guided_decision") {
        throw new CommandRuntimeError(409, "guided_run_not_waiting", "Guided run is not waiting for this decision");
      }
      const advanced = this.repository.skipGuidedStep({
        decisionId,
        actorId,
        reason: normalizedReason,
        now,
        decisionTtlMs: this.decisionTtlMs,
      });
      const progress: ProgressSnapshot = {
        ...current.control.progress,
        stepStates: {
          ...(current.control.progress.stepStates ?? {}),
          [decision.stepId]: "skipped",
        },
        resolvedDecisionIds: [
          ...new Set([...(current.control.progress.resolvedDecisionIds ?? []), decision.id]),
        ],
      };
      const reasonText = advanced.completed
        ? "The exact Guided step was skipped; all represented steps are resolved and outcome evaluation is starting"
        : "The exact Guided step was skipped; the next dependency-eligible step is explained and waiting";
      const nextRun = advanced.completed
        ? transitionSupervisedRun(
            { ...current.run, pendingGuidedDecisionId: decision.id },
            "running",
            {
              reason: reasonText,
              now,
              guidedDecisionId: decision.id,
            },
          ).run
        : {
            ...current.run,
            pendingGuidedDecisionId: advanced.guidedDecisionId ?? undefined,
            stateVersion: current.run.stateVersion + 1,
            stateReason: reasonText,
            updatedAt: now,
          };
      const persisted = runs.persistMutation({
        current,
        nextRun,
        control: { ...current.control, progress },
        now,
        lease: "keep",
      });
      let eventSequence = advanced.eventSequence;
      if (advanced.completed) {
        eventSequence = this.repository.events.append({
          missionId: decision.missionId,
          runId: decision.runId,
          journey: "guided",
          eventType: "run.state_changed",
          actorType: "operator",
          actorId,
          summary: "waiting_guided_decision -> running: skipped plan is ready for outcome evaluation",
          payload: {
            from: "waiting_guided_decision",
            to: "running",
            decisionId,
            reason: reasonText,
          },
        }).sequence;
      }
      new CheckpointRepository(this.database, new ActionRepository(this.database)).create({
        run: persisted,
        eventSequence,
        now,
      });
      if (!persisted.lease) {
        throw new CommandRuntimeError(500, "runtime_lease_lost", "Guided skip lost its run lease");
      }
      return { advanced, lease: persisted.lease };
    });
    if (committed.advanced.completed) {
      await this.evaluateAndFinish(committed.lease);
    }
    const updated = this.repository.getRunProjection(decision.runId);
    return {
      decisionId,
      status: "cancelled",
      skippedStepId: committed.advanced.skippedStepId,
      nextDecisionId: committed.advanced.guidedDecisionId,
      runId: decision.runId,
      runState: updated.status,
      nextAction: updated.nextAction,
      duplicate: false,
    };
  }

  async rejectGuidedDecision(decisionId: string, actorId: string, reason: string): Promise<void> {
    const normalizedReason = validateReason(reason);
    const decision = this.repository.getDecision(decisionId);
    if (decision.status === "rejected") return;
    if (decision.status !== "pending") throw new CommandRuntimeError(409, "guided_decision_not_pending", "Only a pending decision can be rejected");
    const lease = this.controlLease(decision.runId);
    inImmediateTransaction(this.database, () => {
      this.database.prepare(`
        UPDATE guided_decisions SET status = 'rejected', decision_actor = ?, decision_reason = ?, decided_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(actorId, normalizedReason, this.timestamp(), decisionId);
      this.database.prepare(`
        UPDATE plan_steps SET status = 'recovering', updated_at = ? WHERE id = ?
      `).run(this.timestamp(), decision.stepId);
      this.coordinator.transitionRun({
        lease,
        to: "recovering",
        reason: `Operator rejected the Guided step: ${normalizedReason}`,
      });
      this.repository.appendAudit({
        missionId: decision.missionId, runId: decision.runId, actorId,
        action: "guided.decision_rejected", resourceType: "guided_decision",
        resourceId: decisionId, reason: normalizedReason, now: this.timestamp(),
      });
    });
    void this.processRunNow(decision.runId).catch(() => undefined);
  }

  async submitManualGuidedResult(
    decisionId: string,
    actorId: string,
    summary: string,
  ): Promise<ExecutionResultReceipt> {
    const normalized = validateExecutionResultSummary(summary);
    const decision = this.repository.getDecision(decisionId);
    if (decision.status === "manual") {
      const existing = this.database.prepare(`
        SELECT id, result_summary FROM actions
        WHERE guided_decision_id = ? AND status = 'succeeded'
        ORDER BY created_at, id LIMIT 1
      `).get(decisionId) as { id: string; result_summary: string | null } | undefined;
      if (!existing?.result_summary) {
        throw new CommandRuntimeError(500, "manual_result_invariant_broken", "Completed manual decision has no retained action result", {
          humanMessage: "The prior manual result is incomplete and requires integrity review.",
          category: "internal",
        });
      }
      const evidence = this.repository.transaction(() => this.repository.createManualEvidence({
        decision,
        actionId: existing.id,
        actorId,
        content: existing.result_summary!,
        now: this.timestamp(),
      }));
      const projection = this.repository.getRunProjection(decision.runId);
      return {
        accepted: true,
        duplicate: true,
        actionId: existing.id,
        runId: decision.runId,
        runState: projection.status,
        nextAction: projection.nextAction,
        evidenceIds: [evidence.id],
      };
    }
    if (decision.status !== "pending") throw new CommandRuntimeError(409, "guided_decision_not_pending", "Manual result requires the pending represented step");
    const lease = this.controlLease(decision.runId);
    const now = this.timestamp();
    const accepted = inImmediateTransaction(this.database, () => {
      const updated = this.database.prepare(`
        UPDATE guided_decisions SET status = 'manual', decision_actor = ?, decision_reason = ?, decided_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(actorId, "Operator supplied the result for the represented action", now, decisionId);
      if (updated.changes !== 1) throw new CommandRuntimeError(409, "guided_decision_conflict", "Decision changed concurrently");
      const created = this.repository.createManualAction({ decision, summary: normalized, now });
      const evidence = this.repository.createManualEvidence({
        decision,
        actionId: created,
        actorId,
        content: normalized,
        now,
      });
      this.repository.events.append({
        missionId: decision.missionId, runId: decision.runId, journey: "guided",
        eventType: "guided.manual_result_recorded", actorType: "operator", actorId,
        summary: "Operator recorded the result for the exact Guided action",
        payload: {
          decisionId,
          actionId: created,
          actionFingerprint: decision.actionFingerprint,
          evidenceId: evidence.id,
          contentHash: evidence.contentHash,
          byteSize: evidence.byteSize,
        },
        sensitivity: "private",
        redaction: { operatorSuppliedContent: "retained_in_private_evidence_only" },
      });
      this.repository.appendAudit({
        missionId: decision.missionId, runId: decision.runId, actorId,
        action: "guided.manual_result_recorded", resourceType: "guided_decision",
        resourceId: decisionId, reason: "Operator supplied exact-step result",
        details: { actionId: created, evidenceId: evidence.id, contentHash: evidence.contentHash },
        now,
      });
      return { actionId: created, evidence };
    });
    // Manual work resolves the exact decision without dispatching a duplicate
    // provider action. This is the manual analogue of startAction's guarded
    // waiting -> running transition and is fully evented/checkpointed.
    const runningLease = inImmediateTransaction(this.database, () => {
      const runs = new RunRepository(this.database);
      const current = runs.get(decision.runId);
      runs.assertLease(current, lease, now);
      if (current.run.journey !== "guided" || current.run.state !== "waiting_guided_decision") {
        throw new CommandRuntimeError(409, "guided_run_not_waiting", "Guided run is not waiting for this result");
      }
      const nextRun = {
        ...current.run,
        state: "running" as const,
        launched: true,
        pendingGuidedDecisionId: undefined,
        stateVersion: current.run.stateVersion + 1,
        stateReason: `Operator supplied the result for Guided decision ${decisionId}`,
        updatedAt: now,
      };
      const progress: ProgressSnapshot = {
        ...current.control.progress,
        stepStates: {
          ...(current.control.progress.stepStates ?? {}),
          [decision.stepId]: "completed",
        },
        evidenceIds: [...new Set([...(current.control.progress.evidenceIds ?? []), accepted.evidence.id])],
        resolvedDecisionIds: [...new Set([...(current.control.progress.resolvedDecisionIds ?? []), decisionId])],
        verifiedWorkerResultIds: [...new Set([...(current.control.progress.verifiedWorkerResultIds ?? []), accepted.actionId])],
      };
      const persisted = runs.persistMutation({
        current,
        nextRun,
        control: { ...current.control, progress },
        now,
        lease: "keep",
      });
      const event = this.repository.events.append({
        missionId: decision.missionId,
        runId: decision.runId,
        journey: "guided",
        eventType: "run.state_changed",
        actorType: "operator",
        actorId,
        summary: "waiting_guided_decision -> running: exact manual result supplied",
        payload: { from: "waiting_guided_decision", to: "running", decisionId },
      });
      new CheckpointRepository(this.database, new ActionRepository(this.database)).create({
        run: persisted,
        eventSequence: event.sequence,
        now,
      });
      if (!persisted.lease) throw new CommandRuntimeError(500, "runtime_lease_lost", "Manual result lost its run lease");
      return persisted.lease;
    });
    await this.advanceAfterSuccess(runningLease, accepted.actionId, decision.stepId);
    const projection = this.repository.getRunProjection(decision.runId);
    return {
      accepted: true,
      duplicate: false,
      actionId: accepted.actionId,
      runId: decision.runId,
      runState: projection.status,
      nextAction: projection.nextAction,
      evidenceIds: [accepted.evidence.id],
    };
  }

  pauseRun(runId: string, actorId: string, reason: string): void {
    const normalized = validateReason(reason);
    if ([...this.actionContexts.values()].some((context) => context.action.runId === runId)) {
      throw new CommandRuntimeError(409, "pause_requires_safe_checkpoint", "An in-flight action cannot be safely paused", {
        humanMessage: "Pause is available at a durable checkpoint; cancel if active child work must stop now.",
        category: "conflict",
      });
    }
    const lease = this.controlLease(runId);
    const current = this.coordinator.getRun(runId);
    if (current.run.state === "blocked") return;
    const result = this.coordinator.transitionRun({ lease, to: "blocked", reason: `Paused by operator: ${normalized}` });
    this.database.prepare("UPDATE missions SET status = 'paused', updated_at = ? WHERE id = ?")
      .run(this.timestamp(), result.run.run.missionId);
    this.repository.appendAudit({
      missionId: result.run.run.missionId, runId, actorId, action: "run.paused",
      resourceType: "run", resourceId: runId, reason: normalized, now: this.timestamp(),
    });
  }

  resumeRun(runId: string, actorId: string, reason: string): void {
    const normalized = validateReason(reason);
    const current = this.coordinator.getRun(runId);
    if (current.run.state !== "blocked") throw new CommandRuntimeError(409, "run_not_paused", "Only a blocked run can resume");
    const lease = this.controlLease(runId);
    const pending = this.database.prepare(`
      SELECT id FROM guided_decisions WHERE run_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1
    `).get(runId) as { id: string } | undefined;
    const target: RunState = current.run.journey === "guided" && pending ? "waiting_guided_decision" : "recovering";
    this.coordinator.transitionRun({
      lease,
      to: target,
      reason: `Resumed by operator: ${normalized}`,
      ...(pending ? { guidedDecisionId: pending.id } : {}),
    });
    this.database.prepare("UPDATE missions SET status = 'active', updated_at = ? WHERE id = ?")
      .run(this.timestamp(), current.run.missionId);
    this.repository.appendAudit({
      missionId: current.run.missionId, runId, actorId, action: "run.resumed",
      resourceType: "run", resourceId: runId, reason: normalized, now: this.timestamp(),
    });
    if (target === "recovering") void this.processRunNow(runId).catch(() => undefined);
  }

  async cancelRun(runId: string, actorId: string, reason: string): Promise<void> {
    const normalized = validateReason(reason);
    const current = this.coordinator.getRun(runId);
    if (isTerminalRunState(current.run.state)) {
      if (current.run.state === "cancelled") {
        this.learning.recordTerminalEvaluation({
          runId,
          terminalStatus: "cancelled",
          createdBy: "run-supervisor",
        });
      }
      return;
    }
    const result = await this.coordinator.cancelRun({ lease: this.controlLease(runId), reason: normalized });
    inImmediateTransaction(this.database, () => {
      const now = this.timestamp();
      this.repository.cancelOpenWork(runId, actorId, normalized, now);
      this.database.prepare("UPDATE missions SET status = 'cancelled', updated_at = ? WHERE id = ?")
        .run(now, result.run.run.missionId);
      this.repository.appendAudit({
        missionId: result.run.run.missionId, runId, actorId, action: "run.cancelled",
        resourceType: "run", resourceId: runId, reason: normalized, now,
      });
      this.learning.recordTerminalEvaluation({
        runId,
        terminalStatus: "cancelled",
        createdBy: "run-supervisor",
      });
    });
  }
}

export function createMissionRuntime(options: MissionRuntimeOptions): MissionRuntimeEngine {
  return new MissionRuntimeEngine(options);
}
