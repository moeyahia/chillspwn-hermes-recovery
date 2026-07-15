import { createHash, randomUUID } from "node:crypto";
import type { SqliteDatabase } from "../db";
import { inImmediateTransaction } from "../db";
import { MemoryRepository, SecondBrainService } from "../memory";
import type { ContextPack, MemoryNodeType } from "../memory/types";
import type { DurableAction } from "../orchestration";
import { classifyFailure, type FailureCategory, type ProgressSnapshot } from "../supervisor";
import type {
  ExecutionResult,
  ExecutionResultSink,
  MissionOutcomeEvaluatorPort,
  MissionPlanDraft,
  MissionPlannerPort,
  PlanningMission,
  ProviderUsageReport,
  ResultAwareExecutionPort,
} from "../command-runtime/types";
import { CommandRuntimeError } from "../command-runtime/types";
import { validateMissionPlanDraft } from "../command-runtime/validation";

export type GrokOAuthCaller = (
  prompt: string,
  signal: AbortSignal,
) => Promise<string | GrokOAuthTurnResult>;

export interface GrokOAuthTurnResult {
  readonly text: string;
  /** Exact values copied from ACP metadata. Missing values stay missing. */
  readonly usage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly providerTokens?: number;
    readonly estimatedCost?: number;
  };
}

export interface CommandOsToolInventory {
  readonly agentId: string;
  readonly role: string;
  readonly description: string;
  readonly mcpServer: string;
  readonly toolNames: readonly string[];
  readonly safetyBoundaries: readonly string[];
}

export interface CommandOsMcpResult {
  readonly success: boolean;
  readonly mcpServer: string;
  readonly toolName: string;
  readonly outputPreview: string;
  readonly fullOutputBytes: number;
  readonly evidenceIds: readonly string[];
  readonly error: string | null;
  readonly isError: boolean;
  readonly durationMs: number;
}

export interface CommandOsRuntimeAdapterOptions {
  readonly database: SqliteDatabase;
  readonly callGrok: GrokOAuthCaller;
  readonly inventory: () => readonly CommandOsToolInventory[];
  readonly executeMcp: (input: {
    readonly specialistAgentId: string;
    readonly mcpServer: string;
    readonly toolName: string;
    readonly arguments: unknown;
    readonly startedAtMs: number;
    readonly signal: AbortSignal;
  }) => Promise<CommandOsMcpResult>;
  readonly now?: () => Date;
}

interface ParsedPlanEnvelope extends MissionPlanDraft {
  readonly contextUsed?: readonly {
    readonly id: string;
    readonly influence: string;
  }[];
}

interface ParsedEvaluation {
  readonly summary?: unknown;
  readonly criteria?: readonly {
    readonly criterion?: unknown;
    readonly satisfied?: unknown;
    readonly explanation?: unknown;
    readonly evidenceIds?: unknown;
  }[];
}

const CANONICAL_RISK: Readonly<Record<string, MissionPlanDraft["steps"][number]["riskClass"]>> = {
  low: "low",
  safe: "low",
  minimal: "low",
  informational: "low",
  medium: "medium",
  moderate: "medium",
  high: "high",
  elevated: "high",
  severe: "high",
  critical: "critical",
};

const SECRET_KEY = /(?:^|[_-])(api[_-]?key|auth|authorization|bearer|credential|password|private[_-]?key|secret|session|token)(?:$|[_-])/iu;

