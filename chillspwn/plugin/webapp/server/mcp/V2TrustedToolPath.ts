import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import trustedToolsManifest from "./v2-trusted-tools.json";

export const BASE_MCP_CHILD_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
export const PENTEST_RECON_MCP_SERVER = "pentest-mcp-recon";

export interface TrustedMcpToolDefinition {
  readonly name: string;
  readonly sourcePath: string;
  readonly sourceSha256: string;
  readonly executablePath: string;
  readonly pathBoundary: string;
  readonly sha256: string;
  readonly version: string;
  readonly mode: number;
}

export interface TrustedMcpToolStatus {
  readonly ready: boolean;
  readonly definition: TrustedMcpToolDefinition;
  readonly reasons: readonly string[];
}

export interface TrustedMcpToolBundleStatus {
  readonly ready: boolean;
  readonly binPath: string;
  readonly provenancePath: string;
  readonly tools: readonly TrustedMcpToolStatus[];
  readonly reasons: readonly string[];
}

export interface TrustedMcpToolProvenanceContract {
  readonly installRoot: string;
  readonly binPath: string;
  readonly reviewedManifestSha256: string;
}

interface VerificationOptions {
  readonly capabilityText?: (path: string) => string | null;
}

interface TrustedToolManifest {
  readonly schemaVersion: number;
  readonly pathBoundary: string;
  readonly installRoot: string;
  readonly binPath: string;
  readonly provenancePath: string;
  readonly tools: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

const MANIFEST_PATH = join(import.meta.dir, "v2-trusted-tools.json");
const TOOL_NAMES = ["httpx-toolkit", "nmap"] as const;

function parsedManifest(): TrustedToolManifest {
  const manifest = trustedToolsManifest as TrustedToolManifest;
  if (
    manifest.schemaVersion !== 1
    || manifest.pathBoundary !== manifest.installRoot
    || manifest.binPath !== `${manifest.installRoot}/bin`
    || manifest.provenancePath !== `${manifest.installRoot}/provenance.json`
  ) throw new Error("The reviewed V2 trusted-tool bundle manifest is invalid");
  return manifest;
}

function manifestToolDefinition(name: (typeof TOOL_NAMES)[number]): TrustedMcpToolDefinition {
  const manifest = parsedManifest();
  const entry = manifest.tools[name];
  if (
    !entry
    || typeof entry.sourcePath !== "string"
    || typeof entry.sourceSha256 !== "string"
    || !/^[a-f0-9]{64}$/u.test(entry.sourceSha256)
    || typeof entry.executablePath !== "string"
    || entry.executablePath !== `${manifest.binPath}/${name}`
    || typeof entry.sha256 !== "string"
    || !/^[a-f0-9]{64}$/u.test(entry.sha256)
    || typeof entry.version !== "string"
    || entry.version.length === 0
    || entry.mode !== "0755"
  ) throw new Error(`The reviewed V2 trusted-tool definition is invalid: ${name}`);
  return {
    name,
    sourcePath: entry.sourcePath,
    sourceSha256: entry.sourceSha256,
    executablePath: entry.executablePath,
    pathBoundary: manifest.pathBoundary,
    sha256: entry.sha256,
    version: entry.version,
    mode: 0o755,
  };
}

export const V2_TRUSTED_NMAP = Object.freeze(manifestToolDefinition("nmap"));
export const V2_TRUSTED_HTTPX = Object.freeze(manifestToolDefinition("httpx-toolkit"));
export const V2_TRUSTED_RECON_TOOLS = Object.freeze([V2_TRUSTED_HTTPX, V2_TRUSTED_NMAP]);

function productionCapabilityText(path: string): string | null {
  const result = spawnSync("/usr/sbin/getcap", ["-n", path], {
    encoding: "utf8",
    env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", TZ: "UTC" },
    timeout: 1_000,
    maxBuffer: 8 * 1024,
  });
  if (result.error || result.status !== 0 || result.signal) return null;
  return result.stdout.trim();
}

function unique(reasons: readonly string[]): readonly string[] {
  return [...new Set(reasons)];
}

function assertRootControlledChain(definition: TrustedMcpToolDefinition, reasons: string[]): void {
  const boundary = resolve(definition.pathBoundary);
  const executable = resolve(definition.executablePath);
  if (executable === boundary || !executable.startsWith(`${boundary}/`)) {
    reasons.push("trusted_tool_outside_path_boundary");
    return;
  }
  let current = dirname(executable);
  let reachedBoundary = false;
  while (true) {
    try {
      const stat = lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) reasons.push(`trusted_tool_directory_invalid:${current}`);
      if (stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o022) !== 0) {
        reasons.push(`trusted_tool_directory_not_root_controlled:${current}`);
      }
    } catch {
      reasons.push(`trusted_tool_directory_missing:${current}`);
      return;
    }
    if (current === boundary) reachedBoundary = true;
    if (current === "/") break;
    const parent = dirname(current);
    if (parent === current) {
      reasons.push("trusted_tool_path_chain_invalid");
      return;
    }
    current = parent;
  }
  if (!reachedBoundary) reasons.push("trusted_tool_path_chain_invalid");
}

