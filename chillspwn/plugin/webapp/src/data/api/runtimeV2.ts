import { parseDecisionMutation, parseDecisions, parseMissionRuntime, parsePlans, parseRunMutation, parseRunPage, parseRunSnapshot } from "../../domain/schemas/runtimeV2";
import type { DecisionMutationResult, DecisionsSnapshot, GuidedDecisionControl, MissionRuntimeSnapshot, PartialRunCollection, PlansSnapshot, RunPage, RunSnapshot, RuntimeRun } from "../../domain/types/runtimeV2";
import { fetchOverview } from "./commandOs";
import { apiRequest } from "./client";
import { queryPath } from "./operations";

export const RUNTIME_ENDPOINTS = {
  mission: (id: string) => `/api/v2/missions/${encodeURIComponent(id)}/runtime`,
  run: (id: string) => `/api/v2/runs/${encodeURIComponent(id)}`,
  runs: "/api/v2/runs",
  plans: (id: string) => `/api/v2/runs/${encodeURIComponent(id)}/plans`,
  decisions: "/api/v2/decisions",
  decision: (id: string, action: GuidedDecisionControl) => `/api/v2/guided-decisions/${encodeURIComponent(id)}/${action}`,
  runControl: (id: string, command: "pause" | "resume" | "cancel") => `/api/v2/runs/${encodeURIComponent(id)}/${command}`,
} as const;

function get<T>(path: string, parse: (payload: unknown) => T, signal?: AbortSignal): Promise<T> { return apiRequest(path, { method: "GET", signal, parse }); }
function post<T>(path: string, body: unknown, parse: (payload: unknown) => T, key: string, signal?: AbortSignal): Promise<T> { return apiRequest(path, { method: "POST", signal, headers: { "Idempotency-Key": key }, body: JSON.stringify(body), parse }); }

export const runtimeV2Api = {
  mission: (id: string, signal?: AbortSignal): Promise<MissionRuntimeSnapshot> => get(RUNTIME_ENDPOINTS.mission(id), parseMissionRuntime, signal),
  run: (id: string, signal?: AbortSignal): Promise<RunSnapshot> => get(RUNTIME_ENDPOINTS.run(id), parseRunSnapshot, signal),
  runs: (query: { query?: string; journey?: "autonomous" | "guided"; status?: string; limit?: number }, signal?: AbortSignal): Promise<RunPage> => get(queryPath(RUNTIME_ENDPOINTS.runs, query), parseRunPage, signal),
  plans: (id: string, signal?: AbortSignal): Promise<PlansSnapshot> => get(RUNTIME_ENDPOINTS.plans(id), parsePlans, signal),
  decisions: (query: { status?: string; runId?: string; query?: string; limit?: number }, signal?: AbortSignal): Promise<DecisionsSnapshot> => get(queryPath(RUNTIME_ENDPOINTS.decisions, query), parseDecisions, signal),
  decision: (id: string, action: GuidedDecisionControl, body: unknown, key: string, signal?: AbortSignal): Promise<DecisionMutationResult> => post(RUNTIME_ENDPOINTS.decision(id, action), body, parseDecisionMutation, key, signal),
  controlRun: (id: string, command: "pause" | "resume" | "cancel", reason: string, key: string, signal?: AbortSignal): Promise<RuntimeRun> => post(RUNTIME_ENDPOINTS.runControl(id, command), { reason }, parseRunMutation, key, signal),
};

export async function fetchJourneyRuns(journey: "autonomous" | "guided", signal?: AbortSignal): Promise<PartialRunCollection> {
  const overview = await fetchOverview(signal);
  const missions = overview.missions.filter((mission) => mission.journey === journey).slice(0, 30);
  const settled = await Promise.allSettled(missions.map((mission) => runtimeV2Api.mission(mission.id, signal)));
  const runs: RuntimeRun[] = [];
  const failures: PartialRunCollection["failures"] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") runs.push(...result.value.runs);
    else failures.push({ missionId: missions[index].id, message: result.reason instanceof Error ? result.reason.message : "Mission runtime unavailable" });
  });
  return { runs: runs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)), failures };
}
