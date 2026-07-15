#!/usr/bin/env bun

/**
 * Opt-in process-level Grok OAuth restart/resume smoke.
 *
 * This harness intentionally SIGKILLs an isolated loopback server only after a
 * planning provider turn is visible in the disposable canonical database. It
 * never opens the OAuth file; the actual server/Grok boundary receives only
 * its opaque path. Do not add credential discovery or raw child logging here.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { createServer as createTcpServer } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import {
  REVIEWED_SELFTEST_PATH,
  REVIEWED_SELFTEST_SERVER,
  REVIEWED_SELFTEST_SHA256,
  REVIEWED_SELFTEST_TOOL,
  buildIsolatedServerEnvironment,
  validateFinalDurability,
  validateLiveRestartSmokeGate,
  validateReviewedSelftestConfig,
  type FinalDurabilitySnapshot,
  type IsolatedServerPaths,
} from "./live-grok-restart-resume-smoke-lib";

type JsonObject = Record<string, any>;

interface ManagedServer {
  readonly child: ChildProcess;
  readonly exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  exitResult?: { code: number | null; signal: NodeJS.Signals | null };
  spawnError?: Error;
}

const projectRoot = resolve(import.meta.dir, "../..");
const fixturePath = resolve(import.meta.dir, "fixtures/local-selftest.mcp.json");
const identity = userInfo();
const gate = validateLiveRestartSmokeGate(process.env, {
  platform: process.platform,
  euid: typeof process.geteuid === "function" ? process.geteuid() : undefined,
  username: identity.username,
});
const baseUrl = `http://127.0.0.1:${gate.port}`;
const terminalStatuses = new Set(["completed", "failed", "cancelled", "blocked"]);

function assertRootControlledReviewedFile(path: string, expectedHash?: string): void {
  const lexical = lstatSync(path);
  if (!lexical.isFile() || lexical.isSymbolicLink() || lexical.uid !== 0 || (lexical.mode & 0o022) !== 0) {
    throw new Error("A reviewed smoke asset is not a root-owned, non-writable regular file");
  }
  if (realpathSync(path) !== path) throw new Error("A reviewed smoke asset may not cross a symlink");
  let current = dirname(path);
  while (true) {
    const state = statSync(current);
    if (!state.isDirectory() || state.uid !== 0 || (state.mode & 0o022) !== 0) {
      throw new Error("A reviewed smoke asset crosses a directory outside the root-controlled boundary");
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (expectedHash) {
    const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
    if (actual !== expectedHash) throw new Error("The reviewed no-network self-test asset hash changed");
  }
}

function prepareLegacyBoard(path: string): void {
  const database = new Database(path, { create: true });
  try {
    database.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT, assignee TEXT,
        status TEXT NOT NULL, priority INTEGER DEFAULT 0, created_by TEXT,
        created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER,
        workspace_kind TEXT NOT NULL DEFAULT 'scratch', result TEXT,
        worker_pid INTEGER, last_failure_error TEXT, current_run_id INTEGER,
        model_override TEXT, max_retries INTEGER, session_id TEXT
      );
      CREATE TABLE task_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL,
        status TEXT NOT NULL, claim_lock TEXT, claim_expires INTEGER,
        worker_pid INTEGER, started_at INTEGER NOT NULL, ended_at INTEGER,
        outcome TEXT, summary TEXT, error TEXT
      );
      CREATE TABLE task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL,
        kind TEXT NOT NULL, payload TEXT, created_at INTEGER NOT NULL
      );
    `);
  } finally {
    database.close();
  }
}

async function assertPortAvailable(port: number): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const probe = createTcpServer();
    probe.once("error", () => reject(new Error("The requested isolated loopback port is already in use")));
    probe.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      probe.close((error) => error ? reject(error) : resolvePromise());
    });
  });
}

function launchServer(environment: NodeJS.ProcessEnv): ManagedServer {
  const child = spawn(process.execPath, ["run", "server/index.ts"], {
    cwd: projectRoot,
    env: environment,
    detached: true,
    stdio: "ignore",
  });
  const managed: ManagedServer = {
    child,
    exit: new Promise((resolvePromise) => {
      child.once("exit", (code, signal) => {
        managed.exitResult = { code, signal };
        resolvePromise(managed.exitResult);
      });
    }),
  };
  child.once("error", (error) => { managed.spawnError = error; });
  return managed;
}

function assertServerAlive(server: ManagedServer): void {
  if (server.spawnError) throw new Error("The isolated server could not be spawned");
  if (server.exitResult) throw new Error("The isolated server exited before the smoke checkpoint");
}

async function waitForExit(server: ManagedServer, timeoutMs: number): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      server.exit,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("The isolated server did not exit within its cleanup deadline")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function signalGroup(server: ManagedServer, signal: NodeJS.Signals): void {
  const pid = server.child.pid;
  if (!pid || server.exitResult) return;
  process.kill(-pid, signal);
}

function processGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error: any) {
    if (error?.code === "ESRCH") return false;
    return true;
  }
}

async function killAtCrashBoundary(server: ManagedServer): Promise<void> {
  const pid = server.child.pid;
  if (!pid) throw new Error("The isolated server has no process ID");
  signalGroup(server, "SIGKILL");
  const result = await waitForExit(server, 10_000);
  if (result.signal !== "SIGKILL") throw new Error("The first server did not terminate at the required SIGKILL boundary");
  if (processGroupAlive(pid)) throw new Error("The SIGKILL server process group left child work alive");
}

async function stopGracefully(server: ManagedServer): Promise<void> {
  const pid = server.child.pid;
  if (!pid || server.exitResult) return;
  signalGroup(server, "SIGTERM");
  try {
    const result = await waitForExit(server, 20_000);
    if (result.code !== 0 && result.signal !== "SIGTERM") {
      throw new Error("The restarted server did not finish graceful shutdown cleanly");
    }
  } catch (error) {
    if (!server.exitResult) {
      try { signalGroup(server, "SIGKILL"); } catch { /* best-effort containment */ }
      await waitForExit(server, 5_000).catch(() => undefined);
    }
    throw error;
  }
  if (processGroupAlive(pid)) throw new Error("Graceful shutdown left a child process group alive");
}

