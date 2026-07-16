import { createHash, randomUUID } from "node:crypto";
import type { SqliteDatabase } from "../db";
import { inImmediateTransaction } from "../db";
import type { DurableAction } from "../orchestration";
import { canonicalJson, parseObject } from "../orchestration/serialization";
import {
  MCP_APPROVAL_ATTESTATION_VERSION,
  createMcpExecutionBinding,
  validateMcpApprovalAttestation,
  type GuidedExactStepAttestation,
  type McpApprovalVerificationRequest,
  type McpApprovalVerificationResult,
} from "./McpApprovalAttestation";

interface GuidedAuthorityRow {
  readonly action_id: string;
  readonly action_mission_id: string;
  readonly action_run_id: string;
  readonly action_step_id: string | null;
  readonly action_fingerprint: string;
  readonly action_status: string;
  readonly normalized_arguments_json: string;
  readonly agent_id: string | null;
  readonly journey: string;
  readonly decision_id: string;
  readonly decision_mission_id: string;
  readonly decision_run_id: string;
  readonly decision_step_id: string;
  readonly requested_action_fingerprint: string;
  readonly decision_status: string;
  readonly decision_actor: string | null;
  readonly decided_at: string | null;
  readonly expires_at: string;
}

function authorityRow(
  database: SqliteDatabase,
  actionId: string,
  decisionId: string,
): GuidedAuthorityRow | undefined {
  return database.prepare(`
    SELECT
      a.id AS action_id,
      a.mission_id AS action_mission_id,
      a.run_id AS action_run_id,
      a.step_id AS action_step_id,
      a.fingerprint AS action_fingerprint,
      a.status AS action_status,
      a.normalized_arguments_json,
      ass.agent_id,
      r.journey,
      gd.id AS decision_id,
      gd.mission_id AS decision_mission_id,
      gd.run_id AS decision_run_id,
      gd.step_id AS decision_step_id,
      gd.requested_action_fingerprint,
      gd.status AS decision_status,
      gd.decision_actor,
      gd.decided_at,
      gd.expires_at
    FROM actions a
    JOIN runs r ON r.id = a.run_id
    LEFT JOIN assignments ass ON ass.id = a.assignment_id
    JOIN guided_decisions gd ON gd.id = a.guided_decision_id
    WHERE a.id = ? AND gd.id = ?
  `).get(actionId, decisionId) as GuidedAuthorityRow | undefined;
}

function actionToolBinding(row: GuidedAuthorityRow): {
  readonly mcpServer: string;
  readonly toolName: string;
  readonly arguments: unknown;
} | null {
  const stored = parseObject(row.normalized_arguments_json);
  const input = stored.input && typeof stored.input === "object" && !Array.isArray(stored.input)
    ? stored.input as Record<string, unknown>
    : {};
  const mcpServer = typeof input.mcpServer === "string" ? input.mcpServer.trim() : "";
  const toolName = typeof input.toolName === "string" ? input.toolName.trim() : "";
  if (!mcpServer || !toolName) return null;
  return {
    mcpServer,
    toolName,
    arguments: input.arguments ?? input.input ?? {},
  };
}

function validAuthority(
  row: GuidedAuthorityRow | undefined,
  input: {
    readonly actionId: string;
    readonly decisionId: string;
    readonly runId: string;
    readonly stepId: string;
    readonly specialistAgentId: string;
    readonly mcpServer: string;
    readonly toolName: string;
    readonly argumentsHash: string;
    readonly actorId?: string;
    readonly resolvedAt?: string;
    readonly expiresAt?: string;
    readonly now: string;
  },
): string | null {
  if (!row) return "the exact Guided action and decision were not found";
  const tool = actionToolBinding(row);
  if (
    row.action_id !== input.actionId ||
    row.decision_id !== input.decisionId ||
    row.journey !== "guided" ||
    row.action_run_id !== input.runId ||
    row.decision_run_id !== input.runId ||
    row.action_step_id !== input.stepId ||
    row.decision_step_id !== input.stepId ||
    row.action_mission_id !== row.decision_mission_id ||
    row.action_fingerprint !== row.requested_action_fingerprint ||
    row.action_status !== "running" ||
    row.decision_status !== "approved" ||
    !row.decision_actor ||
    !row.decided_at ||
    !row.agent_id ||
    row.agent_id !== input.specialistAgentId ||
    !tool ||
    tool.mcpServer !== input.mcpServer ||
    tool.toolName !== input.toolName
  ) {
    return "the durable Guided decision no longer matches the exact running action";
  }
  const storedBinding = createMcpExecutionBinding({
    runId: row.action_run_id,
    stepId: row.action_step_id,
    specialistAgentId: row.agent_id,
    mcpServer: tool.mcpServer,
    toolName: tool.toolName,
    arguments: tool.arguments,
  });
  if (input.argumentsHash !== storedBinding.argumentsHash) {
    return "the Guided tool arguments changed after the operator decision";
  }
  if (input.actorId !== undefined && row.decision_actor !== input.actorId) {
    return "the Guided decision actor changed";
  }
  if (input.resolvedAt !== undefined && row.decided_at !== input.resolvedAt) {
    return "the Guided decision timestamp changed";
  }
  if (input.expiresAt !== undefined && row.expires_at !== input.expiresAt) {
    return "the Guided decision expiry changed";
  }
  const nowMs = Date.parse(input.now);
  const decidedAtMs = Date.parse(row.decided_at);
  const expiresAtMs = Date.parse(row.expires_at);
  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(decidedAtMs) ||
    !Number.isFinite(expiresAtMs) ||
    decidedAtMs > nowMs ||
    expiresAtMs <= decidedAtMs ||
    expiresAtMs <= nowMs
  ) {
    return "the exact Guided decision has expired";
  }
  return null;
}

