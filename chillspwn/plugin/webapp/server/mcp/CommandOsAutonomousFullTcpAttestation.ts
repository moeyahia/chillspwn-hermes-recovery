import { createHash, randomUUID } from "node:crypto";
import type { SqliteDatabase } from "../db";
import { inImmediateTransaction } from "../db";
import { ActionRepository, RunRepository, type DurableAction } from "../orchestration";
import { canonicalJson, hashJson, parseObject } from "../orchestration/serialization";
import {
  isExactFullTcpNmapSelection,
  normalizeConcreteNmapTarget,
} from "./PentestReconToolPolicy";
import {
  MCP_APPROVAL_ATTESTATION_VERSION,
  createMcpExecutionBinding,
  validateMcpApprovalAttestation,
  type AutonomousFullTcpAttestation,
  type McpApprovalVerificationRequest,
  type McpApprovalVerificationResult,
} from "./McpApprovalAttestation";

const FULL_TCP_SERVER = "pentest-mcp-recon";
const FULL_TCP_TOOL = "nmapScan";
const FULL_TCP_ACTION_CLASS = "port_service_enumeration";
const RUNTIME_ACTOR = "command-os-v2:runtime-adapter";
const MAX_CLAIM_TTL_MS = 60_000;
const CAPABILITY_RESOURCE_TYPE = "mcp_autonomous_full_tcp_capability";
const ISSUED_AUDIT_ACTION = "mcp.autonomous_full_tcp.issued";
const CONSUMED_AUDIT_ACTION = "mcp.autonomous_full_tcp.consumed";

interface AuthorityRow {
  readonly action_id: string;
  readonly action_mission_id: string;
  readonly action_run_id: string;
  readonly action_step_id: string | null;
  readonly action_assignment_id: string | null;
  readonly action_type: string;
  readonly action_class: string;
  readonly action_fingerprint: string;
  readonly action_arguments_json: string;
  readonly action_target: string | null;
  readonly action_status: string;
  readonly guided_decision_id: string | null;
  readonly action_contract_id: string | null;
  readonly run_mission_id: string;
  readonly journey: string;
  readonly run_status: string;
  readonly run_control_plane: string;
  readonly current_plan_id: string | null;
  readonly current_step_id: string | null;
  readonly run_contract_id: string | null;
  readonly contract_version_bound: number | null;
  readonly contract_hash_bound: string | null;
  readonly budget_json: string;
  readonly budget_usage_json: string;
  readonly run_started_at: string | null;
  readonly mission_journey: string;
  readonly authorization_status: string;
  readonly mission_control_plane: string;
  readonly plan_id: string;
  readonly plan_version: number;
  readonly plan_status: string;
  readonly step_id: string;
  readonly step_status: string;
  readonly step_action_class: string | null;
  readonly step_agent_id: string | null;
  readonly assignment_id: string;
  readonly assignment_status: string;
  readonly assignment_agent_id: string;
  readonly agent_status: string;
  readonly contract_id: string;
  readonly contract_mission_id: string;
  readonly contract_version: number;
  readonly contract_state: string;
  readonly contract_hash: string;
  readonly action_policy_json: string;
  readonly contract_budgets_json: string;
}

interface StoredToolBinding {
  readonly mcpServer: string;
  readonly toolName: string;
  readonly arguments: unknown;
  readonly kind: string;
  readonly idempotent: boolean;
  readonly destructive: boolean;
  readonly planVersion: number | null;
}

interface BudgetBinding {
  readonly wallClockLimitMs: number;
  readonly remainingWallClockMs: number;
  readonly toolCallLimit: number;
  readonly remainingToolCalls: number;
}

interface AuthoritySnapshot extends BudgetBinding {
  readonly actionFingerprint: string;
  readonly missionId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly assignmentId: string;
  readonly planId: string;
  readonly planVersion: number;
  readonly contractId: string;
  readonly contractVersion: number;
  readonly contractHash: string;
  readonly normalizedTarget: string;
  readonly specialistAgentId: string;
  readonly destructivePolicy: AutonomousFullTcpAttestation["destructivePolicy"];
  readonly argumentsHash: string;
}

