import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import type {
  MissionCreateRequest,
  ReadinessCheck,
  ReadinessCheckProvider,
} from "../missions";

interface RouteEntry {
  readonly interfaceName: string;
  readonly destination: number;
  readonly mask: number;
  readonly prefixLength: number;
}

export interface TargetRouteInspection {
  readonly target: string;
  readonly interfaceName: string | null;
  readonly routeKind: "specific" | "trusted_default" | "public_default" | "unresolved";
}

export interface TargetNetworkReadinessOptions {
  readonly readRouteTable?: () => string;
}

function ipv4Number(value: string): number | null {
  if (isIP(value) !== 4) return null;
  return value.split(".").reduce((result, part) => (
    ((result << 8) | Number(part)) >>> 0
  ), 0);
}

function littleEndianRouteNumber(value: string): number | null {
  if (!/^[0-9A-Fa-f]{8}$/u.test(value)) return null;
  const bytes = value.match(/../gu);
  if (!bytes) return null;
  return Number.parseInt([...bytes].reverse().join(""), 16) >>> 0;
}

function prefixLength(mask: number): number {
  let bits = 0;
  let value = mask >>> 0;
  while (value !== 0) {
    bits += value & 1;
    value >>>= 1;
  }
  return bits;
}

export function parseLinuxRouteTable(raw: string): readonly RouteEntry[] {
  return raw.split(/\r?\n/gu).slice(1).flatMap((line) => {
    const fields = line.trim().split(/\s+/u);
    if (fields.length < 8) return [];
    const destination = littleEndianRouteNumber(fields[1] ?? "");
    const flags = Number.parseInt(fields[3] ?? "", 16);
    const mask = littleEndianRouteNumber(fields[7] ?? "");
    if (destination === null || mask === null || !Number.isFinite(flags) || (flags & 0x1) === 0) return [];
    return [{
      interfaceName: fields[0]!,
      destination,
      mask,
      prefixLength: prefixLength(mask),
    }];
  });
}

function privateIpv4(value: number): boolean {
  return (value & 0xff00_0000) === 0x0a00_0000
    || (value & 0xfff0_0000) === 0xac10_0000
    || (value & 0xffff_0000) === 0xc0a8_0000;
}

function literalIpv4(value: string): string | null {
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    if (isIP(parsed.hostname) === 4) return parsed.hostname;
  } catch {
    // Continue with host/CIDR syntax.
  }
  const host = trimmed.split("/", 1)[0] ?? "";
  return isIP(host) === 4 ? host : null;
}

function requestTargets(request: MissionCreateRequest | undefined): readonly string[] {
  if (!request) return [];
  return request.journey === "autonomous"
    ? request.authorization.allowedTargets
    : request.target ? [request.target] : [];
}

function trustedTunnelInterface(interfaceName: string): boolean {
  return /^(?:tun|tap|wg|ppp|tailscale|htb)/iu.test(interfaceName);
}

export function inspectTargetRoute(
  target: string,
  routes: readonly RouteEntry[],
): TargetRouteInspection {
  const numeric = ipv4Number(target);
  if (numeric === null) return { target, interfaceName: null, routeKind: "unresolved" };
  const matches = routes
    .filter(({ destination, mask }) => ((numeric & mask) >>> 0) === ((destination & mask) >>> 0))
    .sort((left, right) => right.prefixLength - left.prefixLength);
  const route = matches[0];
  if (!route) return { target, interfaceName: null, routeKind: "unresolved" };
  if (route.prefixLength > 0) {
    return { target, interfaceName: route.interfaceName, routeKind: "specific" };
  }
  return {
    target,
    interfaceName: route.interfaceName,
    routeKind: trustedTunnelInterface(route.interfaceName) ? "trusted_default" : "public_default",
  };
}

export function createTargetNetworkReadinessProvider(
  options: TargetNetworkReadinessOptions = {},
): ReadinessCheckProvider {
  const readRouteTable = options.readRouteTable
    ?? (() => readFileSync("/proc/net/route", "utf8"));
  return {
    id: "target_network_route",
    label: "Target network route",
    journeys: ["autonomous", "guided"],
    evaluate(context): ReadinessCheck {
      const targets = [...new Set(requestTargets(context.request)
        .map(literalIpv4)
        .filter((value): value is string => value !== null)
        .filter((value) => privateIpv4(ipv4Number(value)!)))];
      if (targets.length === 0) {
        return {
          id: "target_network_route",
          label: "Target network route",
          status: "pass",
          journeys: ["autonomous", "guided"],
          impact: "No literal private-network target requires a local tunnel-route check.",
        };
      }

      let routes: readonly RouteEntry[];
      try {
        routes = parseLinuxRouteTable(readRouteTable());
      } catch {
        return {
          id: "target_network_route",
          label: "Target network route",
          status: context.journey === "guided" ? "warn" : "fail",
          journeys: ["autonomous", "guided"],
          impact: `The local route to private target${targets.length === 1 ? "" : "s"} ${targets.join(", ")} could not be verified.`,
          remediation: "Restore route-table visibility, then rerun readiness before executing a network step.",
        };
      }

      const missing = targets.map((target) => inspectTargetRoute(target, routes))
        .filter(({ routeKind }) => routeKind === "public_default" || routeKind === "unresolved");
      if (missing.length > 0) {
        const routeSummary = missing.map(({ target, interfaceName, routeKind }) =>
          routeKind === "public_default"
            ? `${target} would use the default public interface ${interfaceName}`
            : `${target} has no usable local route`)
          .join("; ");
        return {
          id: "target_network_route",
          label: "Target network route",
          status: context.journey === "guided" ? "warn" : "fail",
          journeys: ["autonomous", "guided"],
          impact: `${routeSummary}. Network tools cannot reach the authorized private target from this runtime.`,
          remediation: "Connect the authorized lab/VPN network, verify its tun/tap/WireGuard route, then rerun mission readiness.",
        };
      }

      return {
        id: "target_network_route",
        label: "Target network route",
        status: "pass",
        journeys: ["autonomous", "guided"],
        impact: `A specific or trusted tunnel route is present for ${targets.join(", ")}. This verifies routing only; target liveness is checked during execution.`,
      };
    },
  };
}
