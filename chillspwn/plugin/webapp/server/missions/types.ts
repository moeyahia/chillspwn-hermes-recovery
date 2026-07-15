import type { JsonValue, Journey } from "../events";

export type { Journey };

export type RunStatus =
  | "queued"
  | "planning"
  | "awaiting_contract_confirmation"
  | "running"
  | "waiting_guided_decision"
  | "blocked"
  | "recovering"
  | "completed"
  | "failed"
  | "cancelled";

export interface AutonomousMissionRequest {
  readonly journey: "autonomous";
  readonly launch: true;
  readonly title: string;
  readonly objective: string;
  readonly successCriteria: readonly string[];
  readonly authorization: {
    readonly engagementId?: string;
    readonly allowedTargets: readonly string[];
    readonly prohibitedTargets: readonly string[];
    readonly authorizationConfirmed: true;
    readonly timeWindow?: string;
    readonly dataHandling?: string;
  };
  readonly contract: {
    readonly allowedActionClasses: readonly string[];
    readonly prohibitedActionClasses: readonly string[];
    readonly destructivePolicy: string;
    readonly evidenceRequirements: readonly string[];
    readonly timeBudgetMinutes: number;
    readonly tokenBudget?: number;
    readonly costBudget?: number;
    readonly retryBudget: number;
    readonly replanBudget: number;
    readonly concurrencyLimit: number;
    /** Canonical evidence byte ceiling enforced by the run supervisor. */
    readonly evidenceStorageBudgetBytes: number;
    /** Canonical artifact byte ceiling enforced by the run supervisor. */
    readonly artifactStorageBudgetBytes: number;
    /** Only in-product semantic events are currently an enforceable notification channel. */
    readonly notificationPolicy: "in_app_only";
    /** The terminal, scope-checked Command OS completion bundle. */
    readonly reportingFormat: "command_os_json";
    /** Canonical evidence/artifacts stay in the local private data plane. */
    readonly dataHandlingPolicy: "local_private";
    /** Retention remains explicit and operator-controlled until an expiry worker is available. */
    readonly retentionPolicy: "operator_managed";
    /** Provider selection is automatic and restricted to enforcing provider paths. */
    readonly providerPolicy: "automatic_enforcing_only";
    /** Every tool action must match the signed action-class and target allowlist. */
    readonly toolPolicy: "contract_allowlist";
    readonly memoryScopes: readonly string[];
    /** Exact, operator-selected memory nodes; no broader memory may be retrieved. */
    readonly contextNodeIds: readonly string[];
    readonly safeStopConditions: readonly string[];
    readonly deliverables: readonly string[];
  };
  /** Optional for API compatibility. The current UI always submits the server-issued review. */
  readonly contractReview?: {
    readonly version: 1;
    readonly hash: string;
  };
}

export interface AutonomousContextCandidate {
  readonly id: string;
  readonly nodeType: "preference" | "lesson";
  readonly title: string;
  readonly summary: string;
  readonly lifecycleStatus: "confirmed" | "verified";
  readonly scope: {
    readonly kind: "global" | "engagement";
    readonly engagementId?: string;
  };
  readonly sensitivity: "public" | "internal" | "private";
  readonly confidence: number;
  readonly provenanceExplanation: string;
  readonly updatedAt: string;
}

export interface AutonomousMissionPreflight {
  readonly schemaVersion: "2.1";
  readonly contract: {
    readonly version: 1;
    readonly hash: string;
  };
  readonly readiness: ReadinessSummary;
  readonly context: {
    readonly candidates: readonly AutonomousContextCandidate[];
    readonly selectedNodeIds: readonly string[];
    readonly invalidSelectedNodeIds: readonly string[];
  };
  readonly policySummary: {
    readonly provider: string;
    readonly tools: string;
    readonly notifications: string;
    readonly reporting: string;
    readonly retention: string;
    readonly storage: string;
  };
}

export interface GuidedMissionRequest {
  readonly journey: "guided";
  readonly launch: true;
  readonly authorizationConfirmed: true;
  readonly title: string;
  readonly objective: string;
  readonly target?: string;
  readonly engagementId?: string;
  readonly explanationDepth: "concise" | "balanced" | "deep";
  readonly executionPreference: "manual" | "single_step_agent";
  readonly evidenceExpectations: readonly string[];
}

export type MissionCreateRequest =
  | AutonomousMissionRequest
  | GuidedMissionRequest;

export interface MissionRecord {
  readonly id: string;
  readonly title: string;
  readonly journey: Journey;
  readonly status: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreatedMission {
  readonly mission: MissionRecord;
  readonly run: {
    readonly id: string;
    readonly status: RunStatus;
    readonly journey: Journey;
  };
  readonly nextUrl: string;
}

export type ReadinessCheckStatus = "pass" | "warn" | "fail";

export interface ReadinessCheck {
  readonly id: string;
  readonly label: string;
  readonly status: ReadinessCheckStatus;
  readonly impact: string;
  readonly journeys: readonly Journey[];
  readonly remediation?: string;
}

export interface ReadinessSummary {
  readonly status: "ready" | "degraded" | "blocked";
  readonly score: number;
  readonly checks: readonly ReadinessCheck[];
}

export interface ReadinessContext {
  readonly journey?: Journey;
  readonly request?: MissionCreateRequest;
}

export interface ReadinessCheckProvider {
  readonly id: string;
  readonly label: string;
  readonly journeys: readonly Journey[];
  evaluate(
    context: ReadinessContext,
  ): ReadinessCheck | readonly ReadinessCheck[] | Promise<ReadinessCheck | readonly ReadinessCheck[]>;
}

export interface MissionSummary {
  readonly id: string;
  readonly title: string;
  readonly journey: Journey;
  readonly status: string;
  readonly updatedAt: string;
  readonly currentPhase?: string;
  readonly progress?: number;
  readonly nextAction?: string;
}

export interface AttentionItem {
  readonly id: string;
  readonly type: string;
  readonly severity: string;
  readonly title: string;
  readonly summary: string;
  readonly missionId?: string;
  readonly runId?: string;
}

export interface AgentSummary {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly assignment?: string;
}

export interface OverviewSnapshot {
  readonly schemaVersion: "2.1";
  readonly readiness: ReadinessSummary;
  readonly summary: {
    readonly activeMissions: number;
    readonly activeAgents: number;
    readonly pendingDecisions: number;
    readonly recoveringRuns: number;
    readonly lastEventAt: string | null;
  };
  readonly missions: readonly MissionSummary[];
  readonly attention: readonly AttentionItem[];
  readonly agents: readonly AgentSummary[];
  readonly brain: {
    readonly confirmed: number;
    readonly candidates: number;
    readonly stale: number;
    readonly conflicts: number;
    readonly vaultStatus: string;
  };
  readonly system: {
    readonly database: string;
    readonly eventStream: string;
    readonly providers: string;
    readonly mcp: string;
  };
}

export interface MissionListPage {
  readonly schemaVersion: "2.1";
  readonly items: readonly MissionSummary[];
  readonly nextCursor: string | null;
}

export interface ApiErrorEnvelope {
  readonly code: string;
  readonly message: string;
  readonly humanMessage: string;
  readonly retryable: boolean;
  readonly category: string;
  readonly details?: JsonValue;
  readonly traceId: string;
  readonly remediation?: string;
  readonly timestamp: string;
}
