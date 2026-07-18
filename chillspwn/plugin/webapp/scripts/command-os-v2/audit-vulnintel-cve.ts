#!/usr/bin/env bun

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  executeOfflineVulnIntelCveHarness,
  runVulnIntelCveLocalCanary,
  VULNINTEL_CVE_CANARY_TOOLS,
} from "../../server/mcp/VulnIntelCveLocalCanary";
import { vulnIntelCveToolCoverageEvidenceFromReceipt } from "../../server/mcp/V2ToolCoverageEvidence";
import { auditV2ToolCoverage } from "../../server/mcp/V2ToolCoverageAudit";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log([
    "Usage: audit-vulnintel-cve.ts [--json] [--receipt=/absolute/path]",
    "",
    "Runs the ten exact configured vulnintel-cve-mcp bindings against local",
    "deterministic fixtures inside a separate Linux network namespace. It",
    "never calls a public API, engagement target, or public LLM.",
    "",
    "The command stays non-zero while the pinned vendor loses failure or 429",
    "semantics required by the V2 release gate.",
  ].join("\n"));
  process.exit(0);
}

const json = args.includes("--json");
const receiptArg = args.find((arg) => arg.startsWith("--receipt="));
const receiptPath = receiptArg ? resolve(receiptArg.slice("--receipt=".length)) : undefined;
const vendorRoot = resolve(
  process.env.CHILLSPWN_VULNINTEL_VENDOR_ROOT
    || "/opt/chillspwn-assets/vuln-intel/cve-mcp-server",
);
const registryConfigPath = resolve(
  process.env.MCP_ARSENAL_CONFIG
    || "/opt/chillspwn-mcp-arsenal/.mcp.arsenal.json",
);

const harness = executeOfflineVulnIntelCveHarness({ vendorRoot });
const registrations = VULNINTEL_CVE_CANARY_TOOLS.map((toolName) => ({
  serverName: "vulnintel-cve-mcp",
  toolName,
  agentIds: ["VulnIntel"],
  inputSchema: harness.schemas[toolName],
}));
const receipt = runVulnIntelCveLocalCanary({
  registrations,
  registryConfigPath,
  vendorRoot,
  executeHarness: () => harness,
});
const auditedRegistrations = registrations.map((registration) => ({
  ...registration,
  runtimeAttestation: {
    serverAssetSha256: receipt.serverAssetSha256,
    registryConfigSha256: receipt.registryConfigSha256,
  },
}));
const evidence = vulnIntelCveToolCoverageEvidenceFromReceipt(receipt);
const coverage = auditV2ToolCoverage(auditedRegistrations, evidence);
const result = {
  receipt,
  coverage,
  releaseInterpretation: coverage.releasable
    ? "Every configured binding preserves exact success, invalid-input, deterministic-failure, and applicable rate-limit semantics."
    : "Safe vendor success is proven, but bindings with erased dependency failures remain unavailable to V2 execution.",
};

if (receiptPath) {
  mkdirSync(dirname(receiptPath), { recursive: true, mode: 0o750 });
  const temporary = `${receiptPath}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  renameSync(temporary, receiptPath);
}

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const success = receipt.tools.filter(({ successPassed }) => successPassed).length;
  const invalid = receipt.tools.filter(({ invalidInputPassed }) => invalidInputPassed).length;
  const deterministic = receipt.tools.filter(({ deterministicFailurePassed }) => deterministicFailurePassed).length;
  const rateApplicable = receipt.tools.filter(({ rateLimitClassification }) => rateLimitClassification !== "not_applicable");
  const rateClassified = rateApplicable.filter(({ rateLimitClassification }) => rateLimitClassification === "rate_limit");
  const blocked = receipt.tools.filter(({ blocker }) => blocker !== null);
  console.log([
    "VulnIntel CVE MCP kernel-offline canary",
    `  pinned revision: ${receipt.sourceRevision}`,
    `  complete installed schema surface: ${receipt.completeSchemaSurfaceSha256}`,
    `  configured schemas: ${receipt.tools.length}/10`,
    `  vendor implementation successes: ${success}/10`,
    `  invalid-input boundaries: ${invalid}/10`,
    `  deterministic failures preserved: ${deterministic}/10`,
    `  applicable 429 classes preserved: ${rateClassified.length}/${rateApplicable.length}`,
    `  public requests / LLM calls / client targets: ${receipt.publicRequests}/${receipt.publicLlmCalls}/${receipt.clientTargetsContacted}`,
    `  release coverage: ${coverage.fullyCovered}/${coverage.registeredTools}`,
    `  blockers: ${blocked.length}`,
    blocked.map(({ toolName, blocker }) => `    - ${toolName}: ${blocker}`).join("\n"),
    receiptPath ? `  receipt: ${receiptPath}` : "  receipt: not persisted (pass --receipt=/absolute/path)",
  ].join("\n"));
}

process.exitCode = coverage.releasable ? 0 : 1;
