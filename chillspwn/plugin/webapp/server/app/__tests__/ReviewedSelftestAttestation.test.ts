import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  REVIEWED_SELFTEST_AGENT,
  REVIEWED_SELFTEST_ATTESTATION_ENV,
  REVIEWED_SELFTEST_ATTESTATION_TOKEN,
  REVIEWED_SELFTEST_PATH,
  REVIEWED_SELFTEST_SERVER,
  REVIEWED_SELFTEST_TEMPLATE_HASH,
  REVIEWED_SELFTEST_TOOL,
  reviewedSelftestDeterministicProjection,
  validateReviewedSelftestDocument,
  verifyReviewedSelftestAttestation,
  type ReviewedSelftestAttestation,
} from "../ReviewedSelftestAttestation";

const fixturePath = resolve(
  import.meta.dir,
  "../../../scripts/command-os-v2/fixtures/local-selftest.mcp.json",
);
const enabledEnvironment: NodeJS.ProcessEnv = {
  [REVIEWED_SELFTEST_ATTESTATION_ENV]: REVIEWED_SELFTEST_ATTESTATION_TOKEN,
};
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const path of temporaryRoots.splice(0)) rmSync(path, { recursive: true, force: true });
});

function attestation(): ReviewedSelftestAttestation {
  return {
    attestationId: `rsta_${"a".repeat(64)}`,
    agentId: REVIEWED_SELFTEST_AGENT,
    mcpServer: REVIEWED_SELFTEST_SERVER,
    toolName: REVIEWED_SELFTEST_TOOL,
    deterministicInput: {},
    templateHash: REVIEWED_SELFTEST_TEMPLATE_HASH,
  };
}

describe("reviewed no-network selftest provenance", () => {
  test("accepts only the exact one-server no-network document", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    expect(() => validateReviewedSelftestDocument(fixture)).not.toThrow();
    expect(Object.keys(fixture.mcpServers)).toEqual([REVIEWED_SELFTEST_SERVER]);
    expect(fixture.mcpServers[REVIEWED_SELFTEST_SERVER]).toMatchObject({
      assignedAgents: [REVIEWED_SELFTEST_AGENT],
      toolNames: [REVIEWED_SELFTEST_TOOL],
      args: [REVIEWED_SELFTEST_PATH],
      envTemplate: {},
    });
    expect(() => validateReviewedSelftestDocument({
      ...fixture,
      mcpServers: { ...fixture.mcpServers, unrelated: fixture.mcpServers[REVIEWED_SELFTEST_SERVER] },
    })).toThrow("outside the reviewed schema");
    expect(() => validateReviewedSelftestDocument({
      ...fixture,
      mcpServers: {
        [REVIEWED_SELFTEST_SERVER]: {
          ...fixture.mcpServers[REVIEWED_SELFTEST_SERVER],
          env: { TOKEN: "forbidden" },
        },
      },
    })).toThrow("outside the reviewed schema");
  });

  test("normal production environment cannot activate the verifier", () => {
    expect(verifyReviewedSelftestAttestation({}, "/path/that/must/not/be/read.json")).toBeNull();
    expect(verifyReviewedSelftestAttestation({
      [REVIEWED_SELFTEST_ATTESTATION_ENV]: "1",
    }, "/path/that/must/not/be/read.json")).toBeNull();
  });

  test("rejects config symlink traversal before parsing", () => {
    const root = mkdtempSync(join(tmpdir(), "reviewed-selftest-attestation-"));
    temporaryRoots.push(root);
    const linked = join(root, "linked-config.json");
    symlinkSync(fixturePath, linked);
    expect(() => verifyReviewedSelftestAttestation(
      enabledEnvironment,
      linked,
      process.geteuid?.() ?? 0,
    )).toThrow(/regular file|symlink/u);
  });

  test("returns an opaque attestation when the deployed reviewed asset is present", () => {
    if (!existsSync(REVIEWED_SELFTEST_PATH)) {
      // Portable CI does not deploy the optional /opt selftest asset. The
      // document/projection paths above remain fully exercised there.
      expect(existsSync(REVIEWED_SELFTEST_PATH)).toBe(false);
      return;
    }
    const verified = verifyReviewedSelftestAttestation(
      enabledEnvironment,
      fixturePath,
      process.geteuid?.() ?? 0,
    );
    expect(verified).toMatchObject({
      agentId: REVIEWED_SELFTEST_AGENT,
      mcpServer: REVIEWED_SELFTEST_SERVER,
      toolName: REVIEWED_SELFTEST_TOOL,
      deterministicInput: {},
      templateHash: REVIEWED_SELFTEST_TEMPLATE_HASH,
    });
    expect(verified?.attestationId).toMatch(/^rsta_[a-f0-9]{64}$/u);
  });

  test("projects deterministic input only onto the exact attested binding", () => {
    const exact = reviewedSelftestDeterministicProjection(attestation(), {
      agentId: REVIEWED_SELFTEST_AGENT,
      mcpServer: REVIEWED_SELFTEST_SERVER,
      toolNames: [REVIEWED_SELFTEST_TOOL],
    });
    expect(exact).toEqual({
      deterministicToolInputs: { [REVIEWED_SELFTEST_TOOL]: {} },
      deterministicToolInputAttestations: {
        [REVIEWED_SELFTEST_TOOL]: {
          attestationId: `rsta_${"a".repeat(64)}`,
          templateHash: REVIEWED_SELFTEST_TEMPLATE_HASH,
        },
      },
    });
    expect(reviewedSelftestDeterministicProjection(attestation(), {
      agentId: REVIEWED_SELFTEST_AGENT,
      mcpServer: "unrelated-selftest",
      toolNames: [REVIEWED_SELFTEST_TOOL],
    })).toBeNull();
    expect(reviewedSelftestDeterministicProjection(attestation(), {
      agentId: REVIEWED_SELFTEST_AGENT,
      mcpServer: REVIEWED_SELFTEST_SERVER,
      toolNames: [REVIEWED_SELFTEST_TOOL, "unexpected"],
    })).toBeNull();
  });
});
