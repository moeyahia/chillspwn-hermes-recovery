import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { OperationsApiError } from "../operations/errors";
import { OperationsRepository } from "../operations/OperationsRepository";
import { RecoveryRepository } from "../operations/RecoveryRepository";
import { OperationsReviewRepository } from "../operations/OperationsReviewRepository";
import { validateAccessPolicy } from "../operations/scope";
import type {
  OperationsContext,
  OperationsErrorEnvelope,
  OperationsRouterDependencies,
} from "../operations/types";
import {
  boundedLimit,
  identifier,
  object,
  optionalEnum,
  optionalIdentifier,
  optionalSearch,
  optionalTimestamp,
  requiredIdempotencyKey,
  requiredPositiveInteger,
  requiredText,
} from "../operations/validation";

const AGENT_STATUSES = new Set(["available", "busy", "degraded", "offline", "quarantined"] as const);
const ASSIGNMENT_STATUSES = new Set(["queued", "active", "blocked", "completed", "failed", "cancelled"] as const);
const VERIFICATION_STATES = new Set(["unverified", "verified", "disputed", "rejected"] as const);
const SEVERITIES = new Set(["informational", "low", "medium", "high", "critical"] as const);
const FINDING_STATUSES = new Set(["draft", "under_review", "verified", "rejected", "accepted_risk"] as const);
const FINDING_REVIEW_STATUSES = new Set(["under_review", "verified", "rejected", "accepted_risk"] as const);
const JOURNEYS = new Set(["autonomous", "guided"] as const);
const LOG_SEVERITIES = new Set(["trace", "debug", "info", "warn", "error", "fatal"] as const);
const HEALTH_STATUSES = new Set(["healthy", "degraded", "unhealthy", "unknown"] as const);
const LESSON_STATUSES = new Set(["proposed", "under_review", "verified", "rejected", "stale", "superseded"] as const);
const LESSON_REVIEW_STATUSES = new Set(["under_review", "verified", "rejected", "stale", "superseded"] as const);
const MCP_STATUSES = new Set(["unknown", "healthy", "degraded", "offline", "quarantined"] as const);
const ACTOR_TYPES = new Set(["operator", "reviewer", "admin", "agent", "system"] as const);

function traceId(request: Request): string {
  const supplied = request.get("X-Request-ID")?.trim();
  return supplied && /^[A-Za-z0-9._:-]{1,128}$/u.test(supplied) ? supplied : randomUUID();
}

function sendError(response: Response, error: unknown, requestTraceId: string): void {
  const known = error instanceof OperationsApiError;
  const envelope: OperationsErrorEnvelope = known
    ? {
        code: error.code,
        message: error.message,
        humanMessage: error.options.humanMessage ?? error.message,
        retryable: error.options.retryable ?? false,
        category: error.options.category ?? "operations",
        ...(error.options.details === undefined ? {} : { details: error.options.details }),
        traceId: requestTraceId,
        ...(error.options.remediation ? { remediation: error.options.remediation } : {}),
        timestamp: new Date().toISOString(),
      }
    : {
        code: "operations_internal_error",
        message: "Command OS operations could not complete the request",
        humanMessage: "The operations service encountered an internal error.",
        retryable: false,
        category: "internal",
        traceId: requestTraceId,
        remediation: "Use the trace ID to inspect redacted structured logs before retrying.",
        timestamp: new Date().toISOString(),
      };
  response.status(known ? error.status : 500).json({ error: envelope });
}

function context(request: Request, dependencies: OperationsRouterDependencies): OperationsContext {
  const actor = dependencies.resolveActor(request);
  if (!actor || typeof actor.id !== "string" || !actor.id.trim() || !ACTOR_TYPES.has(actor.type)) {
    throw new OperationsApiError(401, "operator_identity_required", "An authenticated operations identity is required", {
      humanMessage: "Sign in again before accessing operational data.",
      category: "authentication_missing",
    });
  }
  const actorId = identifier(actor.id, "Actor ID");
  const normalizedActor = { id: actorId, type: actor.type } as const;
  const access = dependencies.resolveAccess(request, normalizedActor);
  validateAccessPolicy(access);
  return { actor: normalizedActor, access };
}

function value(request: Request, name: string): string | undefined {
  const candidate = request.query[name];
  if (candidate === undefined) return undefined;
  if (typeof candidate !== "string") {
    throw new OperationsApiError(400, "invalid_filter", `${name} must occur once`, {
      humanMessage: `The ${name} filter must have one value.`,
      category: "invalid_input",
    });
  }
  return candidate;
}

