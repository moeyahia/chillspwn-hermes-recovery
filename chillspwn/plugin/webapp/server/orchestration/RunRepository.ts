import type { SqliteDatabase } from "../db";
import {
  acquireLease,
  heartbeatLease,
  isRunState,
  type AutonomousContractBoundary,
  type BudgetKey,
  type BudgetState,
  type BudgetValues,
  type GuidedDecision,
  type Journey,
  type SupervisedRun,
} from "../supervisor";
import {
  DurableOrchestrationError,
  type DurableAction,
  type DurableControlState,
  type DurableRun,
  type RunLeaseToken,
} from "./types";
import { canonicalJson, parseObject } from "./serialization";

interface RunRow {
  readonly id: string;
  readonly mission_id: string;
  readonly journey: Journey;
  readonly status: string;
  readonly contract_id: string | null;
  readonly contract_version: number | null;
  readonly contract_confirmed_at: string | null;
  readonly budget_json: string;
  readonly budget_usage_json: string;
  readonly retry_count: number;
  readonly replan_count: number;
  readonly lease_owner: string | null;
  readonly lease_acquired_at: string | null;
  readonly last_heartbeat_at: string | null;
  readonly lease_expires_at: string | null;
  readonly started_at: string | null;
  readonly ended_at: string | null;
  readonly status_reason: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly version: number;
}

interface ContractRow {
  readonly id: string;
  readonly version: number;
  readonly state: "draft" | "confirmed" | "superseded" | "revoked";
  readonly action_policy_json: string;
}

interface TargetRow {
  readonly target: string;
}

interface GuidedDecisionRow {
  readonly id: string;
  readonly mission_id: string;
  readonly run_id: string;
  readonly step_id: string;
  readonly requested_action_fingerprint: string;
  readonly status: string;
  readonly decided_at: string | null;
  readonly expires_at: string;
  readonly consumed_count: number;
}

const BUDGET_KEYS: readonly BudgetKey[] = [
  "wallClockMs",
  "providerTokens",
  "estimatedCost",
  "toolCalls",
  "providerTurns",
  "retries",
  "replans",
  "concurrency",
  "evidenceBytes",
  "artifactBytes",
];

function isoMs(value: string | null): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function budgetValues(value: string, limits: boolean): BudgetValues {
  const source = parseObject(value);
  const result: Partial<Record<BudgetKey, number>> = {};
  for (const key of BUDGET_KEYS) {
    const candidate = source[key];
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0) {
      result[key] = candidate;
    }
  }
  if (limits) {
    if (typeof source.timeBudgetMinutes === "number" && source.timeBudgetMinutes >= 0) {
      result.wallClockMs = source.timeBudgetMinutes * 60_000;
    }
    if (typeof source.tokenBudget === "number" && source.tokenBudget >= 0) {
      result.providerTokens = source.tokenBudget;
    }
    if (typeof source.costBudget === "number" && source.costBudget >= 0) {
      result.estimatedCost = source.costBudget;
    }
    if (typeof source.retryBudget === "number" && source.retryBudget >= 0) {
      result.retries = source.retryBudget;
    }
    if (typeof source.replanBudget === "number" && source.replanBudget >= 0) {
      result.replans = source.replanBudget;
    }
    if (typeof source.concurrencyLimit === "number" && source.concurrencyLimit >= 0) {
      result.concurrency = source.concurrencyLimit;
    }
  }
  return result;
}

