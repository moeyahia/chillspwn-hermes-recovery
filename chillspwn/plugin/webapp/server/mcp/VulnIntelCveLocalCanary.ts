import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { resolve } from "node:path";
import { classifyMcpToolFailure } from "./McpToolFailureClassifier";
import { reviewedMcpServerSurface } from "./McpToolDispositionRegistry";
import { runV2ToolSchemaCanary } from "./V2ToolSchemaCanary";
import { adaptVulnIntelCveMcpContent } from "./VulnIntelCveResultAdapter";
import {
  toolInputSchemaSha256,
  type RegisteredV2Tool,
  type ToolRuntimeAttestation,
} from "./V2ToolCoverageAudit";

export const VULNINTEL_CVE_CANARY_TOOLS = [
  "lookup_cve",
  "search_cves",
  "get_cve_summary",
  "get_epss_score",
  "check_kev",
  "parse_cvss",
  "check_package_vulns",
  "get_attack_mapping",
  "calculate_risk_score",
  "health_check",
] as const;
export type VulnIntelCveCanaryTool = (typeof VULNINTEL_CVE_CANARY_TOOLS)[number];

const RATE_LIMIT_TOOLS = new Set<VulnIntelCveCanaryTool>([
  "lookup_cve",
  "search_cves",
  "get_cve_summary",
  "get_epss_score",
  "check_package_vulns",
  "get_attack_mapping",
  "calculate_risk_score",
  "health_check",
]);

const SERVER_NAME = "vulnintel-cve-mcp";
const SHA256 = /^[a-f0-9]{64}$/u;
const RECEIPT_ID = /^vulnintel_cve_canary_[a-f0-9]{32}$/u;

interface HarnessToolResult {
  readonly protocolIsError: boolean;
  readonly output: string;
}

export interface VulnIntelCveHarnessResult {
  readonly harnessVersion: 1;
  readonly vendorServerSource: string;
  readonly vendorServerSourceSha256: string;
  readonly networkNamespaceInode: number;
  readonly processUid: number;
  readonly processGid: number;
  readonly noNewPrivileges: true;
  readonly sandboxMode: "bubblewrap_read_only_network_none";
  readonly socketDenyGuardInstalled: true;
  readonly networkAttempts: readonly string[];
  readonly publicRequests: 0;
  readonly publicLlmCalls: 0;
  readonly clientTargetsContacted: 0;
  readonly schemas: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly schemaSurfaceSha256: string;
  readonly successes: Readonly<Record<VulnIntelCveCanaryTool, HarnessToolResult>>;
  readonly failures: Readonly<Record<VulnIntelCveCanaryTool, HarnessToolResult>>;
  readonly rateLimits: Readonly<Partial<Record<VulnIntelCveCanaryTool, HarnessToolResult>>>;
}

export interface VulnIntelCveCanaryReceiptItem {
  readonly toolName: VulnIntelCveCanaryTool;
  readonly schemaSha256: string;
  readonly successResultSha256: string;
  readonly invalidInputProofSha256: string;
  readonly deterministicFailureProofSha256: string | null;
  readonly rateLimitProofSha256: string | null;
  readonly successPassed: boolean;
  readonly invalidInputPassed: boolean;
  readonly deterministicFailurePassed: boolean;
  readonly rateLimitClassification: "rate_limit" | "not_applicable" | "unclassifiable";
  readonly blocker: string | null;
}

export interface VulnIntelCveLocalCanaryReceipt extends ToolRuntimeAttestation {
  readonly receiptVersion: 1;
  readonly receiptId: string;
  readonly observedAt: string;
  readonly serverName: typeof SERVER_NAME;
  readonly sourceRevision: string;
  readonly implementationSha256: string;
  readonly completeSchemaSurfaceSha256: string;
  readonly harnessSha256: string;
  readonly parentNetworkNamespaceInode: number;
  readonly canaryNetworkNamespaceInode: number;
  readonly kernelNetworkNamespaceIsolated: true;
  readonly loopbackOnly: true;
  readonly serviceUid: number;
  readonly serviceGid: number;
  readonly noNewPrivileges: true;
  readonly socketDenyGuardInstalled: true;
  readonly networkAttempts: 0;
  readonly publicRequests: 0;
  readonly publicLlmCalls: 0;
  readonly clientTargetsContacted: 0;
  readonly tools: readonly VulnIntelCveCanaryReceiptItem[];
}