type CapabilityAuditKind = "issued" | "consumed";

interface CapabilityAuditRow {
  readonly id: string;
  readonly mission_id: string | null;
  readonly run_id: string | null;
  readonly journey: string | null;
  readonly actor_type: string;
  readonly actor_id: string | null;
  readonly action: string;
  readonly resource_type: string;
  readonly resource_id: string | null;
  readonly reason: string | null;
  readonly details_json: string;
  readonly previous_hash: string | null;
  readonly record_hash: string;
  readonly occurred_at: string;
}

type SnapshotResult =
  | { readonly ok: true; readonly snapshot: AuthoritySnapshot }
  | { readonly ok: false; readonly reason: string };

function rowForAction(database: SqliteDatabase, actionId: string): AuthorityRow | undefined {
  return database.prepare(`
    SELECT
      a.id AS action_id,
      a.mission_id AS action_mission_id,
      a.run_id AS action_run_id,
      a.step_id AS action_step_id,
      a.assignment_id AS action_assignment_id,
      a.action_type,
      a.action_class,
      a.fingerprint AS action_fingerprint,
      a.normalized_arguments_json AS action_arguments_json,
      a.scoped_target AS action_target,
      a.status AS action_status,
      a.guided_decision_id,
      a.contract_id AS action_contract_id,
      r.mission_id AS run_mission_id,
      r.journey,
      r.status AS run_status,
      r.control_plane AS run_control_plane,
      r.current_plan_id,
      r.current_step_id,
      r.contract_id AS run_contract_id,
      r.contract_version_bound,
      r.contract_hash_bound,
      r.budget_json,
      r.budget_usage_json,
      r.started_at AS run_started_at,
      m.journey AS mission_journey,
      m.authorization_status,
      m.control_plane AS mission_control_plane,
      p.id AS plan_id,
      p.version AS plan_version,
      p.status AS plan_status,
      ps.id AS step_id,
      ps.status AS step_status,
      ps.action_class AS step_action_class,
      ps.assigned_agent_id AS step_agent_id,
      ass.id AS assignment_id,
      ass.status AS assignment_status,
      ass.agent_id AS assignment_agent_id,
      ag.status AS agent_status,
      mc.id AS contract_id,
      mc.mission_id AS contract_mission_id,
      mc.version AS contract_version,
      mc.state AS contract_state,
      mc.contract_hash,
      mc.action_policy_json,
      mc.budgets_json AS contract_budgets_json
    FROM actions a
    JOIN runs r ON r.id = a.run_id
    JOIN missions m ON m.id = r.mission_id
    JOIN plans p ON p.id = r.current_plan_id AND p.run_id = r.id
    JOIN plan_steps ps ON ps.id = r.current_step_id AND ps.plan_id = p.id AND ps.run_id = r.id
    JOIN assignments ass ON ass.id = a.assignment_id AND ass.run_id = r.id AND ass.step_id = ps.id
    JOIN agents ag ON ag.id = ass.agent_id
    JOIN mission_contracts mc ON mc.id = r.contract_id AND mc.mission_id = m.id
    WHERE a.id = ?
  `).get(actionId) as AuthorityRow | undefined;
}

function storedToolBinding(row: AuthorityRow): StoredToolBinding | null {
  const stored = parseObject(row.action_arguments_json);
  const input = stored.input && typeof stored.input === "object" && !Array.isArray(stored.input)
    ? stored.input as Record<string, unknown>
    : {};
  const orchestration = stored.orchestration
    && typeof stored.orchestration === "object"
    && !Array.isArray(stored.orchestration)
    ? stored.orchestration as Record<string, unknown>
    : {};
  const mcpServer = typeof input.mcpServer === "string" ? input.mcpServer.trim() : "";
  const toolName = typeof input.toolName === "string" ? input.toolName.trim() : "";
  if (!mcpServer || !toolName) return null;
  return {
    mcpServer,
    toolName,
    arguments: input.arguments ?? input.input ?? {},
    kind: typeof orchestration.kind === "string" ? orchestration.kind : "",
    idempotent: orchestration.idempotent === true,
    destructive: orchestration.destructive === true,
    planVersion: Number.isSafeInteger(orchestration.planVersion)
      ? Number(orchestration.planVersion)
      : null,
  };
}

