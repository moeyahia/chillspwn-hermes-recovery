import { describe, expect, test } from "bun:test";
import type { AutonomousMissionRequest, GuidedMissionRequest } from "../../missions";
import {
  createTargetNetworkReadinessProvider,
  inspectTargetRoute,
  parseLinuxRouteTable,
} from "../TargetNetworkReadiness";

const header = "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT\n";
const publicDefault = `${header}eth0\t00000000\tFE991902\t0003\t0\t0\t0\t00000000\t0\t0\t0\n`;
const htbRoute = `${publicDefault}tun0\t0000810A\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0\n`;

function autonomous(target: string): AutonomousMissionRequest {
  return {
    journey: "autonomous",
    launch: true,
    title: "Authorized lab",
    objective: "Assess the supplied target.",
    successCriteria: ["Map reachable services"],
    authorization: {
      allowedTargets: [target],
      prohibitedTargets: [],
      authorizationConfirmed: true,
    },
    contract: {
      allowedActionClasses: ["port_service_enumeration"],
      prohibitedActionClasses: [],
      destructivePolicy: "prohibited",
      evidenceRequirements: ["port_service_scan_result"],
      timeBudgetMinutes: 30,
      retryBudget: 1,
      replanBudget: 1,
      concurrencyLimit: 1,
      evidenceStorageBudgetBytes: 1_000,
      artifactStorageBudgetBytes: 1_000,
      notificationPolicy: "in_app_only",
      reportingFormat: "command_os_json",
      dataHandlingPolicy: "local_private",
      retentionPolicy: "operator_managed",
      providerPolicy: "automatic_enforcing_only",
      toolPolicy: "contract_allowlist",
      specialistAgentIds: ["recon-agent"],
      memoryScopes: [],
      contextNodeIds: [],
      safeStopConditions: [],
      deliverables: [],
    },
  };
}

describe("target network readiness", () => {
  test("parses a specific HTB route and selects it over the public default", () => {
    const routes = parseLinuxRouteTable(htbRoute);
    expect(inspectTargetRoute("10.129.39.191", routes)).toEqual({
      target: "10.129.39.191",
      interfaceName: "tun0",
      routeKind: "specific",
    });
  });

  test("blocks Autonomous before launch when a private target would use the public default", () => {
    const provider = createTargetNetworkReadinessProvider({ readRouteTable: () => publicDefault });
    const result = provider.evaluate({ journey: "autonomous", request: autonomous("10.129.39.191") });
    expect(result).toMatchObject({ status: "fail" });
    expect(result).toHaveProperty("impact", expect.stringContaining("default public interface eth0"));
    expect(result).toHaveProperty("remediation", expect.stringContaining("Connect the authorized lab/VPN"));
  });

  test("passes Autonomous when the private target has a specific tunnel route", () => {
    const provider = createTargetNetworkReadinessProvider({ readRouteTable: () => htbRoute });
    expect(provider.evaluate({ journey: "autonomous", request: autonomous("10.129.39.191") }))
      .toMatchObject({ status: "pass" });
  });

  test("warns Guided without preventing a teaching-only workspace", () => {
    const request: GuidedMissionRequest = {
      journey: "guided",
      launch: true,
      authorizationConfirmed: true,
      title: "Guided lab",
      objective: "Explain the first step.",
      target: "http://10.129.39.191/",
      explanationDepth: "balanced",
      executionPreference: "manual",
      evidenceExpectations: [],
    };
    const provider = createTargetNetworkReadinessProvider({ readRouteTable: () => publicDefault });
    expect(provider.evaluate({ journey: "guided", request })).toMatchObject({ status: "warn" });
  });

  test("does not invent a tunnel requirement for a public or unresolved domain target", () => {
    const provider = createTargetNetworkReadinessProvider({ readRouteTable: () => publicDefault });
    expect(provider.evaluate({ journey: "autonomous", request: autonomous("example.test") }))
      .toMatchObject({ status: "pass" });
  });
});
