import { randomUUID } from "node:crypto";
import {
  ControlPlaneLeaseError,
  ControlPlaneLeaseService,
  type ControlPlaneLease,
  type RunMutationLeaseRequest,
} from "../control-plane";
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
  FAILURE_CATEGORIES,
  fingerprintAction,
  isRetryableCategory,
  isTerminalRunState,
  RunSupervisor,
  transitionRun as transitionSupervisedRun,
  type FailureCategory,
  type ProgressSnapshot,
  type RunState,
} from "../supervisor";
import { RuntimeRepository } from "./RuntimeRepository";
import { commitPlanningContextAttribution } from "./PlanningContextAttribution";
import {
  RuntimeContinuationRepository,
  type RuntimeContinuation,
  type RuntimeContinuationKind,
} from "./RuntimeContinuationRepository";
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

class RuntimeCrashAfterCommit extends Error {
  constructor(readonly point: string) {
    super(`Injected process crash after durable commit: ${point}`);
    this.name = "RuntimeCrashAfterCommit";
  }
}

function planResult(value: MissionPlanDraft | MissionPlanPortResult): MissionPlanPortResult {
  return "plan" in value ? value : { plan: value, usage: value.providerUsage };
}

function completionResult(
  value: MissionCompletionEvaluation | MissionCompletionPortResult,
): MissionCompletionPortResult {
  return "evaluation" in value ? value : { evaluation: value, usage: value.providerUsage };
}

function errorRecord(error: unknown): Readonly<Record<string, unknown>> {
  return error && typeof error === "object" ? error as Readonly<Record<string, unknown>> : {};
}

function failureSignal(error: unknown): Parameters<typeof classifyFailure>[0] {
  const item = errorRecord(error);
  const status = typeof item.status === "number"
    ? item.status
    : typeof item.statusCode === "number"
      ? item.statusCode
      : error instanceof CommandRuntimeError
        ? error.status
        : undefined;
  const message = error instanceof Error ? error.message : "";
  return {
    ...(typeof item.code === "string" ? { code: item.code } : error instanceof Error ? { code: error.name } : {}),
    ...(message ? { message } : {}),
    ...(status === undefined ? {} : { httpStatus: status }),
    source: /grok|provider|acp|oauth|rate.?limit|too many requests/i.test(message)
      || status === 429 || status === 502 || status === 503 || status === 504
      ? "provider"
      : "unknown",
  };
}

function planningFailureCategory(error: unknown, runtimeError: CommandRuntimeError): FailureCategory {
  const declared = runtimeError.options.category;
  if (declared && FAILURE_CATEGORIES.includes(declared as FailureCategory)) {
    return declared as FailureCategory;
  }
  return classifyFailure(failureSignal(error));
}

