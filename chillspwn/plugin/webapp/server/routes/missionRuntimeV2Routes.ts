import { Router, type Request, type Response } from "express";
import {
  CommandRuntimeError,
  type MissionRuntimeEngine,
} from "../command-runtime";
import type {
  RuntimeIdempotencyFailure,
  RuntimeIdempotencyReconciliation,
} from "../command-runtime/RuntimeRepository";
import { ControlPlaneLeaseError } from "../control-plane";
import { DurableOrchestrationError } from "../orchestration";
import type { JsonValue } from "../events";
import { canonicalJson, hashCanonical } from "../missions/canonical";
import type { RunState } from "../supervisor";
import { redactSensitiveText } from "../guided-commander/validation";
import { attachV2RequestId, sendV2Error } from "../contracts/ApiErrorContract";

export interface MissionRuntimeV2RouterDependencies {
  readonly runtime: MissionRuntimeEngine;
  readonly resolveActor: (request: Request) => string;
}

function runtimeError(error: unknown): CommandRuntimeError {
  if (error instanceof CommandRuntimeError) return error;
  if (error instanceof ControlPlaneLeaseError) {
    return new CommandRuntimeError(
      error.code === "run_not_found" ? 404 : 409,
      `control_plane_${error.code}`,
      error.message,
      {
        humanMessage: error.code === "control_plane_mismatch"
          ? "This run belongs to another control plane and Command OS V2 refused to mutate it."
          : "Command OS V2 could not prove exclusive mutation authority for this run.",
        retryable: error.retryable,
        category: error.code === "run_not_found" ? "not_found" : "conflict",
        remediation: error.retryable
          ? "Wait for the current fenced controller to release or expire, then refresh the Recovery Panel."
          : "Open the run through its owning control plane; do not attempt concurrent control.",
      },
    );
  }
  if (error instanceof DurableOrchestrationError) {
    const missing = error.code.endsWith("_not_found");
    return new CommandRuntimeError(missing ? 404 : 409, error.code, error.message, {
      humanMessage: error.message,
      category: missing ? "not_found" : "runtime",
    });
  }
  return new CommandRuntimeError(500, "command_runtime_internal_error", "Command runtime request failed", {
    humanMessage: "The runtime could not safely complete this request.",
    category: "internal",
    remediation: "Use the trace ID to inspect structured runtime events before retrying.",
  });
}

function sendError(response: Response, error: unknown, traceId: string): void {
  const known = runtimeError(error);
  sendV2Error(response, traceId, {
    status: known.status,
    code: known.code,
    message: known.message,
    humanMessage: known.options.humanMessage ?? known.message,
    retryable: known.options.retryable ?? false,
    category: known.options.category ?? "runtime",
    ...(known.options.details === undefined ? {} : { details: known.options.details }),
    ...(known.options.remediation ? { remediation: known.options.remediation } : {}),
  });
}

function sanitizedErrorDetails(value: JsonValue | undefined): JsonValue | undefined {
  if (value === undefined) return undefined;
  try {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, "utf8") > 32 * 1024) return undefined;
    return JSON.parse(redactSensitiveText(serialized).text) as JsonValue;
  } catch {
    return undefined;
  }
}

function replayableRuntimeError(error: unknown): CommandRuntimeError {
  const known = runtimeError(error);
  const safe = (value: string, fallback: string, maximum: number): string => {
    const redacted = redactSensitiveText(value).text.trim();
    return (redacted || fallback).slice(0, maximum);
  };
  const details = sanitizedErrorDetails(known.options.details);
  return new CommandRuntimeError(
    known.status >= 400 && known.status <= 599 ? known.status : 500,
    safe(known.code, "command_runtime_internal_error", 160),
    safe(known.message, "Command runtime request failed", 2_000),
    {
      humanMessage: safe(
        known.options.humanMessage ?? known.message,
        "The runtime could not safely complete this request.",
        4_000,
      ),
      retryable: known.options.retryable ?? false,
      category: safe(known.options.category ?? "runtime", "runtime", 160),
      ...(details === undefined ? {} : { details }),
      ...(known.options.remediation
        ? { remediation: safe(known.options.remediation, "Inspect current canonical state before retrying.", 4_000) }
        : {}),
    },
  );
}

function idempotencyFailure(error: CommandRuntimeError): RuntimeIdempotencyFailure {
  return {
    status: error.status,
    code: error.code,
    message: error.message,
    humanMessage: error.options.humanMessage ?? error.message,
    retryable: error.options.retryable ?? false,
    category: error.options.category ?? "runtime",
    ...(error.options.details === undefined ? {} : { details: error.options.details }),
    ...(error.options.remediation ? { remediation: error.options.remediation } : {}),
  };
}

function errorFromFailure(failure: RuntimeIdempotencyFailure): CommandRuntimeError {
  return new CommandRuntimeError(failure.status, failure.code, failure.message, {
    humanMessage: failure.humanMessage,
    retryable: failure.retryable,
    category: failure.category,
    ...(failure.details === undefined ? {} : { details: failure.details }),
    ...(failure.remediation ? { remediation: failure.remediation } : {}),
  });
}

