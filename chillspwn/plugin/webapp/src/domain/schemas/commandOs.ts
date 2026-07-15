import type {
  AgentSummary,
  AttentionItem,
  AutonomousContextCandidate,
  AutonomousMissionPreflight,
  CreatedMission,
  Journey,
  MissionRecord,
  MissionPage,
  MissionSummary,
  OperationalEvent,
  OverviewSnapshot,
  ReadinessCheck,
  RunStatus,
} from "../types/commandOs";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as UnknownRecord;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a number`);
  return value;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function journey(value: unknown, label: string): Journey {
  if (value === "autonomous" || value === "guided") return value;
  throw new Error(`${label} must be autonomous or guided`);
}

function unwrap(payload: unknown): unknown {
  const value = record(payload, "response");
  return value.data && typeof value.data === "object" ? value.data : value;
}

function parseCheck(value: unknown): ReadinessCheck {
  const item = record(value, "readiness check");
  if (item.status !== "pass" && item.status !== "warn" && item.status !== "fail") {
    throw new Error("readiness check status is invalid");
  }
  return {
    id: text(item.id, "readiness check id"),
    label: text(item.label, "readiness check label"),
    status: item.status,
    impact: text(item.impact, "readiness check impact"),
    journeys: list(item.journeys).map((value) => journey(value, "readiness check journey")),
    remediation: optionalText(item.remediation),
  };
}

function parseReadiness(value: unknown): OverviewSnapshot["readiness"] {
  const readiness = record(value, "readiness");
  if (readiness.status !== "ready" && readiness.status !== "degraded" && readiness.status !== "blocked") {
    throw new Error("readiness status is invalid");
  }
  return {
    status: readiness.status,
    score: Math.max(0, Math.min(100, finiteNumber(readiness.score, "readiness score"))),
    checks: list(readiness.checks).map(parseCheck),
  };
}

function parseMission(value: unknown): MissionSummary {
  const item = record(value, "mission summary");
  const progress = typeof item.progress === "number" && Number.isFinite(item.progress)
    ? Math.max(0, Math.min(100, item.progress)) : undefined;
  return {
    id: text(item.id, "mission id"),
    title: text(item.title, "mission title"),
    journey: journey(item.journey, "mission journey"),
    status: text(item.status, "mission status"),
    updatedAt: text(item.updatedAt, "mission updatedAt"),
    currentPhase: optionalText(item.currentPhase),
    progress,
    nextAction: optionalText(item.nextAction),
  };
}

function parseAttention(value: unknown): AttentionItem {
  const item = record(value, "attention item");
  return {
    id: text(item.id, "attention id"),
    type: text(item.type, "attention type"),
    severity: text(item.severity, "attention severity"),
    title: text(item.title, "attention title"),
    summary: text(item.summary, "attention summary"),
    missionId: optionalText(item.missionId),
    runId: optionalText(item.runId),
  };
}

function parseAgent(value: unknown): AgentSummary {
  const item = record(value, "agent summary");
  return {
    id: text(item.id, "agent id"),
    name: text(item.name, "agent name"),
    status: text(item.status, "agent status"),
    assignment: optionalText(item.assignment),
  };
}

export function parseOverview(payload: unknown): OverviewSnapshot {
  const value = record(unwrap(payload), "overview");
  const summary = record(value.summary, "overview summary");
  const brain = record(value.brain, "overview brain");
  const system = record(value.system, "overview system");
  if (value.schemaVersion !== "2.1") throw new Error("unsupported overview schema version");
  return {
    schemaVersion: "2.1",
    readiness: parseReadiness(value.readiness),
    summary: {
      activeMissions: finiteNumber(summary.activeMissions, "active mission count"),
      activeAgents: finiteNumber(summary.activeAgents, "active agent count"),
      pendingDecisions: finiteNumber(summary.pendingDecisions, "pending decision count"),
      recoveringRuns: finiteNumber(summary.recoveringRuns, "recovering run count"),
      lastEventAt: summary.lastEventAt === null ? null : text(summary.lastEventAt, "last event time"),
    },
    missions: list(value.missions).map(parseMission),
    attention: list(value.attention).map(parseAttention),
    agents: list(value.agents).map(parseAgent),
    brain: {
      confirmed: finiteNumber(brain.confirmed, "confirmed memory count"),
      candidates: finiteNumber(brain.candidates, "candidate memory count"),
      stale: finiteNumber(brain.stale, "stale memory count"),
      conflicts: finiteNumber(brain.conflicts, "memory conflict count"),
      vaultStatus: text(brain.vaultStatus, "vault status"),
    },
    system: {
      database: text(system.database, "database status"),
      eventStream: text(system.eventStream, "event stream status"),
      providers: text(system.providers, "provider status"),
      mcp: text(system.mcp, "MCP status"),
    },
  };
}

function parseContextCandidate(value: unknown): AutonomousContextCandidate {
  const item = record(value, "Autonomous context candidate");
  const scope = record(item.scope, "Autonomous context scope");
  if (item.nodeType !== "preference" && item.nodeType !== "lesson") throw new Error("context node type is invalid");
  if (item.lifecycleStatus !== "confirmed" && item.lifecycleStatus !== "verified") throw new Error("context lifecycle is invalid");
  if (scope.kind !== "global" && scope.kind !== "engagement") throw new Error("context scope is invalid");
  if (item.sensitivity !== "public" && item.sensitivity !== "internal" && item.sensitivity !== "private") {
    throw new Error("context sensitivity is invalid");
  }
  return {
    id: text(item.id, "context node id"),
    nodeType: item.nodeType,
    title: text(item.title, "context title"),
    summary: text(item.summary, "context summary"),
    lifecycleStatus: item.lifecycleStatus,
    scope: {
      kind: scope.kind,
      ...(optionalText(scope.engagementId) ? { engagementId: optionalText(scope.engagementId) } : {}),
    },
    sensitivity: item.sensitivity,
    confidence: finiteNumber(item.confidence, "context confidence"),
    provenanceExplanation: text(item.provenanceExplanation, "context provenance"),
    updatedAt: text(item.updatedAt, "context updatedAt"),
  };
}

export function parseAutonomousMissionPreflight(payload: unknown): AutonomousMissionPreflight {
  const value = record(unwrap(payload), "Autonomous preflight");
  const contract = record(value.contract, "Autonomous contract review");
  const context = record(value.context, "Autonomous context preview");
  const summary = record(value.policySummary, "Autonomous policy summary");
  if (value.schemaVersion !== "2.1") throw new Error("unsupported Autonomous preflight schema version");
  if (contract.version !== 1) throw new Error("Autonomous contract version is invalid");
  const hash = text(contract.hash, "Autonomous contract hash");
  if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error("Autonomous contract hash is invalid");
  return {
    schemaVersion: "2.1",
    contract: { version: 1, hash },
    readiness: parseReadiness(value.readiness),
    context: {
      candidates: list(context.candidates).map(parseContextCandidate),
      selectedNodeIds: list(context.selectedNodeIds).map((item) => text(item, "selected context node ID")),
      invalidSelectedNodeIds: list(context.invalidSelectedNodeIds).map((item) => text(item, "invalid context node ID")),
    },
    policySummary: {
      provider: text(summary.provider, "provider policy summary"),
      tools: text(summary.tools, "tool policy summary"),
      notifications: text(summary.notifications, "notification policy summary"),
      reporting: text(summary.reporting, "reporting policy summary"),
      retention: text(summary.retention, "retention policy summary"),
      storage: text(summary.storage, "storage policy summary"),
    },
  };
}

export function parseMissionPage(payload: unknown): MissionPage {
  const value = record(unwrap(payload), "mission page");
  if (value.schemaVersion !== "2.1") throw new Error("unsupported mission page schema version");
  return {
    schemaVersion: "2.1",
    items: list(value.items).map(parseMission),
    nextCursor: value.nextCursor === null ? null : text(value.nextCursor, "mission page cursor"),
  };
}

function parseMissionRecord(value: unknown): MissionRecord {
  const item = record(value, "mission");
  return {
    id: text(item.id, "mission id"),
    title: text(item.title, "mission title"),
    journey: journey(item.journey, "mission journey"),
    status: text(item.status, "mission status"),
    version: finiteNumber(item.version, "mission version"),
    createdAt: text(item.createdAt, "mission createdAt"),
    updatedAt: text(item.updatedAt, "mission updatedAt"),
  };
}

const RUN_STATES = new Set<RunStatus>([
  "queued", "planning", "awaiting_contract_confirmation", "running",
  "waiting_guided_decision", "blocked", "recovering", "completed",
  "failed", "cancelled",
]);

export function parseCreatedMission(payload: unknown): CreatedMission {
  const value = record(unwrap(payload), "created mission");
  const run = record(value.run, "created run");
  const runStatus = text(run.status, "run status") as RunStatus;
  if (!RUN_STATES.has(runStatus)) throw new Error("created run status is invalid");
  return {
    mission: parseMissionRecord(value.mission),
    run: {
      id: text(run.id, "run id"),
      status: runStatus,
      journey: journey(run.journey, "run journey"),
    },
    nextUrl: text(value.nextUrl, "mission nextUrl"),
  };
}

export function parseOperationalEvent(payload: unknown): OperationalEvent {
  const value = record(payload, "operational event");
  return {
    id: text(value.id, "event id"),
    sequence: typeof value.sequence === "number" ? value.sequence : undefined,
    type: text(value.type, "event type"),
    timestamp: text(value.timestamp, "event timestamp"),
    missionId: optionalText(value.missionId),
    runId: optionalText(value.runId),
    journey: value.journey === undefined ? undefined : journey(value.journey, "event journey"),
    summary: text(value.summary, "event summary"),
  };
}
