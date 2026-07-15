export type OperationsStatus =
  | "available" | "busy" | "degraded" | "offline" | "quarantined"
  | "healthy" | "unhealthy" | "unknown" | "operational";

export interface OperationsPage<T> {
  schemaVersion: "2.1";
  items: T[];
  nextCursor: string | null;
}

export interface MissionReference { id: string; name: string }
export interface Correlation { traceId: string | null; spanId: string | null; contextPackId?: string | null }

export interface AgentRecord {
  id: string;
  role: string;
  displayName: string;
  status: string;
  version: string;
  lastHeartbeatAt: string | null;
  updatedAt: string;
  providerPolicy: unknown;
  toolPolicy: unknown;
  configuration: unknown;
  assignmentHealth: {
    queueDepth: number; active: number; completed: number; failed: number;
    successRate: number | null; meanCompletionSeconds: number | null; lastAssignmentAt: string | null;
  };
  health: HealthStatus | null;
  capabilities?: AgentCapability[];
  healthHistory?: HealthStatus[];
}

export interface AgentCapability { name: string; source: string; enabled: boolean; metadata: unknown }
export interface AgentAssignment {
  id: string; status: string; mission: MissionReference & { engagementId: string | null };
  run: { id: string; status: string; journey: "autonomous" | "guided"; progress: number | null };
  step: { id: string; phase: string; title: string } | null;
  lease: { owner: string | null; acquiredAt: string | null; lastHeartbeatAt: string | null; expiresAt: string | null; expired: boolean };
  startedAt: string | null; endedAt: string | null; updatedAt: string;
}

export type RecoveryActionKind = "resume" | "replan" | "reassign" | "change_provider" | "terminate";
export interface RecoveryActionAvailability {
  kind: RecoveryActionKind; label: string; available: boolean; reason: string; command: "resume" | "cancel" | null;
}
export interface RunRecoveryRecord {
  schemaVersion: "2.1";
  recoveryRequired: boolean;
  run: {
    id: string; missionId: string; missionName: string; journey: "autonomous" | "guided"; status: string;
    statusReason: string | null; currentStepId: string | null; currentOwnerId: string | null;
    nextAction: string | null; leaseExpiresAt: string | null;
  };
  detection: {
    summary: string; category: string | null;
    evidence: Array<{ id: string; eventType: string; summary: string; occurredAt: string; sequence: number }>;
    failedActions: Array<{
      id: string; status: string; intentSummary: string; resultSummary: string | null;
      errorCategory: string | null; retryCount: number; endedAt: string | null;
    }>;
  };
  checkpoint: {
    id: string; eventSequence: number; planVersion: number | null; createdAt: string; stateHash: string;
    inFlightClassification: string | null; completedActionCount: number;
    inFlightActions: Array<{ id: string; status: string; idempotent: boolean; destructive: boolean }>;
  } | null;
  attempts: {
    retryCount: number; retryLimit: number | null; retriesRemaining: number | null;
    replanCount: number; replanLimit: number | null; replansRemaining: number | null;
  };
  proposedRecovery: {
    kind: "automatic_recovery" | "guided_decision" | "operator_resume" | "safe_stop" | "failed_safely" | "none";
    summary: string; basis: string; impact: { time: string; cost: string; scope: string };
  };
  guidedDecision: { id: string; stepId: string; rationale: string; riskClass: string; expiresAt: string } | null;
  failedAttemptMemories: Array<{
    kind: "memory" | "lesson"; id: string; title: string; status: string;
    confidence: number | null; failureCategory: string | null;
  }>;
  actions: RecoveryActionAvailability[];
}

export interface EvidenceRecord {
  id: string; mission: MissionReference; runId: string | null; stepId: string | null; actionId: string | null;
  source: string; acquiredAt: string; target: string | null; evidenceType: string; contentHash: string;
  provenance: unknown; confidence: number | null; sensitivity: string; verificationState: string;
  summary: string; hasExtractedText: boolean; artifactId: string | null; createdBy: string; createdAt: string;
  chainOfCustody?: Array<{ id: string; eventType: string; actor: string; details: unknown; occurredAt: string }>;
}

