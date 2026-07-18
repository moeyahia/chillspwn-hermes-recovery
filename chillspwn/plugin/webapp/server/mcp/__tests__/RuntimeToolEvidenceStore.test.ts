import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateRuntimeToolValidation } from "../../app/RuntimeToolValidation";
import type { McpBridgeExecuteInput } from "../McpArsenalBridge";
import type { McpToolResult } from "../McpTypes";
import {
  NVD_KEYLESS_MIN_INTERVAL_MS,
  nvdRuntimeAttestation,
  runNvdToolLiveCanary,
  type NvdToolLiveCanaryReceipt,
} from "../NvdToolLiveCanary";
import {
  createRuntimeToolEvidenceBundle,
  loadRuntimeToolEvidenceBundle,
  writeRuntimeToolEvidenceBundle,
} from "../RuntimeToolEvidenceStore";
import type { RegisteredV2Tool, ToolRuntimeAttestation } from "../V2ToolCoverageAudit";

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const GET_SCHEMA = {
  type: "object",
  properties: { cve_id: { type: "string", pattern: "^CVE-\\d{4}-\\d{4,}$" } },
  required: ["cve_id"],
} as const;
const SEARCH_SCHEMA = {
  type: "object",
  properties: {
    keyword: { type: "string" },
    limit: { type: "number", default: 10, minimum: 1, maximum: 20 },
  },
  required: ["keyword"],
} as const;

function fixture(): { root: string; assets: string[]; config: string; evidence: string } {
  const root = mkdtempSync(join(tmpdir(), "chillspwn-runtime-tool-evidence-"));
  roots.push(root);
  chmodSync(root, 0o700);
  const assets = [join(root, "index.js"), join(root, "package.json"), join(root, "package-lock.json")];
  assets.forEach((path, index) => writeFileSync(path, `asset-${index}\n`, { mode: 0o600 }));
  const config = join(root, "arsenal.json");
  writeFileSync(config, "{\"server\":\"vulnintel-nvd\"}\n", { mode: 0o600 });
  return { root, assets, config, evidence: join(root, "runtime-evidence.json") };
}

function registrations(runtime: ToolRuntimeAttestation): RegisteredV2Tool[] {
  return [
    {
      serverName: "vulnintel-nvd",
      toolName: "get_cve_details",
      agentIds: ["VulnIntel"],
      inputSchema: GET_SCHEMA,
      runtimeAttestation: runtime,
    },
    {
      serverName: "vulnintel-nvd",
      toolName: "search_cves",
      agentIds: ["VulnIntel"],
      inputSchema: SEARCH_SCHEMA,
      runtimeAttestation: runtime,
    },
  ];
}

function result(input: Partial<McpToolResult> & Pick<McpToolResult, "toolName">): McpToolResult {
  return {
    success: true,
    dryRun: false,
    mcpServer: "vulnintel-nvd",
    specialistAgentId: "VulnIntel",
    outputPreview: "",
    fullOutputBytes: 0,
    artifactId: null,
    evidenceIds: [],
    error: null,
    durationMs: 1,
    isError: false,
    ...input,
  };
}

async function receipt(
  files: ReturnType<typeof fixture>,
  observedAt = "2026-07-18T04:00:00.000Z",
): Promise<NvdToolLiveCanaryReceipt> {
  const runtime = nvdRuntimeAttestation(files.assets, files.config);
  const outputs = [
    result({ toolName: "get_cve_details", outputPreview: "# CVE-2021-44228\nCVSS: 10.0\nSource: NVD" }),
    result({ toolName: "search_cves", outputPreview: "CVE-2021-44228 | CRITICAL\nSource: NVD" }),
    result({
      toolName: "get_cve_details",
      success: false,
      isError: true,
      error: "MCP tool reported an error (see output)",
      outputPreview: "NVD did not find CVE-2099-999999",
    }),
  ];
  const calls: McpBridgeExecuteInput[] = [];
  return runNvdToolLiveCanary({
    registrations: registrations(runtime),
    bridge: {
      execute: async (input) => {
        calls.push(input);
        return outputs[calls.length - 1]!;
      },
    },
    serverAssetPaths: files.assets,
    registryConfigPath: files.config,
    minimumRequestIntervalMs: NVD_KEYLESS_MIN_INTERVAL_MS,
    sleep: async () => {},
    now: () => new Date(observedAt),
  });
}

function routes() {
  return [{
    name: "vulnintel-nvd",
    verified: true,
    tools: ["get_cve_details", "search_cves"],
    toolSchemas: { get_cve_details: GET_SCHEMA, search_cves: SEARCH_SCHEMA },
    assignedAgentIds: ["VulnIntel"],
    attestedAt: "2026-07-18T04:00:00.000Z",
    expiresAt: "2026-07-18T04:02:00.000Z",
    reason: "Exact live tools/list fixture",
  }];
}

