import { test, expect, describe } from "bun:test";
import { buildRunReport, runReportToMarkdown, buildEvidenceBundle, redactSecrets } from "../RunReport";

// Assemble credential-shaped fixtures at runtime so repository scanners do not
// mistake deliberately fake redaction inputs for live credentials.
const TEST_API_KEY = ["s", "k", "-", "abcdefghijklmnop123456"].join("");
const TEST_GITHUB_TOKEN = ["ghp", "_", "012345678901234567890123456789012345"].join("");

const DOC: any = {
  run: { id: "run_1", objective: "Enumerate host", status: "executing", source: "chat", mode: "managed", persona: "recon", providerKind: "openrouter", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T01:00:00Z", metadata: { gateMode: "enforce" } },
  steps: [
    { index: 0, title: "Recon", status: "completed", successCriteria: "ports listed", summary: "found 80,443" },
    { index: 1, title: "Exploit", status: "pending", successCriteria: "shell" },
  ],
  toolCalls: [
    { toolName: "nmap", status: "succeeded", riskLevel: "network", stepId: "s0" },
    { toolName: "terminal", status: "rejected", riskLevel: "terminal", stepId: "s0" },
  ],
  evidence: [{ id: "ev1", label: "scan output", kind: "command_output", stepId: "s0", sourceToolName: "nmap", content: `80/tcp open\napi_key: ${TEST_API_KEY}` }],
  approvals: [{ toolName: "terminal", status: "rejected", riskLevel: "terminal" }],
  workerResults: [{ result: { status: "complete", summary: "did recon", confidence: 0.8, recommendedNextSteps: ["try gobuster"], assumptions: [], evidence: [], artifacts: [] } }],
};
const MEM: any = [{ id: "m1", type: "engagement_fact", content: "runs apache", status: "verified", scope: "engagement" }];

describe("Phase 11 RunReport", () => {
  test("assembles all sections (incl. denied actions, worker results, memory, next steps)", () => {
    const r = buildRunReport(DOC, { memory: MEM });
    expect(r.objective).toBe("Enumerate host");
    expect(r.gateMode).toBe("enforce");
    expect(r.plan.steps.length).toBe(2);
    expect(r.toolsUsed.length).toBe(2);
    expect(r.deniedActions.length).toBe(1);
    expect(r.deniedActions[0].toolName).toBe("terminal");
    expect(r.workerResults[0].summary).toBe("did recon");
    expect(r.memoryProposals[0].content).toBe("runs apache");
    expect(r.nextSteps).toContain("try gobuster");
  });
  test("evidence preview redacts secrets by default", () => {
    const r = buildRunReport(DOC, {});
    expect(r.evidence[0].preview).not.toContain("sk-abcdefghijklmnop");
    expect(r.evidence[0].preview).toContain("REDACTED");
  });
  test("redact=false keeps raw content", () => {
    expect(buildRunReport(DOC, { redact: false }).evidence[0].preview).toContain("sk-abcdefghijklmnop");
  });
  test("markdown includes key sections", () => {
    const md = runReportToMarkdown(buildRunReport(DOC, { memory: MEM }));
    expect(md).toContain("# Agent Run Report");
    expect(md).toContain("## Plan");
    expect(md).toContain("## Denied actions");
    expect(md).toContain("## Recommended next steps");
  });
  test("evidence bundle = metadata + refs, redacted", () => {
    const b = buildEvidenceBundle(DOC, {});
    expect(b.count).toBe(1);
    expect(b.items[0].label).toBe("scan output");
    expect(b.items[0].preview).not.toContain("sk-abcdefghijklmnop");
  });
  test("redactSecrets handles keys / tokens / private keys", () => {
    expect(redactSecrets("token: abc123secret")).toContain("[REDACTED]");
    expect(redactSecrets("password is demo-passphrase")).not.toContain("demo-passphrase");
    expect(redactSecrets("password demo-passphrase")).not.toContain("demo-passphrase");
    expect(redactSecrets("credential alice:demo-passphrase")).not.toContain("demo-passphrase");
    expect(redactSecrets("login with alice and demo-passphrase")).not.toContain("demo-passphrase");
    expect(redactSecrets("secret was demo-secret-value")).not.toContain("demo-secret-value");
    expect(redactSecrets("use the token demo-token-value")).not.toContain("demo-token-value");
    expect(redactSecrets(TEST_GITHUB_TOKEN)).toContain("REDACTED");
    expect(redactSecrets("-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----")).toContain("REDACTED-PRIVATE-KEY");
  });
});
