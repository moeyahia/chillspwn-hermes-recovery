/**
 * PlanPreviewService (Phase 7.2) — generate an ADVISORY, NON-ENFORCED plan preview for an
 * observe-only chat run.
 *
 * Flow: buildPlanPrompt(objective) → an injected model caller → parseAndValidatePlan → map
 * the validated plan to a PlanPreview. It reuses the EXISTING planning prompt + parser, but
 * deliberately does NOT call materializePlanSteps — preview steps never become managed
 * PlanSteps, never get ids/status/board cards/approvals, and never drive execution.
 *
 * The model call is injected (`PlanModelCaller`) so the service is fully unit-testable with a
 * fake; `createOpenRouterCaller` is the production wiring (a single isolated HTTP call — it
 * does NOT touch spawnClaude / claude -p / the orchestrator).
 */

import { buildPlanPrompt, parseAndValidatePlan, type RawPlan } from "./Planner";
import { classifyTool } from "./ToolPolicy";
import { nowIso, RISK_LEVELS, type PlanPreview, type PreviewStep, type RiskLevel } from "./types";

/** A function that takes a prompt and returns the model's raw text response. */
export type PlanModelCaller = (prompt: string) => Promise<string>;

export class PlanPreviewError extends Error {
  constructor(message: string, public readonly errors?: string[]) {
    super(message);
    this.name = "PlanPreviewError";
  }
}

// Ascending risk order (least → most), independent of the RISK_LEVELS declaration order.
const RISK_ORDER: RiskLevel[] = [
  "read-only", "network", "file-write", "terminal",
  "exploit-sensitive", "credential-sensitive", "destructive",
];
function riskRank(r: RiskLevel): number {
  const i = RISK_ORDER.indexOf(r);
  return i < 0 ? 0 : i;
}

/** Risk for a preview step: explicit if given, else the riskiest of its suggested tools. */
function deriveStepRisk(riskLevel: RiskLevel | undefined, tools: string[]): RiskLevel {
  if (riskLevel && RISK_LEVELS.includes(riskLevel)) return riskLevel;
  let max: RiskLevel = "read-only";
  for (const t of tools) {
    const r = classifyTool(t);
    if (riskRank(r) > riskRank(max)) max = r;
  }
  return max;
}

/**
 * Coerce a raw model plan into a shape the (strict, managed-execution) validator accepts, so
 * an ADVISORY preview renders instead of failing whenever the model deviates from the schema.
 * Every field the validator can REJECT is coerced to a valid value:
 *   - title/purpose/successCriteria → strings (defaulted)
 *   - allowedTools → string[] (non-strings dropped)
 *   - riskLevel → a valid RiskLevel, else omitted (then derived from tools)
 *   - dependsOn → integers referencing EARLIER steps only (self/forward/out-of-range dropped)
 *   - assignedAgent → string or omitted
 * This is safe because a preview is never executed — none of these advisory fields gate
 * anything. A non-array `steps` is left as-is so the validator still rejects a truly empty
 * or malformed plan.
 */
export function sanitizePreviewPlan(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object") return parsed;
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.steps)) return parsed;
  obj.steps = (obj.steps as unknown[]).map((s, i) => {
    const step = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    const str = (v: unknown, dflt: string) => (typeof v === "string" && v.trim() ? v : dflt);
    return {
      title: str(step.title, `Step ${i + 1}`),
      purpose: str(step.purpose, ""),
      successCriteria: str(step.successCriteria, "(advisory — no explicit criteria)"),
      allowedTools: Array.isArray(step.allowedTools)
        ? (step.allowedTools as unknown[]).filter((t): t is string => typeof t === "string")
        : [],
      ...(RISK_LEVELS.includes(step.riskLevel as RiskLevel) ? { riskLevel: step.riskLevel } : {}),
      dependsOn: Array.isArray(step.dependsOn)
        ? (step.dependsOn as unknown[]).filter(
            (d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) < i,
          )
        : [],
      ...(typeof step.assignedAgent === "string" ? { assignedAgent: step.assignedAgent } : {}),
    };
  });
  return obj;
}

/** Pull a JSON object out of a model response that may wrap it in prose / code fences. */
export function extractJsonObject(text: string): string {
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first >= 0 && last > first) return t.slice(first, last + 1);
  return t;
}