describe("runtime tool evidence persistence", () => {
  test("atomically writes a private bundle and attaches current hashes to exact live registrations", async () => {
    const files = fixture();
    const runtime = nvdRuntimeAttestation(files.assets, files.config);
    const bundle = createRuntimeToolEvidenceBundle(
      { nvd: await receipt(files) },
      { now: new Date("2026-07-18T04:01:00.000Z") },
    );
    writeRuntimeToolEvidenceBundle(files.evidence, bundle);

    expect(lstatSync(files.evidence).mode & 0o777).toBe(0o600);
    expect(readdirSync(files.root).filter((name) => name.includes(".tmp"))).toEqual([]);
    const loaded = loadRuntimeToolEvidenceBundle(
      files.evidence,
      { "vulnintel-nvd": runtime },
      {
        now: new Date("2026-07-18T04:02:00.000Z"),
        trustedOwnerUid: process.getuid?.() ?? 0,
        trustedGroupGid: process.getgid?.() ?? 0,
      },
    );
    expect(loaded).toMatchObject({
      acceptedServerNames: ["vulnintel-nvd"],
      rejectedServerNames: [],
      ignoredServerNames: [],
    });
    expect(loaded.evidence).toHaveLength(2);
    expect(evaluateRuntimeToolValidation(
      routes(),
      loaded.evidence,
      loaded.runtimeAttestations,
    )).toMatchObject({ fullyCovered: 2, blockers: [], releasable: true });
  });

  test("supports the root-owned production projection mode without granting group write", async () => {
    const files = fixture();
    const bundle = createRuntimeToolEvidenceBundle(
      { nvd: await receipt(files) },
      { now: new Date("2026-07-18T04:01:00.000Z") },
    );
    writeRuntimeToolEvidenceBundle(files.evidence, bundle, {
      finalOwnerUid: process.getuid?.() ?? 0,
      finalGroupGid: process.getgid?.() ?? 0,
      finalMode: 0o640,
    });
    expect(lstatSync(files.evidence).mode & 0o777).toBe(0o640);
    expect(() => loadRuntimeToolEvidenceBundle(
      files.evidence,
      { "vulnintel-nvd": nvdRuntimeAttestation(files.assets, files.config) },
      {
        now: new Date("2026-07-18T04:02:00.000Z"),
        trustedOwnerUid: process.getuid?.() ?? 0,
        trustedGroupGid: process.getgid?.() ?? 0,
      },
    )).not.toThrow();
  });

  test("fails closed for missing, weakly permissioned, untrusted-owner, and symlink files", async () => {
    const files = fixture();
    const runtime = { "vulnintel-nvd": nvdRuntimeAttestation(files.assets, files.config) };
    const readOptions = {
      now: new Date("2026-07-18T04:02:00.000Z"),
      trustedOwnerUid: process.getuid?.() ?? 0,
      trustedGroupGid: process.getgid?.() ?? 0,
    };
    expect(() => loadRuntimeToolEvidenceBundle(files.evidence, runtime, readOptions)).toThrow();

    const bundle = createRuntimeToolEvidenceBundle(
      { nvd: await receipt(files) },
      { now: new Date("2026-07-18T04:01:00.000Z") },
    );
    writeRuntimeToolEvidenceBundle(files.evidence, bundle);
    chmodSync(files.evidence, 0o644);
    expect(() => loadRuntimeToolEvidenceBundle(files.evidence, runtime, readOptions)).toThrow("mode 0600 or 0640");
    chmodSync(files.evidence, 0o600);
    expect(() => loadRuntimeToolEvidenceBundle(files.evidence, runtime, {
      ...readOptions,
      trustedOwnerUid: (process.getuid?.() ?? 0) + 1,
    })).toThrow("trusted owner");

    const symlink = join(files.root, "runtime-evidence-link.json");
    symlinkSync(files.evidence, symlink);
    expect(() => loadRuntimeToolEvidenceBundle(symlink, runtime, readOptions)).toThrow();

    chmodSync(files.root, 0o770);
    expect(() => loadRuntimeToolEvidenceBundle(files.evidence, runtime, readOptions))
      .toThrow("parent is not controlled");
    chmodSync(files.root, 0o700);
  });

  test("rejects edited JSON even when the attacker preserves valid JSON syntax", async () => {
    const files = fixture();
    const bundle = createRuntimeToolEvidenceBundle(
      { nvd: await receipt(files) },
      { now: new Date("2026-07-18T04:01:00.000Z") },
    );
    writeRuntimeToolEvidenceBundle(files.evidence, bundle);
    const edited = JSON.parse(readFileSync(files.evidence, "utf8"));
    edited.receipts.nvd.publicLlmCalls = 1;
    writeFileSync(files.evidence, `${JSON.stringify(edited)}\n`, { mode: 0o600 });
    chmodSync(files.evidence, 0o600);
    expect(() => loadRuntimeToolEvidenceBundle(
      files.evidence,
      { "vulnintel-nvd": nvdRuntimeAttestation(files.assets, files.config) },
      {
        now: new Date("2026-07-18T04:02:00.000Z"),
        trustedOwnerUid: process.getuid?.() ?? 0,
        trustedGroupGid: process.getgid?.() ?? 0,
      },
    )).toThrow("integrity check failed");
  });

  test("rejects stale and future-dated bundles and receipts", async () => {
    const staleFiles = fixture();
    const staleBundle = createRuntimeToolEvidenceBundle(
      { nvd: await receipt(staleFiles, "2026-07-01T00:00:00.000Z") },
      { now: new Date("2026-07-01T00:01:00.000Z") },
    );
    writeRuntimeToolEvidenceBundle(staleFiles.evidence, staleBundle);
    expect(() => loadRuntimeToolEvidenceBundle(
      staleFiles.evidence,
      { "vulnintel-nvd": nvdRuntimeAttestation(staleFiles.assets, staleFiles.config) },
      {
        now: new Date("2026-07-18T04:00:00.000Z"),
        trustedOwnerUid: process.getuid?.() ?? 0,
        trustedGroupGid: process.getgid?.() ?? 0,
      },
    )).toThrow("stale");

    const futureFiles = fixture();
    const futureBundle = createRuntimeToolEvidenceBundle(
      { nvd: await receipt(futureFiles, "2026-07-19T00:00:00.000Z") },
      { now: new Date("2026-07-19T00:01:00.000Z") },
    );
    writeRuntimeToolEvidenceBundle(futureFiles.evidence, futureBundle);
    expect(() => loadRuntimeToolEvidenceBundle(
      futureFiles.evidence,
      { "vulnintel-nvd": nvdRuntimeAttestation(futureFiles.assets, futureFiles.config) },
      {
        now: new Date("2026-07-18T04:00:00.000Z"),
        trustedOwnerUid: process.getuid?.() ?? 0,
        trustedGroupGid: process.getgid?.() ?? 0,
      },
    )).toThrow("future-dated");
  });

  test("rejects a current asset/config mismatch and ignores receipts for disabled routes", async () => {
    const files = fixture();
    const originalRuntime = nvdRuntimeAttestation(files.assets, files.config);
    const bundle = createRuntimeToolEvidenceBundle(
      { nvd: await receipt(files) },
      { now: new Date("2026-07-18T04:01:00.000Z") },
    );
    writeRuntimeToolEvidenceBundle(files.evidence, bundle);
    writeFileSync(files.config, "{\"server\":\"changed\"}\n", { mode: 0o600 });
    const changedRuntime = nvdRuntimeAttestation(files.assets, files.config);
    expect(changedRuntime).not.toEqual(originalRuntime);
    const options = {
      now: new Date("2026-07-18T04:02:00.000Z"),
      trustedOwnerUid: process.getuid?.() ?? 0,
      trustedGroupGid: process.getgid?.() ?? 0,
    };
    const rejected = loadRuntimeToolEvidenceBundle(
      files.evidence,
      { "vulnintel-nvd": changedRuntime },
      options,
    );
    expect(rejected).toMatchObject({
      acceptedServerNames: [],
      rejectedServerNames: ["vulnintel-nvd"],
      evidence: [],
      runtimeAttestations: {},
    });
    expect(evaluateRuntimeToolValidation(
      routes(),
      rejected.evidence,
      rejected.runtimeAttestations,
    ).releasable).toBe(false);

    const ignored = loadRuntimeToolEvidenceBundle(files.evidence, {}, options);
    expect(ignored).toMatchObject({
      acceptedServerNames: [],
      rejectedServerNames: [],
      ignoredServerNames: ["vulnintel-nvd"],
      evidence: [],
    });

    const assetFiles = fixture();
    const assetBundle = createRuntimeToolEvidenceBundle(
      { nvd: await receipt(assetFiles) },
      { now: new Date("2026-07-18T04:01:00.000Z") },
    );
    writeRuntimeToolEvidenceBundle(assetFiles.evidence, assetBundle);
    writeFileSync(assetFiles.assets[0]!, "changed installed server asset\n", { mode: 0o600 });
    const assetMismatch = loadRuntimeToolEvidenceBundle(
      assetFiles.evidence,
      { "vulnintel-nvd": nvdRuntimeAttestation(assetFiles.assets, assetFiles.config) },
      options,
    );
    expect(assetMismatch).toMatchObject({
      acceptedServerNames: [],
      rejectedServerNames: ["vulnintel-nvd"],
      evidence: [],
      runtimeAttestations: {},
    });
  });
});
