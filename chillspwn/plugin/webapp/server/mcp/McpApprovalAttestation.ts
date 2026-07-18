import { hashJson } from "../orchestration/serialization";

export const MCP_APPROVAL_ATTESTATION_VERSION = 1 as const;
export const DEFAULT_MCP_APPROVAL_ATTESTATION_TTL_MS = 5 * 60_000;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export interface McpExecutionBinding {
  readonly runId: string;
  readonly stepId: string;
  readonly specialistAgentId: string;
  readonly mcpServer: string;
  readonly toolName: string;
  readonly argumentsHash: string;
}

interface McpApprovalAttestationBase extends McpExecutionBinding {
  readonly version: typeof MCP_APPROVAL_ATTESTATION_VERSION;
  readonly claimId: string;
  readonly actorId: string;
  readonly resolvedAt: string;
  readonly expiresAt: string;
}

/** Durable approval issued by the legacy AgentRuntime tool-call gate. */
export interface LegacyToolApprovalAttestation extends McpApprovalAttestationBase {
  readonly kind: "legacy_tool_approval";
  readonly toolCallId: string;
  readonly approvalId: string;
}

/**
 * Exact Guided decision issued by the canonical SQLite runtime. The bridge does
 * not trust this shape by itself: its configured verifier must query and
 * atomically consume the matching canonical decision/action claim.
 */
export interface GuidedExactStepAttestation extends McpApprovalAttestationBase {
  readonly kind: "guided_exact_step";
  readonly actionId: string;
  readonly guidedDecisionId: string;
}

/**
 * One-use capability for the only reviewed Nmap request above the ordinary
 * 1,024-port ceiling: an exact 1–65,535 TCP Connect scan in a current,
 * pre-authorized Autonomous `port_service_enumeration` action. The envelope
 * is not self-authorizing. The runtime adapter persists an issuance receipt,
 * and the bridge's canonical verifier must atomically re-read and consume it.
 */
export interface AutonomousFullTcpAttestation extends McpApprovalAttestationBase {
  readonly kind: "autonomous_full_tcp";
  readonly actionId: string;
  readonly actionFingerprint: string;
  readonly missionId: string;
  readonly assignmentId: string;
  readonly planId: string;
  readonly planVersion: number;
  readonly contractId: string;
  readonly contractVersion: number;
  readonly contractHash: string;
  readonly normalizedTarget: string;
  readonly actionClass: "port_service_enumeration";
  readonly controlPlane: "command_os_v2";
  readonly destructive: false;
  readonly destructivePolicy: "prohibited" | "validate_without_executing";
  readonly wallClockLimitMs: number;
  readonly remainingWallClockMs: number;
  readonly toolCallLimit: number;
  readonly remainingToolCalls: number;
}

export type McpApprovalAttestation =
  | LegacyToolApprovalAttestation
  | GuidedExactStepAttestation
  | AutonomousFullTcpAttestation;

export interface McpApprovalVerificationRequest {
  readonly attestation: McpApprovalAttestation;
  readonly binding: McpExecutionBinding;
  readonly verifiedAt: string;
}

export type McpApprovalVerificationResult =
  | { readonly approved: true }
  | { readonly approved: false; readonly reason: string };

/**
 * This callback is a consume operation, not a passive signature check. It must
 * verify the durable approval/decision and atomically mark the exact claim used
 * before returning approved=true. That makes replay fail across restarts and
 * across multiple bridge instances.
 */
export type McpApprovalAttestationVerifier = (
  request: McpApprovalVerificationRequest,
) => McpApprovalVerificationResult | Promise<McpApprovalVerificationResult>;

export function hashMcpArguments(value: unknown): string {
  return hashJson(value ?? {});
}

