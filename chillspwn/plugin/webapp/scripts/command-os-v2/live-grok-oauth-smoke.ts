#!/usr/bin/env bun

/**
 * Opt-in live deployment smoke test.
 *
 * This script talks only to a loopback ChillsPwn instance that the operator has
 * deliberately started with the real Grok OAuth state and the reviewed
 * `sechub-reconnaissance.quick_scan` reviewed selftest binding. That MCP is a no-op: it performs no scan and
 * opens no network connection. No credential material is read or printed here.
 */

const confirmation = "authorized-local-selftest";
const baseUrl = (process.env.CHILLSPWN_LIVE_TEST_URL || "http://127.0.0.1:33132").replace(/\/$/u, "");
const parsedBase = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsedBase.hostname)) {
  throw new Error("Live Grok smoke testing is restricted to a loopback ChillsPwn instance");
}
if (process.env.CHILLSPWN_LIVE_TEST_CONFIRM !== confirmation) {
  throw new Error(`Set CHILLSPWN_LIVE_TEST_CONFIRM=${confirmation} after starting the isolated loopback test server`);
}

type JsonObject = Record<string, any>;
const terminal = new Set(["completed", "failed", "cancelled", "blocked"]);

async function request(path: string, init: RequestInit = {}): Promise<JsonObject> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  const value = await response.json().catch(() => ({})) as JsonObject;
  if (!response.ok) {
    const error = value.error && typeof value.error === "object" ? value.error : {};
    throw new Error(`${response.status} ${String(error.code || "request_failed")}: ${String(error.humanMessage || error.message || "Request failed")}`);
  }
  return value;
}

function mutation(body: unknown, prefix: string): RequestInit {
  return {
    method: "POST",
    headers: { "Idempotency-Key": `${prefix}-${crypto.randomUUID()}` },
    body: JSON.stringify(body),
  };
}

async function runSnapshot(runId: string): Promise<JsonObject> {
  return request(`/api/v2/runs/${encodeURIComponent(runId)}`);
}

async function waitFor(
  runId: string,
  accepted: ReadonlySet<string>,
  timeoutMs = 240_000,
): Promise<{ snapshot: JsonObject; observed: string[] }> {
  const deadline = Date.now() + timeoutMs;
  const observed: string[] = [];
  while (Date.now() < deadline) {
    const snapshot = await runSnapshot(runId);
    const status = String(snapshot.run?.status || "unknown");
    if (observed.at(-1) !== status) observed.push(status);
    if (accepted.has(status)) return { snapshot, observed };
    await Bun.sleep(750);
  }
  throw new Error(`Run ${runId} timed out; observed ${observed.join(" -> ") || "no state"}`);
}

async function cancel(runId: string, label: string): Promise<void> {
  const snapshot = await runSnapshot(runId).catch(() => undefined);
  if (!snapshot || terminal.has(String(snapshot.run?.status))) return;
  await request(
    `/api/v2/runs/${encodeURIComponent(runId)}/cancel`,
    mutation({ reason: `${label} smoke-test cleanup` }, `live-cleanup-${label}`),
  ).catch(() => undefined);
}

async function waitForRuntimeReadiness(timeoutMs = 120_000): Promise<{
  overview: JsonObject;
  selftest: JsonObject;
}> {
  const deadline = Date.now() + timeoutMs;
  let lastState = "no readiness response";
  while (Date.now() < deadline) {
    const overview = await request("/api/v2/overview");
    const checks = Array.isArray(overview.readiness?.checks) ? overview.readiness.checks : [];
    const status = (id: string) => String(
      checks.find((check: JsonObject) => check.id === id)?.status || "missing",
    );
    const mcp = await request("/api/v2/system/mcp?limit=100");
    const selftest = Array.isArray(mcp.items)
      ? mcp.items.find((item: JsonObject) => item.name === "sechub-reconnaissance")
      : undefined;
    lastState = [
      `provider=${status("provider_execution_autonomous")}`,
      `boundary=${status("execution_boundary_autonomous")}`,
      `specialists=${status("specialist_fleet")}`,
      `mcp=${String(selftest?.status || "missing")}`,
    ].join(", ");
    if (
      status("provider_execution_autonomous") === "pass"
      && status("execution_boundary_autonomous") === "pass"
      && status("specialist_fleet") === "pass"
      && selftest?.status === "healthy"
    ) return { overview, selftest };
    await Bun.sleep(500);
  }
  throw new Error(`Loopback runtime did not complete live readiness attestation: ${lastState}`);
}

