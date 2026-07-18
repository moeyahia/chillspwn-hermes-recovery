import { describe, expect, test } from "bun:test";
import { grokAcpRpcError } from "../GrokAcpRpcError";

describe("Grok ACP JSON-RPC error boundary", () => {
  test("preserves a sanitized rate-limit status and bounded retry delay", () => {
    const error = grokAcpRpcError("session/prompt", {
      code: -32_000,
      message: "Too many requests: echoed-sensitive-prompt",
      data: {
        httpStatus: 429,
        headers: { "Retry-After": "7" },
        responseBody: "secret-provider-payload",
      },
    }, Date.parse("2026-07-18T00:00:00.000Z"));

    expect(error).toMatchObject({
      name: "RateLimitError",
      code: "grok_acp_rate_limited",
      method: "session/prompt",
      rpcCode: -32_000,
      status: 429,
      statusCode: 429,
      retryAfterMs: 7_000,
      message: "Grok ACP provider rate limit reached",
    });
    expect(JSON.stringify(error)).not.toContain("echoed-sensitive-prompt");
    expect(JSON.stringify(error)).not.toContain("secret-provider-payload");
  });

  test("accepts an HTTP-date retry boundary without retaining raw data", () => {
    const now = Date.parse("2026-07-18T00:00:00.000Z");
    const error = grokAcpRpcError("session/prompt", {
      code: 429,
      data: { retryAfter: "Sat, 18 Jul 2026 00:00:12 GMT", token: "never-retain" },
    }, now);

    expect(error.retryAfterMs).toBe(12_000);
    expect(Object.hasOwn(error, "data")).toBe(false);
    expect(JSON.stringify(error)).not.toContain("never-retain");
  });

  test("does not expose an unknown provider error message or arbitrary data", () => {
    const error = grokAcpRpcError("initialize", {
      code: -32_603,
      message: "private upstream detail",
      data: { prompt: "operator secret", headers: { Authorization: "Bearer secret" } },
    });

    expect(error).toMatchObject({
      name: "GrokAcpRpcError",
      code: "grok_acp_request_failed",
      message: "Grok ACP request failed",
      rpcCode: -32_603,
    });
    expect(JSON.stringify(error)).not.toContain("private upstream detail");
    expect(JSON.stringify(error)).not.toContain("operator secret");
    expect(JSON.stringify(error)).not.toContain("Bearer secret");
  });

  test("retains an excessive retry boundary so local policy can safe-stop instead of retrying early", () => {
    const error = grokAcpRpcError("session/prompt", {
      message: "rate limited",
      data: { retryAfterMs: Number.MAX_SAFE_INTEGER },
    });

    expect(error.retryAfterMs).toBe(Number.MAX_SAFE_INTEGER);
  });
});
