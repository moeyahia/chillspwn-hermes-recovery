import { describe, expect, test } from "bun:test";
import {
  buildAnthropicRequestHeaders,
  buildAnthropicResponseHeaders,
  buildAnthropicUpstreamUrl,
  redactProxyHeaders,
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
  });
});
