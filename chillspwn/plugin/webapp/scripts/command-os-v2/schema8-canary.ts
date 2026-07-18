#!/usr/bin/env bun

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(64);
}

const [liveWebappInput, databaseInput, canaryId] = process.argv.slice(2);
if (!liveWebappInput || !databaseInput || !canaryId) {
  fail("usage: schema8-canary.ts LIVE_WEBAPP DATABASE CANARY_ID");
}
if (!/^[A-Za-z0-9._:-]{1,120}$/.test(canaryId)) {
  fail("invalid canary identifier");
}

const liveWebapp = resolve(liveWebappInput);
const databasePath = resolve(databaseInput);
const connectionModule = pathToFileURL(
  resolve(liveWebapp, "server/db/connection.ts"),
).href;
const { createDatabaseConnection } = await import(connectionModule) as {
  createDatabaseConnection(options: {
    filename: string;
    fileMustExist: boolean;
  }): {
    prepare(sql: string): {
      run(...parameters: unknown[]): { changes: number };
      get(...parameters: unknown[]): unknown;
    };
    pragma(source: string): unknown;
    close(): void;
  };
};

const database = createDatabaseConnection({
  filename: databasePath,
  fileMustExist: true,
});

try {
  const now = new Date().toISOString();
  const result = database.prepare(`
    INSERT INTO missions (
      id, name, objective, journey, status, authorization_status,
      engagement_id, scope_json, success_criteria_json,
      retention_policy_json, memory_policy_json, created_by,
      version, created_at, updated_at
    ) VALUES (?, ?, ?, 'guided', 'active', 'verified', ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    canaryId,
    "Schema 8 rehearsal canary",
    "Prove the schema-7 to schema-8 compatibility bridge preserves an isolated synthetic mission.",
    "engagement-schema8-rehearsal",
    JSON.stringify({ allowedTargets: ["127.0.0.1"], synthetic: true }),
    JSON.stringify(["Canary remains byte-for-byte queryable after every isolated startup"]),
    JSON.stringify({ mode: "operator_managed" }),
    JSON.stringify({ enabled: false, reason: "synthetic-rehearsal" }),
    "schema8-rehearsal",
    now,
    now,
  );
  if (result.changes !== 1) throw new Error("canary insert did not change exactly one row");

  const canary = database.prepare(`
    SELECT id, name, objective, journey, status, authorization_status,
           engagement_id, scope_json, success_criteria_json,
           retention_policy_json, memory_policy_json, created_by,
           version, created_at, updated_at
      FROM missions
     WHERE id = ?
  `).get(canaryId);
  database.pragma("wal_checkpoint(TRUNCATE)");
  process.stdout.write(`${JSON.stringify(canary, null, 2)}\n`);
} finally {
  database.close();
}
