/**
 * Dashboard authentication (Phase 1).
 *
 * A single shared-secret token (DASHBOARD_TOKEN) gates HTTP + WebSocket access when
 * the server is exposed (non-loopback) or a token is configured. Design choices:
 *
 *   - Loopback clients are ALWAYS trusted (local dev + SSH-tunnel mode need no token).
 *   - The token may arrive via: `Authorization: Bearer <t>`, `X-Dashboard-Token: <t>`,
 *     a `chillspwn_token` cookie, or a one-time root `/?token=<t>` bootstrap.
 *   - A valid root bootstrap sets an HttpOnly cookie, so the existing built PWA keeps
 *     working WITHOUT a rebuild: the operator visits `https://host/?token=<t>` once,
 *     then same-origin fetch + WS upgrades carry the cookie automatically.
 *   - Comparison is constant-time (hash both sides, then timingSafeEqual).
 *   - `/api/health` stays open (liveness probes).
 *
 * No new dependencies: cookies are parsed by hand; express/http types are referenced
 * structurally so the helpers are unit-testable without real request objects.
 */

import { createHash, timingSafeEqual } from "crypto";
import type { SecurityConfig } from "./config";
import { isLoopbackAddr } from "./config";

export const TOKEN_COOKIE = "chillspwn_token";

type HeaderBag = Record<string, string | string[] | undefined>;

interface MinimalRequest {
  headers: HeaderBag;
  query?: Record<string, unknown>;
  url?: string;
  path?: string;
  protocol?: string;
  socket?: { remoteAddress?: string; encrypted?: boolean };
}

function requestPath(req: MinimalRequest): string {
  if (typeof req.path === "string" && req.path) return req.path;
  try { return new URL(req.url || "/", "http://chillspwn.invalid").pathname; }
  catch { return "/"; }
}

function headerStr(headers: HeaderBag, name: string): string | undefined {
  const v = headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return v;
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(val);
  }
  return out;
}

function queryToken(req: MinimalRequest): string | undefined {
  // express-populated query (HTTP path)
  const q = req.query?.token;
  if (typeof q === "string" && q) return q;
  // raw URL query (WS upgrade path, where express hasn't parsed anything)
  if (req.url && req.url.includes("?")) {
    const qs = req.url.slice(req.url.indexOf("?") + 1);
    for (const pair of qs.split("&")) {
      const [k, v] = pair.split("=");
      if (k === "token" && v) return decodeURIComponent(v);
    }
  }
  return undefined;
}

export interface ExtractedToken {
  token: string | null;
  /** True when the token came from a `?token=` query (⇒ set a cookie). */
  fromQuery: boolean;
}

export function extractToken(req: MinimalRequest): ExtractedToken {
  const auth = headerStr(req.headers, "authorization");
  if (auth && /^bearer\s+/i.test(auth)) {
    return { token: auth.replace(/^bearer\s+/i, "").trim(), fromQuery: false };
  }
  const x = headerStr(req.headers, "x-dashboard-token");
  if (x) return { token: x.trim(), fromQuery: false };

  const cookies = parseCookies(headerStr(req.headers, "cookie"));
  if (cookies[TOKEN_COOKIE]) return { token: cookies[TOKEN_COOKIE], fromQuery: false };

  const q = queryToken(req);
  if (q) return { token: q, fromQuery: true };

  return { token: null, fromQuery: false };
}

