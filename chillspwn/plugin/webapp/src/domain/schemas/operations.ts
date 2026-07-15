import type {
  AgentAssignment, AgentCapability, AgentRecord, ArtifactRecord, EvaluationRecord, EventRecord,
  EvaluationComparison, EvaluationComparisonMetric,
  EvidenceRecord, FindingRecord, HealthStatus, LessonRecord, LessonUsageRecord, LogRecord,
  McpRecord, MissionReference, OperationsPage, PolicyRecord, ProviderRecord, RunRecoveryRecord,
} from "../types/operations";
import { array, boolean, nonEmpty, nullableNumber, nullableString, number, object, schema, string } from "./common";

type Parser<T> = (value: unknown) => T;

function mission(value: unknown, label = "mission"): MissionReference {
  const item = object(value, label);
  return { id: nonEmpty(item.id, `${label}.id`), name: nonEmpty(item.name, `${label}.name`) };
}

function page<T>(payload: unknown, parse: Parser<T>): OperationsPage<T> {
  const root = object(payload, "operations page");
  schema(root);
  return {
    schemaVersion: "2.1",
    items: array(root.items, "operations page items").map(parse),
    nextCursor: nullableString(root.nextCursor, "nextCursor"),
  };
}

function health(value: unknown): HealthStatus {
  const item = object(value, "health");
  return {
    ...(typeof item.id === "string" ? { id: item.id } : {}),
    ...(typeof item.componentType === "string" ? { componentType: item.componentType } : {}),
    ...(typeof item.componentId === "string" ? { componentId: item.componentId } : {}),
    status: nonEmpty(item.status, "health.status"),
    metrics: item.metrics ?? {},
    message: nullableString(item.message, "health.message"),
    capturedAt: nonEmpty(item.capturedAt, "health.capturedAt"),
  };
}

function capability(value: unknown): AgentCapability {
  const item = object(value, "agent capability");
  return { name: nonEmpty(item.name, "capability.name"), source: nonEmpty(item.source, "capability.source"), enabled: boolean(item.enabled, "capability.enabled"), metadata: item.metadata ?? {} };
}

export function parseAgent(value: unknown): AgentRecord {
  const item = object(value, "agent");
  const assignment = object(item.assignmentHealth, "agent.assignmentHealth");
  return {
    id: nonEmpty(item.id, "agent.id"), role: nonEmpty(item.role, "agent.role"), displayName: nonEmpty(item.displayName, "agent.displayName"),
    status: nonEmpty(item.status, "agent.status"), version: string(item.version, "agent.version"),
    lastHeartbeatAt: nullableString(item.lastHeartbeatAt, "agent.lastHeartbeatAt"), updatedAt: nonEmpty(item.updatedAt, "agent.updatedAt"),
    providerPolicy: item.providerPolicy ?? {}, toolPolicy: item.toolPolicy ?? {}, configuration: item.configuration ?? {},
    assignmentHealth: {
      queueDepth: number(assignment.queueDepth, "queueDepth"), active: number(assignment.active, "active"),
      completed: number(assignment.completed, "completed"), failed: number(assignment.failed, "failed"),
      successRate: nullableNumber(assignment.successRate, "successRate"), meanCompletionSeconds: nullableNumber(assignment.meanCompletionSeconds, "meanCompletionSeconds"),
      lastAssignmentAt: nullableString(assignment.lastAssignmentAt, "lastAssignmentAt"),
    },
    health: item.health === null || item.health === undefined ? null : health(item.health),
    ...(Array.isArray(item.capabilities) ? { capabilities: item.capabilities.map(capability) } : {}),
    ...(Array.isArray(item.healthHistory) ? { healthHistory: item.healthHistory.map(health) } : {}),
  };
}

export function parseAgents(payload: unknown): OperationsPage<AgentRecord> { return page(payload, parseAgent); }

