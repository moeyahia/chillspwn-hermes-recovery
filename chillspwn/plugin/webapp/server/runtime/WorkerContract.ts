/**
 * Delegated worker result contract (Phase 4).
 *
 * A delegated worker / sub-agent / board card must return THIS structured shape instead of
 * free-form prose, so the runtime can reason about outcomes, evidence, and next steps.
 *
 * Phase 4 ships the contract + validator + storage + tests. Wiring it into live delegation
 * (making the board card / orchestrator workers actually return this) is the documented
 * future integration point — see PHASE-4 notes — and is intentionally NOT done here, to
 * keep the phase additive and avoid touching `orchestrator_openrouter.py` / the claude path.
 */

import { isWorkerStatus, isEvidenceKind, EVIDENCE_KINDS, type WorkerResult, type EvidenceItem, type JsonValue } from "./types";

export type WorkerResultValidation =
  | { ok: true; result: WorkerResult }
  | { ok: false; errors: string[] };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * Validate (and normalize) a raw worker result. Strict on the required shape; lenient on
 * the inner EvidenceItem fields (a worker may send partial evidence — only a non-empty
 * `label` and a `kind` are required per item).
 */
export function validateWorkerResult(raw: unknown): WorkerResultValidation {
  if (!isObject(raw)) return { ok: false, errors: ["worker result must be a JSON object"] };
  const errors: string[] = [];

  if (!isWorkerStatus(raw.status)) errors.push(`status must be one of complete|blocked|failed (got '${String(raw.status)}')`);
  if (typeof raw.summary !== "string" || !raw.summary.trim()) errors.push("summary is required");

  const conf = raw.confidence;
  if (typeof conf !== "number" || Number.isNaN(conf) || conf < 0 || conf > 1) {
    errors.push("confidence must be a number in [0,1]");
  }

  if (raw.assumptions !== undefined && !isStringArray(raw.assumptions)) {
    errors.push("assumptions must be an array of strings");
  }
  if (raw.recommendedNextSteps !== undefined && !isStringArray(raw.recommendedNextSteps)) {
    errors.push("recommendedNextSteps must be an array of strings");
  }
  if (raw.artifacts !== undefined && !Array.isArray(raw.artifacts)) {
    errors.push("artifacts must be an array");
  }
  if (raw.proposedAttackChains !== undefined && (!Array.isArray(raw.proposedAttackChains) || raw.proposedAttackChains.some((x) => !isObject(x)))) {
    errors.push("proposedAttackChains must be an array of objects");
  }

  let evidence: EvidenceItem[] = [];
  if (raw.evidence !== undefined) {
    if (!Array.isArray(raw.evidence)) {
      errors.push("evidence must be an array");
    } else {
      raw.evidence.forEach((e, i) => {
        if (!isObject(e)) { errors.push(`evidence[${i}] must be an object`); return; }
        if (typeof e.label !== "string" || !e.label.trim()) errors.push(`evidence[${i}].label is required`);
        // Phase 4.1: evidence.kind must be a real EvidenceKind — not an arbitrary string,
        // missing, or empty.
        if (!isEvidenceKind(e.kind)) {
          errors.push(`evidence[${i}].kind must be one of ${EVIDENCE_KINDS.join("|")} (got '${String(e.kind)}')`);
        }
      });
      if (errors.length === 0) evidence = raw.evidence as unknown as EvidenceItem[];
    }
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    result: {
      status: raw.status as WorkerResult["status"],
      summary: (raw.summary as string).trim(),
      evidence,
      artifacts: (Array.isArray(raw.artifacts) ? raw.artifacts : []) as JsonValue[],
      confidence: conf as number,
      assumptions: isStringArray(raw.assumptions) ? raw.assumptions : [],
      recommendedNextSteps: isStringArray(raw.recommendedNextSteps) ? raw.recommendedNextSteps : [],
      proposedAttackChains: (Array.isArray(raw.proposedAttackChains) ? raw.proposedAttackChains : []) as JsonValue[],
    },
  };
}

/**
 * Phase 9: coerce ANY worker output into the structured contract. Valid structured output is
 * used as-is; FREE-FORM text (or invalid structured) is CONSERVATIVELY wrapped — status inferred
 * from the text, summary = the text, NO claimed evidence/artifacts, LOW confidence. Never throws;
 * always returns a usable WorkerResult. `wrapped=true` means the input was not valid structure
 * (so the cockpit can mark it "free-form, wrapped").
 */
export function wrapWorkerResult(raw: unknown): { result: WorkerResult; wrapped: boolean } {
  const v = validateWorkerResult(raw);
  if (v.ok) return { result: v.result, wrapped: false };

  const text =
    typeof raw === "string" ? raw
      : isObject(raw) && typeof raw.summary === "string" ? raw.summary
        : isObject(raw) && typeof raw.content === "string" ? raw.content
          : isObject(raw) && typeof raw.text === "string" ? raw.text
            : (() => { try { return JSON.stringify(raw ?? ""); } catch { return String(raw ?? ""); } })();
  const lower = text.toLowerCase();
  // Honor an explicit status field if the wrapper input had one; else infer conservatively.
  const explicit = isObject(raw) && isWorkerStatus(raw.status) ? (raw.status as WorkerResult["status"]) : null;
  const status: WorkerResult["status"] =
    explicit ??
    (/\b(fail|failed|error|errored|could not|unable to)\b/.test(lower) ? "failed"
      : /\b(block|blocked|stuck|cannot proceed|need approval|waiting on)\b/.test(lower) ? "blocked"
        : "complete");
  return {
    result: {
      status,
      summary: (text.trim() || "(no worker output)").slice(0, 8000),
      evidence: [],
      artifacts: [],
      confidence: 0.3, // conservative — free-form wrapping is not trusted structure
      assumptions: [],
      recommendedNextSteps: [],
      proposedAttackChains: [],
    },
    wrapped: true,
  };
}
