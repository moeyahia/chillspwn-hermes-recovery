import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fchownSync,
  fsyncSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
  NVD_CANARY_RECEIPT_MAX_AGE_MS,
  verifyNvdToolLiveCanaryReceipt,
  type NvdToolLiveCanaryReceipt,
} from "./NvdToolLiveCanary";
import {
  verifyPentestReconLiveCanaryReceipt,
  pentestReconCoverageEvidenceFromReceipt,
  type PentestReconLiveCanaryReceipt,
} from "./PentestReconLiveCanary";
import {
  verifyVulnIntelCveLocalCanaryReceipt,
  type VulnIntelCveLocalCanaryReceipt,
} from "./VulnIntelCveLocalCanary";
import {
  nvdToolCoverageEvidenceFromReceipt,
  vulnIntelCveToolCoverageEvidenceFromReceipt,
} from "./V2ToolCoverageEvidence";
import type {
  ToolRuntimeAttestation,
  V2ToolCoverageEvidence,
} from "./V2ToolCoverageAudit";

export const DEFAULT_RUNTIME_TOOL_EVIDENCE_PATH =
  "/var/lib/chillspwn-attestations/command-os-v2-tool-evidence.json";
export const RUNTIME_TOOL_EVIDENCE_MAX_AGE_MS = NVD_CANARY_RECEIPT_MAX_AGE_MS;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1_000;
const MAX_EVIDENCE_BYTES = 16 * 1_024 * 1_024;

export interface RuntimeToolEvidenceReceipts {
  readonly nvd?: NvdToolLiveCanaryReceipt;
  readonly vulnIntelCve?: VulnIntelCveLocalCanaryReceipt;
  readonly pentestRecon?: PentestReconLiveCanaryReceipt;
}

export interface RuntimeToolEvidenceBundle {
  readonly version: 1;
  readonly bundleId: string;
  readonly generatedAt: string;
  readonly receipts: RuntimeToolEvidenceReceipts;
}

