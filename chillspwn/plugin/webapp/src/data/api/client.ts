import type { ApiErrorEnvelope } from "../../domain/types/commandOs";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly humanMessage?: string;
  readonly retryable: boolean;
  readonly remediation?: string;
  readonly traceId?: string;

  constructor(status: number, envelope: ApiErrorEnvelope) {
    super(envelope.message);
    this.name = "ApiError";
    this.status = status;
    this.code = envelope.code;
    this.humanMessage = envelope.humanMessage;
    this.retryable = envelope.retryable === true;
    this.remediation = envelope.remediation;
    this.traceId = envelope.traceId;
  }
}

async function responseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const body = await response.text();
    if (!response.ok) {
      throw new ApiError(response.status, {
        code: "unexpected_response",
        message: body || `Request failed with HTTP ${response.status}`,
        humanMessage: "The Command OS service returned an unexpected response.",
      });
    }
    throw new Error("Expected a JSON response from the Command OS service");
  }
  return response.json() as Promise<unknown>;
}

function errorEnvelope(payload: unknown, status: number): ApiErrorEnvelope {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const root = payload as Record<string, unknown>;
    const candidate = root.error && typeof root.error === "object"
      ? root.error as Record<string, unknown> : root;
    return {
      code: typeof candidate.code === "string" ? candidate.code : `http_${status}`,
      message: typeof candidate.message === "string" ? candidate.message : `Request failed with HTTP ${status}`,
      humanMessage: typeof candidate.humanMessage === "string" ? candidate.humanMessage : undefined,
      retryable: candidate.retryable === true,
      remediation: typeof candidate.remediation === "string" ? candidate.remediation : undefined,
      traceId: typeof candidate.traceId === "string" ? candidate.traceId : undefined,
    };
  }
  return { code: `http_${status}`, message: `Request failed with HTTP ${status}` };
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { parse: (payload: unknown) => T },
): Promise<T> {
  const { parse, ...request } = options;
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: request.method === "GET" || !request.method ? "no-store" : undefined,
    ...request,
    headers: {
      Accept: "application/json",
      ...(request.body ? { "Content-Type": "application/json" } : {}),
      ...request.headers,
    },
  });
  const payload = await responseBody(response);
  if (!response.ok) throw new ApiError(response.status, errorEnvelope(payload, response.status));
  try {
    return parse(payload);
  } catch (error) {
    throw new ApiError(response.status, {
      code: "invalid_response_schema",
      message: error instanceof Error ? error.message : "Response failed schema validation",
      humanMessage: "Command OS received data it could not safely interpret.",
      remediation: "Check that the web client and server are running compatible versions.",
    });
  }
}
