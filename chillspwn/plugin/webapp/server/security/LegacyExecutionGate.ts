import type { NextFunction, Request, Response } from "express";

export const LEGACY_EXECUTION_DISABLED_CODE = "legacy_execution_disabled";

const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const LEGACY_WEB_SOCKET_MUTATIONS = new Set([
  "chat",
  "switch_provider",
  "followup",
  "interrupt",
  "cancel_queued",
  "grok_permission_response",
  "stop",
  "close_with_memory",
  "delete_session",
  "term_start",
  "term_input",
  "term_resize",
  "term_close",
]);

export interface LegacyExecutionDeniedEvent {
  readonly channel: "http" | "websocket";
  readonly operation: string;
  readonly path?: string;
  readonly method?: string;
}

export interface LegacyExecutionGateOptions {
  /** Explicit compatibility opt-in. The secure production default is false. */
  readonly enabled: boolean;
  readonly audit?: (event: LegacyExecutionDeniedEvent) => void;
  readonly clock?: () => Date;
}

function isCanonicalV2Path(path: string): boolean {
  return path === "/api/v2" || path.startsWith("/api/v2/");
}

/**
 * Returns true only for an unversioned compatibility mutation owned by the
 * retired desktop/chat runtime. Read-only compatibility and every canonical
 * `/api/v2` request remain outside this gate.
 */
export function isLegacyHttpMutation(method: string, path: string): boolean {
  const normalizedMethod = method.trim().toUpperCase();
  if (SAFE_HTTP_METHODS.has(normalizedMethod)) return false;
  if (isCanonicalV2Path(path)) return false;
  return path === "/proxy" || path.startsWith("/proxy/") || path === "/api" || path.startsWith("/api/");
}

/** Returns the recognized mutating legacy WS operation, or null for reads/unknown input. */
export function legacyWebSocketMutation(value: unknown): string | null {
  return typeof value === "string" && LEGACY_WEB_SOCKET_MUTATIONS.has(value)
    ? value
    : null;
}

export function createLegacyExecutionHttpGate(options: LegacyExecutionGateOptions) {
  const clock = options.clock ?? (() => new Date());
  return (request: Request, response: Response, next: NextFunction): void => {
    if (options.enabled || !isLegacyHttpMutation(request.method, request.path)) {
      next();
      return;
    }

    options.audit?.({
      channel: "http",
      operation: "legacy_http_mutation",
      path: request.path,
      method: request.method.toUpperCase(),
    });
    response.setHeader("Cache-Control", "no-store");
    response.status(403).json({
      error: {
        code: LEGACY_EXECUTION_DISABLED_CODE,
        message: "Legacy mutation and execution paths are disabled",
        humanMessage: "Use an Autonomous mission or one exact Guided step in Command OS.",
        retryable: false,
        category: "policy_denied",
        remediation:
          "Use the versioned /api/v2 mission APIs. Enable legacy execution only for a time-bounded rollback after reviewing its weaker journey boundary.",
        timestamp: clock().toISOString(),
      },
    });
  };
}

export function legacyExecutionWebSocketError(operation: string): Readonly<Record<string, unknown>> {
  return {
    type: "error",
    code: LEGACY_EXECUTION_DISABLED_CODE,
    operation,
    message: "Legacy chat and terminal execution are disabled; use Autonomous or Guided Command OS.",
    retryable: false,
  };
}