function parseAssignment(value: unknown): AgentAssignment {
  const item = object(value, "assignment");
  const missionValue = object(item.mission, "assignment.mission");
  const run = object(item.run, "assignment.run");
  const lease = object(item.lease, "assignment.lease");
  const step = item.step === null ? null : object(item.step, "assignment.step");
  const journey = run.journey === "autonomous" || run.journey === "guided" ? run.journey : (() => { throw new Error("assignment journey is invalid"); })();
  return {
    id: nonEmpty(item.id, "assignment.id"), status: nonEmpty(item.status, "assignment.status"),
    mission: { ...mission(missionValue, "assignment.mission"), engagementId: nullableString(missionValue.engagementId, "engagementId") },
    run: { id: nonEmpty(run.id, "run.id"), status: nonEmpty(run.status, "run.status"), journey, progress: nullableNumber(run.progress, "run.progress") },
    step: step ? { id: nonEmpty(step.id, "step.id"), phase: nonEmpty(step.phase, "step.phase"), title: nonEmpty(step.title, "step.title") } : null,
    lease: { owner: nullableString(lease.owner, "lease.owner"), acquiredAt: nullableString(lease.acquiredAt, "lease.acquiredAt"), lastHeartbeatAt: nullableString(lease.lastHeartbeatAt, "lease.lastHeartbeatAt"), expiresAt: nullableString(lease.expiresAt, "lease.expiresAt"), expired: boolean(lease.expired, "lease.expired") },
    startedAt: nullableString(item.startedAt, "startedAt"), endedAt: nullableString(item.endedAt, "endedAt"), updatedAt: nonEmpty(item.updatedAt, "updatedAt"),
  };
}

export function parseAgentAssignments(payload: unknown): OperationsPage<AgentAssignment> { return page(payload, parseAssignment); }

