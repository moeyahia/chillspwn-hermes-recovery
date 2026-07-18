import { afterEach, describe, expect, test } from "bun:test";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { CommandRuntimeError, type MissionRuntimeEngine } from "../../command-runtime";
import type { RuntimeIdempotencyFailure } from "../../command-runtime/RuntimeRepository";
import { ControlPlaneLeaseError } from "../../control-plane";
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
  let statusReason = "Waiting for one exact decision";
  let runVersion = 1;
  let decisionStatus = "pending";
  let ownsControlPlane = true;
  let failNextReceiptCompletion = false;
  let nextApprovalFailure: CommandRuntimeError | undefined;
  const cancellations: Array<{ runId: string; actorId: string; reason: string }> = [];
  const approvals: Array<{ decisionId: string; actorId: string; reason?: string }> = [];
  const rejections: Array<{ decisionId: string; actorId: string; reason: string }> = [];
  const skips: Array<{ decisionId: string; actorId: string; reason: string }> = [];
  const events: Record<string, unknown>[] = [];
  const audits: Record<string, unknown>[] = [];
  const idempotent = new Map<string, {
    actorId: string;
    request: string;
    ownerToken: string;
    response?: unknown;
    failure?: RuntimeIdempotencyFailure;
    abandoned?: boolean;
  }>();
  const run = () => ({
    id: "run-1",
    missionId: "mission-1",
    missionName: "Guided control test",
    objective: "Exercise one exact control",
    journey: "guided",
    controlPlane: "command_os_v2",
    status,
    statusReason,
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
    version: runVersion,
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
    reserveIdempotent: (scope: string, key: string, request: unknown, actorId: string) => {
      const mapKey = `${scope}:${key}`;
      const requestJson = JSON.stringify(request);
      const existing = idempotent.get(mapKey);
      if (existing) {
        if (existing.actorId !== actorId || existing.request !== requestJson) {
          throw new CommandRuntimeError(409, "idempotency_key_conflict", "Idempotency key conflict");
        }
        if (existing.response !== undefined) return { status: "replay", response: existing.response };
        if (existing.failure !== undefined) return { status: "failure", error: existing.failure };
        if (existing.abandoned) {
          existing.ownerToken = `owner-recovered-${idempotent.size + 1}`;
          existing.abandoned = false;
          return { status: "reserved", ownerToken: existing.ownerToken, recoveryRequired: true };
        }
        throw new CommandRuntimeError(409, "idempotency_request_in_progress", "Idempotency request in progress");
      }
      const ownerToken = `owner-${idempotent.size + 1}`;
      idempotent.set(mapKey, { actorId, request: requestJson, ownerToken });
      return { status: "reserved", ownerToken };
    },
    completeIdempotent: (
      scope: string,
      key: string,
      request: unknown,
      ownerToken: string,
      response: unknown,
      actorId: string,
    ) => {
      const entry = idempotent.get(`${scope}:${key}`);
      if (
        !entry || entry.ownerToken !== ownerToken || entry.actorId !== actorId
        || entry.request !== JSON.stringify(request)
      ) throw new CommandRuntimeError(409, "idempotency_reservation_changed", "Reservation changed");
      if (failNextReceiptCompletion) {
        failNextReceiptCompletion = false;
        entry.abandoned = true;
        throw new CommandRuntimeError(500, "idempotency_response_write_interrupted", "Response receipt write interrupted");
      }
      entry.response = response;
    },
    heartbeatIdempotent: () => undefined,
    failIdempotent: (
      scope: string,
      key: string,
      request: unknown,
      ownerToken: string,
      failure: RuntimeIdempotencyFailure,
      actorId: string,
    ) => {
      const entry = idempotent.get(`${scope}:${key}`);
      if (
        !entry || entry.ownerToken !== ownerToken || entry.actorId !== actorId
        || entry.request !== JSON.stringify(request)
      ) throw new CommandRuntimeError(409, "idempotency_reservation_changed", "Reservation changed");
      entry.failure = failure;
    },
    reconcileIdempotentReservation: (scope: string) => {
      if (scope === "decision.approve" && decisionStatus === "approved") {
        return { status: "committed", auditDetails: {} };
      }
      return { status: "not_committed" };
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
    database: {
      prepare: () => ({
        get: () => ({ summary: "The local readiness endpoint returned a valid response" }),
      }),
    },
    appendAudit: (audit: Record<string, unknown>) => { audits.push(audit); },
    getGuidedDecisionAction: () => decisionStatus === "approved"
      ? {
          id: "action-1",
          missionId: "mission-1",
          runId: "run-1",
          stepId: "step-1",
          fingerprint,
          status: "running",
        }
      : null,
  };
  const runtime = {
    repository,
    assertV2ControlPlaneOwnership: () => {
      if (!ownsControlPlane) {
        throw new ControlPlaneLeaseError("control_plane_mismatch", "Run belongs to legacy");
      }
    },
    coordinator: { getLatestCheckpoint: () => null },
    replayContinuations: async () => 0,
    approveGuidedDecision: async (decisionId: string, actorId: string, reason?: string) => {
      if (nextApprovalFailure) {
        const failure = nextApprovalFailure;
        nextApprovalFailure = undefined;
        throw failure;
      }
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
    submitManualGuidedResult: async (
      decisionId: string,
      _actorId: string,
      _summary: string,
      evidenceId: string,
    ) => {
      decisionStatus = "manual";
      return {
        decisionId,
        actionId: "manual-action-1",
        evidenceId,
        runId: "run-1",
        runState: status,
        nextAction: "Review the interpreted result",
        duplicate: false,
      };
    },
    pauseRun: () => {
      status = "blocked";
      statusReason = "Paused by operator";
      runVersion += 1;
    },
    cancelRun: async (
      runId: string,
      actorId: string,
      reason: string,
      context?: {
        kind: "guided_stop";
        decisionId: string;
        missionId: string;
        stepId: string;
        actionFingerprint: string;
        parameterHash: string;
      },
    ) => {
      cancellations.push({ runId, actorId, reason });
      status = "cancelled";
      statusReason = `Cancelled: ${reason}`;
      runVersion += 1;
      decisionStatus = "cancelled";
      if (context) {
        events.push({
          missionId: context.missionId,
          runId,
          journey: "guided",
          eventType: "guided.mission_stopped",
          actorType: "operator",
          actorId,
          summary: "Operator stopped the mission from the exact represented Guided step",
          payload: {
            decisionId: context.decisionId,
            stepId: context.stepId,
            actionFingerprint: context.actionFingerprint,
            parameterHash: context.parameterHash,
            reason,
          },
          sensitivity: "private",
        });
        audits.push({
          missionId: context.missionId,
          runId,
          actorId,
          action: "guided.mission_stopped",
          resourceType: "guided_decision",
          resourceId: context.decisionId,
          reason,
          details: {
            stepId: context.stepId,
            actionFingerprint: context.actionFingerprint,
            parameterHash: context.parameterHash,
          },
        });
      }
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
    setStatus: (value: string) => { status = value; runVersion += 1; },
    advanceRun: () => { runVersion += 1; },
    transferOwnership: () => { ownsControlPlane = false; },
    crashNextReceiptCompletion: () => { failNextReceiptCompletion = true; },
    failNextApprovalWith: (failure: CommandRuntimeError) => { nextApprovalFailure = failure; },
  };
}

async function application(
  fixture = runtimeFixture(),
  resolveActor: (request: express.Request) => string = () => "operator-test",
) {
  const app = express();
  app.use(express.json());
  app.use(createMissionRuntimeV2Router({ runtime: fixture.runtime, resolveActor }));
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
      schemaVersion: "2.4",
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

  test("binds idempotency to the operator and runs concurrent duplicates once", async () => {
    const fixture = runtimeFixture();
    const app = await application(fixture, (request) => request.header("X-Test-Actor") ?? "operator-test");
    const endpoint = `${app.url}/api/v2/guided-decisions/decision-1/approve`;
    const body = JSON.stringify({
      expectedFingerprint: fingerprint,
      expectedParameters: parameters,
      reason: "Run this exact represented action",
    });
    const requestFor = (actorId: string): RequestInit => ({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "guided-approve-concurrent",
        "X-Test-Actor": actorId,
      },
      body,
    });
    const [first, duplicate] = await Promise.all([
      fetch(endpoint, requestFor("operator-a")),
      fetch(endpoint, requestFor("operator-a")),
    ]);
    expect([first.status, duplicate.status]).toEqual([200, 200]);
    expect(app.approvals).toHaveLength(1);
    expect(app.approvals[0]).toMatchObject({ actorId: "operator-a" });

    const otherActor = await fetch(endpoint, requestFor("operator-b"));
    expect(otherActor.status).toBe(409);
    expect(await otherActor.json()).toMatchObject({ error: { code: "idempotency_key_conflict" } });
    expect(app.approvals).toHaveLength(1);
  });

  test("reconstructs an approved response after receipt completion is interrupted without approving twice", async () => {
    const fixture = runtimeFixture();
    fixture.crashNextReceiptCompletion();
    const app = await application(fixture);
    const endpoint = `${app.url}/api/v2/guided-decisions/decision-1/approve`;
    const request = decisionRequest(
      "Run this exact represented action once",
      "guided-approve-post-commit-crash",
    );

    const interrupted = await fetch(endpoint, request);
    expect(interrupted.status).toBe(500);
    expect(await interrupted.json()).toMatchObject({
      error: { code: "idempotency_response_write_interrupted" },
    });
    expect(app.approvals).toHaveLength(1);

    const recovered = await fetch(endpoint, request);
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({
      schemaVersion: "2.4",
      decisionId: "decision-1",
      status: "approved",
      action: { id: "action-1", fingerprint },
    });
    expect(app.approvals).toHaveLength(1);

    const replay = await fetch(endpoint, request);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ status: "approved", action: { id: "action-1" } });
    expect(app.approvals).toHaveLength(1);
  });

  test("rechecks control-plane ownership before reconciling an abandoned committed command", async () => {
    const fixture = runtimeFixture();
    fixture.crashNextReceiptCompletion();
    const app = await application(fixture);
    const endpoint = `${app.url}/api/v2/guided-decisions/decision-1/approve`;
    const request = decisionRequest(
      "Run this exact represented action once",
      "guided-approve-recovery-owner-fence",
    );

    expect((await fetch(endpoint, request)).status).toBe(500);
    expect(app.approvals).toHaveLength(1);
    app.transferOwnership();

    const rejectedRecovery = await fetch(endpoint, request);
    expect(rejectedRecovery.status).toBe(409);
    expect(await rejectedRecovery.json()).toMatchObject({
      error: { code: "control_plane_control_plane_mismatch" },
    });
    expect(app.approvals).toHaveLength(1);
  });

  test("terminalizes a sanitized handler failure and replays it without invoking the handler again", async () => {
    const fixture = runtimeFixture();
    const secretValue = "synthetic-handler-secret-67890";
    fixture.failNextApprovalWith(new CommandRuntimeError(
      502,
      "provider_rejected_action",
      `Provider rejected Authorization: Bearer ${secretValue}`,
      {
        humanMessage: `The provider rejected token=${secretValue}`,
        category: "provider_unavailable",
        retryable: true,
        details: { authorization: `Bearer ${secretValue}` },
        remediation: `Replace api_key=${secretValue} before retrying.`,
      },
    ));
    const app = await application(fixture);
    const endpoint = `${app.url}/api/v2/guided-decisions/decision-1/approve`;
    const request = decisionRequest(
      "Run this exact represented action",
      "guided-approve-sanitized-handler-failure",
    );

    const first = await fetch(endpoint, request);
    expect(first.status).toBe(502);
    const firstBody = await first.text();
    expect(firstBody).toContain("provider_rejected_action");
    expect(firstBody).not.toContain(secretValue);

    const replay = await fetch(endpoint, request);
    expect(replay.status).toBe(502);
    const replayBody = await replay.text();
    expect(replayBody).toContain("provider_rejected_action");
    expect(replayBody).not.toContain(secretValue);
    expect(app.approvals).toHaveLength(0);
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
      schemaVersion: "2.4",
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
    const endpoint = `${fixture.url}/api/v2/guided-decisions/decision-1/stop`;
    const request = stopRequest(
      { reason: `Authorization: Bearer ${secretValue}` },
      "guided-stop-secret",
    );
    const response = await fetch(endpoint, request);
    expect(response.status).toBe(422);
    const body = await response.text();
    expect(body).toContain("sensitive_material_not_retained");
    expect(body).not.toContain(secretValue);

    const replay = await fetch(endpoint, request);
    expect(replay.status).toBe(422);
    const replayBody = await replay.text();
    expect(replayBody).toContain("sensitive_material_not_retained");
    expect(replayBody).not.toContain(secretValue);
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
      schemaVersion: "2.4",
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

describe("cached mutation replay ownership and current-state guards", () => {
  const decisionCases = () => [
    {
      command: "approve",
      request: decisionRequest("Run this exact represented action", "replay-owner-approve"),
    },
    {
      command: "reject",
      request: decisionRequest("Choose another bounded approach", "replay-owner-reject"),
    },
    {
      command: "manual-result",
      request: decisionRequest("Use this interpreted manual result", "replay-owner-manual", {
        evidenceId: "evidence-1",
      }),
    },
    {
      command: "skip",
      request: decisionRequest("This optional observation is unnecessary", "replay-owner-skip"),
    },
    {
      command: "stop",
      request: stopRequest({}, "replay-owner-stop"),
    },
  ] as const;

  test("never replays any Guided command after control-plane ownership transfers", async () => {
    for (const item of decisionCases()) {
      const fixture = await application();
      const endpoint = `${fixture.url}/api/v2/guided-decisions/decision-1/${item.command}`;
      const first = await fetch(endpoint, item.request);
      expect(first.status).toBe(200);
      fixture.transferOwnership();

      const replay = await fetch(endpoint, item.request);
      expect(replay.status).toBe(409);
      expect(await replay.json()).toMatchObject({
        error: { code: "control_plane_control_plane_mismatch" },
      });
    }
  });

  test("never replays any Guided command after the accepted run boundary advances", async () => {
    const expectedCodes = {
      approve: "decision_approve_idempotent_replay_stale",
      reject: "decision_reject_idempotent_replay_stale",
      "manual-result": "decision_manual_idempotent_replay_stale",
      skip: "decision_skip_idempotent_replay_stale",
      stop: "decision_stop_idempotent_replay_stale",
    } as const;
    for (const item of decisionCases()) {
      const fixture = await application();
      const endpoint = `${fixture.url}/api/v2/guided-decisions/decision-1/${item.command}`;
      const first = await fetch(endpoint, item.request);
      expect(first.status).toBe(200);
      fixture.advanceRun();

      const replay = await fetch(endpoint, item.request);
      expect(replay.status).toBe(409);
      expect(await replay.json()).toMatchObject({
        error: { code: expectedCodes[item.command] },
      });
    }
  });

  test("fences cached pause and cancel responses by ownership and exact run version", async () => {
    for (const command of ["pause", "cancel"] as const) {
      const ownershipFixture = await application();
      const endpoint = `${ownershipFixture.url}/api/v2/runs/run-1/${command}`;
      const request: RequestInit = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `run-${command}-owner-replay`,
        },
        body: JSON.stringify({ reason: `Operator requested ${command}` }),
      };
      expect((await fetch(endpoint, request)).status).toBe(200);
      ownershipFixture.transferOwnership();
      const ownershipReplay = await fetch(endpoint, request);
      expect(ownershipReplay.status).toBe(409);
      expect(await ownershipReplay.json()).toMatchObject({
        error: { code: "control_plane_control_plane_mismatch" },
      });

      const staleFixture = await application();
      const staleEndpoint = `${staleFixture.url}/api/v2/runs/run-1/${command}`;
      const staleRequest: RequestInit = {
        ...request,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `run-${command}-state-replay`,
        },
      };
      expect((await fetch(staleEndpoint, staleRequest)).status).toBe(200);
      staleFixture.advanceRun();
      const staleReplay = await fetch(staleEndpoint, staleRequest);
      expect(staleReplay.status).toBe(409);
      expect(await staleReplay.json()).toMatchObject({
        error: { code: `run_${command}_idempotent_replay_stale` },
      });
    }
  });
});
