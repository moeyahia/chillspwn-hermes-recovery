/**
 * MemoryCleanup (8.2) — classify existing runtime/ledger memory and PLAN a safe cleanup. Pure +
 * testable. The runnable tool (scripts/training-memory-cleanup.ts) applies the plan.
 *
 * Philosophy: do NOT blindly delete hypotheses — they may have historical/failed-attempt value.
 * Mark / quarantine them and exclude from planning; only the explicit, flagged `delete` mode
 * removes anything. Only entries with real provenance + no secrets are promotable to lessons.
 */

import type { MemoryItem } from "./types";
import type { AttackLesson } from "./AttackLesson";
import { findRejectableSecrets, findReusableContentIdentifiers, isPromotable, redactLessonText } from "./AttackLesson";

export type CleanupCategory =
  | "verified_attack_lesson_candidate"
  | "hypothesis"
  | "raw_note"
  | "target_specific_secret"
  | "stale"
  | "unknown";

export type CleanupMode = "dry-run" | "quarantine" | "promote" | "delete";

export interface CleanupAction {
  id: string;
  category: CleanupCategory;
  action: "report" | "mark_rejected" | "mark_stale" | "promote_candidate" | "delete";
  reason: string;
}

export interface CleanupPlan {
  mode: CleanupMode;
  counts: Record<CleanupCategory, number>;
  actions: CleanupAction[];
  mutates: boolean;
}

/** Classify a single memory item. Secret-bearing + stale checks take precedence. */
export function classifyMemoryEntry(item: MemoryItem): CleanupCategory {
  if (item.status === "stale") return "stale";
  if (findRejectableSecrets(item.content ?? "").length
      || findReusableContentIdentifiers(item.content ?? "").length
      || redactLessonText(item.content ?? "") !== (item.content ?? "")) return "target_specific_secret";
  if (item.type === "hypothesis") return "hypothesis";
  const hasProvenance = !!item.sourceEvidenceId || (!!item.sourceAgentRunId && !!item.sourceStepId);
  if (hasProvenance && (item.type === "finding" || item.type === "tool_observation")) {
    return "verified_attack_lesson_candidate";
  }
  if (item.type === "finding" || item.type === "tool_observation" || item.type === "engagement_fact" || item.type === "user_preference") {
    return "raw_note";
  }
  return "unknown";
}

const EMPTY_COUNTS = (): Record<CleanupCategory, number> => ({
  verified_attack_lesson_candidate: 0, hypothesis: 0, raw_note: 0,
  target_specific_secret: 0, stale: 0, unknown: 0,
});

/**
 * Plan the cleanup for a set of items. PURE — never mutates. `dry-run` only reports.
 *   - quarantine: hypotheses + raw_notes + target-secrets → mark_rejected (NOT deleted)
 *   - promote: verified_attack_lesson_candidates → promote_candidate (proposed lesson, operator approves)
 *   - delete: marks the same set as `delete` (the runnable tool requires --confirm-delete)
 */
export function planCleanup(items: MemoryItem[], mode: CleanupMode): CleanupPlan {
  const counts = EMPTY_COUNTS();
  const actions: CleanupAction[] = [];
  for (const item of items) {
    const category = classifyMemoryEntry(item);
    counts[category] += 1;
    let action: CleanupAction["action"] = "report";
    let reason = "dry-run — no mutation";
    if (mode === "quarantine") {
      if (category === "hypothesis") { action = "mark_rejected"; reason = "hypothesis — untrusted, excluded from planning"; }
      else if (category === "raw_note") { action = "mark_rejected"; reason = "raw note — not verified learning"; }
      else if (category === "target_specific_secret") { action = "mark_rejected"; reason = "contains a target-specific secret"; }
      else reason = `kept (${category})`;
    } else if (mode === "promote") {
      if (category === "verified_attack_lesson_candidate") { action = "promote_candidate"; reason = "has evidence/provenance — propose as attack lesson (operator must approve)"; }
      else reason = `not promotable (${category})`;
    } else if (mode === "delete") {
      if (category === "hypothesis" || category === "raw_note" || category === "target_specific_secret" || category === "stale") {
        action = "delete"; reason = `DANGEROUS delete (${category}) — requires --confirm-delete`;
      } else reason = `kept (${category})`;
    }
    actions.push({ id: item.id, category, action, reason });
  }
  return { mode, counts, actions, mutates: mode !== "dry-run" };
}

export interface LessonFilters { agent?: string; scope?: string; category?: string }

/**
 * 15.12 — per-agent / per-scope / per-category dry-run summary of TRAINING LESSONS (pure). Used by
 * the cleanup tool's lesson section. `category` accepts: hypothesis (n/a for lessons → 0),
 * verified_attack_lesson, failed_attempt_lesson, or a status. Never mutates.
 */
export function summarizeLessons(lessons: AttackLesson[], filters: LessonFilters = {}): {
  total: number;
  byAgent: Record<string, { proposed: number; verified: number; rejected: number; stale: number; failed_attempts: number; promotion_candidates: number; secret_bearing: number }>;
} {
  let ls = lessons;
  if (filters.agent) ls = ls.filter((l) => (l.agentId || "global").toLowerCase() === filters.agent!.toLowerCase());
  if (filters.scope) ls = ls.filter((l) => l.scope === filters.scope);
  if (filters.category) {
    const c = filters.category;
    ls = ls.filter((l) =>
      c === "failed_attempt_lesson" ? l.kind === "failed_attempt"
        : c === "verified_attack_lesson" ? (l.kind ?? "attack_lesson") === "attack_lesson"
          : c === "hypothesis" ? false
            : l.status === c);
  }
  const byAgent: ReturnType<typeof summarizeLessons>["byAgent"] = {};
  for (const l of ls) {
    const key = (l.agentId || "global").toLowerCase();
    const a = (byAgent[key] ??= { proposed: 0, verified: 0, rejected: 0, stale: 0, failed_attempts: 0, promotion_candidates: 0, secret_bearing: 0 });
    if (l.kind === "failed_attempt") a.failed_attempts += 1;
    else if (l.status === "verified") a.verified += 1;
    else if (l.status === "proposed") a.proposed += 1;
    else if (l.status === "rejected") a.rejected += 1;
    else if (l.status === "stale") a.stale += 1;
    if (l.status === "verified" && isPromotable(l).ok && l.scope !== "global") a.promotion_candidates += 1;
    if (findRejectableSecrets([l.title, l.summary, l.reuseGuidance, l.whyItFailed].filter(Boolean).join("\n")).length) a.secret_bearing += 1;
  }
  return { total: ls.length, byAgent };
}
