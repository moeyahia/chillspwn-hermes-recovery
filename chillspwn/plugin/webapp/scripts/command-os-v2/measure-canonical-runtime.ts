import express from "express";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDatabaseConnection,
  inImmediateTransaction,
  migrateDatabase,
} from "../../server/db";
import { EventRepository } from "../../server/events/EventRepository";
import { EventStreamService } from "../../server/events/EventStreamService";
import { MemoryRepository } from "../../server/memory/MemoryRepository";
import { MemoryRetrievalService } from "../../server/memory/MemoryRetrievalService";
import { createSecondBrainRouter } from "../../server/memory/SecondBrainRouter";
import { layoutGraph } from "../../src/features/brain/graphUtils";
import type { MemoryNodeSummary } from "../../src/domain/types/brain";

const nodeCount = Number(process.env.COMMAND_OS_GRAPH_FIXTURE_NODES || 50_000);
const eventCount = Number(process.env.COMMAND_OS_EVENT_FIXTURE_EVENTS || 5_000);
const enforceBudgets = process.env.COMMAND_OS_ENFORCE_PERFORMANCE_BUDGETS !== "false";
const retrievalTarget = Math.min(42_420, nodeCount - 1);
const retrievalTargetId = `mem_perf_${String(retrievalTarget).padStart(6, "0")}`;

if (!Number.isSafeInteger(nodeCount) || nodeCount < 1_000 || nodeCount > 100_000) {
  throw new RangeError("COMMAND_OS_GRAPH_FIXTURE_NODES must be an integer from 1,000 to 100,000");
}
if (!Number.isSafeInteger(eventCount) || eventCount < 1_000 || eventCount > 100_000) {
  throw new RangeError("COMMAND_OS_EVENT_FIXTURE_EVENTS must be an integer from 1,000 to 100,000");
}

function percentile(samples: readonly number[], percentileValue: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * percentileValue) - 1)] ?? 0;
}

function summarize(samples: readonly number[]) {
  const total = samples.reduce((sum, value) => sum + value, 0);
  return {
    rounds: samples.length,
    minMs: Number(Math.min(...samples).toFixed(3)),
    medianMs: Number(percentile(samples, 0.5).toFixed(3)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(3)),
    maxMs: Number(Math.max(...samples).toFixed(3)),
    meanMs: Number((total / samples.length).toFixed(3)),
  };
}

async function sampleAsync<T>(rounds: number, operation: () => Promise<T>): Promise<{ samples: number[]; last: T }> {
  let last!: T;
  const samples: number[] = [];
  for (let index = 0; index < rounds; index += 1) {
    const started = performance.now();
    last = await operation();
    samples.push(performance.now() - started);
  }
  return { samples, last };
}