function mapRow(row: RunRow): DurableRun {
  if (!isRunState(row.status)) {
    throw new DurableOrchestrationError("invalid_run_state", `Run ${row.id} has invalid state ${row.status}`);
  }
  const lease = row.lease_owner && row.lease_expires_at
    ? {
        runId: row.id,
        ownerId: row.lease_owner,
        fence: row.version,
        expiresAt: row.lease_expires_at,
      }
    : null;
  const run: SupervisedRun = {
    id: row.id,
    missionId: row.mission_id,
    journey: row.journey,
    state: row.status,
    launched: row.started_at !== null,
    ...(row.contract_version === null ? {} : { contractVersion: row.contract_version }),
    ...(row.contract_confirmed_at ? { contractConfirmedAt: row.contract_confirmed_at } : {}),
    stateVersion: row.version,
    stateReason: row.status_reason ?? `Run is ${row.status}`,
    createdAt: row.created_at,
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    updatedAt: row.updated_at,
    ...(row.ended_at ? { endedAt: row.ended_at } : {}),
  };
  return {
    run,
    contractId: row.contract_id,
    lease,
    control: {
      budget: {
        limits: budgetValues(row.budget_json, true),
        usage: budgetValues(row.budget_usage_json, false),
      },
      retryCount: row.retry_count,
      replanCount: row.replan_count,
      circuits: {},
      progress: {},
    },
  };
}

const RUN_SELECT = `
  SELECT r.*,
    c.version AS contract_version,
    c.confirmed_at AS contract_confirmed_at
  FROM runs r
  LEFT JOIN mission_contracts c ON c.id = r.contract_id
`;

export class RunRepository {
  constructor(private readonly database: SqliteDatabase) {}

  get(runId: string): DurableRun {
    const row = this.database
      .prepare(`${RUN_SELECT} WHERE r.id = ?`)
      .get(runId) as RunRow | undefined;
    if (!row) throw new DurableOrchestrationError("run_not_found", `Run not found: ${runId}`);
    return mapRow(row);
  }

  listExpiredNonterminal(now: string): DurableRun[] {
    const rows = this.database
      .prepare(`${RUN_SELECT}
        WHERE r.status NOT IN ('completed', 'failed', 'cancelled')
          AND r.lease_expires_at IS NOT NULL
          AND r.lease_expires_at <= ?
        ORDER BY r.lease_expires_at ASC, r.id ASC
      `)
      .all(now) as RunRow[];
    return rows.map(mapRow);
  }

  assertLease(run: DurableRun, token: RunLeaseToken, now: string): void {
    if (
      token.runId !== run.run.id ||
      !run.lease ||
      run.lease.ownerId !== token.ownerId ||
      run.lease.fence !== token.fence ||
      run.lease.expiresAt !== token.expiresAt
    ) {
      throw new DurableOrchestrationError("stale_lease", "Run lease owner or fencing token is stale");
    }
    if (Date.parse(run.lease.expiresAt) <= Date.parse(now)) {
      throw new DurableOrchestrationError("expired_lease", "Run lease has expired");
    }
  }

  acquire(runId: string, ownerId: string, now: string, ttlMs: number): RunLeaseToken {
    const current = this.get(runId);
    const existing = current.lease
      ? {
          resourceType: "run" as const,
          resourceId: runId,
          ownerId: current.lease.ownerId,
          acquiredAt: isoMs(
            (this.database.prepare("SELECT lease_acquired_at AS value FROM runs WHERE id = ?").get(runId) as { value: string | null }).value,
          ),
          lastHeartbeatAt: isoMs(
            (this.database.prepare("SELECT last_heartbeat_at AS value FROM runs WHERE id = ?").get(runId) as { value: string | null }).value,
          ),
          expiresAt: isoMs(current.lease.expiresAt),
          version: current.lease.fence,
        }
      : undefined;
    const acquired = acquireLease({
      existing,
      resourceType: "run",
      resourceId: runId,
      ownerId,
      now: Date.parse(now),
      ttlMs,
    });
    const expiresAt = new Date(acquired.expiresAt).toISOString();
    const result = this.database
      .prepare(`
        UPDATE runs SET
          lease_owner = ?, lease_acquired_at = ?, last_heartbeat_at = ?,
          lease_expires_at = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?
      `)
      .run(ownerId, now, now, expiresAt, now, runId, current.run.stateVersion);
    if (result.changes !== 1) throw new DurableOrchestrationError("lease_conflict", "Run changed while acquiring lease");
    return { runId, ownerId, fence: current.run.stateVersion + 1, expiresAt };
  }