async function guidedSmoke(): Promise<JsonObject> {
  const created = await request("/api/v2/missions", mutation({
    journey: "guided",
    launch: true,
    authorizationConfirmed: true,
    title: `Live Grok Guided smoke ${new Date().toISOString()}`,
    objective: "Explain how to validate the reviewed no-network selftest boundary without executing any tool",
    target: "127.0.0.1",
    explanationDepth: "concise",
    executionPreference: "manual",
    evidenceExpectations: ["A bounded explanation with no execution claim"],
  }, "live-guided-create"));
  const missionId = String(created.mission.id);
  const runId = String(created.run.id);
  try {
    const waiting = await waitFor(runId, new Set(["waiting_guided_decision", "blocked", "failed"]));
    if (waiting.snapshot.run.status !== "waiting_guided_decision") {
      throw new Error(`Guided planning did not reach a deliberate decision: ${String(waiting.snapshot.run.statusReason || waiting.snapshot.run.status)}`);
    }
    const decisions = await request(`/api/v2/decisions?runId=${encodeURIComponent(runId)}&status=pending&limit=10`);
    if (!Array.isArray(decisions.items) || decisions.items.length !== 1) {
      throw new Error("Guided planning did not create exactly one pending exact-step decision");
    }
    const decision = decisions.items[0] as JsonObject;
    const stepId = String(decision.stepId || "");
    const actionFingerprint = String(decision.actionFingerprint || "");
    if (
      String(decision.missionId || "") !== missionId
      || String(decision.runId || "") !== runId
      || !stepId
      || !/^[a-f0-9]{64}$/u.test(actionFingerprint)
      || !decision.requestedParameters
      || typeof decision.requestedParameters !== "object"
      || Array.isArray(decision.requestedParameters)
    ) {
      throw new Error("Guided decision did not preserve one exact represented step and normalized parameters");
    }
    const representedParameters = JSON.stringify(decision.requestedParameters);
    const reply = await request(
      `/api/v2/guided/${encodeURIComponent(missionId)}/commander/show-next-step`,
      mutation({
        runId,
        stepId,
        expectedFingerprint: actionFingerprint,
      }, "live-guided-explain"),
    );
    const structured = reply.result?.assistantMessage?.structuredContent || {};
    if (
      String(reply.result?.actionFingerprint || "") !== actionFingerprint
      || structured.executionPerformed !== false
      || structured.planMutated !== false
      || structured.nextConsequentialActionRequiresDecision !== true
    ) {
      throw new Error("Guided Commander violated the planning-only response boundary");
    }
    const after = await runSnapshot(runId);
    if (
      after.run?.status !== "waiting_guided_decision"
      || String(after.run?.currentStepId || "") !== stepId
    ) {
      throw new Error("Guided Commander advanced beyond the represented step without an operator decision");
    }
    const pendingAfter = await request(`/api/v2/decisions?runId=${encodeURIComponent(runId)}&status=pending&limit=10`);
    if (
      !Array.isArray(pendingAfter.items)
      || pendingAfter.items.length !== 1
      || String(pendingAfter.items[0]?.id || "") !== String(decision.id)
      || String(pendingAfter.items[0]?.stepId || "") !== stepId
      || String(pendingAfter.items[0]?.actionFingerprint || "") !== actionFingerprint
      || JSON.stringify(pendingAfter.items[0]?.requestedParameters) !== representedParameters
    ) {
      throw new Error("Guided Commander changed the pending exact-step decision during explanation");
    }
    const actions = await request(`/api/v2/operations/actions?runId=${encodeURIComponent(runId)}&limit=10`);
    if (!Array.isArray(actions.items) || actions.items.length !== 0) {
      throw new Error("Guided Commander performed opaque action work while explaining the represented step");
    }
    return {
      missionId,
      runId,
      observedStates: waiting.observed,
      decisionId: String(decision.id),
      stepId,
      actionFingerprint,
      provider: String(reply.result?.provider || "grok-acp-oauth"),
      executionPerformed: false,
    };
  } finally {
    await cancel(runId, "guided");
  }
}

