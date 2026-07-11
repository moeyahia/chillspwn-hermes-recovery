/**
 * Planner (Phase 2).
 *
 * The runtime — not the prompt — owns planning. The model PROPOSES a plan as
 * structured JSON; the runtime VALIDATES it and materializes typed PlanSteps. The
 * model is never allowed to free-form its way through planning: a plan that doesn't
 * match the schema is rejected with errors (the caller can re-ask the model).
 *
 * Pure module — no I/O, no Node APIs beyond what `types` already uses — so the schema
 * and validator are fully unit-testable.
 */

import {
  newId,
  nowIso,
  isRiskLevel,
  type PlanStep,
  type RiskLevel,
} from "./types";
import { classifyTool } from "./ToolPolicy";

/** Hard limits to keep a runaway/garbage plan from materializing. */
export const MAX_PLAN_STEPS = 40;

/** The raw shape the model must return (before validation/materialization). */
export interface RawPlanStep {
  title: string;
  purpose: string;
  successCriteria: string;
  /** Tool names this step may use. Empty/omitted ⇒ a reasoning-only step (no tools). */
  allowedTools?: string[];
  /** Optional explicit risk; otherwise derived from allowedTools. */
  riskLevel?: RiskLevel;
  /** 0-based indices of EARLIER steps this one depends on (guarantees acyclic). */
  dependsOn?: number[];
  /** Optional persona/agent this step is delegated to. */
  assignedAgent?: string;
}

export interface RawPlan {
  summary?: string;
  steps: RawPlanStep[];
}

export type PlanValidation =
  | { ok: true; plan: RawPlan }
  | { ok: false; errors: string[] };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse (if a string) and validate a model-proposed plan against the schema.
 * Returns the typed plan or a list of human-readable errors.
 */
export function parseAndValidatePlan(raw: unknown): PlanValidation {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return { ok: false, errors: ["plan is not valid JSON"] };
    }
  }
  if (!isObject(obj)) return { ok: false, errors: ["plan must be a JSON object"] };

  const errors: string[] = [];
  const stepsRaw = (obj as Record<string, unknown>).steps;
  if (!Array.isArray(stepsRaw)) {
    return { ok: false, errors: ["plan.steps must be an array"] };
  }
  if (stepsRaw.length === 0) errors.push("plan.steps must contain at least one step");
  if (stepsRaw.length > MAX_PLAN_STEPS) {
    errors.push(`plan.steps exceeds the maximum of ${MAX_PLAN_STEPS}`);
  }

  const steps: RawPlanStep[] = [];
  stepsRaw.forEach((s, i) => {
    if (!isObject(s)) {
      errors.push(`step[${i}] must be an object`);
      return;
    }
    const title = s.title;
    const purpose = s.purpose;
    const successCriteria = s.successCriteria;
    if (typeof title !== "string" || !title.trim()) errors.push(`step[${i}].title is required`);
    if (typeof purpose !== "string" || !purpose.trim()) errors.push(`step[${i}].purpose is required`);
    if (typeof successCriteria !== "string" || !successCriteria.trim()) {
      errors.push(`step[${i}].successCriteria is required`);
    }

    let allowedTools: string[] = [];
    if (s.allowedTools !== undefined) {
      if (!Array.isArray(s.allowedTools) || s.allowedTools.some((t) => typeof t !== "string")) {
        errors.push(`step[${i}].allowedTools must be an array of strings`);
      } else {
        allowedTools = s.allowedTools as string[];
      }
    }

    let riskLevel: RiskLevel | undefined;
    if (s.riskLevel !== undefined) {
      if (!isRiskLevel(s.riskLevel)) errors.push(`step[${i}].riskLevel '${String(s.riskLevel)}' is invalid`);
      else riskLevel = s.riskLevel;
    }

    let dependsOn: number[] = [];
    if (s.dependsOn !== undefined) {
      if (!Array.isArray(s.dependsOn) || s.dependsOn.some((d) => !Number.isInteger(d))) {
        errors.push(`step[${i}].dependsOn must be an array of integers`);
      } else {
        dependsOn = s.dependsOn as number[];
        for (const d of dependsOn) {
          if (d < 0 || d >= stepsRaw.length) errors.push(`step[${i}].dependsOn references out-of-range step ${d}`);
          if (d >= i) errors.push(`step[${i}].dependsOn must reference an EARLIER step (got ${d})`);
        }
      }
    }

    if (s.assignedAgent !== undefined && typeof s.assignedAgent !== "string") {
      errors.push(`step[${i}].assignedAgent must be a string`);
    }

    steps.push({
      title: typeof title === "string" ? title : "",
      purpose: typeof purpose === "string" ? purpose : "",
      successCriteria: typeof successCriteria === "string" ? successCriteria : "",
      allowedTools,
      riskLevel,
      dependsOn,
      assignedAgent: typeof s.assignedAgent === "string" ? s.assignedAgent : undefined,
    });
  });

  if (errors.length) return { ok: false, errors };
  const summary = typeof (obj as Record<string, unknown>).summary === "string"
    ? ((obj as Record<string, unknown>).summary as string)
    : undefined;
  return { ok: true, plan: { summary, steps } };
}