export function parseRunRecovery(payload: unknown): RunRecoveryRecord {
  const root = object(payload, "run recovery"); schema(root);
  const run = object(root.run, "run recovery.run");
  const journey = run.journey === "autonomous" || run.journey === "guided"
    ? run.journey
    : (() => { throw new Error("recovery journey is invalid"); })();
  const detection = object(root.detection, "run recovery.detection");
  const checkpointValue = root.checkpoint === null ? null : object(root.checkpoint, "run recovery.checkpoint");
  const attempts = object(root.attempts, "run recovery.attempts");
  const proposal = object(root.proposedRecovery, "run recovery.proposedRecovery");
  const impact = object(proposal.impact, "run recovery.proposedRecovery.impact");
  const proposalKinds = new Set(["automatic_recovery", "guided_decision", "operator_resume", "safe_stop", "failed_safely", "none"] as const);
  const proposalKind = nonEmpty(proposal.kind, "proposedRecovery.kind") as RunRecoveryRecord["proposedRecovery"]["kind"];
  if (!proposalKinds.has(proposalKind)) throw new Error("proposed recovery kind is invalid");
  const decisionValue = root.guidedDecision === null ? null : object(root.guidedDecision, "run recovery.guidedDecision");
  const actionKinds = new Set(["resume", "replan", "reassign", "change_provider", "terminate"] as const);
  return {
    schemaVersion: "2.1",
    recoveryRequired: boolean(root.recoveryRequired, "recoveryRequired"),
    run: {
      id: nonEmpty(run.id, "run.id"), missionId: nonEmpty(run.missionId, "run.missionId"),
      missionName: nonEmpty(run.missionName, "run.missionName"), journey,
      status: nonEmpty(run.status, "run.status"), statusReason: nullableString(run.statusReason, "run.statusReason"),
      currentStepId: nullableString(run.currentStepId, "run.currentStepId"),
      currentOwnerId: nullableString(run.currentOwnerId, "run.currentOwnerId"),
      nextAction: nullableString(run.nextAction, "run.nextAction"),
      leaseExpiresAt: nullableString(run.leaseExpiresAt, "run.leaseExpiresAt"),
    },
    detection: {
      summary: string(detection.summary, "detection.summary"),
      category: nullableString(detection.category, "detection.category"),
      evidence: array(detection.evidence, "detection.evidence").map((value) => {
        const item = object(value, "detection evidence"); return {
          id: nonEmpty(item.id, "event.id"), eventType: nonEmpty(item.eventType, "event.eventType"),
          summary: string(item.summary, "event.summary"), occurredAt: nonEmpty(item.occurredAt, "event.occurredAt"),
          sequence: number(item.sequence, "event.sequence"),
        };
      }),
      failedActions: array(detection.failedActions, "detection.failedActions").map((value) => {
        const item = object(value, "failed action"); return {
          id: nonEmpty(item.id, "action.id"), status: nonEmpty(item.status, "action.status"),
          intentSummary: string(item.intentSummary, "action.intentSummary"),
          resultSummary: nullableString(item.resultSummary, "action.resultSummary"),
          errorCategory: nullableString(item.errorCategory, "action.errorCategory"),
          retryCount: number(item.retryCount, "action.retryCount"), endedAt: nullableString(item.endedAt, "action.endedAt"),
        };
      }),
    },
    checkpoint: checkpointValue ? {
      id: nonEmpty(checkpointValue.id, "checkpoint.id"),
      eventSequence: number(checkpointValue.eventSequence, "checkpoint.eventSequence"),
      planVersion: nullableNumber(checkpointValue.planVersion, "checkpoint.planVersion"),
      createdAt: nonEmpty(checkpointValue.createdAt, "checkpoint.createdAt"),
      stateHash: nonEmpty(checkpointValue.stateHash, "checkpoint.stateHash"),
      inFlightClassification: nullableString(checkpointValue.inFlightClassification, "checkpoint.inFlightClassification"),
      completedActionCount: number(checkpointValue.completedActionCount, "checkpoint.completedActionCount"),
      inFlightActions: array(checkpointValue.inFlightActions, "checkpoint.inFlightActions").map((value) => {
        const item = object(value, "in-flight action"); return {
          id: nonEmpty(item.id, "in-flight action.id"), status: nonEmpty(item.status, "in-flight action.status"),
          idempotent: boolean(item.idempotent, "in-flight action.idempotent"),
          destructive: boolean(item.destructive, "in-flight action.destructive"),
        };
      }),
    } : null,
    attempts: {
      retryCount: number(attempts.retryCount, "attempts.retryCount"),
      retryLimit: nullableNumber(attempts.retryLimit, "attempts.retryLimit"),
      retriesRemaining: nullableNumber(attempts.retriesRemaining, "attempts.retriesRemaining"),
      replanCount: number(attempts.replanCount, "attempts.replanCount"),
      replanLimit: nullableNumber(attempts.replanLimit, "attempts.replanLimit"),
      replansRemaining: nullableNumber(attempts.replansRemaining, "attempts.replansRemaining"),
    },
    proposedRecovery: {
      kind: proposalKind, summary: string(proposal.summary, "proposedRecovery.summary"),
      basis: string(proposal.basis, "proposedRecovery.basis"),
      impact: {
        time: string(impact.time, "impact.time"), cost: string(impact.cost, "impact.cost"),
        scope: string(impact.scope, "impact.scope"),
      },
    },
    guidedDecision: decisionValue ? {
      id: nonEmpty(decisionValue.id, "guidedDecision.id"), stepId: nonEmpty(decisionValue.stepId, "guidedDecision.stepId"),
      rationale: string(decisionValue.rationale, "guidedDecision.rationale"),
      riskClass: nonEmpty(decisionValue.riskClass, "guidedDecision.riskClass"),
      expiresAt: nonEmpty(decisionValue.expiresAt, "guidedDecision.expiresAt"),
    } : null,
    failedAttemptMemories: array(root.failedAttemptMemories, "failedAttemptMemories").map((value) => {
      const item = object(value, "failed-attempt memory");
      const kind = item.kind === "memory" || item.kind === "lesson" ? item.kind : (() => { throw new Error("failed-attempt memory kind is invalid"); })();
      return { kind, id: nonEmpty(item.id, "memory.id"), title: string(item.title, "memory.title"),
        status: nonEmpty(item.status, "memory.status"), confidence: nullableNumber(item.confidence, "memory.confidence"),
        failureCategory: nullableString(item.failureCategory, "memory.failureCategory") };
    }),
    actions: array(root.actions, "recovery actions").map((value) => {
      const item = object(value, "recovery action");
      const kind = nonEmpty(item.kind, "recovery action.kind") as RunRecoveryRecord["actions"][number]["kind"];
      if (!actionKinds.has(kind)) throw new Error("recovery action kind is invalid");
      const command = item.command === null || item.command === "resume" || item.command === "cancel"
        ? item.command : (() => { throw new Error("recovery action command is invalid"); })();
      return { kind, label: nonEmpty(item.label, "recovery action.label"),
        available: boolean(item.available, "recovery action.available"), reason: string(item.reason, "recovery action.reason"), command };
    }),
  };
}

