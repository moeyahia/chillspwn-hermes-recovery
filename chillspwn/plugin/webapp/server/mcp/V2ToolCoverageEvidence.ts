import type {
  V2ProviderCoverageEvidence,
  V2ToolCoverageEvidence,
} from "./V2ToolCoverageAudit";
import {
  sechubBinaryReceiptCoverageEvidence,
  type SechubBinaryAnalysisCanaryReceipt,
} from "./SechubBinaryAnalysisCanary";
import {
  verifyNvdToolLiveCanaryReceipt,
  type NvdToolLiveCanaryReceipt,
} from "./NvdToolLiveCanary";
export {
  pentestReconCoverageEvidenceFromReceipt,
  pentestReconRegistrationsWithRuntime,
} from "./PentestReconLiveCanary";
import {
  verifyVulnIntelCveLocalCanaryReceipt,
  type VulnIntelCveLocalCanaryReceipt,
} from "./VulnIntelCveLocalCanary";

/**
 * Intentionally empty: a source-level test identifier must never turn into a
 * release pass merely because it is written here. Live NVD evidence is built
 * at runtime from a successful, hash-bound canary receipt below.
 */
export const V2_TOOL_COVERAGE_EVIDENCE: readonly V2ToolCoverageEvidence[] = [];

/**
 * Live binary-analysis receipts are opt-in because their Docker tool calls are
 * more than an inventory probe. The converter keeps a verified adapter blocker
 * as a blocker; vendor-only execution can never silently populate release
 * success evidence.
 */
export function v2ToolCoverageEvidenceFromSechubBinaryReceipt(
  receipt: SechubBinaryAnalysisCanaryReceipt,
): readonly V2ToolCoverageEvidence[] {
  return sechubBinaryReceiptCoverageEvidence(receipt);
}

export function nvdToolCoverageEvidenceFromReceipt(
  receipt: Readonly<NvdToolLiveCanaryReceipt>,
): readonly V2ToolCoverageEvidence[] {
  // Conversion proves structure/integrity; the runtime store separately owns
  // wall-clock freshness so deterministic fixture dates never become flaky.
  if (!verifyNvdToolLiveCanaryReceipt(receipt, {
    now: new Date(receipt.observedAt),
    maximumAgeMs: 1,
  })) return [];
  return receipt.tools.map((tool) => ({
    serverName: "vulnintel-nvd",
    toolName: tool.toolName,
    schemaValidation: {
      testId: `NvdToolLiveCanary: validates exact ${tool.toolName} schema before dispatch`,
      schemaSha256: tool.schemaSha256,
    },
    successPath: {
      testId: `NvdToolLiveCanary: executes ${tool.toolName} against the public NVD read-only API`,
      fixtureKind: "public_authoritative_read_only",
      implementationLevel: "vendor_implementation",
      liveReceipt: {
        receiptId: receipt.receiptId,
        observedAt: receipt.observedAt,
        schemaSha256: tool.schemaSha256,
        serverAssetSha256: receipt.serverAssetSha256,
        registryConfigSha256: receipt.registryConfigSha256,
        resultSha256: tool.resultSha256,
        invalidInputProofSha256: tool.invalidInputProofSha256,
        deterministicFailureProofSha256: tool.deterministicFailureProofSha256,
        rateLimitProofSha256: tool.rateLimitProofSha256,
        authority: receipt.authority,
        minimumRequestIntervalMs: receipt.minimumRequestIntervalMs,
        publicRequests: receipt.publicRequests,
        publicLlmCalls: receipt.publicLlmCalls,
        clientTargetsContacted: receipt.clientTargetsContacted,
        rateLimitInduced: receipt.rateLimitInduced,
      },
    },
    failurePath: {
      testId: `NvdToolLiveCanary: classifies ${tool.toolName} boundary, deterministic, and 429 failures`,
      invalidInputCategory: tool.invalidInputCategory,
      executionFailureCategory: tool.deterministicFailureCategory,
      rateLimitFailureCategory: tool.rateLimitFailureCategory,
    },
  }));
}

/**
 * Convert the kernel-offline, hash-bound vendor receipt into exact coverage
 * records. A tool with a receipt blocker keeps its schema/failure proof but is
 * intentionally denied a success-path claim, so the release audit remains
 * closed for that binding.
 */
export function vulnIntelCveToolCoverageEvidenceFromReceipt(
  receipt: Readonly<VulnIntelCveLocalCanaryReceipt>,
): readonly V2ToolCoverageEvidence[] {
  if (!verifyVulnIntelCveLocalCanaryReceipt(receipt)) return [];
  return receipt.tools.map((tool) => ({
    serverName: receipt.serverName,
    toolName: tool.toolName,
    schemaValidation: {
      testId: `VulnIntelCveLocalCanary: validates exact ${tool.toolName} FastMCP schema`,
      schemaSha256: tool.schemaSha256,
    },
    ...(tool.blocker === null ? {
      successPath: {
        testId: `VulnIntelCveLocalCanary: executes ${tool.toolName} vendor implementation in a kernel-offline fixture`,
        fixtureKind: "local_no_network" as const,
        implementationLevel: "vendor_implementation" as const,
        localReceipt: {
          receiptId: receipt.receiptId,
          observedAt: receipt.observedAt,
          schemaSha256: tool.schemaSha256,
          resultSha256: tool.successResultSha256,
          invalidInputProofSha256: tool.invalidInputProofSha256,
          deterministicFailureProofSha256: tool.deterministicFailureProofSha256!,
          fixtureKind: "local_no_network" as const,
          loopbackOnly: receipt.loopbackOnly,
          serviceUid: receipt.serviceUid,
          serviceGid: receipt.serviceGid,
          noNewPrivileges: receipt.noNewPrivileges,
          publicRequests: receipt.publicRequests,
          publicLlmCalls: receipt.publicLlmCalls,
          clientTargetsContacted: receipt.clientTargetsContacted,
          serverAssetSha256: receipt.serverAssetSha256,
          registryConfigSha256: receipt.registryConfigSha256,
        },
      },
    } : {
      implementationBlocker: {
        receiptId: receipt.receiptId,
        message: tool.blocker,
      },
    }),
    ...(tool.deterministicFailurePassed ? {
      failurePath: {
        testId: `VulnIntelCveLocalCanary: classifies ${tool.toolName} invalid input, deterministic failure, and applicable 429 envelope`,
        invalidInputCategory: "invalid_input" as const,
        executionFailureCategory: "deterministic_tool_error" as const,
        ...(tool.rateLimitClassification === "rate_limit"
          ? { rateLimitFailureCategory: "rate_limit" as const }
          : {}),
      },
    } : {}),
  }));
}

/**
 * The default V2 Grok route has DI-backed success behavior plus explicit
 * authentication, unavailability, and rate-limit classification tests. These
 * test IDs are checked here as release evidence; no public-provider call is
 * made by the coverage audit.
 */
export const V2_PROVIDER_COVERAGE_EVIDENCE: readonly V2ProviderCoverageEvidence[] = [{
  routeId: "grok-acp",
  successTestId: "CommandOsRuntimeAdapters: persists and correlates only exact provider-reported planning usage",
  failureTestIds: {
    rate_limit: "MissionRuntimePlanningRetry: persists the first rate-limit retry and honors Retry-After without blocking",
    provider_unavailable: "CommandOsRuntimeAdapters: the default provider route also requires a fresh live attestation at dispatch",
    authentication_missing: "MissionRuntimeEngine: planning dependency failures are classified, actionable, and never persist raw provider details",
  },
}];
