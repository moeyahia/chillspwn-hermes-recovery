import { parseAutonomousMissionPreflight, parseCreatedMission, parseMissionPage, parseOverview } from "../../domain/schemas/commandOs";
import type { AutonomousMissionPreflight, AutonomousMissionRequest, CreatedMission, Journey, MissionCreateRequest, MissionPage, OverviewSnapshot } from "../../domain/types/commandOs";
import { apiRequest } from "./client";
import { queryPath } from "./operations";

export function fetchOverview(signal?: AbortSignal): Promise<OverviewSnapshot> {
  return apiRequest("/api/v2/overview", {
    method: "GET",
    signal,
    parse: parseOverview,
  });
}

export function fetchMissions(
  query: { cursor?: string; limit?: number; journey?: Journey; status?: string; query?: string } = {},
  signal?: AbortSignal,
): Promise<MissionPage> {
  return apiRequest(queryPath("/api/v2/missions", query), {
    method: "GET",
    signal,
    parse: parseMissionPage,
  });
}

export function createMission(
  request: MissionCreateRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<CreatedMission> {
  return apiRequest("/api/v2/missions", {
    method: "POST",
    signal,
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(request),
    parse: parseCreatedMission,
  });
}

export function preflightAutonomousMission(
  request: AutonomousMissionRequest,
  signal?: AbortSignal,
): Promise<AutonomousMissionPreflight> {
  return apiRequest("/api/v2/missions/autonomous/preflight", {
    method: "POST",
    signal,
    body: JSON.stringify(request),
    parse: parseAutonomousMissionPreflight,
  });
}