export function parseEvidence(value: unknown): EvidenceRecord {
  const item = object(value, "evidence");
  return {
    id: nonEmpty(item.id, "evidence.id"), mission: mission(item.mission), runId: nullableString(item.runId, "runId"), stepId: nullableString(item.stepId, "stepId"), actionId: nullableString(item.actionId, "actionId"),
    source: string(item.source, "source"), acquiredAt: nonEmpty(item.acquiredAt, "acquiredAt"), target: nullableString(item.target, "target"), evidenceType: nonEmpty(item.evidenceType, "evidenceType"), contentHash: nonEmpty(item.contentHash, "contentHash"),
    provenance: item.provenance ?? {}, confidence: nullableNumber(item.confidence, "confidence"), sensitivity: nonEmpty(item.sensitivity, "sensitivity"), verificationState: nonEmpty(item.verificationState, "verificationState"),
    summary: string(item.summary, "summary"), hasExtractedText: boolean(item.hasExtractedText, "hasExtractedText"), artifactId: nullableString(item.artifactId, "artifactId"), createdBy: nonEmpty(item.createdBy, "createdBy"), createdAt: nonEmpty(item.createdAt, "createdAt"),
    ...(Array.isArray(item.chainOfCustody) ? { chainOfCustody: item.chainOfCustody.map((entry) => { const chain = object(entry, "chain event"); return { id: nonEmpty(chain.id, "chain.id"), eventType: nonEmpty(chain.eventType, "chain.eventType"), actor: nonEmpty(chain.actor, "chain.actor"), details: chain.details ?? {}, occurredAt: nonEmpty(chain.occurredAt, "chain.occurredAt") }; }) } : {}),
  };
}
export function parseEvidencePage(payload: unknown): OperationsPage<EvidenceRecord> { return page(payload, parseEvidence); }

export function parseFinding(value: unknown): FindingRecord {
  const item = object(value, "finding");
  return {
    id: nonEmpty(item.id, "finding.id"), mission: mission(item.mission), runId: nullableString(item.runId, "runId"), title: nonEmpty(item.title, "title"), severity: nonEmpty(item.severity, "severity"),
    confidence: nullableNumber(item.confidence, "confidence"), affectedScope: string(item.affectedScope, "affectedScope"), description: string(item.description, "description"), impact: string(item.impact, "impact"),
    reproductionNotes: nullableString(item.reproductionNotes, "reproductionNotes"), remediation: nullableString(item.remediation, "remediation"), reviewStatus: nonEmpty(item.reviewStatus, "reviewStatus"), operatorOverride: boolean(item.operatorOverride, "operatorOverride"),
    version: number(item.version, "version"), evidenceCount: number(item.evidenceCount, "evidenceCount"), verifiedEvidenceCount: number(item.verifiedEvidenceCount, "verifiedEvidenceCount"), createdAt: nonEmpty(item.createdAt, "createdAt"), updatedAt: nonEmpty(item.updatedAt, "updatedAt"),
    ...(Array.isArray(item.evidence) ? { evidence: item.evidence.map((entry) => { const link = object(entry, "finding evidence"); return { id: nonEmpty(link.id, "evidence.id"), relationship: nonEmpty(link.relationship, "relationship"), summary: string(link.summary, "summary"), evidenceType: nonEmpty(link.evidenceType, "evidenceType"), verificationState: nonEmpty(link.verificationState, "verificationState"), contentHash: nonEmpty(link.contentHash, "contentHash"), addedAt: nonEmpty(link.addedAt, "addedAt") }; }) } : {}),
  };
}
export function parseFindingPage(payload: unknown): OperationsPage<FindingRecord> { return page(payload, parseFinding); }

export function parseArtifact(value: unknown): ArtifactRecord {
  const item = object(value, "artifact"); const storage = object(item.storage, "artifact.storage");
  const evaluation = item.evaluation === null ? null : object(item.evaluation, "artifact.evaluation");
  const contextPackIds = array(item.contextPackIds ?? [], "artifact.contextPackIds").map((entry, index) => nonEmpty(entry, `artifact.contextPackIds[${index}]`));
  const journey = item.journey === "autonomous" || item.journey === "guided"
    ? item.journey
    : (() => { throw new Error("artifact journey is invalid"); })();
  return {
    id: nonEmpty(item.id, "artifact.id"), mission: mission(item.mission), runId: nullableString(item.runId, "runId"), stepId: nullableString(item.stepId, "stepId"), actionId: nullableString(item.actionId, "actionId"),
    journey,
    artifactType: nonEmpty(item.artifactType, "artifactType"), contentHash: nonEmpty(item.contentHash, "contentHash"), byteSize: number(item.byteSize, "byteSize"), mediaType: nonEmpty(item.mediaType, "mediaType"), sensitivity: nonEmpty(item.sensitivity, "sensitivity"),
    metadata: item.metadata ?? {}, storage: { scheme: nonEmpty(storage.scheme, "storage.scheme"), available: boolean(storage.available, "storage.available") },
    evaluation: evaluation ? { id: nonEmpty(evaluation.id, "evaluation.id"), evidenceCoverage: nullableNumber(evaluation.evidenceCoverage, "evidenceCoverage") } : null, contextPackIds, createdAt: nonEmpty(item.createdAt, "createdAt"),
  };
}
export function parseArtifactPage(payload: unknown): OperationsPage<ArtifactRecord> { return page(payload, parseArtifact); }

