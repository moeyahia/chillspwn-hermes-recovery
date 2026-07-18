import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { McpServerSpec } from "./McpTypes";
import { reviewedMcpServerSurface } from "./McpToolDispositionRegistry";

export const PENTEST_RECON_VENDOR_ROOT = "/opt/chillspwn-mcp-arsenal/pentest-mcp";
export const PENTEST_RECON_IMPLEMENTATION_PATH = `${PENTEST_RECON_VENDOR_ROOT}/dist/index.js`;
const PENTEST_RECON_SERVER = "pentest-mcp-recon";

export interface McpServerImplementationAttestation {
  readonly accepted: boolean;
  readonly implementationPath: string | null;
  readonly actualSha256: string | null;
  readonly reason: string;
}

export function attestReviewedImplementationDigest(
  serverName: string,
  actualSha256: string,
): McpServerImplementationAttestation {
  const review = reviewedMcpServerSurface(serverName);
  if (!review) {
    return {
      accepted: true,
      implementationPath: null,
      actualSha256,
      reason: "This server has no pinned implementation digest",
    };
  }
  const accepted = /^[a-f0-9]{64}$/u.test(actualSha256)
    && actualSha256 === review.implementationSha256;
  return {
    accepted,
    implementationPath: null,
    actualSha256,
    reason: accepted
      ? "Installed implementation matches the reviewed SHA-256"
      : "Installed implementation differs from the reviewed SHA-256",
  };
}

/**
 * Live route and dispatch attestation for the exact reviewed pentest vendor
 * process. Matching tools/list schemas alone is insufficient: edited code can
 * advertise the same schemas while executing different commands.
 */
export function attestMcpServerImplementation(
  spec: McpServerSpec,
): McpServerImplementationAttestation {
  if (spec.name !== PENTEST_RECON_SERVER) {
    return {
      accepted: true,
      implementationPath: null,
      actualSha256: null,
      reason: "No exact implementation-file attestation is configured for this server",
    };
  }
  if (
    resolve(spec.cwd ?? "") !== PENTEST_RECON_VENDOR_ROOT
    || spec.command !== "/usr/bin/node"
    || spec.args?.length !== 1
    || spec.args[0] !== "dist/index.js"
  ) {
    return {
      accepted: false,
      implementationPath: null,
      actualSha256: null,
      reason: "Pentest MCP process binding differs from the exact reviewed Node entry point",
    };
  }
  try {
    const lexical = lstatSync(PENTEST_RECON_IMPLEMENTATION_PATH);
    const canonical = realpathSync(PENTEST_RECON_IMPLEMENTATION_PATH);
    const state = statSync(canonical);
    if (
      lexical.isSymbolicLink()
      || !lexical.isFile()
      || canonical !== PENTEST_RECON_IMPLEMENTATION_PATH
      || !state.isFile()
      || state.uid !== 0
      || state.gid !== 0
      || (state.mode & 0o022) !== 0
      || state.size <= 0
      || state.size > 4 * 1024 * 1024
    ) {
      return {
        accepted: false,
        implementationPath: canonical,
        actualSha256: null,
        reason: "Pentest MCP implementation asset is not the exact root-controlled regular file",
      };
    }
    const actualSha256 = createHash("sha256")
      .update(readFileSync(canonical))
      .digest("hex");
    const digest = attestReviewedImplementationDigest(spec.name, actualSha256);
    return { ...digest, implementationPath: canonical };
  } catch {
    return {
      accepted: false,
      implementationPath: PENTEST_RECON_IMPLEMENTATION_PATH,
      actualSha256: null,
      reason: "Pentest MCP implementation asset is missing or unreadable",
    };
  }
}
