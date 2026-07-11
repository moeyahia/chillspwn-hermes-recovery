/**
 * Client-side wire types for the agent-runtime API (Phase 5).
 *
 * These mirror the shapes returned by /api/runs*, /api/runtime-memory*, and the cockpit
 * endpoint. They are intentionally NOT imported from server/runtime/types.ts — that module
 * pulls in Node's `crypto`, which can't run in the browser. This is the wire CONTRACT, not
 * a second state model: the runtime owns all state; the cockpit only renders snapshots.
 */

export type AgentRunStatus =
  | "created" | "planning" | "awaiting_plan_approval" | "executing"
  | "awaiting_user_input" | "blocked" | "completed" | "failed" | "cancelled";

export type PlanStepStatus = "pending" | "running" | "blocked" | "completed" | "failed" | "skipped";

export type RiskLevel =
  | "read-only" | "file-write" | "terminal" | "network"
  | "destructive" | "credential-sensitive" | "exploit-sensitive";

export type ToolCallStatus =
  | "requested" | "awaiting_approval" | "approved" | "rejected" | "executing" | "succeeded" | "failed";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";
export type MemoryStatus = "unverified" | "verified" | "rejected" | "stale";
export type ProviderKind = "claude" | "openrouter" | "openai-codex" | "gemini" | "xai-grok";

export interface AgentRun {
  id: string;
  sessionId: string;
  persona: string;
  providerKind: ProviderKind;
  objective: string;
  status: AgentRunStatus;
  stepIds: string[];
  engagement?: string;
  cwd?: string;
  createdAt: string;
  updatedAt: string;
  endedAt?: string;
  endReason?: string;
  finalReport?: string;
  /** Phase 7: "chat" = observe-only run attached to a live chat session; absent ⇒ "api". */
  source?: "api" | "chat";
  /** "managed" = runtime-enforced; "observe" = read-only observation of live chat. */
  mode?: "managed" | "observe";
  /** Phase 7.2: advisory, NON-ENFORCED plan preview (chat observe-only runs). */
  planPreview?: PlanPreview;
  /** Free-form metadata (Phase 7.5: observedExecutionStartedAt). */
  metadata?: Record<string, string | number | boolean>;
}

/** Phase 7.2 — advisory preview step. NEVER a managed PlanStep (no id/status/approval). */
export interface PreviewStep {
  title: string;
  purpose: string;
  successCriteria: string;
  suggestedTools: string[];
  riskLevel: string;
  dependsOn: number[];
}

export interface PlanPreview {
  title: string;
  purpose: string;
  successCriteria: string;
  steps: PreviewStep[];
  riskLevel: string;
  suggestedTools: string[];
  confidence: number;
  createdAt: string;
  source: "preview" | "inferred";
  generatedBy?: string;
  enforced: false;
}

export interface PlanStep {
  id: string;
  agentRunId: string;
  index: number;
  title: string;
  purpose: string;
  successCriteria: string;
  allowedTools: string[];
  riskLevel: RiskLevel;
  dependencies: string[];
  assignedAgent?: string;
  status: PlanStepStatus;
  evidenceRefs: string[];
  boardCardId?: string;
  startedAt?: string;
  endedAt?: string;
  summary?: string;
}

export interface ToolResult {
  success: boolean;
  output: string;
  artifacts?: unknown[];
  evidenceRefs?: string[];
  error?: string;
  suggestedNextStep?: string;
}

export interface ToolCall {
  id: string;
  agentRunId: string;
  stepId: string | null;
  toolName: string;
  arguments: Record<string, unknown>;
  riskLevel: RiskLevel;
  status: ToolCallStatus;
  approvalId?: string;
  createdAt: string;
  resolvedAt?: string;
  result?: ToolResult;
}

export interface EvidenceItem {
  id: string;
  agentRunId: string;
  stepId: string | null;
  kind: string;
  sourceToolName?: string;
  sourceToolCallId?: string;
  label: string;
  content?: string;
  path?: string;
  /** Phase 12: side-file artifact id holding the full content (retrieve via /api/artifacts/:id). */
  artifactId?: string;
  createdAt: string;
}

export interface ApprovalRequest {
  id: string;
  agentRunId: string;
  stepId: string | null;
  toolCallId: string;
  toolName: string;
  riskLevel: RiskLevel;
  summary: string;
  preview?: string;
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  rejectionReason?: string;
}

export interface WorkerResult {
  status: "complete" | "blocked" | "failed";
  summary: string;
  evidence: EvidenceItem[];
  artifacts: unknown[];
  confidence: number;
  assumptions: string[];
  recommendedNextSteps: string[];
}

export interface WorkerResultRecord {
  stepId: string | null;
  result: WorkerResult;
  evidenceIds: string[];
  recordedAt: string;
}

export interface MemoryItem {
  id: string;
  type: string;
  scope: "session" | "engagement" | "project" | "global";
  content: string;
  status: MemoryStatus;
  confidence: number;
  timestamp: string;
  sourceSessionId?: string;
  sourceAgentRunId?: string;
  sourceStepId?: string;
  sourceToolName?: string;
  sourceToolCallId?: string;
  sourceEvidenceId?: string;
  sourceBoardCardId?: string;
}

export interface AgentEvent {
  id: string;
  type: string;
  agentRunId: string | null;
  sessionId: string | null;
  stepId?: string | null;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface AgentRunDoc {
  run: AgentRun;
  steps: PlanStep[];
  toolCalls: ToolCall[];
  evidence: EvidenceItem[];
  approvals: ApprovalRequest[];
  workerResults: WorkerResultRecord[];
}

/** The composite payload from GET /api/runs/:id/cockpit. */
export interface CockpitSnapshot {
  doc: AgentRunDoc;
  events: AgentEvent[];
  memory: MemoryItem[];
}
