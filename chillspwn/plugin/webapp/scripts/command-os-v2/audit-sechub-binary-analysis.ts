#!/usr/bin/env bun

import { resolve } from "node:path";
import {
  runSechubBinaryAnalysisCanary,
} from "../../server/mcp/SechubBinaryAnalysisCanary";
import { v2ToolCoverageEvidenceFromSechubBinaryReceipt } from "../../server/mcp/V2ToolCoverageEvidence";
import { auditV2ToolCoverage } from "../../server/mcp/V2ToolCoverageAudit";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log([
    "Usage: audit-sechub-binary-analysis.ts [--json] [--receipt=/absolute/path]",
    "",
    "Runs 32 safe success and 32 deterministic-failure calls against a newly",
    "compiled local fixture in one bounded, read-only, network-none container.",
    "The command exits non-zero while any production adapter/tool blocker remains.",
  ].join("\n"));
  process.exit(0);
}
const json = args.includes("--json");
const receiptArg = args.find((arg) => arg.startsWith("--receipt="));
const receiptPath = receiptArg ? resolve(receiptArg.slice("--receipt=".length)) : undefined;
const configPath = resolve(process.env.MCP_ARSENAL_CONFIG || "/opt/chillspwn-mcp-arsenal/.mcp.arsenal.json");
const manifestPath = resolve(import.meta.dir, "../../server/agents/mcpArsenal.manifest.json");

const receipt = await runSechubBinaryAnalysisCanary({
  configPath,
  manifestPath,
  receiptPath,
});
const registrations = receipt.tools.map((tool) => ({
    serverName: tool.serverName,
    toolName: tool.toolName,
    agentIds: ["ReverseSage"],
    inputSchema: tool.inputSchema,
    runtimeAttestation: {
      serverAssetSha256: receipt.assets.serverImageSha256,
      registryConfigSha256: receipt.assets.registryAssetSha256,
    },
  }));
const evidence = v2ToolCoverageEvidenceFromSechubBinaryReceipt(receipt);
const coverage = auditV2ToolCoverage(registrations, evidence);
const result = {
  receipt,
  coverage,
  releaseInterpretation: receipt.adapterSupported
    ? "The production adapter reproduced the bounded no-network stateful path."
    : "The vendor implementation was exercised, but production adapter blockers remain release-blocking.",
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const vendorSuccess = receipt.tools.filter(({ successPassed }) => successPassed).length;
  const vendorFailures = receipt.tools.filter(({ deterministicFailurePassed }) => deterministicFailurePassed).length;
  console.log([
    "Sechub binary-analysis live canary",
    `  exact tools: ${receipt.tools.length}/32`,
    `  vendor safe successes: ${vendorSuccess}/32`,
    `  deterministic failures signalled: ${vendorFailures}/32`,
    `  production adapter supported: ${receipt.adapterSupported ? "yes" : "no"}`,
    `  tool calls: ${receipt.callsAttempted}`,
    `  client artifacts: ${receipt.safety.clientArtifactsUsed}`,
    `  network: ${receipt.safety.networkMode}`,
    `  public providers: ${receipt.safety.publicProvidersCalled}`,
    `  release coverage: ${coverage.fullyCovered}/${coverage.registeredTools}`,
    `  blockers: ${receipt.blockers.length}`,
    receipt.blockers.map(({ toolName, code, message }) => `    - ${toolName ?? "adapter"} [${code}]: ${message}`).join("\n"),
    receiptPath ? `  receipt: ${receiptPath}` : "  receipt: not persisted (pass --receipt=/absolute/path)",
  ].join("\n"));
}

// A vendor-only success is useful diagnostic evidence but never releases the
// V2 binding while the production adapter cannot reproduce the boundary.
process.exitCode = coverage.releasable ? 0 : 1;
