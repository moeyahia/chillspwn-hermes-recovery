import { createDatabaseConnection, inImmediateTransaction, migrateDatabase } from "../../../server/db";

export const OBSERVABILITY_SCALE_EVENT_COUNT = 100_000;
export const OBSERVABILITY_SCALE_LOG_COUNT = 4;
export const OBSERVABILITY_SCALE_MISSION_ID = "mission-observability-scale";
export const OBSERVABILITY_SCALE_RUN_ID = "run-observability-scale";
export const OBSERVABILITY_SCALE_TRACE_ID = "trace-observability-scale-100k";
export const OBSERVABILITY_SCALE_FILTER_EVENT_TYPE = "recovery.diagnosed";
export const OBSERVABILITY_SCALE_SEARCH_TERM = "obssearch42424";

const BASE_TIME = Date.parse("2026-07-15T00:00:00.000Z");
const EVENT_TYPES = [
  "evidence.added",
  "step.progressed",
  OBSERVABILITY_SCALE_FILTER_EVENT_TYPE,
  "finding.strengthened",
] as const;

function eventId(index: number): string {
  return `event-observability-scale-${String(index).padStart(6, "0")}`;
}

function semanticSummary(index: number, eventType: typeof EVENT_TYPES[number]): string {
  switch (eventType) {
    case "evidence.added":
      return `Recon specialist added unique service evidence ${index}; validation is next.`;
    case "step.progressed":
      return `Validation specialist advanced bounded verification step ${index}.`;
    case OBSERVABILITY_SCALE_FILTER_EVENT_TYPE:
      return `Supervisor diagnosed transient provider latency ${index} and selected a bounded retry.`;
    case "finding.strengthened":
      return `New evidence strengthened finding confidence at event ${index}.`;
  }
}

/**
 * E2E-only scale fixture. It writes the real canonical schema in the temporary
 * database created by start-server.ts. Production code never imports it and
 * the host process deliberately does not inherit credentials.
 */
