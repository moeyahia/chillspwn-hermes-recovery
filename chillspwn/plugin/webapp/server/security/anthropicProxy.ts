import { createHash } from "node:crypto";
import { tokensMatch } from "./auth";

type HeaderValue = string | string[] | undefined;
type HeaderInput = Record<string, HeaderValue>;

const REQUEST_HEADER_ALLOWLIST = new Set([
  "accept",
  "content-type",
  "x-api-key",
  "authorization",
  "anthropic-version",
  "anthropic-beta",
  "x-app",
  "user-agent",
]);

const RESPONSE_HEADER_ALLOWLIST = new Set([
  "request-id",
  "x-request-id",
  "retry-after",
]);

function headerValue(value: HeaderValue): string | null {
  if (value == null) return null;
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function isDashboardAuthorization(value: string, dashboardToken: string): boolean {
  if (!dashboardToken) return false;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return !!match && tokensMatch(match[1].trim(), dashboardToken);
}

export function buildAnthropicRequestHeaders(headers: HeaderInput, dashboardToken: string): Headers {
  const output = new Headers();
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    if (!REQUEST_HEADER_ALLOWLIST.has(name) && !name.startsWith("x-stainless-")) continue;
    const value = headerValue(rawValue);
    if (value == null) continue;
    if (name === "authorization" && isDashboardAuthorization(value, dashboardToken)) continue;
    if (name === "content-type" && !/^application\/json(?:\s*;|$)/i.test(value)) {
      throw new Error("Anthropic proxy accepts application/json request bodies only");
    }
    output.set(name, value);
  }
  return output;
}

export function buildAnthropicUpstreamUrl(originalUrl: string, upstream = "https://api.anthropic.com"): string {
  const incoming = new URL(originalUrl, "http://chillspwn.invalid");
  const prefix = "/proxy/anthropic";
  if (incoming.pathname !== prefix && !incoming.pathname.startsWith(`${prefix}/`)) {
    throw new Error("invalid Anthropic proxy path");
  }
  const destination = new URL(upstream);
  destination.pathname = incoming.pathname.slice(prefix.length) || "/";
  destination.search = "";
  for (const [name, value] of incoming.searchParams) {
    if (name.toLowerCase() !== "token") destination.searchParams.append(name, value);
  }
  return destination.toString();
}

export function buildAnthropicResponseHeaders(headers: Headers): Record<string, string> {
  const contentType = headers.get("content-type") || "";
  const isJson = /^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(contentType);
  const isSse = /^text\/event-stream(?:\s*;|$)/i.test(contentType);
  if (!isJson && !isSse) throw new Error("Anthropic upstream returned an unsafe content type");

  const output: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Referrer-Policy": "no-referrer",
  };
  headers.forEach((value, rawName) => {
    const name = rawName.toLowerCase();
    if (RESPONSE_HEADER_ALLOWLIST.has(name) || name.startsWith("anthropic-ratelimit-")) {
      output[rawName] = value;
    }
  });
  return output;
}

export function redactProxyHeaders(headers: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = {};
  const sensitive = new Set([
    "x-api-key",
    "authorization",
    "cookie",
    "set-cookie",
    "x-dashboard-token",
    "proxy-authorization",
  ]);
  for (const [name, value] of Object.entries(headers)) {
    if (!sensitive.has(name.toLowerCase())) {
      output[name] = String(value);
      continue;
    }
    output[name] = "[REDACTED]";
  }
  return output;
}

const DIAGNOSTIC_SECRET_FIELD = /(?:^|_)(?:access_token|api_key|auth|authorization|bearer|client_secret|cookie|credential|csrf_token|password|passwd|passphrase|private_key|proxy_authorization|refresh_token|secret|session_token|token)(?:$|_)/u;
const SAFE_METADATA_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]*$/u;
const SAFE_HTTP_METHOD = /^(?:DELETE|GET|HEAD|OPTIONS|PATCH|POST|PUT)$/u;
const SAFE_SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_PROVIDER = new Set(["anthropic", "openrouter", "openai-codex", "gemini", "xai-grok"]);

function normalizedDiagnosticKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/[^A-Za-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .toLowerCase();
}

function isDiagnosticSecretField(value: string): boolean {
  return DIAGNOSTIC_SECRET_FIELD.test(normalizedDiagnosticKey(value));
}