/** Pure mapping: a validated plan → an advisory PlanPreview. No side effects, no enforcement. */
export function mapValidatedPlanToPreview(
  objective: string,
  plan: RawPlan,
  generatedBy: string,
  source: "preview" | "inferred" = "preview",
): PlanPreview {
  const steps: PreviewStep[] = plan.steps.map((s) => {
    const suggestedTools = s.allowedTools ?? [];
    return {
      title: s.title,
      purpose: s.purpose,
      successCriteria: s.successCriteria,
      suggestedTools,
      riskLevel: deriveStepRisk(s.riskLevel, suggestedTools),
      dependsOn: s.dependsOn ?? [],
    };
  });
  const suggestedTools = Array.from(new Set(steps.flatMap((s) => s.suggestedTools)));
  const riskLevel = steps.reduce<RiskLevel>(
    (m, s) => (riskRank(s.riskLevel) > riskRank(m) ? s.riskLevel : m),
    "read-only",
  );
  const allHaveCriteria = steps.length > 0 && steps.every((s) => s.successCriteria.trim().length > 0);
  const summary = plan.summary?.trim();
  return {
    title: summary || objective.slice(0, 80),
    purpose: objective,
    successCriteria: summary ? `Plan complete: ${summary}` : `Complete all ${steps.length} previewed step(s).`,
    steps,
    riskLevel,
    suggestedTools,
    confidence: allHaveCriteria ? 0.6 : 0.4, // heuristic — a preview is advisory, not measured
    createdAt: nowIso(),
    source,
    generatedBy,
    enforced: false,
  };
}

/**
 * Generate an advisory preview for an objective using an injected model caller.
 * Throws PlanPreviewError on a missing/invalid/empty plan — the caller (endpoint) maps that
 * to a clear error; the run is never mutated on failure.
 */
export async function generatePlanPreview(
  objective: string,
  caller: PlanModelCaller,
  opts: { generatedBy?: string; attempts?: number } = {},
): Promise<PlanPreview> {
  const prompt = buildPlanPrompt(objective);
  const attempts = Math.max(1, opts.attempts ?? 3);
  let lastErr: PlanPreviewError | null = null;
  // Models (esp. fast non-reasoning ones) intermittently truncate JSON or drift from the
  // schema. A preview is advisory + manual, so a few fresh retries is the pragmatic way to
  // make generation reliable; failure-after-retries still leaves the run untouched.
  for (let i = 0; i < attempts; i++) {
    try {
      return await attemptOnce(objective, prompt, caller, opts.generatedBy);
    } catch (e) {
      lastErr = e instanceof PlanPreviewError ? e : new PlanPreviewError((e as Error)?.message ?? "unknown error");
    }
  }
  throw lastErr ?? new PlanPreviewError("plan preview generation failed");
}

async function attemptOnce(
  objective: string,
  prompt: string,
  caller: PlanModelCaller,
  generatedBy?: string,
): Promise<PlanPreview> {
  let raw: string;
  try {
    raw = await caller(prompt);
  } catch (e) {
    if (e instanceof PlanPreviewError) throw e;
    throw new PlanPreviewError(`planning model call failed: ${(e as Error)?.message ?? "unknown error"}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch {
    throw new PlanPreviewError("the planning model did not return valid JSON");
  }
  // Coerce advisory fields (dependsOn / riskLevel / tools / types) before validating — models
  // routinely deviate, and none of these gate anything in a non-executed preview.
  const validation = parseAndValidatePlan(sanitizePreviewPlan(parsed));
  if (!validation.ok) throw new PlanPreviewError("the planning model did not return a valid plan", validation.errors);
  if (validation.plan.steps.length === 0) throw new PlanPreviewError("the planning model returned an empty plan");
  return mapValidatedPlanToPreview(objective, validation.plan, generatedBy ?? "unknown", "preview");
}

/** Production wiring: a single isolated OpenRouter chat-completion call. */
export function createOpenRouterCaller(opts: {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
}): PlanModelCaller {
  return async (prompt: string): Promise<string> => {
    if (!opts.apiKey) throw new PlanPreviewError("OPENROUTER_API_KEY is not set — cannot generate a plan preview");
    const url = `${opts.baseUrl ?? "https://openrouter.ai/api/v1"}/chat/completions`;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 90000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({
          model: opts.model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
          // Generous budget: the default planning model is a reasoning model whose hidden
          // reasoning tokens count against max_tokens — too low a cap yields empty content.
          max_tokens: 4000,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new PlanPreviewError(`planning model returned HTTP ${res.status}`);
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
      const text = data?.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.trim()) throw new PlanPreviewError("planning model returned no content");
      return text;
    } finally {
      clearTimeout(to);
    }
  };
}