async function stopBestEffort(server: ManagedServer | undefined): Promise<void> {
  if (!server || server.exitResult) return;
  try { signalGroup(server, "SIGTERM"); } catch { return; }
  await waitForExit(server, 10_000).catch(async () => {
    try { signalGroup(server, "SIGKILL"); } catch { return; }
    await waitForExit(server, 3_000).catch(() => undefined);
  });
}

async function request(path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<JsonObject> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const value = await response.json().catch(() => ({})) as JsonObject;
  if (!response.ok) {
    const error = value.error && typeof value.error === "object" ? value.error : {};
    throw new Error(`${response.status} ${String(error.code || "request_failed")}: ${String(error.humanMessage || error.message || "Request failed").slice(0, 500)}`);
  }
  return value;
}

function mutation(body: unknown, prefix: string): RequestInit {
  return {
    method: "POST",
    headers: { "Idempotency-Key": `${prefix}-${randomUUID()}` },
    body: JSON.stringify(body),
  };
}

async function waitForServer(server: ManagedServer, timeoutMs = 90_000): Promise<JsonObject> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    assertServerAlive(server);
    try { return await request("/api/v2/overview", {}, 3_000); }
    catch { await Bun.sleep(250); }
  }
  throw new Error("The isolated loopback server did not become ready");
}

function readonlyDatabase(path: string): Database {
  const database = new Database(path, { readonly: true, strict: true });
  database.exec("PRAGMA busy_timeout = 2500");
  return database;
}

async function waitForDurablePlanningTurn(
  databasePath: string,
  runId: string,
  server: ManagedServer,
  timeoutMs = 120_000,
): Promise<{ id: string; leaseExpiresAt: string }> {
  const database = readonlyDatabase(databasePath);
  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      assertServerAlive(server);
      const turn = database.query(`
        SELECT id, status FROM provider_turns
        WHERE run_id = ? ORDER BY started_at, id LIMIT 1
      `).get(runId) as { id: string; status: string } | null;
      if (turn?.status === "started") {
        const run = database.query(`
          SELECT status, lease_owner, lease_expires_at FROM runs WHERE id = ?
        `).get(runId) as { status: string; lease_owner: string | null; lease_expires_at: string | null } | null;
        if (!run || run.status !== "planning" || !run.lease_owner || !run.lease_expires_at) {
          throw new Error("The durable planning turn was not protected by an active planning lease");
        }
        return { id: turn.id, leaseExpiresAt: run.lease_expires_at };
      }
      if (turn && turn.status !== "started") {
        throw new Error("The planning provider turn completed before the required crash boundary was observed");
      }
      await Bun.sleep(20);
    }
  } finally {
    database.close();
  }
  throw new Error("No durable in-flight planning provider turn was observed");
}

function currentLeaseExpiry(databasePath: string, runId: string): string {
  const database = readonlyDatabase(databasePath);
  try {
    const row = database.query("SELECT lease_expires_at FROM runs WHERE id = ?").get(runId) as { lease_expires_at: string | null } | null;
    if (!row?.lease_expires_at) throw new Error("The crashed planning run has no durable lease expiry");
    return row.lease_expires_at;
  } finally {
    database.close();
  }
}