function cursor(request: Request): string | undefined {
  return value(request, "cursor");
}

function limit(request: Request): number {
  return boundedLimit(value(request, "limit"));
}

function completionExportFilename(runId: string): string {
  const safe = runId.replace(/[^A-Za-z0-9._-]/gu, "_").slice(0, 96) || "run";
  return `chillspwn-${safe}-completion.json`;
}

function plainFilter(request: Request, name: string, maximum = 200): string | undefined {
  const candidate = value(request, name);
  if (candidate === undefined || candidate === "") return undefined;
  if (!candidate.trim() || candidate.length > maximum || /[\u0000-\u001F]/u.test(candidate)) {
    throw new OperationsApiError(400, "invalid_filter", `${name} is invalid`, {
      humanMessage: `The ${name} filter is invalid.`,
      category: "invalid_input",
    });
  }
  return candidate.trim();
}

function handle(
  dependencies: OperationsRouterDependencies,
  operation: (request: Request, response: Response, ctx: OperationsContext) => void | Promise<void>,
) {
  return async (request: Request, response: Response): Promise<void> => {
    const requestTraceId = traceId(request);
    response.setHeader("X-Request-ID", requestTraceId);
    try {
      await operation(request, response, context(request, dependencies));
    } catch (error) {
      sendError(response, error, requestTraceId);
    }
  };
}

/**
 * Mount with `app.use(createOperationsRouter(deps))` after authentication and
 * JSON body parsing. The host must resolve both actor identity and scope.
 */