/**
 * Verify a capability-free executable before its directory can enter a V2 MCP
 * PATH. A missing or unverifiable getcap result fails closed.
 */
export function verifyTrustedMcpTool(
  definition: TrustedMcpToolDefinition,
  options: VerificationOptions = {},
): TrustedMcpToolStatus {
  const reasons: string[] = [];
  assertRootControlledChain(definition, reasons);
  try {
    const source = lstatSync(definition.sourcePath);
    if (!source.isFile() || source.isSymbolicLink()) reasons.push("trusted_tool_source_not_regular_file");
    if (source.uid !== 0 || source.gid !== 0 || (source.mode & 0o022) !== 0) {
      reasons.push("trusted_tool_source_not_root_controlled");
    }
    if (source.size <= 0 || source.size > 128 * 1024 * 1024) reasons.push("trusted_tool_source_size_invalid");
    const sourceDigest = createHash("sha256").update(readFileSync(definition.sourcePath)).digest("hex");
    if (sourceDigest !== definition.sourceSha256) reasons.push("trusted_tool_source_hash_mismatch");
  } catch {
    reasons.push("trusted_tool_source_missing");
  }
  try {
    const stat = lstatSync(definition.executablePath);
    if (!stat.isFile() || stat.isSymbolicLink()) reasons.push("trusted_tool_not_regular_file");
    if (stat.uid !== 0 || stat.gid !== 0) reasons.push("trusted_tool_not_root_owned");
    if ((stat.mode & 0o777) !== definition.mode) reasons.push("trusted_tool_mode_mismatch");
    if (stat.size <= 0 || stat.size > 64 * 1024 * 1024) reasons.push("trusted_tool_size_invalid");
    const digest = createHash("sha256").update(readFileSync(definition.executablePath)).digest("hex");
    if (digest !== definition.sha256) reasons.push("trusted_tool_hash_mismatch");
    const capabilities = (options.capabilityText ?? productionCapabilityText)(definition.executablePath);
    if (capabilities === null) reasons.push("trusted_tool_capability_check_unavailable");
    else if (capabilities.length > 0) reasons.push("trusted_tool_has_file_capabilities");
  } catch {
    reasons.push("trusted_tool_executable_missing");
  }
  const deduplicated = unique(reasons);
  return { ready: deduplicated.length === 0, definition, reasons: deduplicated };
}

export function trustedToolDirectoryReasons(
  binPath: string,
  expectedNames: readonly string[] = TOOL_NAMES,
): readonly string[] {
  try {
    const actual = readdirSync(binPath).sort();
    const expected = [...expectedNames].sort();
    if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) {
      return [`trusted_tool_directory_entries_mismatch:${actual.join(",") || "empty"}`];
    }
    return [];
  } catch {
    return ["trusted_tool_directory_unreadable"];
  }
}

