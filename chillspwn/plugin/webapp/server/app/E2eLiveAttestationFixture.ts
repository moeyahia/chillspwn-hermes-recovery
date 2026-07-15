import type { AttestedMcpRoute } from "./SpecialistCallability";
import type { ProviderReadiness } from "./RuntimeReadiness";

export const E2E_LIVE_ATTESTATION_FIXTURE_TOKEN = "canonical-no-network-readiness-v1";

export interface E2eLiveAttestationFixture {
  readonly provider: ProviderReadiness;
  readonly mcpRoutes: readonly AttestedMcpRoute[];
}

/**
 * Deterministic projection used only by the isolated populated Playwright host.
 *
 * This does not mutate either live-attestation cache and cannot activate under
 * a production NODE_ENV. The empty-state E2E host intentionally omits the
 * exact opt-in token so it continues to prove that launch fails closed without
 * live provider and MCP evidence.
 */
export function createE2eLiveAttestationFixture(
  env: NodeJS.ProcessEnv,
  now = new Date(),
): E2eLiveAttestationFixture | null {
  if (
    env.NODE_ENV !== "test"
    || env.CHILLSPWN_E2E_GUIDED_FIXTURE !== "1"
    || env.CHILLSPWN_E2E_LIVE_ATTESTATION_FIXTURE !== E2E_LIVE_ATTESTATION_FIXTURE_TOKEN
  ) return null;

  const attestedAt = now.toISOString();
  const providerExpiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();
  const routeExpiresAt = new Date(now.getTime() + 2 * 60_000).toISOString();
  return {
    provider: {
      id: "grok-acp",
      health: "healthy",
      authenticated: true,
      callable: true,
      attestedAt,
      expiresAt: providerExpiresAt,
      circuitState: "closed",
      supportsGuided: true,
      enforcesAutonomousBoundary: true,
      reportsExactTokenUsage: true,
      reportsExactCostUsage: false,
      reason: "[E2E-only fixture] No-network OAuth/ACP readiness attestation",
    },
    mcpRoutes: [{
      name: "sechub-reconnaissance",
      verified: true,
      tools: ["quick_scan"],
      assignedAgentIds: ["ReconScout"],
      attestedAt,
      expiresAt: routeExpiresAt,
      reason: "[E2E-only fixture] Exact no-network tools/list attestation",
    }],
  };
}
