export type Journey = "autonomous" | "guided";

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

export interface ReadinessCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  impact: string;
  journeys: Journey[];
  remediation?: string;
}

export interface ReadinessSummary {
  status: "ready" | "degraded" | "blocked";
  score: number;
  checks: ReadinessCheck[];
}

export interface MissionSummary {
  id: string;
  title: string;
  journey: Journey;
  status: string;
  updatedAt: string;
  currentPhase?: string;
  progress?: number;
  nextAction?: string;
}

export interface AttentionItem {
  id: string;
  type: string;
  severity: string;
  title: string;
  summary: string;
  missionId?: string;
  runId?: string;
}

export interface AgentSummary {
  id: string;
  name: string;
  status: string;
  assignment?: string;
}

export interface OverviewSnapshot {
  schemaVersion: "2.1";
  readiness: ReadinessSummary;
  summary: {
    activeMissions: number;
    activeAgents: number;
    pendingDecisions: number;
    recoveringRuns: number;
    lastEventAt: string | null;
  };
  missions: MissionSummary[];
  attention: AttentionItem[];
  agents: AgentSummary[];
  brain: {
    confirmed: number;
    candidates: number;
    stale: number;
    conflicts: number;
    vaultStatus: string;
  };
  system: {
    database: string;
    eventStream: string;
    providers: string;
    mcp: string;
  };
}

export interface MissionRecord {
  id: string;
  title: string;
  journey: Journey;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface MissionPage {
  schemaVersion: "2.1";
  items: MissionSummary[];
  nextCursor: string | null;
}

export interface CreatedMission {
  mission: MissionRecord;
  run: {
    id: string;
    status: RunStatus;
    journey: Journey;
  };
  nextUrl: string;
}

export interface AutonomousMissionRequest {
  journey: "autonomous";
  launch: true;
  title: string;
  objective: string;
  successCriteria: string[];
  authorization: {
    engagementId?: string;
    allowedTargets: string[];
    prohibitedTargets: string[];
    authorizationConfirmed: boolean;
    timeWindow?: string;
    dataHandling?: string;
  };
  contract: {
    allowedActionClasses: string[];
    prohibitedActionClasses: string[];
    destructivePolicy: string;
    evidenceRequirements: string[];
    timeBudgetMinutes: number;
    tokenBudget?: number;
    costBudget?: number;
    retryBudget: number;
    replanBudget: number;
    concurrencyLimit: number;
    evidenceStorageBudgetBytes: number;
    artifactStorageBudgetBytes: number;
    notificationPolicy: "in_app_only";
    reportingFormat: "command_os_json";
    dataHandlingPolicy: "local_private";
    retentionPolicy: "operator_managed";
    providerPolicy: "automatic_enforcing_only";
    toolPolicy: "contract_allowlist";
    memoryScopes: string[];
    contextNodeIds: string[];
    safeStopConditions: string[];
    deliverables: string[];
  };
  contractReview?: { version: 1; hash: string };
}

export interface AutonomousContextCandidate {
  id: string;
  nodeType: "preference" | "lesson";
  title: string;
  summary: string;
  lifecycleStatus: "confirmed" | "verified";
  scope: { kind: "global" | "engagement"; engagementId?: string };
  sensitivity: "public" | "internal" | "private";
  confidence: number;
  provenanceExplanation: string;
  updatedAt: string;
}

export interface AutonomousMissionPreflight {
  schemaVersion: "2.1";
  contract: { version: 1; hash: string };
  readiness: ReadinessSummary;
  context: {
    candidates: AutonomousContextCandidate[];
    selectedNodeIds: string[];
    invalidSelectedNodeIds: string[];
  };
  policySummary: {
    provider: string;
    tools: string;
    notifications: string;
    reporting: string;
    retention: string;
    storage: string;
  };
}

export interface GuidedMissionRequest {
  journey: "guided";
  launch: true;
  authorizationConfirmed: true;
  title: string;
  objective: string;
  target?: string;
  engagementId?: string;
  explanationDepth: "concise" | "balanced" | "deep";
  executionPreference: "manual" | "single_step_agent";
  evidenceExpectations: string[];
}

export type MissionCreateRequest = AutonomousMissionRequest | GuidedMissionRequest;

export interface ApiErrorEnvelope {
  code: string;
  message: string;
  humanMessage?: string;
  retryable?: boolean;
  category?: string;
  details?: unknown;
  traceId?: string;
  remediation?: string;
  timestamp?: string;
}

export interface OperationalEvent {
  id: string;
  sequence?: number;
  type: string;
  timestamp: string;
  missionId?: string;
  runId?: string;
  journey?: Journey;
  summary: string;
}