async function waitUntilLeaseExpired(databasePath: string, runId: string): Promise<string> {
  const expiry = currentLeaseExpiry(databasePath, runId);
  const expiryMs = Date.parse(expiry);
  if (!Number.isFinite(expiryMs)) throw new Error("The crashed planning lease expiry is invalid");
  const remaining = expiryMs - Date.now() + 300;
  if (remaining > 60_000) throw new Error("The crashed planning lease exceeds the bounded smoke-test wait");
  if (remaining > 0) await Bun.sleep(remaining);
  if (Date.now() <= expiryMs) throw new Error("The second server would start before the crashed lease expired");
  return expiry;
}

async function waitForRecoveryEvent(runId: string, server: ManagedServer, timeoutMs = 90_000): Promise<JsonObject> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    assertServerAlive(server);
    const response = await request(`/api/v2/observability/events?runId=${encodeURIComponent(runId)}&eventType=run.recovery_started&limit=100`);
    if (Array.isArray(response.items) && response.items.length > 0) return response.items[0] as JsonObject;
    await Bun.sleep(250);
  }
  throw new Error("Restart did not expose a durable run.recovery_started event");
}

async function waitForCompletion(runId: string, server: ManagedServer, timeoutMs = 420_000): Promise<{ snapshot: JsonObject; observed: string[] }> {
  const deadline = Date.now() + timeoutMs;
  const observed: string[] = [];
  while (Date.now() < deadline) {
    assertServerAlive(server);
    const snapshot = await request(`/api/v2/runs/${encodeURIComponent(runId)}`);
    const status = String(snapshot.run?.status || "unknown");
    if (observed.at(-1) !== status) observed.push(status);
    if (status === "waiting_guided_decision") throw new Error("Autonomous recovery entered waiting_guided_decision");
    if (terminalStatuses.has(status)) {
      if (status !== "completed") {
        throw new Error(`Recovered Autonomous run ended in ${status}: ${String(snapshot.run?.statusReason || "no reason")}`);
      }
      return { snapshot, observed };
    }
    await Bun.sleep(500);
  }
  throw new Error(`Recovered run timed out after states: ${observed.join(" -> ") || "none"}`);
}

function count(database: Database, sql: string, ...parameters: any[]): number {
  const row = database.query(sql).get(...parameters) as { count: number };
  return Number(row.count);
}