  heartbeat(token: RunLeaseToken, now: string, ttlMs: number): RunLeaseToken {
    const current = this.get(token.runId);
    this.assertLease(current, token, now);
    const refreshed = heartbeatLease({
      lease: {
        resourceType: "run",
        resourceId: token.runId,
        ownerId: token.ownerId,
        acquiredAt: Date.parse(
          (this.database.prepare("SELECT lease_acquired_at AS value FROM runs WHERE id = ?").get(token.runId) as { value: string }).value,
        ),
        lastHeartbeatAt: Date.parse(current.run.updatedAt),
        expiresAt: Date.parse(token.expiresAt),
        version: token.fence,
      },
      ownerId: token.ownerId,
      expectedVersion: token.fence,
      now: Date.parse(now),
      ttlMs,
    });
    const expiresAt = new Date(refreshed.expiresAt).toISOString();
    const result = this.database
      .prepare(`
        UPDATE runs SET last_heartbeat_at = ?, lease_expires_at = ?,
          version = version + 1, updated_at = ?
        WHERE id = ? AND lease_owner = ? AND version = ?
      `)
      .run(now, expiresAt, now, token.runId, token.ownerId, token.fence);
    if (result.changes !== 1) throw new DurableOrchestrationError("stale_lease", "Heartbeat fencing token is stale");
    return { ...token, fence: token.fence + 1, expiresAt };
  }

  persistMutation(input: {
    current: DurableRun;
    nextRun: SupervisedRun;
    control: DurableControlState;
    now: string;
    lease: "keep" | "clear" | { ownerId: string; expiresAt: string; acquiredAt?: string };
  }): DurableRun {
    const expected = input.current.run.stateVersion;
    if (input.nextRun.stateVersion !== expected + 1) {
      throw new DurableOrchestrationError("invalid_fence_advance", "Every durable run mutation must advance the fence exactly once");
    }
    const retained = input.lease === "keep" ? input.current.lease : null;
    const replacement = typeof input.lease === "object" ? input.lease : null;
    const owner = replacement?.ownerId ?? retained?.ownerId ?? null;
    const acquiredAt = replacement?.acquiredAt ?? (owner ? input.now : null);
    const expiresAt = replacement?.expiresAt ?? retained?.expiresAt ?? null;
    const heartbeatAt = owner ? input.now : null;
    const startedAt = input.nextRun.launched ? input.nextRun.updatedAt : null;
    const result = this.database
      .prepare(`
        UPDATE runs SET
          status = ?, status_reason = ?, budget_json = ?, budget_usage_json = ?,
          retry_count = ?, replan_count = ?, lease_owner = ?,
          lease_acquired_at = CASE
            WHEN ? IS NULL THEN NULL
            WHEN ? = 1 THEN ?
            ELSE lease_acquired_at
          END,
          last_heartbeat_at = ?, lease_expires_at = ?,
          started_at = CASE WHEN ? IS NULL THEN started_at ELSE COALESCE(started_at, ?) END,
          ended_at = ?, updated_at = ?, version = ?
        WHERE id = ? AND version = ?
      `)
      .run(
        input.nextRun.state,
        input.nextRun.stateReason,
        canonicalJson(input.control.budget.limits),
        canonicalJson(input.control.budget.usage),
        input.control.retryCount,
        input.control.replanCount,
        owner,
        owner,
        replacement ? 1 : 0,
        acquiredAt,
        heartbeatAt,
        expiresAt,
        startedAt,
        startedAt,
        input.nextRun.endedAt ?? null,
        input.now,
        input.nextRun.stateVersion,
        input.current.run.id,
        expected,
      );
    if (result.changes !== 1) throw new DurableOrchestrationError("stale_lease", "Run mutation lost its fencing race");
    return {
      ...input.current,
      run: input.nextRun,
      lease: owner && expiresAt
        ? { runId: input.current.run.id, ownerId: owner, fence: input.nextRun.stateVersion, expiresAt }
        : null,
      control: input.control,
    };
  }

