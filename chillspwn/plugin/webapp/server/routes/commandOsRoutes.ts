import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { SqliteDatabase } from "../db";
import {
  MissionApiError,
  MissionRepository,
  MissionService,
  OverviewRepository,
  ReadinessService,
  validateIdempotencyKey,
  validateMissionCreateRequest,
  type ApiErrorEnvelope,
  type Journey,
  type ReadinessCheckProvider,
} from "../missions";

export interface CommandOsRouterDependencies {
  readonly database: SqliteDatabase;
  readonly readinessProviders: readonly ReadinessCheckProvider[];
  readonly resolveActor: (request: Request) => string;
}

function traceId(request: Request): string {
  const supplied = request.get("X-Request-ID")?.trim();
  return supplied && /^[a-zA-Z0-9._:-]{1,128}$/u.test(supplied) ? supplied : randomUUID();
}

function sendError(response: Response, error: unknown, requestTraceId: string): void {
  const timestamp = new Date().toISOString();
  const known = error instanceof MissionApiError;
  const envelope: ApiErrorEnvelope = known
    ? {
        code: error.code,
        message: error.message,
        humanMessage: error.options.humanMessage ?? error.message,
        retryable: error.options.retryable ?? false,
        category: error.options.category ?? "mission",
        ...(error.options.details === undefined ? {} : { details: error.options.details }),
        traceId: requestTraceId,
        ...(error.options.remediation ? { remediation: error.options.remediation } : {}),
        timestamp,
      }
    : {
        code: "command_os_internal_error",
        message: "Command OS could not complete the request",
        humanMessage: "The mission service encountered an internal error.",
        retryable: false,
        category: "internal",
        traceId: requestTraceId,
        remediation: "Use the trace ID to inspect structured server logs before retrying.",
        timestamp,
      };
  response.status(known ? error.status : 500).json({ error: envelope });
}

function boundedLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new MissionApiError(400, "invalid_pagination", "Invalid mission page limit", {
      humanMessage: "Mission page size must be an integer between 1 and 100.",
      category: "invalid_input",
      remediation: "Use a limit from 1 through 100.",
    });
  }
  return parsed;
}

function journeyFilter(value: unknown): Journey | undefined {
  if (value === undefined) return undefined;
  if (value === "autonomous" || value === "guided") return value;
  throw new MissionApiError(400, "invalid_journey_filter", "Invalid journey filter", {
    humanMessage: "Journey must be Autonomous or Guided.",
    category: "invalid_input",
  });
}

/**
 * Mount with `app.use(createCommandOsRouter(deps))`. The factory deliberately
 * requires concrete readiness providers and an authenticated actor resolver.
 */
export function createCommandOsRouter(
  dependencies: CommandOsRouterDependencies,
): Router {
  const readiness = new ReadinessService(dependencies.readinessProviders);
  const missions = new MissionRepository(dependencies.database);
  const service = new MissionService(
    missions,
    new OverviewRepository(dependencies.database),
    readiness,
  );
  const router = Router();

  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get("/api/v2/overview", async (request, response) => {
    const requestTraceId = traceId(request);
    response.setHeader("X-Request-ID", requestTraceId);
    try {
      response.json(await service.getOverview());
    } catch (error) {
      sendError(response, error, requestTraceId);
    }
  });

  router.get("/api/v2/missions", (request, response) => {
    const requestTraceId = traceId(request);
    response.setHeader("X-Request-ID", requestTraceId);
    try {
      const cursor = typeof request.query.cursor === "string" ? request.query.cursor : undefined;
      const status = typeof request.query.status === "string" && request.query.status.trim()
        ? request.query.status.trim()
        : undefined;
      const query = typeof request.query.query === "string" && request.query.query.trim()
        ? request.query.query.trim()
        : undefined;
      if (status && status.length > 80) {
        throw new MissionApiError(400, "invalid_status_filter", "Invalid status filter", {
          humanMessage: "The mission status filter is too long.",
          category: "invalid_input",
        });
      }
      if (query && query.length > 300) {
        throw new MissionApiError(400, "invalid_mission_search", "Invalid mission search", {
          humanMessage: "Mission search must be at most 300 characters.",
          category: "invalid_input",
        });
      }
      response.json(
        service.list({
          cursor,
          limit: boundedLimit(request.query.limit),
          journey: journeyFilter(request.query.journey),
          status,
          query,
        }),
      );
    } catch (error) {
      const normalized = error instanceof RangeError
        ? new MissionApiError(400, "invalid_cursor", error.message, {
            humanMessage: "The mission cursor is invalid or expired.",
            category: "invalid_input",
            remediation: "Restart pagination without a cursor.",
          })
        : error;
      sendError(response, normalized, requestTraceId);
    }
  });

  router.post("/api/v2/missions/autonomous/preflight", async (request, response) => {
    const requestTraceId = traceId(request);
    response.setHeader("X-Request-ID", requestTraceId);
    try {
      const actorId = dependencies.resolveActor(request).trim();
      if (!actorId) {
        throw new MissionApiError(401, "operator_identity_required", "Operator identity is required", {
          humanMessage: "An authenticated operator identity is required to review an Autonomous contract.",
          category: "authentication_missing",
          remediation: "Sign in again and rerun contract preflight.",
        });
      }
      const missionRequest = validateMissionCreateRequest(request.body);
      if (missionRequest.journey !== "autonomous") {
        throw new MissionApiError(400, "autonomous_contract_required", "Autonomous contract required", {
          humanMessage: "This preflight endpoint accepts Autonomous contracts only.",
          category: "invalid_input",
        });
      }
      response.json(await service.preflightAutonomous(missionRequest));
    } catch (error) {
      sendError(response, error, requestTraceId);
    }
  });

  router.post("/api/v2/missions", async (request, response) => {
    const requestTraceId = traceId(request);
    response.setHeader("X-Request-ID", requestTraceId);
    try {
      const actorId = dependencies.resolveActor(request).trim();
      if (!actorId) {
        throw new MissionApiError(401, "operator_identity_required", "Operator identity is required", {
          humanMessage: "An authenticated operator identity is required to create a mission.",
          category: "authentication_missing",
          remediation: "Sign in again and retry the mission submission.",
        });
      }
      const idempotencyKey = validateIdempotencyKey(request.get("Idempotency-Key"));
      const missionRequest = validateMissionCreateRequest(request.body);
      const created = await service.create(missionRequest, idempotencyKey, actorId);
      response.status(201).setHeader("Location", created.nextUrl).json(created);
    } catch (error) {
      sendError(response, error, requestTraceId);
    }
  });

  return router;
}