function safeIdentifier(value: unknown, maximum = 256): string | undefined {
  if (typeof value !== "string") return undefined;
  const candidate = value.slice(0, maximum);
  return SAFE_METADATA_IDENTIFIER.test(candidate) ? candidate : undefined;
}

function safeFiniteNumber(value: unknown, minimum = 0): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum
    ? value
    : undefined;
}

function diagnosticBuffer(value: unknown): Buffer {
  if (typeof value === "string") return Buffer.from(value, "utf8");
  if (value instanceof Uint8Array) return Buffer.from(value);
  try {
    return Buffer.from(JSON.stringify(value ?? null), "utf8");
  } catch {
    return Buffer.from("[unserializable]", "utf8");
  }
}

function safeTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 64) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function safeUpstreamPath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 8_192) return undefined;
  try {
    const parsed = new URL(value, "https://api.anthropic.com");
    const path = parsed.pathname.slice(0, 2_048);
    return /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/u.test(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

function safeUsage(value: unknown): Record<string, number> | undefined {
  const usage = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const output = Object.fromEntries(Object.entries(usage).flatMap(([key, entry]) => (
    /^(?:input_tokens|output_tokens|cache_read_input_tokens|cache_creation_input_tokens)$/u.test(key)
      && safeFiniteNumber(entry) !== undefined
      ? [[key, entry as number]]
      : []
  )));
  return Object.keys(output).length > 0 ? output : undefined;
}

function normalizePayloadSummary(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (item.bodyRetained !== false) return null;
  const byteSize = safeFiniteNumber(item.byteSize);
  if (byteSize === undefined) return null;
  const sha256 = typeof item.sha256 === "string" && SAFE_SHA256.test(item.sha256)
    ? item.sha256
    : undefined;
  const messageRoles = Array.isArray(item.messageRoles)
    ? item.messageRoles.flatMap((role) => /^(?:assistant|system|tool|user)$/u.test(String(role)) ? [String(role)] : []).slice(0, 4)
    : [];
  const normalizedContentTypes = contentTypes(
    Array.isArray(item.contentTypes)
      ? item.contentTypes.map((type) => ({ type }))
      : [],
  );
  const normalizedToolNames = Array.isArray(item.toolNames)
    ? item.toolNames.flatMap((name) => safeIdentifier(name) ? [String(name).slice(0, 256)] : []).slice(0, 100)
    : [];
  const usage = safeUsage(item.usage);
  return {
    bodyRetained: false,
    byteSize,
    ...(sha256 ? { sha256 } : {}),
    ...(safeIdentifier(item.type, 128) ? { type: safeIdentifier(item.type, 128) } : {}),
    ...(safeIdentifier(item.model) ? { model: safeIdentifier(item.model) } : {}),
    ...(safeIdentifier(item.role, 64) ? { role: safeIdentifier(item.role, 64) } : {}),
    ...(safeIdentifier(item.stopReason, 128) ? { stopReason: safeIdentifier(item.stopReason, 128) } : {}),
    ...(safeIdentifier(item.deltaType, 128) ? { deltaType: safeIdentifier(item.deltaType, 128) } : {}),
    ...(typeof item.stream === "boolean" ? { stream: item.stream } : {}),
    ...(safeFiniteNumber(item.maxTokens) !== undefined ? { maxTokens: item.maxTokens } : {}),
    messageCount: Math.trunc(safeFiniteNumber(item.messageCount) ?? 0),
    messageRoles,
    contentTypes: normalizedContentTypes,
    toolNames: normalizedToolNames,
    ...(usage ? { usage } : {}),
  };
}

/** Redact likely authentication material from bounded diagnostic strings. */
export function redactDiagnosticText(value: unknown, maximum = 4_000): string {
  const text = String(value ?? "").slice(0, maximum);
  return text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/gu, "[REDACTED-PRIVATE-KEY]")
    .replace(/([?&](?:access[_-]?token|api[_-]?key|auth|authorization|client[_-]?secret|credential|password|refresh[_-]?token|secret|session[_-]?token|token)=)[^&#\s]*/giu, "$1[REDACTED]")
    .replace(/((?:"|')?(?:access[_-]?token|api[_-]?key|auth|authorization|client[_-]?secret|cookie|credential|password|passwd|passphrase|private[_-]?key|proxy[_-]?authorization|refresh[_-]?token|secret|session[_-]?token|token)(?:"|')?\s*:\s*)"[^"]*"/giu, "$1\"[REDACTED]\"")
    .replace(/((?:"|')?(?:access[_-]?token|api[_-]?key|auth|authorization|client[_-]?secret|cookie|credential|password|passwd|passphrase|private[_-]?key|proxy[_-]?authorization|refresh[_-]?token|secret|session[_-]?token|token)(?:"|')?\s*:\s*)'[^']*'/giu, "$1'[REDACTED]'")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/giu, "[REDACTED-AUTH]")
    .replace(/\b(?:AIza[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/gu, "[REDACTED-KEY]")
    .replace(/\b(authorization|api[_-]?key|client[_-]?secret|cookie|credential|password|passwd|passphrase|proxy[_-]?authorization|refresh[_-]?token|secret|session[_-]?token|token)\b\s*[=:]\s*[^\s,;}\]]+/giu, "$1: [REDACTED]")
    .replace(/[\r\n\u2028\u2029]+/gu, " ");
}

function toolNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const name = (item as Record<string, unknown>).name;
    return typeof name === "string" && /^[A-Za-z0-9._:-]{1,256}$/u.test(name) ? [name] : [];
  }).slice(0, 100);
}

function contentTypes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const type = (item as Record<string, unknown>).type;
    return typeof type === "string" && /^[A-Za-z0-9._:-]{1,128}$/u.test(type) ? [type] : [];
  }))].slice(0, 50);
}

