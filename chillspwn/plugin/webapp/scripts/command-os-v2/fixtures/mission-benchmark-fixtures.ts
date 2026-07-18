export interface RepresentativeMissionBenchmarkRun {
  readonly terminalStatus: "completed" | "failed" | "cancelled";
  readonly scores: Readonly<Record<string, number>>;
  readonly metrics: Readonly<Record<string, number | string>>;
  readonly evidenceCoverage: number;
}

export interface RepresentativeMissionBenchmarkFixture {
  readonly id: string;
  readonly title: string;
  readonly journey: "autonomous" | "guided";
  readonly expectedFavorableMetrics: readonly string[];
  readonly prior: RepresentativeMissionBenchmarkRun;
  readonly current: RepresentativeMissionBenchmarkRun;
}

/**
 * Explicitly synthetic, isolated fixtures for regression measurement. They are
 * never loaded by the product or exposed as dashboard data. Values represent
 * canonical evaluation records, not claims about a live mission.
 */
export const REPRESENTATIVE_MISSION_BENCHMARKS: readonly RepresentativeMissionBenchmarkFixture[] = [
  {
    id: "autonomous-bounded-recovery",
    title: "Autonomous bounded recovery and evidence collection",
    journey: "autonomous",
    expectedFavorableMetrics: [
      "objectiveCompletion",
      "evidenceCoverage",
      "policyCompliance",
      "journeyAdherence",
      "durationMs",
      "timeToFirstMeaningfulEvidenceMs",
      "noProgressActionCount",
      "repeatedActionRate",
      "retryRate",
      "recoverySuccessRate",
      "toolCallSuccessRate",
      "providerTokens",
      "estimatedCost",
    ],
    prior: {
      terminalStatus: "failed",
      scores: {
        objectiveCompletion: 0,
        evidenceQuality: 0.5,
        policyCompliance: 0.75,
        journeyAdherence: 0,
      },
      metrics: {
        durationMs: 720_000,
        timeToFirstMeaningfulEvidenceMs: 420_000,
        noProgressActionCount: 4,
        repeatedActionRate: 0.4,
        retryRate: 0.3,
        recoverySuccessRate: 0,
        operatorInterventionCount: 2,
        memoryContextPrecision: 0.5,
        preferenceCorrectionRate: 0.25,
        toolCallSuccessRate: 0.5,
        providerTokens: 1_800,
        estimatedCost: 0.18,
      },
      evidenceCoverage: 0.5,
    },
    current: {
      terminalStatus: "completed",
      scores: {
        objectiveCompletion: 1,
        evidenceQuality: 1,
        policyCompliance: 1,
        journeyAdherence: 1,
      },
      metrics: {
        durationMs: 300_000,
        timeToFirstMeaningfulEvidenceMs: 75_000,
        noProgressActionCount: 0,
        repeatedActionRate: 0,
        retryRate: 0.08,
        recoverySuccessRate: 1,
        operatorInterventionCount: 0,
        memoryContextPrecision: 0.75,
        preferenceCorrectionRate: 0,
        toolCallSuccessRate: 1,
        providerTokens: 900,
        estimatedCost: 0.09,
      },
      evidenceCoverage: 1,
    },
  },
  {
    id: "guided-context-correction",
    title: "Guided exact-step progression with corrected memory context",
    journey: "guided",
    expectedFavorableMetrics: [
      "objectiveCompletion",
      "evidenceCoverage",
      "evidenceQuality",
      "journeyAdherence",
      "durationMs",
      "timeToFirstMeaningfulEvidenceMs",
      "noProgressActionCount",
      "repeatedActionRate",
      "retryRate",
      "memoryContextPrecision",
      "preferenceCorrectionRate",
      "toolCallSuccessRate",
      "providerTokens",
      "estimatedCost",
    ],
    prior: {
      terminalStatus: "failed",
      scores: {
        objectiveCompletion: 0,
        evidenceQuality: 0.4,
        policyCompliance: 1,
        journeyAdherence: 0.5,
      },
      metrics: {
        durationMs: 900_000,
        timeToFirstMeaningfulEvidenceMs: 480_000,
        noProgressActionCount: 3,
        repeatedActionRate: 0.25,
        retryRate: 0.2,
        operatorInterventionCount: 4,
        memoryContextPrecision: 0.4,
        preferenceCorrectionRate: 0.4,
        toolCallSuccessRate: 0.5,
        providerTokens: 1_500,
        estimatedCost: 0.15,
      },
      evidenceCoverage: 0.4,
    },
    current: {
      terminalStatus: "completed",
      scores: {
        objectiveCompletion: 1,
        evidenceQuality: 1,
        policyCompliance: 1,
        journeyAdherence: 1,
      },
      metrics: {
        durationMs: 480_000,
        timeToFirstMeaningfulEvidenceMs: 120_000,
        noProgressActionCount: 0,
        repeatedActionRate: 0,
        retryRate: 0,
        operatorInterventionCount: 4,
        memoryContextPrecision: 1,
        preferenceCorrectionRate: 0,
        toolCallSuccessRate: 1,
        providerTokens: 750,
        estimatedCost: 0.075,
      },
      evidenceCoverage: 1,
    },
  },
] as const;