function numericRetryAfter(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function planningRetryAfterMs(error: unknown, now: Date): number | undefined {
  const item = errorRecord(error);
  const direct = numericRetryAfter(item.retryAfterMs);
  if (direct !== undefined) return direct;
  if (error instanceof CommandRuntimeError) {
    const details = error.options.details;
    if (details && typeof details === "object" && !Array.isArray(details)) {
      const fromDetails = numericRetryAfter(details.retryAfterMs);
      if (fromDetails !== undefined) return fromDetails;
    }
  }
  const headers = item.headers;
  const raw = headers && typeof headers === "object" && "get" in headers
    && typeof (headers as { get?: unknown }).get === "function"
    ? (headers as { get(name: string): unknown }).get("retry-after")
    : undefined;
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const boundary = Date.parse(raw);
  return Number.isFinite(boundary) ? Math.max(0, boundary - now.getTime()) : undefined;
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
  const category = classifyFailure(failureSignal(error));
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
  readonly continuations: RuntimeContinuationRepository;
  readonly coordinator: DurableRunCoordinator;
  readonly learning: RunLearningService;
  private readonly database: SqliteDatabase;
  private readonly workerId: string;
  private readonly scanIntervalMs: number;
  private readonly leaseTtlMs: number;
  private readonly decisionTtlMs: number;
  private readonly maxPlanSteps: number;
  private readonly now: () => Date;
  private readonly controlPlaneLeases: ControlPlaneLeaseService;
  /** Raw lease tokens exist only inside this runtime process. */
  private readonly controlPlaneTokens = new Map<string, string>();
  private readonly processing = new Map<string, Promise<void>>();
  private readonly continuationProcessing = new Map<string, Promise<void>>();
  private readonly actionContexts = new Map<string, RuntimeActionContext>();
  private readonly controllers = new Map<string, AbortController>();
  private scanTimer?: ReturnType<typeof setInterval>;
  private stopping = false;
  private unbindResultSink?: () => void;

  constructor(private readonly options: MissionRuntimeOptions) {
    this.database = options.database;
    this.now = options.now ?? (() => new Date());
    this.repository = new RuntimeRepository(options.database);
    this.controlPlaneLeases = new ControlPlaneLeaseService(options.database);
    this.continuations = new RuntimeContinuationRepository(options.database);
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
      supervisor: new RunSupervisor({ retryPolicy: options.retryPolicy }),
      afterActionCommit: (action) => {
        this.crashAfterCommit("action_reserved_before_dispatch", action.runId, action.id);
      },
      afterCancellationCleanup: (runId) => {
        this.crashAfterCommit("cancellation_cleanup_before_finalize", runId);
      },
    });
    const unbind = options.execution.bindResultSink?.(this);
    if (typeof unbind === "function") this.unbindResultSink = unbind;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  /**
   * Trusted server-side bridge for V2 run mutations.
   *
   * A control-plane proof can be acquired or heartbeated only while this exact
   * engine process owns an unexpired durable run lease. The raw control-plane
   * token remains in memory and is never returned to an HTTP boundary.
   */
  readonly assertRunMutationLease = (request: RunMutationLeaseRequest): ControlPlaneLease => {
    if (this.stopping) {
      throw new ControlPlaneLeaseError(
        "lease_missing",
        `Run ${request.runId} runtime controller is stopping`,
      );
    }
    const now = this.now();
    const nowMs = now.getTime();
    if (!Number.isFinite(nowMs)) throw new RangeError("Mutation lease assertion time is invalid");

    let durable: ReturnType<DurableRunCoordinator["getRun"]>;
    try {
      durable = this.coordinator.getRun(request.runId);
    } catch {
      throw new ControlPlaneLeaseError("run_not_found", `Run ${request.runId} does not exist`);
    }
    if (durable.run.missionId !== request.missionId) {
      throw new ControlPlaneLeaseError(
        "control_plane_mismatch",
        `Run ${request.runId} does not belong to mission ${request.missionId}`,
      );
    }
    let durableLease = durable.lease;
    const durableExpiryAtStart = durableLease ? Date.parse(durableLease.expiresAt) : Number.NaN;
    const operatorWaitingState = durable.run.state === "waiting_guided_decision"
      || durable.run.state === "blocked"
      || durable.run.state === "recovering";
    if ((!durableLease || durableExpiryAtStart <= nowMs) && operatorWaitingState) {
      // Waiting and recovery states deliberately release/expire the worker
      // lease while no provider or tool work is running. The trusted runtime
      // may atomically reclaim that durable lease for one represented operator
      // mutation; another live worker still wins the database fence.
      try {
        durableLease = this.coordinator.acquireRunLease(
          request.runId,
          this.workerId,
          this.leaseTtlMs,
        );
        durable = this.coordinator.getRun(request.runId);
      } catch {
        throw new ControlPlaneLeaseError(
          "lease_fence_invalid",
          `Run ${request.runId} mutation authority is owned by another durable runtime worker`,
          true,
        );
      }
    }
    if (!durableLease) {
      throw new ControlPlaneLeaseError(
        "lease_missing",
        `Run ${request.runId} has no active durable runtime lease`,
      );
    }
    if (durableLease.ownerId !== this.workerId) {
      throw new ControlPlaneLeaseError(
        "lease_fence_invalid",
        `Run ${request.runId} is owned by another durable runtime worker`,
        true,
      );
    }
    const durableExpiry = Date.parse(durableLease.expiresAt);
    if (!Number.isFinite(durableExpiry) || durableExpiry <= nowMs) {
      throw new ControlPlaneLeaseError(
        "lease_expired",
        `Run ${request.runId} durable runtime lease expired`,
        true,
      );
    }
    const ttlMs = Math.min(this.leaseTtlMs, Math.floor(durableExpiry - nowMs));
    if (ttlMs < 1_000) {
      throw new ControlPlaneLeaseError(
        "lease_expired",
        `Run ${request.runId} durable runtime lease is too close to expiry`,
        true,
      );
    }

    let token = this.controlPlaneTokens.get(request.runId);
    let proof: ControlPlaneLease;
    if (token) {
      proof = this.controlPlaneLeases.heartbeat({
        runId: request.runId,
        controlPlane: "command_os_v2",
        leaseOwner: this.workerId,
        leaseToken: token,
        ttlMs,
        now,
      });
    } else {
      const acquired = this.controlPlaneLeases.acquire({
        runId: request.runId,
        controlPlane: "command_os_v2",
        leaseOwner: this.workerId,
        ttlMs,
        now,
      });
      if (!acquired.leaseToken) {
        throw new ControlPlaneLeaseError(
          "lease_token_invalid",
          `Run ${request.runId} did not return a private control-plane token`,
        );
      }
      token = acquired.leaseToken;
      this.controlPlaneTokens.set(request.runId, token);
      proof = acquired.lease;
    }

    // Fence a cross-process durable-lease takeover that raced the
    // control-plane acquisition. A stale proof is released before failing.
    const after = this.coordinator.getRun(request.runId);
    const currentLease = after.lease;
    if (
      after.run.missionId !== request.missionId
      || !currentLease
      || currentLease.ownerId !== this.workerId
      || currentLease.fence !== durableLease.fence
      || currentLease.expiresAt !== durableLease.expiresAt
      || Date.parse(currentLease.expiresAt) <= nowMs
    ) {
      try {
        this.controlPlaneLeases.release({
          runId: request.runId,
          controlPlane: "command_os_v2",
          leaseOwner: this.workerId,
          leaseToken: token,
          now,
        });
      } catch {
        // A newer controller already fenced this proof.
      }
      this.controlPlaneTokens.delete(request.runId);
      throw new ControlPlaneLeaseError(
        "lease_fence_invalid",
        `Run ${request.runId} durable runtime lease changed during authority acquisition`,
        true,
      );
    }
    return proof;
  };

  private crashAfterCommit(
    point: Parameters<NonNullable<MissionRuntimeOptions["crashAfterCommit"]>>[0],
    runId: string,
    sourceId?: string,
  ): void {
    if (!this.options.crashAfterCommit) return;
    try {
      this.options.crashAfterCommit(point, {
        runId,
        ...(sourceId ? { sourceId } : {}),
      });
    } catch {
      throw new RuntimeCrashAfterCommit(point);
    }
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
    this.continuations.reconcileFromCanonicalState(this.timestamp());
    // Cancellation wins over ordinary action recovery. A process that died
    // after child cleanup but before aggregate finalization must never resume
    // the very work the operator asked it to stop.
    await this.replayContinuations(undefined, ["cancellation_finalize_pending"]);
    await this.replayContinuations();
    const recovered = await this.recover();
    // Recovery must classify every expired lease before the scheduler can
    // reclaim planning work. In particular, this closes an interrupted ACP
    // provider turn and checkpoints run.recovery_started before a fresh
    // planning lease is acquired.
    this.continuations.reconcileFromCanonicalState(this.timestamp());
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
    await Promise.allSettled([...this.continuationProcessing.values()]);
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
    // Tokens are process authority and must never survive runtime shutdown.
    this.controlPlaneTokens.clear();
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
    this.continuations.reconcileFromCanonicalState(this.timestamp());
    const continuationRuns = this.continuations.readyRunIds(this.timestamp());
    let scheduled = 0;
    for (const runId of continuationRuns) {
      if (this.continuationProcessing.has(runId)) continue;
      const work = this.processContinuationRun(runId)
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => this.continuationProcessing.delete(runId));
      this.continuationProcessing.set(runId, work);
      scheduled += 1;
    }
    const candidates = this.repository.listRunnableRuns(this.timestamp());
    for (const runId of candidates) {
      if (this.processing.has(runId) || this.continuationProcessing.has(runId)) continue;
      const work = this.processRun(runId)
        .catch(() => undefined)
        .finally(() => this.processing.delete(runId));
      this.processing.set(runId, work);
      scheduled += 1;
    }
    return scheduled;
  }

  async processRunNow(runId: string, planningRetryContinuationId?: string): Promise<void> {
    const existing = this.processing.get(runId);
    if (existing) return existing;
    const work = this.processRun(runId, planningRetryContinuationId)
      .finally(() => this.processing.delete(runId));
    this.processing.set(runId, work);
    return work;
  }

  async replayContinuations(
    runId?: string,
    kinds?: readonly RuntimeContinuationKind[],
  ): Promise<number> {
    const runIds = runId ? [runId] : this.continuations.readyRunIds(this.timestamp(), 200);
    let processed = 0;
    for (const candidate of runIds) {
      if (this.continuationProcessing.has(candidate)) {
        await this.continuationProcessing.get(candidate);
        continue;
      }
      processed += await this.processContinuationRun(candidate, kinds);
    }
    return processed;
  }

  private async processContinuationRun(
    runId: string,
    kinds?: readonly RuntimeContinuationKind[],
  ): Promise<number> {
    let processed = 0;
    for (let index = 0; index < 64 && !this.stopping; index += 1) {
      const continuation = this.continuations.claimNext({
        runId,
        workerId: this.workerId,
        now: this.timestamp(),
        leaseTtlMs: this.leaseTtlMs,
        ...(kinds?.length ? { kinds } : {}),
      });
      if (!continuation?.leaseOwner) break;
      const heartbeat = setInterval(() => {
        try {
          this.continuations.heartbeat(
            continuation.id,
            continuation.leaseOwner!,
            this.timestamp(),
            this.leaseTtlMs,
          );
        } catch {
          clearInterval(heartbeat);
        }
      }, Math.max(250, Math.floor(this.leaseTtlMs / 3)));
      try {
        await this.handleContinuation(continuation);
        processed += 1;
      } catch (error) {
        if (error instanceof RuntimeCrashAfterCommit) throw error;
        const message = error instanceof Error ? error.message : "Continuation handler failed";
        const current = this.continuations.get(continuation.id);
        if (current.status === "processing" && current.leaseOwner === continuation.leaseOwner) {
          const run = this.coordinator.getRun(runId);
          if (isTerminalRunState(run.run.state) || run.run.state === "blocked") {
            this.continuations.complete(continuation.id, continuation.leaseOwner, this.timestamp());
          } else if (continuation.attemptCount >= 5) {
            this.failContinuation(continuation, message);
          } else {
            const delayMs = Math.min(30_000, 250 * (2 ** Math.max(0, continuation.attemptCount - 1)));
            this.continuations.retry({
              id: continuation.id,
              ownerToken: continuation.leaseOwner,
              now: this.timestamp(),
              availableAt: new Date(Date.parse(this.timestamp()) + delayMs).toISOString(),
              error: message,
            });
          }
        }
        break;
      } finally {
        clearInterval(heartbeat);
      }
    }
    return processed;
  }

  private continuationText(
    continuation: RuntimeContinuation,
    key: "actionId" | "stepId" | "decisionId" | "terminalStatus",
  ): string | null {
    const value = continuation.payload[key];
    return typeof value === "string" && value.trim() ? value : null;
  }

  private continuationLease(runId: string): RunLeaseToken {
    const durable = this.coordinator.getRun(runId);
    if (durable.lease?.ownerId === this.workerId) return durable.lease;
    if (durable.lease && Date.parse(durable.lease.expiresAt) > Date.parse(this.timestamp())) {
      throw new CommandRuntimeError(409, "continuation_run_lease_busy", "Another worker owns this run continuation", {
        retryable: true,
        category: "conflict",
      });
    }
    return this.coordinator.acquireRunLease(runId, this.workerId, this.leaseTtlMs);
  }

  private completeContinuation(continuation: RuntimeContinuation): void {
    if (!continuation.leaseOwner) throw new Error("Claimed continuation has no owner fence");
    this.continuations.complete(continuation.id, continuation.leaseOwner, this.timestamp());
  }

  private async handleContinuation(continuation: RuntimeContinuation): Promise<void> {
    const run = this.coordinator.getRun(continuation.runId);
    if (isTerminalRunState(run.run.state) && continuation.kind !== "evaluation_pending") {
      this.completeContinuation(continuation);
      return;
    }
    switch (continuation.kind) {
      case "planning_retry_to_dispatch": {
        await this.processRunNow(continuation.runId, continuation.id);
        this.completeContinuation(continuation);
        return;
      }
      case "autonomous_retry_to_dispatch": {
        await this.dispatchAutonomousRetryContinuation(continuation);
        return;
      }
      case "plan_ready_to_dispatch":
      case "guided_approval_to_dispatch": {
        const stepId = this.continuationText(continuation, "stepId");
        if (!stepId) throw new Error("Dispatch continuation is missing its canonical step ID");
        const decisionId = continuation.kind === "guided_approval_to_dispatch"
          ? this.continuationText(continuation, "decisionId") ?? continuation.sourceId
          : undefined;
        const existing = this.database.prepare(`
          SELECT id, status FROM actions
          WHERE run_id = ? AND step_id = ?
            ${decisionId ? "AND guided_decision_id = ?" : ""}
          ORDER BY created_at, id LIMIT 1
        `).get(...(decisionId
          ? [continuation.runId, stepId, decisionId]
          : [continuation.runId, stepId])) as { id: string; status: string } | undefined;
        if (existing) {
          inImmediateTransaction(this.database, () => {
            if (existing.status === "succeeded") {
              this.continuations.enqueue({
                runId: continuation.runId,
                kind: "action_result_to_advance",
                sourceId: existing.id,
                payload: { actionId: existing.id, stepId },
                now: this.timestamp(),
              });
            }
            this.completeContinuation(continuation);
          });
          return;
        }
        const lease = this.continuationLease(continuation.runId);
        await this.startRepresentedAction(
          this.repository.getStepIntent(stepId),
          lease,
          decisionId,
        );
        this.completeContinuation(continuation);
        return;
      }
      case "action_result_to_advance": {
        await this.advanceContinuation(continuation);
        return;
      }
      case "guided_failure_to_recover": {
        const actionId = this.continuationText(continuation, "actionId") ?? continuation.sourceId;
        inImmediateTransaction(this.database, () => {
          this.repository.recordGuidedActionFailure(actionId, this.timestamp());
          this.continuations.enqueue({
            runId: continuation.runId,
            kind: "resume_recovery_pending",
            sourceId: actionId,
            payload: { actionId },
            now: this.timestamp(),
          });
          this.completeContinuation(continuation);
        });
        return;
      }
      case "resume_recovery_pending": {
        const latest = this.coordinator.getRun(continuation.runId);
        if (latest.run.state !== "recovering" && latest.run.state !== "planning") {
          this.completeContinuation(continuation);
          return;
        }
        await this.processRunNow(continuation.runId);
        this.completeContinuation(continuation);
        return;
      }
      case "evaluation_pending": {
        const terminalStatus = this.continuationText(continuation, "terminalStatus");
        const latest = this.coordinator.getRun(continuation.runId);
        if (terminalStatus === "cancelled" || latest.run.state === "cancelled") {
          const cancellation = this.database.prepare(`
            SELECT actor_id, summary FROM events WHERE id = ? AND run_id = ?
          `).get(continuation.sourceId, continuation.runId) as {
            actor_id: string | null;
            summary: string;
          } | undefined;
          const actorId = cancellation?.actor_id ?? "operator";
          const reason = cancellation?.summary.replace(/^Run cancelled and child work stopped:\s*/u, "").trim()
            || "Operator requested cancellation";
          inImmediateTransaction(this.database, () => {
            this.repository.cancelOpenWork(continuation.runId, actorId, reason, this.timestamp());
            this.database.prepare("UPDATE missions SET status = 'cancelled', updated_at = ? WHERE id = ?")
              .run(this.timestamp(), latest.run.missionId);
            const audit = this.database.prepare(`
              SELECT id FROM audit_records
              WHERE run_id = ? AND action = 'run.cancelled'
              ORDER BY occurred_at DESC, id DESC LIMIT 1
            `).get(continuation.runId) as { id: string } | undefined;
            if (!audit) {
              this.repository.appendAudit({
                missionId: latest.run.missionId,
                runId: continuation.runId,
                actorId,
                action: "run.cancelled",
                resourceType: "run",
                resourceId: continuation.runId,
                reason,
                now: this.timestamp(),
              });
            }
            this.learning.recordTerminalEvaluation({
              runId: continuation.runId,
              terminalStatus: "cancelled",
              createdBy: "run-supervisor",
            });
            this.completeContinuation(continuation);
          });
          return;
        }
        if (terminalStatus === "failed" || latest.run.state === "failed") {
          inImmediateTransaction(this.database, () => {
            this.learning.recordTerminalEvaluation({
              runId: continuation.runId,
              terminalStatus: "failed",
              createdBy: "run-supervisor",
            });
            this.completeContinuation(continuation);
          });
          return;
        }
        if (latest.run.state === "completed") {
          this.completeContinuation(continuation);
          return;
        }
        const lease = this.continuationLease(continuation.runId);
        await this.evaluateAndFinish(lease);
        this.completeContinuation(continuation);
        return;
      }
      case "cancellation_finalize_pending": {
        await this.finalizeCancellationContinuation(continuation);
        return;
      }
    }
  }

  private async dispatchAutonomousRetryContinuation(
    continuation: RuntimeContinuation,
  ): Promise<void> {
    const actionId = this.continuationText(continuation, "actionId") ?? continuation.sourceId;
    const stepId = this.continuationText(continuation, "stepId");
    if (!stepId) throw new Error("Autonomous retry continuation is missing its canonical step ID");
    const predecessor = this.database.prepare(`
      SELECT id, status, step_id FROM actions
      WHERE id = ? AND run_id = ?
    `).get(actionId, continuation.runId) as {
      id: string;
      status: string;
      step_id: string;
    } | undefined;
    if (
      !predecessor || predecessor.step_id !== stepId ||
      !["failed", "timed_out"].includes(predecessor.status)
    ) {
      throw new Error("Autonomous retry predecessor is not the exact canonical failed action");
    }

    // A retry successor is explicitly linked to its failed predecessor. This
    // makes replay deterministic even when the process dies after reservation
    // but before external dispatch or continuation acknowledgement.
    const successor = this.database.prepare(`
      SELECT id, status FROM actions
      WHERE run_id = ? AND step_id = ? AND parent_action_id = ?
      ORDER BY created_at, id LIMIT 1
    `).get(continuation.runId, stepId, actionId) as {
      id: string;
      status: string;
    } | undefined;
    if (successor) {
      if (successor.status === "succeeded") {
        inImmediateTransaction(this.database, () => {
          this.continuations.enqueue({
            runId: continuation.runId,
            kind: "action_result_to_advance",
            sourceId: successor.id,
            payload: { actionId: successor.id, stepId },
            now: this.timestamp(),
          });
          this.completeContinuation(continuation);
        });
        return;
      }
      if (successor.status === "running" && !this.actionContexts.has(successor.id)) {
        await this.recover();
        const current = this.database.prepare("SELECT status FROM actions WHERE id = ?")
          .get(successor.id) as { status: string } | undefined;
        if (current?.status === "running" && !this.actionContexts.has(successor.id)) {
          throw new Error("Reserved retry action still has a live owner lease; recovery is not yet claimable");
        }
      }
      this.completeContinuation(continuation);
      return;
    }

    let durable = this.coordinator.getRun(continuation.runId);
    if (["blocked", "completed", "failed", "cancelled"].includes(durable.run.state)) {
      this.completeContinuation(continuation);
      return;
    }
    let lease = this.continuationLease(continuation.runId);
    if (durable.run.state === "recovering") {
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
        reason: `Bounded retry delay elapsed for ${actionId}; re-authorizing the unchanged in-contract action`,
      });
      if (!running.run.lease) {
        throw new CommandRuntimeError(500, "retry_lease_lost", "Retry lost its run lease");
      }
      lease = running.run.lease;
      durable = running.run;
    }
    if (durable.run.state !== "running") {
      throw new Error(`Autonomous retry cannot dispatch from ${durable.run.state}`);
    }
    const intent = this.repository.getStepIntent(stepId);
    await this.startRepresentedAction({ ...intent, parentActionId: actionId }, lease);
    this.completeContinuation(continuation);
  }

  private async advanceContinuation(continuation: RuntimeContinuation): Promise<void> {
    const actionId = this.continuationText(continuation, "actionId") ?? continuation.sourceId;
    const action = this.database.prepare(`
      SELECT a.step_id, a.status, a.result_summary,
        json_extract(a.normalized_arguments_json, '$.orchestration.kind') AS action_kind,
        r.journey, ps.status AS step_status, ps.plan_id
      FROM actions a
      JOIN runs r ON r.id = a.run_id
      JOIN plan_steps ps ON ps.id = a.step_id
      WHERE a.id = ? AND a.run_id = ?
    `).get(actionId, continuation.runId) as {
      step_id: string;
      status: string;
      result_summary: string | null;
      action_kind: string | null;
      journey: "autonomous" | "guided";
      step_status: string;
      plan_id: string;
    } | undefined;
    if (!action) throw new Error("Continuation action no longer exists");
    if (["completed", "skipped", "cancelled"].includes(action.step_status)) {
      this.completeContinuation(continuation);
      this.continuations.reconcileFromCanonicalState(this.timestamp());
      return;
    }
    if (action.status !== "succeeded") {
      throw new Error(`Action ${actionId} is not a successful advance predecessor`);
    }
    const lease = this.continuationLease(continuation.runId);
    const now = this.timestamp();
    let evaluationQueued = false;
    inImmediateTransaction(this.database, () => {
      const runs = new RunRepository(this.database);
      const current = runs.get(continuation.runId);
      runs.assertLease(current, lease, now);
      if (action.journey === "guided" && action.action_kind !== "manual") {
        const evidenceIds = (this.database.prepare(`
          SELECT id FROM evidence WHERE action_id = ? ORDER BY created_at, id
        `).all(actionId) as Array<{ id: string }>).map((row) => row.id);
        this.repository.recordGuidedExecutionInterpretation(
          actionId,
          action.result_summary ?? "The authorized specialist completed this exact step.",
          evidenceIds,
          now,
        );
      }
      const advanced = this.repository.advanceSuccessfulStep({
        runId: continuation.runId,
        stepId: action.step_id,
        actionId,
        journey: action.journey,
        now,
        decisionTtlMs: this.decisionTtlMs,
      });
      if (advanced.completed) {
        evaluationQueued = true;
        this.continuations.enqueue({
          runId: continuation.runId,
          kind: "evaluation_pending",
          sourceId: action.plan_id,
          now,
        });
      } else if (action.journey === "guided") {
        if (!advanced.guidedDecisionId) {
          throw new CommandRuntimeError(500, "guided_decision_missing", "Next Guided decision was not created");
        }
        this.coordinator.transitionRun({
          lease,
          to: "waiting_guided_decision",
          reason: "The previous result was interpreted and the next explained step is ready",
          guidedDecisionId: advanced.guidedDecisionId,
        });
      } else {
        if (!advanced.nextStepId) {
          throw new CommandRuntimeError(500, "next_action_missing", "Next Autonomous action is missing");
        }
        this.continuations.enqueue({
          runId: continuation.runId,
          kind: "plan_ready_to_dispatch",
          sourceId: advanced.nextStepId,
          payload: { stepId: advanced.nextStepId },
          now,
        });
      }
      this.completeContinuation(continuation);
      this.repository.events.append({
        missionId: current.run.missionId,
        runId: continuation.runId,
        journey: current.run.journey,
        eventType: "run.continuation_replayed",
        actorType: "system",
        actorId: this.workerId,
        summary: advanced.completed
          ? "Durable action result advanced to mission success evaluation"
          : current.run.journey === "guided"
            ? "Durable action result advanced to the next exact Guided decision"
            : "Durable action result advanced to the next in-contract Autonomous step",
        payload: {
          continuationId: continuation.id,
          kind: continuation.kind,
          actionId,
          nextStepId: advanced.nextStepId,
          nextGuidedDecisionId: advanced.guidedDecisionId,
        },
      });
    });
    if (evaluationQueued) {
      this.crashAfterCommit("step_advance_to_evaluation", continuation.runId, action.plan_id);
    }
  }

  private failContinuation(continuation: RuntimeContinuation, message: string): void {
    if (!continuation.leaseOwner) return;
    const now = this.timestamp();
    const durable = this.coordinator.getRun(continuation.runId);
    const lease = durable.lease?.ownerId === this.workerId
      ? durable.lease
      : (!durable.lease || Date.parse(durable.lease.expiresAt) <= Date.parse(now))
        ? this.coordinator.acquireRunLease(continuation.runId, this.workerId, this.leaseTtlMs)
        : null;
    inImmediateTransaction(this.database, () => {
      this.continuations.fail({
        id: continuation.id,
        ownerToken: continuation.leaseOwner!,
        now,
        error: message,
      });
      if (!lease || isTerminalRunState(durable.run.state) || durable.run.state === "blocked") return;
      const transition = this.coordinator.transitionRun({
        lease,
        to: "blocked",
        reason: `Durable continuation retry budget exhausted for ${continuation.kind}`,
      });
      this.repository.events.append({
        missionId: transition.run.run.missionId,
        runId: continuation.runId,
        journey: transition.run.run.journey,
        eventType: "run.continuation_blocked",
        actorType: "system",
        summary: `Run blocked after five bounded attempts to resume ${continuation.kind}`,
        payload: {
          continuationId: continuation.id,
          kind: continuation.kind,
          attempts: continuation.attemptCount,
        },
      });
    });
  }

  private async finalizeCancellationContinuation(continuation: RuntimeContinuation): Promise<void> {
    const event = this.database.prepare(`
      SELECT actor_id, summary FROM events
      WHERE id = ? AND run_id = ? AND event_type = 'run.cancellation_requested'
    `).get(continuation.sourceId, continuation.runId) as {
      actor_id: string | null;
      summary: string;
    } | undefined;
    const actorId = event?.actor_id ?? "operator";
    const reason = event?.summary.replace(/^Cancellation requested:\s*/u, "").trim()
      || "Operator requested cancellation";
    const before = this.coordinator.getRun(continuation.runId);
    if (before.run.state === "cancelled") {
      inImmediateTransaction(this.database, () => {
        this.repository.cancelOpenWork(continuation.runId, actorId, reason, this.timestamp());
        this.completeContinuation(continuation);
      });
      return;
    }
    const lease = this.continuationLease(continuation.runId);
    this.controllers.get(continuation.runId)?.abort(reason);
    await this.options.execution.cancelRun(continuation.runId, reason);
    const now = this.timestamp();
    inImmediateTransaction(this.database, () => {
      // Close child aggregates before the terminal transition creates its
      // checkpoint so the checkpoint cannot retain ghost in-flight work.
      this.repository.cancelOpenWork(continuation.runId, actorId, reason, now);
      const transition = this.coordinator.transitionRun({
        lease,
        to: "cancelled",
        reason,
      });
      this.database.prepare("UPDATE missions SET status = 'cancelled', updated_at = ? WHERE id = ?")
        .run(now, transition.run.run.missionId);
      this.repository.appendAudit({
        missionId: transition.run.run.missionId,
        runId: continuation.runId,
        actorId,
        action: "run.cancelled",
        resourceType: "run",
        resourceId: continuation.runId,
        reason,
        now,
      });
      this.learning.recordTerminalEvaluation({
        runId: continuation.runId,
        terminalStatus: "cancelled",
        createdBy: "run-supervisor",
      });
      this.completeContinuation(continuation);
      this.continuations.cancelOpen(continuation.runId, now, "Run reached a terminal cancelled state");
      this.repository.events.append({
        missionId: transition.run.run.missionId,
        runId: continuation.runId,
        journey: transition.run.run.journey,
        eventType: "run.cancelled",
        actorType: "operator",
        actorId,
        summary: `Run cancelled and all durable child work closed: ${reason}`,
        payload: { continuationId: continuation.id, aggregateClosed: true },
      });
    });
    for (const [actionId, context] of this.actionContexts) {
      if (context.action.runId !== continuation.runId) continue;
      if (context.heartbeat) clearInterval(context.heartbeat);
      this.actionContexts.delete(actionId);
    }
  }

  private async processRun(runId: string, planningRetryContinuationId?: string): Promise<void> {
    let planningRun = this.repository.getPlanningRun(runId);
    if (planningRun.state !== "planning" && planningRun.state !== "recovering") return;
    const mission = this.repository.getMission(planningRun.missionId);
    const guidedRecovery = planningRun.journey === "guided"
      ? this.repository.latestGuidedRecovery(runId)
      : null;
    const durableAtStart = this.coordinator.getRun(runId);
    const scheduledPlanningRetry = durableAtStart.control.planningRetry;
    if (scheduledPlanningRetry) {
      if (
        planningRetryContinuationId !== scheduledPlanningRetry.continuationId ||
        Date.parse(scheduledPlanningRetry.notBefore) > Date.parse(this.timestamp())
      ) return;
    }
    const recovery = durableAtStart.control.recovery;
    if (
      planningRun.journey === "autonomous" && planningRun.state === "recovering" &&
      recovery?.kind === "retry" && Date.parse(recovery.notBefore) > Date.parse(this.timestamp())
    ) return;
    let lease = durableAtStart.lease?.ownerId === this.workerId
      ? durableAtStart.lease
      : this.coordinator.acquireRunLease(runId, this.workerId, this.leaseTtlMs);
    if (scheduledPlanningRetry && planningRetryContinuationId) {
      const begun = this.coordinator.beginScheduledPlanningRetry({
        lease,
        continuationId: planningRetryContinuationId,
      });
      if (!begun.run.lease) {
        throw new CommandRuntimeError(500, "planning_retry_lease_lost", "Planning retry lost its run lease");
      }
      lease = begun.run.lease;
      planningRun = this.repository.getPlanningRun(runId);
      this.crashAfterCommit("planning_retry_started", runId, planningRetryContinuationId);
    }
    if (planningRun.journey === "autonomous" && planningRun.state === "recovering" && recovery?.kind === "retry") {
      // The failed action committed a delayed, owner-fenced continuation in
      // the same transaction that requeued its exact assignment and step.
      // Never reconstruct retry work from an in-memory timer.
      await this.replayContinuations(runId, ["autonomous_retry_to_dispatch"]);
      return;
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
    let planningProviderFailed = false;
    const signal = this.controller(runId).signal;
    try {
      if (mission.authorizationStatus !== "verified") {
        throw new CommandRuntimeError(409, "authorization_not_verified", "Mission authorization is not verified", {
          humanMessage: "Execution stopped because the mission authorization is not currently valid.",
          category: "authorization_denied",
        });
      }
      let planned: MissionPlanPortResult;
      try {
        planned = planResult(await this.options.planner.plan({
            mission,
            run: planningRun,
            ...(guidedRecovery ? {
              rejectionReason: `The represented action "${guidedRecovery.attemptedActionSummary}" failed with ${guidedRecovery.errorCategory}: ${guidedRecovery.failureSummary}. Propose one materially different in-scope action; do not repeat the failed parameters.`,
            } : recovery?.kind === "replan" ? {
              // beginReplan intentionally moves the run from recovering to
              // planning before this provider turn. Preserve the durable,
              // operator-supplied strategy across that transition so a replay
              // cannot silently fall back to an equivalent plan.
              rejectionReason: recovery.reason,
            } : planningRun.state === "recovering" ? { rejectionReason: planningRun.stateReason } : {}),
          }, signal));
      } catch (error) {
        planningProviderFailed = true;
        throw error;
      }
      const draft = validateMissionPlanDraft(
        planned.plan,
        this.maxPlanSteps,
        planningRun.journey,
      );
      lease = await heartbeat.stop();
      heartbeatStopped = true;
      lease = this.accountProviderUsage(lease, planned.usage, "mission planning");
      const activationAt = this.timestamp();
      const committed = inImmediateTransaction(this.database, () => {
        const plan = this.repository.persistPlanRecords({
          mission,
          run: planningRun,
          lease,
          plan: draft,
          now: activationAt,
          decisionTtlMs: this.decisionTtlMs,
          ...(guidedRecovery ? { guidedRecovery } : {}),
        });
        commitPlanningContextAttribution(
          this.database,
          planned.plan.planningAttribution,
          {
            missionId: mission.id,
            runId,
            journey: planningRun.journey,
            usedAt: activationAt,
          },
        );
        if (planningRun.journey === "guided") {
          this.database.prepare(`
            UPDATE plan_steps SET status = 'waiting_guided_decision', updated_at = ? WHERE id = ?
          `).run(activationAt, plan.firstStepId);
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
        if (planningRun.journey === "autonomous") {
          this.continuations.enqueue({
            runId,
            kind: "plan_ready_to_dispatch",
            sourceId: plan.planId,
            payload: { stepId: plan.firstStepId },
            now: activationAt,
          });
        }
        return { plan, transition };
      });
      if (planningRun.journey === "autonomous") {
        this.crashAfterCommit("plan_ready_to_dispatch", runId, committed.plan.planId);
      }
      if (planningRun.journey === "autonomous") {
        if (!committed.transition.run.lease) {
          throw new CommandRuntimeError(500, "runtime_lease_lost", "Autonomous launch lost its lease");
        }
        if (!this.continuationProcessing.has(runId)) {
          await this.replayContinuations(runId, ["plan_ready_to_dispatch"]);
        }
      }
    } catch (error) {
      if (!heartbeatStopped) lease = await heartbeat.stop().catch(() => lease);
      if (error instanceof RuntimeCrashAfterCommit) throw error;
      let runtimeError = asRuntimeError(error);
      if (planningProviderFailed) {
        const category = planningFailureCategory(error, runtimeError);
        const canRetry = planningRun.journey === "autonomous"
          && isRetryableCategory(category)
          && runtimeError.options.retryable !== false;
        if (canRetry) {
          const retryAfterMs = planningRetryAfterMs(error, this.now());
          const scheduled = this.coordinator.schedulePlanningRetry({
            lease,
            category,
            errorCode: runtimeError.code,
            ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
            ...(this.options.retryRandom ? { random: this.options.retryRandom } : {}),
          });
          if (scheduled.scheduled) {
            this.crashAfterCommit("planning_retry_scheduled", runId, scheduled.continuationId);
            return;
          }
          const exhausted = scheduled.reason === "signed_budget_exhausted"
            ? ` The signed ${scheduled.exhausted.join(", ")} budget leaves no room for another provider turn.`
            : " The default bounded retry allowance of two automatic retries is exhausted.";
          runtimeError = new CommandRuntimeError(
            429,
            `mission_runtime_${category}_retry_exhausted`,
            "Autonomous planning retry path exhausted",
            {
              humanMessage: `Safe-stopped: Autonomous planning remained unavailable after ${this.coordinator.getRun(runId).control.retryCount} bounded automatic retries.${exhausted}`,
              retryable: false,
              category,
              details: {
                retriesUsed: this.coordinator.getRun(runId).control.retryCount,
                retryReason: scheduled.reason,
                exhausted: [...scheduled.exhausted],
              },
              remediation: "Wait for the provider window to recover, then start a new run or explicitly resume from the preserved checkpoint.",
            },
          );
        }
        const accounted = this.coordinator.accountUsage({
          lease,
          delta: { providerTurns: 1 },
          phase: "failed mission planning turn",
        });
        if (accounted.allowed && accounted.run.lease) lease = accounted.run.lease;
      }
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
      if (error instanceof RuntimeCrashAfterCommit) throw error;
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
      if (result.success && completed.directive === "continue") {
        this.crashAfterCommit("action_result_to_advance", result.runId, result.actionId);
      } else if (!result.success && completed.directive === "recover") {
        this.crashAfterCommit("guided_failure_to_recover", result.runId, result.actionId);
      }
      if (
        (result.success && completed.directive === "continue") ||
        completed.directive === "recover" ||
        completed.run.run.state === "failed"
      ) {
        await this.replayContinuations(result.runId);
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
      if (error instanceof RuntimeCrashAfterCommit) throw error;
      throw asRuntimeError(error);
    }
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
    const existingDecision = this.repository.getDecision(decisionId);
    if (existingDecision.status !== "pending") {
      const existing = this.database.prepare(`
        SELECT id FROM actions WHERE guided_decision_id = ? ORDER BY created_at LIMIT 1
      `).get(decisionId) as { id: string } | undefined;
      if (existingDecision.status === "approved" && existing) return new ActionRepository(this.database).get(existing.id);
      throw new CommandRuntimeError(409, "guided_decision_not_pending", "Only a pending Guided decision can be approved");
    }
    const now = this.timestamp();
    const decision = this.repository.requireCurrentPendingDecision(decisionId);
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
    if (Date.parse(decision.expiresAt) <= Date.parse(now)) {
      this.database.prepare("UPDATE guided_decisions SET status = 'expired' WHERE id = ? AND status = 'pending'").run(decisionId);
      throw new CommandRuntimeError(409, "guided_decision_expired", "The Guided decision expired");
    }
    inImmediateTransaction(this.database, () => {
      // Repeat the complete boundary under the write reservation so a plan,
      // step, or current-decision change cannot race the status mutation.
      this.repository.requireCurrentPendingDecision(decisionId);
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
      this.continuations.enqueue({
        runId: decision.runId,
        kind: "guided_approval_to_dispatch",
        sourceId: decisionId,
        payload: { decisionId, stepId: decision.stepId },
        now,
      });
    });
    this.crashAfterCommit("guided_approval_to_dispatch", decision.runId, decisionId);
    await this.replayContinuations(decision.runId, ["guided_approval_to_dispatch"]);
    const created = this.database.prepare(`
      SELECT id FROM actions WHERE guided_decision_id = ? ORDER BY created_at, id LIMIT 1
    `).get(decisionId) as { id: string } | undefined;
    if (!created) {
      throw new CommandRuntimeError(503, "guided_dispatch_pending", "Approved Guided action is durably queued", {
        humanMessage: "The exact Guided decision is approved and will resume automatically from its durable continuation.",
        retryable: true,
        category: "runtime",
      });
    }
    return new ActionRepository(this.database).get(created.id);
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
      if (advanced.completed) {
        const plan = this.database.prepare("SELECT plan_id FROM plan_steps WHERE id = ?")
          .get(decision.stepId) as { plan_id: string };
        this.continuations.enqueue({
          runId: decision.runId,
          kind: "evaluation_pending",
          sourceId: plan.plan_id,
          now,
        });
      }
      if (!persisted.lease) {
        throw new CommandRuntimeError(500, "runtime_lease_lost", "Guided skip lost its run lease");
      }
      return { advanced, lease: persisted.lease };
    });
    if (committed.advanced.completed) {
      await this.replayContinuations(decision.runId, ["evaluation_pending"]);
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
    const existingDecision = this.repository.getDecision(decisionId);
    if (existingDecision.status === "rejected") return;
    if (existingDecision.status !== "pending") throw new CommandRuntimeError(409, "guided_decision_not_pending", "Only a pending decision can be rejected");
    const decision = this.repository.requireCurrentPendingDecision(decisionId);
    const lease = this.controlLease(decision.runId);
    inImmediateTransaction(this.database, () => {
      this.repository.requireCurrentPendingDecision(decisionId);
      const updated = this.database.prepare(`
        UPDATE guided_decisions SET status = 'rejected', decision_actor = ?, decision_reason = ?, decided_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(actorId, normalizedReason, this.timestamp(), decisionId);
      if (updated.changes !== 1) {
        throw new CommandRuntimeError(409, "guided_decision_conflict", "Decision changed concurrently");
      }
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
      this.continuations.enqueue({
        runId: decision.runId,
        kind: "resume_recovery_pending",
        sourceId: decisionId,
        payload: { decisionId },
        now: this.timestamp(),
      });
    });
    await this.replayContinuations(decision.runId, ["resume_recovery_pending"]);
  }

  async submitManualGuidedResult(
    decisionId: string,
    actorId: string,
    summary: string,
    interpretedEvidenceId?: string,
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
      const linked = this.database.prepare(`
        SELECT id FROM evidence WHERE action_id = ? AND verification_state = 'verified'
        ORDER BY created_at, id LIMIT 1
      `).get(existing.id) as { id: string } | undefined;
      const evidence = linked
        ? { id: linked.id }
        : this.repository.transaction(() => interpretedEvidenceId
          ? this.repository.promoteInterpretedGuidedEvidence({
              decision,
              actionId: existing.id,
              evidenceId: interpretedEvidenceId,
              actorId,
              now: this.timestamp(),
            })
          : this.repository.createManualEvidence({
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
    const { accepted, runningLease } = inImmediateTransaction(this.database, () => {
      const runs = new RunRepository(this.database);
      const current = runs.get(decision.runId);
      runs.assertLease(current, lease, now);
      if (
        current.run.journey !== "guided" ||
        current.run.state !== "waiting_guided_decision"
      ) {
        throw new CommandRuntimeError(409, "guided_run_not_waiting", "Guided run is not waiting for this exact result");
      }
      const updated = this.database.prepare(`
        UPDATE guided_decisions SET status = 'manual', decision_actor = ?, decision_reason = ?, decided_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(actorId, "Operator supplied the result for the represented action", now, decisionId);
      if (updated.changes !== 1) throw new CommandRuntimeError(409, "guided_decision_conflict", "Decision changed concurrently");
      const created = this.repository.createManualAction({ decision, summary: normalized, now });
      const evidence = interpretedEvidenceId
        ? this.repository.promoteInterpretedGuidedEvidence({
            decision,
            actionId: created,
            evidenceId: interpretedEvidenceId,
            actorId,
            now,
          })
        : this.repository.createManualEvidence({
            decision,
            actionId: created,
            actorId,
            content: normalized,
            now,
          });
      this.repository.events.append({
        missionId: decision.missionId, runId: decision.runId, journey: "guided",
        eventType: "guided.manual_result_recorded", actorType: "operator", actorId,
        summary: interpretedEvidenceId
          ? "Operator accepted the interpreted evidence for the exact Guided action"
          : "Operator recorded the result for the exact Guided action",
        payload: {
          decisionId,
          actionId: created,
          actionFingerprint: decision.actionFingerprint,
          evidenceId: evidence.id,
          interpretedBeforeAdvance: Boolean(interpretedEvidenceId),
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
        evidenceIds: [...new Set([...(current.control.progress.evidenceIds ?? []), evidence.id])],
        resolvedDecisionIds: [...new Set([...(current.control.progress.resolvedDecisionIds ?? []), decisionId])],
        verifiedWorkerResultIds: [...new Set([...(current.control.progress.verifiedWorkerResultIds ?? []), created])],
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
      this.continuations.enqueue({
        runId: decision.runId,
        kind: "action_result_to_advance",
        sourceId: created,
        payload: { actionId: created, stepId: decision.stepId },
        now,
      });
      if (!persisted.lease) throw new CommandRuntimeError(500, "runtime_lease_lost", "Manual result lost its run lease");
      return {
        accepted: { actionId: created, evidence },
        runningLease: persisted.lease,
      };
    });
    // Manual work resolves the exact decision without dispatching a duplicate
    // provider action. Decision, immutable evidence, progress, state, event,
    // and checkpoint are committed atomically before execution advances.
    void runningLease;
    this.crashAfterCommit("manual_result_to_advance", decision.runId, accepted.actionId);
    await this.replayContinuations(decision.runId, ["action_result_to_advance", "evaluation_pending"]);
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
    const inFlight = this.database.prepare(`
      SELECT id FROM actions WHERE run_id = ? AND status IN ('queued', 'running') LIMIT 1
    `).get(runId) as { id: string } | undefined;
    if (inFlight) {
      throw new CommandRuntimeError(409, "pause_requires_safe_checkpoint", "An in-flight action cannot be safely paused", {
        humanMessage: "Pause is available at a durable checkpoint; cancel if active child work must stop now.",
        category: "conflict",
      });
    }
    const lease = this.controlLease(runId);
    const current = this.coordinator.getRun(runId);
    if (current.run.state === "blocked") {
      const paused = this.database.prepare(`
        SELECT id FROM audit_records
        WHERE run_id = ? AND action = 'run.paused'
        ORDER BY occurred_at DESC, id DESC LIMIT 1
      `).get(runId) as { id: string } | undefined;
      if (paused) return;
      throw new CommandRuntimeError(409, "run_blocked_not_paused", "Blocked run requires recovery rather than pause");
    }
    const now = this.timestamp();
    inImmediateTransaction(this.database, () => {
      const result = this.coordinator.transitionRun({
        lease,
        to: "blocked",
        reason: `Paused by operator: ${normalized}`,
      });
      this.database.prepare("UPDATE missions SET status = 'paused', updated_at = ? WHERE id = ?")
        .run(now, result.run.run.missionId);
      this.repository.appendAudit({
        missionId: result.run.run.missionId, runId, actorId, action: "run.paused",
        resourceType: "run", resourceId: runId, reason: normalized, now,
      });
    });
    this.crashAfterCommit("pause_projection_committed", runId);
  }

  resumeRun(runId: string, actorId: string, reason: string): void {
    const normalized = validateReason(reason);
    const successor = this.database.prepare(`
      SELECT rb.run_id, r.status
      FROM run_branches rb
      JOIN runs r ON r.id = rb.run_id
      WHERE rb.source_run_id = ?
      ORDER BY rb.created_at DESC, rb.id DESC LIMIT 1
    `).get(runId) as { run_id: string; status: string } | undefined;
    if (successor) {
      throw new CommandRuntimeError(409, "run_superseded_by_branch", "A branched source run cannot resume", {
        humanMessage: "This paused run was superseded by an explicit new execution attempt and cannot run alongside it.",
        category: "conflict",
        details: { successorRunId: successor.run_id, successorStatus: successor.status },
      });
    }
    const current = this.coordinator.getRun(runId);
    if (current.run.state !== "blocked") throw new CommandRuntimeError(409, "run_not_paused", "Only a blocked run can resume");
    const recoveryRetry = current.run.journey === "autonomous" && current.control.recovery?.kind === "retry"
      ? this.database.prepare(`
          SELECT a.id AS action_id, a.step_id
          FROM actions a JOIN runs r ON r.id = a.run_id
          WHERE a.id = ? AND a.run_id = ? AND a.status IN ('failed', 'timed_out')
            AND r.current_step_id = a.step_id
        `).get(current.control.recovery.failedActionId, runId) as {
          action_id: string;
          step_id: string;
        } | undefined
      : undefined;
    if (current.control.recovery?.kind === "retry" && current.run.journey === "autonomous" && !recoveryRetry) {
      throw new CommandRuntimeError(409, "recovery_retry_predecessor_stale", "The exact recovery predecessor is no longer current", {
        humanMessage: "Refresh recovery state; the failed predecessor no longer matches the current step.",
        category: "conflict",
      });
    }
    const lease = this.controlLease(runId);
    let target: RunState = "recovering";
    let continuationKind: RuntimeContinuationKind = "resume_recovery_pending";
    const now = this.timestamp();
    inImmediateTransaction(this.database, () => {
      const pending = this.database.prepare(`
        SELECT id FROM guided_decisions WHERE run_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1
      `).get(runId) as { id: string } | undefined;
      target = current.run.journey === "guided" && pending ? "waiting_guided_decision" : "recovering";
      const transitioned = this.coordinator.transitionRun({
        lease,
        to: target,
        reason: `Resumed by operator: ${normalized}`,
        ...(pending ? { guidedDecisionId: pending.id } : {}),
      });
      this.database.prepare("UPDATE missions SET status = 'active', updated_at = ? WHERE id = ?")
        .run(now, current.run.missionId);
      this.repository.appendAudit({
        missionId: current.run.missionId, runId, actorId, action: "run.resumed",
        resourceType: "run", resourceId: runId, reason: normalized, now,
      });
      if (target === "recovering") {
        if (recoveryRetry) {
          continuationKind = "autonomous_retry_to_dispatch";
          this.continuations.enqueue({
            runId,
            kind: continuationKind,
            sourceId: recoveryRetry.action_id,
            payload: { actionId: recoveryRetry.action_id, stepId: recoveryRetry.step_id },
            now,
          });
        } else {
          this.continuations.enqueue({
            runId,
            kind: continuationKind,
            sourceId: String(transitioned.run.run.stateVersion),
            now,
          });
        }
      }
    });
    this.crashAfterCommit("resume_projection_committed", runId);
    if (target === "recovering") void this.replayContinuations(runId, [continuationKind]);
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
        await this.replayContinuations(runId, ["evaluation_pending"]);
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
    await this.replayContinuations(runId, ["evaluation_pending"]);
  }
}

export function createMissionRuntime(options: MissionRuntimeOptions): MissionRuntimeEngine {
  return new MissionRuntimeEngine(options);
}
