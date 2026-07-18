#!/usr/bin/env bun

import { existsSync, lstatSync, realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
  createDatabaseConnection,
  DATABASE_MIGRATIONS,
  getDatabaseHealth,
  listAppliedMigrations,
  migrateDatabase,
} from "../../server/db";

const AMBIGUOUS_MISSION_ID = "mission-schema9-ambiguous";
const AMBIGUOUS_RUN_ID = "run-schema9-ambiguous";
const SINGLE_MISSION_ID = "mission-schema9-single";
const SINGLE_RUN_ID = "run-schema9-single";
const NOW = "2026-07-15T16:00:00.000Z";
const EXPIRES_AT = "2026-07-16T16:00:00.000Z";
const EXPECTED_DATABASE_NAME = "schema8-to-schema9.sqlite";
const REHEARSAL_ROOT = /^\/tmp\/chillspwn-schema9-rehearsal\.[A-Za-z0-9]+$/;

function fail(message: string): never {
  process.stderr.write(`schema-9 rehearsal refused: ${message}\n`);
  process.exit(64);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function databasePath(input: string | undefined, mustExist: boolean): string {
  if (!input) fail("usage: schema9-guided-boundary-rehearsal.ts seed|verify DATABASE");
  const database = resolve(input);
  const root = dirname(database);
  if (!REHEARSAL_ROOT.test(root) || basename(database) !== EXPECTED_DATABASE_NAME) {
    fail("database must be the named fixture directly below a /tmp/chillspwn-schema9-rehearsal.* directory");
  }
  const rootStatus = lstatSync(root);
  if (!rootStatus.isDirectory() || rootStatus.isSymbolicLink() || realpathSync(root) !== root) {
    fail("rehearsal root must be a real non-symlink /tmp directory");
  }
  if (existsSync(database)) {
    const status = lstatSync(database);
    if (!status.isFile() || status.isSymbolicLink()) {
      fail("database must be a regular non-symlink file");
    }
  } else if (mustExist) {
    fail("database does not exist");
  }
  return database;
}

function insertMission(
  database: ReturnType<typeof createDatabaseConnection>,
  id: string,
): void {
  database.prepare(`
    INSERT INTO missions (
      id, name, objective, journey, status, authorization_status,
      engagement_id, scope_json, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, 'guided', 'active', 'verified', ?, ?, 'schema9-rehearsal', ?, ?)
  `).run(
    id,
    `Schema 9 rehearsal ${id}`,
    "Prove exact Guided decision authority survives a fail-closed migration.",
    "engagement-schema9-rehearsal",
    JSON.stringify({ allowedTargets: ["127.0.0.1"], synthetic: true }),
    NOW,
    NOW,
  );
}

function seedGuidedRun(
  database: ReturnType<typeof createDatabaseConnection>,
  missionId: string,
  runId: string,
  stepCount: number,
): readonly string[] {
  insertMission(database, missionId);
  const planId = `${runId}-plan`;
  const stepIds = Array.from({ length: stepCount }, (_, ordinal) => `${runId}-step-${ordinal + 1}`);
  database.prepare(`
    INSERT INTO runs (
      id, mission_id, journey, status, status_reason,
      current_plan_id, current_step_id, lease_owner, lease_acquired_at,
      last_heartbeat_at, lease_expires_at, created_at, updated_at
    ) VALUES (?, ?, 'guided', 'waiting_guided_decision', 'Synthetic legacy checkpoint',
      NULL, NULL, 'legacy-worker', ?, ?, ?, ?, ?)
  `).run(runId, missionId, NOW, NOW, EXPIRES_AT, NOW, NOW);
  database.prepare(`
    INSERT INTO plans (
      id, run_id, version, status, strategy_summary, plan_hash,
      created_by, created_at, activated_at
    ) VALUES (?, ?, 1, 'active', 'Synthetic exact-step plan', ?, 'schema9-rehearsal', ?, ?)
  `).run(planId, runId, `${stepCount}`.repeat(64), NOW, NOW);

  const insertStep = database.prepare(`
    INSERT INTO plan_steps (
      id, plan_id, run_id, ordinal, phase, title, objective, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'reconnaissance', ?, 'Collect one bounded observation',
      'waiting_guided_decision', ?, ?)
  `);
  const insertAssignment = database.prepare(`
    INSERT INTO assignments (
      id, run_id, step_id, agent_id, status, lease_owner, lease_acquired_at,
      last_heartbeat_at, lease_expires_at, started_at, created_at, updated_at
    ) VALUES (?, ?, ?, 'agent-schema9-rehearsal', ?, 'legacy-worker', ?, ?, ?, ?, ?, ?)
  `);
  for (const [ordinal, stepId] of stepIds.entries()) {
    insertStep.run(stepId, planId, runId, ordinal, `Synthetic step ${ordinal + 1}`, NOW, NOW);
    insertAssignment.run(
      `${stepId}-assignment`,
      runId,
      stepId,
      ordinal === 0 ? "active" : "queued",
      NOW,
      NOW,
      EXPIRES_AT,
      NOW,
      NOW,
      NOW,
    );
  }
  database.prepare(`
    UPDATE runs SET current_plan_id = ?, current_step_id = ? WHERE id = ?
  `).run(planId, stepIds[0], runId);
  return stepIds;
}

function insertDecision(
  database: ReturnType<typeof createDatabaseConnection>,
  id: string,
  missionId: string,
  runId: string,
  stepId: string,
  fingerprintCharacter: string,
  status = "pending",
): void {
  database.prepare(`
    INSERT INTO guided_decisions (
      id, mission_id, run_id, step_id, requested_action_fingerprint,
      requested_parameters_json, rationale, risk_class, reversibility,
      status, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'Synthetic exact Guided step', 'low',
      'Read-only and reversible', ?, ?, ?)
  `).run(
    id,
    missionId,
    runId,
    stepId,
    fingerprintCharacter.repeat(64),
    JSON.stringify({ target: "127.0.0.1", synthetic: true }),
    status,
    EXPIRES_AT,
    NOW,
  );
}

function seed(databaseFile: string): void {
  if (existsSync(databaseFile)) fail("seed database already exists");
  const database = createDatabaseConnection({ filename: databaseFile });
  try {
    const schemaEight = migrateDatabase(database, DATABASE_MIGRATIONS.slice(0, 8));
    assert(schemaEight.currentVersion === 8, "fixture did not stop at schema 8");
    assert(schemaEight.applied.length === 8, "fresh fixture did not apply migrations 1 through 8");
    database.prepare(`
      INSERT INTO agents (
        id, role, display_name, status, version, created_at, updated_at
      ) VALUES ('agent-schema9-rehearsal', 'specialist', 'Synthetic specialist',
        'busy', 'rehearsal', ?, ?)
    `).run(NOW, NOW);

    const ambiguousSteps = seedGuidedRun(
      database,
      AMBIGUOUS_MISSION_ID,
      AMBIGUOUS_RUN_ID,
      2,
    );
    insertDecision(
      database,
      "decision-schema9-ambiguous-current",
      AMBIGUOUS_MISSION_ID,
      AMBIGUOUS_RUN_ID,
      ambiguousSteps[0]!,
      "a",
    );
    insertDecision(
      database,
      "decision-schema9-ambiguous-stale",
      AMBIGUOUS_MISSION_ID,
      AMBIGUOUS_RUN_ID,
      ambiguousSteps[1]!,
      "b",
    );

    const [singleStep] = seedGuidedRun(
      database,
      SINGLE_MISSION_ID,
      SINGLE_RUN_ID,
      1,
    );
    insertDecision(
      database,
      "decision-schema9-single",
      SINGLE_MISSION_ID,
      SINGLE_RUN_ID,
      singleStep!,
      "c",
    );
    insertDecision(
      database,
      "decision-schema9-single-historical",
      SINGLE_MISSION_ID,
      SINGLE_RUN_ID,
      singleStep!,
      "d",
      "rejected",
    );
    database.pragma("wal_checkpoint(TRUNCATE)");
    process.stdout.write(`${JSON.stringify({
      status: "schema8_fixture_created",
      database: databaseFile,
      migrationCount: listAppliedMigrations(database).length,
      ambiguousPending: 2,
      validPending: 1,
    })}\n`);
  } finally {
    database.close();
  }
}

function expectUniqueConstraint(operation: () => void): void {
  try {
    operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(message.includes("UNIQUE constraint failed"), `unexpected uniqueness error: ${message}`);
    return;
  }
  throw new Error("schema 9 allowed a second pending Guided decision for one run");
}

function verify(databaseFile: string): void {
  const database = createDatabaseConnection({ filename: databaseFile, fileMustExist: true });
  try {
    const migrations = listAppliedMigrations(database);
    assert(migrations.length === 9, "database does not contain exactly nine migrations");
    assert(migrations.at(-1)?.version === 9, "migration 9 is not the current schema");
    assert(
      migrations.at(-1)?.name === "guided_decision_single_pending_boundary",
      "unexpected migration-9 identity",
    );

    const ambiguousRun = database.prepare(`
      SELECT status, status_reason, next_action_summary, lease_owner,
             lease_acquired_at, lease_expires_at
      FROM runs WHERE id = ?
    `).get(AMBIGUOUS_RUN_ID) as Record<string, unknown> | undefined;
    assert(ambiguousRun?.status === "blocked", "ambiguous run was not blocked");
    assert(ambiguousRun.lease_owner === null, "ambiguous run retained its lease owner");
    assert(ambiguousRun.lease_acquired_at === null, "ambiguous run retained lease acquisition");
    assert(ambiguousRun.lease_expires_at === null, "ambiguous run retained lease expiry");
    assert(
      ambiguousRun.status_reason ===
        "Guided decision authority was ambiguous; legacy pending decisions were cancelled fail-closed",
      "ambiguous run did not retain the exact fail-closed reason",
    );

    const cancelled = database.prepare(`
      SELECT status, decision_actor, decision_reason, decided_at
      FROM guided_decisions WHERE run_id = ? ORDER BY id
    `).all(AMBIGUOUS_RUN_ID) as Array<Record<string, unknown>>;
    assert(cancelled.length === 2, "ambiguous decisions were lost");
    for (const decision of cancelled) {
      assert(decision.status === "cancelled", "ambiguous decision remained executable");
      assert(
        decision.decision_actor === "migration:guided-decision-boundary-v9",
        "ambiguous decision has the wrong cancellation actor",
      );
      assert(typeof decision.decided_at === "string", "ambiguous decision lacks decision time");
    }
    const blockedSteps = database.prepare(`
      SELECT COUNT(*) AS count FROM plan_steps WHERE run_id = ? AND status = 'blocked'
    `).get(AMBIGUOUS_RUN_ID) as { count: number };
    assert(blockedSteps.count === 2, "ambiguous Guided steps were not blocked");
    const blockedAssignments = database.prepare(`
      SELECT COUNT(*) AS count FROM assignments
      WHERE run_id = ? AND status = 'blocked'
        AND lease_owner IS NULL AND lease_acquired_at IS NULL
        AND last_heartbeat_at IS NULL AND lease_expires_at IS NULL
    `).get(AMBIGUOUS_RUN_ID) as { count: number };
    assert(blockedAssignments.count === 2, "ambiguous assignments were not blocked and unfenced");

    const singleRun = database.prepare(`
      SELECT status, lease_owner FROM runs WHERE id = ?
    `).get(SINGLE_RUN_ID) as { status: string; lease_owner: string | null } | undefined;
    assert(singleRun?.status === "waiting_guided_decision", "valid single-decision run changed state");
    assert(singleRun.lease_owner === "legacy-worker", "valid single-decision lease was changed");
    const singlePending = database.prepare(`
      SELECT COUNT(*) AS count FROM guided_decisions WHERE run_id = ? AND status = 'pending'
    `).get(SINGLE_RUN_ID) as { count: number };
    assert(singlePending.count === 1, "valid single pending decision was not preserved");

    const index = database.prepare(`
      SELECT sql FROM sqlite_master
      WHERE type = 'index' AND name = 'idx_guided_decisions_one_pending_per_run'
    `).get() as { sql: string } | undefined;
    assert(index?.sql.includes("WHERE status = 'pending'"), "pending-decision partial index is absent");

    expectUniqueConstraint(() => insertDecision(
      database,
      "decision-schema9-forbidden-duplicate",
      SINGLE_MISSION_ID,
      SINGLE_RUN_ID,
      `${SINGLE_RUN_ID}-step-1`,
      "e",
    ));
    insertDecision(
      database,
      "decision-schema9-additional-historical",
      SINGLE_MISSION_ID,
      SINGLE_RUN_ID,
      `${SINGLE_RUN_ID}-step-1`,
      "f",
      "rejected",
    );

    const idempotent = migrateDatabase(database);
    assert(idempotent.currentVersion === 9, "idempotent migration reported the wrong schema");
    assert(idempotent.applied.length === 0, "migration 9 reapplied on restart");
    let schemaEightRejected = false;
    try {
      migrateDatabase(database, DATABASE_MIGRATIONS.slice(0, 8));
    } catch (error) {
      schemaEightRejected = error instanceof Error &&
        error.message === "Database contains unknown migration version 9";
    }
    assert(schemaEightRejected, "schema-8 application boundary did not fail closed on schema 9");

    const health = getDatabaseHealth(database, { refreshIntegrity: true });
    assert(health.healthy, "schema-9 database health failed");
    assert(health.currentMigration === 9, "health did not report schema 9");
    assert(health.foreignKeys, "foreign keys are disabled");
    database.pragma("wal_checkpoint(TRUNCATE)");
    process.stdout.write(`${JSON.stringify({
      status: "schema9_guided_boundary_verified",
      migration: { version: migrations.at(-1)?.version, name: migrations.at(-1)?.name },
      ambiguous: { decisionsCancelled: 2, stepsBlocked: 2, assignmentsBlocked: 2 },
      preserved: { validPendingDecisions: 1, historicalDecisionsAllowed: true },
      uniquenessEnforced: true,
      idempotentRestart: true,
      schemaEightRollbackBoundary: "fail_closed",
      health: {
        healthy: health.healthy,
        journalMode: health.journalMode,
        foreignKeys: health.foreignKeys,
        currentMigration: health.currentMigration,
      },
    })}\n`);
  } finally {
    database.close();
  }
}

if (process.argv.length !== 4) {
  fail("usage: schema9-guided-boundary-rehearsal.ts seed|verify DATABASE");
}
const [mode, input] = process.argv.slice(2);
if (mode === "seed") seed(databasePath(input, false));
else if (mode === "verify") verify(databasePath(input, true));
else fail("mode must be seed or verify");
