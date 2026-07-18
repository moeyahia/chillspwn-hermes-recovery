import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

export const REVIEWED_SELFTEST_ATTESTATION_ENV = "CHILLSPWN_REVIEWED_SELFTEST_ATTESTATION";
export const REVIEWED_SELFTEST_ATTESTATION_TOKEN = "reviewed-no-network-restart-selftest-v1";
export const REVIEWED_SELFTEST_PATH = "/opt/chillspwn-mcp-arsenal/local-selftest-mcp.mjs";
export const REVIEWED_SELFTEST_SHA256 = "ecc77ab562c9cabf5f68297ede9df563935d1720ead341dff4c307363da8a215";
export const REVIEWED_SELFTEST_SERVER = "sechub-reconnaissance";
export const REVIEWED_SELFTEST_AGENT = "ReconScout";
export const REVIEWED_SELFTEST_TOOL = "quick_scan";
export const REVIEWED_SELFTEST_COMMAND = "/usr/bin/node";
export const REVIEWED_SELFTEST_TEMPLATE_HASH = createHash("sha256").update("{}").digest("hex");

const REVIEWED_PURPOSE = "process restart and specialist dispatch validation";
const REVIEWED_INSTALL_METHOD = "reviewed no-network deployment validation selftest";

export interface ReviewedSelftestAttestation {
  readonly attestationId: string;
  readonly agentId: typeof REVIEWED_SELFTEST_AGENT;
  readonly mcpServer: typeof REVIEWED_SELFTEST_SERVER;
  readonly toolName: typeof REVIEWED_SELFTEST_TOOL;
  readonly deterministicInput: Readonly<Record<string, never>>;
  readonly templateHash: string;
}

export interface ReviewedSelftestInventoryBinding {
  readonly agentId: string;
  readonly mcpServer: string;
  readonly toolNames: readonly string[];
}

