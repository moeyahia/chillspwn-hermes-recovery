import { createHash } from "node:crypto";
import type { FailureCategory } from "../supervisor";

export const TOOL_SUCCESS_FIXTURE_KINDS = [
  "local_no_network",
  "disposable_local_lab",
  "public_authoritative_read_only",
] as const;
export type ToolSuccessFixtureKind = (typeof TOOL_SUCCESS_FIXTURE_KINDS)[number];

export const TOOL_IMPLEMENTATION_LEVELS = [
  "dispatcher_only",
  "vendor_adapter",
  "vendor_implementation",
] as const;
export type ToolImplementationLevel = (typeof TOOL_IMPLEMENTATION_LEVELS)[number];

export interface RegisteredV2Tool {
  readonly serverName: string;
  readonly toolName: string;
  readonly agentIds: readonly string[];
  readonly inputSchema: Readonly<Record<string, unknown>>;
  /**
   * Present only when the audit resolved and hashed the exact installed server
   * implementation plus the trusted runtime registry that selected it.
   */
  readonly runtimeAttestation?: ToolRuntimeAttestation;
}

export interface ToolRuntimeAttestation {
  readonly serverAssetSha256: string;
  readonly registryConfigSha256: string;
}

export interface PublicReadOnlyExecutionReceipt extends ToolRuntimeAttestation {
  readonly receiptId: string;
  readonly observedAt: string;
  readonly schemaSha256: string;
  readonly resultSha256: string;
  readonly invalidInputProofSha256: string;
  readonly deterministicFailureProofSha256: string;
  readonly rateLimitProofSha256: string;
  readonly authority: "services.nvd.nist.gov";
  readonly minimumRequestIntervalMs: number;
  readonly publicRequests: 3;
  readonly publicLlmCalls: 0;
  readonly clientTargetsContacted: 0;
  readonly rateLimitInduced: false;
}

/**
 * Hash-bound proof from a disposable local implementation canary. Unlike a
 * source-level test name, this proves which installed server/config/schema
 * produced the result and that the fixture could not be a client target.
 */
export interface LocalToolExecutionReceipt extends ToolRuntimeAttestation {
  readonly receiptId: string;
  readonly observedAt: string;
  readonly schemaSha256: string;
  readonly resultSha256: string;
  readonly invalidInputProofSha256: string;
  readonly deterministicFailureProofSha256: string;
  readonly fixtureKind: Extract<ToolSuccessFixtureKind, "local_no_network" | "disposable_local_lab">;
  readonly loopbackOnly: boolean;
  readonly serviceUid: number;
  readonly serviceGid: number;
  readonly noNewPrivileges: true;
  readonly publicRequests: 0;
  readonly publicLlmCalls: 0;
  readonly clientTargetsContacted: 0;
}

export interface ToolSchemaValidationEvidence {
  /** Stable Bun test name, not a prose assertion. */
  readonly testId: string;
  /** SHA-256 of the exact canonical tools/list input schema exercised by the test. */
  readonly schemaSha256: string;
}

export interface ToolSuccessPathEvidence {
  /** Stable Bun/integration test name. */
  readonly testId: string;
  readonly fixtureKind: ToolSuccessFixtureKind;
  /**
   * `dispatcher_only` proves the generic bridge but does not prove this tool's
   * adapter/implementation. It is deliberately insufficient for the release gate.
   */
  readonly implementationLevel: ToolImplementationLevel;
  /** Required for a live public-authority canary; absent for local fixtures. */
  readonly liveReceipt?: PublicReadOnlyExecutionReceipt;
  /** Required for a runtime-attested local implementation claim. */
  readonly localReceipt?: LocalToolExecutionReceipt;
}

export interface ToolFailurePathEvidence {
  /** Stable Bun/integration test name. */
  readonly testId: string;
  /** Invalid arguments must fail before dispatch. */
  readonly invalidInputCategory: FailureCategory;
  /** A deterministic tool-side failure must remain distinct from infrastructure failure. */
  readonly executionFailureCategory: FailureCategory;
  /** Public adapters must prove a 429 is not mislabeled as deterministic. */
  readonly rateLimitFailureCategory?: FailureCategory;
}

export interface V2ToolCoverageEvidence {
  readonly serverName: string;
  readonly toolName: string;
  readonly schemaValidation?: ToolSchemaValidationEvidence;
  readonly successPath?: ToolSuccessPathEvidence;
  readonly failurePath?: ToolFailurePathEvidence;
  /**
   * A verified implementation receipt may prove why the production adapter
   * cannot safely expose this binding. It is evidence of a blocker, never a
   * substitute for a success-path test.
   */
  readonly implementationBlocker?: {
    readonly receiptId: string;
    readonly message: string;
  };
}