function stringSet(value: unknown): Set<string> {
  return new Set((Array.isArray(value) ? value : [])
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean));
}

function positiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function nonnegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function wallClockLimit(value: Readonly<Record<string, unknown>>): number | null {
  const direct = positiveInteger(value.wallClockMs);
  if (direct !== null) return direct;
  const minutes = positiveInteger(value.timeBudgetMinutes);
  if (minutes === null || minutes > Math.floor(Number.MAX_SAFE_INTEGER / 60_000)) return null;
  return minutes * 60_000;
}

function toolCallLimit(value: Readonly<Record<string, unknown>>): number | null {
  return positiveInteger(value.toolCalls) ?? positiveInteger(value.toolCallBudget);
}

function budgetBinding(row: AuthorityRow, at: string): BudgetBinding | null {
  const atMs = Date.parse(at);
  const startedAtMs = Date.parse(row.run_started_at ?? "");
  if (!Number.isFinite(atMs) || !Number.isFinite(startedAtMs) || startedAtMs > atMs) return null;
  const limits = parseObject(row.budget_json);
  const contractLimits = parseObject(row.contract_budgets_json);
  const usage = parseObject(row.budget_usage_json);
  const wallLimit = wallClockLimit(limits);
  const signedWallLimit = wallClockLimit(contractLimits);
  const toolLimit = toolCallLimit(limits);
  const signedToolLimit = toolCallLimit(contractLimits);
  if (
    wallLimit === null || signedWallLimit === null || wallLimit !== signedWallLimit
    || toolLimit === null || signedToolLimit === null || toolLimit !== signedToolLimit
  ) return null;
  const storedWallUsage = nonnegativeInteger(usage.wallClockMs) ?? 0;
  const toolUsage = nonnegativeInteger(usage.toolCalls) ?? 0;
  const effectiveWallUsage = Math.max(storedWallUsage, Math.floor(atMs - startedAtMs));
  const remainingWallClockMs = wallLimit - effectiveWallUsage;
  const remainingToolCalls = toolLimit - toolUsage;
  if (remainingWallClockMs < 1 || remainingToolCalls < 1) return null;
  return {
    wallClockLimitMs: wallLimit,
    remainingWallClockMs,
    toolCallLimit: toolLimit,
    remainingToolCalls,
  };
}

function canonicalAuthorization(
  database: SqliteDatabase,
  actionId: string,
): string | null {
  try {
    const action = new ActionRepository(database).get(actionId);
    const runRepository = new RunRepository(database);
    const run = runRepository.get(action.runId);
    const result = runRepository.authorizePersistedAction(run, action);
    return result.allowed ? null : result.humanMessage;
  } catch {
    return "the canonical action authorization could not be reconstructed";
  }
}