export interface ExecuteVulnIntelCveHarnessOptions {
  readonly vendorRoot: string;
  readonly pythonPath?: string;
  readonly bubblewrapPath?: string;
  readonly harnessPath?: string;
  readonly timeoutMs?: number;
}

export interface RunVulnIntelCveLocalCanaryOptions extends ExecuteVulnIntelCveHarnessOptions {
  readonly registrations: readonly RegisteredV2Tool[];
  readonly registryConfigPath: string;
  readonly executeHarness?: (
    options: ExecuteVulnIntelCveHarnessOptions,
  ) => VulnIntelCveHarnessResult;
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
  if (encoded === undefined) throw new Error("VulnIntel canary contains a non-JSON value");
  return encoded;
}

function trustedFile(path: string, label: string): { readonly path: string; readonly sha256: string } {
  const lexical = lstatSync(path);
  if (lexical.isSymbolicLink() || !lexical.isFile()) throw new Error(`${label} is not a regular non-symlink file`);
  if (![0, process.getuid?.() ?? 0].includes(lexical.uid) || (lexical.mode & 0o022) !== 0) {
    throw new Error(`${label} is not controlled by a trusted owner`);
  }
  const canonicalPath = realpathSync(path);
  return { path: canonicalPath, sha256: sha256(readFileSync(canonicalPath)) };
}

function runtimeAttestation(serverSource: string, pyproject: string, registryConfigPath: string): ToolRuntimeAttestation {
  const assets = [
    trustedFile(serverSource, "VulnIntel vendor server source"),
    trustedFile(pyproject, "VulnIntel vendor package manifest"),
  ].sort((left, right) => left.path.localeCompare(right.path));
  return {
    serverAssetSha256: sha256(canonical(assets)),
    registryConfigSha256: trustedFile(registryConfigPath, "active MCP registry config").sha256,
  };
}

/** Recompute the installed vendor/config binding used by persisted receipts. */
export function vulnIntelCveRuntimeAttestation(
  vendorRootInput: string,
  registryConfigPath: string,
): ToolRuntimeAttestation {
  const vendorRoot = realpathSync(vendorRootInput);
  return runtimeAttestation(
    resolve(vendorRoot, "src/cve_mcp/server.py"),
    resolve(vendorRoot, "pyproject.toml"),
    registryConfigPath,
  );
}

function exactRegistrations(
  registrations: readonly RegisteredV2Tool[],
): ReadonlyMap<VulnIntelCveCanaryTool, RegisteredV2Tool> {
  const route = registrations.filter(({ serverName }) => serverName === SERVER_NAME);
  const names = [...new Set(route.map(({ toolName }) => toolName))].sort();
  const expected = [...VULNINTEL_CVE_CANARY_TOOLS].sort();
  if (
    route.length !== expected.length
    || names.length !== expected.length
    || expected.some((name, index) => name !== names[index])
    || route.some(({ agentIds }) => !agentIds.includes("VulnIntel"))
  ) throw new Error(`VulnIntel canary requires the exact exposed surface: ${expected.join(", ")}`);
  return new Map(route.map((registration) => [registration.toolName as VulnIntelCveCanaryTool, registration]));
}

