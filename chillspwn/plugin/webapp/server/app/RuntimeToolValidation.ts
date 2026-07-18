import type { AttestedMcpRoute } from "./SpecialistCallability";
import {
  isMcpToolExposable,
  reviewedMcpServerSurface,
  reviewedMcpToolDisposition,
} from "../mcp/McpToolDispositionRegistry";
import {
  auditV2ToolCoverage,
  type RegisteredV2Tool,
  type ToolRuntimeAttestation,
  type V2ToolCoverageEvidence,
  type V2ToolCoverageReport,
  v2ToolKey,
} from "../mcp/V2ToolCoverageAudit";
import { V2_TOOL_COVERAGE_EVIDENCE } from "../mcp/V2ToolCoverageEvidence";
import type {
  AutonomousMissionRequest,
  ReadinessCheck,
  ReadinessCheckProvider,
} from "../missions";
import {
  isActionClassId,
  type RuntimeSourceManifests,
  type RuntimeToolManifest,
} from "../domain";

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

/**
 * The inventory is deliberately carried on a symbol rather than a JSON field.
 * It is needed to calculate a signed-contract subset, but input schemas and
 * evidence receipts must not accidentally become part of the health payload.
 */
export const RUNTIME_TOOL_VALIDATION_INVENTORY = Symbol(
  "command-os-v2.runtime-tool-validation-inventory",
);

export interface RuntimeToolValidationInventory {
  readonly registrations: readonly RegisteredV2Tool[];
  readonly evidence: readonly V2ToolCoverageEvidence[];
}

export interface RuntimeToolValidationReport extends V2ToolCoverageReport {
  readonly [RUNTIME_TOOL_VALIDATION_INVENTORY]: RuntimeToolValidationInventory;
}

function validationInventory(
  report: V2ToolCoverageReport,
): RuntimeToolValidationInventory | undefined {
  const candidate = report as Partial<RuntimeToolValidationReport>;
  return candidate[RUNTIME_TOOL_VALIDATION_INVENTORY];
}

/**
 * Convert only fresh, exact tools/list route attestations into release-gate
 * registrations. The reviewed disposition registry remains authoritative for
 * vendor surfaces: a prohibited or intentionally unavailable binding cannot
 * become executable merely because a server advertises it.
 *
 * Missing schemas remain registered with an empty schema. This is deliberate:
 * the coverage audit must explain the missing schema rather than silently
 * dropping the tool and making the denominator smaller.
 */
export function registeredV2ToolsFromAttestedRoutes(
  routes: readonly AttestedMcpRoute[],
  runtimeAttestations: Readonly<Record<string, ToolRuntimeAttestation>> = {},
): readonly RegisteredV2Tool[] {
  const registrations: RegisteredV2Tool[] = [];
  for (const route of routes) {
    if (!route.verified) continue;
    const reviewedSurface = reviewedMcpServerSurface(route.name);
    for (const toolName of uniqueSorted(route.tools)) {
      const disposition = reviewedMcpToolDisposition(route.name, toolName);
      if (reviewedSurface && (!disposition || !isMcpToolExposable(disposition.disposition))) {
        continue;
      }
      const assigned = uniqueSorted(route.assignedAgentIds ?? []);
      const agentIds = disposition
        ? assigned.filter((agentId) => disposition.mappedAgentIds.includes(agentId))
        : assigned;
      registrations.push({
        serverName: route.name,
        toolName,
        agentIds,
        inputSchema: route.toolSchemas?.[toolName] ?? {},
        ...(runtimeAttestations[route.name]
          ? { runtimeAttestation: runtimeAttestations[route.name] }
          : {}),
      });
    }
  }
  return registrations;
}

/**
 * Runtime release truth. Merely writing a test name into source is never
 * sufficient: the default evidence registry is intentionally empty until a
 * hash-bound success/failure receipt is explicitly loaded into it.
 */
export function evaluateRuntimeToolValidation(
  routes: readonly AttestedMcpRoute[],
  evidence: readonly V2ToolCoverageEvidence[] = V2_TOOL_COVERAGE_EVIDENCE,
  runtimeAttestations: Readonly<Record<string, ToolRuntimeAttestation>> = {},
): RuntimeToolValidationReport {
  const registrations = registeredV2ToolsFromAttestedRoutes(routes, runtimeAttestations);
  const report = auditV2ToolCoverage(registrations, evidence);
  return Object.assign(report, {
    [RUNTIME_TOOL_VALIDATION_INVENTORY]: { registrations, evidence },
  });
}

interface RequiredToolSelection {
  readonly registrations: readonly RegisteredV2Tool[];
  readonly evidence: readonly V2ToolCoverageEvidence[];
  readonly actionClassIds: readonly string[];
  readonly specialistAgentIds: readonly string[];
  readonly mappingErrors: readonly string[];
}