export function createOperationsRouter(dependencies: OperationsRouterDependencies): Router {
  const repository = new OperationsRepository(dependencies.database, dependencies.clock);
  const recovery = new RecoveryRepository(dependencies.database);
  const reviews = new OperationsReviewRepository(dependencies.database, dependencies.clock);
  const router = Router();
  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get("/api/v2/agents", handle(dependencies, (request, response, { access }) => {
    response.json(repository.listAgents(access, {
      limit: limit(request), cursor: cursor(request),
      status: optionalEnum(value(request, "status"), AGENT_STATUSES, "status"),
      query: optionalSearch(value(request, "query")),
    }));
  }));
  router.get("/api/v2/agents/:agentId", handle(dependencies, (request, response, { access }) => {
    response.json(repository.getAgent(identifier(request.params.agentId, "Agent ID"), access));
  }));
  router.get("/api/v2/agents/:agentId/assignments", handle(dependencies, (request, response, { access }) => {
    response.json(repository.listAgentAssignments(identifier(request.params.agentId, "Agent ID"), access, {
      limit: limit(request), cursor: cursor(request),
      status: optionalEnum(value(request, "status"), ASSIGNMENT_STATUSES, "status"),
    }));
  }));

  router.get("/api/v2/intelligence/evidence", handle(dependencies, (request, response, { access }) => {
    response.json(repository.listEvidence(access, {
      limit: limit(request), cursor: cursor(request),
      missionId: optionalIdentifier(value(request, "missionId"), "Mission ID"),
      runId: optionalIdentifier(value(request, "runId"), "Run ID"),
      evidenceType: plainFilter(request, "evidenceType"),
      verificationState: optionalEnum(value(request, "verificationState"), VERIFICATION_STATES, "verificationState"),
      query: optionalSearch(value(request, "query")),
      from: optionalTimestamp(value(request, "from"), "from"),
      to: optionalTimestamp(value(request, "to"), "to"),
    }));
  }));
  router.get("/api/v2/intelligence/evidence/:evidenceId", handle(dependencies, (request, response, { access }) => {
    response.json(repository.getEvidence(identifier(request.params.evidenceId, "Evidence ID"), access));
  }));

  router.get("/api/v2/intelligence/findings", handle(dependencies, (request, response, { access }) => {
    response.json(repository.listFindings(access, {
      limit: limit(request), cursor: cursor(request),
      missionId: optionalIdentifier(value(request, "missionId"), "Mission ID"),
      runId: optionalIdentifier(value(request, "runId"), "Run ID"),
      severity: optionalEnum(value(request, "severity"), SEVERITIES, "severity"),
      reviewStatus: optionalEnum(value(request, "reviewStatus"), FINDING_STATUSES, "reviewStatus"),
      query: optionalSearch(value(request, "query")),
    }));
  }));
  router.get("/api/v2/intelligence/findings/:findingId", handle(dependencies, (request, response, { access }) => {
    response.json(repository.getFinding(identifier(request.params.findingId, "Finding ID"), access));
  }));
  router.post("/api/v2/intelligence/findings/:findingId/review", handle(dependencies, (request, response, ctx) => {
    const body = object(request.body);
    const status = optionalEnum(body.status, FINDING_REVIEW_STATUSES, "status");
    if (!status) throw new OperationsApiError(400, "invalid_request", "Finding review status is required", { category: "invalid_input" });
    const reason = requiredText(body.reason, "Review reason", 2_000);
    const operatorOverride = body.operatorOverride === undefined ? false : body.operatorOverride;
    if (typeof operatorOverride !== "boolean") throw new OperationsApiError(400, "invalid_request", "operatorOverride must be boolean", { category: "invalid_input" });
    if (operatorOverride && reason.length < 12) throw new OperationsApiError(400, "invalid_request", "Evidence override reason is too short", { category: "invalid_input" });
    response.json(reviews.reviewFinding(
      identifier(request.params.findingId, "Finding ID"),
      { expectedVersion: requiredPositiveInteger(body.expectedVersion, "expectedVersion"), status, reason, operatorOverride },
      requiredIdempotencyKey(request.get("Idempotency-Key")), ctx.actor, ctx.access,
    ));
  }));

  router.get("/api/v2/intelligence/artifacts", handle(dependencies, (request, response, { access }) => {
    response.json(repository.listArtifacts(access, {
      limit: limit(request), cursor: cursor(request),
      missionId: optionalIdentifier(value(request, "missionId"), "Mission ID"),
      runId: optionalIdentifier(value(request, "runId"), "Run ID"),
      artifactType: plainFilter(request, "artifactType"),
    }));
  }));
  router.get("/api/v2/intelligence/artifacts/:artifactId", handle(dependencies, (request, response, { access }) => {
    response.json(repository.getArtifact(identifier(request.params.artifactId, "Artifact ID"), access));
  }));

  router.get("/api/v2/observability/events", handle(dependencies, (request, response, { access }) => {
    response.json(repository.listEvents(access, {
      limit: limit(request), cursor: cursor(request),
      missionId: optionalIdentifier(value(request, "missionId"), "Mission ID"),
      runId: optionalIdentifier(value(request, "runId"), "Run ID"),
      eventType: plainFilter(request, "eventType"),
      journey: optionalEnum(value(request, "journey"), JOURNEYS, "journey"),
      traceId: optionalIdentifier(value(request, "traceId"), "Trace ID"),
      actorId: optionalIdentifier(value(request, "actorId"), "Actor ID"),
      from: optionalTimestamp(value(request, "from"), "from"),
      to: optionalTimestamp(value(request, "to"), "to"),
    }));
  }));
  router.get("/api/v2/observability/logs", handle(dependencies, (request, response, { access }) => {
    response.json(repository.listLogs(access, {
      limit: limit(request), cursor: cursor(request),
      missionId: optionalIdentifier(value(request, "missionId"), "Mission ID"),
      runId: optionalIdentifier(value(request, "runId"), "Run ID"),
      stepId: optionalIdentifier(value(request, "stepId"), "Step ID"),
      actionId: optionalIdentifier(value(request, "actionId"), "Action ID"),
      severity: optionalEnum(value(request, "severity"), LOG_SEVERITIES, "severity"),
      domain: plainFilter(request, "domain"),
      traceId: optionalIdentifier(value(request, "traceId"), "Trace ID"),
      query: optionalSearch(value(request, "query")),
      from: optionalTimestamp(value(request, "from"), "from"),
      to: optionalTimestamp(value(request, "to"), "to"),
    }));
  }));
  router.get("/api/v2/observability/health", handle(dependencies, (request, response, { access }) => {
    response.json(repository.listHealth(access, {
      limit: limit(request), cursor: cursor(request),
      componentType: plainFilter(request, "componentType"),
      componentId: optionalIdentifier(value(request, "componentId"), "Component ID"),
      status: optionalEnum(value(request, "status"), HEALTH_STATUSES, "status"),
      from: optionalTimestamp(value(request, "from"), "from"),
      to: optionalTimestamp(value(request, "to"), "to"),
    }));
  }));
  router.get("/api/v2/operations/runs/:runId/recovery", handle(dependencies, (request, response, { access }) => {
    response.json(recovery.getRunRecovery(identifier(request.params.runId, "Run ID"), access));
  }));

  router.get("/api/v2/learning/evaluations", handle(dependencies, (request, response, { access }) => {
    response.json(repository.listEvaluations(access, {
      limit: limit(request), cursor: cursor(request),
      missionId: optionalIdentifier(value(request, "missionId"), "Mission ID"),
      runId: optionalIdentifier(value(request, "runId"), "Run ID"),
      journey: optionalEnum(value(request, "journey"), JOURNEYS, "journey"),
    }));
  }));
  router.get("/api/v2/learning/lessons", handle(dependencies, (request, response, { access }) => {
    response.json(repository.listLessons(access, {
      limit: limit(request), cursor: cursor(request),
      status: optionalEnum(value(request, "status"), LESSON_STATUSES, "status"),
      lessonType: plainFilter(request, "lessonType"),
      missionId: optionalIdentifier(value(request, "missionId"), "Mission ID"),
      query: optionalSearch(value(request, "query")),
    }));
  }));
  router.get("/api/v2/learning/lessons/:lessonId", handle(dependencies, (request, response, { access }) => {
    response.json(repository.getLesson(identifier(request.params.lessonId, "Lesson ID"), access));
  }));
  router.post("/api/v2/learning/lessons/:lessonId/review", handle(dependencies, (request, response, ctx) => {
    const body = object(request.body);
    const status = optionalEnum(body.status, LESSON_REVIEW_STATUSES, "status");
    if (!status) throw new OperationsApiError(400, "invalid_request", "Lesson review status is required", { category: "invalid_input" });
    response.json(reviews.reviewLesson(
      identifier(request.params.lessonId, "Lesson ID"),
      {
        expectedUpdatedAt: optionalTimestamp(body.expectedUpdatedAt, "expectedUpdatedAt") ?? requiredText(body.expectedUpdatedAt, "expectedUpdatedAt"),
        status,
        reason: requiredText(body.reason, "Review reason", 2_000),
      },
      requiredIdempotencyKey(request.get("Idempotency-Key")), ctx.actor, ctx.access,
    ));
  }));
  router.get("/api/v2/learning/usage", handle(dependencies, (request, response, { access }) => {
    response.json(repository.listLessonUsage(access, {
      limit: limit(request), cursor: cursor(request),
      lessonId: optionalIdentifier(value(request, "lessonId"), "Lesson ID"),
      missionId: optionalIdentifier(value(request, "missionId"), "Mission ID"),
      runId: optionalIdentifier(value(request, "runId"), "Run ID"),
    }));
  }));

  router.get("/api/v2/reports", handle(dependencies, (request, response, { access }) => {
    response.json(repository.listReports(access, {
      limit: limit(request), cursor: cursor(request),
      missionId: optionalIdentifier(value(request, "missionId"), "Mission ID"),
      runId: optionalIdentifier(value(request, "runId"), "Run ID"),
    }));
  }));
  router.get("/api/v2/reports/runs/:runId/export", handle(dependencies, (request, response, ctx) => {
    const runId = identifier(request.params.runId, "Run ID");
    const exported = repository.getRunCompletionExport(runId, ctx.access);
    repository.recordRunCompletionExport(exported, ctx.actor);
    const filename = completionExportFilename(runId);
    response.status(200);
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("Content-Security-Policy", "sandbox");
    response.send(`${JSON.stringify(exported, null, 2)}\n`);
  }));
  router.get("/api/v2/reports/:artifactId", handle(dependencies, (request, response, { access }) => {
    response.json(repository.getReport(identifier(request.params.artifactId, "Report artifact ID"), access));
  }));

  router.get("/api/v2/system/providers", handle(dependencies, (request, response, { access }) => {
    response.json(repository.listProviders(access, { limit: limit(request), cursor: cursor(request) }));
  }));
  router.get("/api/v2/system/mcp", handle(dependencies, (request, response, { access }) => {
    response.json(repository.listMcpServers(access, {
      limit: limit(request), cursor: cursor(request),
      status: optionalEnum(value(request, "status"), MCP_STATUSES, "status"),
    }));
  }));
  router.get("/api/v2/system/health", handle(dependencies, (request, response, { access }) => {
    response.json(repository.listHealth(access, {
      limit: limit(request), cursor: cursor(request),
      componentType: plainFilter(request, "componentType"),
      componentId: optionalIdentifier(value(request, "componentId"), "Component ID"),
      status: optionalEnum(value(request, "status"), HEALTH_STATUSES, "status"),
    }));
  }));
  router.get("/api/v2/system/policies", handle(dependencies, (request, response, { access }) => {
    response.json(repository.listSystemPolicies(access, { limit: limit(request), cursor: cursor(request) }));
  }));

  return router;
}
