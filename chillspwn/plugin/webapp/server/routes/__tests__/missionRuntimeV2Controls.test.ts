import { afterEach, describe, expect, test } from "bun:test";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { CommandRuntimeError, type MissionRuntimeEngine } from "../../command-runtime";
import { createMissionRuntimeV2Router } from "../missionRuntimeV2Routes";

const servers: Server[] = [];
const fingerprint = "a".repeat(64);
const parameters = {
  actionType: "readiness_check",
  kind: "manual",
  target: "127.0.0.1",
  arguments: { path: "/api/v2/health", headers: ["Accept: application/json"] },
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function runtimeFixture() {
  let status = "waiting_guided_decision";
  let decisionStatus = "pending";
  const cancellations: Array<{ runId: string; actorId: string; reason: string }> = [];
  const approvals: Array<{ decisionId: string; actorId: string; reason?: string }> = [];
  const rejections: Array<{ decisionId: string; actorId: string; reason: string }> = [];
  const skips: Array<{ decisionId: string; actorId: string; reason: string }> = [];
  const events: Record<string, unknown>[] = [];
  const audits: Record<string, unknown>[] = [];
  const idempotent = new Map<string, unknown>();
  const run = () => ({
    id: "run-1",
    missionId: "mission-1",
    missionName: "Guided control test",
    objective: "Exercise one exact control",
    journey: "guided",
    status,
    statusReason: "Waiting for one exact decision",
    progress: 0,
    nextAction: "Review the represented action",
    currentPlanId: "plan-1",
    currentStepId: "step-1",
    currentOwnerId: "agent-1",
    lastHeartbeatAt: null,
    leaseExpiresAt: null,
    startedAt: null,
    endedAt: status === "cancelled" ? "2026-07-15T12:00:00.000Z" : null,
    createdAt: "2026-07-15T10:00:00.000Z",
    updatedAt: "2026-07-15T12:00:00.000Z",
    version: status === "cancelled" ? 2 : 1,
  });
  const decision = () => ({
    id: "decision-1",
    missionId: "mission-1",
    runId: "run-1",
    stepId: "step-1",
    status: decisionStatus,
    actionFingerprint: fingerprint,
    requestedParameters: parameters,
    rationale: "Inspect the exact local endpoint",
    riskClass: "low",
    reversibility: "Read-only",
    expiresAt: "2026-07-16T12:00:00.000Z",
    createdAt: "2026-07-15T10:00:00.000Z",
  });
  const repository = {
    events: { append: (event: Record<string, unknown>) => { events.push(event); return event; } },
    findIdempotent: (scope: string, key: string) => idempotent.get(`${scope}:${key}`),
    storeIdempotent: (scope: string, key: string, _request: unknown, response: unknown) => {
      idempotent.set(`${scope}:${key}`, response);
    },
    transaction: <T>(operation: () => T) => operation(),
    getDecision: decision,
    requireCurrentPendingDecision: () => {
      const currentDecision = decision();
      const currentRun = run();
      if (currentDecision.status !== "pending") {
        throw new CommandRuntimeError(409, "guided_decision_not_pending", "Only a pending Guided decision can use this control", { category: "conflict" });
      }
      if (
        currentRun.journey !== "guided" ||
        currentRun.status !== "waiting_guided_decision" ||
        currentRun.currentStepId !== currentDecision.stepId
      ) {
        throw new CommandRuntimeError(409, "guided_step_stale", "The represented Guided step is no longer current", { category: "conflict" });
      }
      return currentDecision;
    },
    getRunProjection: run,
    appendAudit: (audit: Record<string, unknown>) => { audits.push(audit); },
  };
  const runtime = {
    repository,
    approveGuidedDecision: async (decisionId: string, actorId: string, reason?: string) => {
      approvals.push({ decisionId, actorId, ...(reason ? { reason } : {}) });
      decisionStatus = "approved";
      return {
        id: "action-1",
        missionId: "mission-1",
        runId: "run-1",
        stepId: "step-1",
        fingerprint,
        status: "running",
      };
    },
    rejectGuidedDecision: async (decisionId: string, actorId: string, reason: string) => {
      rejections.push({ decisionId, actorId, reason });
      decisionStatus = "rejected";
    },
    skipGuidedDecision: async (decisionId: string, actorId: string, reason: string) => {
      skips.push({ decisionId, actorId, reason });
      decisionStatus = "cancelled";
      return {
        decisionId,
        status: "cancelled",
        skippedStepId: "step-1",
        nextDecisionId: "decision-2",
        runId: "run-1",
        runState: "waiting_guided_decision",
        nextAction: "Review the next represented step",
        duplicate: false,
      };
    },
    cancelRun: async (runId: string, actorId: string, reason: string) => {
      cancellations.push({ runId, actorId, reason });
      status = "cancelled";
      decisionStatus = "cancelled";
    },
  } as unknown as MissionRuntimeEngine;
  return {
    runtime,
    approvals,
    rejections,
    cancellations,
    skips,
    events,
    audits,
    setStatus: (value: string) => { status = value; },
  };
}

async function application(fixture = runtimeFixture()) {
  const app = express();
  app.use(express.json());
  app.use(createMissionRuntimeV2Router({ runtime: fixture.runtime, resolveActor: () => "operator-test" }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  return { ...fixture, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

function stopRequest(overrides: Record<string, unknown> = {}, key = "guided-stop-0001"): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({
      expectedFingerprint: fingerprint,
      expectedParameters: parameters,
      reason: "The operator has enough evidence for this mission",
      ...overrides,
    }),
  };
}

function decisionRequest(
  reason: string,
  key: string,
  overrides: Record<string, unknown> = {},
): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({
      expectedFingerprint: fingerprint,
      expectedParameters: parameters,
      reason,
      ...overrides,
    }),
  };
}

describe("exact-step Guided approve and reject controls", () => {
  test("requires current fingerprint and parameters and replays approval idempotently", async () => {
    const fixture = await application();
    const endpoint = `${fixture.url}/api/v2/guided-decisions/decision-1/approve`;
    const request = decisionRequest("Run only this exact represented action", "guided-approve-current");
    const first = await fetch(endpoint, request);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      schemaVersion: "2.1",
      decisionId: "decision-1",
      status: "approved",
      action: { id: "action-1", fingerprint },
    });
    expect(fixture.approvals).toEqual([{
      decisionId: "decision-1",
      actorId: "operator-test",
      reason: "Run only this exact represented action",
    }]);

    const replay = await fetch(endpoint, request);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ action: { id: "action-1" } });
    expect(fixture.approvals).toHaveLength(1);
  });

  test("applies a valid current rejection once and rejects stale run or parameter state", async () => {
    const valid = await application();
    const rejected = await fetch(
      `${valid.url}/api/v2/guided-decisions/decision-1/reject`,
      decisionRequest("Use a different bounded approach", "guided-reject-current"),
    );
    expect(rejected.status).toBe(200);
    expect(await rejected.json()).toMatchObject({ decisionId: "decision-1", status: "rejected" });
    expect(valid.rejections).toEqual([{
      decisionId: "decision-1",
      actorId: "operator-test",
      reason: "Use a different bounded approach",
    }]);

    const changedParameters = await application();
    const changed = await fetch(
      `${changedParameters.url}/api/v2/guided-decisions/decision-1/approve`,
      decisionRequest(
        "Do not authorize changed parameters",
        "guided-approve-params-stale",
        { expectedParameters: { ...parameters, target: "127.0.0.2" } },
      ),
    );
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ error: { code: "guided_parameters_changed" } });
    expect(changedParameters.approvals).toHaveLength(0);

    for (const operation of ["approve", "reject"] as const) {
      const staleFixture = runtimeFixture();
      staleFixture.setStatus("running");
      const stale = await application(staleFixture);
      const response = await fetch(
        `${stale.url}/api/v2/guided-decisions/decision-1/${operation}`,
        decisionRequest("Stale controls must not mutate the run", `guided-${operation}-run-stale`),
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "guided_step_stale" } });
      expect(stale.approvals).toHaveLength(0);
      expect(stale.rejections).toHaveLength(0);
    }
  });
});