function consumedSettingKey(actionId: string, decisionId: string): string {
  const digest = createHash("sha256").update(`${actionId}\0${decisionId}`, "utf8").digest("hex");
  return `security.mcp-guided-claim.${digest}`;
}

/**
 * Mint a short-lived envelope from an already-persisted exact Guided decision.
 * This function does not consume authority; the bridge's verifier does so in
 * the same database immediately before MCP dispatch.
 */
export function createGuidedExactStepAttestation(input: {
  readonly database: SqliteDatabase;
  readonly action: DurableAction;
  readonly specialistAgentId: string;
  readonly mcpServer: string;
  readonly toolName: string;
  readonly arguments: unknown;
  readonly now: string;
}): GuidedExactStepAttestation {
  if (!input.action.guidedDecisionId) {
    throw new Error("approval-required Guided execution has no exact decision");
  }
  const binding = createMcpExecutionBinding({
    runId: input.action.runId,
    stepId: input.action.stepId,
    specialistAgentId: input.specialistAgentId,
    mcpServer: input.mcpServer,
    toolName: input.toolName,
    arguments: input.arguments,
  });
  const row = authorityRow(input.database, input.action.id, input.action.guidedDecisionId);
  const invalid = validAuthority(row, {
    actionId: input.action.id,
    decisionId: input.action.guidedDecisionId,
    runId: input.action.runId,
    stepId: input.action.stepId,
    specialistAgentId: input.specialistAgentId,
    mcpServer: input.mcpServer,
    toolName: input.toolName,
    argumentsHash: binding.argumentsHash,
    now: input.now,
  });
  if (invalid || !row?.decision_actor || !row.decided_at) {
    throw new Error(`Guided MCP approval denied: ${invalid ?? "decision provenance is incomplete"}`);
  }
  const attestation: GuidedExactStepAttestation = {
    version: MCP_APPROVAL_ATTESTATION_VERSION,
    kind: "guided_exact_step",
    claimId: `mcpclaim_${randomUUID()}`,
    actionId: input.action.id,
    guidedDecisionId: input.action.guidedDecisionId,
    ...binding,
    actorId: row.decision_actor,
    resolvedAt: row.decided_at,
    expiresAt: row.expires_at,
  };
  const envelopeError = validateMcpApprovalAttestation(attestation, binding, input.now);
  if (envelopeError) throw new Error(`Guided MCP approval denied: ${envelopeError}`);
  return attestation;
}

/** Atomically verify and consume one exact canonical Guided decision claim. */
export function verifyAndConsumeGuidedExactStepAttestation(
  database: SqliteDatabase,
  request: McpApprovalVerificationRequest,
): McpApprovalVerificationResult {
  const { attestation, binding, verifiedAt } = request;
  if (attestation.kind !== "guided_exact_step") {
    return { approved: false, reason: "the canonical Guided verifier cannot verify this approval kind" };
  }
  const envelopeError = validateMcpApprovalAttestation(attestation, binding, verifiedAt);
  if (envelopeError) return { approved: false, reason: envelopeError };
  try {
    return inImmediateTransaction(database, () => {
      const row = authorityRow(database, attestation.actionId, attestation.guidedDecisionId);
      const invalid = validAuthority(row, {
        actionId: attestation.actionId,
        decisionId: attestation.guidedDecisionId,
        runId: attestation.runId,
        stepId: attestation.stepId,
        specialistAgentId: attestation.specialistAgentId,
        mcpServer: attestation.mcpServer,
        toolName: attestation.toolName,
        argumentsHash: binding.argumentsHash,
        actorId: attestation.actorId,
        resolvedAt: attestation.resolvedAt,
        expiresAt: attestation.expiresAt,
        now: verifiedAt,
      });
      if (invalid) return { approved: false, reason: invalid };
      const key = consumedSettingKey(attestation.actionId, attestation.guidedDecisionId);
      const inserted = database.prepare(`
        INSERT OR IGNORE INTO settings (
          key, value_json, sensitivity, version, updated_by, updated_at
        ) VALUES (?, ?, 'private', 1, ?, ?)
      `).run(
        key,
        canonicalJson({
          schemaVersion: 1,
          claimId: attestation.claimId,
          actionId: attestation.actionId,
          guidedDecisionId: attestation.guidedDecisionId,
          argumentsHash: attestation.argumentsHash,
          consumedAt: verifiedAt,
        }),
        attestation.actorId,
        verifiedAt,
      );
      return inserted.changes === 1
        ? { approved: true }
        : { approved: false, reason: "the exact Guided decision claim was already consumed" };
    });
  } catch {
    return { approved: false, reason: "the durable Guided approval verifier failed closed" };
  }
}