function finalDurabilitySnapshot(databasePath: string, runId: string, crashTurnId: string): FinalDurabilitySnapshot {
  const database = readonlyDatabase(databasePath);
  try {
    const run = database.query(`
      SELECT status, journey, lease_owner, lease_expires_at, mission_id FROM runs WHERE id = ?
    `).get(runId) as {
      status: string; journey: string; lease_owner: string | null;
      lease_expires_at: string | null; mission_id: string;
    };
    const mission = database.query("SELECT status FROM missions WHERE id = ?").get(run.mission_id) as { status: string };
    const actions = (database.query(`
      SELECT id, status, normalized_arguments_json FROM actions WHERE run_id = ? ORDER BY created_at, id
    `).all(runId) as Array<{ id: string; status: string; normalized_arguments_json: string }>).map((row) => {
      const detail = JSON.parse(row.normalized_arguments_json) as JsonObject;
      return {
        id: row.id,
        status: row.status,
        kind: String(detail.orchestration?.kind || ""),
        mcpServer: String(detail.input?.mcpServer || ""),
        toolName: String(detail.input?.toolName || ""),
      };
    });
    const toolCalls = database.query(`
      SELECT tc.id, tc.action_id, tc.status, tc.mcp_server_id, tc.tool_name
      FROM tool_calls tc JOIN actions a ON a.id = tc.action_id
      WHERE a.run_id = ? ORDER BY tc.created_at, tc.id
    `).all(runId) as Array<{
      id: string; action_id: string; status: string; mcp_server_id: string | null; tool_name: string;
    }>;
    const evaluation = database.query(`
      SELECT COUNT(*) AS count, COALESCE(MAX(evidence_coverage), 0) AS coverage
      FROM run_evaluations WHERE run_id = ?
    `).get(runId) as { count: number; coverage: number };
    const crashTurn = database.query(`
      SELECT status, ended_at FROM provider_turns WHERE id = ? AND run_id = ?
    `).get(crashTurnId, runId) as { status: string; ended_at: string | null } | null;
    return {
      run: {
        status: run.status,
        journey: run.journey,
        leaseOwner: run.lease_owner,
        leaseExpiresAt: run.lease_expires_at,
      },
      missionStatus: mission.status,
      recoveryEventCount: count(database, "SELECT COUNT(*) AS count FROM events WHERE run_id = ? AND event_type = 'run.recovery_started'", runId),
      recoveryCheckpointCount: count(database, `
        SELECT COUNT(*) AS count FROM checkpoints c
        JOIN events e ON e.run_id = c.run_id AND e.sequence = c.event_sequence
        WHERE c.run_id = ? AND e.event_type = 'run.recovery_started'
      `, runId),
      waitingGuidedEventCount: count(database, `
        SELECT COUNT(*) AS count FROM events WHERE run_id = ? AND (
          event_type LIKE '%guided%' OR summary LIKE '%waiting_guided_decision%'
          OR payload_json LIKE '%waiting_guided_decision%'
        )
      `, runId),
      guidedDecisionCount: count(database, "SELECT COUNT(*) AS count FROM guided_decisions WHERE run_id = ?", runId),
      planCount: count(database, "SELECT COUNT(*) AS count FROM plans WHERE run_id = ?", runId),
      actions,
      toolCalls: toolCalls.map((row) => ({
        id: row.id,
        actionId: row.action_id,
        status: row.status,
        mcpServer: row.mcp_server_id,
        toolName: row.tool_name,
      })),
      completedActionEventCount: count(database, "SELECT COUNT(*) AS count FROM events WHERE run_id = ? AND event_type = 'action.completed'", runId),
      verifiedSelftestEvidenceCount: count(database, `
        SELECT COUNT(*) AS count FROM evidence
        WHERE run_id = ? AND source = 'mcp:local-selftest.quick_scan' AND verification_state = 'verified'
      `, runId),
      evaluationCount: Number(evaluation.count),
      evaluationEvidenceCoverage: Number(evaluation.coverage),
      openAssignmentCount: count(database, "SELECT COUNT(*) AS count FROM assignments WHERE run_id = ? AND status IN ('queued','active','blocked')", runId),
      startedProviderTurnCount: count(database, "SELECT COUNT(*) AS count FROM provider_turns WHERE run_id = ? AND status = 'started'", runId),
      crashProviderTurn: crashTurn ? { status: crashTurn.status, endedAt: crashTurn.ended_at } : null,
    };
  } finally {
    database.close();
  }
}

let tempRoot: string | undefined;
let activeServer: ManagedServer | undefined;