export interface RuntimeToolEvidenceLoadResult {
  readonly bundleId: string;
  readonly generatedAt: string;
  readonly evidence: readonly V2ToolCoverageEvidence[];
  readonly runtimeAttestations: Readonly<Record<string, ToolRuntimeAttestation>>;
  readonly acceptedServerNames: readonly string[];
  readonly rejectedServerNames: readonly string[];
  readonly ignoredServerNames: readonly string[];
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Runtime tool evidence contains a non-JSON value");
  return encoded;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function timestampIsFresh(value: string, now: Date, maximumAgeMs: number): boolean {
  const observed = Date.parse(value);
  const current = now.getTime();
  return Number.isFinite(observed)
    && Number.isFinite(current)
    && observed <= current + FUTURE_TOLERANCE_MS
    && current - observed <= maximumAgeMs;
}

function receiptTimestamp(receipt: NvdToolLiveCanaryReceipt | VulnIntelCveLocalCanaryReceipt | PentestReconLiveCanaryReceipt): string {
  return "generatedAt" in receipt ? receipt.generatedAt : receipt.observedAt;
}

function assertReceiptSet(
  receipts: RuntimeToolEvidenceReceipts,
  now: Date,
  maximumAgeMs: number,
): void {
  if (!Number.isFinite(maximumAgeMs) || maximumAgeMs <= 0) {
    throw new Error("Runtime tool evidence maximum age must be a positive finite duration");
  }
  const supplied = [receipts.nvd, receipts.vulnIntelCve, receipts.pentestRecon].filter(Boolean);
  if (supplied.length === 0) throw new Error("Runtime tool evidence contains no canary receipts");
  if (receipts.nvd && !verifyNvdToolLiveCanaryReceipt(receipts.nvd, { now, maximumAgeMs })) {
    throw new Error("Runtime tool evidence contains an invalid or stale NVD receipt");
  }
  try {
    if (receipts.vulnIntelCve && !verifyVulnIntelCveLocalCanaryReceipt(receipts.vulnIntelCve)) {
      throw new Error("Runtime tool evidence contains an invalid VulnIntel receipt");
    }
    if (receipts.pentestRecon && !verifyPentestReconLiveCanaryReceipt(receipts.pentestRecon)) {
      throw new Error("Runtime tool evidence contains an invalid Pentest Recon receipt");
    }
  } catch {
    throw new Error("Runtime tool evidence contains a malformed local canary receipt");
  }
  for (const receipt of supplied) {
    if (!timestampIsFresh(receiptTimestamp(receipt!), now, maximumAgeMs)) {
      throw new Error("Runtime tool evidence contains a stale or future-dated local canary receipt");
    }
  }
}

export function createRuntimeToolEvidenceBundle(
  receipts: RuntimeToolEvidenceReceipts,
  options: { readonly now?: Date; readonly maximumAgeMs?: number } = {},
): RuntimeToolEvidenceBundle {
  const now = options.now ?? new Date();
  const maximumAgeMs = options.maximumAgeMs ?? RUNTIME_TOOL_EVIDENCE_MAX_AGE_MS;
  assertReceiptSet(receipts, now, maximumAgeMs);
  const core = {
    version: 1 as const,
    generatedAt: now.toISOString(),
    receipts,
  };
  return {
    ...core,
    bundleId: `runtime_tool_evidence_${sha256(canonicalJson(core)).slice(0, 32)}`,
  };
}

function assertTrustedParent(path: string, trustedOwnerUid: number): string {
  const parent = dirname(resolve(path));
  const lexical = lstatSync(parent);
  if (!lexical.isDirectory() || lexical.isSymbolicLink()) {
    throw new Error("Runtime tool evidence parent must be a regular directory");
  }
  if (lexical.uid !== trustedOwnerUid || (lexical.mode & 0o022) !== 0) {
    throw new Error("Runtime tool evidence parent is not controlled by the trusted owner");
  }
  if (realpathSync(parent) !== parent) {
    throw new Error("Runtime tool evidence parent must not traverse a symbolic link");
  }
  return parent;
}

export function writeRuntimeToolEvidenceBundle(
  pathInput: string,
  bundle: RuntimeToolEvidenceBundle,
  options: {
    readonly trustedParentOwnerUid?: number;
    readonly finalOwnerUid?: number;
    readonly finalGroupGid?: number;
    readonly finalMode?: 0o600 | 0o640;
  } = {},
): void {
  const path = resolve(pathInput);
  const currentUid = process.getuid?.() ?? 0;
  const trustedParentOwnerUid = options.trustedParentOwnerUid ?? currentUid;
  const parent = assertTrustedParent(path, trustedParentOwnerUid);
  const temporary = resolve(parent, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  const serialized = `${JSON.stringify(bundle, null, 2)}\n`;
  let fileDescriptor: number | undefined;
  try {
    fileDescriptor = openSync(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    writeSync(fileDescriptor, serialized, null, "utf8");
    fsyncSync(fileDescriptor);
    if (options.finalOwnerUid !== undefined || options.finalGroupGid !== undefined) {
      fchownSync(
        fileDescriptor,
        options.finalOwnerUid ?? currentUid,
        options.finalGroupGid ?? (process.getgid?.() ?? 0),
      );
    }
    fchmodSync(fileDescriptor, options.finalMode ?? 0o600);
    fsyncSync(fileDescriptor);
    closeSync(fileDescriptor);
    fileDescriptor = undefined;
    renameSync(temporary, path);
    const directoryDescriptor = openSync(parent, constants.O_RDONLY | constants.O_DIRECTORY);
    try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
  } catch (error) {
    if (fileDescriptor !== undefined) closeSync(fileDescriptor);
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
}

function readTrustedBundleFile(
  pathInput: string,
  options: { readonly trustedOwnerUid: number; readonly trustedGroupGid: number },
): unknown {
  const path = resolve(pathInput);
  assertTrustedParent(path, options.trustedOwnerUid);
  const lexical = lstatSync(path);
  const permissions = lexical.mode & 0o777;
  if (!lexical.isFile() || lexical.isSymbolicLink() || lexical.uid !== options.trustedOwnerUid) {
    throw new Error("Runtime tool evidence must be a trusted-owner regular file");
  }
  if (permissions !== 0o600 && permissions !== 0o640) {
    throw new Error("Runtime tool evidence must have mode 0600 or 0640");
  }
  if (permissions === 0o640 && lexical.gid !== options.trustedGroupGid) {
    throw new Error("Runtime tool evidence group does not match the runtime service group");
  }
  if (lexical.size <= 0 || lexical.size > MAX_EVIDENCE_BYTES || realpathSync(path) !== path) {
    throw new Error("Runtime tool evidence is empty, oversized, or reached through a symbolic link");
  }
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor);
    if (opened.ino !== lexical.ino || opened.dev !== lexical.dev) {
      throw new Error("Runtime tool evidence changed while it was being opened");
    }
    return JSON.parse(readFileSync(descriptor, "utf8"));
  } finally {
    closeSync(descriptor);
  }
}

function sameAttestation(left: ToolRuntimeAttestation, right: ToolRuntimeAttestation): boolean {
  return left.serverAssetSha256 === right.serverAssetSha256
    && left.registryConfigSha256 === right.registryConfigSha256;
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Load only evidence whose self-verifying receipt also matches an independently
 * recomputed installed server/config attestation. Extra receipts for disabled
 * servers remain auditable but cannot enter the live execution denominator.
 */
export function loadRuntimeToolEvidenceBundle(
  path: string = DEFAULT_RUNTIME_TOOL_EVIDENCE_PATH,
  expectedRuntimeAttestations: Readonly<Record<string, ToolRuntimeAttestation>>,
  options: {
    readonly now?: Date;
    readonly maximumAgeMs?: number;
    readonly trustedOwnerUid?: number;
    readonly trustedGroupGid?: number;
  } = {},
): RuntimeToolEvidenceLoadResult {
  const now = options.now ?? new Date();
  const maximumAgeMs = options.maximumAgeMs ?? RUNTIME_TOOL_EVIDENCE_MAX_AGE_MS;
  const parsed = readTrustedBundleFile(path, {
    trustedOwnerUid: options.trustedOwnerUid ?? 0,
    trustedGroupGid: options.trustedGroupGid ?? (process.getgid?.() ?? 0),
  });
  if (!record(parsed) || parsed.version !== 1 || typeof parsed.bundleId !== "string"
    || typeof parsed.generatedAt !== "string" || !record(parsed.receipts)) {
    throw new Error("Runtime tool evidence bundle has an invalid envelope");
  }
  const bundle = parsed as unknown as RuntimeToolEvidenceBundle;
  if (!/^runtime_tool_evidence_[a-f0-9]{32}$/u.test(bundle.bundleId)) {
    throw new Error("Runtime tool evidence bundle ID is invalid");
  }
  const { bundleId: _bundleId, ...core } = bundle;
  if (bundle.bundleId !== `runtime_tool_evidence_${sha256(canonicalJson(core)).slice(0, 32)}`) {
    throw new Error("Runtime tool evidence bundle integrity check failed");
  }
  if (!timestampIsFresh(bundle.generatedAt, now, maximumAgeMs)) {
    throw new Error("Runtime tool evidence bundle is stale or future-dated");
  }
  assertReceiptSet(bundle.receipts, now, maximumAgeMs);

  const receiptByServer = new Map<string, {
    readonly attestation: ToolRuntimeAttestation;
    readonly evidence: readonly V2ToolCoverageEvidence[];
  }>();
  if (bundle.receipts.nvd) {
    receiptByServer.set("vulnintel-nvd", {
      attestation: bundle.receipts.nvd,
      evidence: nvdToolCoverageEvidenceFromReceipt(bundle.receipts.nvd),
    });
  }
  if (bundle.receipts.vulnIntelCve) {
    receiptByServer.set("vulnintel-cve-mcp", {
      attestation: bundle.receipts.vulnIntelCve,
      evidence: vulnIntelCveToolCoverageEvidenceFromReceipt(bundle.receipts.vulnIntelCve),
    });
  }
  if (bundle.receipts.pentestRecon) {
    receiptByServer.set("pentest-mcp-recon", {
      attestation: bundle.receipts.pentestRecon,
      evidence: pentestReconCoverageEvidenceFromReceipt(bundle.receipts.pentestRecon),
    });
  }

  const evidence: V2ToolCoverageEvidence[] = [];
  const runtimeAttestations: Record<string, ToolRuntimeAttestation> = {};
  const acceptedServerNames: string[] = [];
  const rejectedServerNames: string[] = [];
  for (const [serverName, expected] of Object.entries(expectedRuntimeAttestations)) {
    const source = receiptByServer.get(serverName);
    if (!source || !sameAttestation(source.attestation, expected)) {
      rejectedServerNames.push(serverName);
      continue;
    }
    acceptedServerNames.push(serverName);
    runtimeAttestations[serverName] = expected;
    evidence.push(...source.evidence);
  }
  return {
    bundleId: bundle.bundleId,
    generatedAt: bundle.generatedAt,
    evidence,
    runtimeAttestations,
    acceptedServerNames: acceptedServerNames.sort(),
    rejectedServerNames: rejectedServerNames.sort(),
    ignoredServerNames: [...receiptByServer.keys()]
      .filter((serverName) => !(serverName in expectedRuntimeAttestations))
      .sort(),
  };
}