/** Constant-time token comparison (length-independent via fixed-size hashing). */
export function tokensMatch(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function isSecureRequest(req: MinimalRequest): boolean {
  if (req.protocol === "https" || req.socket?.encrypted === true) return true;
  const forwarded = headerStr(req.headers, "x-forwarded-proto");
  return forwarded?.split(",", 1)[0].trim().toLowerCase() === "https";
}

/** Remove only the one-time dashboard token while preserving other URL state. */
export function tokenFreeRedirectTarget(rawUrl: string): string {
  const parsed = new URL(rawUrl || "/", "http://chillspwn.invalid");
  parsed.searchParams.delete("token");
  return `${parsed.pathname}${parsed.search}` || "/";
}

export type AuthOutcome =
  | { allow: true; setCookie?: string }
  | { allow: false; reason: string };

/** Core decision shared by the HTTP middleware and the WS upgrade guard. */
export function evaluateAuth(req: MinimalRequest, cfg: SecurityConfig): AuthOutcome {
  if (!cfg.authActive) return { allow: true };
  // Trust ONLY a DIRECT loopback connection (internal services such as the orchestrator's
  // board tools hitting http://127.0.0.1:3131). A request that arrives on loopback but
  // carries X-Forwarded-For came through a reverse proxy (e.g. Tailscale Serve) on behalf
  // of a REMOTE client — it must present the token like any other remote request, so the
  // loopback bypass does not apply to it.
  const forwarded = headerStr(req.headers, "x-forwarded-for");
  if (!forwarded && isLoopbackAddr(req.socket?.remoteAddress)) return { allow: true };
  // Open paths: liveness probe + the PWA manifest (non-sensitive metadata the browser
  // fetches WITHOUT credentials, so it 401s behind auth otherwise).
  const p = req.path ?? req.url ?? "";
  if (p.startsWith("/api/health") || p.startsWith("/manifest.webmanifest")) return { allow: true };

  const { token, fromQuery } = extractToken(req);
  // Query tokens are a one-time browser bootstrap only. Accepting them on API,
  // report, artifact, or WebSocket URLs would leave the dashboard secret in
  // histories and infrastructure logs without any compatibility benefit.
  if (fromQuery && requestPath(req) !== "/") {
    return { allow: false, reason: "query token is only allowed on the root bootstrap path" };
  }
  if (token && cfg.token && tokensMatch(token, cfg.token)) {
    if (fromQuery) {
      const cookie =
        `${TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000` +
        (isSecureRequest(req) ? "; Secure" : "");
      return { allow: true, setCookie: cookie };
    }
    return { allow: true };
  }
  return { allow: false, reason: token ? "invalid token" : "missing token" };
}

export interface AuthAuditEvent {
  kind: "auth_failure";
  path?: string;
  addr?: string;
  reason: string;
}

export interface ExpressLike {
  path?: string;
  headers: HeaderBag;
  query?: Record<string, unknown>;
  url?: string;
  protocol?: string;
  socket?: { remoteAddress?: string; encrypted?: boolean };
}

export interface ResponseLike {
  setHeader(name: string, value: string): void;
  status(code: number): ResponseLike;
  type(t: string): ResponseLike;
  send(body: string): void;
}

/**
 * Build the express auth middleware. `audit` is invoked (best-effort) on each
 * rejection so the caller can append a security_event to the EventLog.
 */
export function createAuthMiddleware(
  cfg: SecurityConfig,
  audit?: (e: AuthAuditEvent) => void,
) {
  return function authMiddleware(req: ExpressLike, res: ResponseLike, next: () => void): void {
    const outcome = evaluateAuth(req, cfg);
    if (outcome.allow) {
      if (outcome.setCookie) res.setHeader("Set-Cookie", outcome.setCookie);
      return next();
    }
    if (audit) {
      try {
        audit({
          kind: "auth_failure",
          path: req.path,
          addr: req.socket?.remoteAddress,
          reason: outcome.reason,
        });
      } catch {
        /* non-fatal */
      }
    }
    res.status(401).type("html").send(UNAUTHORIZED_HTML);
  };
}

/** WS upgrade guard for `WebSocketServer({ verifyClient })`. */
export function isWsUpgradeAuthorized(req: MinimalRequest, cfg: SecurityConfig): boolean {
  return evaluateAuth(req, cfg).allow;
}

const UNAUTHORIZED_HTML = `<!doctype html><html><head><meta charset="utf-8">
<title>ChillsPwn — auth required</title>
<style>body{background:#0a0e14;color:#b6f23a;font-family:ui-monospace,monospace;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{max-width:420px;padding:24px;border:1px solid #1d2530;border-radius:10px;background:#0d1219}
code{color:#8fd3ff}</style></head>
<body><div class="box"><h2>401 — authentication required</h2>
<p>This dashboard is exposed and requires a token.</p>
<p>Open it once as <code>/?token=YOUR_TOKEN</code> (sets a session cookie), or send
<code>X-Dashboard-Token</code> / <code>Authorization: Bearer</code>.</p></div></body></html>`;
