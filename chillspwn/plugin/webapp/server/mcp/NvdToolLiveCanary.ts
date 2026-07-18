import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import type { McpBridgeExecuteInput } from "./McpArsenalBridge";
import { McpToolInputValidationError, normalizeAndValidateMcpToolInput } from "./McpToolInputSchema";
import { classifyMcpToolFailure } from "./McpToolFailureClassifier";
import type { McpToolResult } from "./McpTypes";
import {
  toolInputSchemaSha256,
  type RegisteredV2Tool,
  type ToolRuntimeAttestation,
} from "./V2ToolCoverageAudit";

export const NVD_COVERED_TOOLS = ["get_cve_details", "search_cves"] as const;
export type NvdCoveredTool = (typeof NVD_COVERED_TOOLS)[number];

const PUBLIC_DETAIL_FIXTURE = "CVE-2021-44228";
const PUBLIC_SEARCH_FIXTURE = "Apache Log4j";
const PUBLIC_MISSING_FIXTURE = "CVE-2099-999999";
export const NVD_KEYLESS_MIN_INTERVAL_MS = 6_500;

export interface NvdToolCanaryReceiptItem {
  readonly toolName: NvdCoveredTool;
  readonly schemaSha256: string;
  readonly resultSha256: string;
  readonly invalidInputProofSha256: string;
  readonly deterministicFailureProofSha256: string;
  readonly rateLimitProofSha256: string;
  readonly invalidInputCategory: "invalid_input";
  readonly deterministicFailureCategory: "deterministic_tool_error";
  readonly rateLimitFailureCategory: "rate_limit";
}

export interface NvdToolLiveCanaryReceipt extends ToolRuntimeAttestation {
  readonly receiptVersion: 1;
  readonly receiptId: string;
  readonly observedAt: string;
  readonly authority: "services.nvd.nist.gov";
  readonly minimumRequestIntervalMs: number;
  readonly publicRequests: 3;
  readonly publicLlmCalls: 0;
  readonly clientTargetsContacted: 0;
  readonly rateLimitInduced: false;
  readonly tools: readonly NvdToolCanaryReceiptItem[];
}

export interface NvdToolCanaryPort {
  execute(input: McpBridgeExecuteInput): Promise<McpToolResult>;
}

export interface NvdToolLiveCanaryOptions {
  readonly registrations: readonly RegisteredV2Tool[];
  readonly bridge: NvdToolCanaryPort;
  readonly serverAssetPaths: readonly string[];
  readonly registryConfigPath: string;
  readonly minimumRequestIntervalMs?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly now?: () => Date;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("NVD canary receipt contains a non-JSON value");
  return encoded;
}

function trustedFileHash(path: string): { readonly path: string; readonly bytes: number; readonly sha256: string } {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`NVD canary asset is not a regular non-symlink file: ${path}`);
  if ((stat.mode & 0o022) !== 0) throw new Error(`NVD canary asset is group/world writable: ${path}`);
  const canonicalPath = realpathSync(path);
  const data = readFileSync(canonicalPath);
  return { path: canonicalPath, bytes: data.byteLength, sha256: sha256(data) };
}

export function nvdRuntimeAttestation(
  serverAssetPaths: readonly string[],
  registryConfigPath: string,
): ToolRuntimeAttestation {
  if (serverAssetPaths.length === 0) throw new Error("NVD canary requires at least one installed server asset");
  const assets = [...new Set(serverAssetPaths)].map(trustedFileHash).sort((left, right) => left.path.localeCompare(right.path));
  return {
    serverAssetSha256: sha256(canonical(assets)),
    registryConfigSha256: trustedFileHash(registryConfigPath).sha256,
  };
}

function exactRegistrations(registrations: readonly RegisteredV2Tool[]): ReadonlyMap<NvdCoveredTool, RegisteredV2Tool> {
  const nvd = registrations.filter(({ serverName }) => serverName === "vulnintel-nvd");
  const names = [...new Set(nvd.map(({ toolName }) => toolName))].sort();
  const expected = [...NVD_COVERED_TOOLS].sort();
  if (
    nvd.length !== expected.length
    || names.length !== expected.length
    || !expected.every((name, index) => name === names[index])
    || nvd.some(({ agentIds }) => !agentIds.includes("VulnIntel"))
  ) {
    throw new Error(`NVD canary requires the exact live tool surface: ${expected.join(", ")}`);
  }
  return new Map(nvd.map((registration) => [registration.toolName as NvdCoveredTool, registration]));
}