export interface ReviewedSelftestDeterministicProjection {
  readonly deterministicToolInputs: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly deterministicToolInputAttestations: Readonly<Record<string, {
    readonly attestationId: string;
    readonly templateHash: string;
  }>>;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} contains fields outside the reviewed schema`);
  }
}

function exactStrings(value: unknown, expected: readonly string[], label: string): void {
  if (!Array.isArray(value) || value.length !== expected.length
      || value.some((item, index) => item !== expected[index])) {
    throw new Error(`${label} differs from the reviewed value`);
  }
}

function emptyObject(value: unknown, label: string): void {
  const candidate = object(value, label);
  if (Object.keys(candidate).length !== 0) throw new Error(`${label} must be empty`);
}

/** Validate the exact no-network document independently from filesystem trust. */
export function validateReviewedSelftestDocument(value: unknown): void {
  const root = object(value, "Reviewed selftest config");
  exactKeys(root, ["schemaVersion", "reviewedAsset", "mcpServers"], "Reviewed selftest config");
  if (root.schemaVersion !== 1) throw new Error("Reviewed selftest schema version changed");

  const asset = object(root.reviewedAsset, "Reviewed selftest asset");
  exactKeys(asset, ["path", "sha256", "networkBehavior", "purpose"], "Reviewed selftest asset");
  if (asset.path !== REVIEWED_SELFTEST_PATH || asset.sha256 !== REVIEWED_SELFTEST_SHA256
      || asset.networkBehavior !== "none" || asset.purpose !== REVIEWED_PURPOSE) {
    throw new Error("Reviewed selftest asset declaration changed");
  }

  const servers = object(root.mcpServers, "Reviewed selftest server map");
  exactKeys(servers, [REVIEWED_SELFTEST_SERVER], "Reviewed selftest server map");
  const spec = object(servers[REVIEWED_SELFTEST_SERVER], "Reviewed selftest server");
  exactKeys(spec, [
    "enabled", "runtime", "command", "args", "assignedAgents", "toolNames",
    "requiredBinaries", "requiredDockerImages", "envTemplate", "apiKeysRequired",
    "installMethod",
  ], "Reviewed selftest server");
  if (spec.enabled !== true || spec.runtime !== "stdio" || spec.command !== REVIEWED_SELFTEST_COMMAND
      || spec.installMethod !== REVIEWED_INSTALL_METHOD) {
    throw new Error("Reviewed selftest process declaration changed");
  }
  exactStrings(spec.args, [REVIEWED_SELFTEST_PATH], "Reviewed selftest arguments");
  exactStrings(spec.assignedAgents, [REVIEWED_SELFTEST_AGENT], "Reviewed selftest assignment");
  exactStrings(spec.toolNames, [REVIEWED_SELFTEST_TOOL], "Reviewed selftest tool surface");
  exactStrings(spec.requiredBinaries, [REVIEWED_SELFTEST_COMMAND], "Reviewed selftest binary requirements");
  exactStrings(spec.requiredDockerImages, [], "Reviewed selftest Docker requirements");
  exactStrings(spec.apiKeysRequired, [], "Reviewed selftest API-key requirements");
  emptyObject(spec.envTemplate, "Reviewed selftest environment template");
}

function readRootControlledFile(path: string, label: string, trustedOwnerUid = 0): Buffer {
  if (!isAbsolute(path) || path.includes("\0") || resolve(path) !== path) {
    throw new Error(`${label} must be a normalized absolute path`);
  }
  const lexical = lstatSync(path);
  if (!lexical.isFile() || lexical.isSymbolicLink()
      || ![0, trustedOwnerUid].includes(lexical.uid) || (lexical.mode & 0o022) !== 0) {
    throw new Error(`${label} must be a trusted-owner, non-writable regular file`);
  }
  if (realpathSync(path) !== path) throw new Error(`${label} may not traverse a symlink`);
  let current = dirname(path);
  while (true) {
    const state = lstatSync(current);
    if (!state.isDirectory() || state.isSymbolicLink()
        || ![0, trustedOwnerUid].includes(state.uid) || (state.mode & 0o022) !== 0) {
      throw new Error(`${label} crosses a directory outside the root-controlled boundary`);
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return readFileSync(path);
}

/**
 * Attest the one reviewed no-network deployment fixture.
 *
 * Normal production configuration returns null because it neither carries the
 * exact child opt-in nor consists solely of the pinned selftest route. With an
 * explicit opt-in, every mismatch throws and deterministic compilation stays
 * unavailable.
 */
export function verifyReviewedSelftestAttestation(
  env: NodeJS.ProcessEnv,
  configPath: string,
  /** Test-only portability hook. Production callers must omit this. */
  trustedOwnerUid = 0,
): ReviewedSelftestAttestation | null {
  if (env[REVIEWED_SELFTEST_ATTESTATION_ENV] !== REVIEWED_SELFTEST_ATTESTATION_TOKEN) return null;
  const configBytes = readRootControlledFile(configPath, "Reviewed selftest MCP config", trustedOwnerUid);
  let document: unknown;
  try {
    document = JSON.parse(configBytes.toString("utf8"));
  } catch {
    throw new Error("Reviewed selftest MCP config is not valid JSON");
  }
  validateReviewedSelftestDocument(document);
  const assetBytes = readRootControlledFile(
    REVIEWED_SELFTEST_PATH,
    "Reviewed no-network selftest asset",
    trustedOwnerUid,
  );
  const assetHash = createHash("sha256").update(assetBytes).digest("hex");
  if (assetHash !== REVIEWED_SELFTEST_SHA256) throw new Error("Reviewed no-network selftest asset hash changed");
  const configHash = createHash("sha256").update(configBytes).digest("hex");
  const opaqueDigest = createHash("sha256").update(JSON.stringify({
    version: 1,
    configHash,
    assetHash,
    agentId: REVIEWED_SELFTEST_AGENT,
    mcpServer: REVIEWED_SELFTEST_SERVER,
    toolName: REVIEWED_SELFTEST_TOOL,
    templateHash: REVIEWED_SELFTEST_TEMPLATE_HASH,
  })).digest("hex");
  return Object.freeze({
    attestationId: `rsta_${opaqueDigest}`,
    agentId: REVIEWED_SELFTEST_AGENT,
    mcpServer: REVIEWED_SELFTEST_SERVER,
    toolName: REVIEWED_SELFTEST_TOOL,
    deterministicInput: Object.freeze({}),
    templateHash: REVIEWED_SELFTEST_TEMPLATE_HASH,
  });
}

/** Project a deterministic template only onto the exact attested live binding. */
export function reviewedSelftestDeterministicProjection(
  attestation: ReviewedSelftestAttestation | null,
  binding: ReviewedSelftestInventoryBinding,
): ReviewedSelftestDeterministicProjection | null {
  if (!attestation || binding.agentId !== attestation.agentId
      || binding.mcpServer !== attestation.mcpServer
      || binding.toolNames.length !== 1 || binding.toolNames[0] !== attestation.toolName) return null;
  return {
    deterministicToolInputs: {
      [attestation.toolName]: attestation.deterministicInput,
    },
    deterministicToolInputAttestations: {
      [attestation.toolName]: {
        attestationId: attestation.attestationId,
        templateHash: attestation.templateHash,
      },
    },
  };
}