export function createMcpExecutionBinding(input: {
  readonly runId: string;
  readonly stepId: string;
  readonly specialistAgentId: string;
  readonly mcpServer: string;
  readonly toolName: string;
  readonly arguments?: unknown;
}): McpExecutionBinding {
  return {
    runId: input.runId,
    stepId: input.stepId,
    specialistAgentId: input.specialistAgentId,
    mcpServer: input.mcpServer,
    toolName: input.toolName,
    argumentsHash: hashMcpArguments(input.arguments),
  };
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER.test(value);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/**
 * Validate the immutable envelope and its exact execution binding before the
 * trusted durable verifier is called. Returns a safe diagnostic, never a
 * credential, argument value, or raw payload.
 */
export function validateMcpApprovalAttestation(
  attestation: McpApprovalAttestation | undefined,
  binding: McpExecutionBinding,
  verifiedAt: string,
): string | null {
  if (!attestation || typeof attestation !== "object") return "approval attestation is required";
  if (attestation.version !== MCP_APPROVAL_ATTESTATION_VERSION) return "approval attestation version is unsupported";
  if (
    attestation.kind !== "legacy_tool_approval"
    && attestation.kind !== "guided_exact_step"
    && attestation.kind !== "autonomous_full_tcp"
  ) {
    return "approval attestation kind is unsupported";
  }
  for (const [label, value] of [
    ["claim ID", attestation.claimId],
    ["run ID", attestation.runId],
    ["step ID", attestation.stepId],
    ["specialist ID", attestation.specialistAgentId],
    ["MCP server", attestation.mcpServer],
    ["tool name", attestation.toolName],
    ["actor ID", attestation.actorId],
  ] as const) {
    if (!validIdentifier(value)) return `${label} is invalid`;
  }
  if (!SHA256.test(attestation.argumentsHash)) return "approval arguments hash is invalid";
  if (!validTimestamp(attestation.resolvedAt) || !validTimestamp(attestation.expiresAt)) {
    return "approval timestamps are invalid";
  }
  const verifiedAtMs = Date.parse(verifiedAt);
  const resolvedAtMs = Date.parse(attestation.resolvedAt);
  const expiresAtMs = Date.parse(attestation.expiresAt);
  if (!Number.isFinite(verifiedAtMs)) return "verification timestamp is invalid";
  if (resolvedAtMs > verifiedAtMs) return "approval resolution timestamp is in the future";
  if (expiresAtMs <= resolvedAtMs) return "approval expiry does not follow its resolution";
  if (expiresAtMs <= verifiedAtMs) return "approval attestation has expired";

  if (attestation.kind === "legacy_tool_approval") {
    if (!validIdentifier(attestation.toolCallId) || !validIdentifier(attestation.approvalId)) {
      return "legacy approval identity is invalid";
    }
  } else if (attestation.kind === "guided_exact_step") {
    if (!validIdentifier(attestation.actionId) || !validIdentifier(attestation.guidedDecisionId)) {
      return "Guided decision identity is invalid";
    }
  } else {
    for (const [label, value] of [
      ["action ID", attestation.actionId],
      ["mission ID", attestation.missionId],
      ["assignment ID", attestation.assignmentId],
      ["plan ID", attestation.planId],
      ["contract ID", attestation.contractId],
    ] as const) {
      if (!validIdentifier(value)) return `Autonomous full-TCP ${label} is invalid`;
    }
    if (!SHA256.test(attestation.actionFingerprint)) return "Autonomous full-TCP action fingerprint is invalid";
    if (!SHA256.test(attestation.contractHash)) return "Autonomous full-TCP contract hash is invalid";
    if (
      !Number.isSafeInteger(attestation.planVersion) || attestation.planVersion < 1
      || !Number.isSafeInteger(attestation.contractVersion) || attestation.contractVersion < 1
    ) return "Autonomous full-TCP version binding is invalid";
    if (
      typeof attestation.normalizedTarget !== "string"
      || attestation.normalizedTarget.length < 1
      || attestation.normalizedTarget.length > 253
      || attestation.normalizedTarget !== attestation.normalizedTarget.trim()
    ) return "Autonomous full-TCP normalized target is invalid";
    if (
      attestation.actionClass !== "port_service_enumeration"
      || attestation.controlPlane !== "command_os_v2"
      || attestation.destructive !== false
      || !["prohibited", "validate_without_executing"].includes(attestation.destructivePolicy)
    ) return "Autonomous full-TCP policy binding is invalid";
    if (
      !Number.isSafeInteger(attestation.wallClockLimitMs) || attestation.wallClockLimitMs < 1
      || !Number.isSafeInteger(attestation.remainingWallClockMs) || attestation.remainingWallClockMs < 1
      || attestation.remainingWallClockMs > attestation.wallClockLimitMs
      || !Number.isSafeInteger(attestation.toolCallLimit) || attestation.toolCallLimit < 1
      || !Number.isSafeInteger(attestation.remainingToolCalls) || attestation.remainingToolCalls < 1
      || attestation.remainingToolCalls > attestation.toolCallLimit
    ) return "Autonomous full-TCP finite budget binding is invalid";
  }

  if (
    attestation.runId !== binding.runId ||
    attestation.stepId !== binding.stepId ||
    attestation.specialistAgentId !== binding.specialistAgentId ||
    attestation.mcpServer !== binding.mcpServer ||
    attestation.toolName !== binding.toolName ||
    attestation.argumentsHash !== binding.argumentsHash
  ) {
    return "approval attestation does not match the exact execution binding";
  }
  return null;
}
