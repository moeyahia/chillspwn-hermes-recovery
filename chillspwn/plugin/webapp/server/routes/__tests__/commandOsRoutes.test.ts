import { afterEach, describe, expect, test } from "bun:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { createDatabaseConnection, migrateDatabase } from "../../db";
import type { AutonomousMissionRequest, GuidedMissionRequest, ReadinessCheckProvider } from "../../missions";
import { createCommandOsRouter } from "../commandOsRoutes";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

function provider(status: "pass" | "fail"): ReadinessCheckProvider {
  return {
    id: "enforcing-runtime",
    label: "Enforcing runtime",
    journeys: ["autonomous", "guided"],
    evaluate: () => ({
      id: "enforcing-runtime",
      label: "Enforcing runtime",
      status,
      journeys: ["autonomous", "guided"],
      impact: status === "pass" ? "Execution boundary is available." : "Execution boundary is unavailable.",
      remediation: status === "fail" ? "Restore the enforcing runtime." : undefined,
    }),
  };
}

async function application(status: "pass" | "fail" = "pass") {
  const database = createDatabaseConnection({ filename: ":memory:" });
  migrateDatabase(database);
  const now = new Date().toISOString();
  const validUntil = new Date(Date.now() + 5 * 60_000).toISOString();
  database.prepare(`
    INSERT INTO agents (
      id, role, display_name, status, provider_policy_json, tool_policy_json,
      configuration_json, version, last_heartbeat_at, created_at, updated_at
    ) VALUES ('agent-recon', 'reconnaissance', 'Recon specialist', 'available',
      '{"defaultProvider":"xai-grok-oauth"}',
      '{"allowedTools":["nmap"],"deniedTools":[],"approvalRequiredTools":[]}',
      '{}', '2.1', ?, ?, ?)
  `).run(now, now, now);
  database.prepare(`
    INSERT INTO agent_capabilities (agent_id, capability, source, enabled, metadata_json)
    VALUES ('agent-recon', 'nmap', 'live-route-attestation', 1, ?)
  `).run(JSON.stringify({ attestedAt: now, validUntil, providerIds: ["xai-grok-oauth"] }));
  database.prepare(`
    INSERT INTO mcp_servers (
      id, name, transport, endpoint_redacted, status, capabilities_json,
      policy_json, last_checked_at, created_at, updated_at
    ) VALUES ('mcp:nmap', 'nmap', 'stdio', 'local stdio', 'healthy', '["nmap"]',
      '{"enabled":true,"assignedAgents":["agent-recon"],"startPermitted":true,"riskClass":"medium"}',
      ?, ?, ?)
  `).run(now, now, now);
  database.prepare(`
    INSERT INTO health_snapshots (
      id, component_type, component_id, status, metrics_json, message, captured_at
    ) VALUES ('health-provider', 'provider', 'xai-grok-oauth', 'healthy',
      ?,
      'OAuth and Autonomous boundary verified', ?)
  `).run(JSON.stringify({
    authenticated: true,
    callable: true,
    attestedAt: now,
    expiresAt: validUntil,
    enforcesAutonomousBoundary: true,
    reportsExactTokenUsage: true,
    reportsExactCostUsage: true,
  }), now);
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.use(
    createCommandOsRouter({
      database,
      readinessProviders: [provider(status)],
      resolveActor: () => "operator-route-test",
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  return { database, url: `http://127.0.0.1:${port}` };
}

const autonomous: AutonomousMissionRequest = {
  journey: "autonomous",
  launch: true,
  title: "Route readiness test",
  objective: "Validate the authorized lab boundary",
  successCriteria: ["Evidence is retained"],
  authorization: {
    allowedTargets: ["lab.internal"],
    prohibitedTargets: [],
    authorizationConfirmed: true,
  },
  contract: {
    allowedActionClasses: ["reconnaissance"],
    prohibitedActionClasses: [],
    destructivePolicy: "prohibited",
    evidenceRequirements: [],
    timeBudgetMinutes: 30,
    retryBudget: 2,
    replanBudget: 2,
    concurrencyLimit: 2,
    evidenceStorageBudgetBytes: 64 * 1024 * 1024,
    artifactStorageBudgetBytes: 256 * 1024 * 1024,
    notificationPolicy: "in_app_only",
    reportingFormat: "command_os_json",
    dataHandlingPolicy: "local_private",
    retentionPolicy: "operator_managed",
    providerPolicy: "automatic_enforcing_only",
    toolPolicy: "contract_allowlist",
    specialistAgentIds: ["agent-recon"],
    memoryScopes: ["verified_lessons"],
    contextNodeIds: [],
    safeStopConditions: ["Scope conflict"],
    deliverables: ["Report"],
  },
};

const guided: GuidedMissionRequest = {
  journey: "guided",
  launch: true,
  authorizationConfirmed: true,
  title: "Guided route test",
  objective: "Explain one authorized step at a time",
  target: "lab.internal",
  explanationDepth: "balanced",
  executionPreference: "manual",
  evidenceExpectations: [],
};

describe("Command OS V2 routes", () => {
  test("rejects an open-ended destructive-action policy at the API boundary", async () => {
    const { database, url } = await application("pass");
    try {
      const response = await fetch(`${url}/api/v2/missions/autonomous/preflight`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Request-ID": "invalid-destructive-policy" },
        body: JSON.stringify({
          ...autonomous,
          contract: { ...autonomous.contract, destructivePolicy: "ask_operator" },
        }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: {
          code: "invalid_mission_request",
          traceId: "invalid-destructive-policy",
          details: {
            issues: ["contract.destructivePolicy must be one of: prohibited, contract_only"],
          },
        },
      });
      expect(database.prepare("SELECT COUNT(*) AS count FROM missions").get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  test("issues a server contract digest and rejects a stale reviewed digest", async () => {
    const { database, url } = await application("pass");
    try {
      const preflight = await fetch(`${url}/api/v2/missions/autonomous/preflight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(autonomous),
      });
      expect(preflight.status).toBe(200);
      const reviewed = (await preflight.json()) as {
        contract: { version: 1; hash: string };
        readiness: { status: string };
        policySummary: { provider: string; tools: string };
      };
      expect(reviewed.readiness.status).toBe("ready");
      expect(reviewed.contract.hash).toMatch(/^[a-f0-9]{64}$/u);
      expect(reviewed.policySummary.provider).toContain("1 inspected authenticated enforcing path");
      expect(reviewed.policySummary.tools).toContain("1 signed specialist");

      const stale = await fetch(`${url}/api/v2/missions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "stale-contract-review-0001",
        },
        body: JSON.stringify({
          ...autonomous,
          objective: `${autonomous.objective} after review changed`,
          contractReview: reviewed.contract,
        }),
      });
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({
        error: {
          code: "autonomous_readiness_blocked",
          details: { checks: [{ id: "contract_review_integrity", status: "fail" }] },
        },
      });
      expect(database.prepare("SELECT COUNT(*) AS count FROM missions").get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  test("returns a structured 409 and persists nothing when Autonomous readiness fails", async () => {
    const { database, url } = await application("fail");
    try {
      const response = await fetch(`${url}/api/v2/missions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "blocked-route-request-001",
          "X-Request-ID": "route-trace-1",
        },
        body: JSON.stringify(autonomous),
      });
      expect(response.status).toBe(409);
      expect(response.headers.get("x-request-id")).toBe("route-trace-1");
      const body = (await response.json()) as { error: Record<string, unknown> };
      expect(body.error).toMatchObject({
        code: "autonomous_readiness_blocked",
        category: "dependency_missing",
        retryable: false,
        traceId: "route-trace-1",
      });
      expect(body.error.details).toMatchObject({ status: "blocked" });
      expect(
        database.prepare("SELECT COUNT(*) AS count FROM missions").get(),
      ).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  test("requires idempotency, creates Guided state, and exposes overview plus cursor pagination", async () => {
    const { database, url } = await application("pass");
    try {
      const missingKey = await fetch(`${url}/api/v2/missions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(guided),
      });
      expect(missingKey.status).toBe(400);
      expect((await missingKey.json()) as object).toMatchObject({
        error: { code: "invalid_mission_request" },
      });

      const first = await fetch(`${url}/api/v2/missions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "guided-route-request-0001",
        },
        body: JSON.stringify(guided),
      });
      expect(first.status).toBe(201);
      const created = (await first.json()) as {
        mission: { id: string; journey: string };
        run: { id: string; status: string; journey: string };
        nextUrl: string;
      };
      expect(created).toMatchObject({
        mission: { journey: "guided" },
        run: { status: "planning", journey: "guided" },
      });
      expect(created.nextUrl).toBe(`/guided/${created.mission.id}`);
      expect(first.headers.get("location")).toBe(created.nextUrl);

      const replay = await fetch(`${url}/api/v2/missions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "guided-route-request-0001",
        },
        body: JSON.stringify(guided),
      });
      expect(await replay.json()).toEqual(created);

      const overview = await fetch(`${url}/api/v2/overview`);
      expect(overview.status).toBe(200);
      expect(await overview.json()).toMatchObject({
        schemaVersion: "2.1",
        readiness: { status: "ready", score: 100 },
        summary: { activeMissions: 1 },
        missions: [{ id: created.mission.id, journey: "guided", status: "planning" }],
      });

      const page = await fetch(`${url}/api/v2/missions?limit=1&journey=guided`);
      expect(await page.json()).toMatchObject({
        schemaVersion: "2.1",
        items: [{ id: created.mission.id, journey: "guided" }],
        nextCursor: null,
      });
    } finally {
      database.close();
    }
  });

  test("requires a safely stopped source and idempotently branches under the unchanged signed contract", async () => {
    const { database, url } = await application("pass");
    try {
      const createdResponse = await fetch(`${url}/api/v2/missions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "branch-source-create-0001" },
        body: JSON.stringify(autonomous),
      });
      const created = await createdResponse.json() as {
        mission: { id: string };
        run: { id: string };
      };
      const activeContext = await fetch(
        `${url}/api/v2/missions/${created.mission.id}/autonomous-branches/context?sourceRunId=${created.run.id}`,
      );
      expect(await activeContext.json()).toMatchObject({
        sourceRun: { id: created.run.id, status: "planning", safeToBranch: false },
        contract: { version: 1, state: "confirmed" },
      });
      const activeAttempt = await fetch(
        `${url}/api/v2/missions/${created.mission.id}/autonomous-branches`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": "active-branch-denied-0001" },
          body: JSON.stringify({
            sourceRunId: created.run.id,
            sourceRunVersion: 1,
            mode: "unchanged_contract",
            reason: "Start a clean bounded attempt",
            review: { version: 1, hash: "0".repeat(64) },
          }),
        },
      );
      expect(activeAttempt.status).toBe(409);
      expect(await activeAttempt.json()).toMatchObject({ error: { code: "source_run_must_stop" } });

      const now = new Date().toISOString();
      database.prepare(`
        UPDATE runs SET status = 'cancelled', status_reason = 'Cancelled through runtime control',
          ended_at = ?, updated_at = ?, version = version + 1 WHERE id = ?
      `).run(now, now, created.run.id);
      const contextResponse = await fetch(
        `${url}/api/v2/missions/${created.mission.id}/autonomous-branches/context?sourceRunId=${created.run.id}`,
      );
      const context = await contextResponse.json() as {
        sourceRun: { version: number; safeToBranch: boolean };
        contract: { version: number; hash: string };
      };
      expect(context.sourceRun).toMatchObject({ version: 2, safeToBranch: true });
      const preflight = await fetch(
        `${url}/api/v2/missions/${created.mission.id}/autonomous-branches/preflight`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": "unchanged-branch-preflight-0001" },
          body: JSON.stringify({
            sourceRunId: created.run.id,
            sourceRunVersion: context.sourceRun.version,
            mode: "unchanged_contract",
            reason: "Repeat the exact authorized contract",
          }),
        },
      );
      expect(preflight.status).toBe(200);
      const reviewed = await preflight.json() as {
        contract: { id: string; version: number; hash: string; state: string };
        preflight: { readiness: { status: string } };
      };
      expect(reviewed).toMatchObject({
        contract: { version: 1, state: "confirmed" },
        preflight: { readiness: { status: "ready" } },
      });
      const request = {
        sourceRunId: created.run.id,
        sourceRunVersion: context.sourceRun.version,
        mode: "unchanged_contract",
        reason: "Repeat the exact authorized contract",
        review: { version: reviewed.contract.version, hash: reviewed.contract.hash },
      };
      const branch = await fetch(
        `${url}/api/v2/missions/${created.mission.id}/autonomous-branches`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": "unchanged-branch-create-0001" },
          body: JSON.stringify(request),
        },
      );
      expect(branch.status).toBe(201);
      const result = await branch.json() as { run: { id: string; status: string; contractId: string } };
      expect(result).toMatchObject({
        sourceRunId: created.run.id,
        branchMode: "unchanged_contract",
        run: { status: "planning", contractId: reviewed.contract.id },
        contract: { version: 1, state: "confirmed", hash: reviewed.contract.hash },
      });
      expect(database.prepare("SELECT source_run_id, run_id, branch_mode FROM run_branches").get()).toEqual({
        source_run_id: created.run.id,
        run_id: result.run.id,
        branch_mode: "unchanged_contract",
      });
      const replay = await fetch(
        `${url}/api/v2/missions/${created.mission.id}/autonomous-branches`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": "unchanged-branch-create-0001" },
          body: JSON.stringify(request),
        },
      );
      expect(await replay.json()).toEqual(result);
      expect(database.prepare("SELECT COUNT(*) AS count FROM runs WHERE mission_id = ?").get(created.mission.id)).toEqual({ count: 2 });
    } finally {
      database.close();
    }
  });

  test("persists a readiness-checked draft then deliberately confirms a versioned amendment into a new run", async () => {
    const { database, url } = await application("pass");
    try {
      const created = await (await fetch(`${url}/api/v2/missions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "amend-source-create-0001" },
        body: JSON.stringify(autonomous),
      })).json() as { mission: { id: string }; run: { id: string } };
      const pausedAt = new Date().toISOString();
      database.prepare(`
        UPDATE runs SET status = 'blocked', status_reason = 'Paused by operator: amend the signed scope',
          lease_owner = NULL, lease_acquired_at = NULL, lease_expires_at = NULL,
          updated_at = ?, version = version + 1 WHERE id = ?
      `).run(pausedAt, created.run.id);
      database.prepare("UPDATE missions SET status = 'paused', updated_at = ? WHERE id = ?")
        .run(pausedAt, created.mission.id);
      database.prepare(`
        INSERT INTO audit_records (
          id, mission_id, run_id, journey, actor_type, actor_id, action,
          resource_type, resource_id, reason, details_json,
          previous_hash, record_hash, occurred_at
        ) VALUES ('audit-test-pause', ?, ?, 'autonomous', 'operator', 'operator-route-test',
          'run.paused', 'run', ?, 'amend the signed scope', '{}', NULL, ?, ?)
      `).run(created.mission.id, created.run.id, created.run.id, "a".repeat(64), pausedAt);
      const context = await (await fetch(
        `${url}/api/v2/missions/${created.mission.id}/autonomous-branches/context?sourceRunId=${created.run.id}`,
      )).json() as {
        sourceRun: { version: number; safeToBranch: boolean };
        request: AutonomousMissionRequest;
      };
      expect(context.sourceRun).toMatchObject({ version: 2, safeToBranch: true });
      const amendment: AutonomousMissionRequest = {
        ...context.request,
        objective: "Validate the amended authorized lab boundary",
        successCriteria: ["Amended-scope evidence is retained"],
        authorization: {
          ...context.request.authorization,
          allowedTargets: ["amended.lab.internal"],
          prohibitedTargets: ["production.internal"],
        },
      };
      const preflightBody = {
        sourceRunId: created.run.id,
        sourceRunVersion: context.sourceRun.version,
        mode: "contract_amendment",
        reason: "Replace the old lab boundary with the reviewed target",
        request: amendment,
      };
      const preflight = await fetch(
        `${url}/api/v2/missions/${created.mission.id}/autonomous-branches/preflight`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": "amend-draft-0001" },
          body: JSON.stringify(preflightBody),
        },
      );
      expect(preflight.status).toBe(201);
      const reviewed = await preflight.json() as {
        contract: { id: string; version: number; state: string; hash: string };
        sourceRunVersion: number;
        preflight: { readiness: { status: string } };
      };
      expect(reviewed).toMatchObject({
        sourceRunVersion: 2,
        contract: { version: 2, state: "draft" },
        preflight: { readiness: { status: "ready" } },
      });
      expect(database.prepare("SELECT version, state FROM mission_contracts ORDER BY version").all()).toEqual([
        { version: 1, state: "confirmed" },
        { version: 2, state: "draft" },
      ]);
      expect(database.prepare("SELECT COUNT(*) AS count FROM mission_contract_snapshots").get()).toEqual({ count: 2 });

      const confirmBody = {
        sourceRunId: created.run.id,
        sourceRunVersion: reviewed.sourceRunVersion,
        mode: "contract_amendment",
        reason: "Replace the old lab boundary with the reviewed target",
        draftContractId: reviewed.contract.id,
        review: { version: reviewed.contract.version, hash: reviewed.contract.hash },
      };
      const confirmed = await fetch(
        `${url}/api/v2/missions/${created.mission.id}/autonomous-branches`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": "amend-confirm-0001" },
          body: JSON.stringify(confirmBody),
        },
      );
      expect(confirmed.status).toBe(201);
      const result = await confirmed.json() as { run: { id: string; status: string; contractId: string } };
      expect(result).toMatchObject({
        branchMode: "contract_amendment",
        run: { status: "planning", contractId: reviewed.contract.id },
        contract: { version: 2, state: "confirmed", hash: reviewed.contract.hash },
      });
      expect(database.prepare("SELECT version, state FROM mission_contracts ORDER BY version").all()).toEqual([
        { version: 1, state: "superseded" },
        { version: 2, state: "confirmed" },
      ]);
      expect(database.prepare("SELECT objective, scope_json, version FROM missions WHERE id = ?").get(created.mission.id)).toMatchObject({
        objective: amendment.objective,
        version: 2,
      });
      expect(database.prepare("SELECT status, contract_id FROM runs WHERE id = ?").get(created.run.id)).toEqual({
        status: "blocked",
        contract_id: database.prepare("SELECT id FROM mission_contracts WHERE version = 1").get()?.id,
      });
      expect(database.prepare("SELECT status, journey FROM runs WHERE id = ?").get(result.run.id)).toEqual({
        status: "planning",
        journey: "autonomous",
      });
      expect(database.prepare("SELECT COUNT(*) AS count FROM events WHERE event_type = 'run.autonomous_branch_created'").get()).toEqual({ count: 1 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM audit_records WHERE action = 'run.autonomous_branch_created'").get()).toEqual({ count: 1 });

      // Simulate state drift plus an application-process restart after the
      // server committed both responses but the client did not receive them.
      // Idempotent replay must be resolved from durable settings before the
      // now-superseded contract and changed source-run version are inspected.
      database.prepare(`
        UPDATE runs SET status_reason = 'Source changed after branch commit',
          version = version + 1, updated_at = ? WHERE id = ?
      `).run(new Date().toISOString(), created.run.id);
      const restartedApp = express();
      restartedApp.use(express.json({ limit: "256kb" }));
      restartedApp.use(createCommandOsRouter({
        database,
        readinessProviders: [provider("fail")],
        resolveActor: () => "operator-route-test",
      }));
      const restartedServer = restartedApp.listen(0, "127.0.0.1");
      servers.push(restartedServer);
      await new Promise<void>((resolve) => restartedServer.once("listening", resolve));
      const restartedUrl = `http://127.0.0.1:${(restartedServer.address() as AddressInfo).port}`;

      const replayedDraft = await fetch(
        `${restartedUrl}/api/v2/missions/${created.mission.id}/autonomous-branches/preflight`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": "amend-draft-0001" },
          body: JSON.stringify(preflightBody),
        },
      );
      expect(replayedDraft.status).toBe(201);
      expect(await replayedDraft.json()).toEqual(reviewed);

      const replayedConfirmation = await fetch(
        `${restartedUrl}/api/v2/missions/${created.mission.id}/autonomous-branches`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": "amend-confirm-0001" },
          body: JSON.stringify(confirmBody),
        },
      );
      expect(replayedConfirmation.status).toBe(201);
      expect(await replayedConfirmation.json()).toEqual(result);
      expect(database.prepare("SELECT COUNT(*) AS count FROM runs WHERE mission_id = ?").get(created.mission.id)).toEqual({ count: 2 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM mission_contracts WHERE mission_id = ?").get(created.mission.id)).toEqual({ count: 2 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM run_branches WHERE mission_id = ?").get(created.mission.id)).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });

  test("binds portfolio cursors to filters and exposes versioned views plus confirmed bounded bulk actions", async () => {
    const { database, url } = await application("pass");
    try {
      const create = async (title: string, key: string) => {
        const response = await fetch(`${url}/api/v2/missions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": key },
          body: JSON.stringify({ ...guided, title, target: `${title.toLowerCase().replaceAll(" ", "-")}.internal` }),
        });
        expect(response.status).toBe(201);
        return response.json() as Promise<{ mission: { id: string }; run: { id: string } }>;
      };
      const first = await create("Portfolio first", "portfolio-create-first");
      const second = await create("Portfolio second", "portfolio-create-second");

      const page = await fetch(`${url}/api/v2/missions?journey=guided&limit=1`);
      expect(page.status).toBe(200);
      const pageBody = await page.json() as { nextCursor: string; items: Array<Record<string, unknown>> };
      expect(pageBody.nextCursor).toBeString();
      expect(pageBody.items[0]).toMatchObject({
        journey: "guided",
        engagementId: null,
        evidenceCount: 0,
        currentPhase: null,
      });
      const replayUnderChangedFilters = await fetch(
        `${url}/api/v2/missions?journey=guided&status=planning&limit=1&cursor=${encodeURIComponent(pageBody.nextCursor)}`,
      );
      expect(replayUnderChangedFilters.status).toBe(400);
      expect(await replayUnderChangedFilters.json()).toMatchObject({ error: { code: "invalid_cursor" } });

      const emptyViews = await fetch(`${url}/api/v2/missions/saved-views`);
      expect(await emptyViews.json()).toMatchObject({ version: 0, items: [] });
      const state = {
        query: "Portfolio", journey: "guided", status: "planning", engagement: "", target: "",
        agent: "", provider: "", updatedFrom: "", updatedTo: "", risk: "", evidence: "",
        findingSeverity: "", decisionState: "", recoveryState: "", view: "table",
      };
      const saveRequest = { expectedVersion: 0, name: "Planning Guided", state };
      const saved = await fetch(`${url}/api/v2/missions/saved-views`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "portfolio-view-save-1" },
        body: JSON.stringify(saveRequest),
      });
      expect(saved.status).toBe(200);
      const savedBody = await saved.json() as { version: number; items: Array<{ id: string }> };
      expect(savedBody).toMatchObject({ version: 1, items: [{ name: "Planning Guided", state }] });
      const replayedSave = await fetch(`${url}/api/v2/missions/saved-views`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "portfolio-view-save-1" },
        body: JSON.stringify(saveRequest),
      });
      expect(await replayedSave.json()).toEqual(savedBody);

      const now = new Date().toISOString();
      database.prepare("UPDATE runs SET status = 'completed', ended_at = ?, updated_at = ? WHERE id = ?")
        .run(now, now, first.run.id);
      database.prepare("UPDATE missions SET status = 'completed', updated_at = ? WHERE id = ?")
        .run(now, first.mission.id);
      const archiveWithoutConfirmation = await fetch(`${url}/api/v2/missions/bulk/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "portfolio-archive-no-confirm" },
        body: JSON.stringify({ missionIds: [first.mission.id] }),
      });
      expect(archiveWithoutConfirmation.status).toBe(400);
      const archive = await fetch(`${url}/api/v2/missions/bulk/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "portfolio-archive-confirmed" },
        body: JSON.stringify({ missionIds: [first.mission.id, second.mission.id], confirm: true }),
      });
      expect(archive.status).toBe(200);
      expect(await archive.json()).toMatchObject({
        archivedCount: 1,
        outcomes: [
          { missionId: first.mission.id, status: "archived" },
          { missionId: second.mission.id, status: "ineligible" },
        ],
      });

      const exported = await fetch(`${url}/api/v2/missions/bulk/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "portfolio-export-confirmed" },
        body: JSON.stringify({ missionIds: [first.mission.id, second.mission.id], confirm: true }),
      });
      expect(exported.status).toBe(200);
      const exportText = await exported.text();
      expect(exportText).not.toContain(guided.objective);
      expect(exportText).not.toContain("portfolio-first.internal");
      expect(JSON.parse(exportText)).toMatchObject({
        policy: { evidenceBlobsIncluded: false, confidentialPayloadsIncluded: false },
        outcomes: [{ status: "exported" }, { status: "exported" }],
      });

      const deleted = await fetch(`${url}/api/v2/missions/saved-views/${savedBody.items[0]!.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "portfolio-view-delete-1" },
        body: JSON.stringify({ expectedVersion: 1 }),
      });
      expect(await deleted.json()).toMatchObject({ version: 2, items: [] });
    } finally {
      database.close();
    }
  });
});