export function parseEventPage(payload: unknown): OperationsPage<EventRecord> {
  return page(payload, (value) => { const item = object(value, "event"); const actor = object(item.actor, "event.actor"); const correlation = object(item.correlation, "event.correlation");
    const journey = item.journey === null ? null : item.journey === "autonomous" || item.journey === "guided" ? item.journey : (() => { throw new Error("event journey is invalid"); })();
    return { id: nonEmpty(item.id, "event.id"), occurredAt: nonEmpty(item.occurredAt, "occurredAt"), eventType: nonEmpty(item.eventType, "eventType"), mission: item.mission === null ? null : mission(item.mission), runId: nullableString(item.runId, "runId"), sequence: nullableNumber(item.sequence, "sequence"), actor: { type: nonEmpty(actor.type, "actor.type"), id: nullableString(actor.id, "actor.id") }, summary: string(item.summary, "summary"), payload: item.payload ?? {}, eventSchemaVersion: number(item.schemaVersion, "event.schemaVersion"), journey, correlation: { traceId: nullableString(correlation.traceId, "traceId"), spanId: nullableString(correlation.spanId, "spanId"), contextPackId: nullableString(correlation.contextPackId, "contextPackId") }, sensitivity: nonEmpty(item.sensitivity, "sensitivity"), redaction: item.redaction ?? {} };
  });
}

export function parseLogPage(payload: unknown): OperationsPage<LogRecord> {
  return page(payload, (value) => { const item = object(value, "log"); const correlation = object(item.correlation, "log.correlation"); return { id: nonEmpty(item.id, "log.id"), occurredAt: nonEmpty(item.occurredAt, "occurredAt"), severity: nonEmpty(item.severity, "severity"), domain: nonEmpty(item.domain, "domain"), message: string(item.message, "message"), attributes: item.attributes ?? {}, mission: item.mission === null ? null : mission(item.mission), runId: nullableString(item.runId, "runId"), stepId: nullableString(item.stepId, "stepId"), actionId: nullableString(item.actionId, "actionId"), correlation: { traceId: nullableString(correlation.traceId, "traceId"), spanId: nullableString(correlation.spanId, "spanId") }, sensitivity: nonEmpty(item.sensitivity, "sensitivity") }; });
}

export function parseHealthPage(payload: unknown): OperationsPage<HealthStatus> { return page(payload, health); }

