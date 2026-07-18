import { describe, expect, test } from "bun:test";
import {
  GROK_SUBSCRIPTION_ATTESTATION_METHOD,
  assessGrokSubscriptionAttestation,
  classifyGrokSubscriptionRpcError,
} from "../GrokReadinessAttestation";

describe("Grok subscription-extension compatibility", () => {
  test("accepts only Method not found for the exact optional extension", () => {
    const classification = classifyGrokSubscriptionRpcError(
      GROK_SUBSCRIPTION_ATTESTATION_METHOD,
      {
        code: -32601,
        message: "private provider diagnostic",
        data: { account: "private-account", token: "private-token" },
      },
    );

    expect(classification).toEqual({
      outcome: "optional_extension_unavailable",
      reason: "Grok subscription extension is unavailable; cached-token authentication remains authoritative",
    });
    expect(JSON.stringify(classification)).not.toContain("private");
    expect(classification).not.toHaveProperty("message");
    expect(classification).not.toHaveProperty("data");
  });

  test("fails closed for every other method or error code", () => {
    for (const [method, error] of [
      [GROK_SUBSCRIPTION_ATTESTATION_METHOD, { code: -32600 }],
      [GROK_SUBSCRIPTION_ATTESTATION_METHOD, { code: 401 }],
      [GROK_SUBSCRIPTION_ATTESTATION_METHOD, { code: "-32601" }],
      [GROK_SUBSCRIPTION_ATTESTATION_METHOD, { data: { code: -32601 } }],
      ["authenticate", { code: -32601 }],
      ["_x.ai/hooks/list", { code: -32601 }],
      [GROK_SUBSCRIPTION_ATTESTATION_METHOD, null],
    ] as const) {
      expect(classifyGrokSubscriptionRpcError(method, error)).toEqual({
        outcome: "fail_closed",
        reason: "Grok subscription attestation failed",
      });
    }
  });
});

describe("Grok live subscription attestation", () => {
  test("accepts a successful live subscription response without retaining account data", () => {
    expect(assessGrokSubscriptionAttestation({
      subscription: { status: "active", tier: "private-value" },
      userId: "private-value",
    })).toEqual({
      allowed: true,
      reason: "Live Grok OAuth subscription access was accepted",
    });
    expect(assessGrokSubscriptionAttestation({ status: "unblocked" }).allowed).toBe(true);
    expect(assessGrokSubscriptionAttestation({ status: "not_blocked" }).allowed).toBe(true);
  });

  test("fails closed for revoked, blocked, or explicitly inaccessible OAuth usage", () => {
    for (const response of [
      { status: "token_revoked" },
      { user_blocked_reason: "account disabled" },
      { subscription: { allowAccess: false } },
      { _meta: { has_grok_code_access: false } },
    ]) {
      expect(assessGrokSubscriptionAttestation(response)).toEqual({
        allowed: false,
        reason: "Live Grok OAuth or subscription access was rejected",
      });
    }
  });
});