async function autonomousSmoke(): Promise<JsonObject> {
  const created = await request("/api/v2/missions", mutation({
    journey: "autonomous",
    launch: true,
    title: `Live Grok Autonomous MCP smoke ${new Date().toISOString()}`,
    objective: "Use the reviewed no-network selftest bound to sechub-reconnaissance.quick_scan exactly once to validate specialist dispatch. This is a no-op deployment check and must not perform a network scan.",
    successCriteria: ["Verified evidence states that the reviewed selftest bridge execute path is OK and no scan was performed"],
    authorization: {
      allowedTargets: ["127.0.0.1"],
      prohibitedTargets: [],
      authorizationConfirmed: true,
      dataHandling: "Private local deployment-validation metadata only",
    },
    contract: {
      specialistAgentIds: ["ReconScout"],
      allowedActionClasses: ["reconnaissance"],
      prohibitedActionClasses: ["destructive", "credential_access", "persistence"],
      destructivePolicy: "prohibited",
      evidenceRequirements: ["Verified reviewed-selftest MCP result"],
      timeBudgetMinutes: 10,
      retryBudget: 1,
      replanBudget: 1,
      concurrencyLimit: 1,
      evidenceStorageBudgetBytes: 16 * 1024 * 1024,
      artifactStorageBudgetBytes: 16 * 1024 * 1024,
      notificationPolicy: "in_app_only",
      reportingFormat: "command_os_json",
      dataHandlingPolicy: "local_private",
      retentionPolicy: "operator_managed",
      providerPolicy: "automatic_enforcing_only",
      toolPolicy: "contract_allowlist",
      memoryScopes: [],
      contextNodeIds: [],
      safeStopConditions: ["Any action other than sechub-reconnaissance.quick_scan", "Any network-capable action"],
      deliverables: ["Completion evaluation and immutable evidence receipt"],
    },
  }, "live-autonomous-create"));
  const missionId = String(created.mission.id);
  const runId = String(created.run.id);
  try {
    const finished = await waitFor(runId, terminal, 360_000);
    if (finished.observed.includes("waiting_guided_decision")) {
      throw new Error("Autonomous run entered a Guided user-wait state");
    }
    if (finished.snapshot.run.status !== "completed") {
      throw new Error(`Autonomous smoke did not complete: ${String(finished.snapshot.run.statusReason || finished.snapshot.run.status)}`);
    }
    const plans = await request(`/api/v2/runs/${encodeURIComponent(runId)}/plans`);
    const steps = Array.isArray(plans.items)
      ? plans.items.flatMap((plan: JsonObject) => Array.isArray(plan.steps) ? plan.steps : [])
      : [];
    const dispatched = steps.find((step: JsonObject) => (
      step.action?.kind === "tool"
      && step.action?.arguments?.mcpServer === "sechub-reconnaissance"
      && step.action?.arguments?.toolName === "quick_scan"
    ));
    if (!dispatched || dispatched.assignedAgentId !== "ReconScout") {
      throw new Error("Autonomous plan did not use the reviewed ReconScout selftest alias binding");
    }
    const evidence = await request(`/api/v2/intelligence/evidence?runId=${encodeURIComponent(runId)}&verificationState=verified&limit=20`);
    const verified = Array.isArray(evidence.items) && evidence.items.find((item: JsonObject) => (
      item.source === "mcp:sechub-reconnaissance.quick_scan" && item.verificationState === "verified"
    ));
    if (!verified) throw new Error("Autonomous selftest produced no verified MCP evidence");
    const evaluations = await request(`/api/v2/learning/evaluations?runId=${encodeURIComponent(runId)}&limit=20`);
    if (!Array.isArray(evaluations.items) || evaluations.items.length < 1) {
      throw new Error("Completed Autonomous selftest has no durable run evaluation");
    }
    return {
      missionId,
      runId,
      observedStates: finished.observed,
      finalStatus: "completed",
      assignedAgentId: "ReconScout",
      mcpBinding: "sechub-reconnaissance.quick_scan",
      verifiedEvidenceId: String(verified.id),
      evaluationId: String(evaluations.items[0].id),
    };
  } finally {
    await cancel(runId, "autonomous");
  }
}

await waitForRuntimeReadiness();

const guided = await guidedSmoke();
const autonomous = await autonomousSmoke();
process.stdout.write(`${JSON.stringify({ passed: true, baseUrl, guided, autonomous }, null, 2)}\n`);