function safeManifestToolFragment(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "") || "unknown";
}

function exactRegistrationForManifestTool(
  tool: RuntimeToolManifest,
  manifests: RuntimeSourceManifests,
  registrations: readonly RegisteredV2Tool[],
): { readonly registration?: RegisteredV2Tool; readonly error?: string } {
  if (!tool.mcpServerId) {
    return { error: `${tool.id} has no exact MCP server binding.` };
  }
  const server = manifests.mcpServers.find(({ id }) => id === tool.mcpServerId);
  if (!server) {
    return { error: `${tool.id} references unknown MCP server ${tool.mcpServerId}.` };
  }
  const prefix = `tool:${server.id}:`;
  if (!tool.id.startsWith(prefix) || tool.id.length === prefix.length) {
    return { error: `${tool.id} does not expose an exact runtime tool identity.` };
  }
  const fragment = tool.id.slice(prefix.length);
  const matches = registrations.filter((registration) =>
    registration.serverName === server.label
    && safeManifestToolFragment(registration.toolName) === fragment);
  if (matches.length !== 1) {
    return {
      error: matches.length === 0
        ? `${tool.id} has no matching live-attested validation registration.`
        : `${tool.id} maps to more than one live binding after identifier normalization.`,
    };
  }
  return { registration: matches[0] };
}

/**
 * Select the exact bindings the current Autonomous runtime may dispatch for
 * this signed contract. The intersection is authoritative and fail-closed:
 *
 * - the action class must be pre-authorized in the request;
 * - the tool must be mapped to that class by the live runtime manifest;
 * - a selected specialist must own the manifest tool and the live binding;
 * - the binding must be available and locally policy-enforced.
 *
 * V2 does not yet persist a narrower per-contract tool-name allowlist. As a
 * result, every dispatchable binding in this exact intersection is required
 * to pass—not merely one convenient alternative. That prevents preflight from
 * approving a class and then allowing the planner to select an unvalidated
 * sibling tool at runtime.
 */
function requiredAutonomousTools(
  request: AutonomousMissionRequest,
  manifests: RuntimeSourceManifests,
  inventory: RuntimeToolValidationInventory,
): RequiredToolSelection {
  const actionClassIds = uniqueSorted(request.contract.allowedActionClasses);
  const specialistAgentIds = uniqueSorted(request.contract.specialistAgentIds);
  const mappingErrors: string[] = [];
  const validActionClassIds = actionClassIds.filter((id) => {
    if (isActionClassId(id)) return true;
    mappingErrors.push(`The signed action class ${id} is not present in the canonical runtime registry.`);
    return false;
  });
  if (actionClassIds.length === 0) {
    mappingErrors.push("The signed contract does not contain a pre-authorized action class.");
  }
  if (specialistAgentIds.length === 0) {
    mappingErrors.push("The signed contract does not contain a specialist assignment boundary.");
  }

  const selectedAgents = manifests.agents.filter(({ id }) => specialistAgentIds.includes(id));
  for (const specialistAgentId of specialistAgentIds) {
    if (!selectedAgents.some(({ id }) => id === specialistAgentId)) {
      mappingErrors.push(`Selected specialist ${specialistAgentId} is absent from the current runtime manifest.`);
    }
  }
  const ownedToolIds = new Set(selectedAgents.flatMap(({ toolIds }) => toolIds));
  const manifestCandidates = manifests.tools.filter((tool) =>
    tool.available
    && tool.locallyPolicyEnforced
    && ownedToolIds.has(tool.id)
    && tool.actionClassIds.some((id) => validActionClassIds.includes(id)));

  for (const actionClassId of validActionClassIds) {
    const mapped = manifests.tools.filter((tool) =>
      ownedToolIds.has(tool.id) && tool.actionClassIds.includes(actionClassId));
    if (mapped.length === 0) {
      mappingErrors.push(
        `Action class ${actionClassId} has no tool mapped to the selected specialist team.`,
      );
    } else if (!mapped.some((tool) => tool.available && tool.locallyPolicyEnforced)) {
      mappingErrors.push(
        `Action class ${actionClassId} has no available locally enforced tool path for the selected specialist team.`,
      );
    }
  }

  const registrations: RegisteredV2Tool[] = [];
  for (const tool of manifestCandidates) {
    const resolved = exactRegistrationForManifestTool(tool, manifests, inventory.registrations);
    if (!resolved.registration) {
      mappingErrors.push(resolved.error ?? `${tool.id} could not be mapped to an exact validation registration.`);
      continue;
    }
    if (!resolved.registration.agentIds.some((id) => specialistAgentIds.includes(id))) {
      mappingErrors.push(
        `${tool.id} is not live-attested for the specialist selected by the signed contract.`,
      );
      continue;
    }
    registrations.push(resolved.registration);
  }

  const registrationByKey = new Map(
    registrations.map((registration) => [
      v2ToolKey(registration.serverName, registration.toolName),
      registration,
    ] as const),
  );
  const requiredKeys = new Set(registrationByKey.keys());
  return {
    registrations: [...registrationByKey.values()],
    evidence: inventory.evidence.filter((item) =>
      requiredKeys.has(v2ToolKey(item.serverName, item.toolName))),
    actionClassIds,
    specialistAgentIds,
    mappingErrors: uniqueSorted(mappingErrors),
  };
}

