export interface GrokSubscriptionAssessment {
  readonly allowed: boolean;
  readonly reason: string;
}

export type GrokSubscriptionRpcErrorClassification =
  | {
      readonly outcome: "optional_extension_unavailable";
      readonly reason: "Grok subscription extension is unavailable; cached-token authentication remains authoritative";
    }
  | {
      readonly outcome: "fail_closed";
      readonly reason: "Grok subscription attestation failed";
    };

export const GROK_SUBSCRIPTION_ATTESTATION_METHOD = "x.ai/auth/check_subscription";

function record(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function deniedReason(value: unknown): string | null {
  const item = record(value);
  for (const key of ["userBlockedReason", "user_blocked_reason", "teamBlockedReason", "team_blocked_reason"]) {
    const reason = item[key];
    if (typeof reason === "string" && reason.trim()) return reason.trim();
  }
  for (const key of ["allowAccess", "allow_access", "hasGrokCodeAccess", "has_grok_code_access"]) {
    if (item[key] === false) return `${key} was denied`;
  }
  for (const key of ["status", "state", "outcome", "reason", "code"]) {
    const status = item[key];
    if (typeof status !== "string") continue;
    const normalized = status.trim().toLocaleLowerCase("en-US");
    if (/^(?:active|allowed|ok|available|unblocked|not[_ -]blocked)$/u.test(normalized)) continue;
    if (
      /(?:^|[^a-z])(?:revoked|expired|unauthenticated|unauthorized|forbidden|blocked|denied|paywall|limit[_ -]?reached|usage[_ -]?exhausted|credit[_ -]?limit|spending[_ -]?cap)(?:$|[^a-z])/u.test(normalized)
    ) return status;
  }
  for (const nested of [item.result, item.subscription, item.access, item._meta, item.meta]) {
    if (nested && typeof nested === "object") {
      const reason = deniedReason(nested);
      if (reason) return reason;
    }
  }
  return null;
}

/**
 * Classify a JSON-RPC error from the optional Grok subscription extension.
 *
 * Grok 0.2.99 no longer implements `x.ai/auth/check_subscription`, while its
 * standard ACP `authenticate(methodId=cached_token)` and `session/new` calls
 * remain the live OAuth proof. Only JSON-RPC Method not found for this exact
 * extension is compatible with that flow. Every other method/code combination
 * fails closed. The returned value deliberately retains no provider message,
 * data, account identifier, or authentication metadata.
 */
export function classifyGrokSubscriptionRpcError(
  method: unknown,
  error: unknown,
): GrokSubscriptionRpcErrorClassification {
  const rpcError = record(error);
  if (method === GROK_SUBSCRIPTION_ATTESTATION_METHOD && rpcError.code === -32601) {
    return {
      outcome: "optional_extension_unavailable",
      reason: "Grok subscription extension is unavailable; cached-token authentication remains authoritative",
    };
  }
  return {
    outcome: "fail_closed",
    reason: "Grok subscription attestation failed",
  };
}

/**
 * Interpret the secret-free response from Grok's live
 * `x.ai/auth/check_subscription` ACP extension. A successful RPC is the
 * positive live-auth signal; explicit account, subscription, or access gates
 * fail closed. The response itself is never persisted.
 */
export function assessGrokSubscriptionAttestation(value: unknown): GrokSubscriptionAssessment {
  const denial = deniedReason(value);
  return denial
    ? { allowed: false, reason: "Live Grok OAuth or subscription access was rejected" }
    : { allowed: true, reason: "Live Grok OAuth subscription access was accepted" };
}