function sampleSync<T>(rounds: number, operation: () => T): { samples: number[]; last: T } {
  let last!: T;
  const samples: number[] = [];
  for (let index = 0; index < rounds; index += 1) {
    const started = performance.now();
    last = operation();
    samples.push(performance.now() - started);
  }
  return { samples, last };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

interface GraphResponse {
  readonly nodes: MemoryNodeSummary[];
  readonly edges: unknown[];
  readonly truncated: boolean;
}

const directory = mkdtempSync(join(tmpdir(), "command-os-v2-performance-"));
const databasePath = join(directory, "canonical.sqlite");
const database = createDatabaseConnection({ filename: databasePath, verifyIntegrity: false });
let server: Server | undefined;

try {
  migrateDatabase(database);
  const now = "2026-07-15T00:00:00.000Z";
  const provenance = JSON.stringify({
    method: "performance_fixture",
    explanation: "Synthetic isolated canonical performance fixture",
    sources: [],
  });
  const retention = JSON.stringify({ allowAutonomous: true, allowGuided: true });
  const versionProperties = JSON.stringify({
    scope: { kind: "global" },
    sensitivity: "internal",
    confidence: 0.95,
    confirmationState: "not_required",
  });
  const insertNode = database.prepare(`
    INSERT INTO memory_nodes (
      id, node_type, title, summary, body, scope, engagement_id, mission_id,
      sensitivity, confidence, lifecycle_status, confirmation_state,
      provenance_json, author_type, author_id, version, retention_policy_json,
      expires_at, pinned, created_at, updated_at
    ) VALUES (
      ?, 'technique', ?, ?, ?, 'global', NULL, NULL,
      'internal', 0.95, 'verified', 'not_required',
      ?, 'system', 'performance-fixture', 1, ?, NULL, ?, ?, ?
    )
  `);
  const insertVersion = database.prepare(`
    INSERT INTO memory_versions (
      id, node_id, version, title, summary, body, properties_json,
      lifecycle_status, author_type, author_id, change_reason, content_hash, created_at
    ) VALUES (?, ?, 1, ?, ?, ?, ?, 'verified', 'system',
      'performance-fixture', 'Created by isolated performance fixture', ?, ?)
  `);
  const insertEdge = database.prepare(`
    INSERT INTO memory_edges (
      id, source_node_id, target_node_id, edge_type, title, summary, scope,
      sensitivity, confidence, lifecycle_status, provenance_json, explanation,
      author_type, author_id, version, expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, 'depends_on', ?, ?, 'global', 'internal', 0.9,
      'verified', ?, ?, 'system', 'performance-fixture', 1, NULL, ?, ?)
  `);

  const seedStarted = performance.now();
  inImmediateTransaction(database, () => {
    for (let index = 0; index < nodeCount; index += 1) {
      const id = `mem_perf_${String(index).padStart(6, "0")}`;
      const title = `Operational memory ${index}`;
      const summary = `Indexed canonical graph fixture node ${index}`;
      const body = `Bounded retrieval fixture needle${index}`;
      insertNode.run(id, title, summary, body, provenance, retention, index === 0 ? 1 : 0, now, now);
      insertVersion.run(
        `mver_perf_${String(index).padStart(6, "0")}`,
        id,
        title,
        summary,
        body,
        versionProperties,
        sha256(`${id}:${title}:${summary}:${body}`),
        now,
      );
    }
    const hubConnections = Math.min(999, nodeCount - 1);
    for (let index = 1; index <= hubConnections; index += 1) {
      const target = `mem_perf_${String(index).padStart(6, "0")}`;
      insertEdge.run(
        `medge_hub_${String(index).padStart(6, "0")}`,
        "mem_perf_000000",
        target,
        `Hub relationship ${index}`,
        "Bounded local-neighborhood fixture",
        provenance,
        "Measures indexed expansion around a highly connected node",
        now,
        now,
      );
    }
    for (let index = 1_000; index < nodeCount; index += 1) {
      const source = `mem_perf_${String(index - 1).padStart(6, "0")}`;
      const target = `mem_perf_${String(index).padStart(6, "0")}`;
      insertEdge.run(
        `medge_chain_${String(index).padStart(6, "0")}`,
        source,
        target,
        `Chain relationship ${index}`,
        "Large-vault topology fixture",
        provenance,
        "Preserves connectivity without asking the UI to render every node",
        now,
        now,
      );
    }
  });
  const seedDurationMs = performance.now() - seedStarted;
  database.exec("ANALYZE");

  const missionId = "mission-performance";
  const runId = "run-performance";
  database.prepare(`
    INSERT INTO missions (
      id, name, objective, journey, status, authorization_status,
      scope_json, success_criteria_json, retention_policy_json, memory_policy_json,
      created_by, created_at, updated_at
    ) VALUES (?, 'Performance fixture mission', 'Measure canonical event paths',
      'guided', 'active', 'verified', '{}', '[]', '{}', '{}', 'performance-fixture', ?, ?)
  `).run(missionId, now, now);
  database.prepare(`
    INSERT INTO runs (id, mission_id, journey, status, created_at, updated_at)
    VALUES (?, ?, 'guided', 'running', ?, ?)
  `).run(runId, missionId, now, now);

  const events = new EventRepository(database);
  const appendStarted = performance.now();
  for (let index = 0; index < eventCount; index += 1) {
    events.append({
      id: `event-performance-${index}`,
      runId,
      eventType: "benchmark.progress",
      actorType: "system",
      summary: `Meaningful benchmark progress ${index + 1}`,
      payload: { evidenceDelta: index % 17 === 0 ? 1 : 0 },
    });
  }
  const appendDurationMs = performance.now() - appendStarted;

  let replayed = 0;
  let lastReplaySequence = 0;
  const stream = new EventStreamService({ repository: events, replayBatchSize: 1_000, maxQueueSize: 10_000 });
  const replayStarted = performance.now();
  const subscription = stream.subscribe({
    runId,
    afterSequence: 0,
    maxQueueSize: 10_000,
    sink: {
      write(event) {
        replayed += 1;
        lastReplaySequence = event.sequence;
        return true;
      },
      onDrain: () => () => undefined,
    },
  });
  await subscription.ready;
  const replayDurationMs = performance.now() - replayStarted;
  subscription.close();

  let delivered = 0;
  const deliveryStarted = performance.now();
  while (true) {
    const batch = await stream.pumpOnce();
    delivered += batch.delivered;
    if (batch.claimed === 0) break;
  }
  const deliveryDurationMs = performance.now() - deliveryStarted;

  const memory = new MemoryRetrievalService(new MemoryRepository(database));
  memory.retrieve(`needle${retrievalTarget}`, {
    journey: "guided",
    maximumSensitivity: "internal",
    contextBudget: 2_000,
    graphDepth: 1,
    limit: 20,
  });
  const retrieval = sampleSync(50, () => memory.retrieve(`needle${retrievalTarget}`, {
    journey: "guided",
    maximumSensitivity: "internal",
    contextBudget: 2_000,
    graphDepth: 1,
    limit: 20,
  }));

  const app = express();
  app.use(createSecondBrainRouter({
    database,
    resolveActor: () => "performance-fixture",
    resolveAccess: () => ({ maximumSensitivity: "restricted", allEngagements: true }),
  }));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  const requestGraph = async (path: string): Promise<GraphResponse> => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    if (!response.ok) throw new Error(`Graph benchmark request failed with HTTP ${response.status}`);
    return response.json() as Promise<GraphResponse>;
  };

  await requestGraph("/api/v2/brain/graph?view=local&nodeId=mem_perf_000000&depth=1&limit=250");
  const local250 = await sampleAsync(20, () => requestGraph(
    "/api/v2/brain/graph?view=local&nodeId=mem_perf_000000&depth=1&limit=250",
  ));
  const local500 = await sampleAsync(12, () => requestGraph(
    "/api/v2/brain/graph?view=local&nodeId=mem_perf_000000&depth=1&limit=500",
  ));
  const global250 = await sampleAsync(12, () => requestGraph(
    "/api/v2/brain/graph?view=global&limit=250",
  ));
  const canvasLayout = sampleSync(100, () => layoutGraph(local500.last.nodes, 1_440, 900));

  const queryPlan = database.prepare(`
    EXPLAIN QUERY PLAN
    SELECT source_node_id, target_node_id FROM memory_edges
    WHERE lifecycle_status IN ('confirmed', 'verified')
      AND (expires_at IS NULL OR expires_at > ?)
      AND (source_node_id = ? OR target_node_id = ?)
    ORDER BY confidence DESC, updated_at DESC LIMIT 1000
  `).all(now, "mem_perf_000000", "mem_perf_000000") as Array<{ detail: string }>;

  const appendEventsPerSecond = eventCount / (appendDurationMs / 1_000);
  const replayEventsPerSecond = replayed / (replayDurationMs / 1_000);
  const failures: string[] = [];
  if (replayed !== eventCount || lastReplaySequence !== eventCount) {
    failures.push(`Event replay delivered ${replayed}/${eventCount} events and ended at sequence ${lastReplaySequence}`);
  }
  if (delivered !== eventCount) failures.push(`Outbox delivered ${delivered}/${eventCount} events`);
  if (retrieval.last[0]?.node.id !== retrievalTargetId) {
    failures.push("FTS retrieval did not return the exact indexed memory fixture first");
  }
  if (local250.last.nodes.length !== 250 || !local250.last.truncated) {
    failures.push("The initial graph neighborhood was not bounded to 250 nodes with truncation metadata");
  }
  if (local500.last.nodes.length !== 500 || !local500.last.truncated) {
    failures.push("The expanded graph neighborhood did not return the requested 500-node segment");
  }
  if (local250.last.edges.length < 200) failures.push("Local graph response omitted expected canonical relationships");
  if (canvasLayout.last.length !== 500) failures.push("Canvas layout did not remain bounded to the API segment");

  const budgets = {
    memorySearchP95Ms: 300,
    localGraph250P95Ms: 200,
    globalGraph250P95Ms: 1_500,
    boundedCanvas500P95Ms: 50,
    minimumEventAppendPerSecond: 200,
    minimumEventReplayPerSecond: 1_000,
  };
  const retrievalSummary = summarize(retrieval.samples);
  const local250Summary = summarize(local250.samples);
  const global250Summary = summarize(global250.samples);
  const canvasSummary = summarize(canvasLayout.samples);
  if (enforceBudgets) {
    if (retrievalSummary.p95Ms > budgets.memorySearchP95Ms) failures.push(`Memory search p95 ${retrievalSummary.p95Ms}ms exceeds ${budgets.memorySearchP95Ms}ms`);
    if (local250Summary.p95Ms > budgets.localGraph250P95Ms) failures.push(`Local graph p95 ${local250Summary.p95Ms}ms exceeds ${budgets.localGraph250P95Ms}ms`);
    if (global250Summary.p95Ms > budgets.globalGraph250P95Ms) failures.push(`Global graph p95 ${global250Summary.p95Ms}ms exceeds ${budgets.globalGraph250P95Ms}ms`);
    if (canvasSummary.p95Ms > budgets.boundedCanvas500P95Ms) failures.push(`Bounded canvas layout p95 ${canvasSummary.p95Ms}ms exceeds ${budgets.boundedCanvas500P95Ms}ms`);
    if (appendEventsPerSecond < budgets.minimumEventAppendPerSecond) failures.push(`Event append throughput ${appendEventsPerSecond.toFixed(1)}/s is below ${budgets.minimumEventAppendPerSecond}/s`);
    if (replayEventsPerSecond < budgets.minimumEventReplayPerSecond) failures.push(`Event replay throughput ${replayEventsPerSecond.toFixed(1)}/s is below ${budgets.minimumEventReplayPerSecond}/s`);
  }

  const result = {
    schemaVersion: 1,
    measuredAt: new Date().toISOString(),
    environment: {
      runtime: `Bun ${Bun.version}`,
      platform: `${process.platform}/${process.arch}`,
      database: "isolated canonical SQLite fixture, WAL mode",
    },
    fixtures: {
      memoryNodes: nodeCount,
      memoryEdges: nodeCount - 1,
      memoryVersions: nodeCount,
      runEvents: eventCount,
      seedDurationMs: Number(seedDurationMs.toFixed(3)),
      databaseBytes: statSync(databasePath).size,
    },
    memory: {
      ftsAndGraphRetrieval: retrievalSummary,
      firstResultId: retrieval.last[0]?.node.id ?? null,
      queryPlan: queryPlan.map((row) => row.detail),
    },
    graph: {
      local250: { ...summarize(local250.samples), nodes: local250.last.nodes.length, edges: local250.last.edges.length, truncated: local250.last.truncated },
      local500: { ...summarize(local500.samples), nodes: local500.last.nodes.length, edges: local500.last.edges.length, truncated: local500.last.truncated },
      global250: { ...summarize(global250.samples), nodes: global250.last.nodes.length, edges: global250.last.edges.length, truncated: global250.last.truncated },
      boundedCanvasLayout500: { ...canvasSummary, points: canvasLayout.last.length },
    },
    events: {
      append: { count: eventCount, durationMs: Number(appendDurationMs.toFixed(3)), eventsPerSecond: Number(appendEventsPerSecond.toFixed(1)) },
      streamReplay: { count: replayed, lastSequence: lastReplaySequence, durationMs: Number(replayDurationMs.toFixed(3)), eventsPerSecond: Number(replayEventsPerSecond.toFixed(1)) },
      outboxDelivery: { count: delivered, durationMs: Number(deliveryDurationMs.toFixed(3)), eventsPerSecond: Number((delivered / (deliveryDurationMs / 1_000)).toFixed(1)) },
    },
    budgets,
    budgetsEnforced: enforceBudgets,
    passed: failures.length === 0,
    failures,
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (failures.length > 0) process.exitCode = 1;
} finally {
  if (server) await closeServer(server);
  database.close();
  rmSync(directory, { recursive: true, force: true });
}
