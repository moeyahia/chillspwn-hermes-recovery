import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import {
  CommandRuntimeError,
  type MissionRuntimeEngine,
} from "../command-runtime";
import { DurableOrchestrationError } from "../orchestration";
import type { JsonValue } from "../events";
import { canonicalJson, hashCanonical } from "../missions/canonical";
import type { RunState } from "../supervisor";
import type { GuidedDecisionProjection } from "../command-runtime";

export interface MissionRuntimeV2RouterDependencies {
  readonly runtime: MissionRuntimeEngine;
  readonly resolveActor: (request: Request) => string;
}

function requestTraceId(request: Request): string {
  const supplied = request.get("X-Request-ID")?.trim();
  return supplied && /^[a-zA-Z0-9._:-]{1,128}$/u.test(supplied) ? supplied : randomUUID();
}

function runtimeError(error: unknown): CommandRuntimeError {
  if (error instanceof CommandRuntimeError) return error;
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
  response.status(known.status).json({
    error: {
      code: known.code,
      message: known.message,
      humanMessage: known.options.humanMessage ?? known.message,
      retryable: known.options.retryable ?? false,
      category: known.options.category ?? "runtime",
      ...(known.options.details === undefined ? {} : { details: known.options.details }),
      traceId,
      ...(known.options.remediation ? { remediation: known.options.remediation } : {}),
      timestamp: new Date().toISOString(),
    },
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

function pathId(value: string, label: string): string {
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
  return value.trim();
}

function requiredReason(value: unknown): string {
  const reason = optionalReason(value);
  if (!reason) throw new CommandRuntimeError(400, "reason_required", "A reason is required", { category: "invalid_input" });
  return reason;
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

function requireCurrentPendingDecision(
  dependencies: MissionRuntimeV2RouterDependencies,
  decision: GuidedDecisionProjection,
): ReturnType<MissionRuntimeV2RouterDependencies["runtime"]["repository"]["getRunProjection"]> {
  if (decision.status !== "pending") {
    throw new CommandRuntimeError(409, "guided_decision_not_pending", "Only a pending Guided decision can use this control", {
      humanMessage: "This exact-step control is stale. Refresh the current Guided checkpoint.",
      category: "conflict",
    });
  }
  const run = dependencies.runtime.repository.getRunProjection(decision.runId);
  if (
    run.journey !== "guided" ||
    run.status !== "waiting_guided_decision" ||
    run.currentStepId !== decision.stepId
  ) {
    throw new CommandRuntimeError(409, "guided_step_stale", "The represented Guided step is no longer current", {
      humanMessage: "This exact-step control is stale. Review the current Guided checkpoint before deciding.",
      category: "conflict",
    });
  }
  return run;
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
    const traceId = requestTraceId(request);
    response.setHeader("X-Request-ID", traceId);
    try {
      await handler(request, response, traceId);
    } catch (error) {
      sendError(response, error, traceId);
    }
  };

  router.get("/api/v2/missions/:missionId/runtime", route((request, response) => {
    const missionId = pathId(request.params.missionId, "missionId");
    response.json({ schemaVersion: "2.1", ...dependencies.runtime.repository.getMissionRuntime(missionId) });
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
      schemaVersion: "2.1",
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
      schemaVersion: "2.1",
      run: dependencies.runtime.repository.getRunProjection(runId),
      latestCheckpoint: dependencies.runtime.coordinator.getLatestCheckpoint(runId) ?? null,
    });
  }));

  router.get("/api/v2/runs/:runId/plans", route((request, response) => {
    const runId = pathId(request.params.runId, "runId");
    dependencies.runtime.repository.getRunProjection(runId);
    response.json({ schemaVersion: "2.1", items: dependencies.runtime.repository.listPlans(runId) });
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
      schemaVersion: "2.1",
      items: dependencies.runtime.repository.listDecisions({ status, runId, query, limit }),
    });
  }));

  const mutation = (
    scope: string,
    handler: (request: Request, operatorId: string) => Promise<JsonValue> | JsonValue,
  ) => route(async (request, response) => {
    const key = idempotencyKey(request);
    const operatorId = actor(dependencies, request);
    const requestIdentity = { params: request.params, body: request.body ?? {} };
    const replay = dependencies.runtime.repository.findIdempotent(scope, key, requestIdentity);
    if (replay !== undefined) {
      response.json(replay);
      return;
    }
    const payload = await handler(request, operatorId);
    dependencies.runtime.repository.transaction(() => {
      dependencies.runtime.repository.storeIdempotent(
        scope,
        key,
        requestIdentity,
        payload,
        operatorId,
        new Date().toISOString(),
      );
    });
    response.json(payload);
  });

  router.post("/api/v2/guided-decisions/:decisionId/approve", mutation("decision.approve", async (request, operatorId) => {
    const decisionId = pathId(request.params.decisionId, "decisionId");
    const body = bodyObject(request.body);
    const decision = dependencies.runtime.repository.getDecision(decisionId);
    expectedFingerprint(body, decision.actionFingerprint);
    const action = await dependencies.runtime.approveGuidedDecision(
      decisionId,
      operatorId,
      optionalReason(body.reason),
    );
    return asJson({ schemaVersion: "2.1", decisionId, status: "approved", action });
  }));

  router.post("/api/v2/guided-decisions/:decisionId/reject", mutation("decision.reject", async (request, operatorId) => {
    const decisionId = pathId(request.params.decisionId, "decisionId");
    const body = bodyObject(request.body);
    const decision = dependencies.runtime.repository.getDecision(decisionId);
    expectedFingerprint(body, decision.actionFingerprint);
    await dependencies.runtime.rejectGuidedDecision(decisionId, operatorId, requiredReason(body.reason));
    return { schemaVersion: "2.1", decisionId, status: "rejected" };
  }));

  router.post("/api/v2/guided-decisions/:decisionId/manual-result", mutation("decision.manual", async (request, operatorId) => {
    const decisionId = pathId(request.params.decisionId, "decisionId");
    const body = bodyObject(request.body);
    const decision = dependencies.runtime.repository.getDecision(decisionId);
    expectedFingerprint(body, decision.actionFingerprint);
    if (typeof body.summary !== "string") {
      throw new CommandRuntimeError(400, "manual_result_required", "Manual result summary is required", { category: "invalid_input" });
    }
    const receipt = await dependencies.runtime.submitManualGuidedResult(decisionId, operatorId, body.summary);
    return asJson({ schemaVersion: "2.1", decisionId, status: "manual", receipt });
  }));

  router.post("/api/v2/guided-decisions/:decisionId/skip", mutation("decision.skip", async (request, operatorId) => {
    const decisionId = pathId(request.params.decisionId, "decisionId");
    const body = bodyObject(request.body);
    const decision = dependencies.runtime.repository.getDecision(decisionId);
    expectedFingerprint(body, decision.actionFingerprint);
    expectedParameters(body, decision.requestedParameters);
    const receipt = await dependencies.runtime.skipGuidedDecision(
      decisionId,
      operatorId,
      requiredReason(body.reason),
    );
    return asJson({ schemaVersion: "2.1", decisionId, status: "skipped", receipt });
  }));

  router.post("/api/v2/guided-decisions/:decisionId/stop", mutation("decision.stop", async (request, operatorId) => {
    const decisionId = pathId(request.params.decisionId, "decisionId");
    const body = bodyObject(request.body);
    const decision = dependencies.runtime.repository.getDecision(decisionId);
    expectedFingerprint(body, decision.actionFingerprint);
    const parameterHash = expectedParameters(body, decision.requestedParameters);
    requireCurrentPendingDecision(dependencies, decision);
    const reason = requiredReason(body.reason);
    await dependencies.runtime.cancelRun(decision.runId, operatorId, reason);
    const now = new Date().toISOString();
    dependencies.runtime.repository.transaction(() => {
      dependencies.runtime.repository.events.append({
        missionId: decision.missionId,
        runId: decision.runId,
        journey: "guided",
        eventType: "guided.mission_stopped",
        actorType: "operator",
        actorId: operatorId,
        summary: "Operator stopped the mission from the exact represented Guided step",
        payload: {
          decisionId,
          stepId: decision.stepId,
          actionFingerprint: decision.actionFingerprint,
          parameterHash,
          reason,
        },
        sensitivity: "private",
      });
      dependencies.runtime.repository.appendAudit({
        missionId: decision.missionId,
        runId: decision.runId,
        actorId: operatorId,
        action: "guided.mission_stopped",
        resourceType: "guided_decision",
        resourceId: decisionId,
        reason,
        details: {
          stepId: decision.stepId,
          actionFingerprint: decision.actionFingerprint,
          parameterHash,
        },
        now,
      });
    });
    return asJson({
      schemaVersion: "2.1",
      decisionId,
      status: "cancelled",
      run: dependencies.runtime.repository.getRunProjection(decision.runId),
    });
  }));

  for (const command of ["pause", "resume", "cancel"] as const) {
    router.post(`/api/v2/runs/:runId/${command}`, mutation(`run.${command}`, async (request, operatorId) => {
      const runId = pathId(request.params.runId, "runId");
      const body = bodyObject(request.body);
      const reason = requiredReason(body.reason);
      if (command === "pause") dependencies.runtime.pauseRun(runId, operatorId, reason);
      if (command === "resume") dependencies.runtime.resumeRun(runId, operatorId, reason);
      if (command === "cancel") await dependencies.runtime.cancelRun(runId, operatorId, reason);
      return asJson({ schemaVersion: "2.1", run: dependencies.runtime.repository.getRunProjection(runId) });
    }));
  }

  return router;
}
