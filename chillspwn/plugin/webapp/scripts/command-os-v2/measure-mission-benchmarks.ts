import {
  createDatabaseConnection,
  migrateDatabase,
  type SqliteDatabase,
} from "../../server/db";
import {
  RunComparisonService,
  type StoredRunComparison,
} from "../../server/learning/RunComparisonService";
import {
  REPRESENTATIVE_MISSION_BENCHMARKS,
  type RepresentativeMissionBenchmarkFixture,
  type RepresentativeMissionBenchmarkRun,
} from "./fixtures/mission-benchmark-fixtures";

const START = "2026-07-15T00:00:00.000Z";
const PRIOR_END = "2026-07-15T00:30:00.000Z";
const CURRENT_END = "2026-07-15T01:30:00.000Z";

export interface RepresentativeMissionBenchmarkResult {
  readonly fixtureId: string;
  readonly title: string;
  readonly journey: "autonomous" | "guided";
  readonly comparison: StoredRunComparison;
  readonly expectedFavorableMetrics: readonly string[];
  readonly missingFavorableMetrics: readonly string[];
  readonly unexpectedUnfavorableMetrics: readonly string[];
  readonly passed: boolean;
}

function seedMission(database: SqliteDatabase, fixture: RepresentativeMissionBenchmarkFixture): string {
  const missionId = `benchmark-mission-${fixture.id}`;
  database.prepare(`
    INSERT INTO missions (
      id, name, objective, journey, status, authorization_status, engagement_id,
      created_by, created_at, updated_at
    ) VALUES (?, ?, 'Synthetic isolated benchmark objective', ?, 'completed',
      'verified', ?, 'benchmark-fixture', ?, ?)
  `).run(
    missionId,
    `[Synthetic benchmark] ${fixture.title}`,
    fixture.journey,
    `benchmark-engagement-${fixture.id}`,
    START,
    START,
  );
  return missionId;
}

function seedEvaluation(
  database: SqliteDatabase,
  fixture: RepresentativeMissionBenchmarkFixture,
  missionId: string,
  phase: "prior" | "current",
  run: RepresentativeMissionBenchmarkRun,
): { readonly runId: string; readonly evaluationId: string; readonly endedAt: string } {
  const runId = `benchmark-run-${fixture.id}-${phase}`;
  const evaluationId = `benchmark-evaluation-${fixture.id}-${phase}`;
  const endedAt = phase === "prior" ? PRIOR_END : CURRENT_END;
  database.prepare(`
    INSERT INTO runs (
      id, mission_id, journey, status, budget_json, budget_usage_json,
      started_at, ended_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '{}', '{}', ?, ?, ?, ?)
  `).run(runId, missionId, fixture.journey, run.terminalStatus, START, endedAt, START, endedAt);
  database.prepare(`
    INSERT INTO run_evaluations (
      id, mission_id, run_id, journey, scores_json, metrics_json,
      retrospective, evidence_coverage, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'benchmark-fixture', ?)
  `).run(
    evaluationId,
    missionId,
    runId,
    fixture.journey,
    JSON.stringify(run.scores),
    JSON.stringify({ terminalStatus: run.terminalStatus, ...run.metrics }),
    `Synthetic ${phase} evaluation for ${fixture.id}`,
    run.evidenceCoverage,
    endedAt,
  );
  return { runId, evaluationId, endedAt };
}

export function runRepresentativeMissionBenchmarks(
  fixtures: readonly RepresentativeMissionBenchmarkFixture[] = REPRESENTATIVE_MISSION_BENCHMARKS,
): readonly RepresentativeMissionBenchmarkResult[] {
  const database = createDatabaseConnection({ filename: ":memory:", verifyIntegrity: false });
  try {
    migrateDatabase(database);
    return fixtures.map((fixture) => {
      const missionId = seedMission(database, fixture);
      seedEvaluation(database, fixture, missionId, "prior", fixture.prior);
      const current = seedEvaluation(database, fixture, missionId, "current", fixture.current);
      const comparison = new RunComparisonService(database).record({
        evaluationId: current.evaluationId,
        runId: current.runId,
        missionId,
        engagementId: `benchmark-engagement-${fixture.id}`,
        journey: fixture.journey,
        terminalStatus: fixture.current.terminalStatus,
        endedAt: current.endedAt,
        evaluationCreatedAt: current.endedAt,
        scores: fixture.current.scores,
        metrics: fixture.current.metrics,
        evidenceCoverage: fixture.current.evidenceCoverage,
      });
      const movements = new Map(comparison.metrics.map((metric) => [metric.key, metric.movement]));
      const missingFavorableMetrics = fixture.expectedFavorableMetrics.filter(
        (key) => movements.get(key) !== "favorable",
      );
      const unexpectedUnfavorableMetrics = comparison.metrics
        .filter((metric) => metric.movement === "unfavorable")
        .map((metric) => metric.key);
      return {
        fixtureId: fixture.id,
        title: fixture.title,
        journey: fixture.journey,
        comparison,
        expectedFavorableMetrics: fixture.expectedFavorableMetrics,
        missingFavorableMetrics,
        unexpectedUnfavorableMetrics,
        passed: comparison.status === "available"
          && missingFavorableMetrics.length === 0
          && unexpectedUnfavorableMetrics.length === 0,
      };
    });
  } finally {
    database.close();
  }
}

if (import.meta.main) {
  const results = runRepresentativeMissionBenchmarks();
  const failures = results.filter((result) => !result.passed);
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    fixtureKind: "synthetic_isolated_canonical_evaluations",
    measuredAt: new Date().toISOString(),
    results,
    passed: failures.length === 0,
  }, null, 2)}\n`);
  if (failures.length > 0) process.exitCode = 1;
}