/**
 * Produce log-safe metadata for an Anthropic request or response. Message,
 * system, tool-input, and content bodies are deliberately never retained.
 */
export function summarizeAnthropicPayload(
  value: unknown,
  options: { readonly byteSize: number; readonly sha256?: string },
): Record<string, unknown> {
  const item = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const messages = Array.isArray(item.messages) ? item.messages : [];
  const content = Array.isArray(item.content) ? item.content : [];
  const roles = [...new Set(messages.flatMap((message) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) return [];
    const role = (message as Record<string, unknown>).role;
    return typeof role === "string" && /^(?:user|assistant|system|tool)$/u.test(role) ? [role] : [];
  }))];
  const usage = safeUsage(item.usage);
  return {
    bodyRetained: false,
    byteSize: Math.max(0, Math.trunc(options.byteSize)),
    ...(options.sha256 && SAFE_SHA256.test(options.sha256) ? { sha256: options.sha256 } : {}),
    ...(safeIdentifier(item.type, 128) ? { type: safeIdentifier(item.type, 128) } : {}),
    ...(safeIdentifier(item.model) ? { model: safeIdentifier(item.model) } : {}),
    ...(safeIdentifier(item.role, 64) ? { role: safeIdentifier(item.role, 64) } : {}),
    ...(safeIdentifier(item.stop_reason, 128) ? { stopReason: safeIdentifier(item.stop_reason, 128) } : {}),
    ...(typeof item.stream === "boolean" ? { stream: item.stream } : {}),
    ...(typeof item.max_tokens === "number" && Number.isFinite(item.max_tokens) ? { maxTokens: item.max_tokens } : {}),
    messageCount: messages.length,
    messageRoles: roles,
    contentTypes: contentTypes(content),
    toolNames: toolNames(item.tools),
    ...(usage ? { usage } : {}),
  };
}

/** Preserve event lifecycle/usage metadata while dropping all streamed content. */
export function summarizeAnthropicStreamEvent(
  value: unknown,
  options: { readonly byteSize?: number; readonly sha256?: string } = {},
): Record<string, unknown> {
  const item = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const message = item.message && typeof item.message === "object" && !Array.isArray(item.message)
    ? item.message as Record<string, unknown>
    : {};
  const delta = item.delta && typeof item.delta === "object" && !Array.isArray(item.delta)
    ? item.delta as Record<string, unknown>
    : {};
  return {
    bodyRetained: false,
    ...(safeIdentifier(item.type, 128) ? { type: safeIdentifier(item.type, 128) } : {}),
    ...(safeIdentifier(message.model) ? { model: safeIdentifier(message.model) } : {}),
    ...(safeIdentifier(delta.type, 128) ? { deltaType: safeIdentifier(delta.type, 128) } : {}),
    ...(safeIdentifier(delta.stop_reason, 128) ? { stopReason: safeIdentifier(delta.stop_reason, 128) } : {}),
    ...summarizeAnthropicPayload({ usage: item.usage ?? message.usage }, {
      byteSize: options.byteSize ?? 0,
      sha256: options.sha256,
    }),
  };
}