  autonomousContract(run: DurableRun): AutonomousContractBoundary | undefined {
    if (!run.contractId) return undefined;
    const contract = this.database
      .prepare("SELECT id, version, state, action_policy_json FROM mission_contracts WHERE id = ?")
      .get(run.contractId) as ContractRow | undefined;
    if (!contract) return undefined;
    const policy = parseObject(contract.action_policy_json);
    const allowed = Array.isArray(policy.allowedActionClasses)
      ? policy.allowedActionClasses.filter((value): value is string => typeof value === "string")
      : [];
    const prohibited = Array.isArray(policy.prohibitedActionClasses)
      ? policy.prohibitedActionClasses.filter((value): value is string => typeof value === "string")
      : [];
    const targets = this.database
      .prepare("SELECT target FROM mission_targets WHERE mission_id = ? AND disposition = 'allowed' ORDER BY id")
      .all(run.run.missionId) as TargetRow[];
    return {
      runId: run.run.id,
      version: contract.version,
      status: contract.state === "confirmed" ? "signed" : contract.state === "superseded" ? "superseded" : "draft",
      allowedActionTypes: allowed,
      prohibitedActionTypes: prohibited,
      allowedTargets: targets.map((row) => row.target),
    };
  }

  /**
   * Re-check the failed action against current canonical authorization and the
   * currently signed contract. Recovery must never rely on the historical fact
   * that an action was once allowed.
   */
  autonomousActionRemainsInContract(run: DurableRun, action: DurableAction): boolean {
    if (run.run.journey !== "autonomous" || action.runId !== run.run.id) return false;
    const mission = this.database.prepare(
      "SELECT authorization_status FROM missions WHERE id = ?",
    ).get(run.run.missionId) as { authorization_status: string } | undefined;
    if (mission?.authorization_status !== "verified") return false;
    const contract = this.autonomousContract(run);
    if (
      !contract || contract.status !== "signed" ||
      contract.version !== run.run.contractVersion ||
      !run.contractId || action.contractId !== run.contractId
    ) return false;
    const normalizedType = action.actionType.trim().toLowerCase();
    const allowed = new Set(contract.allowedActionTypes.map((value) => value.trim().toLowerCase()));
    const prohibited = new Set((contract.prohibitedActionTypes ?? []).map((value) => value.trim().toLowerCase()));
    return allowed.has(normalizedType)
      && !prohibited.has(normalizedType)
      && contract.allowedTargets.includes(action.target.trim());
  }

  guidedDecision(decisionId: string): GuidedDecision | undefined {
    const row = this.database
      .prepare(`
        SELECT gd.*,
          (SELECT COUNT(*) FROM actions a WHERE a.guided_decision_id = gd.id) AS consumed_count
        FROM guided_decisions gd WHERE gd.id = ?
      `)
      .get(decisionId) as GuidedDecisionRow | undefined;
    if (!row) return undefined;
    const status: GuidedDecision["status"] = row.consumed_count > 0
      ? "consumed"
      : row.status === "approved"
        ? "authorized"
        : row.status === "pending"
          ? "pending"
          : row.status === "expired"
            ? "expired"
            : "rejected";
    return {
      id: row.id,
      missionId: row.mission_id,
      runId: row.run_id,
      stepId: row.step_id,
      journey: "guided",
      actionFingerprint: row.requested_action_fingerprint,
      status,
      ...(row.decided_at ? { authorizedAt: row.decided_at } : {}),
      expiresAt: row.expires_at,
      version: row.consumed_count > 0 ? 2 : 1,
    };
  }
}
