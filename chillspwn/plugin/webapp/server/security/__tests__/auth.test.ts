import { test, expect, describe } from "bun:test";
import {
  extractToken,
  tokensMatch,
  evaluateAuth,
  parseCookies,
  isWsUpgradeAuthorized,
  TOKEN_COOKIE,
  tokenFreeRedirectTarget,
} from "../auth";
import { loadSecurityConfig } from "../config";

const exposedCfg = loadSecurityConfig({ CHILLSPWN_BIND: "0.0.0.0", DASHBOARD_TOKEN: "s3cr3t" });
const localCfg = loadSecurityConfig({}); // loopback, no token ⇒ authActive false

describe("token extraction", () => {
  test("from Authorization: Bearer", () => {
    expect(extractToken({ headers: { authorization: "Bearer abc" } })).toEqual({
      token: "abc",
      fromQuery: false,
    });
  });
  test("from X-Dashboard-Token", () => {
    expect(extractToken({ headers: { "x-dashboard-token": "xyz" } }).token).toBe("xyz");
  });
  test("from cookie", () => {
    const headers = { cookie: `foo=1; ${TOKEN_COOKIE}=ck; bar=2` };
    expect(extractToken({ headers }).token).toBe("ck");
  });
  test("from ?token= query (express-parsed) flags fromQuery", () => {
    expect(extractToken({ headers: {}, query: { token: "qq" } })).toEqual({
      token: "qq",
      fromQuery: true,
    });
  });
  test("from raw URL query (WS upgrade path)", () => {
    expect(extractToken({ headers: {}, url: "/ws?token=urlq&x=1" })).toEqual({
      token: "urlq",
      fromQuery: true,
    });
  });
  test("missing token yields null", () => {
    expect(extractToken({ headers: {} }).token).toBeNull();
  });
});

describe("parseCookies", () => {
  test("parses and url-decodes", () => {
    expect(parseCookies("a=1; b=hello%20world")).toEqual({ a: "1", b: "hello world" });
    expect(parseCookies(undefined)).toEqual({});
  });
});

describe("tokensMatch (constant-time)", () => {
  test("matches identical, rejects different / empty", () => {
    expect(tokensMatch("abc", "abc")).toBe(true);
    expect(tokensMatch("abc", "abd")).toBe(false);
    expect(tokensMatch("", "abc")).toBe(false);
    expect(tokensMatch("abc", "")).toBe(false);
    // different lengths must not throw (hashing normalizes length)
    expect(tokensMatch("short", "a-much-longer-token")).toBe(false);
  });
});

describe("evaluateAuth", () => {
  test("no-op when auth inactive (local dev)", () => {
    expect(evaluateAuth({ headers: {}, socket: { remoteAddress: "203.0.113.9" } }, localCfg)).toEqual({
      allow: true,
    });
  });

  test("DIRECT loopback client is trusted (internal services, no proxy)", () => {
    const out = evaluateAuth(
      { headers: {}, socket: { remoteAddress: "127.0.0.1" }, path: "/api/board" },
      exposedCfg,
    );
    expect(out.allow).toBe(true);
  });

  test("loopback socket WITH X-Forwarded-For (reverse-proxied remote, e.g. Tailscale Serve) is NOT bypassed", () => {
    // Came through a proxy on behalf of a remote client → must present the token.
    const noToken = evaluateAuth(
      { headers: { "x-forwarded-for": "198.51.100.103" }, socket: { remoteAddress: "127.0.0.1" }, path: "/api/board" },
      exposedCfg,
    );
    expect(noToken.allow).toBe(false);
    const withToken = evaluateAuth(
      { headers: { "x-forwarded-for": "198.51.100.103", "x-dashboard-token": "s3cr3t" }, socket: { remoteAddress: "127.0.0.1" }, path: "/api/board" },
      exposedCfg,
    );
    expect(withToken.allow).toBe(true);
  });

  test("/api/health stays open", () => {
    const out = evaluateAuth(
      { headers: {}, socket: { remoteAddress: "203.0.113.9" }, path: "/api/health" },
      exposedCfg,
    );
    expect(out.allow).toBe(true);
  });

  test("/manifest.webmanifest stays open (PWA metadata fetched without credentials)", () => {
    const out = evaluateAuth(
      { headers: {}, socket: { remoteAddress: "203.0.113.9" }, path: "/manifest.webmanifest" },
      exposedCfg,
    );
    expect(out.allow).toBe(true);
  });

  test("remote without token is denied", () => {
    const out = evaluateAuth(
      { headers: {}, socket: { remoteAddress: "203.0.113.9" }, path: "/api/board" },
      exposedCfg,
    );
    expect(out.allow).toBe(false);
  });

  test("remote with valid bearer token is allowed", () => {
    const out = evaluateAuth(
      {
        headers: { authorization: "Bearer s3cr3t" },
        socket: { remoteAddress: "203.0.113.9" },
        path: "/api/board",
      },
      exposedCfg,
    );
    expect(out.allow).toBe(true);
  });

  test("remote with invalid token is denied", () => {
    const out = evaluateAuth(
      {
        headers: { "x-dashboard-token": "wrong" },
        socket: { remoteAddress: "203.0.113.9" },
      },
      exposedCfg,
    );
    expect(out.allow).toBe(false);
  });

  test("valid ?token= query sets the bootstrap cookie", () => {
    const out = evaluateAuth(
      { headers: {}, url: "/?token=s3cr3t", socket: { remoteAddress: "203.0.113.9" } },
      exposedCfg,
    );
    expect(out.allow).toBe(true);
    if (out.allow) expect(out.setCookie).toContain(`${TOKEN_COOKIE}=`);
  });

  test("query tokens are rejected outside the one-time root bootstrap", () => {
    const api = evaluateAuth(
      { headers: {}, url: "/api/board?token=s3cr3t", socket: { remoteAddress: "203.0.113.9" } },
      exposedCfg,
    );
    expect(api.allow).toBe(false);
    const websocket = evaluateAuth(
      { headers: {}, url: "/ws?token=s3cr3t", socket: { remoteAddress: "203.0.113.9" } },
      exposedCfg,
    );
    expect(websocket.allow).toBe(false);
  });

  test("HTTPS bootstrap sets Secure and token cleanup preserves other query state", () => {
    const out = evaluateAuth(
      {
        headers: { "x-forwarded-proto": "https" },
        url: "/?token=s3cr3t&b=build-1",
        socket: { remoteAddress: "203.0.113.9" },
      },
      exposedCfg,
    );
    expect(out.allow).toBe(true);
    if (out.allow) expect(out.setCookie).toContain("; Secure");
    expect(tokenFreeRedirectTarget("/?token=s3cr3t&b=build-1&view=live")).toBe("/?b=build-1&view=live");
  });
});

describe("isWsUpgradeAuthorized", () => {
  test("rejects remote upgrade without token, accepts with cookie", () => {
    expect(
      isWsUpgradeAuthorized({ headers: {}, socket: { remoteAddress: "203.0.113.9" } }, exposedCfg),
    ).toBe(false);
    expect(
      isWsUpgradeAuthorized(
        { headers: { cookie: `${TOKEN_COOKIE}=s3cr3t` }, socket: { remoteAddress: "203.0.113.9" } },
        exposedCfg,
      ),
    ).toBe(true);
  });
});