function actor(dependencies: MissionRuntimeV2RouterDependencies, request: Request): string {
  const value = dependencies.resolveActor(request).trim();
  if (!value) {
    throw new CommandRuntimeError(401, "operator_identity_required", "Operator identity is required", {
      humanMessage: "Sign in before making a mission control decision.",
      category: "authentication_missing",
    });
  }
  return value;
}

function idempotencyKey(request: Request): string {
  const value = request.get("Idempotency-Key")?.trim();
  if (!value || !/^[a-zA-Z0-9._:-]{8,200}$/u.test(value)) {
    throw new CommandRuntimeError(400, "idempotency_key_required", "A valid Idempotency-Key is required", {
      humanMessage: "This mutation requires a stable submission key so it cannot run twice.",
      category: "invalid_input",
    });
  }
  return value;
}

function pathId(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new CommandRuntimeError(400, "invalid_resource_id", `${label} is invalid`, {
      category: "invalid_input",
    });
  }
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9._:-]{1,240}$/u.test(normalized)) {
    throw new CommandRuntimeError(400, "invalid_resource_id", `${label} is invalid`, {
      category: "invalid_input",
    });
  }
  return normalized;
}

function bodyObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CommandRuntimeError(400, "invalid_request_body", "Request body must be an object", {
      category: "invalid_input",
    });
  }
  return value as Record<string, unknown>;
}

function optionalReason(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.trim().length > 2_000) {
    throw new CommandRuntimeError(400, "invalid_reason", "Reason must be a non-empty string up to 2,000 characters", {
      category: "invalid_input",
    });
  }
  const normalized = value.trim().normalize("NFKC");
  if (redactSensitiveText(normalized).redactionCount > 0) {
    throw new CommandRuntimeError(422, "sensitive_material_not_retained", "Operator reason contains authentication material", {
      humanMessage: "The operator reason was rejected because immutable decision and audit records cannot retain credentials or authentication material.",
      category: "policy_denied",
      remediation: "Remove the sensitive value and reference protected evidence or credentials by an opaque ID.",
    });
  }
  return normalized;
}

function requiredReason(value: unknown): string {
  const reason = optionalReason(value);
  if (!reason) throw new CommandRuntimeError(400, "reason_required", "A reason is required", { category: "invalid_input" });
  return reason;
}

interface ResumeRunBoundary {
  readonly expectedRunVersion: number;
  readonly expectedRunStatus: "blocked";
  readonly expectedCheckpointId: string;
  readonly expectedCheckpointStateHash: string;
  readonly expectedCheckpointEventSequence: number;
}

function requiredPositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new CommandRuntimeError(400, "invalid_resume_boundary", `${label} must be a positive integer`, {
      humanMessage: "Refresh the run before resuming; its exact version boundary is missing or invalid.",
      category: "invalid_input",
    });
  }
  return Number(value);
}

function requiredNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new CommandRuntimeError(400, "invalid_resume_boundary", `${label} must be a non-negative integer`, {
      humanMessage: "Refresh the run before resuming; its exact checkpoint sequence is missing or invalid.",
      category: "invalid_input",
    });
  }
  return Number(value);
}

function resumeBoundary(body: Record<string, unknown>): ResumeRunBoundary {
  if (body.expectedRunStatus !== "blocked") {
    throw new CommandRuntimeError(400, "invalid_resume_boundary", "Expected run status must be blocked", {
      humanMessage: "Resume is available only for the exact blocked run state shown in the Recovery Panel.",
      category: "invalid_input",
    });
  }
  if (
    typeof body.expectedCheckpointStateHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(body.expectedCheckpointStateHash)
  ) {
    throw new CommandRuntimeError(400, "invalid_resume_boundary", "Expected checkpoint state hash is invalid", {
      humanMessage: "Refresh the run before resuming; its verified checkpoint digest is missing or invalid.",
      category: "invalid_input",
    });
  }
  return {
    expectedRunVersion: requiredPositiveInteger(body.expectedRunVersion, "Expected run version"),
    expectedRunStatus: "blocked",
    expectedCheckpointId: pathId(body.expectedCheckpointId, "expectedCheckpointId"),
    expectedCheckpointStateHash: body.expectedCheckpointStateHash,
    expectedCheckpointEventSequence: requiredNonNegativeInteger(
      body.expectedCheckpointEventSequence,
      "Expected checkpoint event sequence",
    ),
  };
}

function expectedFingerprint(body: Record<string, unknown>, actual: string): void {
  if (typeof body.expectedFingerprint !== "string" || body.expectedFingerprint !== actual) {
    throw new CommandRuntimeError(409, "guided_action_changed", "Expected action fingerprint does not match", {
      humanMessage: "The Guided action card changed or was stale. Review the current exact step before deciding.",
      category: "conflict",
    });
  }
}