export type ToolCoverageBlockerCode =
  | "no_registered_tools"
  | "duplicate_registration"
  | "duplicate_coverage_evidence"
  | "missing_input_schema"
  | "missing_schema_validation_test"
  | "schema_test_is_stale"
  | "missing_safe_success_path_test"
  | "implementation_blocked"
  | "dispatcher_only_success_test"
  | "missing_live_execution_receipt"
  | "missing_local_execution_receipt"
  | "stale_server_asset"
  | "stale_registry_config"
  | "unsafe_public_fixture"
  | "unsafe_local_fixture"
  | "missing_failure_classification_test"
  | "missing_rate_limit_classification"
  | "invalid_failure_classification";

export interface ToolCoverageBlocker {
  readonly toolKey: string;
  readonly code: ToolCoverageBlockerCode;
  readonly message: string;
}

export interface V2ToolCoverageReport {
  readonly registeredTools: number;
  readonly toolsWithInputSchemas: number;
  readonly schemaValidationCovered: number;
  readonly safeSuccessPathCovered: number;
  readonly failureClassificationCovered: number;
  readonly fullyCovered: number;
  readonly blockers: readonly ToolCoverageBlocker[];
  readonly releasable: boolean;
}

export interface RegisteredV2ProviderRoute {
  readonly routeId: string;
  readonly exposed: boolean;
}

export interface V2ProviderCoverageEvidence {
  readonly routeId: string;
  readonly successTestId?: string;
  readonly failureTestIds?: Partial<Record<
    Extract<FailureCategory, "rate_limit" | "provider_unavailable" | "authentication_missing">,
    string
  >>;
}

export interface V2ProviderCoverageReport {
  readonly exposedRoutes: number;
  readonly fullyCovered: number;
  readonly blockers: readonly {
    readonly routeId: string;
    readonly code: "missing_success_test" | "missing_failure_test" | "duplicate_coverage_evidence";
    readonly message: string;
  }[];
  readonly releasable: boolean;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Tool schema contains a non-JSON value");
  return encoded;
}

export function toolInputSchemaSha256(schema: Readonly<Record<string, unknown>>): string {
  return createHash("sha256").update(canonicalJson(schema)).digest("hex");
}

export function v2ToolKey(serverName: string, toolName: string): string {
  return `${serverName.trim()}::${toolName.trim()}`;
}

function usableObjectSchema(schema: Readonly<Record<string, unknown>>): boolean {
  if (schema.type !== undefined && schema.type !== "object") return false;
  return Boolean(
    schema.type === "object"
    || (schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties))
    || Array.isArray(schema.allOf)
    || Array.isArray(schema.anyOf)
    || Array.isArray(schema.oneOf),
  );
}

/**
 * Release-gating audit for the exact tools exposed by the live V2 runtime.
 *
 * The audit intentionally does not infer coverage from a broad test file or a
 * mock that happens to accept arbitrary tool names. Every exact server/tool
 * binding needs versioned evidence tied to its current tools/list schema, a
 * no-network/disposable success fixture that reaches at least the vendor
 * adapter, and explicit invalid-input plus deterministic-failure categories.
 */