describe("exact-step Guided mission stop control", () => {
  test("binds stop to the current fingerprint and parameters, cancels through the runtime, and audits it", async () => {
    const fixture = await application();
    const endpoint = `${fixture.url}/api/v2/guided-decisions/decision-1/stop`;
    const first = await fetch(endpoint, stopRequest());
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      schemaVersion: "2.1",
      decisionId: "decision-1",
      status: "cancelled",
      run: { id: "run-1", status: "cancelled" },
    });
    expect(fixture.cancellations).toEqual([{
      runId: "run-1",
      actorId: "operator-test",
      reason: "The operator has enough evidence for this mission",
    }]);
    expect(fixture.events).toEqual([expect.objectContaining({
      eventType: "guided.mission_stopped",
      payload: expect.objectContaining({
        decisionId: "decision-1",
        stepId: "step-1",
        actionFingerprint: fingerprint,
        parameterHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    })]);
    expect(fixture.audits).toEqual([expect.objectContaining({
      action: "guided.mission_stopped",
      resourceType: "guided_decision",
      resourceId: "decision-1",
      details: expect.objectContaining({ actionFingerprint: fingerprint }),
    })]);

    const replay = await fetch(endpoint, stopRequest());
    expect(replay.status).toBe(200);
    expect((await replay.json()).status).toBe("cancelled");
    expect(fixture.cancellations).toHaveLength(1);
    expect(fixture.audits).toHaveLength(1);
  });

  test("fails closed before cancellation when normalized parameters or current checkpoint changed", async () => {
    const changedParameters = await application();
    const parameterResponse = await fetch(
      `${changedParameters.url}/api/v2/guided-decisions/decision-1/stop`,
      stopRequest({ expectedParameters: { ...parameters, target: "127.0.0.2" } }, "guided-stop-params"),
    );
    expect(parameterResponse.status).toBe(409);
    expect(await parameterResponse.json()).toMatchObject({ error: { code: "guided_parameters_changed" } });
    expect(changedParameters.cancellations).toHaveLength(0);
    expect(changedParameters.audits).toHaveLength(0);

    const staleRun = runtimeFixture();
    staleRun.setStatus("running");
    const stale = await application(staleRun);
    const staleResponse = await fetch(
      `${stale.url}/api/v2/guided-decisions/decision-1/stop`,
      stopRequest({}, "guided-stop-stale"),
    );
    expect(staleResponse.status).toBe(409);
    expect(await staleResponse.json()).toMatchObject({ error: { code: "guided_step_stale" } });
    expect(stale.cancellations).toHaveLength(0);
  });

  test("rejects authentication material before it can enter immutable reason, event, or audit fields", async () => {
    const fixture = await application();
    const secretValue = "synthetic-control-secret-12345";
    const response = await fetch(
      `${fixture.url}/api/v2/guided-decisions/decision-1/stop`,
      stopRequest({ reason: `Authorization: Bearer ${secretValue}` }, "guided-stop-secret"),
    );
    expect(response.status).toBe(422);
    const body = await response.text();
    expect(body).toContain("sensitive_material_not_retained");
    expect(body).not.toContain(secretValue);
    expect(fixture.cancellations).toHaveLength(0);
    expect(fixture.events).toHaveLength(0);
    expect(fixture.audits).toHaveLength(0);
  });
});

describe("exact-step Guided skip route", () => {
  test("passes only the current fingerprint-and-parameter-bound decision to the canonical runtime skip", async () => {
    const fixture = await application();
    const response = await fetch(
      `${fixture.url}/api/v2/guided-decisions/decision-1/skip`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "guided-skip-0001" },
        body: JSON.stringify({
          expectedFingerprint: fingerprint,
          expectedParameters: parameters,
          reason: "This optional observation is not required for the mission objective",
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      schemaVersion: "2.1",
      decisionId: "decision-1",
      status: "skipped",
      receipt: {
        skippedStepId: "step-1",
        nextDecisionId: "decision-2",
        duplicate: false,
      },
    });
    expect(fixture.skips).toEqual([{
      decisionId: "decision-1",
      actorId: "operator-test",
      reason: "This optional observation is not required for the mission objective",
    }]);
    expect(fixture.cancellations).toHaveLength(0);
  });
});
