import type { AgentSpec } from "../agents/types";
import type { ProviderReadiness } from "./RuntimeReadiness";
import type { FleetAgentProjection } from "./RuntimeProjectionService";

export interface AttestedMcpRoute {
  readonly name: string;
  readonly verified: boolean;
  readonly tools: readonly string[];
  /** Reviewed runtime assignment for routes outside the static roster map. */
  readonly assignedAgentIds?: readonly string[];
  readonly attestedAt: string | null;
  readonly expiresAt: string | null;
  readonly reason: string;
}

export interface SpecialistCallabilityOptions {
  readonly routingEnabled: boolean;
  readonly durableBoundaryActive: boolean;
  readonly providers: readonly ProviderReadiness[];
  readonly mcpRoutes: readonly AttestedMcpRoute[];
}

function healthyProviderIds(providers: readonly ProviderReadiness[]): string[] {
  return providers
    .filter((provider) => provider.health === "healthy"
      && provider.authenticated
      && provider.callable
      && (provider.enforcesAutonomousBoundary || provider.supportsGuided))
    .map((provider) => provider.id)
    .sort();
}

/**
 * Derive fleet status only from fresh provider and MCP route attestations.
 *
 * Roster declarations remain policy metadata. They do not become enabled
 * capabilities until a live MCP tools/list result proves the exact tool is
 * callable and at least one live-authenticated provider route is available.
 * This function deliberately does not manufacture a worker heartbeat.
 */
export function deriveSpecialistCallability(
  agent: AgentSpec,
  options: SpecialistCallabilityOptions,
): FleetAgentProjection {
  const providerIds = healthyProviderIds(options.providers);
  const allowedServers = new Set(agent.allowedMcpServers);
  const allowedTools = new Set(agent.allowedTools);
  const routeBindings = options.mcpRoutes
    .filter((route) => route.verified && (
      allowedServers.has(route.name)
      || route.assignedAgentIds?.includes(agent.agentId) === true
    ))
    .flatMap((route) => route.tools
      .filter((tool) => allowedTools.has(tool))
      .map((tool) => ({ route, tool })))
    .sort((left, right) => left.tool.localeCompare(right.tool) || left.route.name.localeCompare(right.route.name));

  const callable = options.routingEnabled
    && options.durableBoundaryActive
    && providerIds.length > 0
    && routeBindings.length > 0;
  const status: FleetAgentProjection["status"] = !options.routingEnabled || !options.durableBoundaryActive
    ? "offline"
    : providerIds.length === 0
      ? "offline"
      : callable
        ? "available"
        : "degraded";
  const capabilityNames = [...new Set(routeBindings.map((binding) => binding.tool))];

  return {
    id: agent.agentId,
    role: agent.specialty,
    displayName: agent.displayName,
    status,
    providerPolicy: {
      defaultProvider: agent.defaultProvider,
      attestedProviderIds: providerIds,
    },
    toolPolicy: {
      allowedTools: agent.allowedTools,
      deniedTools: agent.deniedTools,
      approvalRequiredTools: agent.approvalRequiredTools,
    },
    configuration: {
      personaId: agent.personaId,
      allowedMcpServers: agent.allowedMcpServers,
      outputContract: agent.outputContract,
      evidenceRequirements: agent.evidenceRequirements,
      safetyBoundaries: agent.safetyBoundaries,
      canProposeLessons: agent.canProposeTrainingLessons,
      canApproveLessons: agent.canApproveTrainingLessons,
      callability: {
        verified: callable,
        providerIds,
        mcpServers: [...new Set(routeBindings.map((binding) => binding.route.name))].sort(),
        reasons: [
          ...(providerIds.length === 0 ? ["No fresh live-authenticated provider route"] : []),
          ...(routeBindings.length === 0 ? ["No fresh live-attested MCP tool route"] : []),
        ],
      },
    },
    version: "2.1",
    capabilities: capabilityNames.map((name) => {
      const bindings = routeBindings.filter((binding) => binding.tool === name);
      const expiries = bindings
        .map((binding) => binding.route.expiresAt)
        .filter((value): value is string => value !== null)
        .sort();
      return {
        name,
        source: "live-route-attestation",
        enabled: callable,
        metadata: {
          mcpServers: bindings.map((binding) => binding.route.name),
          attestedAt: bindings.map((binding) => binding.route.attestedAt).filter(Boolean),
          validUntil: expiries[0] ?? null,
          providerIds,
        },
      };
    }),
  };
}