export function auditV2ToolCoverage(
  registrations: readonly RegisteredV2Tool[],
  evidence: readonly V2ToolCoverageEvidence[],
): V2ToolCoverageReport {
  const blockers: ToolCoverageBlocker[] = [];
  const registered = new Map<string, RegisteredV2Tool>();
  for (const tool of registrations) {
    const key = v2ToolKey(tool.serverName, tool.toolName);
    if (registered.has(key)) {
      blockers.push({
        toolKey: key,
        code: "duplicate_registration",
        message: "The runtime exposed the same server/tool binding more than once.",
      });
    } else {
      registered.set(key, tool);
    }
  }

  // An empty inventory is not proof of a safe execution surface. It means the
  // process has no exact server/tool binding to validate, which must keep the
  // execution release gate closed.
  if (registered.size === 0) {
    blockers.push({
      toolKey: "runtime::*",
      code: "no_registered_tools",
      message: "No live-attested V2 tool binding is registered for validation.",
    });
  }

  const coverage = new Map<string, V2ToolCoverageEvidence>();
  for (const item of evidence) {
    const key = v2ToolKey(item.serverName, item.toolName);
    if (coverage.has(key)) {
      blockers.push({
        toolKey: key,
        code: "duplicate_coverage_evidence",
        message: "More than one coverage record claims this exact server/tool binding.",
      });
    } else {
      coverage.set(key, item);
    }
  }

  let toolsWithInputSchemas = 0;
  let schemaValidationCovered = 0;
  let safeSuccessPathCovered = 0;
  let failureClassificationCovered = 0;
  let fullyCovered = 0;

  for (const [key, tool] of registered) {
    const item = coverage.get(key);
    const schemaPresent = usableObjectSchema(tool.inputSchema);
    if (schemaPresent) toolsWithInputSchemas += 1;
    else {
      blockers.push({
        toolKey: key,
        code: "missing_input_schema",
        message: "The live tools/list result did not provide a usable object input schema.",
      });
    }

    let schemaPass = false;
    if (!item?.schemaValidation) {
      blockers.push({
        toolKey: key,
        code: "missing_schema_validation_test",
        message: "No exact per-tool schema validation test is registered.",
      });
    } else if (item.schemaValidation.schemaSha256 !== toolInputSchemaSha256(tool.inputSchema)) {
      blockers.push({
        toolKey: key,
        code: "schema_test_is_stale",
        message: "The registered test covers a different tools/list input schema hash.",
      });
    } else if (item.schemaValidation.testId.trim()) {
      schemaPass = true;
      schemaValidationCovered += 1;
    }

    let successPass = false;
    if (!item?.successPath?.testId.trim()) {
      blockers.push({
        toolKey: key,
        code: item?.implementationBlocker ? "implementation_blocked" : "missing_safe_success_path_test",
        message: item?.implementationBlocker?.message
          ?? "No local no-network or disposable-lab success-path test is registered.",
      });
    } else if (item.successPath.implementationLevel === "dispatcher_only") {
      blockers.push({
        toolKey: key,
        code: "dispatcher_only_success_test",
        message: "A generic dispatcher mock does not prove the tool adapter or implementation.",
      });
    } else if (item.successPath.fixtureKind === "public_authoritative_read_only") {
      const receipt = item.successPath.liveReceipt;
      if (!receipt || !tool.runtimeAttestation) {
        blockers.push({
          toolKey: key,
          code: "missing_live_execution_receipt",
          message: "The public read-only success claim has no live receipt bound to the installed runtime assets.",
        });
      } else if (
        receipt.serverAssetSha256 !== tool.runtimeAttestation.serverAssetSha256
        || receipt.schemaSha256 !== toolInputSchemaSha256(tool.inputSchema)
      ) {
        blockers.push({
          toolKey: key,
          code: "stale_server_asset",
          message: "The live receipt covers a different server asset or input schema.",
        });
      } else if (receipt.registryConfigSha256 !== tool.runtimeAttestation.registryConfigSha256) {
        blockers.push({
          toolKey: key,
          code: "stale_registry_config",
          message: "The live receipt covers a different trusted MCP registry configuration.",
        });
      } else if (
        receipt.authority !== "services.nvd.nist.gov"
        || receipt.minimumRequestIntervalMs < 6_500
        || receipt.publicRequests !== 3
        || receipt.publicLlmCalls !== 0
        || receipt.clientTargetsContacted !== 0
        || receipt.rateLimitInduced !== false
        || !/^[a-f0-9]{64}$/u.test(receipt.resultSha256)
        || !/^[a-f0-9]{64}$/u.test(receipt.invalidInputProofSha256)
        || !/^[a-f0-9]{64}$/u.test(receipt.deterministicFailureProofSha256)
        || !/^[a-f0-9]{64}$/u.test(receipt.rateLimitProofSha256)
        || !/^nvd_canary_[a-f0-9]{32}$/u.test(receipt.receiptId)
        || !Number.isFinite(Date.parse(receipt.observedAt))
      ) {
        blockers.push({
          toolKey: key,
          code: "unsafe_public_fixture",
          message: "The live receipt does not prove a bounded NVD-only call with no client target, public LLM, or induced rate limit.",
        });
      } else {
        successPass = true;
        safeSuccessPathCovered += 1;
      }
    } else if (tool.runtimeAttestation) {
      const receipt = item.successPath.localReceipt;
      if (!receipt) {
        blockers.push({
          toolKey: key,
          code: "missing_local_execution_receipt",
          message: "The local success claim has no hash-bound implementation receipt.",
        });
      } else if (
        receipt.serverAssetSha256 !== tool.runtimeAttestation.serverAssetSha256
        || receipt.schemaSha256 !== toolInputSchemaSha256(tool.inputSchema)
      ) {
        blockers.push({
          toolKey: key,
          code: "stale_server_asset",
          message: "The local receipt covers a different server asset or input schema.",
        });
      } else if (receipt.registryConfigSha256 !== tool.runtimeAttestation.registryConfigSha256) {
        blockers.push({
          toolKey: key,
          code: "stale_registry_config",
          message: "The local receipt covers a different trusted MCP registry configuration.",
        });
      } else if (
        receipt.fixtureKind !== item.successPath.fixtureKind
        || receipt.loopbackOnly !== true
        || receipt.noNewPrivileges !== true
        || receipt.publicRequests !== 0
        || receipt.publicLlmCalls !== 0
        || receipt.clientTargetsContacted !== 0
        || !Number.isInteger(receipt.serviceUid)
        || receipt.serviceUid <= 0
        || !Number.isInteger(receipt.serviceGid)
        || receipt.serviceGid <= 0
        || !/^[a-f0-9]{64}$/u.test(receipt.resultSha256)
        || !/^[a-f0-9]{64}$/u.test(receipt.invalidInputProofSha256)
        || !/^[a-f0-9]{64}$/u.test(receipt.deterministicFailureProofSha256)
        || !/^(?:pentest_recon|vulnintel_cve)_canary_[a-f0-9]{32}$/u.test(receipt.receiptId)
        || !Number.isFinite(Date.parse(receipt.observedAt))
      ) {
        blockers.push({
          toolKey: key,
          code: "unsafe_local_fixture",
          message: "The local receipt does not prove a bounded loopback/no-network service-user fixture.",
        });
      } else {
        successPass = true;
        safeSuccessPathCovered += 1;
      }
    } else {
      successPass = true;
      safeSuccessPathCovered += 1;
    }

    let failurePass = false;
    if (!item?.failurePath?.testId.trim() && !item?.implementationBlocker) {
      blockers.push({
        toolKey: key,
        code: "missing_failure_classification_test",
        message: "No exact per-tool failure classification test is registered.",
      });
    } else if (item?.failurePath && (
      item.failurePath.invalidInputCategory !== "invalid_input"
      || item.failurePath.executionFailureCategory !== "deterministic_tool_error"
    )) {
      blockers.push({
        toolKey: key,
        code: "invalid_failure_classification",
        message: "The test must distinguish invalid input from deterministic tool failure.",
      });
    } else if (item?.failurePath && (
      item.successPath?.fixtureKind === "public_authoritative_read_only"
      && item.failurePath.rateLimitFailureCategory !== "rate_limit"
    )) {
      blockers.push({
        toolKey: key,
        code: "missing_rate_limit_classification",
        message: "The public adapter coverage does not prove that an upstream 429 is classified as rate_limit.",
      });
    } else if (item?.failurePath) {
      failurePass = true;
      failureClassificationCovered += 1;
    }

    if (item?.implementationBlocker && item.successPath?.testId.trim()) {
      blockers.push({
        toolKey: key,
        code: "implementation_blocked",
        message: item.implementationBlocker.message,
      });
    }

    if (schemaPresent && schemaPass && successPass && failurePass && !item?.implementationBlocker) fullyCovered += 1;
  }

  return {
    registeredTools: registered.size,
    toolsWithInputSchemas,
    schemaValidationCovered,
    safeSuccessPathCovered,
    failureClassificationCovered,
    fullyCovered,
    blockers,
    releasable: blockers.length === 0 && fullyCovered === registered.size,
  };
}

