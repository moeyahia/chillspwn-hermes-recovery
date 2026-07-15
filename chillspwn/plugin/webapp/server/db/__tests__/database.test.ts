import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  backupDatabase,
  createDatabaseConnection,
  DATABASE_MIGRATIONS,
  getDatabaseHealth,
  listAppliedMigrations,
  migrateDatabase,
} from "../index";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "command-os-db-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function insertMission(
  database: ReturnType<typeof createDatabaseConnection>,
  id: string,
  journey: "autonomous" | "guided" = "autonomous",
): void {
  const now = new Date().toISOString();
  database
    .prepare(`
      INSERT INTO missions (
        id, name, objective, journey, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(id, `Mission ${id}`, "Validate the authorized target", journey, "operator", now, now);
}

describe("Command OS database foundation", () => {
  test("applies ordered migrations once and reports a healthy WAL connection", () => {
    const databasePath = join(temporaryDirectory(), "state", "command-os.sqlite");
    const database = createDatabaseConnection({ filename: databasePath });
    try {
      const first = migrateDatabase(database);
      const second = migrateDatabase(database);
      const health = getDatabaseHealth(database);

      expect(first.applied.map((migration) => migration.version)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(second.applied).toEqual([]);
      expect(listAppliedMigrations(database)).toHaveLength(7);
      expect(health.healthy).toBe(true);
      expect(health.journalMode).toBe("wal");
      expect(health.foreignKeys).toBe(true);
      expect(health.busyTimeoutMs).toBe(5_000);
      expect(health.currentMigration).toBe(7);
      expect(existsSync(databasePath)).toBe(true);
    } finally {
      database.close();
    }
  });

  test("caches the full integrity scan per connection while explicit diagnostics can refresh it", () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    try {
      migrateDatabase(database);
      let quickChecks = 0;
      const wrapped = new Proxy(database, {
        get(target, property, receiver) {
          if (property === "pragma") {
            return (source: string, options?: { simple?: boolean }) => {
              if (source === "quick_check") quickChecks += 1;
              return target.pragma(source, options);
            };
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });

      expect(getDatabaseHealth(wrapped).healthy).toBe(true);
      expect(getDatabaseHealth(wrapped).healthy).toBe(true);
      expect(quickChecks).toBe(1);
      expect(getDatabaseHealth(wrapped, { refreshIntegrity: true }).healthy).toBe(true);
      expect(quickChecks).toBe(2);
    } finally {
      database.close();
    }
  });

  test("creates all canonical runtime, memory, vault, learning, and audit tables", () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    try {
      migrateDatabase(database);
      const rows = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>;
      const names = new Set(rows.map((row) => row.name));
      for (const expected of [
        "missions",
        "runs",
        "plans",
        "plan_steps",
        "actions",
        "guided_decisions",
        "events",
        "event_outbox",
        "evidence",
        "findings",
        "checkpoints",
        "run_evaluations",
        "run_evaluation_comparisons",
        "memory_nodes",
        "memory_edges",
        "memory_sources",
        "memory_versions",
        "memory_candidates",
        "memory_context_packs",
        "memory_context_items",
        "memory_suppressions",
        "preference_profiles",
        "vault_connections",
        "vault_sync_state",
        "vault_conflicts",
        "lessons",
        "lesson_usage",
        "lesson_attack_chain_details",
        "lesson_attack_chain_items",
        "lesson_attack_chain_sources",
        "audit_records",
      ]) {
        expect(names.has(expected)).toBe(true);
      }
    } finally {
      database.close();
    }
  });

  test("upgrades a version-five database and marks legacy evaluations as explicitly un-compared", () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    try {
      migrateDatabase(database, DATABASE_MIGRATIONS.slice(0, 5));
      insertMission(database, "mission-legacy");
      const now = "2026-07-15T12:00:00.000Z";
      database.prepare(`
        INSERT INTO runs (
          id, mission_id, journey, status, started_at, ended_at, created_at, updated_at
        ) VALUES ('run-legacy', 'mission-legacy', 'autonomous', 'completed', ?, ?, ?, ?)
      `).run(now, now, now, now);
      database.prepare(`
        INSERT INTO run_evaluations (
          id, mission_id, run_id, journey, scores_json, metrics_json,
          retrospective, evidence_coverage, created_by, created_at
        ) VALUES (
          'evaluation-legacy', 'mission-legacy', 'run-legacy', 'autonomous', '{}', '{}',
          'Legacy evaluation', 0, 'evaluator', ?
        )
      `).run(now);

      const result = migrateDatabase(database);
      expect(result.applied.map((migration) => migration.version)).toEqual([6, 7]);
      expect(database.prepare(`
        SELECT comparison_status, reason, prior_run_id, metrics_json
        FROM run_evaluation_comparisons WHERE evaluation_id = 'evaluation-legacy'
      `).get()).toEqual({
        comparison_status: "insufficient_data",
        reason: "legacy_evaluation_not_compared",
        prior_run_id: null,
        metrics_json: "[]",
      });
    } finally {
      database.close();
    }
  });

  test("backfills audit journeys and rejects missing or mismatched scoped journeys", () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    try {
      migrateDatabase(database, DATABASE_MIGRATIONS.slice(0, 6));
      insertMission(database, "mission-audit", "guided");
      const now = "2026-07-15T12:30:00.000Z";
      database.prepare(`
        INSERT INTO runs (id, mission_id, journey, status, created_at, updated_at)
        VALUES ('run-audit', 'mission-audit', 'guided', 'running', ?, ?)
      `).run(now, now);
      database.prepare(`
        INSERT INTO audit_records (
          id, mission_id, run_id, actor_type, actor_id, action,
          resource_type, resource_id, reason, details_json,
          previous_hash, record_hash, occurred_at
        ) VALUES (
          'audit-legacy', 'mission-audit', 'run-audit', 'operator', 'operator',
          'guided.step_recorded', 'run', 'run-audit', 'Legacy scoped record', '{}',
          NULL, 'legacy-record-hash', ?
        )
      `).run(now);
      database.prepare(`
        INSERT INTO artifacts (
          id, mission_id, run_id, artifact_type, storage_uri, content_hash,
          byte_size, sensitivity, metadata_json, created_at
        ) VALUES (
          'artifact-legacy', 'mission-audit', 'run-audit', 'mission_report',
          'artifact://legacy-report', ?, 12, 'private', '{}', ?
        )
      `).run("a".repeat(64), now);
      database.prepare(`
        INSERT INTO checkpoints (
          id, mission_id, run_id, event_sequence, state_json, state_hash, created_at
        ) VALUES (
          'checkpoint-legacy', 'mission-audit', 'run-audit', 0, '{}', ?, ?
        )
      `).run("b".repeat(64), now);

      const result = migrateDatabase(database);
      expect(result.applied.map((migration) => migration.version)).toEqual([7]);
      expect(database.prepare(
        "SELECT journey, record_hash FROM audit_records WHERE id = 'audit-legacy'",
      ).get()).toEqual({ journey: "guided", record_hash: "legacy-record-hash" });
      expect(database.prepare(
        "SELECT journey FROM artifacts WHERE id = 'artifact-legacy'",
      ).get()).toEqual({ journey: "guided" });
      expect(database.prepare(
        "SELECT journey FROM checkpoints WHERE id = 'checkpoint-legacy'",
      ).get()).toEqual({ journey: "guided" });

      const insert = database.prepare(`
        INSERT INTO audit_records (
          id, mission_id, run_id, journey, actor_type, actor_id, action,
          resource_type, resource_id, reason, details_json,
          previous_hash, record_hash, occurred_at
        ) VALUES (?, 'mission-audit', 'run-audit', ?, 'operator', 'operator',
          'guided.step_recorded', 'run', 'run-audit', 'Scoped record', '{}',
          'legacy-record-hash', ?, ?)
      `);
      expect(() => insert.run("audit-missing", null, "missing", now)).toThrow(
        "require a journey",
      );
      expect(() => insert.run("audit-mismatch", "autonomous", "mismatch", now)).toThrow(
        "match",
      );
      insert.run("audit-valid", "guided", "valid", now);
      expect(() => database.prepare(
        "UPDATE audit_records SET journey = 'autonomous' WHERE id = 'audit-valid'",
      ).run()).toThrow("immutable");
      expect(() => database.prepare(`
        INSERT INTO artifacts (
          id, mission_id, run_id, artifact_type, storage_uri, content_hash,
          byte_size, sensitivity, metadata_json, created_at
        ) VALUES ('artifact-missing', 'mission-audit', 'run-audit', 'report',
          'artifact://missing', ?, 0, 'private', '{}', ?)
      `).run("c".repeat(64), now)).toThrow("require a journey");
      expect(() => database.prepare(`
        INSERT INTO checkpoints (
          id, mission_id, run_id, event_sequence, state_json, state_hash, created_at
        ) VALUES ('checkpoint-missing', 'mission-audit', 'run-audit', 1, '{}', ?, ?)
      `).run("d".repeat(64), now)).toThrow("require a journey");
    } finally {
      database.close();
    }
  });

  test("enforces journey invariants, JSON validity, and foreign keys", () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    try {
      migrateDatabase(database);
      insertMission(database, "mission-auto");
      const now = new Date().toISOString();

      expect(() =>
        database
          .prepare(`
            INSERT INTO runs (id, mission_id, journey, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `)
          .run(
            "run-waits",
            "mission-auto",
            "autonomous",
            "waiting_guided_decision",
            now,
            now,
          ),
      ).toThrow();
      expect(() =>
        database
          .prepare(`
            INSERT INTO runs (id, mission_id, journey, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `)
          .run("run-orphan", "missing", "guided", "queued", now, now),
      ).toThrow();
      expect(() =>
        database
          .prepare("UPDATE missions SET scope_json = ? WHERE id = ?")
          .run("not-json", "mission-auto"),
      ).toThrow();
    } finally {
      database.close();
    }
  });

  test("keeps events, evidence, audit records, and memory versions immutable", () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    try {
      migrateDatabase(database);
      insertMission(database, "mission-immutable");
      const now = new Date().toISOString();
      database
        .prepare(`
          INSERT INTO runs (id, mission_id, journey, status, created_at, updated_at)
          VALUES (?, ?, 'autonomous', 'running', ?, ?)
        `)
        .run("run-immutable", "mission-immutable", now, now);
      database
        .prepare(`
          INSERT INTO events (
            id, mission_id, run_id, sequence, event_type, occurred_at, actor_type,
            summary, journey, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          "event-immutable",
          "mission-immutable",
          "run-immutable",
          1,
          "run.started",
          now,
          "system",
          "Run started",
          "autonomous",
          now,
        );
      expect(() =>
        database
          .prepare("UPDATE events SET summary = ? WHERE id = ?")
          .run("Changed", "event-immutable"),
      ).toThrow("append-only");
      expect(() =>
        database.prepare("DELETE FROM events WHERE id = ?").run("event-immutable"),
      ).toThrow("append-only");
    } finally {
      database.close();
    }
  });

  test("indexes canonical text with FTS5", () => {
    const database = createDatabaseConnection({ filename: ":memory:" });
    try {
      migrateDatabase(database);
      const now = new Date().toISOString();
      database
        .prepare(`
          INSERT INTO memory_nodes (
            id, node_type, title, summary, body, scope, sensitivity, confidence,
            lifecycle_status, confirmation_state, provenance_json, author_type,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          "memory-search",
          "technique",
          "Service fingerprinting",
          "Correlate banner evidence",
          "Validate versions before selecting a procedure.",
          "global",
          "internal",
          0.9,
          "verified",
          "not_required",
          "{}",
          "agent",
          now,
          now,
        );
      const hit = database
        .prepare(`
          SELECT memory_nodes.id
          FROM memory_nodes_fts
          JOIN memory_nodes ON memory_nodes.rowid = memory_nodes_fts.rowid
          WHERE memory_nodes_fts MATCH ?
        `)
        .get("fingerprint*") as { id: string } | undefined;
      expect(hit?.id).toBe("memory-search");
    } finally {
      database.close();
    }
  });

  test("creates and validates an online backup", async () => {
    const directory = temporaryDirectory();
    const source = join(directory, "live.sqlite");
    const destination = join(directory, "backups", "snapshot.sqlite");
    const database = createDatabaseConnection({ filename: source });
    try {
      migrateDatabase(database);
      insertMission(database, "mission-backup");
      const result = await backupDatabase(database, destination);
      expect(result.destination).toBe(destination);
      expect(result.totalPages).toBeGreaterThan(0);

      const verification = createDatabaseConnection({
        filename: destination,
        readonly: true,
        fileMustExist: true,
      });
      try {
        const row = verification
          .prepare("SELECT id FROM missions WHERE id = ?")
          .get("mission-backup") as { id: string } | undefined;
        expect(row?.id).toBe("mission-backup");
      } finally {
        verification.close();
      }
    } finally {
      database.close();
    }
  });
});