function extractJsonObject(text: string): string {
  const stripped = text.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim();
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  return first >= 0 && last > first ? stripped.slice(first, last + 1) : stripped;
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(text));
  } catch {
    throw new Error(`${label} did not return valid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} did not return a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Normalize only common presentation synonyms at the provider boundary. This
 * cannot authorize an action: target, action class, destructive flag, exact
 * MCP binding, and signed-contract checks are still validated independently.
 */
function normalizePlannerEnvelope(value: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(value.steps)) return value;
  return {
    ...value,
    steps: value.steps.map((step) => {
      if (!step || typeof step !== "object" || Array.isArray(step)) return step;
      const record = step as Record<string, unknown>;
      const risk = typeof record.riskClass === "string"
        ? CANONICAL_RISK[record.riskClass.trim().toLowerCase()]
        : undefined;
      return risk ? { ...record, riskClass: risk } : record;
    }),
  };
}

function json(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function boundedText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function grokTurn(value: string | GrokOAuthTurnResult): GrokOAuthTurnResult {
  return typeof value === "string" ? { text: value } : value;
}

function aggregateProviderUsage(reports: readonly ProviderUsageReport[]): ProviderUsageReport {
  const exactTokenUsage = reports.length > 0 && reports.every((report) => (
    report.exactTokenUsage && report.providerTokens !== undefined
  ));
  const exactCostUsage = reports.length > 0 && reports.every((report) => (
    report.exactCostUsage && report.estimatedCost !== undefined
  ));
  return {
    providerTurnId: reports.at(-1)?.providerTurnId,
    providerTurns: reports.reduce((total, report) => total + (report.providerTurns ?? 1), 0),
    ...(exactTokenUsage
      ? { providerTokens: reports.reduce((total, report) => total + (report.providerTokens ?? 0), 0) }
      : {}),
    ...(exactCostUsage
      ? { estimatedCost: reports.reduce((total, report) => total + (report.estimatedCost ?? 0), 0) }
      : {}),
    exactTokenUsage,
    exactCostUsage,
  };
}

function boundedPlanRepairAllowed(database: SqliteDatabase, runId: string): boolean {
  const row = database.prepare(`
    SELECT budget_json, budget_usage_json FROM runs WHERE id = ?
  `).get(runId) as { budget_json: string; budget_usage_json: string } | undefined;
  if (!row) return false;
  const limits = json(row.budget_json);
  const usage = json(row.budget_usage_json);
  const limit = Number(limits.providerTurns);
  if (!Number.isFinite(limit)) return true;
  const used = Number(usage.providerTurns);
  return (Number.isFinite(used) ? used : 0) + 2 <= limit;
}

function planRepairDiagnostic(error: unknown): { validationField: string; validationRule: string } | null {
  if (!(error instanceof CommandRuntimeError) || error.code !== "invalid_plan"
      || error.options.category !== "invalid_input") return null;
  const details = error.options.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  const validationField = details.validationField;
  const validationRule = details.validationRule;
  return typeof validationField === "string" && typeof validationRule === "string"
    ? { validationField, validationRule }
    : null;
}

function recordBoundedPlanRepair(
  database: SqliteDatabase,
  runId: string,
  diagnostic: { validationField: string; validationRule: string },
): void {
  database.prepare(`
    INSERT INTO structured_logs (
      id, run_id, severity, domain, message, attributes_json, sensitivity, occurred_at
    ) VALUES (?, ?, 'warn', 'command-runtime.planner', ?, ?, 'internal', ?)
  `).run(
    `log_${randomUUID()}`,
    runId,
    "Planner response failed structural validation; requesting one bounded schema repair",
    JSON.stringify({
      code: "invalid_plan",
      validationField: diagnostic.validationField,
      validationRule: diagnostic.validationRule,
      repairAttempt: 1,
      rawProviderOutputPersisted: false,
    }),
    new Date().toISOString(),
  );
}

function retryAfterMs(error: unknown, now = Date.now()): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as Record<string, any>;
  const direct = Number(candidate.retryAfterMs);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  const header = candidate.headers?.get?.("retry-after")
    ?? candidate.response?.headers?.get?.("retry-after")
    ?? candidate.retryAfter;
  if (header === undefined || header === null) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const at = Date.parse(String(header));
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

function assertExactUsageForRun(
  database: SqliteDatabase,
  runId: string,
  usage: GrokOAuthTurnResult["usage"],
): void {
  const row = database.prepare("SELECT budget_json FROM runs WHERE id = ?")
    .get(runId) as { budget_json: string } | undefined;
  const budget = json(row?.budget_json);
  const tokenLimit = Number(budget.providerTokens ?? budget.tokenBudget ?? 0);
  const costLimit = Number(budget.estimatedCost ?? budget.costBudget ?? 0);
  if (Number.isFinite(tokenLimit) && tokenLimit > 0 && usage?.providerTokens === undefined) {
    throw new Error("Exact provider token usage dependency missing for the signed token budget");
  }
  if (Number.isFinite(costLimit) && costLimit > 0 && usage?.estimatedCost === undefined) {
    throw new Error("Exact provider cost usage dependency missing for the signed cost budget");
  }
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

function redactedArguments(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactedArguments);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    SECRET_KEY.test(key) ? "[REDACTED]" : redactedArguments(item),
  ]));
}

function planningPolicy(database: SqliteDatabase, runId: string): {
  allowedActionTypes: readonly string[];
  prohibitedActionTypes: readonly string[];
  memoryScopes: readonly string[];
  contextNodeIds: readonly string[];
} {
  const row = database.prepare(`
    SELECT mc.action_policy_json, mc.memory_scopes_json
    FROM runs r LEFT JOIN mission_contracts mc ON mc.id = r.contract_id
    WHERE r.id = ?
  `).get(runId) as { action_policy_json: string | null; memory_scopes_json: string | null } | undefined;
  const policy = json(row?.action_policy_json);
  let memoryScopes: string[] = [];
  try { memoryScopes = stringArray(JSON.parse(row?.memory_scopes_json || "[]")); } catch {}
  return {
    allowedActionTypes: stringArray(policy.allowedActionClasses).map((item) => item.toLowerCase()),
    prohibitedActionTypes: stringArray(policy.prohibitedActionClasses).map((item) => item.toLowerCase()),
    memoryScopes,
    contextNodeIds: stringArray(policy.contextNodeIds),
  };
}

function selectedMemoryTypes(scope: "preferences" | "lessons" | "engagement"): readonly MemoryNodeType[] {
  if (scope === "preferences") return ["preference"];
  if (scope === "lessons") return ["lesson"];
  return [
    "mission", "run", "plan", "phase", "step", "agent", "tool", "mcp_capability",
    "tactic", "technique", "procedure", "target", "asset", "entity", "decision",
    "evidence", "finding", "artifact", "failure", "recovery", "evaluation", "report", "source",
  ];
}

function buildPlanningContext(
  database: SqliteDatabase,
  mission: PlanningMission,
  runId: string,
): { readonly packs: readonly ContextPack[]; readonly text: string } {
  const policy = planningPolicy(database, runId);
  const brain = new SecondBrainService(new MemoryRepository(database));
  const requested: Array<{
    kind: "preferences" | "lessons" | "engagement";
    enabled: boolean;
    allowGlobal: boolean;
    statuses: readonly ("confirmed" | "verified")[];
  }> = mission.journey === "autonomous"
    ? [
        { kind: "preferences", enabled: policy.memoryScopes.includes("confirmed_preferences"), allowGlobal: true, statuses: ["confirmed"] },
        { kind: "lessons", enabled: policy.memoryScopes.includes("verified_lessons"), allowGlobal: true, statuses: ["verified"] },
        { kind: "engagement", enabled: policy.memoryScopes.includes("engagement_memory") && Boolean(mission.engagementId), allowGlobal: false, statuses: ["confirmed", "verified"] },
      ]
    : [
        { kind: "preferences", enabled: true, allowGlobal: true, statuses: ["confirmed"] },
        { kind: "lessons", enabled: true, allowGlobal: true, statuses: ["verified"] },
        { kind: "engagement", enabled: Boolean(mission.engagementId), allowGlobal: false, statuses: ["confirmed", "verified"] },
      ];
  const packs = requested.filter((entry) => entry.enabled).map((entry) =>
    brain.retrieveAndPersistContext({
      query: `${mission.objective} ${mission.allowedTargets.join(" ")}`,
      queryRedacted: `[${entry.kind} context query redacted]`,
      policy: {
        journey: mission.journey,
        engagementId: mission.engagementId ?? undefined,
        missionId: mission.id,
        allowGlobal: entry.allowGlobal,
        maximumSensitivity: "private",
        allowedNodeTypes: selectedMemoryTypes(entry.kind),
        allowedStatuses: entry.statuses,
        contextBudget: 2_000,
        limit: 12,
        graphDepth: mission.journey === "autonomous" ? 0 : 1,
        ...(mission.journey === "autonomous"
          ? { exactNodeIds: policy.contextNodeIds, exactNodeIdsOnly: true }
          : {}),
      },
      purpose: `Build the ${mission.journey} mission plan (${entry.kind})`,
      createdBy: "grok-acp-planner",
      missionId: mission.id,
      runId,
    }));
  const nodes = packs.flatMap((pack) => pack.items.map((item) => {
    const node = brain.repository.getNode(item.nodeId);
    return node ? {
      id: node.id,
      type: node.nodeType,
      title: node.title,
      summary: node.summary,
      note: node.body.slice(0, 2_000),
      confidence: node.confidence,
      scope: node.scope,
      status: node.lifecycleStatus,
      relevance: item.relevanceReason,
    } : null;
  }).filter(Boolean));
  return { packs, text: JSON.stringify(nodes) };
}

function recordPlanningContextUse(
  database: SqliteDatabase,
  packs: readonly ContextPack[],
  rawUsed: unknown,
): void {
  const brain = new SecondBrainService(new MemoryRepository(database));
  const used = new Map<string, string>();
  if (Array.isArray(rawUsed)) {
    for (const entry of rawUsed) {
      if (!entry || typeof entry !== "object") continue;
      const candidate = entry as Record<string, unknown>;
      const id = boundedText(candidate.id, 256);
      const influence = boundedText(candidate.influence, 1_000);
      if (id && influence) used.set(id, influence);
    }
  }
  for (const pack of packs) {
    for (const item of pack.items) {
      const influence = used.get(item.nodeId);
      brain.recordContextUse(pack.id, influence
        ? {
            nodeId: item.nodeId,
            used: true,
            relevanceReason: item.relevanceReason,
            influenceSummary: influence,
          }
        : {
            nodeId: item.nodeId,
            used: false,
            relevanceReason: item.relevanceReason,
            ignoredReason: "The planner did not cite this memory as influencing the bounded plan.",
          });
    }
  }
}

function assertPlanInventory(
  plan: MissionPlanDraft,
  inventory: readonly CommandOsToolInventory[],
): void {
  const agents = new Set(inventory.map((entry) => entry.agentId));
  for (const step of plan.steps) {
    if (!agents.has(step.assignedAgentId)) {
      throw new Error(`Planner assigned unknown specialist ${step.assignedAgentId}`);
    }
    if (step.action.kind !== "tool") continue;
    const server = boundedText(step.action.arguments.mcpServer, 256);
    const tool = boundedText(step.action.arguments.toolName, 256);
    const matching = inventory.find((entry) =>
      entry.agentId === step.assignedAgentId && entry.mcpServer === server && entry.toolNames.includes(tool));
    if (!matching) {
      throw new Error(`Planner selected an unavailable specialist MCP binding for ${step.title}`);
    }
  }
}

async function trackedGrokTurn(
  database: SqliteDatabase,
  callGrok: GrokOAuthCaller,
  runId: string,
  prompt: string,
  signal: AbortSignal,
): Promise<{ readonly text: string; readonly usage: import("../command-runtime/types").ProviderUsageReport }> {
  const id = `providerturn_${randomUUID()}`;
  const startedAt = new Date();
  database.prepare(`
    INSERT INTO provider_turns (id, run_id, provider, model, status, started_at)
    VALUES (?, ?, 'xai-grok-oauth', 'grok-4.5', 'started', ?)
  `).run(id, runId, startedAt.toISOString());
  try {
    const result = grokTurn(await callGrok(prompt, signal));
    const inputTokens = result.usage?.inputTokens;
    const outputTokens = result.usage?.outputTokens;
    const providerTokens = result.usage?.providerTokens;
    const estimatedCost = result.usage?.estimatedCost;
    const exactTokenUsage = providerTokens !== undefined;
    const exactCostUsage = estimatedCost !== undefined;
    database.prepare(`
      UPDATE provider_turns SET status = 'completed', input_tokens = ?, output_tokens = ?,
        estimated_cost = ?, latency_ms = ?, ended_at = ? WHERE id = ?
    `).run(
      inputTokens ?? null,
      outputTokens ?? null,
      estimatedCost ?? null,
      Math.max(0, Date.now() - startedAt.getTime()),
      new Date().toISOString(),
      id,
    );
    return {
      text: result.text,
      usage: {
        providerTurnId: id,
        ...(providerTokens === undefined ? {} : { providerTokens }),
        ...(estimatedCost === undefined ? {} : { estimatedCost }),
        exactTokenUsage,
        exactCostUsage,
      },
    };
  } catch (error) {
    database.prepare(`
      UPDATE provider_turns SET status = ?, latency_ms = ?, error_category = ?, ended_at = ? WHERE id = ?
    `).run(
      signal.aborted ? "cancelled" : "failed",
      Math.max(0, Date.now() - startedAt.getTime()),
      signal.aborted ? "operator_rejection" : category(error, "provider"),
      new Date().toISOString(),
      id,
    );
    throw error;
  }
}

export function createGrokMissionPlanner(
  options: Pick<CommandOsRuntimeAdapterOptions, "database" | "callGrok" | "inventory">,
): MissionPlannerPort {
  return {
    async plan(input, signal): Promise<MissionPlanDraft> {
      const inventory = options.inventory();
      if (inventory.length === 0) throw new Error("No specialist execution inventory is available");
      const policy = planningPolicy(options.database, input.run.id);
      const context = buildPlanningContext(options.database, input.mission, input.run.id);
      const prompt = [
        "You are the planning-only ChillsPwn commander. Return one JSON object and no prose.",
        "Build a bounded, acyclic plan for the authorized objective. Specialists execute; you do not execute tools.",
        "For action.kind=tool, choose one exact MCP binding from INVENTORY and put mcpServer, toolName, and arguments under action.arguments.",
        "For Guided-only operator work use action.kind=manual. Put an exact command or procedure, parameter explanation, expected output, success patterns, and failure patterns under action.arguments. Manual means the operator runs it and submits the result; it is never dispatched through MCP.",
        "Never use action.kind=manual for Autonomous. Autonomous plans must contain only actions executable inside the signed contract without operator involvement.",
        "For analysis-only provider work use kind=provider_turn or delegation; it receives no tools and cannot claim target evidence.",
        "Every actionType must exactly equal an allowedActionType when that list is non-empty. Every target must exactly equal an allowed target.",
        "riskClass MUST be exactly one of: low, medium, high, critical.",
        "Every scalar field shown in the response schema is mandatory for every step and action kind: use a non-empty string for every string field, an object for arguments, arrays for successCriteria and dependencyOrdinals, and booleans for idempotent and destructive.",
        "For manual/provider_turn/delegation actions, actionType, actionClass, target, assignedAgentId, intentSummary, and reversibility remain mandatory; do not omit them merely because no tool will be dispatched.",
        "Never include credentials, tokens, keys, passwords, session material, or secret values. Use opaque references.",
        "Return: {strategySummary,rationaleSummary,steps:[{phase,title,objective,explanation,rationale,successCriteria,dependencyOrdinals,assignedAgentId,riskClass,reversibility,action:{actionType,actionClass,target,arguments,intentSummary,kind,idempotent,destructive}}],contextUsed:[{id,influence}]}",
        `JOURNEY=${input.mission.journey}`,
        `OBJECTIVE=${input.mission.objective}`,
        `SUCCESS_CRITERIA=${JSON.stringify(input.mission.successCriteria)}`,
        `ALLOWED_TARGETS=${JSON.stringify(input.mission.allowedTargets)}`,
        `PROHIBITED_TARGETS=${JSON.stringify(input.mission.prohibitedTargets)}`,
        `ALLOWED_ACTION_TYPES=${JSON.stringify(policy.allowedActionTypes)}`,
        `PROHIBITED_ACTION_TYPES=${JSON.stringify(policy.prohibitedActionTypes)}`,
        `REJECTION_REASON=${JSON.stringify(input.rejectionReason ?? null)}`,
        `INVENTORY=${JSON.stringify(inventory)}`,
        `PERMITTED_CONTEXT=${context.text}`,
      ].join("\n");
      const turns = [await trackedGrokTurn(options.database, options.callGrok, input.run.id, prompt, signal)];
      let raw = normalizePlannerEnvelope(parseJsonObject(
        turns[0]!.text,
        "Grok ACP planner",
      )) as unknown as ParsedPlanEnvelope;
      let plan: MissionPlanDraft;
      try {
        plan = validateMissionPlanDraft(raw, 32, input.mission.journey);
      } catch (error) {
        const diagnostic = planRepairDiagnostic(error);
        if (!diagnostic || !boundedPlanRepairAllowed(options.database, input.run.id)) throw error;
        recordBoundedPlanRepair(options.database, input.run.id, diagnostic);
        const repairPrompt = [
          prompt,
          "SCHEMA_REPAIR_ATTEMPT=1_OF_1",
          `REJECTED_FIELD=${diagnostic.validationField}`,
          `REJECTED_RULE=${diagnostic.validationRule}`,
          "The prior response was discarded and is not reproduced here. Regenerate the entire JSON object from the authorized inputs above. Fill every mandatory field without broadening scope, changing the exact target, or inventing a tool binding.",
        ].join("\n");
        turns.push(await trackedGrokTurn(options.database, options.callGrok, input.run.id, repairPrompt, signal));
        raw = normalizePlannerEnvelope(parseJsonObject(
          turns[1]!.text,
          "Grok ACP planner schema repair",
        )) as unknown as ParsedPlanEnvelope;
        plan = validateMissionPlanDraft(raw, 32, input.mission.journey);
      }
      assertPlanInventory(plan, inventory);
      recordPlanningContextUse(options.database, context.packs, (raw as ParsedPlanEnvelope).contextUsed);
      return { ...plan, providerUsage: aggregateProviderUsage(turns.map((turn) => turn.usage)) };
    },
  };
}

function missionEvidence(database: SqliteDatabase, missionId: string, runId: string): Array<{
  id: string; summary: string; target: string | null; type: string;
}> {
  return database.prepare(`
    SELECT id, summary, target, evidence_type AS type FROM evidence
    WHERE mission_id = ? AND (run_id = ? OR run_id IS NULL)
      AND verification_state = 'verified'
    ORDER BY acquired_at, id LIMIT 500
  `).all(missionId, runId) as Array<{ id: string; summary: string; target: string | null; type: string }>;
}

export function createGrokOutcomeEvaluator(
  options: Pick<CommandOsRuntimeAdapterOptions, "database" | "callGrok">,
): MissionOutcomeEvaluatorPort {
  return {
    async evaluate(input, signal) {
      const mission = options.database.prepare(`
        SELECT objective, success_criteria_json FROM missions WHERE id = ?
      `).get(input.mission.id) as { objective: string; success_criteria_json: string } | undefined;
      if (!mission) throw new Error("Mission disappeared before evaluation");
      const criteria = stringArray(JSON.parse(mission.success_criteria_json));
      const evidence = missionEvidence(options.database, input.mission.id, input.run.id);
      if (criteria.length === 0) {
        const success = input.completedActionIds.length > 0;
        return {
          success,
          summary: success
            ? "All represented Guided steps completed; no separate Autonomous success criteria were configured."
            : "No represented action completed.",
          criteria: [],
        };
      }
      const prompt = [
        "You are a planning-only evidence evaluator. Return JSON only; do not execute tools.",
        "Assess each criterion only from the supplied VERIFIED_EVIDENCE. A satisfied criterion must cite one or more supplied evidence IDs.",
        "Do not expose chain-of-thought. Give one concise evidence-based explanation per criterion.",
        "Return {summary,criteria:[{criterion,satisfied,explanation,evidenceIds}]}",
        `OBJECTIVE=${mission.objective}`,
        `CRITERIA=${JSON.stringify(criteria)}`,
        `VERIFIED_EVIDENCE=${JSON.stringify(evidence)}`,
      ].join("\n");
      const turn = await trackedGrokTurn(options.database, options.callGrok, input.run.id, prompt, signal);
      const raw = parseJsonObject(
        turn.text,
        "Grok ACP evaluator",
      ) as ParsedEvaluation;
      const supplied = new Set(evidence.map((item) => item.id));
      const returned = Array.isArray(raw.criteria) ? raw.criteria : [];
      const normalized = criteria.map((criterion) => {
        const item = returned.find((candidate) => boundedText(candidate?.criterion, 2_000) === criterion);
        const evidenceIds = Array.isArray(item?.evidenceIds)
          ? item.evidenceIds.filter((id: unknown): id is string => typeof id === "string" && supplied.has(id))
          : [];
        const satisfied = item?.satisfied === true && evidenceIds.length > 0;
        return {
          criterion,
          satisfied,
          explanation: boundedText(item?.explanation, 2_000) || (satisfied
            ? "The criterion is supported by verified evidence."
            : "No sufficient verified evidence was cited."),
          evidenceIds,
        };
      });
      return {
        success: normalized.every((item) => item.satisfied),
        summary: boundedText(raw.summary, 4_000) || "Mission success criteria were evaluated against verified evidence.",
        criteria: normalized,
        providerUsage: turn.usage,
      };
    },
  };
}

function linkedAbortSignal(parent: AbortSignal): { controller: AbortController; detach: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort(parent.reason);
  if (parent.aborted) abort();
  else parent.addEventListener("abort", abort, { once: true });
  return { controller, detach: () => parent.removeEventListener("abort", abort) };
}

function actionAgent(database: SqliteDatabase, actionId: string): string {
  const row = database.prepare(`
    SELECT ass.agent_id FROM actions a
    JOIN assignments ass ON ass.id = a.assignment_id
    WHERE a.id = ?
  `).get(actionId) as { agent_id: string } | undefined;
  if (!row?.agent_id) throw new Error("Action has no durable specialist assignment");
  return row.agent_id;
}

function progressSnapshot(database: SqliteDatabase, runId: string): ProgressSnapshot {
  const stepRows = database.prepare("SELECT id, status FROM plan_steps WHERE run_id = ? ORDER BY ordinal")
    .all(runId) as Array<{ id: string; status: string }>;
  const mapStep = (status: string): "pending" | "running" | "blocked" | "completed" | "failed" | "skipped" => {
    if (status === "running" || status === "recovering") return "running";
    if (status === "blocked" || status === "waiting_guided_decision") return "blocked";
    if (status === "completed") return "completed";
    if (status === "failed" || status === "cancelled") return "failed";
    if (status === "skipped") return "skipped";
    return "pending";
  };
  const evidenceIds = (database.prepare("SELECT id FROM evidence WHERE run_id = ? ORDER BY acquired_at, id")
    .all(runId) as Array<{ id: string }>).map((row) => row.id);
  const artifactIds = (database.prepare("SELECT id FROM artifacts WHERE run_id = ? ORDER BY created_at, id")
    .all(runId) as Array<{ id: string }>).map((row) => row.id);
  const workerIds = (database.prepare("SELECT id FROM actions WHERE run_id = ? AND status = 'succeeded' ORDER BY ended_at, id")
    .all(runId) as Array<{ id: string }>).map((row) => row.id);
  const decisionIds = (database.prepare("SELECT id FROM guided_decisions WHERE run_id = ? AND status IN ('approved','manual') ORDER BY decided_at, id")
    .all(runId) as Array<{ id: string }>).map((row) => row.id);
  const plan = database.prepare("SELECT version, plan_hash FROM plans WHERE run_id = ? AND status = 'active' ORDER BY version DESC LIMIT 1")
    .get(runId) as { version: number; plan_hash: string } | undefined;
  return {
    stepStates: Object.fromEntries(stepRows.map((row) => [row.id, mapStep(row.status)])),
    evidenceIds,
    artifactIds,
    verifiedWorkerResultIds: workerIds,
    resolvedDecisionIds: decisionIds,
    ...(plan ? { planVersion: plan.version, strategyFingerprint: plan.plan_hash } : {}),
  };
}

function canonicalStorageUsage(database: SqliteDatabase, runId: string): {
  readonly evidenceBytes: number;
  readonly artifactBytes: number;
} {
  const evidence = database.prepare(`
    SELECT COALESCE(SUM(length(CAST(COALESCE(extracted_text, '') AS BLOB))), 0) AS bytes
    FROM evidence WHERE run_id = ?
  `).get(runId) as { bytes: number };
  const artifacts = database.prepare(`
    SELECT COALESCE(SUM(byte_size), 0) AS bytes FROM artifacts WHERE run_id = ?
  `).get(runId) as { bytes: number };
  return {
    evidenceBytes: Math.max(0, Number(evidence.bytes) || 0),
    artifactBytes: Math.max(0, Number(artifacts.bytes) || 0),
  };
}

function storageDelta(
  before: ReturnType<typeof canonicalStorageUsage>,
  after: ReturnType<typeof canonicalStorageUsage>,
): { readonly evidenceBytes: number; readonly artifactBytes: number } {
  return {
    evidenceBytes: Math.max(0, after.evidenceBytes - before.evidenceBytes),
    artifactBytes: Math.max(0, after.artifactBytes - before.artifactBytes),
  };
}

function persistEvidence(database: SqliteDatabase, action: DurableAction, actor: string, source: string, text: string, verified: boolean, now: string): string | null {
  const content = text.trim().slice(0, 128_000);
  if (!content) return null;
  const id = `evidence_${randomUUID()}`;
  const hash = createHash("sha256").update(content, "utf8").digest("hex");
  inImmediateTransaction(database, () => {
    database.prepare(`
      INSERT INTO evidence (
        id, mission_id, run_id, step_id, action_id, source, acquired_at,
        target, evidence_type, content_hash, provenance_json, confidence,
        sensitivity, verification_state, summary, extracted_text, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'private', ?, ?, ?, ?, ?)
    `).run(
      id, action.missionId, action.runId, action.stepId || null, action.id, source, now,
      action.target || null, verified ? "tool_result" : "provider_analysis", hash,
      canonical({ actionId: action.id, actionFingerprint: action.fingerprint, source, capturedBy: actor }),
      verified ? 0.95 : 0.6, verified ? "verified" : "unverified",
      content.replace(/\s+/gu, " ").slice(0, 1_000), content, actor, now,
    );
    database.prepare(`
      INSERT INTO evidence_chain_events (id, evidence_id, event_type, actor, details_json, occurred_at)
      VALUES (?, ?, 'acquired', ?, ?, ?)
    `).run(`chain_${randomUUID()}`, id, actor, canonical({ actionId: action.id, immutableHash: hash }), now);
  });
  return id;
}

function toolEnvelope(action: DurableAction): { server: string; tool: string; input: unknown } {
  const server = boundedText(action.arguments.mcpServer, 256);
  const tool = boundedText(action.arguments.toolName, 256);
  if (!server || !tool) throw new Error("Tool action lacks its exact MCP server/tool binding");
  const input = action.arguments.arguments ?? action.arguments.input ?? {};
  return { server, tool, input };
}

function category(error: unknown, source: "mcp" | "provider"): FailureCategory {
  return classifyFailure({
    source,
    code: error instanceof Error ? error.name : "execution_error",
    message: error instanceof Error ? error.message : String(error),
  });
}

export class CommandOsBoundedExecutionPort implements ResultAwareExecutionPort {
  readonly #active = new Map<string, { runId: string; controller: AbortController; task: Promise<void>; detach: () => void }>();
  #sink?: ExecutionResultSink;
  readonly #now: () => Date;

  constructor(private readonly options: CommandOsRuntimeAdapterOptions) {
    this.#now = options.now ?? (() => new Date());
  }

  bindResultSink(sink: ExecutionResultSink): () => void {
    this.#sink = sink;
    return () => { if (this.#sink === sink) this.#sink = undefined; };
  }

  async dispatch(action: DurableAction, signal: AbortSignal): Promise<void> {
    if (action.kind === "manual") {
      throw new Error("Manual Guided actions require an operator-supplied result and cannot be dispatched");
    }
    this.#accept(action, signal);
  }

  async resume(action: DurableAction, signal: AbortSignal): Promise<void> {
    if (action.kind === "manual") {
      throw new Error("Manual Guided actions cannot be resumed through the execution boundary");
    }
    if (!action.idempotent || action.destructive) throw new Error("Only safe idempotent actions may resume");
    this.#accept(action, signal);
  }

  async cancelRun(runId: string): Promise<void> {
    const active = [...this.#active.values()].filter((item) => item.runId === runId);
    active.forEach((item) => item.controller.abort("Run cancelled"));
    await Promise.allSettled(active.map((item) => item.task));
  }

  #accept(action: DurableAction, signal: AbortSignal): void {
    if (!this.#sink) throw new Error("Execution result sink is not bound");
    if (this.#active.has(action.id)) return;
    const linked = linkedAbortSignal(signal);
    const task = this.#execute(action, linked.controller.signal)
      // Coordinator cancellation owns the terminal action mutation. Suppress a
      // late provider/tool result after abort so it cannot race that mutation.
      .then((result) => linked.controller.signal.aborted
        ? undefined
        : this.#sink!.acceptExecutionResult(result).then(() => undefined))
      .finally(() => {
        linked.detach();
        this.#active.delete(action.id);
      });
    this.#active.set(action.id, { runId: action.runId, controller: linked.controller, task, detach: linked.detach });
  }

  async #execute(action: DurableAction, signal: AbortSignal): Promise<ExecutionResult> {
    const before = progressSnapshot(this.options.database, action.runId);
    const storageBefore = canonicalStorageUsage(this.options.database, action.runId);
    const agentId = actionAgent(this.options.database, action.id);
    const startedAt = this.#now();
    let providerUsage: GrokOAuthTurnResult["usage"] | undefined;
    try {
      let summary: string;
      let evidenceId: string | null = null;
      let circuitKey: string;
      if (action.kind === "tool") {
        const binding = toolEnvelope(action);
        const toolCallId = `toolcall_${randomUUID()}`;
        this.options.database.prepare(`
          INSERT INTO tool_calls (
            id, action_id, provider, tool_name, mcp_server_id,
            normalized_arguments_json, status, started_at, created_at
          ) VALUES (?, ?, 'mcp', ?, ?, ?, 'running', ?, ?)
        `).run(toolCallId, action.id, binding.tool, binding.server, canonical(redactedArguments(binding.input)), startedAt.toISOString(), startedAt.toISOString());
        const result = await this.options.executeMcp({
          specialistAgentId: agentId,
          mcpServer: binding.server,
          toolName: binding.tool,
          arguments: binding.input,
          startedAtMs: startedAt.getTime(),
          signal,
        });
        if (signal.aborted) throw new DOMException("Action cancelled", "AbortError");
        summary = (result.outputPreview || result.error || `${binding.tool} returned no output`).slice(0, 8_000);
        const success = result.success && !result.isError;
        const failureMessage = result.error || "MCP tool reported failure";
        const elapsed = Math.max(0, this.#now().getTime() - startedAt.getTime());
        this.options.database.prepare(`
          UPDATE tool_calls SET status = ?, error_category = ?, latency_ms = ?,
            output_summary = ?, ended_at = ? WHERE id = ?
        `).run(success ? "succeeded" : "failed", success ? null : category(new Error(failureMessage), "mcp"), elapsed, summary.slice(0, 4_000), this.#now().toISOString(), toolCallId);
        evidenceId = persistEvidence(this.options.database, action, agentId, `mcp:${binding.server}.${binding.tool}`, summary, success, this.#now().toISOString());
        if (!success) throw new Error(failureMessage);
        circuitKey = `mcp:${binding.server}`;
      } else {
        const providerTurnId = `providerturn_${randomUUID()}`;
        this.options.database.prepare(`
          INSERT INTO provider_turns (id, run_id, provider, model, status, started_at)
          VALUES (?, ?, 'xai-grok-oauth', 'grok-4.5', 'started', ?)
        `).run(providerTurnId, action.runId, startedAt.toISOString());
        const prompt = [
          `You are acting as the ${agentId} specialist in a bounded ChillsPwn ${action.kind} step.`,
          "This ACP turn is planning/analysis only and has no execution tools. Do not claim that you ran a command.",
          "Return a concise specialist result that distinguishes facts from recommendations and never exposes secrets.",
          `INTENT=${action.intentSummary}`,
          `TARGET=${action.target}`,
          `PARAMETERS=${JSON.stringify(redactedArguments(action.arguments))}`,
        ].join("\n");
        try {
          const turn = grokTurn(await this.options.callGrok(prompt, signal));
          providerUsage = turn.usage;
          summary = turn.text.trim().slice(0, 8_000);
          const elapsed = Math.max(0, this.#now().getTime() - startedAt.getTime());
          this.options.database.prepare(`
            UPDATE provider_turns SET status = 'completed', input_tokens = ?, output_tokens = ?,
              estimated_cost = ?, latency_ms = ?, ended_at = ? WHERE id = ?
          `).run(
            providerUsage?.inputTokens ?? null,
            providerUsage?.outputTokens ?? null,
            providerUsage?.estimatedCost ?? null,
            elapsed,
            this.#now().toISOString(),
            providerTurnId,
          );
          assertExactUsageForRun(this.options.database, action.runId, providerUsage);
        } catch (error) {
          const elapsed = Math.max(0, this.#now().getTime() - startedAt.getTime());
          this.options.database.prepare(`
            UPDATE provider_turns SET status = ?, latency_ms = ?, error_category = ?, ended_at = ? WHERE id = ?
          `).run(
            signal.aborted ? "cancelled" : "failed",
            elapsed,
            signal.aborted ? "operator_rejection" : category(error, "provider"),
            this.#now().toISOString(),
            providerTurnId,
          );
          throw error;
        }
        evidenceId = persistEvidence(this.options.database, action, agentId, "xai-grok-oauth:analysis", summary, false, this.#now().toISOString());
        circuitKey = "provider:xai-grok-oauth";
      }
      const after = progressSnapshot(this.options.database, action.runId);
      const retained = storageDelta(
        storageBefore,
        canonicalStorageUsage(this.options.database, action.runId),
      );
      return {
        actionId: action.id,
        runId: action.runId,
        actionFingerprint: action.fingerprint,
        success: true,
        summary,
        progress: {
          ...after,
          evidenceIds: evidenceId ? [...new Set([...(after.evidenceIds ?? []), evidenceId])] : after.evidenceIds,
          verifiedWorkerResultIds: [...new Set([...(after.verifiedWorkerResultIds ?? []), action.id])],
        },
        usage: {
          ...(providerUsage?.providerTokens === undefined
            ? {}
            : { providerTokens: providerUsage.providerTokens }),
          ...(providerUsage?.estimatedCost === undefined
            ? {}
            : { estimatedCost: providerUsage.estimatedCost }),
          ...retained,
        },
        circuitKey,
      };
    } catch (error) {
      const source = action.kind === "tool" ? "mcp" : "provider";
      const failureCategory = signal.aborted ? "operator_rejection" : category(error, source);
      const message = signal.aborted
        ? "Execution was cancelled before a terminal result was accepted"
        : (error instanceof Error ? error.message : "Execution failed");
      const retained = storageDelta(
        storageBefore,
        canonicalStorageUsage(this.options.database, action.runId),
      );
      const retryDelay = retryAfterMs(error, this.#now().getTime());
      const afterFailure = progressSnapshot(this.options.database, action.runId);
      return {
        actionId: action.id,
        runId: action.runId,
        actionFingerprint: action.fingerprint,
        success: false,
        summary: message.slice(0, 8_000),
        progress: afterFailure,
        failure: { source, code: error instanceof Error ? error.name : "execution_failed", message },
        failureCategory,
        ...(retryDelay === undefined ? {} : { retryAfterMs: retryDelay }),
        usage: {
          ...(providerUsage?.providerTokens === undefined
            ? {}
            : { providerTokens: providerUsage.providerTokens }),
          ...(providerUsage?.estimatedCost === undefined
            ? {}
            : { estimatedCost: providerUsage.estimatedCost }),
          ...retained,
        },
        circuitKey: source === "mcp" ? "mcp:execution" : "provider:xai-grok-oauth",
      };
    }
  }
}

export function createCommandOsRuntimeAdapters(options: CommandOsRuntimeAdapterOptions): {
  readonly planner: MissionPlannerPort;
  readonly outcomeEvaluator: MissionOutcomeEvaluatorPort;
  readonly execution: CommandOsBoundedExecutionPort;
} {
  return {
    planner: createGrokMissionPlanner(options),
    outcomeEvaluator: createGrokOutcomeEvaluator(options),
    execution: new CommandOsBoundedExecutionPort(options),
  };
}
