interface JsonRpcErrorLike {
  readonly code?: unknown;
  readonly message?: unknown;
  readonly data?: unknown;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function httpStatus(error: JsonRpcErrorLike): number | undefined {
  const data = record(error.data);
  const candidates = [data.httpStatus, data.statusCode, data.status, error.code];
  for (const candidate of candidates) {
    const value = typeof candidate === "string" && /^\d{3}$/u.test(candidate.trim())
      ? Number(candidate)
      : candidate;
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 100 && value <= 599) {
      return value;
    }
  }
  return undefined;
}

function headerValue(headers: unknown, name: string): unknown {
  const item = record(headers);
  const direct = Object.entries(item).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return direct?.[1];
}

function normalizedDelay(value: number): number | undefined {
  return Number.isFinite(value) && value >= 0
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.round(value))
    : undefined;
}

function retryAfterMs(error: JsonRpcErrorLike, now: number): number | undefined {
  const data = record(error.data);
  const direct = Number(data.retryAfterMs);
  if (Number.isFinite(direct) && direct >= 0) return normalizedDelay(direct);
  const raw = data.retryAfter
    ?? headerValue(data.headers, "retry-after")
    ?? headerValue(record(data.response).headers, "retry-after");
  if (raw === undefined || raw === null) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return normalizedDelay(seconds * 1_000);
  const at = Date.parse(String(raw));
  return Number.isFinite(at) ? normalizedDelay(Math.max(0, at - now)) : undefined;
}

function kind(error: JsonRpcErrorLike, status: number | undefined): {
  readonly name: string;
  readonly code: string;
  readonly message: string;
} {
  const providerMessage = typeof error.message === "string" ? error.message : "";
  if (status === 429 || /rate.?limit|too many requests/iu.test(providerMessage)) {
    return {
      name: "RateLimitError",
      code: "grok_acp_rate_limited",
      message: "Grok ACP provider rate limit reached",
    };
  }
  if (status === 401) {
    return {
      name: "AuthenticationError",
      code: "grok_acp_authentication_failed",
      message: "Grok ACP provider authentication failed",
    };
  }
  if (status === 403) {
    return {
      name: "AuthorizationError",
      code: "grok_acp_authorization_failed",
      message: "Grok ACP provider authorization failed",
    };
  }
  if (status === 502 || status === 503 || status === 504
    || /unavailable|overloaded/iu.test(providerMessage)) {
    return {
      name: "ProviderUnavailableError",
      code: "grok_acp_provider_unavailable",
      message: "Grok ACP provider is temporarily unavailable",
    };
  }
  return {
    name: "GrokAcpRpcError",
    code: "grok_acp_request_failed",
    message: "Grok ACP request failed",
  };
}

/**
 * Provider JSON-RPC errors can contain echoed prompts, credentials, or other
 * untrusted payloads in `message` and `data`. Preserve only the small typed
 * subset the local retry/failure policy needs; never attach the raw response.
 */
export class GrokAcpRpcError extends Error {
  readonly code: string;
  readonly method: string;
  readonly rpcCode?: number;
  readonly status?: number;
  readonly statusCode?: number;
  readonly retryAfterMs?: number;

  constructor(method: string, error: JsonRpcErrorLike, now = Date.now()) {
    const status = httpStatus(error);
    const classified = kind(error, status);
    super(classified.message);
    this.name = classified.name;
    this.code = classified.code;
    this.method = method;
    if (typeof error.code === "number" && Number.isSafeInteger(error.code)) this.rpcCode = error.code;
    if (status !== undefined) {
      this.status = status;
      this.statusCode = status;
    }
    const retryDelay = retryAfterMs(error, now);
    if (retryDelay !== undefined) this.retryAfterMs = retryDelay;
  }
}

export function grokAcpRpcError(
  method: string,
  error: JsonRpcErrorLike,
  now = Date.now(),
): GrokAcpRpcError {
  return new GrokAcpRpcError(method, error, now);
}