export function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function summarizeOpaqueContent(value: unknown): {
  readonly bodyRetained: false;
  readonly byteSize: number;
  readonly sha256: string;
} {
  const bytes = diagnosticBuffer(value);
  return {
    bodyRetained: false,
    byteSize: bytes.length,
    sha256: sha256Bytes(bytes),
  };
}

/** Recursively redact legacy CLI JSON before it crosses the web API boundary. */
export function redactDiagnosticValue(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[TRUNCATED-DEPTH]";
  if (typeof value === "string") return redactDiagnosticText(value, 128_000);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 2_000).map((item) => redactDiagnosticValue(item, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 2_000).map(([key, item]) => [
    key,
    isDiagnosticSecretField(key) ? "[REDACTED]" : redactDiagnosticValue(item, depth + 1),
  ]));
}

/** Strict legacy/new LLM-log projection. Raw content and unrecognized fields are discarded. */
export function sanitizeLlmLogEntry(value: unknown): Record<string, unknown> {
  const item = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const rawPayload = item.payload;
  const payloadBytes = diagnosticBuffer(rawPayload);
  const payload = normalizePayloadSummary(rawPayload) ?? summarizeAnthropicPayload(rawPayload, {
    byteSize: payloadBytes.length,
    sha256: sha256Bytes(payloadBytes),
  });
  const provider = typeof item.provider === "string" && SAFE_PROVIDER.has(item.provider)
    ? item.provider
    : "unknown";
  const authText = String(item.auth ?? "").toLowerCase();
  const auth = authText.includes("api_key") || authText.includes("api key")
    ? "api_key"
    : authText.includes("oauth")
      ? "oauth"
      : authText.includes("bearer")
        ? "bearer"
        : "unknown";
  const endpoint = safeUpstreamPath(item.endpoint);
  return {
    payloadRetained: false,
    ...(safeTimestamp(item.ts) ? { ts: safeTimestamp(item.ts) } : {}),
    provider,
    auth,
    ...(safeIdentifier(item.model) ? { model: safeIdentifier(item.model) } : {}),
    ...(/^(?:request|response)$/u.test(String(item.direction)) ? { direction: item.direction } : {}),
    ...(endpoint ? { endpoint } : {}),
    ...(safeIdentifier(item.kind, 128) ? { kind: safeIdentifier(item.kind, 128) } : {}),
    ...(safeFiniteNumber(item.iter) !== undefined ? { iter: Math.trunc(item.iter as number) } : {}),
    ...(safeIdentifier(item.sessionId) ? { sessionId: safeIdentifier(item.sessionId) } : {}),
    payload,
  };
}

/**
 * Strict API-monitor projection for historical CLI/proxy JSONL. Only lifecycle,
 * numeric usage, allowlisted identifiers, sizes, and hashes cross the route.
 */
