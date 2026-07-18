import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  BASE_MCP_CHILD_PATH,
  PENTEST_RECON_MCP_SERVER,
  V2_TRUSTED_HTTPX,
  V2_TRUSTED_NMAP,
  V2_TRUSTED_RECON_TOOLS,
  trustedNmapExecutionBundleStatus,
  trustedToolDirectoryReasons,
  trustedToolProvenanceDocumentReasons,
  v2McpChildPath,
  verifyTrustedMcpTool,
  type TrustedMcpToolDefinition,
} from "../V2TrustedToolPath";
import { validatePentestReconToolPolicy } from "../PentestReconToolPolicy";

const roots: string[] = [];

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

function fixture(): { definition: TrustedMcpToolDefinition; executable: string } {
  const root = mkdtempSync(join("/root", "trusted-mcp-tool-"));
  roots.push(root);
  chmodSync(root, 0o755);
  const boundary = join(root, "command-os-v2");
  const nested = join(boundary, "bin");
  mkdirSync(nested, { recursive: true, mode: 0o755 });
  chmodSync(boundary, 0o755);
  chmodSync(nested, 0o755);
  const executable = join(nested, "nmap");
  const content = "reviewed capability-free fixture\n";
  writeFileSync(executable, content, { mode: 0o755 });
  chmodSync(executable, 0o755);
  return {
    executable,
    definition: {
      name: "nmap",
      sourcePath: executable,
      sourceSha256: createHash("sha256").update(content).digest("hex"),
      executablePath: executable,
      pathBoundary: boundary,
      sha256: createHash("sha256").update(content).digest("hex"),
      version: "fixture",
      mode: 0o755,
    },
  };
}