export interface FindingRecord {
  id: string; mission: MissionReference; runId: string | null; title: string; severity: string;
  confidence: number | null; affectedScope: string; description: string; impact: string;
  reproductionNotes: string | null; remediation: string | null; reviewStatus: string; operatorOverride: boolean;
  version: number; evidenceCount: number; verifiedEvidenceCount: number; createdAt: string; updatedAt: string;
  evidence?: Array<{ id: string; relationship: string; summary: string; evidenceType: string; verificationState: string; contentHash: string; addedAt: string }>;
}

export interface ArtifactRecord {
  id: string; mission: MissionReference; runId: string | null; stepId: string | null; actionId: string | null;
  journey: "autonomous" | "guided";
  artifactType: string; contentHash: string; byteSize: number; mediaType: string; sensitivity: string;
  metadata: unknown; storage: { scheme: string; available: boolean };
  evaluation: { id: string; evidenceCoverage: number | null } | null; contextPackIds: string[]; createdAt: string;
}

export interface EventRecord {
  id: string; occurredAt: string; eventType: string; mission: MissionReference | null; runId: string | null;
  sequence: number | null; actor: { type: string; id: string | null }; summary: string; payload: unknown;
  eventSchemaVersion: number; journey: "autonomous" | "guided" | null; correlation: Correlation;
  sensitivity: string; redaction: unknown;
}

export interface LogRecord {
  id: string; occurredAt: string; severity: string; domain: string; message: string; attributes: unknown;
  mission: MissionReference | null; runId: string | null; stepId: string | null; actionId: string | null;
  correlation: Correlation; sensitivity: string;
}

export interface HealthStatus {
  id?: string; componentType?: string; componentId?: string; status: string; metrics: unknown;
  message: string | null; capturedAt: string;
}

export interface EvaluationRecord {
  id: string; mission: MissionReference; run: { id: string; status: string }; journey: "autonomous" | "guided";
  scores: unknown; metrics: unknown; retrospective: string; evidenceCoverage: number | null; createdBy: string; createdAt: string;
  comparison: EvaluationComparison;
}

export interface EvaluationComparisonMetric {
  key: string; label: string; unit: "ratio" | "milliseconds" | "count" | "cost";
  favorableDirection: "higher" | "lower"; current: number; prior: number; delta: number;
  relativeDelta: number | null; movement: "favorable" | "unfavorable" | "unchanged";
}

export interface EvaluationComparison {
  status: "available" | "insufficient_data";
  basis: "same_mission_and_journey" | "same_engagement_and_journey" | null;
  reason: string;
  prior: { evaluationId: string; runId: string; terminalStatus: "completed" | "failed" | "cancelled"; evaluatedAt: string } | null;
  terminalStatusMatch: boolean | null;
  metrics: EvaluationComparisonMetric[];
  summary: string;
  createdAt: string;
}

export interface LessonRecord {
  id: string; statement: string; lessonType: string; applicabilityScope: string; engagementId: string | null;
  mission: MissionReference | null; failureCategory: string | null; retryConditions: string | null; confidence: number | null;
  expectedBenefit: string; risk: string; status: string; authoringAgentId: string | null; reviewedBy: string | null;
  reviewedAt: string | null; expiresAt: string | null; supersedesLessonId: string | null; evidenceCount: number;
  supportingEvidenceCount: number; usageCount: number; createdAt: string; updatedAt: string;
  evidence?: Array<{ evidenceId: string | null; runId: string | null; relationship: string; rationale: string; evidenceSummary: string | null; createdAt: string }>;
}

export interface LessonUsageRecord {
  id: string; lesson: { id: string; statement: string }; mission: MissionReference; runId: string;
  stepId: string | null; actionId: string | null; contextPackId: string | null; influenceSummary: string;
  outcome: string | null; measuredImpact: unknown; usedAt: string;
}

export interface ProviderRecord {
  id: string; provider: string; model: string | null; status: string; turnCount: number; completedCount: number;
  failedCount: number; meanLatencyMs: number | null; inputTokens: number; outputTokens: number;
  estimatedCost: number | null; lastTurnAt: string | null;
}

export interface McpRecord {
  id: string; name: string; transport: string; endpointRedacted: string | null; status: string;
  capabilities: unknown; policy: unknown; lastCheckedAt: string | null; updatedAt: string;
}

export interface PolicyRecord {
  id: string; sourceType: string; label: string; policy: unknown; sensitivity: string; updatedAt: string;
}