export function sanitizeApiEvent(value: unknown, rawValue?: string | Uint8Array): Record<string, unknown> {
  const item = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const eventBytes = rawValue === undefined ? diagnosticBuffer(item) : diagnosticBuffer(rawValue);
  const type = safeIdentifier(item.type, 128) ?? "unknown";
  const subtype = safeIdentifier(item.subtype, 128);
  const timestamp = safeTimestamp(item.timestamp ?? item.created_at);
  const message = item.message && typeof item.message === "object" && !Array.isArray(item.message)
    ? item.message as Record<string, unknown>
    : {};
  const content = Array.isArray(message.content) ? message.content : [];
  const blockTypes = contentTypes(content);
  const eventToolNames = content.flatMap((block) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) return [];
    const record = block as Record<string, unknown>;
    return record.type === "tool_use" && safeIdentifier(record.name) ? [String(record.name).slice(0, 256)] : [];
  }).slice(0, 100);
  const usage = safeUsage(message.usage ?? item.usage);
  const requestSource = item.request ?? item.request_body;
  const requestBytes = diagnosticBuffer(requestSource);
  const request = requestSource === undefined
    ? undefined
    : normalizePayloadSummary(requestSource) ?? summarizeAnthropicPayload(requestSource, {
      byteSize: safeFiniteNumber(item.request_body_bytes) ?? requestBytes.length,
      sha256: sha256Bytes(requestBytes),
    });
  const responseSource = item.response ?? item.response_body;
  const responseBytes = diagnosticBuffer(responseSource);
  const response = responseSource === undefined
    ? undefined
    : normalizePayloadSummary(responseSource) ?? summarizeAnthropicPayload(responseSource, {
      byteSize: safeFiniteNumber(item.response_bytes) ?? responseBytes.length,
      sha256: sha256Bytes(responseBytes),
    });
  const streamSource = item.payload;
  const streamBytes = diagnosticBuffer(streamSource);
  const stream = type !== "sse_event"
    ? undefined
    : normalizePayloadSummary(streamSource) ?? summarizeAnthropicStreamEvent(streamSource, {
      byteSize: streamBytes.length,
      sha256: sha256Bytes(streamBytes),
    });
  const requestHeaderNames = Array.isArray(item.request_header_names)
    ? item.request_header_names
    : item.request_headers && typeof item.request_headers === "object" && !Array.isArray(item.request_headers)
      ? Object.keys(item.request_headers as Record<string, unknown>)
      : [];
  const safeHeaderNames = requestHeaderNames
    .flatMap((name) => /^[a-z0-9-]{1,128}$/u.test(String(name).toLowerCase()) ? [String(name).toLowerCase()] : [])
    .slice(0, 100);
  const upstreamPath = safeUpstreamPath(item.upstream_path ?? item.upstream_url);
  const method = typeof item.method === "string" && SAFE_HTTP_METHOD.test(item.method.toUpperCase())
    ? item.method.toUpperCase()
    : undefined;
  const model = safeIdentifier(message.model ?? item.model ?? request?.model ?? response?.model);
  const status = safeFiniteNumber(item.status);
  const durationMs = safeFiniteNumber(item.duration_ms);
  const responseByteCount = safeFiniteNumber(item.response_bytes);
  const error = item.error === undefined ? undefined : summarizeOpaqueContent(item.error);
  return {
    contentRetained: false,
    byteSize: eventBytes.length,
    sha256: sha256Bytes(eventBytes),
    type,
    ...(subtype ? { subtype } : {}),
    ...(timestamp ? { timestamp } : {}),
    ...(typeof item.proxy === "boolean" ? { proxy: item.proxy } : {}),
    ...(method ? { method } : {}),
    ...(upstreamPath ? { upstreamPath } : {}),
    ...(model ? { model } : {}),
    ...(safeIdentifier(item.uuid) ? { uuid: safeIdentifier(item.uuid) } : {}),
    ...(safeIdentifier(item.session_id) ? { sessionId: safeIdentifier(item.session_id) } : {}),
    ...(safeIdentifier(item.hook_name ?? item.hook_event, 256) ? { hookName: safeIdentifier(item.hook_name ?? item.hook_event, 256) } : {}),
    ...(safeFiniteNumber(item.estimated_tokens) !== undefined ? { estimatedTokens: item.estimated_tokens } : {}),
    ...(request ? { request } : {}),
    ...(safeHeaderNames.length > 0 ? { requestHeaderNames: safeHeaderNames } : {}),
    ...(response ? { response } : {}),
    ...(stream ? { stream } : {}),
    ...(safeIdentifier(item.sse_type, 128) ? { sseType: safeIdentifier(item.sse_type, 128) } : {}),
    ...(blockTypes.length > 0 ? { contentTypes: blockTypes } : {}),
    ...(eventToolNames.length > 0 ? { toolNames: eventToolNames } : {}),
    ...(content.length > 0 ? { contentBlockCount: content.length } : {}),
    ...(usage ? { usage } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(responseByteCount !== undefined ? { responseBytes: responseByteCount } : {}),
    ...(typeof item.is_stream === "boolean" ? { isStream: item.is_stream } : {}),
    ...(safeFiniteNumber(item.total_cost_usd) !== undefined ? { totalCostUsd: item.total_cost_usd } : {}),
    ...(safeIdentifier(item.stop_reason, 128) ? { stopReason: safeIdentifier(item.stop_reason, 128) } : {}),
    ...(error ? { error } : {}),
  };
}

export interface BoundedByteCaptureResult {
  readonly bytes: Buffer;
  readonly byteSize: number;
  readonly sha256: string;
  readonly truncated: boolean;
}

