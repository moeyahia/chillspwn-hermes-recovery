import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NavigationProvider } from "../../app/router/navigation";
import { OPERATIONS_ENDPOINTS } from "../../data/api/operations";
import {
  parseAdministrativeApprovalReview,
  parseDecisionInboxPage,
} from "../../domain/schemas/operations";
import { DecisionInboxSections } from "../../features/decisions/DecisionsPage";

const base = {
  mission: { id: "mission-1", name: "Authorized mission", engagementId: "eng-1" },
  run: { id: "run-1", status: "failed", journey: "autonomous" },
  createdAt: "2026-07-15T12:00:00.000Z",
  resolvedAt: null,
  expiresAt: null,
};

function payload() {
  return {
    schemaVersion: "2.1",
    nextCursor: "next-page",
    items: [
      {
        ...base,
        id: "exception-1", kind: "autonomous_exception", status: "post_run",
        title: "Autonomous safe stop", summary: "No in-contract path remained",
        deepLink: "/missions/mission-1/runs/run-1",
        exception: {
          eventType: "run.autonomous_safe_stopped", sequence: 7, phase: "post_run",
          code: "outside_contract", category: "scope_conflict", traceId: "trace-1",
          details: { code: "outside_contract" },
        },
      },
      {
        ...base,
        id: "approval-1", kind: "administrative_approval", status: "pending",
        title: "Administrative approval", summary: "Review future policy",
        expiresAt: "2999-07-16T12:00:00.000Z",
        deepLink: "/missions/mission-1/runs/run-1",
        approval: {
          approvalType: "policy_change", requestedBy: "policy-service", policyRule: "future.policy",
          request: { change: "future-only" }, decidedBy: null,
          reviewAvailable: true, reviewUnavailableReason: null,
        },
      },
      {
        ...base,
        id: "contract-1", kind: "autonomous_contract", status: "confirmed",
        title: "Autonomous contract v1", summary: "Signed Autonomous authority",
        deepLink: "/missions/mission-1?tab=settings",
        contract: { version: 1, hash: "a".repeat(64), state: "confirmed", confirmedBy: "operator", confirmedAt: "2026-07-15T11:00:00.000Z" },
      },
      {
        ...base,
        id: "guided-1", kind: "guided_decision", status: "pending",
        run: { id: "run-guided-1", status: "waiting_guided_decision", journey: "guided" },
        title: "Guided exact-step decision", summary: "Inspect bounded target",
        expiresAt: "2999-07-16T12:00:00.000Z", deepLink: "/guided/mission-1",
        exactStep: {
          stepId: "step-1", actionFingerprint: "f".repeat(64),
          requestedParameters: { target: "lab.internal", kind: "manual" },
          rationale: "Inspect bounded target", riskClass: "low", reversibility: "Read only",
          decisionActor: null, decisionReason: null,
        },
      },
    ],
  };
}

describe("canonical Decisions inbox client", () => {
  test("parses every canonical record kind and rejects unsafe deep links", () => {
    const parsed = parseDecisionInboxPage(payload());
    expect(parsed.items.map((item) => item.kind)).toEqual([
      "autonomous_exception", "administrative_approval", "autonomous_contract", "guided_decision",
    ]);
    expect(parsed.nextCursor).toBe("next-page");
    expect(() => parseDecisionInboxPage({
      ...payload(),
      items: [{ ...payload().items[0], deepLink: "//attacker.invalid" }],
    })).toThrow("deep link");
    expect(OPERATIONS_ENDPOINTS.decisionInbox).toBe("/api/v2/decision-inbox");
  });

  test("requires an administrative response to prove no runtime authority changed", () => {
    const parsed = parseAdministrativeApprovalReview({
      schemaVersion: "2.1",
      approval: {
        id: "approval-1", missionId: "mission-1", runId: "run-1",
        approvalType: "policy_change", status: "approved", decidedBy: "reviewer",
        decidedAt: "2026-07-15T12:00:00.000Z", decisionReason: "Future policy only",
        runtimeStateChanged: false, autonomousActionUnblocked: false,
      },
    });
    expect(parsed.approval.runtimeStateChanged).toBeFalse();
    expect(() => parseAdministrativeApprovalReview({
      ...parsed,
      approval: { ...parsed.approval, autonomousActionUnblocked: true },
    })).toThrow("must not mutate runtime authority");
  });

  test("renders purposeful sections and distinguishes exceptions from approvals", () => {
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: { pathname: "/decisions", search: "" },
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        history: { pushState: () => undefined, replaceState: () => undefined },
        scrollTo: () => undefined,
      },
    });
    const records = parseDecisionInboxPage(payload()).items;
    const markup = renderToStaticMarkup(
      <NavigationProvider><DecisionInboxSections items={records} onChanged={() => undefined} /></NavigationProvider>,
    );
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    expect(markup).toContain("Autonomous safe stops and exceptions");
    expect(markup).toContain("This is an immutable exception record, not an approval request.");
    expect(markup).toContain("Administrative approvals");
    expect(markup).toContain("cannot authorize or resume an Autonomous action");
    expect(markup).toContain("Guided exact-step decisions");
    expect(markup).toContain("Autonomous mission contracts");
  });
});