function globalReadinessCheck(report: V2ToolCoverageReport, guided: boolean): ReadinessCheck {
  if (report.releasable) {
    return {
      id: "runtime_tool_validation",
      label: "Audited tool execution",
      status: "pass",
      journeys: ["autonomous", "guided"],
      impact: `All ${report.registeredTools} exposed tool bindings have current schema, success-path, and failure-classification evidence.`,
    };
  }
  return {
    id: "runtime_tool_validation",
    label: "Audited tool execution",
    status: guided ? "warn" : "fail",
    journeys: ["autonomous", "guided"],
    impact: guided
      ? `Only ${report.fullyCovered} of ${report.registeredTools} exposed tool bindings have complete validation. Guided may continue with manual steps, but agent-run tool actions are not release-ready.`
      : `Only ${report.fullyCovered} of ${report.registeredTools} exposed tool bindings have complete validation, so Autonomous launch is blocked before any tool call.`,
    remediation: "Complete exact schema, safe success-path, and deterministic failure tests for every exposed binding, then attach current hash-bound receipts.",
  };
}

/**
 * Adds the exact per-tool validation gate to mission preflight. Autonomous is
 * scoped to the live, dispatchable intersection of signed action classes and
 * selected specialists when the canonical manifests are available. Guided can
 * continue with manual represented steps, while global/no-contract readiness
 * continues to report the complete exposed surface.
 */
export function createRuntimeToolValidationReadinessProvider(
  read: () => V2ToolCoverageReport,
  readRuntimeManifests?: () => RuntimeSourceManifests | undefined,
): ReadinessCheckProvider {
  return {
    id: "runtime_tool_validation",
    label: "Audited tool execution",
    journeys: ["autonomous", "guided"],
    evaluate(context) {
      const report = read();
      const request = context.request?.journey === "autonomous"
        ? context.request
        : undefined;
      if (!request) {
        return globalReadinessCheck(
          report,
          (context.request?.journey ?? context.journey) === "guided",
        );
      }

      const inventory = validationInventory(report);
      const manifests = readRuntimeManifests?.();
      if (!inventory || !manifests) {
        return {
          id: "runtime_tool_validation",
          label: "Audited tool execution",
          status: "fail",
          journeys: ["autonomous"],
          impact: "The runtime cannot prove which live tool bindings belong to this signed action-class and specialist intersection, so Autonomous launch remains blocked.",
          remediation: "Restore the canonical runtime capability manifest and exact tool-validation inventory, then rerun contract preflight.",
        };
      }

      const required = requiredAutonomousTools(request, manifests, inventory);
      if (required.mappingErrors.length > 0) {
        return {
          id: "runtime_tool_validation",
          label: "Audited tool execution",
          status: "fail",
          journeys: ["autonomous"],
          impact: `The signed contract's required tool surface could not be proven: ${required.mappingErrors.slice(0, 4).join(" ")}`,
          remediation: "Select action classes and specialists with an exact available locally enforced runtime mapping; do not bypass or infer missing tool ownership.",
        };
      }

      const scoped = auditV2ToolCoverage(required.registrations, required.evidence);
      if (scoped.releasable) {
        return {
          id: "runtime_tool_validation",
          label: "Audited tool execution",
          status: "pass",
          journeys: ["autonomous"],
          impact: `All ${scoped.registeredTools} tool binding${scoped.registeredTools === 1 ? "" : "s"} dispatchable by the signed ${required.actionClassIds.length}-class, ${required.specialistAgentIds.length}-specialist contract have current validation evidence; unrelated exposed tools do not block this mission.`,
        };
      }
      const blockerSummary = scoped.blockers.slice(0, 4)
        .map(({ toolKey, code }) => `${toolKey} (${code})`).join(", ");
      return {
        id: "runtime_tool_validation",
        label: "Audited tool execution",
        status: "fail",
        journeys: ["autonomous"],
        impact: `Only ${scoped.fullyCovered} of ${scoped.registeredTools} bindings dispatchable by this signed contract have complete validation. Required blockers: ${blockerSummary || "the required inventory is empty"}.`,
        remediation: "Validate or remove the exact required binding, or amend the signed action classes and specialist team to a fully audited capability path.",
      };
    },
  };
}