/** Hash an entire stream while retaining at most `maximumRetainedBytes`. */
export class BoundedByteCapture {
  private readonly chunks: Buffer[] = [];
  private readonly hash = createHash("sha256");
  private retainedBytes = 0;
  private totalBytes = 0;
  private finished: BoundedByteCaptureResult | null = null;

  constructor(private readonly maximumRetainedBytes: number) {
    if (!Number.isSafeInteger(maximumRetainedBytes) || maximumRetainedBytes < 0) {
      throw new Error("maximumRetainedBytes must be a non-negative safe integer");
    }
  }

  push(value: Uint8Array): void {
    if (this.finished) throw new Error("capture is already finished");
    this.totalBytes += value.byteLength;
    this.hash.update(value);
    const available = this.maximumRetainedBytes - this.retainedBytes;
    if (available <= 0) return;
    const retained = value.subarray(0, Math.min(available, value.byteLength));
    if (retained.length > 0) {
      this.chunks.push(Buffer.from(retained));
      this.retainedBytes += retained.length;
    }
  }

  finish(): BoundedByteCaptureResult {
    if (!this.finished) {
      this.finished = {
        bytes: Buffer.concat(this.chunks, this.retainedBytes),
        byteSize: this.totalBytes,
        sha256: this.hash.digest("hex"),
        truncated: this.retainedBytes < this.totalBytes,
      };
    }
    return this.finished;
  }
}

/**
 * Incremental SSE `data:` parser with a hard per-event memory ceiling. An
 * oversized event is discarded through its blank-line delimiter.
 */
export class BoundedSseParser {
  private lineBuffer = "";
  private discardingLine = false;
  private eventOversized = false;
  private dataLines: string[] = [];
  private dataCharacters = 0;
  private oversizedEvents = 0;

  constructor(private readonly maximumEventCharacters: number) {
    if (!Number.isSafeInteger(maximumEventCharacters) || maximumEventCharacters < 1) {
      throw new Error("maximumEventCharacters must be a positive safe integer");
    }
  }

  push(chunk: string, onData: (payload: string) => void): number {
    this.oversizedEvents = 0;
    let cursor = 0;
    while (cursor < chunk.length) {
      const newline = chunk.indexOf("\n", cursor);
      if (newline < 0) {
        this.appendLineFragment(chunk.slice(cursor), false, onData);
        break;
      }
      this.appendLineFragment(chunk.slice(cursor, newline), true, onData);
      cursor = newline + 1;
    }
    return this.oversizedEvents;
  }

  finish(onData: (payload: string) => void): number {
    this.oversizedEvents = 0;
    if (this.discardingLine) {
      this.discardingLine = false;
      this.eventOversized = true;
    } else if (this.lineBuffer.length > 0) {
      const line = this.lineBuffer;
      this.lineBuffer = "";
      this.handleLine(line, onData);
    }
    this.handleLine("", onData);
    return this.oversizedEvents;
  }

  private appendLineFragment(fragment: string, complete: boolean, onData: (payload: string) => void): void {
    if (this.discardingLine) {
      if (complete) this.discardingLine = false;
      return;
    }
    if (this.lineBuffer.length + fragment.length > this.maximumEventCharacters) {
      this.lineBuffer = "";
      this.eventOversized = true;
      this.discardingLine = !complete;
      return;
    }
    this.lineBuffer += fragment;
    if (!complete) return;
    const line = this.lineBuffer.endsWith("\r") ? this.lineBuffer.slice(0, -1) : this.lineBuffer;
    this.lineBuffer = "";
    this.handleLine(line, onData);
  }

  private handleLine(line: string, onData: (payload: string) => void): void {
    if (line === "") {
      if (this.eventOversized) this.oversizedEvents++;
      else if (this.dataLines.length > 0) onData(this.dataLines.join("\n"));
      this.eventOversized = false;
      this.dataLines = [];
      this.dataCharacters = 0;
      return;
    }
    if (this.eventOversized || !line.startsWith("data:")) return;
    const data = line.slice(5).replace(/^ /u, "");
    const additional = data.length + (this.dataLines.length > 0 ? 1 : 0);
    if (this.dataCharacters + additional > this.maximumEventCharacters) {
      this.eventOversized = true;
      this.dataLines = [];
      this.dataCharacters = 0;
      return;
    }
    this.dataLines.push(data);
    this.dataCharacters += additional;
  }
}