try {
  validateReviewedSelftestConfig(JSON.parse(readFileSync(fixturePath, "utf8")));
  assertRootControlledReviewedFile(fixturePath);
  assertRootControlledReviewedFile(REVIEWED_SELFTEST_PATH, REVIEWED_SELFTEST_SHA256);
  await assertPortAvailable(gate.port);

  tempRoot = mkdtempSync(join(tmpdir(), "chillspwn-live-grok-restart-"));
  chmodSync(tempRoot, 0o700);
  const paths: IsolatedServerPaths = {
    root: tempRoot,
    home: join(tempRoot, "home"),
    hermesHome: join(tempRoot, "home", ".hermes"),
    stateRoot: join(tempRoot, "state"),
    sessionsRoot: join(tempRoot, "state", "sessions"),
    databasePath: join(tempRoot, "state", "command-os-v2.sqlite"),
    vaultRoot: join(tempRoot, "state", "brain-vaults"),
    workspace: join(tempRoot, "workspace"),
    tmp: join(tempRoot, "tmp"),
    mcpConfigPath: fixturePath,
  };
  for (const path of [paths.home, paths.hermesHome, paths.stateRoot, paths.sessionsRoot, paths.vaultRoot, paths.workspace, paths.tmp]) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
  prepareLegacyBoard(join(paths.hermesHome, "kanban.db"));
  const serverEnvironment = buildIsolatedServerEnvironment(process.env, gate, paths);

  activeServer = launchServer(serverEnvironment);
  const firstOverview = await waitForServer(activeServer);
  const readinessChecks = Array.isArray(firstOverview.readiness?.checks) ? firstOverview.readiness.checks : [];
  if (!readinessChecks.some((check: JsonObject) => (
    check.id === "provider_execution_autonomous" && check.status !== "fail"
  )) || !readinessChecks.some((check: JsonObject) => (
    check.id === "execution_boundary_autonomous" && check.status === "pass"
  ))) {
    throw new Error("The isolated server does not report an enforceable Grok OAuth provider boundary");
  }
  const mcp = await request("/api/v2/system/mcp?limit=100");
  if (!Array.isArray(mcp.items) || mcp.items.length !== 1 || mcp.items[0]?.name !== REVIEWED_SELFTEST_SERVER
      || !["healthy", "degraded"].includes(String(mcp.items[0]?.status))) {
    throw new Error("The isolated server exposed an MCP other than the reviewed local-selftest");
  }

  const created = await request("/api/v2/missions", mutation({
    journey: "autonomous",
    launch: true,
    title: `Live Grok restart/resume smoke ${new Date().toISOString()}`,
    objective: "Use the reviewed local-selftest MCP quick_scan exactly once after durable process recovery. This is a no-op deployment check and must not perform a network scan.",
    successCriteria: ["Verified evidence states that the local-selftest bridge execute path is OK and no scan was performed"],
    authorization: {
      allowedTargets: ["127.0.0.1"],
      prohibitedTargets: [],
      authorizationConfirmed: true,
      dataHandling: "Disposable local deployment-validation metadata only",
    },
    contract: {
      allowedActionClasses: ["reconnaissance"],
      prohibitedActionClasses: ["destructive", "credential_access", "persistence"],
      destructivePolicy: "prohibited",
      evidenceRequirements: ["Verified local-selftest MCP result"],
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
      safeStopConditions: ["Any action other than local-selftest.quick_scan", "Any network-capable MCP action"],
      deliverables: ["Completion evaluation and immutable evidence receipt"],
    },
  }, "live-restart-autonomous-create"));
  const missionId = String(created.mission?.id || "");
  const runId = String(created.run?.id || "");
  if (!missionId || !runId) throw new Error("The isolated server did not return durable mission and run IDs");

  const crashBoundary = await waitForDurablePlanningTurn(paths.databasePath, runId, activeServer);
  await killAtCrashBoundary(activeServer);
  activeServer = undefined;
  const expiredLeaseAt = await waitUntilLeaseExpired(paths.databasePath, runId);

  activeServer = launchServer(serverEnvironment);
  await waitForServer(activeServer);
  const recoveryEvent = await waitForRecoveryEvent(runId, activeServer);
  const completed = await waitForCompletion(runId, activeServer);

  const plans = await request(`/api/v2/runs/${encodeURIComponent(runId)}/plans`);
  const steps = Array.isArray(plans.items)
    ? plans.items.flatMap((plan: JsonObject) => Array.isArray(plan.steps) ? plan.steps : [])
    : [];
  if (!steps.some((step: JsonObject) => step.assignedAgentId === "ReconScout"
      && step.action?.kind === "tool"
      && step.action?.arguments?.mcpServer === REVIEWED_SELFTEST_SERVER
      && step.action?.arguments?.toolName === REVIEWED_SELFTEST_TOOL)) {
    throw new Error("The recovered plan did not preserve the reviewed ReconScout local-selftest binding");
  }
  const evidence = await request(`/api/v2/intelligence/evidence?runId=${encodeURIComponent(runId)}&verificationState=verified&limit=20`);
  if (!Array.isArray(evidence.items) || !evidence.items.some((item: JsonObject) => (
    item.source === `mcp:${REVIEWED_SELFTEST_SERVER}.${REVIEWED_SELFTEST_TOOL}`
    && item.verificationState === "verified"
  ))) throw new Error("Verified local-selftest evidence is not visible through the operations API");
  const evaluations = await request(`/api/v2/learning/evaluations?runId=${encodeURIComponent(runId)}&limit=20`);
  if (!Array.isArray(evaluations.items) || evaluations.items.length !== 1) {
    throw new Error("The evidence-backed terminal evaluation is not visible through the operations API");
  }

  const durable = finalDurabilitySnapshot(paths.databasePath, runId, crashBoundary.id);
  validateFinalDurability(durable);

  const finalServer = activeServer;
  await stopGracefully(finalServer);
  activeServer = undefined;
  process.stdout.write(`${JSON.stringify({
    passed: true,
    missionId,
    runId,
    crashProviderTurnId: crashBoundary.id,
    expiredLeaseAt,
    recoveryEventId: String(recoveryEvent.id || ""),
    recoveryCheckpointCount: durable.recoveryCheckpointCount,
    observedStates: completed.observed,
    finalStatus: durable.run.status,
    mcpBinding: `${REVIEWED_SELFTEST_SERVER}.${REVIEWED_SELFTEST_TOOL}`,
    verifiedEvidenceCount: durable.verifiedSelftestEvidenceCount,
    evaluationCount: durable.evaluationCount,
  }, null, 2)}\n`);
} finally {
  await stopBestEffort(activeServer);
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
}
