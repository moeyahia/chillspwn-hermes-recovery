import { autonomousContractHash, hashCanonical } from "./canonical";
import {
  BrainContextHookError,
  type BrainContextService,
  retrieveMissionBrainContext,
} from "../brain-runtime";
import { AutonomousReadinessError } from "./errors";
import { MissionRepository, type ListMissionsOptions } from "./MissionRepository";
import { OverviewRepository } from "./OverviewRepository";
import { ReadinessService } from "./ReadinessService";
import type {
  AutonomousMissionPreflight,
  AutonomousMissionRequest,
  CreatedMission,
  MissionCreateRequest,
  MissionIntakeContextBinding,
  MissionListPage,
  OverviewSnapshot,
} from "./types";

function missionIntakeQuery(request: MissionCreateRequest): string {
  const targets = request.journey === "autonomous"
    ? request.authorization.allowedTargets
    : request.target ? [request.target] : [];
  return [
    `${request.journey} authorized mission intake`,
    request.title,
    request.objective,
    ...targets,
  ].join("\n");
}

function redactedMissionIntakeQuery(request: MissionCreateRequest): string {
  const targetCount = request.journey === "autonomous"
    ? request.authorization.allowedTargets.length
    : request.target ? 1 : 0;
  return `${request.journey} mission intake; ${targetCount} authorized target reference${targetCount === 1 ? "" : "s"}; objective and target identifiers retained locally only`;
}

function readinessSummary(checks: AutonomousMissionPreflight["readiness"]["checks"]): AutonomousMissionPreflight["readiness"] {
  const status = checks.some((check) => check.status === "fail")
    ? "blocked"
    : checks.some((check) => check.status === "warn")
      ? "degraded"
      : "ready";
  const points = checks.reduce(
    (total, check) => total + (check.status === "pass" ? 100 : check.status === "warn" ? 65 : 0),
    0,
  );
  return {
    status,
    score: checks.length === 0 ? 0 : Math.round(points / checks.length),
    checks,
  };
}

export class MissionService {
  constructor(
    private readonly missions: MissionRepository,
    private readonly overview: OverviewRepository,
    private readonly readiness: ReadinessService,
    private readonly brainContext: BrainContextService,
  ) {}

  async preflightAutonomous(request: AutonomousMissionRequest): Promise<AutonomousMissionPreflight> {
    const contractHash = autonomousContractHash(request);
    const base = await this.readiness.evaluateJourney("autonomous", { request });
    const context = this.missions.autonomousContextPreview(request);
    const execution = this.missions.autonomousExecutionPreview(request);
    const checks = [...base.checks];
    checks.push(context.invalidSelectedNodeIds.length > 0
      ? {
          id: "contract_memory_selection",
          label: "Selected Second Brain context",
          status: "fail",
          journeys: ["autonomous"],
          impact: `${context.invalidSelectedNodeIds.length} selected memory node${context.invalidSelectedNodeIds.length === 1 ? " is" : "s are"} no longer eligible for this mission scope.`,
          remediation: "Remove stale, unconfirmed, restricted, expired, or cross-engagement nodes and review the contract again.",
        }
      : {
          id: "contract_memory_selection",
          label: "Selected Second Brain context",
          status: "pass",
          journeys: ["autonomous"],
          impact: context.selectedNodeIds.length > 0
            ? `${context.selectedNodeIds.length} exact confirmed or verified memory node${context.selectedNodeIds.length === 1 ? " is" : "s are"} permitted; broader retrieval is disabled.`
            : "No retained memory was selected, so this run will plan without Second Brain context.",
        });
    if (request.contractReview && (
      request.contractReview.version !== 1 || request.contractReview.hash !== contractHash
    )) {
      checks.push({
        id: "contract_review_integrity",
        label: "Contract review integrity",
        status: "fail",
        journeys: ["autonomous"],
        impact: "The submitted review digest does not match the current contract contents.",
        remediation: "Run preflight again and deliberately review the newly issued version and digest.",
      });
    } else {
      checks.push({
        id: "contract_review_integrity",
        label: "Contract review integrity",
        status: "pass",
        journeys: ["autonomous"],
        impact: request.contractReview
          ? "The operator-reviewed version and SHA-256 match the exact contract that will be persisted."
          : "The server issued a versioned SHA-256 for deliberate review before launch.",
      });
    }
    const compatibleProviders = execution.providers.filter((provider) => provider.compatible);
    checks.push(compatibleProviders.length > 0
      ? {
          id: "contract_provider_inventory",
          label: "Inspected enforcing provider paths",
          status: "pass",
          journeys: ["autonomous"],
          impact: `${compatibleProviders.length} projected authenticated provider path${compatibleProviders.length === 1 ? " is" : "s are"} compatible with the Autonomous boundary; live readiness is also rechecked at launch.`,
        }
      : {
          id: "contract_provider_inventory",
          label: "Inspected enforcing provider paths",
          status: "fail",
          journeys: ["autonomous"],
          impact: "The canonical runtime projection contains no authenticated provider path compatible with the Autonomous boundary.",
          remediation: "Restore an enforcing provider, wait for runtime projection health to update, and rerun preflight.",
        });
    const selectedCount = execution.team.selectedAgentIds.length;
    const invalidCount = execution.team.invalidSelectedAgentIds.length;
    checks.push(selectedCount === 0
      ? {
          id: "contract_specialist_selection",
          label: "Signed specialist pool",
          status: "fail",
          journeys: ["autonomous"],
          impact: "No exact specialist is selected, so the planner would not have a reviewed assignment boundary.",
          remediation: "Select at least one compatible specialist from the inspected fleet.",
        }
      : invalidCount > 0 || execution.team.effectiveAgentIds.length === 0
        ? {
            id: "contract_specialist_selection",
            label: "Signed specialist pool",
            status: "fail",
            journeys: ["autonomous"],
            impact: `${invalidCount} selected specialist${invalidCount === 1 ? " is" : "s are"} unavailable, unknown, or incompatible with this contract.`,
            remediation: "Remove incompatible specialists and select at least one candidate marked compatible.",
          }
        : {
            id: "contract_specialist_selection",
            label: "Signed specialist pool",
            status: "pass",
            journeys: ["autonomous"],
            impact: `${execution.team.effectiveAgentIds.length} exact compatible specialist${execution.team.effectiveAgentIds.length === 1 ? " is" : "s are"} bound into the contract and planner inventory.`,
          });
    return {
      schemaVersion: "2.4",
      contract: { version: 1, hash: contractHash },
      readiness: readinessSummary(checks),
      context,
      execution,
      policySummary: {
        provider: `Automatic selection across ${compatibleProviders.length} inspected authenticated enforcing path${compatibleProviders.length === 1 ? "" : "s"}.`,
        tools: `${execution.tools.filter((tool) => tool.enabled && tool.startPermitted && (tool.status === "healthy" || tool.status === "degraded")).length} inspected runnable MCP server binding${execution.tools.length === 1 ? "" : "s"}; planner assignments are restricted to ${execution.team.effectiveAgentIds.length} signed specialist${execution.team.effectiveAgentIds.length === 1 ? "" : "s"}.`,
        notifications: "In-product semantic events only; no external channel is implied.",
        reporting: "Scope-checked Command OS JSON completion bundle with integrity digest.",
        retention: "Local private data plane with operator-managed retention; no unenforced automatic expiry is promised.",
        storage: `${request.contract.evidenceStorageBudgetBytes} evidence bytes and ${request.contract.artifactStorageBudgetBytes} artifact bytes.`,
      },
    };
  }

