import { autonomousContractHash, hashCanonical } from "./canonical";
import { AutonomousReadinessError } from "./errors";
import { MissionRepository, type ListMissionsOptions } from "./MissionRepository";
import { OverviewRepository } from "./OverviewRepository";
import { ReadinessService } from "./ReadinessService";
import type {
  AutonomousMissionPreflight,
  AutonomousMissionRequest,
  CreatedMission,
  MissionCreateRequest,
  MissionListPage,
  OverviewSnapshot,
} from "./types";

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
  ) {}

  async preflightAutonomous(request: AutonomousMissionRequest): Promise<AutonomousMissionPreflight> {
    const contractHash = autonomousContractHash(request);
    const base = await this.readiness.evaluateJourney("autonomous", { request });
    const context = this.missions.autonomousContextPreview(request);
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
    return {
      schemaVersion: "2.1",
      contract: { version: 1, hash: contractHash },
      readiness: readinessSummary(checks),
      context,
      policySummary: {
        provider: "Automatic selection; only authenticated paths behind the enforceable Autonomous boundary are eligible.",
        tools: "Exact signed action-class and target allowlists; specialist assignment is mandatory.",
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

    return this.missions.create({
      request,
      requestHash,
      idempotencyKey,
      actorId,
    });
  }

  async getOverview(): Promise<OverviewSnapshot> {
    const readiness = await this.readiness.evaluate();
    return { ...this.overview.readData(), readiness };
  }

  list(options: ListMissionsOptions = {}): MissionListPage {
    return this.missions.list(options);
  }
}