/** Derive a step's risk from its tools when not explicitly stated. */
function deriveRisk(step: RawPlanStep): RiskLevel {
  if (step.riskLevel) return step.riskLevel;
  if (!step.allowedTools || step.allowedTools.length === 0) return "read-only";
  // The riskiest tool dominates.
  const order: RiskLevel[] = [
    "read-only", "network", "file-write", "terminal",
    "exploit-sensitive", "credential-sensitive", "destructive",
  ];
  let max: RiskLevel = "read-only";
  for (const t of step.allowedTools) {
    const r = classifyTool(t);
    if (order.indexOf(r) > order.indexOf(max)) max = r;
  }
  return max;
}

/**
 * Convert a validated plan into persisted-shape PlanSteps for a run. Assigns ids +
 * indices, resolves dependsOn indices to the generated step ids, and derives risk.
 */
export function materializePlanSteps(agentRunId: string, plan: RawPlan): PlanStep[] {
  const ts = nowIso();
  const ids = plan.steps.map(() => newId("step"));
  return plan.steps.map((s, i) => ({
    id: ids[i],
    agentRunId,
    index: i,
    title: s.title,
    purpose: s.purpose,
    successCriteria: s.successCriteria,
    allowedTools: s.allowedTools ?? [],
    riskLevel: deriveRisk(s),
    dependencies: (s.dependsOn ?? []).map((d) => ids[d]),
    assignedAgent: s.assignedAgent,
    status: "pending",
    evidenceRefs: [],
    createdAt: ts,
    updatedAt: ts,
  }));
}

/**
 * The instruction handed to the model to elicit a structured plan. This is the
 * runtime-owned replacement for the old "your FIRST tool call MUST be
 * board_create_task" prompt — the runtime asks for a plan and owns what happens next.
 */
export function buildPlanPrompt(objective: string): string {
  return [
    "You are the reasoning engine inside an agent runtime. The runtime owns state,",
    "memory, tools, approvals, the board, and execution. For the objective below,",
    "return ONLY a JSON object describing a step-by-step plan — no prose, no markdown.",
    "",
    `OBJECTIVE: ${objective}`,
    "",
    "Schema:",
    "{",
    '  "summary": "one-line plan summary",',
    '  "steps": [',
    "    {",
    '      "title": "short imperative title",',
    '      "purpose": "why this step exists",',
    '      "successCriteria": "how we know it is done",',
    '      "allowedTools": ["tool names this step may use; [] = reasoning only"],',
    '      "riskLevel": "read-only|network|file-write|terminal|exploit-sensitive|credential-sensitive|destructive",',
    '      "dependsOn": [indices of EARLIER steps this one needs],',
    '      "assignedAgent": "optional persona to delegate this step to"',
    "    }",
    "  ]",
    "}",
    "",
    `Rules: 1..${MAX_PLAN_STEPS} steps; dependsOn may only reference earlier steps;`,
    "every step needs a concrete successCriteria. Return the JSON object and nothing else.",
  ].join("\n");
}