function expectedParameters(body: Record<string, unknown>, actual: JsonValue): string {
  if (!Object.prototype.hasOwnProperty.call(body, "expectedParameters")) {
    throw new CommandRuntimeError(400, "expected_parameters_required", "Exact represented parameters are required", {
      humanMessage: "Refresh the Guided action card before using this exact-step control.",
      category: "invalid_input",
    });
  }
  let supplied: string;
  let represented: string;
  try {
    supplied = canonicalJson(body.expectedParameters);
    represented = canonicalJson(actual);
  } catch {
    throw new CommandRuntimeError(400, "invalid_expected_parameters", "Expected parameters must be valid JSON", {
      category: "invalid_input",
    });
  }
  if (supplied !== represented) {
    throw new CommandRuntimeError(409, "guided_parameters_changed", "Expected represented parameters do not match", {
      humanMessage: "The Guided action parameters changed or were stale. Review the current exact step before deciding.",
      category: "conflict",
    });
  }
  return hashCanonical(actual);
}

function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

/** Mount after authentication and JSON parsing middleware. */
export function createMissionRuntimeV2Router(
  dependencies: MissionRuntimeV2RouterDependencies,
): Router {
  const router = Router();
  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  const route = (
    handler: (request: Request, response: Response, traceId: string) => void | Promise<void>,
  ) => async (request: Request, response: Response) => {
    const traceId = attachV2RequestId(request, response);
    try {
      await handler(request, response, traceId);
    } catch (error) {
      sendError(response, error, traceId);
    }
  };

  router.get("/api/v2/missions/:missionId/runtime", route((request, response) => {
    const missionId = pathId(request.params.missionId, "missionId");
    response.json({ schemaVersion: "2.4", ...dependencies.runtime.repository.getMissionRuntime(missionId) });
  }));

  router.get("/api/v2/runs", route((request, response) => {
    const allowedStates = new Set([
      "queued", "planning", "awaiting_contract_confirmation", "running",
      "waiting_guided_decision", "blocked", "recovering", "completed", "failed", "cancelled",
    ]);
    const journey = typeof request.query.journey === "string" ? request.query.journey.trim() : undefined;
    if (journey && journey !== "autonomous" && journey !== "guided") {
      throw new CommandRuntimeError(400, "invalid_journey_filter", "Run journey filter is invalid", { category: "invalid_input" });
    }
    const status = typeof request.query.status === "string" ? request.query.status.trim() : undefined;
    if (status && !allowedStates.has(status)) {
      throw new CommandRuntimeError(400, "invalid_run_status", "Run status filter is invalid", { category: "invalid_input" });
    }
    const query = typeof request.query.query === "string" ? request.query.query.trim() : undefined;
    if (query && query.length > 300) {
      throw new CommandRuntimeError(400, "invalid_run_search", "Run search is too long", { category: "invalid_input" });
    }
    const limit = request.query.limit === undefined ? 50 : Number(request.query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new CommandRuntimeError(400, "invalid_pagination", "Run limit must be 1 through 100", { category: "invalid_input" });
    }
    response.json({
      schemaVersion: "2.4",
      items: dependencies.runtime.repository.listRunProjections({
        ...(query ? { query } : {}),
        ...(journey ? { journey: journey as "autonomous" | "guided" } : {}),
        ...(status ? { status: status as RunState } : {}),
        limit,
      }),
    });
  }));

  router.get("/api/v2/runs/:runId", route((request, response) => {
    const runId = pathId(request.params.runId, "runId");
    response.json({
      schemaVersion: "2.4",
      run: dependencies.runtime.repository.getRunProjection(runId),
      latestCheckpoint: dependencies.runtime.coordinator.getLatestCheckpoint(runId) ?? null,
    });
  }));

  router.get("/api/v2/runs/:runId/plans", route((request, response) => {
    const runId = pathId(request.params.runId, "runId");
    dependencies.runtime.repository.getRunProjection(runId);
    response.json({ schemaVersion: "2.4", items: dependencies.runtime.repository.listPlans(runId) });
  }));

  router.get("/api/v2/decisions", route((request, response) => {
    const allowed = new Set(["pending", "approved", "manual", "alternative", "rejected", "expired", "cancelled"]);
    const status = typeof request.query.status === "string" ? request.query.status.trim() : undefined;
    if (status && !allowed.has(status)) {
      throw new CommandRuntimeError(400, "invalid_decision_status", "Decision status filter is invalid", { category: "invalid_input" });
    }
    const runId = typeof request.query.runId === "string" ? pathId(request.query.runId, "runId") : undefined;
    const query = typeof request.query.query === "string" ? request.query.query.trim() : undefined;
    if (query && query.length > 300) {
      throw new CommandRuntimeError(400, "invalid_decision_search", "Decision search is too long", { category: "invalid_input" });
    }
    const limit = request.query.limit === undefined ? 100 : Number(request.query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new CommandRuntimeError(400, "invalid_pagination", "Decision limit must be 1 through 100", { category: "invalid_input" });
    }
    response.json({
      schemaVersion: "2.4",
      items: dependencies.runtime.repository.listDecisions({ status, runId, query, limit }),
    });
  }));

  const assertMutationReceiptOwnership = (scope: string, request: Request): void => {
    if (scope.startsWith("decision.")) {
      const decisionId = pathId(request.params.decisionId, "decisionId");
      const decision = dependencies.runtime.repository.getDecision(decisionId);
      dependencies.runtime.assertV2ControlPlaneOwnership(decision.runId);
      return;
    }
    if (scope.startsWith("run.")) {
      dependencies.runtime.assertV2ControlPlaneOwnership(pathId(request.params.runId, "runId"));
    }
  };

  type MutationReconciler = (
    request: Request,
    operatorId: string,
    auditDetails: JsonValue,
  ) => Promise<JsonValue> | JsonValue;

  const mutation = (
    scope: string,
    handler: (request: Request, operatorId: string) => Promise<JsonValue> | JsonValue,
    replayGuard?: (request: Request, replay: JsonValue) => void,
    reconciler?: MutationReconciler,
  ) => route(async (request, response) => {
    const key = idempotencyKey(request);
    const operatorId = actor(dependencies, request);
    // Idempotency belongs to the authenticated actor as well as the request
    // shape. A response accepted for one operator must never be replayed to a
    // different operator who happens to reuse the same key and payload.
    const requestIdentity = { actorId: operatorId, params: request.params, body: request.body ?? {} };
    const reservation = dependencies.runtime.repository.reserveIdempotent(
      scope,
      key,
      requestIdentity,
      operatorId,
      new Date().toISOString(),
    );
    if (reservation.status === "replay") {
      assertMutationReceiptOwnership(scope, request);
      replayGuard?.(request, reservation.response);
      response.json(reservation.response);
      return;
    }
    if (reservation.status === "failure") {
      assertMutationReceiptOwnership(scope, request);
      throw errorFromFailure(reservation.error);
    }

    let receiptHeartbeatError: unknown;
    const heartbeat = setInterval(() => {
      try {
        dependencies.runtime.repository.heartbeatIdempotent(
          scope,
          key,
          requestIdentity,
          reservation.ownerToken,
          operatorId,
          new Date().toISOString(),
        );
        receiptHeartbeatError = undefined;
      } catch (error) {
        receiptHeartbeatError = error;
      }
    }, 30_000);
    heartbeat.unref?.();

    let payload: JsonValue;
    try {
      let reconciliation: RuntimeIdempotencyReconciliation | undefined;
      if (reservation.recoveryRequired) {
        assertMutationReceiptOwnership(scope, request);
        reconciliation = dependencies.runtime.repository.reconcileIdempotentReservation(
          scope,
          key,
          requestIdentity,
          reservation.ownerToken,
          operatorId,
          new Date().toISOString(),
        );
      }
      if (reconciliation?.status === "committed") {
        if (!reconciler) {
          throw new CommandRuntimeError(409, "idempotency_reconciliation_unavailable", "Committed command has no response reconciler", {
            humanMessage: "The prior command changed canonical state, but this endpoint cannot safely reconstruct its response.",
            category: "data_integrity",
            remediation: "Refresh the affected resource and do not repeat the mutation with a new key.",
          });
        }
        payload = await reconciler(request, operatorId, reconciliation.auditDetails);
        replayGuard?.(request, payload);
      } else if (reconciliation?.status === "indeterminate") {
        throw new CommandRuntimeError(409, "idempotency_reconciliation_indeterminate", "Interrupted command cannot be proven committed or uncommitted", {
          humanMessage: "The prior command ended after its canonical boundary changed, so ChillsPwn refused to repeat it.",
          category: "data_integrity",
          remediation: "Refresh the run or decision and inspect its audit trail before issuing a newly represented command.",
        });
      } else {
        payload = await handler(request, operatorId);
      }
    } catch (error) {
      clearInterval(heartbeat);
      const replayable = replayableRuntimeError(error);
      dependencies.runtime.repository.failIdempotent(
        scope,
        key,
        requestIdentity,
        reservation.ownerToken,
        idempotencyFailure(replayable),
        operatorId,
        new Date().toISOString(),
      );
      throw replayable;
    }

    clearInterval(heartbeat);
    if (receiptHeartbeatError) throw replayableRuntimeError(receiptHeartbeatError);
    // Completion is intentionally outside the handler-error terminalization
    // branch. If the process or receipt write fails after domain commit, the
    // in-progress lease expires and the next identical request must reconcile
    // its canonical audit record instead of recording a false failure.
    dependencies.runtime.repository.completeIdempotent(
      scope,
      key,
      requestIdentity,
      reservation.ownerToken,
      payload,
      operatorId,
      new Date().toISOString(),
    );
    response.json(payload);
  });

  const assertResumeReplayCurrent = (request: Request, replay: JsonValue): void => {
    const runId = pathId(request.params.runId, "runId");
    dependencies.runtime.assertV2ControlPlaneOwnership(runId);
    const cached = replay && typeof replay === "object" && !Array.isArray(replay)
      ? replay as Record<string, unknown>
      : {};
    const cachedRun = cached.run && typeof cached.run === "object" && !Array.isArray(cached.run)
      ? cached.run as Record<string, unknown>
      : {};
    const cachedCheckpoint = cached.latestCheckpoint && typeof cached.latestCheckpoint === "object"
      && !Array.isArray(cached.latestCheckpoint)
      ? cached.latestCheckpoint as Record<string, unknown>
      : {};
    let latest: ReturnType<MissionRuntimeEngine["coordinator"]["getLatestCheckpoint"]>;
    try {
      latest = dependencies.runtime.coordinator.getLatestCheckpoint(runId);
    } catch {
      throw new CommandRuntimeError(409, "resume_idempotent_replay_stale", "Cached resume checkpoint failed integrity verification", {
        humanMessage: "The run changed after this resume command was accepted, so its cached result cannot be replayed.",
        category: "data_integrity",
        remediation: "Refresh the run and inspect its current verified checkpoint before taking another action.",
      });
    }
    const current = dependencies.runtime.repository.getRunProjection(runId);
    const latestSequence = dependencies.runtime.repository.database.prepare(`
      SELECT max(
        coalesce((SELECT last_sequence FROM run_event_sequences WHERE run_id = ?), 0),
        coalesce((SELECT max(sequence) FROM events WHERE run_id = ?), 0)
      ) AS sequence
    `).get(runId, runId) as { sequence: number };
    if (
      cachedRun.id !== current.id ||
      cachedRun.version !== current.version ||
      cachedRun.status !== current.status ||
      !latest ||
      cachedCheckpoint.id !== latest.id ||
      cachedCheckpoint.stateHash !== latest.stateHash ||
      cachedCheckpoint.eventSequence !== latest.eventSequence ||
      latest.eventSequence !== latestSequence.sequence
    ) {
      throw new CommandRuntimeError(409, "resume_idempotent_replay_stale", "Cached resume result is no longer canonical", {
        humanMessage: "The run changed after this resume command was accepted, so its cached result cannot be replayed.",
        category: "conflict",
        remediation: "Refresh the run and use a new idempotency key only for a newly represented action.",
      });
    }
  };

  const replayObject = (replay: JsonValue): Record<string, unknown> => (
    replay && typeof replay === "object" && !Array.isArray(replay)
      ? replay as Record<string, unknown>
      : {}
  );

  const assertCachedRunCurrent = (
    runId: string,
    replay: JsonValue,
    staleCode: string,
  ): void => {
    dependencies.runtime.assertV2ControlPlaneOwnership(runId);
    const cachedRunValue = replayObject(replay).run;
    const cachedRun = cachedRunValue && typeof cachedRunValue === "object" && !Array.isArray(cachedRunValue)
      ? cachedRunValue as Record<string, unknown>
      : {};
    const current = dependencies.runtime.repository.getRunProjection(runId);
    const boundaryFields = [
      "id",
      "missionId",
      "journey",
      "controlPlane",
      "status",
      "statusReason",
      "progress",
      "nextAction",
      "currentPlanId",
      "currentStepId",
      "currentOwnerId",
      "version",
    ] as const;
    if (boundaryFields.some((field) => cachedRun[field] !== current[field])) {
      throw new CommandRuntimeError(409, staleCode, "Cached mutation result is no longer canonical", {
        humanMessage: "The run changed after this command was accepted, so its cached result cannot be replayed.",
        category: "conflict",
        remediation: "Refresh the run and use a new idempotency key only for a newly represented action.",
      });
    }
  };

  const assertDecisionReplayCurrent = (
    scope: "approve" | "reject" | "manual" | "skip" | "stop",
    expectedDecisionStatus: "approved" | "rejected" | "manual" | "cancelled",
    expectedResponseStatus: "approved" | "rejected" | "manual" | "skipped" | "cancelled",
  ) => (request: Request, replay: JsonValue): void => {
    const decisionId = pathId(request.params.decisionId, "decisionId");
    const body = bodyObject(request.body);
    const decision = dependencies.runtime.repository.getDecision(decisionId);
    dependencies.runtime.assertV2ControlPlaneOwnership(decision.runId);
    expectedFingerprint(body, decision.actionFingerprint);
    expectedParameters(body, decision.requestedParameters);
    const cached = replayObject(replay);
    if (
      cached.decisionId !== decisionId ||
      cached.status !== expectedResponseStatus ||
      decision.status !== expectedDecisionStatus
    ) {
      throw new CommandRuntimeError(
        409,
        `decision_${scope}_idempotent_replay_stale`,
        "Cached Guided decision result is no longer canonical",
        {
          humanMessage: "The Guided step changed after this decision was accepted, so its cached result cannot be replayed.",
          category: "conflict",
          remediation: "Refresh the Guided workspace and review its current exact step before deciding again.",
        },
      );
    }
    assertCachedRunCurrent(decision.runId, replay, `decision_${scope}_idempotent_replay_stale`);
  };

  const assertRunReplayCurrent = (scope: "pause" | "cancel") => (
    request: Request,
    replay: JsonValue,
  ): void => {
    const runId = pathId(request.params.runId, "runId");
    assertCachedRunCurrent(runId, replay, `run_${scope}_idempotent_replay_stale`);
  };

  const reconcileCommittedMutation = (scope: string): MutationReconciler => async (
    request,
    _operatorId,
    auditDetailsValue,
  ) => {
    const auditDetails = replayObject(auditDetailsValue);
    if (scope.startsWith("decision.")) {
      const decisionId = pathId(request.params.decisionId, "decisionId");
      const body = bodyObject(request.body);
      const decision = dependencies.runtime.repository.getDecision(decisionId);
      dependencies.runtime.assertV2ControlPlaneOwnership(decision.runId);
      expectedFingerprint(body, decision.actionFingerprint);
      expectedParameters(body, decision.requestedParameters);
      const run = () => dependencies.runtime.repository.getRunProjection(decision.runId);

      if (scope === "decision.approve") {
        optionalReason(body.reason);
        if (decision.status !== "approved") {
          throw new CommandRuntimeError(409, "decision_approve_idempotent_reconciliation_stale", "Approved decision is no longer canonical", {
            category: "conflict",
          });
        }
        let action = dependencies.runtime.repository.getGuidedDecisionAction(decisionId);
        if (!action) {
          await dependencies.runtime.replayContinuations(decision.runId, ["guided_approval_to_dispatch"]);
          action = dependencies.runtime.repository.getGuidedDecisionAction(decisionId);
        }
        if (!action) {
          throw new CommandRuntimeError(503, "guided_dispatch_pending", "Approved Guided action is durably queued", {
            humanMessage: "The exact Guided decision committed, but its queued dispatch has not produced an action receipt yet.",
            retryable: true,
            category: "runtime",
            remediation: "Refresh this decision with the same idempotency key after the durable continuation runs.",
          });
        }
        return asJson({ schemaVersion: "2.4", decisionId, status: "approved", action, run: run() });
      }

      if (scope === "decision.reject") {
        requiredReason(body.reason);
        if (decision.status !== "rejected") {
          throw new CommandRuntimeError(409, "decision_reject_idempotent_reconciliation_stale", "Rejected decision is no longer canonical", {
            category: "conflict",
          });
        }
        return asJson({ schemaVersion: "2.4", decisionId, status: "rejected", run: run() });
      }

      if (scope === "decision.manual") {
        if (typeof body.evidenceId !== "string") {
          throw new CommandRuntimeError(400, "interpreted_evidence_required", "Commander-interpreted evidence is required", {
            category: "invalid_input",
          });
        }
        const sourceEvidenceId = pathId(body.evidenceId, "evidenceId");
        const actionId = typeof auditDetails.actionId === "string" ? auditDetails.actionId : "";
        const verifiedEvidenceId = typeof auditDetails.evidenceId === "string"
          ? auditDetails.evidenceId
          : "";
        if (decision.status !== "manual" || !actionId || !verifiedEvidenceId) {
          throw new CommandRuntimeError(409, "decision_manual_idempotent_reconciliation_stale", "Manual result receipt is no longer canonical", {
            category: "data_integrity",
          });
        }
        const canonical = dependencies.runtime.repository.database.prepare(`
          SELECT a.id AS action_id, e.id AS evidence_id,
            json_extract(e.provenance_json, '$.originalEvidenceId') AS original_evidence_id
          FROM actions a JOIN evidence e ON e.action_id = a.id
          WHERE a.id = ? AND a.guided_decision_id = ? AND a.status = 'succeeded'
            AND e.id = ? AND e.verification_state = 'verified'
            AND json_extract(e.provenance_json, '$.originalEvidenceId') = ?
          LIMIT 1
        `).get(actionId, decisionId, verifiedEvidenceId, sourceEvidenceId) as {
          action_id: string;
          evidence_id: string;
          original_evidence_id: string;
        } | undefined;
        if (!canonical) {
          throw new CommandRuntimeError(409, "decision_manual_receipt_incomplete", "Manual result audit has no canonical action and evidence pair", {
            category: "data_integrity",
          });
        }
        const current = run();
        return asJson({
          schemaVersion: "2.4",
          decisionId,
          status: "manual",
          receipt: {
            accepted: true,
            duplicate: true,
            actionId,
            runId: decision.runId,
            runState: current.status,
            nextAction: current.nextAction,
            evidenceIds: [verifiedEvidenceId],
          },
          run: current,
        });
      }

      if (scope === "decision.skip") {
        requiredReason(body.reason);
        const skippedStepId = typeof auditDetails.stepId === "string" ? auditDetails.stepId : "";
        const nextDecisionId = typeof auditDetails.nextDecisionId === "string"
          ? auditDetails.nextDecisionId
          : null;
        const skipped = dependencies.runtime.repository.database.prepare(`
          SELECT status FROM plan_steps WHERE id = ? AND run_id = ?
        `).get(skippedStepId, decision.runId) as { status: string } | undefined;
        if (decision.status !== "cancelled" || !skippedStepId || skipped?.status !== "skipped") {
          throw new CommandRuntimeError(409, "decision_skip_idempotent_reconciliation_stale", "Skipped decision is no longer canonical", {
            category: "data_integrity",
          });
        }
        const current = run();
        return asJson({
          schemaVersion: "2.4",
          decisionId,
          status: "skipped",
          receipt: {
            decisionId,
            status: "cancelled",
            skippedStepId,
            nextDecisionId,
            runId: decision.runId,
            runState: current.status,
            nextAction: current.nextAction,
            duplicate: true,
          },
          run: current,
        });
      }

      if (scope === "decision.stop") {
        requiredReason(body.reason);
        if (decision.status !== "cancelled" || run().status !== "cancelled") {
          throw new CommandRuntimeError(409, "decision_stop_idempotent_reconciliation_stale", "Stopped mission is no longer canonically cancelled", {
            category: "data_integrity",
          });
        }
        return asJson({ schemaVersion: "2.4", decisionId, status: "cancelled", run: run() });
      }
    }

    if (scope.startsWith("run.")) {
      const runId = pathId(request.params.runId, "runId");
      const body = bodyObject(request.body);
      requiredReason(body.reason);
      if (scope === "run.resume") resumeBoundary(body);
      dependencies.runtime.assertV2ControlPlaneOwnership(runId);
      const run = dependencies.runtime.repository.getRunProjection(runId);
      if (scope === "run.pause" && run.status !== "blocked") {
        throw new CommandRuntimeError(409, "run_pause_idempotent_reconciliation_stale", "Paused run is no longer blocked", {
          category: "conflict",
        });
      }
      if (scope === "run.cancel" && run.status !== "cancelled") {
        throw new CommandRuntimeError(409, "run_cancel_idempotent_reconciliation_stale", "Cancelled run is no longer terminal", {
          category: "data_integrity",
        });
      }
      const checkpoint = dependencies.runtime.coordinator.getLatestCheckpoint(runId) ?? null;
      if (
        (scope === "run.pause" || scope === "run.resume")
        && (
          auditDetails.committedRunVersion !== run.version
          || auditDetails.checkpointId !== checkpoint?.id
          || auditDetails.checkpointEventSequence !== checkpoint?.eventSequence
        )
      ) {
        throw new CommandRuntimeError(409, `run_${scope.slice(4)}_idempotent_reconciliation_stale`, "Run changed after the committed command boundary", {
          humanMessage: "The run advanced after the interrupted command committed, so its old response was not reconstructed.",
          category: "conflict",
          remediation: "Refresh the current run and use a new key only for a newly represented command.",
        });
      }
      return asJson({ schemaVersion: "2.4", run, latestCheckpoint: checkpoint });
    }

    throw new CommandRuntimeError(409, "idempotency_reconciliation_unavailable", "Mutation scope has no canonical reconciler", {
      category: "data_integrity",
    });
  };

  router.post("/api/v2/guided-decisions/:decisionId/approve", mutation("decision.approve", async (request, operatorId) => {
    const decisionId = pathId(request.params.decisionId, "decisionId");
    const body = bodyObject(request.body);
    const decision = dependencies.runtime.repository.getDecision(decisionId);
    dependencies.runtime.assertV2ControlPlaneOwnership(decision.runId);
    dependencies.runtime.repository.requireCurrentPendingDecision(decisionId);
    expectedFingerprint(body, decision.actionFingerprint);
    expectedParameters(body, decision.requestedParameters);
    const action = await dependencies.runtime.approveGuidedDecision(
      decisionId,
      operatorId,
      optionalReason(body.reason),
    );
    return asJson({
      schemaVersion: "2.4",
      decisionId,
      status: "approved",
      action,
      run: dependencies.runtime.repository.getRunProjection(decision.runId),
    });
  }, assertDecisionReplayCurrent("approve", "approved", "approved"), reconcileCommittedMutation("decision.approve")));

  router.post("/api/v2/guided-decisions/:decisionId/reject", mutation("decision.reject", async (request, operatorId) => {
    const decisionId = pathId(request.params.decisionId, "decisionId");
    const body = bodyObject(request.body);
    const decision = dependencies.runtime.repository.getDecision(decisionId);
    dependencies.runtime.assertV2ControlPlaneOwnership(decision.runId);
    dependencies.runtime.repository.requireCurrentPendingDecision(decisionId);
    expectedFingerprint(body, decision.actionFingerprint);
    expectedParameters(body, decision.requestedParameters);
    await dependencies.runtime.rejectGuidedDecision(decisionId, operatorId, requiredReason(body.reason));
    return asJson({
      schemaVersion: "2.4",
      decisionId,
      status: "rejected",
      run: dependencies.runtime.repository.getRunProjection(decision.runId),
    });
  }, assertDecisionReplayCurrent("reject", "rejected", "rejected"), reconcileCommittedMutation("decision.reject")));

  router.post("/api/v2/guided-decisions/:decisionId/manual-result", mutation("decision.manual", async (request, operatorId) => {
    const decisionId = pathId(request.params.decisionId, "decisionId");
    const body = bodyObject(request.body);
    const decision = dependencies.runtime.repository.getDecision(decisionId);
    dependencies.runtime.assertV2ControlPlaneOwnership(decision.runId);
    expectedFingerprint(body, decision.actionFingerprint);
    expectedParameters(body, decision.requestedParameters);
    if (typeof body.evidenceId !== "string") {
      throw new CommandRuntimeError(400, "interpreted_evidence_required", "Commander-interpreted evidence is required", {
        humanMessage: "Submit the manual output for interpretation before completing this exact step.",
        category: "invalid_input",
        remediation: "Use the Guided workspace result form, review the interpretation, then accept it to advance.",
      });
    }
    const evidenceId = pathId(body.evidenceId, "evidenceId");
    const evidence = dependencies.runtime.repository.database.prepare(`
      SELECT json_extract(chain.details_json, '$.summary') AS summary
      FROM evidence e
      JOIN evidence_chain_events chain
        ON chain.evidence_id = e.id AND chain.event_type = 'interpreted'
      WHERE e.id = ? AND e.mission_id = ? AND e.run_id = ? AND e.step_id = ?
        AND e.action_id IS NULL AND e.evidence_type = 'guided_text_result'
        AND e.verification_state = 'unverified'
      ORDER BY chain.occurred_at DESC, chain.id DESC LIMIT 1
    `).get(evidenceId, decision.missionId, decision.runId, decision.stepId) as {
      summary: string;
    } | undefined;
    if (!evidence?.summary.trim()) {
      throw new CommandRuntimeError(409, "interpreted_evidence_not_current", "Interpreted evidence does not belong to the current exact step", {
        humanMessage: "The reviewed observation is stale, already consumed, or belongs to another step.",
        category: "scope_conflict",
        remediation: "Refresh the Guided workspace and interpret output for the current represented action.",
      });
    }
    const receipt = await dependencies.runtime.submitManualGuidedResult(
      decisionId,
      operatorId,
      evidence.summary,
      evidenceId,
    );
    return asJson({
      schemaVersion: "2.4",
      decisionId,
      status: "manual",
      receipt,
      run: dependencies.runtime.repository.getRunProjection(decision.runId),
    });
  }, assertDecisionReplayCurrent("manual", "manual", "manual"), reconcileCommittedMutation("decision.manual")));

  router.post("/api/v2/guided-decisions/:decisionId/skip", mutation("decision.skip", async (request, operatorId) => {
    const decisionId = pathId(request.params.decisionId, "decisionId");
    const body = bodyObject(request.body);
    const decision = dependencies.runtime.repository.getDecision(decisionId);
    dependencies.runtime.assertV2ControlPlaneOwnership(decision.runId);
    expectedFingerprint(body, decision.actionFingerprint);
    expectedParameters(body, decision.requestedParameters);
    const receipt = await dependencies.runtime.skipGuidedDecision(
      decisionId,
      operatorId,
      requiredReason(body.reason),
    );
    return asJson({
      schemaVersion: "2.4",
      decisionId,
      status: "skipped",
      receipt,
      run: dependencies.runtime.repository.getRunProjection(decision.runId),
    });
  }, assertDecisionReplayCurrent("skip", "cancelled", "skipped"), reconcileCommittedMutation("decision.skip")));

  router.post("/api/v2/guided-decisions/:decisionId/stop", mutation("decision.stop", async (request, operatorId) => {
    const decisionId = pathId(request.params.decisionId, "decisionId");
    const body = bodyObject(request.body);
    const decision = dependencies.runtime.repository.getDecision(decisionId);
    dependencies.runtime.assertV2ControlPlaneOwnership(decision.runId);
    expectedFingerprint(body, decision.actionFingerprint);
    const parameterHash = expectedParameters(body, decision.requestedParameters);
    dependencies.runtime.repository.requireCurrentPendingDecision(decisionId);
    const reason = requiredReason(body.reason);
    await dependencies.runtime.cancelRun(decision.runId, operatorId, reason, {
      kind: "guided_stop",
      decisionId,
      missionId: decision.missionId,
      stepId: decision.stepId,
      actionFingerprint: decision.actionFingerprint,
      parameterHash,
    });
    return asJson({
      schemaVersion: "2.4",
      decisionId,
      status: "cancelled",
      run: dependencies.runtime.repository.getRunProjection(decision.runId),
    });
  }, assertDecisionReplayCurrent("stop", "cancelled", "cancelled"), reconcileCommittedMutation("decision.stop")));

  for (const command of ["pause", "resume", "cancel"] as const) {
    router.post(`/api/v2/runs/:runId/${command}`, mutation(`run.${command}`, async (request, operatorId) => {
      const runId = pathId(request.params.runId, "runId");
      const body = bodyObject(request.body);
      const reason = requiredReason(body.reason);
      if (command === "pause") dependencies.runtime.pauseRun(runId, operatorId, reason);
      if (command === "resume") dependencies.runtime.resumeRun(runId, operatorId, reason, resumeBoundary(body));
      if (command === "cancel") await dependencies.runtime.cancelRun(runId, operatorId, reason);
      return asJson({
        schemaVersion: "2.4",
        run: dependencies.runtime.repository.getRunProjection(runId),
        latestCheckpoint: dependencies.runtime.coordinator.getLatestCheckpoint(runId) ?? null,
      });
    },
    command === "resume" ? assertResumeReplayCurrent : assertRunReplayCurrent(command),
    reconcileCommittedMutation(`run.${command}`)));
  }

  return router;
}