function invalidInputProof(tool: RegisteredV2Tool): string {
  const invalid = tool.toolName === "get_cve_details"
    ? { cve_id: "not-a-cve" }
    : { keyword: PUBLIC_SEARCH_FIXTURE, limit: 21 };
  try {
    normalizeAndValidateMcpToolInput(invalid, tool.inputSchema);
  } catch (error) {
    if (error instanceof McpToolInputValidationError && error.code === "mcp_tool_input_invalid") {
      return sha256(canonical({
        tool: tool.toolName,
        category: "invalid_input",
        code: error.code,
        path: error.path,
        schemaSha256: toolInputSchemaSha256(tool.inputSchema),
      }));
    }
    throw error;
  }
  throw new Error(`${tool.toolName} accepted the reviewed invalid-input canary`);
}

function syntheticFailure(toolName: NvdCoveredTool, outputPreview: string): McpToolResult {
  return {
    success: false,
    dryRun: false,
    mcpServer: "vulnintel-nvd",
    toolName,
    specialistAgentId: "VulnIntel",
    outputPreview,
    fullOutputBytes: Buffer.byteLength(outputPreview),
    artifactId: null,
    evidenceIds: [],
    error: "MCP tool reported an error (see output)",
    durationMs: 0,
    isError: true,
  };
}

function classifiedProof(
  result: McpToolResult,
  expected: "deterministic_tool_error" | "rate_limit",
): string {
  const actual = classifyMcpToolFailure(result);
  if (actual !== expected) throw new Error(`${result.toolName} classified ${actual}; expected ${expected}`);
  return sha256(canonical({
    tool: result.toolName,
    expected,
    actual,
    normalizedResultSha256: sha256(canonical({
      success: result.success,
      isError: result.isError,
      error: result.error,
      outputPreview: result.outputPreview,
    })),
  }));
}

function assertSuccess(result: McpToolResult, toolName: NvdCoveredTool): string {
  if (!result.success || result.isError || result.error) {
    throw new Error(`${toolName} live NVD canary failed: ${classifyMcpToolFailure(result)}`);
  }
  const text = result.outputPreview;
  if (toolName === "get_cve_details") {
    if (!text.includes(PUBLIC_DETAIL_FIXTURE) || !/CVSS/iu.test(text) || !/NVD/iu.test(text)) {
      throw new Error("get_cve_details did not return the expected public NVD fixture fields");
    }
  } else if (!/CVE-\d{4}-\d{4,}/u.test(text) || !/NVD/iu.test(text)) {
    throw new Error("search_cves did not return a CVE-bearing public NVD result");
  }
  return sha256(text);
}

async function call(
  bridge: NvdToolCanaryPort,
  toolName: NvdCoveredTool,
  args: Readonly<Record<string, unknown>>,
  now: () => Date,
): Promise<McpToolResult> {
  return bridge.execute({
    specialistAgentId: "VulnIntel",
    mcpServer: "vulnintel-nvd",
    toolName,
    arguments: args,
    startedAtMs: now().getTime(),
  });
}

/**
 * Explicit live canary for the two keyless, read-only NVD bindings. It makes
 * exactly three sequential NVD requests, never retries, never contacts a
 * mission/client target, and deliberately does not induce a 429. The 429
 * envelope is classified locally because intentionally exhausting a public
 * provider's quota would violate the canary contract.
 */
