import { describe, expect, test } from "bun:test";
import { AGENT_ROSTER } from "../../agents/agentRoster";
import { deriveSpecialistCallability, type AttestedMcpRoute } from "../SpecialistCallability";
import type { ProviderReadiness } from "../RuntimeReadiness";

const AGENT = AGENT_ROSTER[0]!;
const PROVIDER: ProviderReadiness = {
  id: "grok-acp",
  health: "healthy",
  authenticated: true,
  callable: true,
  attestedAt: "2026-07-15T12:00:00.000Z",
  expiresAt: "2026-07-15T12:05:00.000Z",
  circuitState: "closed",
  supportsGuided: true,
  enforcesAutonomousBoundary: true,
  reportsExactTokenUsage: true,
  reportsExactCostUsage: false,
};
const ROUTE: AttestedMcpRoute = {
  name: AGENT.allowedMcpServers[0]!,
  verified: true,
  tools: [AGENT.allowedTools[0]!],
  attestedAt: "2026-07-15T12:00:00.000Z",
  expiresAt: "2026-07-15T12:02:00.000Z",
  reason: "Live MCP tools/list surface attested",
};

describe("specialist live route callability", () => {
  test("enables only a fresh provider plus exact live MCP capability without inventing a heartbeat", () => {
    const projection = deriveSpecialistCallability(AGENT, {
      routingEnabled: true,
      durableBoundaryActive: true,
      providers: [PROVIDER],
      mcpRoutes: [ROUTE],
    });
    expect(projection.status).toBe("available");
    expect(projection.lastHeartbeatAt).toBeUndefined();
    expect(projection.capabilities).toEqual([
      expect.objectContaining({
        name: AGENT.allowedTools[0],
        source: "live-route-attestation",
        enabled: true,
        metadata: expect.objectContaining({
          mcpServers: [AGENT.allowedMcpServers[0]],
          validUntil: "2026-07-15T12:02:00.000Z",
          providerIds: ["grok-acp"],
        }),
      }),
    ]);
  });

  test("fails closed during provider or MCP outage", () => {
    const providerDown = deriveSpecialistCallability(AGENT, {
      routingEnabled: true,
      durableBoundaryActive: true,
      providers: [{ ...PROVIDER, health: "degraded", authenticated: false, callable: false }],
      mcpRoutes: [ROUTE],
    });
    expect(providerDown.status).toBe("offline");
    expect(providerDown.capabilities.every((capability) => !capability.enabled)).toBe(true);

    const mcpDown = deriveSpecialistCallability(AGENT, {
      routingEnabled: true,
      durableBoundaryActive: true,
      providers: [PROVIDER],
      mcpRoutes: [{ ...ROUTE, verified: false, tools: [], attestedAt: null, expiresAt: null }],
    });
    expect(mcpDown.status).toBe("degraded");
    expect(mcpDown.capabilities).toEqual([]);
  });

  test("accepts a reviewed external route only when it explicitly assigns the specialist", () => {
    const externalRoute: AttestedMcpRoute = {
      ...ROUTE,
      name: "reviewed-external-route",
      assignedAgentIds: [AGENT.agentId],
    };
    expect(AGENT.allowedMcpServers).not.toContain(externalRoute.name);

    const assigned = deriveSpecialistCallability(AGENT, {
      routingEnabled: true,
      durableBoundaryActive: true,
      providers: [PROVIDER],
      mcpRoutes: [externalRoute],
    });
    expect(assigned.status).toBe("available");
    expect(assigned.capabilities).toEqual([
      expect.objectContaining({
        name: AGENT.allowedTools[0],
        enabled: true,
        metadata: expect.objectContaining({ mcpServers: [externalRoute.name] }),
      }),
    ]);

    const unassigned = deriveSpecialistCallability(AGENT, {
      routingEnabled: true,
      durableBoundaryActive: true,
      providers: [PROVIDER],
      mcpRoutes: [{ ...externalRoute, assignedAgentIds: undefined }],
    });
    expect(unassigned.status).toBe("degraded");
    expect(unassigned.capabilities).toEqual([]);
  });

  test("explicit route assignment never bypasses the specialist tool allowlist", () => {
    const projection = deriveSpecialistCallability(AGENT, {
      routingEnabled: true,
      durableBoundaryActive: true,
      providers: [PROVIDER],
      mcpRoutes: [{
        ...ROUTE,
        name: "reviewed-external-route",
        assignedAgentIds: [AGENT.agentId],
        tools: ["not-an-allowed-tool"],
      }],
    });
    expect(projection.status).toBe("degraded");
    expect(projection.capabilities).toEqual([]);
  });
});
