import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  attestMcpServerImplementation,
  attestReviewedImplementationDigest,
  PENTEST_RECON_VENDOR_ROOT,
} from "../McpServerImplementationAttestation";
import { reviewedMcpServerSurface } from "../McpToolDispositionRegistry";

describe("reviewed MCP implementation attestation", () => {
  test("rejects changed implementation bytes even when tool schemas could remain identical", () => {
    const expected = reviewedMcpServerSurface("pentest-mcp-recon")!.implementationSha256;
    expect(attestReviewedImplementationDigest("pentest-mcp-recon", expected))
      .toMatchObject({ accepted: true, actualSha256: expected });
    const tampered = createHash("sha256")
      .update("same tools/list schemas, changed process implementation")
      .digest("hex");
    expect(attestReviewedImplementationDigest("pentest-mcp-recon", tampered))
      .toMatchObject({ accepted: false, actualSha256: tampered });
  });

  test("rejects a process that does not use the exact reviewed entry point", () => {
    expect(attestMcpServerImplementation({
      name: "pentest-mcp-recon",
      runtime: "stdio",
      enabled: true,
      assignedAgents: ["ReconScout"],
      requiredBinaries: ["node"],
      requiredDockerImages: [],
      requiredEnv: [],
      apiKeysRequired: [],
      installMethod: "fixture",
      toolNames: ["nmapScan"],
      command: "/usr/bin/node",
      args: ["alternate/index.js"],
      cwd: PENTEST_RECON_VENDOR_ROOT,
    })).toMatchObject({ accepted: false, reason: expect.stringContaining("entry point") });
  });

  test("accepts the installed root-controlled entry point only at its reviewed digest", () => {
    const expected = reviewedMcpServerSurface("pentest-mcp-recon")!.implementationSha256;
    expect(attestMcpServerImplementation({
      name: "pentest-mcp-recon",
      runtime: "stdio",
      enabled: true,
      assignedAgents: ["ReconScout"],
      requiredBinaries: ["/usr/bin/node"],
      requiredDockerImages: [],
      requiredEnv: [],
      apiKeysRequired: [],
      installMethod: "reviewed vendor asset",
      toolNames: ["nmapScan"],
      command: "/usr/bin/node",
      args: ["dist/index.js"],
      cwd: PENTEST_RECON_VENDOR_ROOT,
    })).toMatchObject({ accepted: true, actualSha256: expected });
  });
});