function harnessResult(value: unknown): VulnIntelCveHarnessResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("offline harness returned a non-object result");
  const item = value as Partial<VulnIntelCveHarnessResult>;
  if (
    item.harnessVersion !== 1
    || !Number.isSafeInteger(item.networkNamespaceInode)
    || !Number.isSafeInteger(item.processUid) || (item.processUid ?? 0) <= 0
    || !Number.isSafeInteger(item.processGid) || (item.processGid ?? 0) <= 0
    || item.noNewPrivileges !== true
    || item.sandboxMode !== "bubblewrap_read_only_network_none"
    || item.socketDenyGuardInstalled !== true
    || !Array.isArray(item.networkAttempts)
    || item.publicRequests !== 0
    || item.publicLlmCalls !== 0
    || item.clientTargetsContacted !== 0
    || !item.schemas || typeof item.schemas !== "object"
    || !item.successes || typeof item.successes !== "object"
    || !item.failures || typeof item.failures !== "object"
    || !item.rateLimits || typeof item.rateLimits !== "object"
    || typeof item.vendorServerSource !== "string"
    || !SHA256.test(item.vendorServerSourceSha256 ?? "")
    || !SHA256.test(item.schemaSurfaceSha256 ?? "")
  ) throw new Error("offline harness result failed structural validation");
  for (const name of VULNINTEL_CVE_CANARY_TOOLS) {
    const success = item.successes[name];
    const failure = item.failures[name];
    const schema = item.schemas[name];
    if (
      !success || typeof success.output !== "string" || typeof success.protocolIsError !== "boolean"
      || !failure || typeof failure.output !== "string" || typeof failure.protocolIsError !== "boolean"
      || !schema || typeof schema !== "object" || Array.isArray(schema)
      || success.output.length > 128 * 1024 || failure.output.length > 128 * 1024
    ) throw new Error(`offline harness omitted a bounded result for ${name}`);
    if (RATE_LIMIT_TOOLS.has(name)) {
      const rate = item.rateLimits[name];
      if (!rate || typeof rate.output !== "string" || typeof rate.protocolIsError !== "boolean" || rate.output.length > 128 * 1024) {
        throw new Error(`offline harness omitted the rate-limit result for ${name}`);
      }
    }
  }
  return item as VulnIntelCveHarnessResult;
}

