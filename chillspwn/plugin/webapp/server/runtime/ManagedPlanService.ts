/**
 * ManagedPlanService (Phase 7.4) — STRICT plan generation for runtime-managed runs.
 *
 * Deliberately SEPARATE from the advisory PlanPreviewService: a managed plan becomes real
 * PlanSteps the runtime executes against, so it must pass `parseAndValidatePlan` EXACTLY —
 * there is NO lenient `sanitizePreviewPlan` coercion here. Invalid plans fail clearly.
 *
 * Retries are used only for reliability (a fresh attempt is not coercion); if no attempt
 * yields a strictly-valid plan, generation FAILS with the validation errors and the caller
 * (endpoint) fails the run cleanly.
 *
 * It shares only low-level utilities with the preview service (the model caller + JSON
 * extraction) and the existing planning prompt/parser — never the preview's coercion.
 */

import { buildPlanPrompt, parseAndValidatePlan, type RawPlan } from "./Planner";
import { extractJsonObject, type PlanModelCaller } from "./PlanPreviewService";

export class ManagedPlanError extends Error {
  constructor(message: string, public readonly errors?: string[]) {
    super(message);
    this.name = "ManagedPlanError";
  }
}

/**
 * Generate a strictly-valid managed plan for an objective using an injected model caller.
 * Returns the validated RawPlan, or throws ManagedPlanError (with the validation errors) if
 * the model cannot produce a strictly-valid plan within `attempts`.
 */
export async function generateStrictPlan(
  objective: string,
  caller: PlanModelCaller,
  opts: { attempts?: number; memoryContext?: string } = {},
): Promise<RawPlan> {
  // Phase 8.1: prepend operator-verified memory (only) so managed planning is grounded in
  // approved facts. The block is visible/auditable in the prompt; "" when there is none.
  const base = buildPlanPrompt(objective);
  const prompt = opts.memoryContext && opts.memoryContext.trim() ? `${opts.memoryContext.trim()}\n\n${base}` : base;
  const attempts = Math.max(1, opts.attempts ?? 4);
  let lastErrors: string[] = ["no attempts were made"];
  for (let i = 0; i < attempts; i++) {
    let raw: string;
    try {
      raw = await caller(prompt);
    } catch (e) {
      lastErrors = [(e as Error)?.message ?? "planning model call failed"];
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonObject(raw));
    } catch {
      lastErrors = ["the planning model did not return valid JSON"];
      continue;
    }
    // STRICT validation — no coercion. A managed plan must be exactly correct.
    const validation = parseAndValidatePlan(parsed);
    if (validation.ok && validation.plan.steps.length > 0) return validation.plan;
    lastErrors = validation.ok ? ["the planning model returned an empty plan"] : validation.errors;
  }
  throw new ManagedPlanError("could not generate a strictly-valid managed plan", lastErrors);
}