export async function runNvdToolLiveCanary(options: NvdToolLiveCanaryOptions): Promise<NvdToolLiveCanaryReceipt> {
  const registrations = exactRegistrations(options.registrations);
  const minimumRequestIntervalMs = options.minimumRequestIntervalMs ?? NVD_KEYLESS_MIN_INTERVAL_MS;
  if (minimumRequestIntervalMs < NVD_KEYLESS_MIN_INTERVAL_MS) {
    throw new Error(`NVD keyless canary interval must be at least ${NVD_KEYLESS_MIN_INTERVAL_MS}ms`);
  }
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const now = options.now ?? (() => new Date());
  const runtime = nvdRuntimeAttestation(options.serverAssetPaths, options.registryConfigPath);
  for (const registration of registrations.values()) {
    if (
      registration.runtimeAttestation
      && (
        registration.runtimeAttestation.serverAssetSha256 !== runtime.serverAssetSha256
        || registration.runtimeAttestation.registryConfigSha256 !== runtime.registryConfigSha256
      )
    ) throw new Error("The NVD registration runtime attestation changed before the live canary");
  }

  const getRegistration = registrations.get("get_cve_details")!;
  const searchRegistration = registrations.get("search_cves")!;
  const invalidProofs = new Map<NvdCoveredTool, string>([
    ["get_cve_details", invalidInputProof(getRegistration)],
    ["search_cves", invalidInputProof(searchRegistration)],
  ]);

  const getArguments = normalizeAndValidateMcpToolInput(
    { cve_id: PUBLIC_DETAIL_FIXTURE },
    getRegistration.inputSchema,
  ).arguments;
  const searchArguments = normalizeAndValidateMcpToolInput(
    { keyword: PUBLIC_SEARCH_FIXTURE, limit: 2 },
    searchRegistration.inputSchema,
  ).arguments;
  const missingArguments = normalizeAndValidateMcpToolInput(
    { cve_id: PUBLIC_MISSING_FIXTURE },
    getRegistration.inputSchema,
  ).arguments;
  const getResult = await call(options.bridge, "get_cve_details", getArguments, now);
  const getResultSha256 = assertSuccess(getResult, "get_cve_details");
  await sleep(minimumRequestIntervalMs);
  const searchResult = await call(options.bridge, "search_cves", searchArguments, now);
  const searchResultSha256 = assertSuccess(searchResult, "search_cves");
  await sleep(minimumRequestIntervalMs);
  const missingResult = await call(options.bridge, "get_cve_details", missingArguments, now);
  if (missingResult.success || !missingResult.isError) {
    throw new Error("The public missing-CVE fixture did not produce the expected deterministic MCP error");
  }
  const getDeterministicProof = classifiedProof(missingResult, "deterministic_tool_error");
  const searchDeterministicProof = classifiedProof(
    syntheticFailure("search_cves", "❌ 错误: 搜索失败: Request failed with status code 400"),
    "deterministic_tool_error",
  );
  const rateLimitProofs = new Map<NvdCoveredTool, string>(NVD_COVERED_TOOLS.map((toolName) => [
    toolName,
    classifiedProof(
      syntheticFailure(toolName, "❌ 错误: NVD request failed with status code 429"),
      "rate_limit",
    ),
  ]));
  const observedAt = now().toISOString();
  const items: readonly NvdToolCanaryReceiptItem[] = [
    {
      toolName: "get_cve_details",
      schemaSha256: toolInputSchemaSha256(getRegistration.inputSchema),
      resultSha256: getResultSha256,
      invalidInputProofSha256: invalidProofs.get("get_cve_details")!,
      deterministicFailureProofSha256: getDeterministicProof,
      rateLimitProofSha256: rateLimitProofs.get("get_cve_details")!,
      invalidInputCategory: "invalid_input",
      deterministicFailureCategory: "deterministic_tool_error",
      rateLimitFailureCategory: "rate_limit",
    },
    {
      toolName: "search_cves",
      schemaSha256: toolInputSchemaSha256(searchRegistration.inputSchema),
      resultSha256: searchResultSha256,
      invalidInputProofSha256: invalidProofs.get("search_cves")!,
      deterministicFailureProofSha256: searchDeterministicProof,
      rateLimitProofSha256: rateLimitProofs.get("search_cves")!,
      invalidInputCategory: "invalid_input",
      deterministicFailureCategory: "deterministic_tool_error",
      rateLimitFailureCategory: "rate_limit",
    },
  ];
  const receiptCore = {
    receiptVersion: 1 as const,
    observedAt,
    authority: "services.nvd.nist.gov" as const,
    minimumRequestIntervalMs,
    publicRequests: 3 as const,
    publicLlmCalls: 0 as const,
    clientTargetsContacted: 0 as const,
    rateLimitInduced: false as const,
    ...runtime,
    tools: items,
  };
  return {
    ...receiptCore,
    receiptId: `nvd_canary_${sha256(canonical(receiptCore)).slice(0, 32)}`,
  };
}
