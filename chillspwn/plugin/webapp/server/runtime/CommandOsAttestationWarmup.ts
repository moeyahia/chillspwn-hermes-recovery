export interface StartupAttestationSnapshot {
  readonly verified: boolean;
  readonly inFlight: boolean;
  readonly reason: string;
}

export interface StartupAttestationScheduler {
  refreshIfDue(key: string): void;
  snapshot(key: string): StartupAttestationSnapshot;
}

export interface StartupMcpRoute {
  readonly name: string;
  readonly enabled: boolean;
  readonly healthState: string;
}

export interface StartupAttestationWarmupResult {
  readonly provider: {
    readonly state: "disabled" | "ready" | "probing" | "unavailable";
    readonly reason: string;
  };
  readonly mcp: {
    readonly state: "disabled" | "ready" | "probing" | "unavailable";
    readonly eligibleRoutes: number;
    readonly probingRoutes: number;
    readonly reason: string;
  };
}

function schedule(
  scheduler: StartupAttestationScheduler,
  key: string,
): StartupAttestationSnapshot {
  try {
    scheduler.refreshIfDue(key);
    return scheduler.snapshot(key);
  } catch {
    return {
      verified: false,
      inFlight: false,
      reason: "Live attestation warm-up could not be scheduled",
    };
  }
}

/**
 * Start existing bounded live-attestation probes before the first readiness
 * request. This function deliberately does not await them and never converts a
 * scheduled probe into authority: normal cache snapshots remain fail-closed
 * until the provider or MCP route has completed a fresh attestation.
 */
export function warmCommandOsStartupAttestations(options: {
  readonly providerEnabled: boolean;
  readonly providerId: string;
  readonly providerAttestations: StartupAttestationScheduler;
  readonly mcpEnabled: boolean;
  readonly mcpStartPermitted: boolean;
  readonly mcpRoutes: readonly StartupMcpRoute[];
  readonly mcpAttestations: StartupAttestationScheduler;
}): StartupAttestationWarmupResult {
  const providerSnapshot = options.providerEnabled
    ? schedule(options.providerAttestations, options.providerId)
    : undefined;
  const provider = !providerSnapshot
    ? {
        state: "disabled" as const,
        reason: "Live provider attestation is supplied by an isolated fixture",
      }
    : providerSnapshot.verified
      ? { state: "ready" as const, reason: providerSnapshot.reason }
      : providerSnapshot.inFlight
        ? { state: "probing" as const, reason: providerSnapshot.reason }
        : { state: "unavailable" as const, reason: providerSnapshot.reason };

  if (!options.mcpEnabled || !options.mcpStartPermitted) {
    return {
      provider,
      mcp: {
        state: "disabled",
        eligibleRoutes: 0,
        probingRoutes: 0,
        reason: "Live MCP execution or server startup is disabled",
      },
    };
  }

  const eligible = options.mcpRoutes.filter((route) =>
    route.enabled && (route.healthState === "configured" || route.healthState === "healthy"));
  const snapshots = eligible.map((route) => schedule(options.mcpAttestations, route.name));
  const probingRoutes = snapshots.filter((snapshot) => snapshot.inFlight).length;
  const readyRoutes = snapshots.filter((snapshot) => snapshot.verified).length;
  const mcp = eligible.length === 0
    ? {
        state: "unavailable" as const,
        eligibleRoutes: 0,
        probingRoutes: 0,
        reason: "No enabled MCP route has runnable startup prerequisites",
      }
    : readyRoutes === eligible.length
      ? {
          state: "ready" as const,
          eligibleRoutes: eligible.length,
          probingRoutes,
          reason: "Every eligible MCP route already has a fresh live attestation",
        }
      : probingRoutes > 0
        ? {
            state: "probing" as const,
            eligibleRoutes: eligible.length,
            probingRoutes,
            reason: "Live MCP route attestation is in progress; execution remains fail-closed",
          }
        : {
            state: "unavailable" as const,
            eligibleRoutes: eligible.length,
            probingRoutes: 0,
            reason: "Eligible MCP routes have not completed a fresh live attestation",
          };

  return { provider, mcp };
}
