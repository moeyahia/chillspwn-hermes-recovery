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
    const text = String(value);
    output[name] = text.length > 8 ? `${text.slice(0, 4)}…${text.slice(-4)}` : "***";
  }
  return output;
}