function provenanceReasons(
  provenancePath: string,
  definitions: readonly TrustedMcpToolDefinition[],
): readonly string[] {
  const reasons: string[] = [];
  try {
    const stat = lstatSync(provenancePath);
    if (!stat.isFile() || stat.isSymbolicLink()) reasons.push("trusted_tool_provenance_not_regular");
    if (stat.size <= 0 || stat.size > 64 * 1024) reasons.push("trusted_tool_provenance_size_invalid");
    if (stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o777) !== 0o644) {
      reasons.push("trusted_tool_provenance_not_root_controlled");
    }
    const document = JSON.parse(readFileSync(provenancePath, "utf8")) as Record<string, unknown>;
    const manifest = parsedManifest();
    const reviewedSha256 = createHash("sha256").update(readFileSync(MANIFEST_PATH)).digest("hex");
    reasons.push(...trustedToolProvenanceDocumentReasons(document, definitions, {
      installRoot: manifest.installRoot,
      binPath: manifest.binPath,
      reviewedManifestSha256: reviewedSha256,
    }));
  } catch {
    reasons.push("trusted_tool_provenance_missing_or_invalid");
  }
  return unique(reasons);
}

export function trustedToolProvenanceDocumentReasons(
  document: Readonly<Record<string, unknown>>,
  definitions: readonly TrustedMcpToolDefinition[],
  contract: TrustedMcpToolProvenanceContract,
): readonly string[] {
  const reasons: string[] = [];
  if (document.schemaVersion !== 1 || document.installRoot !== contract.installRoot || document.binPath !== contract.binPath) {
    reasons.push("trusted_tool_provenance_bundle_mismatch");
  }
  if (typeof document.generatedAt !== "string" || !Number.isFinite(Date.parse(document.generatedAt))) {
    reasons.push("trusted_tool_provenance_timestamp_invalid");
  }
  const reviewed = document.reviewedManifest as Record<string, unknown> | undefined;
  if (reviewed?.sha256 !== contract.reviewedManifestSha256) reasons.push("trusted_tool_provenance_manifest_mismatch");
  const tools = document.tools as Record<string, Record<string, unknown>> | undefined;
  const expectedNames = definitions.map(({ name }) => name).sort();
  if (!tools || Object.keys(tools).sort().join(",") !== expectedNames.join(",")) {
    reasons.push("trusted_tool_provenance_tool_set_mismatch");
  }
  for (const definition of definitions) {
    const item = tools?.[definition.name];
    if (
      !item
      || item.sourcePath !== definition.sourcePath
      || item.executablePath !== definition.executablePath
      || item.sourceSha256 !== definition.sourceSha256
      || item.installedSha256 !== definition.sha256
      || item.version !== definition.version
      || item.mode !== "0755"
      || item.uid !== 0
      || item.gid !== 0
      || !Array.isArray(item.capabilities)
      || item.capabilities.length !== 0
    ) reasons.push(`trusted_tool_provenance_entry_mismatch:${definition.name}`);
  }
  return unique(reasons);
}

/** Every executable sibling and the atomic provenance receipt must attest. */
export function trustedNmapExecutionBundleStatus(): TrustedMcpToolBundleStatus {
  const manifest = parsedManifest();
  const tools = V2_TRUSTED_RECON_TOOLS.map((definition) => verifyTrustedMcpTool(definition));
  const reasons = unique([
    ...tools.flatMap(({ reasons: toolReasons }) => toolReasons),
    ...trustedToolDirectoryReasons(manifest.binPath),
    ...provenanceReasons(manifest.provenancePath, V2_TRUSTED_RECON_TOOLS),
  ]);
  return {
    ready: tools.every(({ ready }) => ready) && reasons.length === 0,
    binPath: manifest.binPath,
    provenancePath: manifest.provenancePath,
    tools,
    reasons,
  };
}

/** Only the exact pentest server receives the fully attested private directory. */
export function v2McpChildPath(serverName: string): string {
  if (serverName !== PENTEST_RECON_MCP_SERVER) return BASE_MCP_CHILD_PATH;
  const bundle = trustedNmapExecutionBundleStatus();
  return bundle.ready ? `${bundle.binPath}:${BASE_MCP_CHILD_PATH}` : BASE_MCP_CHILD_PATH;
}