function evaluationComparison(value: unknown): EvaluationComparison {
  const item = object(value, "evaluation comparison");
  const status = item.status === "available" || item.status === "insufficient_data"
    ? item.status
    : (() => { throw new Error("evaluation comparison status is invalid"); })();
  const basis = item.basis === null
    ? null
    : item.basis === "same_mission_and_journey" || item.basis === "same_engagement_and_journey"
      ? item.basis
      : (() => { throw new Error("evaluation comparison basis is invalid"); })();
  const priorValue = item.prior === null ? null : object(item.prior, "evaluation comparison prior");
  const priorStatus = priorValue?.terminalStatus;
  if (priorValue && priorStatus !== "completed" && priorStatus !== "failed" && priorStatus !== "cancelled") {
    throw new Error("evaluation comparison prior terminal status is invalid");
  }
  const metrics = array(item.metrics, "evaluation comparison metrics").map((value, index): EvaluationComparisonMetric => {
    const metric = object(value, `evaluation comparison metrics[${index}]`);
    const unit = metric.unit === "ratio" || metric.unit === "milliseconds" || metric.unit === "count" || metric.unit === "cost"
      ? metric.unit
      : (() => { throw new Error("evaluation comparison metric unit is invalid"); })();
    const favorableDirection = metric.favorableDirection === "higher" || metric.favorableDirection === "lower"
      ? metric.favorableDirection
      : (() => { throw new Error("evaluation comparison metric direction is invalid"); })();
    const movement = metric.movement === "favorable" || metric.movement === "unfavorable" || metric.movement === "unchanged"
      ? metric.movement
      : (() => { throw new Error("evaluation comparison metric movement is invalid"); })();
    return {
      key: nonEmpty(metric.key, "comparison metric key"),
      label: nonEmpty(metric.label, "comparison metric label"),
      unit,
      favorableDirection,
      current: number(metric.current, "comparison metric current"),
      prior: number(metric.prior, "comparison metric prior"),
      delta: number(metric.delta, "comparison metric delta"),
      relativeDelta: nullableNumber(metric.relativeDelta, "comparison metric relativeDelta"),
      movement,
    };
  });
  if (status === "available" && (!basis || !priorValue || metrics.length === 0)) {
    throw new Error("available evaluation comparison is incomplete");
  }
  return {
    status,
    basis,
    reason: nonEmpty(item.reason, "evaluation comparison reason"),
    prior: priorValue ? {
      evaluationId: nonEmpty(priorValue.evaluationId, "prior evaluation ID"),
      runId: nonEmpty(priorValue.runId, "prior run ID"),
      terminalStatus: priorStatus as "completed" | "failed" | "cancelled",
      evaluatedAt: nonEmpty(priorValue.evaluatedAt, "prior evaluatedAt"),
    } : null,
    terminalStatusMatch: item.terminalStatusMatch === null
      ? null
      : boolean(item.terminalStatusMatch, "terminalStatusMatch"),
    metrics,
    summary: string(item.summary, "evaluation comparison summary"),
    createdAt: nonEmpty(item.createdAt, "evaluation comparison createdAt"),
  };
}

export function parseEvaluationPage(payload: unknown): OperationsPage<EvaluationRecord> {
  return page(payload, (value) => { const item = object(value, "evaluation"); const run = object(item.run, "evaluation.run"); const journey = item.journey === "autonomous" || item.journey === "guided" ? item.journey : (() => { throw new Error("evaluation journey invalid"); })(); return { id: nonEmpty(item.id, "evaluation.id"), mission: mission(item.mission), run: { id: nonEmpty(run.id, "run.id"), status: nonEmpty(run.status, "run.status") }, journey, scores: item.scores ?? {}, metrics: item.metrics ?? {}, retrospective: string(item.retrospective, "retrospective"), evidenceCoverage: nullableNumber(item.evidenceCoverage, "evidenceCoverage"), createdBy: nonEmpty(item.createdBy, "createdBy"), createdAt: nonEmpty(item.createdAt, "createdAt"), comparison: evaluationComparison(item.comparison) }; });
}

export function parseLesson(value: unknown): LessonRecord {
  const item = object(value, "lesson"); return { id: nonEmpty(item.id, "lesson.id"), statement: string(item.statement, "statement"), lessonType: nonEmpty(item.lessonType, "lessonType"), applicabilityScope: nonEmpty(item.applicabilityScope, "applicabilityScope"), engagementId: nullableString(item.engagementId, "engagementId"), mission: item.mission === null ? null : mission(item.mission), failureCategory: nullableString(item.failureCategory, "failureCategory"), retryConditions: nullableString(item.retryConditions, "retryConditions"), confidence: nullableNumber(item.confidence, "confidence"), expectedBenefit: string(item.expectedBenefit, "expectedBenefit"), risk: string(item.risk, "risk"), status: nonEmpty(item.status, "status"), authoringAgentId: nullableString(item.authoringAgentId, "authoringAgentId"), reviewedBy: nullableString(item.reviewedBy, "reviewedBy"), reviewedAt: nullableString(item.reviewedAt, "reviewedAt"), expiresAt: nullableString(item.expiresAt, "expiresAt"), supersedesLessonId: nullableString(item.supersedesLessonId, "supersedesLessonId"), evidenceCount: number(item.evidenceCount, "evidenceCount"), supportingEvidenceCount: number(item.supportingEvidenceCount, "supportingEvidenceCount"), usageCount: number(item.usageCount, "usageCount"), createdAt: nonEmpty(item.createdAt, "createdAt"), updatedAt: nonEmpty(item.updatedAt, "updatedAt"), ...(Array.isArray(item.evidence) ? { evidence: item.evidence.map((entry) => { const link = object(entry, "lesson evidence"); return { evidenceId: nullableString(link.evidenceId, "evidenceId"), runId: nullableString(link.runId, "runId"), relationship: nonEmpty(link.relationship, "relationship"), rationale: string(link.rationale, "rationale"), evidenceSummary: nullableString(link.evidenceSummary, "evidenceSummary"), createdAt: nonEmpty(link.createdAt, "createdAt") }; }) } : {}) };
}
export function parseLessonPage(payload: unknown): OperationsPage<LessonRecord> { return page(payload, parseLesson); }