  async create(
    request: MissionCreateRequest,
    idempotencyKey: string,
    actorId: string,
  ): Promise<CreatedMission> {
    const requestHash = hashCanonical(request);
    const replay = this.missions.getIdempotentCreate(idempotencyKey, requestHash);
    if (replay) return replay;

    if (request.journey === "autonomous") {
      const readiness = (await this.preflightAutonomous(request)).readiness;
      const blockers = readiness.checks.filter((check) => check.status === "fail");
      if (blockers.length > 0) {
        throw new AutonomousReadinessError({
          status: readiness.status,
          score: readiness.score,
          checks: blockers.map((check) => ({
            id: check.id,
            label: check.label,
            status: check.status,
            impact: check.impact,
            journeys: [...check.journeys],
            remediation: check.remediation ?? null,
          })),
        });
      }
    }

    try {
      return this.missions.create({
        request,
        requestHash,
        idempotencyKey,
        actorId,
        resolveIntakeContext: ({ missionId, memoryPolicy }): MissionIntakeContextBinding => {
          const result = retrieveMissionBrainContext({
            brainContext: this.brainContext,
            hook: "intake",
            journey: request.journey,
            missionId,
            actorId,
            actorType: "operator",
            query: missionIntakeQuery(request),
            queryRedacted: redactedMissionIntakeQuery(request),
            memoryPolicy,
          });
          this.brainContext.recordUnusedContext(
            result,
            "Mission intake defaults remained deterministic; this Context Pack was retrieved for scope-safe continuity and did not alter inferred fields.",
          );
          return {
            hook: "intake",
            contextPackId: result.contextPack.id,
            auditRecordId: result.auditRecordId,
            status: result.status,
            retrievedCount: result.items.length,
            memoryInfluencedDefaults: false,
            ...(result.degradation ? { degradation: result.degradation } : {}),
          };
        },
      });
    } catch (error) {
      if (!(error instanceof BrainContextHookError) || error.hook !== "intake") throw error;
      let auditRecordId: string | undefined;
      try {
        auditRecordId = this.missions.recordIntakeContextBlocked({
          requestHash,
          journey: request.journey,
          actorId,
          code: error.code,
          explanation: error.message,
        });
      } catch {
        // Preserve the original fail-closed error when the database cannot
        // retain even the privacy-safe, unscoped attempt receipt.
      }
      throw new BrainContextHookError(
        error.code,
        error.hook,
        error.message,
        auditRecordId,
        { cause: error },
      );
    }
  }

  async getOverview(): Promise<OverviewSnapshot> {
    const readiness = await this.readiness.evaluate();
    return { ...this.overview.readData(), readiness };
  }

  list(options: ListMissionsOptions = {}): MissionListPage {
    return this.missions.list(options);
  }
}