function currentAuthority(
  database: SqliteDatabase,
  input: {
    readonly actionId: string;
    readonly runId: string;
    readonly stepId: string;
    readonly specialistAgentId: string;
    readonly mcpServer: string;
    readonly toolName: string;
    readonly argumentsHash: string;
    readonly at: string;
  },
): SnapshotResult {
  const row = rowForAction(database, input.actionId);
  if (!row) return { ok: false, reason: "the exact Autonomous full-TCP action was not found" };
  const authorizationError = canonicalAuthorization(database, input.actionId);
  if (authorizationError) return { ok: false, reason: authorizationError };
  const tool = storedToolBinding(row);
  const actionTarget = normalizeConcreteNmapTarget(row.action_target);
  const toolTarget = tool && typeof tool.arguments === "object" && tool.arguments !== null && !Array.isArray(tool.arguments)
    ? normalizeConcreteNmapTarget((tool.arguments as Record<string, unknown>).target)
    : null;
  const policy = parseObject(row.action_policy_json);
  const allowed = stringSet(policy.allowedActionClasses);
  const prohibited = stringSet(policy.prohibitedActionClasses);
  const signedSpecialists = new Set((Array.isArray(policy.specialistAgentIds) ? policy.specialistAgentIds : [])
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean));
  const destructivePolicy = typeof policy.destructivePolicy === "string"
    ? policy.destructivePolicy.trim().toLowerCase()
    : "";
  const binding = tool ? createMcpExecutionBinding({
    runId: row.action_run_id,
    stepId: row.action_step_id ?? "",
    specialistAgentId: row.assignment_agent_id,
    mcpServer: tool.mcpServer,
    toolName: tool.toolName,
    arguments: tool.arguments,
  }) : null;
  if (
    row.action_id !== input.actionId
    || row.action_mission_id !== row.run_mission_id
    || row.action_run_id !== input.runId
    || row.action_step_id !== input.stepId
    || row.action_assignment_id !== row.assignment_id
    || row.action_type.trim().toLowerCase() !== FULL_TCP_ACTION_CLASS
    || row.action_class.trim().toLowerCase() !== FULL_TCP_ACTION_CLASS
    || row.action_status !== "running"
    || row.guided_decision_id !== null
    || row.journey !== "autonomous"
    || row.mission_journey !== "autonomous"
    || !["running", "recovering"].includes(row.run_status)
    || row.run_control_plane !== "command_os_v2"
    || row.mission_control_plane !== "command_os_v2"
    || row.authorization_status !== "verified"
    || row.current_plan_id !== row.plan_id
    || row.current_step_id !== row.step_id
    || row.plan_status !== "active"
    || row.step_status !== "running"
    || row.step_action_class?.trim().toLowerCase() !== FULL_TCP_ACTION_CLASS
    || row.step_agent_id !== row.assignment_agent_id
    || row.assignment_id !== row.action_assignment_id
    || row.assignment_status !== "active"
    || row.assignment_agent_id !== input.specialistAgentId
    || ["offline", "quarantined"].includes(row.agent_status)
    || row.action_contract_id !== row.contract_id
    || row.run_contract_id !== row.contract_id
    || row.contract_mission_id !== row.run_mission_id
    || row.contract_state !== "confirmed"
    || row.contract_version_bound !== row.contract_version
    || row.contract_hash_bound !== row.contract_hash
    || !allowed.has(FULL_TCP_ACTION_CLASS)
    || prohibited.has(FULL_TCP_ACTION_CLASS)
    || !signedSpecialists.has(row.assignment_agent_id)
    || !["prohibited", "validate_without_executing"].includes(destructivePolicy)
    || !tool
    || tool.kind !== "tool"
    || tool.idempotent !== true
    || tool.destructive !== false
    || tool.planVersion !== row.plan_version
    || tool.mcpServer !== FULL_TCP_SERVER
    || tool.toolName !== FULL_TCP_TOOL
    || input.mcpServer !== FULL_TCP_SERVER
    || input.toolName !== FULL_TCP_TOOL
    || !isExactFullTcpNmapSelection(tool.arguments)
    || !actionTarget
    || !toolTarget
    || actionTarget !== toolTarget
    || !binding
    || input.argumentsHash !== binding.argumentsHash
  ) {
    return { ok: false, reason: "the durable Autonomous action no longer matches the exact current full-TCP contract boundary" };
  }
  const targetScope = database.prepare(`
    SELECT
      MAX(CASE WHEN disposition = 'allowed' THEN 1 ELSE 0 END) AS allowed,
      MAX(CASE WHEN disposition = 'prohibited' THEN 1 ELSE 0 END) AS prohibited
    FROM mission_targets
    WHERE mission_id = ? AND normalized_target = ?
  `).get(row.run_mission_id, actionTarget) as { allowed: number | null; prohibited: number | null };
  if (targetScope.allowed !== 1 || targetScope.prohibited === 1) {
    return { ok: false, reason: "the exact full-TCP target is no longer in the authorized mission scope" };
  }
  const budgets = budgetBinding(row, input.at);
  if (!budgets) {
    return { ok: false, reason: "finite signed wall-clock and tool-call budgets with remaining capacity are required" };
  }
  return {
    ok: true,
    snapshot: {
      actionFingerprint: row.action_fingerprint,
      missionId: row.run_mission_id,
      runId: row.action_run_id,
      stepId: row.step_id,
      assignmentId: row.assignment_id,
      planId: row.plan_id,
      planVersion: row.plan_version,
      contractId: row.contract_id,
      contractVersion: row.contract_version,
      contractHash: row.contract_hash,
      normalizedTarget: actionTarget,
      specialistAgentId: row.assignment_agent_id,
      destructivePolicy: destructivePolicy as AuthoritySnapshot["destructivePolicy"],
      argumentsHash: binding.argumentsHash,
      ...budgets,
    },
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function capabilityDigest(actionId: string, fingerprint: string): string {
  return sha256(`${actionId}\0${fingerprint}`);
}

function capabilityAuditId(
  kind: CapabilityAuditKind,
  actionId: string,
  fingerprint: string,
): string {
  return `audit_mcp_full_tcp_${kind}_${capabilityDigest(actionId, fingerprint)}`;
}

function auditAction(kind: CapabilityAuditKind): string {
  return kind === "issued" ? ISSUED_AUDIT_ACTION : CONSUMED_AUDIT_ACTION;
}

function auditReason(kind: CapabilityAuditKind): string {
  return kind === "issued"
    ? "Runtime issued one exact contract-bound Autonomous full-TCP capability"
    : "Bridge verifier atomically consumed one exact Autonomous full-TCP capability";
}

function auditHashBody(row: Omit<CapabilityAuditRow, "record_hash" | "details_json"> & {
  readonly details: Readonly<Record<string, unknown>>;
}): Readonly<Record<string, unknown>> {
  return {
    id: row.id,
    missionId: row.mission_id,
    runId: row.run_id,
    journey: row.journey,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    reason: row.reason,
    details: row.details,
    previousHash: row.previous_hash,
    occurredAt: row.occurred_at,
  };
}

function appendCapabilityAudit(input: {
  readonly database: SqliteDatabase;
  readonly kind: CapabilityAuditKind;
  readonly attestation: AutonomousFullTcpAttestation;
  readonly occurredAt: string;
  readonly envelopeHash: string;
}): boolean {
  const id = capabilityAuditId(
    input.kind,
    input.attestation.actionId,
    input.attestation.actionFingerprint,
  );
  const previous = input.database.prepare(
    "SELECT record_hash FROM audit_records ORDER BY rowid DESC LIMIT 1",
  ).get() as { readonly record_hash: string } | undefined;
  const details: Readonly<Record<string, unknown>> = input.kind === "issued"
    ? {
      schemaVersion: 1,
      lifecycle: "issued",
      envelopeHash: input.envelopeHash,
      attestation: input.attestation,
    }
    : {
      schemaVersion: 1,
      lifecycle: "consumed",
      issuedAuditId: capabilityAuditId(
        "issued",
        input.attestation.actionId,
        input.attestation.actionFingerprint,
      ),
      envelopeHash: input.envelopeHash,
      claimId: input.attestation.claimId,
      actionId: input.attestation.actionId,
      actionFingerprint: input.attestation.actionFingerprint,
      argumentsHash: input.attestation.argumentsHash,
      consumedAt: input.occurredAt,
    };
  const row = {
    id,
    mission_id: input.attestation.missionId,
    run_id: input.attestation.runId,
    journey: "autonomous",
    actor_type: "system",
    actor_id: RUNTIME_ACTOR,
    action: auditAction(input.kind),
    resource_type: CAPABILITY_RESOURCE_TYPE,
    resource_id: input.attestation.actionId,
    reason: auditReason(input.kind),
    previous_hash: previous?.record_hash ?? null,
    occurred_at: input.occurredAt,
    details,
  } as const;
  const recordHash = sha256(`${row.previous_hash ?? ""}\n${canonicalJson(auditHashBody(row))}`);
  const inserted = input.database.prepare(`
    INSERT OR IGNORE INTO audit_records (
      id, mission_id, run_id, journey, actor_type, actor_id, action,
      resource_type, resource_id, reason, details_json, previous_hash,
      record_hash, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.mission_id,
    row.run_id,
    row.journey,
    row.actor_type,
    row.actor_id,
    row.action,
    row.resource_type,
    row.resource_id,
    row.reason,
    canonicalJson(row.details),
    row.previous_hash,
    recordHash,
    row.occurred_at,
  );
  return inserted.changes === 1;
}

function readCapabilityAudit(
  database: SqliteDatabase,
  kind: CapabilityAuditKind,
  actionId: string,
  fingerprint: string,
): { readonly row: CapabilityAuditRow; readonly details: Readonly<Record<string, unknown>> } | null {
  const row = database.prepare(`
    SELECT id, mission_id, run_id, journey, actor_type, actor_id, action,
      resource_type, resource_id, reason, details_json, previous_hash,
      record_hash, occurred_at
    FROM audit_records
    WHERE id = ?
  `).get(capabilityAuditId(kind, actionId, fingerprint)) as CapabilityAuditRow | undefined;
  if (!row) return null;
  const details = parseObject(row.details_json);
  const expectedHash = sha256(`${row.previous_hash ?? ""}\n${canonicalJson(auditHashBody({
    ...row,
    details,
  }))}`);
  if (
    row.mission_id === null
    || row.run_id === null
    || row.journey !== "autonomous"
    || row.actor_type !== "system"
    || row.actor_id !== RUNTIME_ACTOR
    || row.action !== auditAction(kind)
    || row.resource_type !== CAPABILITY_RESOURCE_TYPE
    || row.resource_id !== actionId
    || row.reason !== auditReason(kind)
    || row.record_hash !== expectedHash
  ) return null;
  if (row.previous_hash !== null) {
    const predecessor = database.prepare(
      "SELECT 1 AS present FROM audit_records WHERE record_hash = ? LIMIT 1",
    ).get(row.previous_hash) as { readonly present: number } | undefined;
    if (!predecessor) return null;
  }
  return { row, details };
}

function issuedEnvelope(database: SqliteDatabase, attestation: AutonomousFullTcpAttestation): {
  readonly attestation: Readonly<Record<string, unknown>>;
  readonly envelopeHash: string;
} | null {
  const audit = readCapabilityAudit(
    database,
    "issued",
    attestation.actionId,
    attestation.actionFingerprint,
  );
  if (!audit) return null;
  const value = audit.details;
  if (
    audit.row.mission_id !== attestation.missionId
    || audit.row.run_id !== attestation.runId
    || audit.row.occurred_at !== attestation.resolvedAt
    || value.schemaVersion !== 1
    || value.lifecycle !== "issued"
    || !value.attestation || typeof value.attestation !== "object" || Array.isArray(value.attestation)
    || typeof value.envelopeHash !== "string"
  ) return null;
  return {
    attestation: value.attestation as Readonly<Record<string, unknown>>,
    envelopeHash: value.envelopeHash,
  };
}

function snapshotMatchesAttestation(
  snapshot: AuthoritySnapshot,
  attestation: AutonomousFullTcpAttestation,
): boolean {
  return (
    snapshot.actionFingerprint === attestation.actionFingerprint
    && snapshot.missionId === attestation.missionId
    && snapshot.runId === attestation.runId
    && snapshot.stepId === attestation.stepId
    && snapshot.assignmentId === attestation.assignmentId
    && snapshot.planId === attestation.planId
    && snapshot.planVersion === attestation.planVersion
    && snapshot.contractId === attestation.contractId
    && snapshot.contractVersion === attestation.contractVersion
    && snapshot.contractHash === attestation.contractHash
    && snapshot.normalizedTarget === attestation.normalizedTarget
    && snapshot.specialistAgentId === attestation.specialistAgentId
    && snapshot.destructivePolicy === attestation.destructivePolicy
    && snapshot.argumentsHash === attestation.argumentsHash
    && snapshot.wallClockLimitMs === attestation.wallClockLimitMs
    && snapshot.remainingWallClockMs === attestation.remainingWallClockMs
    && snapshot.toolCallLimit === attestation.toolCallLimit
    && snapshot.remainingToolCalls === attestation.remainingToolCalls
  );
}

function currentSnapshotStillMatchesAttestation(
  snapshot: AuthoritySnapshot,
  attestation: AutonomousFullTcpAttestation,
): boolean {
  return snapshotMatchesAttestation(
    { ...snapshot, remainingWallClockMs: attestation.remainingWallClockMs },
    attestation,
  ) && snapshot.remainingWallClockMs <= attestation.remainingWallClockMs;
}

/**
 * Mint and durably record one envelope for one already-authorized action. A
 * second adapter (or crash resume of the same action) cannot mint a competing
 * capability; recovery must create a new canonical action.
 */
export function createAutonomousFullTcpAttestation(input: {
  readonly database: SqliteDatabase;
  readonly action: DurableAction;
  readonly specialistAgentId: string;
  readonly mcpServer: string;
  readonly toolName: string;
  readonly arguments: unknown;
  readonly now: string;
}): AutonomousFullTcpAttestation {
  return inImmediateTransaction(input.database, () => {
    const binding = createMcpExecutionBinding({
      runId: input.action.runId,
      stepId: input.action.stepId,
      specialistAgentId: input.specialistAgentId,
      mcpServer: input.mcpServer,
      toolName: input.toolName,
      arguments: input.arguments,
    });
    const authority = currentAuthority(input.database, {
      actionId: input.action.id,
      runId: input.action.runId,
      stepId: input.action.stepId,
      specialistAgentId: input.specialistAgentId,
      mcpServer: input.mcpServer,
      toolName: input.toolName,
      argumentsHash: binding.argumentsHash,
      at: input.now,
    });
    if (!authority.ok) throw new Error(`Autonomous full-TCP execution denied: ${authority.reason}`);
    if (authority.snapshot.actionFingerprint !== input.action.fingerprint) {
      throw new Error("Autonomous full-TCP execution denied: the action fingerprint changed");
    }
    const ttlMs = Math.min(MAX_CLAIM_TTL_MS, authority.snapshot.remainingWallClockMs);
    const attestation: AutonomousFullTcpAttestation = {
      version: MCP_APPROVAL_ATTESTATION_VERSION,
      kind: "autonomous_full_tcp",
      claimId: `mcpclaim_${randomUUID()}`,
      actionId: input.action.id,
      actionFingerprint: authority.snapshot.actionFingerprint,
      missionId: authority.snapshot.missionId,
      assignmentId: authority.snapshot.assignmentId,
      planId: authority.snapshot.planId,
      planVersion: authority.snapshot.planVersion,
      contractId: authority.snapshot.contractId,
      contractVersion: authority.snapshot.contractVersion,
      contractHash: authority.snapshot.contractHash,
      normalizedTarget: authority.snapshot.normalizedTarget,
      actionClass: FULL_TCP_ACTION_CLASS,
      controlPlane: "command_os_v2",
      destructive: false,
      destructivePolicy: authority.snapshot.destructivePolicy,
      wallClockLimitMs: authority.snapshot.wallClockLimitMs,
      remainingWallClockMs: authority.snapshot.remainingWallClockMs,
      toolCallLimit: authority.snapshot.toolCallLimit,
      remainingToolCalls: authority.snapshot.remainingToolCalls,
      ...binding,
      actorId: RUNTIME_ACTOR,
      resolvedAt: input.now,
      expiresAt: new Date(Date.parse(input.now) + ttlMs).toISOString(),
    };
    const envelopeError = validateMcpApprovalAttestation(attestation, binding, input.now);
    if (envelopeError) throw new Error(`Autonomous full-TCP execution denied: ${envelopeError}`);
    const envelopeHash = hashJson(attestation);
    if (!appendCapabilityAudit({
      database: input.database,
      kind: "issued",
      attestation,
      occurredAt: input.now,
      envelopeHash,
    })) {
      throw new Error("Autonomous full-TCP execution denied: this exact action already has an issued capability");
    }
    return attestation;
  });
}

/** Atomically re-read current authority and consume one runtime-issued claim. */
export function verifyAndConsumeAutonomousFullTcpAttestation(
  database: SqliteDatabase,
  request: McpApprovalVerificationRequest,
): McpApprovalVerificationResult {
  const { attestation, binding, verifiedAt } = request;
  if (attestation.kind !== "autonomous_full_tcp") {
    return { approved: false, reason: "the Autonomous full-TCP verifier cannot verify this approval kind" };
  }
  const envelopeError = validateMcpApprovalAttestation(attestation, binding, verifiedAt);
  if (envelopeError) return { approved: false, reason: envelopeError };
  if (attestation.actorId !== RUNTIME_ACTOR) {
    return { approved: false, reason: "the Autonomous full-TCP capability was not issued by the runtime adapter" };
  }
  try {
    return inImmediateTransaction(database, () => {
      const issued = issuedEnvelope(database, attestation);
      const envelopeHash = hashJson(attestation);
      if (
        !issued
        || issued.envelopeHash !== envelopeHash
        || hashJson(issued.attestation) !== envelopeHash
      ) {
        return { approved: false, reason: "the runtime adapter did not issue this exact full-TCP capability" };
      }
      const issuedAuthority = currentAuthority(database, {
        actionId: attestation.actionId,
        runId: attestation.runId,
        stepId: attestation.stepId,
        specialistAgentId: attestation.specialistAgentId,
        mcpServer: attestation.mcpServer,
        toolName: attestation.toolName,
        argumentsHash: binding.argumentsHash,
        at: attestation.resolvedAt,
      });
      if (!issuedAuthority.ok) return { approved: false, reason: issuedAuthority.reason };
      if (!snapshotMatchesAttestation(issuedAuthority.snapshot, attestation)) {
        return { approved: false, reason: "the full-TCP action, plan, contract, target, arguments, or finite budget changed after issuance" };
      }
      const currentAuthoritySnapshot = currentAuthority(database, {
        actionId: attestation.actionId,
        runId: attestation.runId,
        stepId: attestation.stepId,
        specialistAgentId: attestation.specialistAgentId,
        mcpServer: attestation.mcpServer,
        toolName: attestation.toolName,
        argumentsHash: binding.argumentsHash,
        at: verifiedAt,
      });
      if (!currentAuthoritySnapshot.ok) {
        return { approved: false, reason: currentAuthoritySnapshot.reason };
      }
      if (!currentSnapshotStillMatchesAttestation(currentAuthoritySnapshot.snapshot, attestation)) {
        return { approved: false, reason: "the full-TCP action or remaining finite budget changed before consumption" };
      }
      const inserted = appendCapabilityAudit({
        database,
        kind: "consumed",
        attestation,
        occurredAt: verifiedAt,
        envelopeHash,
      });
      return inserted
        ? { approved: true }
        : { approved: false, reason: "the exact Autonomous full-TCP action capability was already consumed" };
    });
  } catch {
    return { approved: false, reason: "the durable Autonomous full-TCP verifier failed closed" };
  }
}
