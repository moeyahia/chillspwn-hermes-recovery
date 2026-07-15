import { Router, type Request, type Response } from "express";
import type { SqliteDatabase } from "../db";
import { attachV2RequestId, sendV2Error } from "../contracts/ApiErrorContract";
import type { SecondBrainService } from "../memory";
import { GuidedCommanderRepository } from "./GuidedCommanderRepository";
import { GuidedCommanderService } from "./GuidedCommanderService";
import type { GuidedCommanderOptions, GuidedCommanderPort } from "./types";
import {
  GuidedCommanderError,
  validateContextualActionRequest,
  validateDoNotRememberRequest,
  validateIdempotencyKey,
  validateInterpretResultRequest,
  validatePathId,
  validateRememberRequest,
} from "./validation";

export interface GuidedCommanderRouterDependencies {
  readonly database: SqliteDatabase;
  readonly port: GuidedCommanderPort;
  readonly resolveActor: (request: Request) => string;
  readonly secondBrain?: SecondBrainService;
  readonly options?: GuidedCommanderOptions;
}

function normalizeError(error: unknown): GuidedCommanderError {
  if (error instanceof GuidedCommanderError) return error;
  if (error instanceof TypeError || error instanceof RangeError) {
    return new GuidedCommanderError(422, "guided_validation_failed", "Guided Commander validation failed", {
      humanMessage: "The Guided request could not be safely validated.",
      category: "invalid_input",
    });
  }
  return new GuidedCommanderError(500, "guided_commander_internal_error", "Guided Commander request failed", {
    humanMessage: "The Guided conversation service could not safely complete this request.",
    category: "internal",
    remediation: "Use the trace ID to inspect structured server events before retrying.",
  });
}

function sendError(response: Response, error: unknown, traceId: string): void {
  const normalized = normalizeError(error);
  sendV2Error(response, traceId, {
    status: normalized.status,
    code: normalized.code,
    message: normalized.message,
    humanMessage: normalized.options.humanMessage ?? normalized.message,
    retryable: normalized.options.retryable ?? false,
    category: normalized.options.category ?? "guided_commander",
    ...(normalized.options.details === undefined ? {} : { details: normalized.options.details }),
    ...(normalized.options.remediation ? { remediation: normalized.options.remediation } : {}),
  });
}

function operatorId(dependencies: GuidedCommanderRouterDependencies, request: Request): string {
  const actor = dependencies.resolveActor(request).trim();
  if (!actor || actor.length > 256) {
    throw new GuidedCommanderError(401, "operator_identity_required", "Operator identity is required", {
      humanMessage: "Sign in before using the Guided Commander.",
      category: "authentication_missing",
    });
  }
  return actor;
}

function requiredRunId(request: Request): string {
  return validatePathId(request.query.runId, "runId");
}

function boundedLimit(value: unknown): number {
  if (value === undefined) return 100;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 200) {
    throw new GuidedCommanderError(400, "invalid_transcript_limit", "Transcript limit must be 1 through 200", {
      category: "invalid_input",
    });
  }
  return parsed;
}

/** Mount after authentication and bounded JSON parsing middleware. */
export function createGuidedCommanderRouter(
  dependencies: GuidedCommanderRouterDependencies,
): Router {
  const repository = new GuidedCommanderRepository(dependencies.database, dependencies.options);
  const service = new GuidedCommanderService({
    repository,
    port: dependencies.port,
    secondBrain: dependencies.secondBrain,
    options: dependencies.options,
  });
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

  router.get("/api/v2/guided/:missionId/commander/transcript", route((request, response) => {
    const missionId = validatePathId(request.params.missionId, "missionId");
    const runId = requiredRunId(request);
    const stepId = typeof request.query.stepId === "string"
      ? validatePathId(request.query.stepId, "stepId")
      : undefined;
    const cursor = typeof request.query.cursor === "string" ? request.query.cursor : undefined;
    response.json({
      schemaVersion: "2.1",
      ...service.transcript({
        missionId,
        runId,
        ...(stepId ? { stepId } : {}),
        ...(cursor ? { cursor } : {}),
        limit: boundedLimit(request.query.limit),
      }),
    });
  }));

  const providerAction = (action: "explain_more" | "show_next_step" | "use_another_approach") =>
    route(async (request, response) => {
      const missionId = validatePathId(request.params.missionId, "missionId");
      const actorId = operatorId(dependencies, request);
      const key = validateIdempotencyKey(request.get("Idempotency-Key"));
      const body = validateContextualActionRequest(request.body);
      const controller = new AbortController();
      const abort = () => controller.abort();
      request.once("aborted", abort);
      try {
        const result = await service.respond({
          missionId,
          action,
          request: body,
          idempotencyKey: key,
          actorId,
          signal: controller.signal,
        });
        response.json({ schemaVersion: "2.1", result });
      } finally {
        request.off("aborted", abort);
      }
    });

  router.post(
    "/api/v2/guided/:missionId/commander/explain-more",
    providerAction("explain_more"),
  );
  router.post(
    "/api/v2/guided/:missionId/commander/show-next-step",
    providerAction("show_next_step"),
  );
  router.post(
    "/api/v2/guided/:missionId/commander/use-another-approach",
    providerAction("use_another_approach"),
  );

  router.post("/api/v2/guided/:missionId/commander/interpret-result", route(async (request, response) => {
    const missionId = validatePathId(request.params.missionId, "missionId");
    const actorId = operatorId(dependencies, request);
    const key = validateIdempotencyKey(request.get("Idempotency-Key"));
    const body = validateInterpretResultRequest(request.body);
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.once("aborted", abort);
    try {
      const result = await service.interpret({
        missionId,
        request: body,
        idempotencyKey: key,
        actorId,
        signal: controller.signal,
      });
      response.json({
        schemaVersion: "2.1",
        result,
        ingestion: {
          multipartSupported: false,
          acceptedSources: ["paste", "text_upload"],
          rawContentRetained: false,
        },
      });
    } finally {
      request.off("aborted", abort);
    }
  }));

  router.post("/api/v2/guided/:missionId/commander/remember", route((request, response) => {
    const missionId = validatePathId(request.params.missionId, "missionId");
    const result = service.remember({
      missionId,
      request: validateRememberRequest(request.body),
      idempotencyKey: validateIdempotencyKey(request.get("Idempotency-Key")),
      actorId: operatorId(dependencies, request),
    });
    response.status(201).json({ schemaVersion: "2.1", result });
  }));

  router.post("/api/v2/guided/:missionId/commander/do-not-remember", route((request, response) => {
    const missionId = validatePathId(request.params.missionId, "missionId");
    const result = service.doNotRemember({
      missionId,
      request: validateDoNotRememberRequest(request.body),
      idempotencyKey: validateIdempotencyKey(request.get("Idempotency-Key")),
      actorId: operatorId(dependencies, request),
    });
    response.json({ schemaVersion: "2.1", result });
  }));

  return router;
}