export function auditV2ProviderCoverage(
  registrations: readonly RegisteredV2ProviderRoute[],
  evidence: readonly V2ProviderCoverageEvidence[],
): V2ProviderCoverageReport {
  const exposed = registrations.filter(({ exposed }) => exposed);
  const records = new Map<string, V2ProviderCoverageEvidence>();
  const blockers: V2ProviderCoverageReport["blockers"][number][] = [];
  for (const record of evidence) {
    if (records.has(record.routeId)) {
      blockers.push({
        routeId: record.routeId,
        code: "duplicate_coverage_evidence",
        message: "More than one coverage record claims this provider route.",
      });
    } else records.set(record.routeId, record);
  }
  let fullyCovered = 0;
  for (const route of exposed) {
    const record = records.get(route.routeId);
    let pass = true;
    if (!record?.successTestId?.trim()) {
      pass = false;
      blockers.push({
        routeId: route.routeId,
        code: "missing_success_test",
        message: "No dependency-injected provider success-path test is registered.",
      });
    }
    for (const category of ["rate_limit", "provider_unavailable", "authentication_missing"] as const) {
      if (!record?.failureTestIds?.[category]?.trim()) {
        pass = false;
        blockers.push({
          routeId: route.routeId,
          code: "missing_failure_test",
          message: `No ${category} classification test is registered.`,
        });
      }
    }
    if (pass) fullyCovered += 1;
  }
  return {
    exposedRoutes: exposed.length,
    fullyCovered,
    blockers,
    releasable: blockers.length === 0 && fullyCovered === exposed.length,
  };
}