/** Run the installed vendor in a kernel-isolated network namespace. */
export function executeOfflineVulnIntelCveHarness(
  options: ExecuteVulnIntelCveHarnessOptions,
): VulnIntelCveHarnessResult {
  const vendorRoot = realpathSync(options.vendorRoot);
  const pythonPath = realpathSync(options.pythonPath ?? resolve(vendorRoot, ".venv/bin/python"));
  const bubblewrapPath = realpathSync(options.bubblewrapPath ?? "/usr/bin/bwrap");
  const harnessPath = realpathSync(options.harnessPath ?? resolve(import.meta.dir, "fixtures/vulnintel-cve-mcp-offline-canary.py"));
  const parentNetworkNamespaceInode = lstatSync("/proc/self/ns/net").ino;
  const result = spawnSync(bubblewrapPath, [
    "--die-with-parent",
    "--new-session",
    "--unshare-user",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    "--unshare-cgroup",
    "--unshare-net",
    "--cap-drop", "ALL",
    "--uid", "65534",
    "--gid", "65534",
    "--ro-bind", "/usr", "/usr",
    "--ro-bind", "/lib", "/lib",
    "--ro-bind", "/lib64", "/lib64",
    "--ro-bind", vendorRoot, "/vendor",
    "--ro-bind", harnessPath, "/canary.py",
    "--proc", "/proc",
    "--dev", "/dev",
    "--tmpfs", "/tmp",
    "--dir", "/home",
    "--setenv", "PATH", "/usr/bin:/bin",
    "--setenv", "HOME", "/tmp",
    "--setenv", "PYTHONDONTWRITEBYTECODE", "1",
    "--setenv", "PYTHONNOUSERSITE", "1",
    "--setenv", "NVD_API_KEY", "",
    "--setenv", "GITHUB_TOKEN", "",
    "--setenv", "VULNCHECK_TOKEN", "",
    "--chdir", "/vendor/src",
    pythonPath,
    "/canary.py",
    "--vendor-root",
    "/vendor",
  ], {
    timeout: options.timeoutMs ?? 30_000,
    maxBuffer: 2 * 1024 * 1024,
    encoding: "utf8",
    env: { PATH: "/usr/bin:/bin" },
  });
  if (result.error) throw new Error(`offline harness could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const diagnostic = String(result.stderr ?? "").replace(/\s+/gu, " ").trim().slice(0, 800);
    throw new Error(`offline harness exited ${result.status}: ${diagnostic || "no diagnostic"}`);
  }
  if (Buffer.byteLength(result.stdout ?? "", "utf8") > 2 * 1024 * 1024) {
    throw new Error("offline harness result exceeded its evidence bound");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(result.stdout); }
  catch { throw new Error("offline harness did not return one JSON receipt payload"); }
  const checked = harnessResult(parsed);
  if (checked.networkNamespaceInode === parentNetworkNamespaceInode) {
    throw new Error("offline harness did not enter a distinct kernel network namespace");
  }
  if (checked.networkAttempts.length !== 0) {
    throw new Error("offline vendor harness attempted a network connection");
  }
  if (checked.processUid <= 0 || checked.processGid <= 0 || checked.noNewPrivileges !== true) {
    throw new Error("offline vendor harness did not drop privilege and enable no-new-privileges");
  }
  return checked;
}

function normalizedFailureProof(
  toolName: VulnIntelCveCanaryTool,
  fixture: HarnessToolResult,
): { readonly category: ReturnType<typeof classifyMcpToolFailure>; readonly sha256: string } {
  const content = adaptVulnIntelCveMcpContent(SERVER_NAME, toolName, {
    text: fixture.output,
    isError: fixture.protocolIsError,
  });
  const category = classifyMcpToolFailure({
    error: content.isError ? "MCP tool reported an error (see output)" : null,
    outputPreview: content.text,
    isError: content.isError,
  });
  return {
    category,
    sha256: sha256(canonical({
      toolName,
      category,
      protocolIsError: fixture.protocolIsError,
      adaptedIsError: content.isError,
      outputSha256: sha256(content.text),
    })),
  };
}

function successMarker(toolName: VulnIntelCveCanaryTool, output: string): boolean {
  const markers: Readonly<Record<VulnIntelCveCanaryTool, readonly string[]>> = {
    lookup_cve: ["CVE-2021-44228", "CRITICAL", "Deterministic offline Log4Shell fixture"],
    search_cves: ["CVE Search Results", "CVE-2021-44228"],
    get_cve_summary: ["CVE-2021-44228 Summary", "EPSS Score", "CRITICAL"],
    get_epss_score: ["EPSS Scores", "97.50%", "CVE-2021-44228"],
    check_kev: ["IS in the CISA KEV catalog", "Fixture Vendor"],
    parse_cvss: ["CVSS Vector Analysis", "9.8", "Critical"],
    check_package_vulns: ["GHSA-fixture-0001", "CVE-2021-44228"],
    get_attack_mapping: ["ATT&CK Mapping", "T1190"],
    calculate_risk_score: ["Risk Score: CVE-2021-44228", "Component Breakdown"],
    health_check: ["Health Check", "NVD API:      OK (HTTP 200)", "KEV Catalog:  OK"],
  };
  return markers[toolName].every((marker) => output.includes(marker));
}

function blockerMessage(
  toolName: VulnIntelCveCanaryTool,
  successPassed: boolean,
  deterministicFailurePassed: boolean,
  rateLimitClassification: VulnIntelCveCanaryReceiptItem["rateLimitClassification"],
): string | null {
  if (!successPassed) return `The exact installed ${toolName} implementation did not produce its deterministic success fixture.`;
  if (!deterministicFailurePassed) {
    if (toolName === "calculate_risk_score") {
      return "The vendor risk scorer suppresses failed NVD, EPSS, and PoC dependencies and returns an ordinary-looking score, so V2 cannot distinguish incomplete intelligence from success.";
    }
    return `The ${toolName} implementation did not preserve a deterministic dependency failure at the MCP boundary.`;
  }
  if (rateLimitClassification === "unclassifiable") {
    if (toolName === "get_cve_summary") {
      return "The vendor summary tool erases upstream 429 details while gathering NVD and EPSS, so V2 cannot apply bounded rate-limit recovery safely.";
    }
    return `The ${toolName} implementation did not preserve an upstream 429 as rate_limit.`;
  }
  return null;
}

export function runVulnIntelCveLocalCanary(
  options: RunVulnIntelCveLocalCanaryOptions,
): VulnIntelCveLocalCanaryReceipt {
  const registrations = exactRegistrations(options.registrations);
  const vendorRoot = realpathSync(options.vendorRoot);
  const serverSource = resolve(vendorRoot, "src/cve_mcp/server.py");
  const pyproject = resolve(vendorRoot, "pyproject.toml");
  const review = reviewedMcpServerSurface(SERVER_NAME);
  if (!review) throw new Error("VulnIntel reviewed surface is unavailable");
  const sourceRevision = execFileSync("/usr/bin/git", ["-C", vendorRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
    timeout: 5_000,
  }).trim();
  if (sourceRevision !== review.sourceRevision) throw new Error("installed VulnIntel source revision differs from the reviewed revision");
  const installedImplementation = trustedFile(serverSource, "VulnIntel vendor implementation");
  if (installedImplementation.sha256 !== review.implementationSha256) {
    throw new Error("installed VulnIntel implementation differs from the reviewed source hash");
  }
  const harnessAsset = trustedFile(
    options.harnessPath ?? resolve(import.meta.dir, "fixtures/vulnintel-cve-mcp-offline-canary.py"),
    "VulnIntel offline harness",
  );
  const runtime = vulnIntelCveRuntimeAttestation(vendorRoot, options.registryConfigPath);
  const executeHarness = options.executeHarness ?? executeOfflineVulnIntelCveHarness;
  const harness = executeHarness(options);
  if (
    !harness.vendorServerSource.endsWith("/src/cve_mcp/server.py")
    || harness.vendorServerSourceSha256 !== installedImplementation.sha256
    || harness.schemaSurfaceSha256 !== review.toolSchemaSurfaceSha256
    || harness.networkAttempts.length !== 0
  ) throw new Error("offline harness did not exercise the complete reviewed vendor surface");

  const parentNetworkNamespaceInode = lstatSync("/proc/self/ns/net").ino;
  if (harness.networkNamespaceInode === parentNetworkNamespaceInode) {
    throw new Error("offline harness did not prove kernel network isolation");
  }
  const tools = VULNINTEL_CVE_CANARY_TOOLS.map((toolName): VulnIntelCveCanaryReceiptItem => {
    const registration = registrations.get(toolName)!;
    const schema = harness.schemas[toolName];
    const schemaSha256 = toolInputSchemaSha256(schema);
    if (schemaSha256 !== toolInputSchemaSha256(registration.inputSchema)) {
      throw new Error(`${toolName} live registration schema differs from the pinned vendor schema`);
    }
    const schemaCanary = runV2ToolSchemaCanary(schema);
    const invalidInputProofSha256 = sha256(canonical({
      toolName,
      schemaSha256,
      invalidInputCategory: schemaCanary.invalidInputCategory,
    }));
    const success = harness.successes[toolName];
    const adaptedSuccess = adaptVulnIntelCveMcpContent(SERVER_NAME, toolName, {
      text: success.output,
      isError: success.protocolIsError,
    });
    const successPassed = !adaptedSuccess.isError && successMarker(toolName, adaptedSuccess.text);
    const deterministic = normalizedFailureProof(toolName, harness.failures[toolName]);
    const deterministicFailurePassed = deterministic.category === "deterministic_tool_error";
    const rate = RATE_LIMIT_TOOLS.has(toolName)
      ? normalizedFailureProof(toolName, harness.rateLimits[toolName]!)
      : null;
    const rateLimitClassification = rate === null
      ? "not_applicable" as const
      : rate.category === "rate_limit"
        ? "rate_limit" as const
        : "unclassifiable" as const;
    return {
      toolName,
      schemaSha256,
      successResultSha256: sha256(adaptedSuccess.text),
      invalidInputProofSha256,
      deterministicFailureProofSha256: deterministicFailurePassed ? deterministic.sha256 : null,
      rateLimitProofSha256: rateLimitClassification === "rate_limit" ? rate!.sha256 : null,
      successPassed,
      invalidInputPassed: schemaCanary.invalidInputCategory === "invalid_input",
      deterministicFailurePassed,
      rateLimitClassification,
      blocker: blockerMessage(toolName, successPassed, deterministicFailurePassed, rateLimitClassification),
    };
  });
  const observedAt = (options.now ?? (() => new Date()))().toISOString();
  const core = {
    receiptVersion: 1 as const,
    observedAt,
    serverName: SERVER_NAME as typeof SERVER_NAME,
    sourceRevision,
    implementationSha256: installedImplementation.sha256,
    completeSchemaSurfaceSha256: harness.schemaSurfaceSha256,
    harnessSha256: harnessAsset.sha256,
    parentNetworkNamespaceInode,
    canaryNetworkNamespaceInode: harness.networkNamespaceInode,
    kernelNetworkNamespaceIsolated: true as const,
    loopbackOnly: true as const,
    serviceUid: harness.processUid,
    serviceGid: harness.processGid,
    noNewPrivileges: harness.noNewPrivileges,
    socketDenyGuardInstalled: harness.socketDenyGuardInstalled,
    networkAttempts: 0 as const,
    publicRequests: 0 as const,
    publicLlmCalls: 0 as const,
    clientTargetsContacted: 0 as const,
    ...runtime,
    tools,
  };
  return {
    ...core,
    receiptId: `vulnintel_cve_canary_${sha256(canonical(core)).slice(0, 32)}`,
  };
}

export function verifyVulnIntelCveLocalCanaryReceipt(
  receipt: Readonly<VulnIntelCveLocalCanaryReceipt>,
): boolean {
  if (
    receipt.receiptVersion !== 1
    || receipt.serverName !== SERVER_NAME
    || !RECEIPT_ID.test(receipt.receiptId)
    || !Number.isFinite(Date.parse(receipt.observedAt))
    || receipt.kernelNetworkNamespaceIsolated !== true
    || receipt.loopbackOnly !== true
    || !Number.isInteger(receipt.serviceUid) || receipt.serviceUid <= 0
    || !Number.isInteger(receipt.serviceGid) || receipt.serviceGid <= 0
    || receipt.noNewPrivileges !== true
    || receipt.socketDenyGuardInstalled !== true
    || receipt.parentNetworkNamespaceInode === receipt.canaryNetworkNamespaceInode
    || receipt.networkAttempts !== 0
    || receipt.publicRequests !== 0
    || receipt.publicLlmCalls !== 0
    || receipt.clientTargetsContacted !== 0
    || receipt.tools.length !== VULNINTEL_CVE_CANARY_TOOLS.length
    || !SHA256.test(receipt.serverAssetSha256)
    || !SHA256.test(receipt.registryConfigSha256)
    || !SHA256.test(receipt.harnessSha256)
  ) return false;
  const review = reviewedMcpServerSurface(SERVER_NAME);
  if (
    !review
    || receipt.sourceRevision !== review.sourceRevision
    || receipt.implementationSha256 !== review.implementationSha256
    || receipt.completeSchemaSurfaceSha256 !== review.toolSchemaSurfaceSha256
  ) return false;
  const names = receipt.tools.map(({ toolName }) => toolName).sort();
  if (names.some((name, index) => name !== [...VULNINTEL_CVE_CANARY_TOOLS].sort()[index])) return false;
  for (const item of receipt.tools) {
    if (
      !SHA256.test(item.schemaSha256)
      || !SHA256.test(item.successResultSha256)
      || !SHA256.test(item.invalidInputProofSha256)
      || (item.deterministicFailureProofSha256 !== null && !SHA256.test(item.deterministicFailureProofSha256))
      || (item.rateLimitProofSha256 !== null && !SHA256.test(item.rateLimitProofSha256))
      || !item.invalidInputPassed
      || (item.blocker === null && (!item.successPassed || !item.deterministicFailurePassed || item.rateLimitClassification === "unclassifiable"))
      || (item.blocker !== null && item.blocker.trim().length < 40)
    ) return false;
  }
  const { receiptId: _ignored, ...withoutId } = receipt;
  return receipt.receiptId === `vulnintel_cve_canary_${sha256(canonical(withoutId)).slice(0, 32)}`;
}
