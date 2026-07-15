import type { Request } from "express";

export const OPERATIONS_SCHEMA_VERSION = "2.1" as const;

export type OperationsSensitivity = "public" | "internal" | "private" | "restricted";

/**
 * Request-scoped authorization supplied by the host application. Operations
 * never infer tenant access from query parameters or record contents.
 */
export interface OperationsAccessPolicy {
  readonly maximumSensitivity: OperationsSensitivity;
  readonly allEngagements?: boolean;
  readonly engagementIds?: readonly string[];
  readonly missionIds?: readonly string[];
  readonly allowUnscopedSystemData?: boolean;
  readonly allowGlobalKnowledge?: boolean;
  readonly canReviewFindings?: boolean;
  readonly canOverrideEvidenceGate?: boolean;
  readonly canReviewLessons?: boolean;
}

export interface OperationsActor {
  readonly id: string;
  readonly type: "operator" | "reviewer" | "admin" | "agent" | "system";
}

export interface OperationsRouterDependencies {
  readonly database: import("../db").SqliteDatabase;
  readonly resolveActor: (request: Request) => OperationsActor;
  readonly resolveAccess: (
    request: Request,
    actor: OperationsActor,
  ) => OperationsAccessPolicy;
  readonly clock?: () => Date;
}

export interface OperationsPage<T> {
  readonly schemaVersion: typeof OPERATIONS_SCHEMA_VERSION;
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface OperationsErrorEnvelope {
  readonly code: string;
  readonly message: string;
  readonly humanMessage: string;
  readonly retryable: boolean;
  readonly category: string;
  readonly details?: unknown;
  readonly traceId: string;
  readonly remediation?: string;
  readonly timestamp: string;
}

export interface OperationsContext {
  readonly actor: OperationsActor;
  readonly access: OperationsAccessPolicy;
}

export interface MissionReference {
  readonly id: string;
  readonly name: string;
  readonly engagementId?: string | null;
}

export interface AgentProjection {
  readonly id: string;
  readonly role: string;
  readonly displayName: string;
  readonly status: "available" | "busy" | "degraded" | "offline" | "quarantined";
  readonly version: string;
  readonly lastHeartbeatAt: string | null;
  readonly updatedAt: string;
  readonly providerPolicy: unknown;
  readonly toolPolicy: unknown;
  readonly configuration: unknown;
  readonly assignmentHealth: {
    readonly queueDepth: number;
    readonly active: number;
    readonly completed: number;
    readonly failed: number;
    readonly successRate: number | null;
    readonly meanCompletionSeconds: number | null;
    readonly lastAssignmentAt: string | null;
  };
  readonly health: unknown;
}

export interface AssignmentProjection {
  readonly id: string;
  readonly status: string;
  readonly mission: MissionReference;
  readonly run: { readonly id: string; readonly status: string; readonly journey: "autonomous" | "guided"; readonly progress: number | null };
  readonly step: { readonly id: string; readonly phase: string; readonly title: string } | null;
  readonly lease: { readonly owner: string | null; readonly acquiredAt: string | null; readonly lastHeartbeatAt: string | null; readonly expiresAt: string | null; readonly expired: boolean };
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly updatedAt: string;
}

export type RecoveryActionKind = "resume" | "replan" | "reassign" | "change_provider" | "terminate";

export interface RecoveryActionAvailability {
  readonly kind: RecoveryActionKind;
  readonly label: string;
  readonly available: boolean;
  readonly reason: string;
  /** The only public runtime commands currently supported by this projection. */
  readonly command: "resume" | "cancel" | null;
}

export interface RunRecoveryProjection {
  readonly schemaVersion: typeof OPERATIONS_SCHEMA_VERSION;
  readonly recoveryRequired: boolean;
  readonly run: {
    readonly id: string;
    readonly missionId: string;
    readonly missionName: string;
    readonly journey: "autonomous" | "guided";
    readonly status: string;
    readonly statusReason: string | null;
    readonly currentStepId: string | null;
    readonly currentOwnerId: string | null;
    readonly nextAction: string | null;
    readonly leaseExpiresAt: string | null;
  };
  readonly detection: {
    readonly summary: string;
    readonly category: string | null;
    readonly evidence: readonly {
      readonly id: string;
      readonly eventType: string;
      readonly summary: string;
      readonly occurredAt: string;
      readonly sequence: number;
    }[];
    readonly failedActions: readonly {
      readonly id: string;
      readonly status: string;
      readonly intentSummary: string;
      readonly resultSummary: string | null;
      readonly errorCategory: string | null;
      readonly retryCount: number;
      readonly endedAt: string | null;
    }[];
  };
  readonly checkpoint: {
    readonly id: string;
    readonly eventSequence: number;
    readonly planVersion: number | null;
    readonly createdAt: string;
    readonly stateHash: string;
    readonly inFlightClassification: string | null;
    readonly completedActionCount: number;
    readonly inFlightActions: readonly {
      readonly id: string;
      readonly status: string;
      readonly idempotent: boolean;
      readonly destructive: boolean;
    }[];
  } | null;
  readonly attempts: {
    readonly retryCount: number;
    readonly retryLimit: number | null;
    readonly retriesRemaining: number | null;
    readonly replanCount: number;
    readonly replanLimit: number | null;
    readonly replansRemaining: number | null;
  };
  readonly proposedRecovery: {
    readonly kind: "automatic_recovery" | "guided_decision" | "operator_resume" | "safe_stop" | "failed_safely" | "none";
    readonly summary: string;
    readonly basis: string;
    readonly impact: {
      readonly time: string;
      readonly cost: string;
      readonly scope: string;
    };
  };
  readonly guidedDecision: {
    readonly id: string;
    readonly stepId: string;
    readonly rationale: string;
    readonly riskClass: string;
    readonly expiresAt: string;
  } | null;
  readonly failedAttemptMemories: readonly {
    readonly kind: "memory" | "lesson";
    readonly id: string;
    readonly title: string;
    readonly status: string;
    readonly confidence: number | null;
    readonly failureCategory: string | null;
  }[];
  readonly actions: readonly RecoveryActionAvailability[];
}

export interface EvidenceProjection {
  readonly id: string;
  readonly mission: MissionReference;
  readonly runId: string | null;
  readonly stepId: string | null;
  readonly actionId: string | null;
  readonly source: unknown;
  readonly acquiredAt: string;
  readonly target: string | null;
  readonly evidenceType: string;
  readonly contentHash: string;
  readonly provenance: unknown;
  readonly confidence: number | null;
  readonly sensitivity: OperationsSensitivity;
  readonly verificationState: "unverified" | "verified" | "disputed" | "rejected";
  readonly summary: unknown;
  readonly hasExtractedText: boolean;
  readonly artifactId: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface FindingProjection {
  readonly id: string;
  readonly mission: MissionReference;
  readonly runId: string | null;
  readonly title: unknown;
  readonly severity: "informational" | "low" | "medium" | "high" | "critical";
  readonly confidence: number | null;
  readonly affectedScope: unknown;
  readonly description: unknown;
  readonly impact: unknown;
  readonly reproductionNotes: unknown | null;
  readonly remediation: unknown | null;
  readonly reviewStatus: "draft" | "under_review" | "verified" | "rejected" | "accepted_risk";
  readonly operatorOverride: boolean;
  readonly version: number;
  readonly evidenceCount: number;
  readonly verifiedEvidenceCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ArtifactProjection {
  readonly id: string;
  readonly mission: MissionReference;
  readonly runId: string | null;
  readonly stepId: string | null;
  readonly actionId: string | null;
  readonly journey: "autonomous" | "guided";
  readonly artifactType: string;
  readonly contentHash: string;
  readonly byteSize: number;
  readonly mediaType: string | null;
  readonly sensitivity: OperationsSensitivity;
  readonly metadata: unknown;
  /** Raw storage paths and signed URLs are deliberately never returned. */
  readonly storage: { readonly scheme: string; readonly available: boolean };
  readonly evaluation: { readonly id: string; readonly evidenceCoverage: number | null } | null;
  /** Persisted memory context directly linked through the producing action. */
  readonly contextPackIds: readonly string[];
  readonly createdAt: string;
}

export interface EventProjection {
  readonly id: string;
  readonly occurredAt: string;
  readonly eventType: string;
  readonly mission: MissionReference | null;
  readonly runId: string | null;
  readonly sequence: number | null;
  readonly actor: { readonly type: string; readonly id: string | null };
  readonly summary: unknown;
  readonly payload: unknown;
  readonly schemaVersion: number;
  readonly journey: "autonomous" | "guided";
  readonly correlation: { readonly traceId: string | null; readonly spanId: string | null; readonly contextPackId: string | null };
  readonly sensitivity: OperationsSensitivity;
  readonly redaction: unknown;
}

export interface LogProjection {
  readonly id: string;
  readonly occurredAt: string;
  readonly severity: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  readonly domain: string;
  readonly message: unknown;
  readonly attributes: unknown;
  readonly mission: MissionReference | null;
  readonly runId: string | null;
  readonly stepId: string | null;
  readonly actionId: string | null;
  readonly correlation: { readonly traceId: string | null; readonly spanId: string | null };
  readonly sensitivity: OperationsSensitivity;
}

export interface HealthProjection {
  readonly id: string;
  readonly componentType: string;
  readonly componentId: string;
  readonly status: "healthy" | "degraded" | "unhealthy" | "unknown";
  readonly metrics: unknown;
  readonly message: unknown | null;
  readonly capturedAt: string;
}

export interface EvaluationProjection {
  readonly id: string;
  readonly mission: MissionReference;
  readonly run: { readonly id: string; readonly status: string };
  readonly journey: "autonomous" | "guided";
  readonly scores: unknown;
  readonly metrics: unknown;
  readonly retrospective: unknown;
  readonly evidenceCoverage: number | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly comparison: EvaluationComparisonProjection;
}

export interface EvaluationComparisonMetricProjection {
  readonly key: string;
  readonly label: string;
  readonly unit: "ratio" | "milliseconds" | "count" | "cost";
  readonly favorableDirection: "higher" | "lower";
  readonly current: number;
  readonly prior: number;
  readonly delta: number;
  readonly relativeDelta: number | null;
  readonly movement: "favorable" | "unfavorable" | "unchanged";
}

export interface EvaluationComparisonProjection {
  readonly status: "available" | "insufficient_data";
  readonly basis: "same_mission_and_journey" | "same_engagement_and_journey" | null;
  readonly reason: string;
  readonly prior: {
    readonly evaluationId: string;
    readonly runId: string;
    readonly terminalStatus: "completed" | "failed" | "cancelled";
    readonly evaluatedAt: string;
  } | null;
  readonly terminalStatusMatch: boolean | null;
  readonly metrics: readonly EvaluationComparisonMetricProjection[];
  readonly summary: unknown;
  readonly createdAt: string;
}

export interface LessonProjection {
  readonly id: string;
  readonly statement: unknown;
  readonly lessonType: string;
  readonly applicabilityScope: string;
  readonly engagementId: string | null;
  readonly mission: MissionReference | null;
  readonly failureCategory: string | null;
  readonly retryConditions: unknown | null;
  readonly confidence: number | null;
  readonly expectedBenefit: unknown;
  readonly risk: unknown;
  readonly status: "proposed" | "under_review" | "verified" | "rejected" | "stale" | "superseded";
  readonly authoringAgentId: string | null;
  readonly reviewedBy: string | null;
  readonly reviewedAt: string | null;
  readonly expiresAt: string | null;
  readonly supersedesLessonId: string | null;
  readonly evidenceCount: number;
  readonly supportingEvidenceCount: number;
  readonly usageCount: number;
  readonly attackChainDetails: {
    readonly available: boolean;
    readonly latestVersion: number | null;
  };
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LessonUsageProjection {
  readonly id: string;
  readonly lesson: { readonly id: string; readonly statement: unknown };
  readonly mission: MissionReference;
  readonly runId: string;
  readonly stepId: string | null;
  readonly actionId: string | null;
  readonly contextPackId: string | null;
  readonly influenceSummary: unknown;
  readonly outcome: unknown | null;
  readonly measuredImpact: unknown;
  readonly usedAt: string;
}

export interface ProviderProjection {
  readonly id: string;
  readonly provider: string;
  readonly model: string | null;
  readonly status: "operational" | "degraded";
  readonly turnCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly meanLatencyMs: number | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCost: number | null;
  readonly lastTurnAt: string;
}

export interface McpProjection {
  readonly id: string;
  readonly name: string;
  readonly transport: string;
  readonly endpointRedacted: unknown | null;
  readonly status: "unknown" | "healthy" | "degraded" | "offline" | "quarantined";
  readonly capabilities: unknown;
  readonly policy: unknown;
  readonly lastCheckedAt: string | null;
  readonly updatedAt: string;
}

export interface PolicyProjection {
  readonly id: string;
  readonly sourceType: "agent" | "mcp" | "setting";
  readonly label: string;
  readonly policy: unknown;
  readonly sensitivity: OperationsSensitivity;
  readonly updatedAt: string;
}

export interface RunCompletionExport {
  readonly schemaVersion: typeof OPERATIONS_SCHEMA_VERSION;
  readonly exportKind: "run_completion_metadata";
  readonly generatedAt: string;
  readonly mission: {
    readonly id: string;
    readonly name: string;
    readonly objective: unknown;
    readonly engagementId: string | null;
    readonly journey: "autonomous" | "guided";
    readonly authorizationStatus: string;
    readonly successCriteria: unknown;
  };
  readonly run: {
    readonly id: string;
    readonly journey: "autonomous" | "guided";
    readonly status: string;
    readonly statusReason: unknown | null;
    readonly progress: number | null;
    readonly retryCount: number;
    readonly replanCount: number;
    readonly startedAt: string | null;
    readonly endedAt: string | null;
    readonly budgetUsage: unknown;
  };
  readonly evaluation: readonly EvaluationProjection[];
  readonly evidence: readonly {
    readonly id: string;
    readonly acquiredAt: string;
    readonly target: string | null;
    readonly evidenceType: string;
    readonly contentHash: string;
    readonly confidence: number | null;
    readonly sensitivity: OperationsSensitivity;
    readonly verificationState: string;
    readonly summary: unknown;
    readonly artifactId: string | null;
  }[];
  readonly findings: readonly {
    readonly id: string;
    readonly title: unknown;
    readonly severity: string;
    readonly confidence: number | null;
    readonly affectedScope: unknown;
    readonly reviewStatus: string;
    readonly evidenceCount: number;
    readonly verifiedEvidenceCount: number;
    readonly updatedAt: string;
  }[];
  readonly artifacts: readonly {
    readonly id: string;
    readonly artifactType: string;
    readonly contentHash: string;
    readonly byteSize: number;
    readonly mediaType: string | null;
    readonly sensitivity: OperationsSensitivity;
    readonly storageScheme: string;
    readonly createdAt: string;
  }[];
  readonly reports: readonly {
    readonly id: string;
    readonly artifactType: string;
    readonly contentHash: string;
    readonly byteSize: number;
    readonly mediaType: string | null;
    readonly sensitivity: OperationsSensitivity;
    readonly storageScheme: string;
    readonly createdAt: string;
  }[];
  readonly events: readonly {
    readonly id: string;
    readonly occurredAt: string;
    readonly eventType: string;
    readonly sequence: number | null;
    readonly summary: unknown;
    readonly contextPackId: string | null;
  }[];
  readonly actions: readonly {
    readonly id: string;
    readonly stepId: string | null;
    readonly actionType: string;
    readonly actionClass: string;
    readonly status: string;
    readonly intentSummary: unknown;
    readonly resultSummary: unknown | null;
    readonly errorCategory: string | null;
    readonly retryCount: number;
    readonly contextPackId: string | null;
    readonly startedAt: string | null;
    readonly endedAt: string | null;
  }[];
  readonly decisions: readonly {
    readonly id: string;
    readonly decisionType: "guided" | "administrative";
    readonly status: string;
    readonly reason: unknown;
    readonly policyRule: string | null;
    readonly createdAt: string;
    readonly decidedAt: string | null;
  }[];
  readonly memoryContext: readonly {
    readonly id: string;
    readonly purpose: unknown;
    readonly usedItems: number;
    readonly retrievedItems: number;
    readonly correctedItems: number;
    readonly createdAt: string;
  }[];
  readonly lessons: {
    readonly proposedOrVerified: readonly LessonProjection[];
    readonly reused: readonly LessonUsageProjection[];
  };
  readonly unresolvedItems: readonly {
    readonly type: "step" | "finding" | "decision";
    readonly id: string;
    readonly status: string;
    readonly summary: unknown;
  }[];
  readonly truncation: Readonly<Record<string, boolean>>;
  readonly privacy: {
    readonly metadataOnly: true;
    readonly omitted: readonly string[];
  };
  readonly integrity: {
    readonly algorithm: "sha256";
    readonly digest: string;
  };
}
