import { describe, expect, test } from "bun:test";
import {
  BoundedByteCapture,
  BoundedSseParser,
  buildAnthropicRequestHeaders,
  buildAnthropicResponseHeaders,
  buildAnthropicUpstreamUrl,
  redactDiagnosticText,
  redactDiagnosticValue,
  redactProxyHeaders,
  sanitizeApiEvent,
  sanitizeLlmLogEntry,
  sha256Bytes,
  summarizeAnthropicPayload,
  summarizeAnthropicStreamEvent,
} from "../anthropicProxy";

describe("Anthropic proxy boundary", () => {
  test("forwards only provider API headers and strips dashboard/browser credentials", () => {
    const headers = buildAnthropicRequestHeaders({
      accept: "application/json",
      "content-type": "application/json",
      authorization: "Bearer dashboard-secret",
      "x-api-key": "provider-secret",
      cookie: "chillspwn_token=dashboard-secret",
      "x-dashboard-token": "dashboard-secret",
      origin: "https://dashboard.test",
      referer: "https://dashboard.test/?token=dashboard-secret",
      "proxy-authorization": "Basic secret",
      "x-forwarded-for": "203.0.113.7",
      "sec-fetch-site": "same-origin",
      "x-stainless-runtime": "bun",
    }, "dashboard-secret");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-api-key")).toBe("provider-secret");
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("origin")).toBeNull();
    expect(headers.get("x-stainless-runtime")).toBe("bun");
  });

  test("preserves a provider bearer distinct from the dashboard token", () => {
    const headers = buildAnthropicRequestHeaders({ authorization: "Bearer provider-token" }, "dashboard-token");
    expect(headers.get("authorization")).toBe("Bearer provider-token");
  });

  test("removes dashboard token query parameters without changing the upstream origin", () => {
    const url = buildAnthropicUpstreamUrl("/proxy/anthropic/v1/messages?token=dashboard&beta=1");
    expect(url).toBe("https://api.anthropic.com/v1/messages?beta=1");
    expect(buildAnthropicUpstreamUrl("/proxy/anthropic//evil.example/path")).toStartWith("https://api.anthropic.com/");
  });

  test("response allowlist drops cookies and rejects active content", () => {
    const upstream = new Headers({
      "content-type": "application/json; charset=utf-8",
      "set-cookie": "chillspwn_token=attacker",
      location: "https://evil.example/",
      "request-id": "req_1",
      "anthropic-ratelimit-requests-remaining": "5",
    });
    const safe = buildAnthropicResponseHeaders(upstream);
    expect(safe["set-cookie"]).toBeUndefined();
    expect(safe.location).toBeUndefined();
    expect(safe["request-id"]).toBe("req_1");
    expect(safe["X-Content-Type-Options"]).toBe("nosniff");
    expect(() => buildAnthropicResponseHeaders(new Headers({ "content-type": "text/html" }))).toThrow("unsafe content type");
    expect(() => buildAnthropicRequestHeaders({ "content-type": "text/html" }, "")).toThrow("application/json");
  });

  test("redacts browser and dashboard secrets in diagnostic logs", () => {
    const redacted = redactProxyHeaders({ cookie: "chillspwn_token=secret", "x-dashboard-token": "secret", "proxy-authorization": "Basic secret" });
    expect(JSON.stringify(redacted)).not.toContain("chillspwn_token=secret");
    expect(JSON.stringify(redacted)).not.toContain("Basic secret");
    expect(redacted.cookie).toBe("[REDACTED]");
  });

  test("retains only non-content request, response, and stream metadata", () => {
    const body = {
      model: "claude-test",
      system: "confidential system instructions",
      messages: [{ role: "user", content: "password=never-log-this" }],
      tools: [{ name: "safe_tool", input_schema: { token: "never-log-this" } }],
      stream: true,
      max_tokens: 512,
    };
    const summary = summarizeAnthropicPayload(body, { byteSize: 500, sha256: "a".repeat(64) });
    expect(summary).toMatchObject({ bodyRetained: false, model: "claude-test", messageCount: 1, messageRoles: ["user"], toolNames: ["safe_tool"] });
    expect(JSON.stringify(summary)).not.toContain("never-log-this");
    expect(JSON.stringify(summary)).not.toContain("confidential system");

    const stream = summarizeAnthropicStreamEvent({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "secret=never-log-this" },
      usage: { output_tokens: 12 },
    });
    expect(stream).toMatchObject({ bodyRetained: false, type: "content_block_delta", deltaType: "text_delta" });
    expect(JSON.stringify(stream)).not.toContain("never-log-this");
  });

  test("redacts nested legacy event secrets before web delivery", () => {
    const redacted = redactDiagnosticValue({
      authorization: "Bearer do-not-return",
      nested: {
        password: "do-not-return",
        accessToken: "do-not-return",
        text: "api_key=do-not-return",
      },
    });
    expect(JSON.stringify(redacted)).not.toContain("do-not-return");
    expect(redacted).toMatchObject({
      authorization: "[REDACTED]",
      nested: { password: "[REDACTED]", accessToken: "[REDACTED]" },
    });
    expect(redactDiagnosticText('{"authorization":"Bearer do-not-return","apiKey":"do-not-return"}'))
      .not.toContain("do-not-return");
  });

  test("projects historical LLM logs to metadata and hashes only", () => {
    const safe = sanitizeLlmLogEntry({
      ts: "2026-07-15T00:00:00.000Z",
      provider: "anthropic",
      auth: "Bearer do-not-return",
      model: "claude-test",
      direction: "request",
      sessionId: "s-safe",
      payload: {
        system: "private system prompt",
        messages: [{ role: "user", content: "do-not-return" }],
        tools: [{ name: "shell", input_schema: { apiKey: "do-not-return" } }],
      },
      arbitrary: "do-not-return",
    });
    expect(safe).toMatchObject({
      payloadRetained: false,
      provider: "anthropic",
      auth: "bearer",
      direction: "request",
      payload: { bodyRetained: false, messageCount: 1, toolNames: ["shell"] },
    });
    expect(JSON.stringify(safe)).not.toContain("do-not-return");
    expect(JSON.stringify(safe)).not.toContain("private system prompt");
  });

  test("projects legacy API events without prompt, response, or tool bodies", () => {
    const assistant = sanitizeApiEvent({
      type: "assistant",
      message: {
        model: "claude-test",
        usage: { input_tokens: 4, output_tokens: 2 },
        content: [
          { type: "text", text: "do-not-return" },
          { type: "tool_use", name: "shell", input: { command: "do-not-return" } },
        ],
      },
      authorization: "Bearer do-not-return",
    });
    expect(assistant).toMatchObject({
      contentRetained: false,
      type: "assistant",
      model: "claude-test",
      contentTypes: ["text", "tool_use"],
      toolNames: ["shell"],
      usage: { input_tokens: 4, output_tokens: 2 },
    });
    expect(JSON.stringify(assistant)).not.toContain("do-not-return");

    const proxy = sanitizeApiEvent({
      type: "system",
      subtype: "init",
      proxy: true,
      method: "POST",
      upstream_url: "https://api.anthropic.com/v1/messages?token=do-not-return",
      request_headers: { "x-api-key": "do-not-return" },
      request_body: { model: "claude-test", messages: [{ role: "user", content: "do-not-return" }] },
    });
    expect(proxy).toMatchObject({
      contentRetained: false,
      upstreamPath: "/v1/messages",
      requestHeaderNames: ["x-api-key"],
      request: { bodyRetained: false, messageCount: 1 },
    });
    expect(JSON.stringify(proxy)).not.toContain("do-not-return");
  });

  test("bounds response capture while hashing all bytes", () => {
    const capture = new BoundedByteCapture(5);
    capture.push(Buffer.from("abc"));
    capture.push(Buffer.from("defgh"));
    const result = capture.finish();
    expect(result.bytes.toString()).toBe("abcde");
    expect(result.byteSize).toBe(8);
    expect(result.truncated).toBe(true);
    expect(result.sha256).toBe(sha256Bytes(Buffer.from("abcdefgh")));
  });

  test("bounds SSE events and discards oversized payloads", () => {
    const parser = new BoundedSseParser(32);
    const payloads: string[] = [];
    parser.push('event: message\r\ndata: {"ok":', (payload) => payloads.push(payload));
    parser.push('true}\r\n\r\n', (payload) => payloads.push(payload));
    const oversized = parser.push(`data: ${"x".repeat(64)}\n\n`, (payload) => payloads.push(payload));
    expect(payloads).toEqual(['{"ok":true}']);
    expect(oversized).toBe(1);
    expect(parser.finish((payload) => payloads.push(payload))).toBe(0);
  });
});