export function parseLessonUsagePage(payload: unknown): OperationsPage<LessonUsageRecord> {
  return page(payload, (value) => { const item = object(value, "lesson usage"); const lesson = object(item.lesson, "usage.lesson"); return { id: nonEmpty(item.id, "usage.id"), lesson: { id: nonEmpty(lesson.id, "lesson.id"), statement: string(lesson.statement, "lesson.statement") }, mission: mission(item.mission), runId: nonEmpty(item.runId, "runId"), stepId: nullableString(item.stepId, "stepId"), actionId: nullableString(item.actionId, "actionId"), contextPackId: nullableString(item.contextPackId, "contextPackId"), influenceSummary: string(item.influenceSummary, "influenceSummary"), outcome: nullableString(item.outcome, "outcome"), measuredImpact: item.measuredImpact ?? {}, usedAt: nonEmpty(item.usedAt, "usedAt") }; });
}

export function parseProviderPage(payload: unknown): OperationsPage<ProviderRecord> {
  return page(payload, (value) => { const item = object(value, "provider"); return { id: nonEmpty(item.id, "provider.id"), provider: nonEmpty(item.provider, "provider"), model: nullableString(item.model, "model"), status: nonEmpty(item.status, "status"), turnCount: number(item.turnCount, "turnCount"), completedCount: number(item.completedCount, "completedCount"), failedCount: number(item.failedCount, "failedCount"), meanLatencyMs: nullableNumber(item.meanLatencyMs, "meanLatencyMs"), inputTokens: number(item.inputTokens, "inputTokens"), outputTokens: number(item.outputTokens, "outputTokens"), estimatedCost: nullableNumber(item.estimatedCost, "estimatedCost"), lastTurnAt: nullableString(item.lastTurnAt, "lastTurnAt") }; });
}
export function parseMcpPage(payload: unknown): OperationsPage<McpRecord> {
  return page(payload, (value) => { const item = object(value, "MCP server"); return { id: nonEmpty(item.id, "mcp.id"), name: nonEmpty(item.name, "name"), transport: nonEmpty(item.transport, "transport"), endpointRedacted: nullableString(item.endpointRedacted, "endpointRedacted"), status: nonEmpty(item.status, "status"), capabilities: item.capabilities ?? [], policy: item.policy ?? {}, lastCheckedAt: nullableString(item.lastCheckedAt, "lastCheckedAt"), updatedAt: nonEmpty(item.updatedAt, "updatedAt") }; });
}
export function parsePolicyPage(payload: unknown): OperationsPage<PolicyRecord> {
  return page(payload, (value) => { const item = object(value, "policy"); return { id: nonEmpty(item.id, "policy.id"), sourceType: nonEmpty(item.sourceType, "sourceType"), label: nonEmpty(item.label, "label"), policy: item.policy ?? {}, sensitivity: nonEmpty(item.sensitivity, "sensitivity"), updatedAt: nonEmpty(item.updatedAt, "updatedAt") }; });
}

export function parseFindingReview(payload: unknown): Record<string, unknown> {
  const root = object(payload, "finding review"); schema(root); const finding = object(root.finding, "finding review result");
  nonEmpty(finding.id, "finding.id"); nonEmpty(finding.reviewStatus, "finding.reviewStatus"); number(finding.version, "finding.version"); number(finding.evidenceCount, "finding.evidenceCount");
  return root;
}

export function parseLessonReview(payload: unknown): Record<string, unknown> {
  const root = object(payload, "lesson review"); schema(root); const lesson = object(root.lesson, "lesson review result");
  nonEmpty(lesson.id, "lesson.id"); nonEmpty(lesson.status, "lesson.status"); number(lesson.supportingEvidenceCount, "lesson.supportingEvidenceCount"); nonEmpty(lesson.updatedAt, "lesson.updatedAt");
  return root;
}