describe("V2 trusted MCP tool path", () => {
  test("requires the reviewed Nmap and no-update httpx wrapper only, scoped to the pentest server", () => {
    expect(V2_TRUSTED_RECON_TOOLS.map(({ name }) => name)).toEqual(["httpx-toolkit", "nmap"]);
    expect(V2_TRUSTED_NMAP.executablePath).toEndWith("/bin/nmap");
    expect(V2_TRUSTED_HTTPX.executablePath).toEndWith("/bin/httpx-toolkit");
    expect(V2_TRUSTED_HTTPX.sourcePath).toBe("/usr/bin/httpx-toolkit");
    expect(V2_TRUSTED_NMAP.pathBoundary).toBe("/usr/local/libexec/chillspwn-command-os-v2");
    expect(v2McpChildPath("vulnintel-nvd")).toBe(BASE_MCP_CHILD_PATH);
    const bundle = trustedNmapExecutionBundleStatus();
    expect(v2McpChildPath(PENTEST_RECON_MCP_SERVER)).toBe(
      bundle.ready ? `${bundle.binPath}:${BASE_MCP_CHILD_PATH}` : BASE_MCP_CHILD_PATH,
    );
  });

  test("uses the identical attested bundle predicate for policy and executor readiness", () => {
    const bundle = trustedNmapExecutionBundleStatus();
    const acceptedByPolicy = validatePentestReconToolPolicy(
      PENTEST_RECON_MCP_SERVER,
      "nmapScan",
      { target: "127.0.0.1", scanTechnique: "Connect", ports: "443", timingTemplate: "T3" },
    ) === null;
    expect(acceptedByPolicy).toBe(bundle.ready);
    expect(v2McpChildPath(PENTEST_RECON_MCP_SERVER)).toBe(
      bundle.ready ? `${bundle.binPath}:${BASE_MCP_CHILD_PATH}` : BASE_MCP_CHILD_PATH,
    );
  });

  test("accepts a root-controlled exact-hash executable with no file capabilities", () => {
    const { definition } = fixture();
    expect(verifyTrustedMcpTool(definition, { capabilityText: () => "" })).toEqual({
      ready: true,
      definition,
      reasons: [],
    });
  });

  test("fails closed for hash, mode, directory-control, and capability drift", () => {
    const hashFixture = fixture();
    expect(verifyTrustedMcpTool(
      { ...hashFixture.definition, sha256: "0".repeat(64) },
      { capabilityText: () => "" },
    ).reasons).toContain("trusted_tool_hash_mismatch");

    const sourceHashFixture = fixture();
    expect(verifyTrustedMcpTool(
      { ...sourceHashFixture.definition, sourceSha256: "0".repeat(64) },
      { capabilityText: () => "" },
    ).reasons).toContain("trusted_tool_source_hash_mismatch");

    const modeFixture = fixture();
    chmodSync(modeFixture.executable, 0o775);
    expect(verifyTrustedMcpTool(modeFixture.definition, { capabilityText: () => "" }).reasons)
      .toContain("trusted_tool_mode_mismatch");

    const directoryFixture = fixture();
    chmodSync(directoryFixture.definition.pathBoundary, 0o777);
    expect(verifyTrustedMcpTool(directoryFixture.definition, { capabilityText: () => "" }).reasons)
      .toContain(`trusted_tool_directory_not_root_controlled:${directoryFixture.definition.pathBoundary}`);

    const parentFixture = fixture();
    const mutableParent = dirname(parentFixture.definition.pathBoundary);
    chmodSync(mutableParent, 0o777);
    expect(verifyTrustedMcpTool(parentFixture.definition, { capabilityText: () => "" }).reasons)
      .toContain(`trusted_tool_directory_not_root_controlled:${mutableParent}`);

    const capabilityFixture = fixture();
    expect(verifyTrustedMcpTool(capabilityFixture.definition, {
      capabilityText: (path) => `${path} cap_net_raw=eip`,
    }).reasons).toContain("trusted_tool_has_file_capabilities");
    expect(verifyTrustedMcpTool(capabilityFixture.definition, { capabilityText: () => null }).reasons)
      .toContain("trusted_tool_capability_check_unavailable");
  });

  test("keeps the untrusted host PATH out of the base MCP child contract", () => {
    expect(BASE_MCP_CHILD_PATH).toBe("/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin");
    expect(BASE_MCP_CHILD_PATH).not.toContain(process.env.HOME ?? "__no_home__");
  });

  test("rejects every unexpected executable sibling before exposing the directory", () => {
    const first = fixture();
    const bin = join(first.definition.pathBoundary, "bin");
    expect(trustedToolDirectoryReasons(bin, ["nmap"])).toEqual([]);
    writeFileSync(join(bin, "unexpected-helper"), "not reviewed\n", { mode: 0o755 });
    expect(trustedToolDirectoryReasons(bin)).toEqual([
      "trusted_tool_directory_entries_mismatch:nmap,unexpected-helper",
    ]);
  });

  test("requires provenance for the exact binary set and security attributes", () => {
    const definitions = V2_TRUSTED_RECON_TOOLS.map((definition) => ({
      ...definition,
      pathBoundary: "/fixture",
      executablePath: `/fixture/bin/${definition.name}`,
    }));
    const contract = {
      installRoot: "/fixture",
      binPath: "/fixture/bin",
      reviewedManifestSha256: "f".repeat(64),
    };
    const document = {
      schemaVersion: 1,
      generatedAt: "2026-07-18T00:00:00.000Z",
      installRoot: contract.installRoot,
      binPath: contract.binPath,
      reviewedManifest: { sha256: contract.reviewedManifestSha256 },
      tools: Object.fromEntries(definitions.map((definition) => [definition.name, {
        sourcePath: definition.sourcePath,
        executablePath: definition.executablePath,
        sourceSha256: definition.sourceSha256,
        installedSha256: definition.sha256,
        version: definition.version,
        mode: "0755",
        uid: 0,
        gid: 0,
        capabilities: [],
      }])),
    };
    expect(trustedToolProvenanceDocumentReasons(document, definitions, contract)).toEqual([]);
    expect(trustedToolProvenanceDocumentReasons({
      ...document,
      tools: { ...document.tools, helper: document.tools.nmap },
    }, definitions, contract)).toContain("trusted_tool_provenance_tool_set_mismatch");
    expect(trustedToolProvenanceDocumentReasons({
      ...document,
      tools: {
        nmap: { ...document.tools.nmap, capabilities: ["cap_net_raw=eip"] },
      },
    }, definitions, contract)).toContain("trusted_tool_provenance_entry_mismatch:nmap");
  });
});