export function seedObservabilityScaleFixtures(databasePath: string): void {
  const startedAt = performance.now();
  const database = createDatabaseConnection({
    filename: databasePath,
    verifyIntegrity: false,
    busyTimeoutMs: 120_000,
  });

  try {
    migrateDatabase(database);
    const started = new Date(BASE_TIME).toISOString();
    const ended = new Date(BASE_TIME + OBSERVABILITY_SCALE_EVENT_COUNT + 10).toISOString();

    database.prepare(`
      INSERT INTO missions (
        id, name, objective, journey, status, authorization_status,
        engagement_id, scope_json, success_criteria_json, retention_policy_json,
        memory_policy_json, created_by, created_at, updated_at
      ) VALUES (
        ?, 'Observability scale acceptance',
        'Prove bounded semantic observability over one hundred thousand canonical events.',
        'autonomous', 'completed', 'verified', 'eng-observability-scale',
        '{"fixture":"e2e-only","target":"isolated.local"}',
        '["Bound every operational query and rendered page"]',
        '{"fixture":"ephemeral"}', '{}', 'e2e-observability-scale-fixture', ?, ?
      )
    `).run(OBSERVABILITY_SCALE_MISSION_ID, started, ended);

    database.prepare(`
      INSERT INTO runs (
        id, mission_id, journey, status, progress, status_reason,
        next_action_summary, budget_json, budget_usage_json, started_at,
        ended_at, created_at, updated_at
      ) VALUES (
        ?, ?, 'autonomous', 'completed', 1,
        'Scale acceptance completed without loading an unbounded event set.',
        'Inspect the bounded correlated trace and semantic records.',
        '{"events":100000}', '{"events":100000}', ?, ?, ?, ?
      )
    `).run(
      OBSERVABILITY_SCALE_RUN_ID,
      OBSERVABILITY_SCALE_MISSION_ID,
      started,
      ended,
      started,
      ended,
    );

    const insertEvent = database.prepare(`
      INSERT INTO events (
        id, mission_id, run_id, sequence, event_type, occurred_at,
        actor_type, actor_id, summary, payload_json, schema_version, journey,
        trace_id, span_id, sensitivity, redaction_json, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, 'agent', 'agent-observability-scale', ?, ?, 1,
        'autonomous', ?, ?, 'internal', '{}', ?
      )
    `);
    const payload = JSON.stringify({
      fixture: "e2e-only",
      progressKind: "meaningful",
      evidenceDelta: 1,
      bounded: true,
      nextAction: "Continue with the next authorized observation",
    });

    inImmediateTransaction(database, () => {
      for (let index = 1; index <= OBSERVABILITY_SCALE_EVENT_COUNT; index += 1) {
        const eventType = EVENT_TYPES[(index - 1) % EVENT_TYPES.length];
        const occurredAt = new Date(BASE_TIME + index).toISOString();
        insertEvent.run(
          eventId(index),
          OBSERVABILITY_SCALE_MISSION_ID,
          OBSERVABILITY_SCALE_RUN_ID,
          index,
          eventType,
          occurredAt,
          semanticSummary(index, eventType),
          payload,
          OBSERVABILITY_SCALE_TRACE_ID,
          `span-observability-scale-${String(index).padStart(6, "0")}`,
          occurredAt,
        );
      }

      database.prepare(`
        INSERT INTO run_event_sequences (run_id, last_sequence) VALUES (?, ?)
      `).run(OBSERVABILITY_SCALE_RUN_ID, OBSERVABILITY_SCALE_EVENT_COUNT);

      const insertLog = database.prepare(`
        INSERT INTO structured_logs (
          id, mission_id, run_id, severity, domain, message, attributes_json,
          trace_id, span_id, sensitivity, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'internal', ?)
      `);
      const logRows = [
        {
          id: "log-observability-scale-stream",
          severity: "info",
          domain: "event_stream",
          message: "Event replay acknowledged the last durable sequence without a gap.",
          offset: 1,
        },
        {
          id: "log-observability-scale-supervisor",
          severity: "info",
          domain: "supervisor",
          message: "Supervisor confirmed the run reached a durable terminal checkpoint.",
          offset: 2,
        },
        {
          id: "log-observability-scale-provider",
          severity: "warn",
          domain: "provider",
          message: "Provider latency recovered inside the configured retry budget.",
          offset: 3,
        },
        {
          id: "log-observability-scale-sentinel",
          severity: "warn",
          domain: "provider",
          message: `Provider recovery sentinel ${OBSERVABILITY_SCALE_SEARCH_TERM} was acknowledged.`,
          offset: 4,
        },
      ] as const;
      for (const row of logRows) {
        const occurredAt = new Date(BASE_TIME + OBSERVABILITY_SCALE_EVENT_COUNT + row.offset).toISOString();
        insertLog.run(
          row.id,
          OBSERVABILITY_SCALE_MISSION_ID,
          OBSERVABILITY_SCALE_RUN_ID,
          row.severity,
          row.domain,
          row.message,
          JSON.stringify({ fixture: "e2e-only", bounded: true, retainedPayload: false }),
          OBSERVABILITY_SCALE_TRACE_ID,
          `span-${row.id}`,
          occurredAt,
        );
      }
    });

    database.pragma("wal_checkpoint(TRUNCATE)");
    const counts = database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM events WHERE run_id = ?) AS events,
        (SELECT COUNT(*) FROM structured_logs WHERE run_id = ?) AS logs,
        (SELECT COUNT(*) FROM structured_logs_fts) AS indexed_logs,
        (SELECT last_sequence FROM run_event_sequences WHERE run_id = ?) AS last_sequence
    `).get(
      OBSERVABILITY_SCALE_RUN_ID,
      OBSERVABILITY_SCALE_RUN_ID,
      OBSERVABILITY_SCALE_RUN_ID,
    ) as { events: number; logs: number; indexed_logs: number; last_sequence: number };
    if (
      Number(counts.events) !== OBSERVABILITY_SCALE_EVENT_COUNT
      || Number(counts.logs) !== OBSERVABILITY_SCALE_LOG_COUNT
      || Number(counts.indexed_logs) !== OBSERVABILITY_SCALE_LOG_COUNT
      || Number(counts.last_sequence) !== OBSERVABILITY_SCALE_EVENT_COUNT
    ) {
      throw new Error(`Observability scale fixture reconciliation failed: ${JSON.stringify(counts)}`);
    }

    const elapsedMs = Math.round((performance.now() - startedAt) * 100) / 100;
    console.log(
      `[e2e-only:observability-scale] seeded ${counts.events} canonical events and ${counts.logs} indexed logs in ${elapsedMs}ms`,
    );
  } finally {
    database.close();
  }
}
