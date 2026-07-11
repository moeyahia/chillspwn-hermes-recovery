/**
 * Thin typed client for the agent-runtime API (Phase 5). No state — just fetch wrappers
 * over the existing Phase 2–4 endpoints. The runtime owns all state; this only reads it
 * and posts approval decisions.
 */

import type { AgentRun, CockpitSnapshot, PlanPreview } from "./runtimeTypes";

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json() as Promise<T>;
}

async function jpost<T = unknown>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string })?.error || `${r.status} ${url}`);
  return data as T;
}

export const runtimeApi = {
  listRuns: () => jget<{ runs: AgentRun[] }>("/api/runs").then((d) => d.runs),
  /** Composite snapshot for one run: doc + events + related memory. */
  cockpit: (runId: string) => jget<CockpitSnapshot>(`/api/runs/${encodeURIComponent(runId)}/cockpit`),
  approve: (runId: string, approvalId: string, resolvedBy?: string) =>
    jpost(`/api/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}/approve`, { resolvedBy }),
  reject: (runId: string, approvalId: string, reason?: string) =>
    jpost(`/api/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}/reject`, { reason }),
  /** Phase 7.2 — generate an ADVISORY plan preview for an observe-only chat run. */
  generatePlanPreview: (runId: string) =>
    jpost<{ ok: boolean; planPreview: PlanPreview }>(`/api/runs/${encodeURIComponent(runId)}/plan-preview`),
  clearPlanPreview: async (runId: string) => {
    const r = await fetch(`/api/runs/${encodeURIComponent(runId)}/plan-preview`, { method: "DELETE" });
    if (!r.ok) throw new Error(`${r.status}`);
  },
  /** Phase 7.4 — client feature flags (drives the managed-run launcher visibility). */
  flags: () => jget<{ managedChatEnabled: boolean; planningEnabled: boolean; requirePlanApproval: boolean; chatAgentRunsEnabled: boolean }>("/api/runtime/flags"),
  /** Phase 7.4 — launch a runtime-managed chat run (creates run + strict plan; NO execution). */
  createManagedChatRun: (body: { objective: string; persona?: string; provider?: string }) =>
    jpost<{ ok: boolean; run: AgentRun; steps: unknown[] }>("/api/runs/managed-chat", body),
  /** Phase 7.4 — approve the managed plan (awaiting_plan_approval → executing). */
  approvePlan: (runId: string) => jpost<{ run: AgentRun }>(`/api/runs/${encodeURIComponent(runId)}/approve`),
  /** Phase 7.4 — reject the managed plan (awaiting_plan_approval → planning). */
  rejectPlan: (runId: string, reason?: string) => jpost<{ run: AgentRun }>(`/api/runs/${encodeURIComponent(runId)}/reject`, { reason }),
  /** Phase 7.5 — launch OBSERVE-ONLY execution for an approved managed run. */
  startObservedExecution: (runId: string) =>
    jpost<{ ok: boolean; runId: string; sessionId: string; provider: string; mode: string; enforced: boolean }>(`/api/runs/${encodeURIComponent(runId)}/start-observed-execution`),
  /** 8.2 — HTB training memory (verified attack lessons). */
  listLessons: () => jget<{ lessons: any[] }>(`/api/training-memory/lessons`).then((r) => r.lessons ?? []),
  approveLesson: (id: string) => jpost(`/api/training-memory/lessons/${encodeURIComponent(id)}/approve`, { verifiedBy: "operator" }),
  rejectLesson: (id: string) => jpost(`/api/training-memory/lessons/${encodeURIComponent(id)}/reject`, {}),
  staleLesson: (id: string) => jpost(`/api/training-memory/lessons/${encodeURIComponent(id)}/stale`, {}),
  /** Phase 10 — runtime memory review actions. */
  approveMemory: (id: string) => jpost(`/api/runtime-memory/${encodeURIComponent(id)}/approve`, { resolvedBy: "operator" }),
  rejectMemory: (id: string, reason?: string) => jpost(`/api/runtime-memory/${encodeURIComponent(id)}/reject`, { reason, resolvedBy: "operator" }),
  staleMemory: (id: string) => jpost(`/api/runtime-memory/${encodeURIComponent(id)}/stale`),
  /** Phase 7.5 — managed step controls (reuse existing runtime endpoints). */
  startStep: (runId: string, stepId: string) => jpost(`/api/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/start`),
  completeStep: (runId: string, stepId: string, summary: string) => jpost(`/api/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/complete`, { summary }),
  failStep: (runId: string, stepId: string, reason: string) => jpost(`/api/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/fail`, { reason }),
};
