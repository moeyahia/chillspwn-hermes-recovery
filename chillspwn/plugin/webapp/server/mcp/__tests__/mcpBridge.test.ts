import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { McpServerRegistry } from "../McpServerRegistry";
import { McpArsenalBridge } from "../McpArsenalBridge";
import {
  MCP_APPROVAL_ATTESTATION_VERSION,
  hashMcpArguments,
  type AutonomousFullTcpAttestation,
  type LegacyToolApprovalAttestation,
  type McpApprovalAttestationVerifier,
} from "../McpApprovalAttestation";
import { buildMcpChildEnv, callServerTool, listServerTools, flattenMcpContent, resolveStartCommand } from "../McpToolExecutor";
import {
  BASE_MCP_CHILD_PATH,
  PENTEST_RECON_MCP_SERVER,
  trustedNmapExecutionBundleStatus,
} from "../V2TrustedToolPath";

let dir: string, cfgPath: string, mockPath: string, manifestPath: string, runnerPath: string;
const MOCK = `import readline from "readline";
import { writeFileSync } from "fs";
const rl = readline.createInterface({ input: process.stdin });
const send = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
rl.on("line", (line) => { let m; try { m = JSON.parse(line); } catch { return; }
  if (m.method === "initialize") send({ jsonrpc:"2.0", id:m.id, result:{ protocolVersion:"2024-11-05", capabilities:{}, serverInfo:{name:"mock",version:"1"} } });
  else if (m.method === "tools/list") send({ jsonrpc:"2.0", id:m.id, result:{ tools:[
    {name:"quick_scan",inputSchema:{type:"object",properties:{target:{type:"string"}},required:["target"]}},
    {name:"port_scan",inputSchema:{type:"object",properties:{target:{type:"string"}},required:["target"]}},
    {name:"nmapScan",inputSchema:{type:"object",properties:{target:{type:"string"}},required:["target"]}},
    {name:"gobuster",inputSchema:{type:"object",properties:{target:{type:"string"}},required:["target"]}}
  ] } });
  else if (m.method === "tools/call") { const big = m.params.arguments && m.params.arguments.big; const envKey = m.params.arguments && m.params.arguments.envKey; const writeHome = m.params.arguments && m.params.arguments.writeHome; let text = big ? "X".repeat(50000) : envKey ? String(process.env[envKey] || "MISSING") : ("MOCK "+m.params.name+" "+JSON.stringify(m.params.arguments)); if (writeHome) { try { writeFileSync(process.env.HOME+"/probe", "ok"); text = "WRITABLE_HOME:"+process.env.HOME; } catch (error) { text = "HOME_ERROR:"+String(error); } } send({ jsonrpc:"2.0", id:m.id, result:{ content:[{type:"text",text}], isError:false } }); } });`;

function bridge(
  mode: "disabled" | "dry-run" | "enabled",
  maxOut = 20000,
  options: {
    verifier?: McpApprovalAttestationVerifier;
    now?: () => Date;
    trustedNmapReady?: boolean;
    acceptFixtureImplementation?: boolean;
  } = {},
) {
  return new McpArsenalBridge({
    configPath: cfgPath,
    manifestPath,
    mode,
    allowDocker: false,
    startServers: true,
    defaultTimeoutMs: 8000,
    maxOutputBytes: maxOut,
    trustedOwnerUid: process.geteuid?.() ?? 0,
    verifyAndConsumeApprovalAttestation: options.verifier,
    now: options.now,
    trustedNmapReady: options.trustedNmapReady,
    ...(options.acceptFixtureImplementation
      ? {
          attestImplementation: () => ({
            accepted: true,
            implementationPath: mockPath,
            actualSha256: "f".repeat(64),
            reason: "Test fixture implementation accepted",
          }),
        }
      : {}),
  });
}

const APPROVAL_NOW = new Date("2026-07-15T15:00:00.000Z");
function approval(
  args: unknown = { target: "10.0.0.9" },
  overrides: Partial<LegacyToolApprovalAttestation> = {},
): LegacyToolApprovalAttestation {
  return {
    version: MCP_APPROVAL_ATTESTATION_VERSION,
    kind: "legacy_tool_approval",
    claimId: "mcpclaim-exact-1",
    runId: "run-exact-1",
    stepId: "step-exact-1",
    toolCallId: "toolcall-exact-1",
    approvalId: "approval-exact-1",
    specialistAgentId: "ReconScout",
    mcpServer: "sechub-reconnaissance",
    toolName: "nmapScan",
    argumentsHash: hashMcpArguments(args),
    actorId: "operator-local",
    resolvedAt: "2026-07-15T14:59:00.000Z",
    expiresAt: "2026-07-15T15:04:00.000Z",
    ...overrides,
  };
}

const FULL_TCP_ARGUMENTS = Object.freeze({
  target: "127.0.0.1",
  scanTechnique: "Connect",
  ports: "1-65535",
  timingTemplate: "T3",
});

function autonomousFullTcpApproval(
  overrides: Partial<AutonomousFullTcpAttestation> = {},
): AutonomousFullTcpAttestation {
  return {
    version: MCP_APPROVAL_ATTESTATION_VERSION,
    kind: "autonomous_full_tcp",
    claimId: "mcpclaim-full-tcp-1",
    actionId: "action-full-tcp-1",
    actionFingerprint: "a".repeat(64),
    missionId: "mission-full-tcp-1",
    runId: "run-full-tcp-1",
    stepId: "step-full-tcp-1",
    assignmentId: "assignment-full-tcp-1",
    planId: "plan-full-tcp-1",
    planVersion: 3,
    contractId: "contract-full-tcp-1",
    contractVersion: 4,
    contractHash: "c".repeat(64),
    normalizedTarget: "127.0.0.1",
    actionClass: "port_service_enumeration",
    controlPlane: "command_os_v2",
    destructive: false,
    destructivePolicy: "prohibited",
    wallClockLimitMs: 7_200_000,
    remainingWallClockMs: 7_000_000,
    toolCallLimit: 100,
    remainingToolCalls: 98,
    specialistAgentId: "ReconScout",
    mcpServer: "pentest-mcp-recon",
    toolName: "nmapScan",
    argumentsHash: hashMcpArguments(FULL_TCP_ARGUMENTS),
    actorId: "command-os-v2:runtime-adapter",
    resolvedAt: "2026-07-15T14:59:30.000Z",
    expiresAt: "2026-07-15T15:00:30.000Z",
    ...overrides,
  };
}

function registry() {
  return new McpServerRegistry(cfgPath, undefined, process.geteuid?.() ?? 0);
}

beforeAll(() => {
  dir = mkdtempSync(join(import.meta.dir, "p16-"));
  mockPath = join(dir, "mock.mjs"); writeFileSync(mockPath, MOCK);
  runnerPath = join(dir, "trusted-bun-runner");
  writeFileSync(runnerPath, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} "$@"\n`);
  chmodSync(runnerPath, 0o700);
  manifestPath = join(dir, "manifest.json"); writeFileSync(manifestPath, JSON.stringify({ servers: [] }));
  cfgPath = join(dir, ".mcp.arsenal.json");
  writeFileSync(cfgPath, JSON.stringify({ mcpServers: {
    // Use a fixture executable owned by the current trusted UID rather than a
    // setup-node/toolcache shim. Production correctly rejects executable paths
    // that cross a writable or foreign-owned trust chain; the wrapper keeps that
    // security assertion intact while remaining portable across local and CI UIDs.
    "sechub-reconnaissance": { enabled: true, runtime: "stdio", command: runnerPath, args: [mockPath], assignedAgents: ["ReconScout"], toolNames: ["quick_scan", "port_scan", "nmapScan", "gobuster"], requiredBinaries: [runnerPath], requiredDockerImages: [], envTemplate: {}, apiKeysRequired: [], installMethod: "mock" },
    "pentest-mcp-recon": { enabled: true, runtime: "stdio", command: runnerPath, args: [mockPath], assignedAgents: ["ReconScout"], toolNames: ["nmapScan"], requiredBinaries: [runnerPath], requiredDockerImages: [], envTemplate: {}, apiKeysRequired: [], installMethod: "mock" },
    "needs-bin": { enabled: true, runtime: "stdio", command: "x", assignedAgents: ["WebBreaker"], toolNames: ["ffuf_dir"], requiredBinaries: ["definitely_missing_bin_xyz"], requiredDockerImages: [], envTemplate: {}, apiKeysRequired: [], installMethod: "mock" },
    "needs-key": { enabled: true, runtime: "stdio", command: "x", assignedAgents: ["OSINTSeeker"], toolNames: ["virustotal_lookup"], requiredBinaries: [], requiredDockerImages: [], envTemplate: { VT_API_KEY: "<set-me>" }, apiKeysRequired: ["VirusTotal"], installMethod: "mock" },
    "docker-srv": { enabled: true, runtime: "docker", assignedAgents: ["ReconScout"], toolNames: ["x"], requiredBinaries: [], requiredDockerImages: ["mcp/foo"], envTemplate: {}, apiKeysRequired: [], installMethod: "docker" },
    "off-srv": { enabled: false, runtime: "stdio", command: "node", args: [mockPath], assignedAgents: ["ReconScout"], toolNames: ["quick_scan"], requiredBinaries: [], requiredDockerImages: [], envTemplate: {}, apiKeysRequired: [], installMethod: "mock" },
  } }));
});
afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

describe("16.1 registry: load + health states", () => {
  test("loads config + manifest, no load error", () => { const r = registry(); expect(r.getLoadError()).toBeNull(); expect(r.list().length).toBe(6); });
  test("missing config → load error", () => { expect(new McpServerRegistry("/nope/x.json").getLoadError()).toContain("not found"); });
  test("health states: configured / missing_dependency / missing_secret / docker-gated / disabled", () => {
    const r = registry();
    expect(r.health("sechub-reconnaissance").state).toBe("configured");
    expect(r.health("needs-bin").state).toBe("missing_dependency");
    expect(r.health("needs-bin").missingBinaries).toContain("definitely_missing_bin_xyz");
    expect(r.health("needs-key").state).toBe("missing_secret");
    expect(r.health("needs-key").missingEnv).toContain("VT_API_KEY");
    expect(r.health("docker-srv", { allowDocker: false }).state).toBe("missing_dependency"); // docker gated
    expect(r.health("off-srv").state).toBe("disabled");
  });
  test("forAgent maps servers to specialists", () => { expect(registry().forAgent("ReconScout").map(s => s.name)).toContain("sechub-reconnaissance"); });
});

describe("16.2 stdio MCP client", () => {
  const spec: any = { name: "mock", runtime: "stdio", command: "node", args: [""], requiredDockerImages: [], toolNames: ["quick_scan"] };
  test("tools/list + tools/call against a real mock server", async () => {
    spec.args = [mockPath];
    const tl = await listServerTools(spec, { timeoutMs: 8000, allowDocker: false });
    expect(tl.ok).toBe(true); expect(tl.result.tools.map((t: any) => t.name)).toEqual(["quick_scan", "port_scan", "nmapScan", "gobuster"]);
    const tc = await callServerTool(spec, "quick_scan", { target: "10.0.0.1" }, { timeoutMs: 8000, allowDocker: false });
    expect(flattenMcpContent(tc.result).text).toContain("MOCK quick_scan");
  });
  test("live bridge probe retains exact input schemas with the attested tool names", async () => {
    const result = await bridge("enabled").probeTools("sechub-reconnaissance");
    expect(result).toMatchObject({
      ok: true,
      tools: ["quick_scan", "port_scan", "nmapScan", "gobuster"],
      toolSchemas: {
        quick_scan: {
          type: "object",
          properties: { target: { type: "string" } },
          required: ["target"],
        },
      },
    });
  });
  test("timeout + missing binary handled", async () => {
    expect((await callServerTool({ ...spec, command: "sleep", args: ["30"] }, "x", {}, { timeoutMs: 800, allowDocker: false })).error).toContain("timed out");
    expect((await callServerTool({ ...spec, command: "/no/such/bin" }, "x", {}, { timeoutMs: 3000, allowDocker: false })).ok).toBe(false);
  });
  test("cancellation terminates an in-flight MCP process group", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const pending = callServerTool(
      { ...spec, command: "sleep", args: ["30"] },
      "x",
      {},
      { timeoutMs: 30_000, allowDocker: false, signal: controller.signal },
    );
    setTimeout(() => controller.abort("test cancellation"), 50);
    const result = await pending;
    expect(result.error).toContain("cancelled");
    // This proves abort won over the 30s hard timeout. The host may be heavily
    // CPU-throttled in CI, so do not assert sub-second event-loop scheduling.
    expect(Date.now() - started).toBeLessThan(25_000);
  });
  test("third-party MCP receives only explicitly required environment", async () => {
    spec.args = [mockPath];
    spec.requiredEnv = [];
    const hidden = await callServerTool(spec, "quick_scan", { envKey: "UNRELATED_SENTINEL" }, {
      timeoutMs: 8000,
      allowDocker: false,
      env: { ...process.env, UNRELATED_SENTINEL: "must-not-leak", DASHBOARD_TOKEN: "must-not-leak" },
    });
    expect(flattenMcpContent(hidden.result).text).toBe("MISSING");

    spec.requiredEnv = ["EXPLICIT_TEST_VALUE"];
    const explicit = buildMcpChildEnv(spec, { EXPLICIT_TEST_VALUE: "allowed", DASHBOARD_TOKEN: "denied" });
    expect(explicit.EXPLICIT_TEST_VALUE).toBe("allowed");
    expect(explicit.DASHBOARD_TOKEN).toBeUndefined();
    expect(() => buildMcpChildEnv({ ...spec, requiredEnv: ["NODE_OPTIONS"] }, {})).toThrow();
  });
  test("confines the private trusted-tool PATH to the exact pentest child", () => {
    const bundle = trustedNmapExecutionBundleStatus();
    const unrelated = buildMcpChildEnv({ ...spec, name: "vulnintel-nvd" }, {});
    const pentest = buildMcpChildEnv({ ...spec, name: PENTEST_RECON_MCP_SERVER }, {});
    expect(unrelated.PATH).toBe(BASE_MCP_CHILD_PATH);
    expect(unrelated.PATH).not.toContain(bundle.binPath);
    expect(pentest.PATH).toBe(
      bundle.ready ? `${bundle.binPath}:${BASE_MCP_CHILD_PATH}` : BASE_MCP_CHILD_PATH,
    );
  });
  test("each MCP session receives a private writable HOME that is removed afterwards", async () => {
    spec.args = [mockPath];
    spec.requiredEnv = [];
    const result = await callServerTool(spec, "quick_scan", { writeHome: true }, {
      timeoutMs: 8000,
      allowDocker: false,
    });
    const text = flattenMcpContent(result.result).text;
    expect(text).toStartWith("WRITABLE_HOME:");
    const home = text.slice("WRITABLE_HOME:".length);
    expect(home).toContain("chillspwn-mcp-home-");
    expect(existsSync(home)).toBe(false);
  });
  test("docker without allowDocker is refused", () => {
    const r = resolveStartCommand({ name: "d", runtime: "docker", requiredDockerImages: ["img"] } as any, false);
    expect("error" in r).toBe(true);
  });
});

describe("16.x bridge: tool view + execute modes + binding", () => {
  test("specialist tool view: only its tools; isolation", () => {
    const b = bridge("enabled");
    expect(b.loadError()).toBeNull();
    const v = b.toolsForSpecialist("ReconScout")!;
    expect(v.availableTools).toContain("quick_scan");
    expect(b.toolsForSpecialist("WebBreaker")!.availableTools).not.toContain("quick_scan");
  });
  test("disabled mode never executes", async () => {
    const r = await bridge("disabled").execute({ specialistAgentId: "ReconScout", mcpServer: "sechub-reconnaissance", toolName: "quick_scan", startedAtMs: 0 });
    expect(r.success).toBe(false); expect(r.error).toContain("disabled");
  });
  test("dry-run records but does NOT execute", async () => {
    const r = await bridge("dry-run").execute({ specialistAgentId: "ReconScout", mcpServer: "sechub-reconnaissance", toolName: "quick_scan", arguments: { target: "x" }, startedAtMs: 0 });
    expect(r.dryRun).toBe(true); expect(r.success).toBe(true); expect(r.outputPreview).toContain("[dry-run]"); expect(r.outputPreview).not.toContain("MOCK quick_scan");
  });
  test("enabled mode executes the mocked MCP server", async () => {
    const r = await bridge("enabled").execute({ specialistAgentId: "ReconScout", mcpServer: "sechub-reconnaissance", toolName: "quick_scan", arguments: { target: "10.0.0.9" }, startedAtMs: 0 });
    expect(r.success).toBe(true); expect(r.outputPreview).toContain("MOCK quick_scan");
  });
  test("execution accepts the existing ReconScout route alias and rejects an unrelated assigned route", async () => {
    const allowed = await bridge("dry-run").execute({
      specialistAgentId: "ReconScout",
      mcpServer: "sechub-reconnaissance",
      toolName: "quick_scan",
      arguments: {},
      startedAtMs: 0,
    });
    const unrelated = await bridge("enabled").execute({
      specialistAgentId: "ReconScout",
      mcpServer: "off-srv",
      toolName: "quick_scan",
      arguments: {},
      startedAtMs: 0,
    });
    expect(allowed.success).toBe(true);
    expect(unrelated.success).toBe(false);
    expect(unrelated.error).toContain("server allowlist");
  });
  test("large output is truncated for the preview (→ artifact upstream)", async () => {
    const r = await bridge("enabled", 2000).execute({ specialistAgentId: "ReconScout", mcpServer: "sechub-reconnaissance", toolName: "quick_scan", arguments: { big: true }, startedAtMs: 0 });
    expect(r.fullOutputBytes).toBeGreaterThan(2000); expect(r.outputPreview).toContain("truncated"); expect(r.outputPreview.length).toBeLessThan(3000);
  });
  test("out-of-allowlist tool denied (defense in depth)", async () => {
    expect((await bridge("enabled").execute({ specialistAgentId: "ReconScout", mcpServer: "sechub-reconnaissance", toolName: "hashcat", startedAtMs: 0 })).error).toContain("allowlist");
  });
  test("never dispatches intentionally unavailable Subfinder in production mode", async () => {
    const result = await bridge("enabled").execute({
      specialistAgentId: "ReconScout",
      mcpServer: "pentest-mcp-recon",
      toolName: "subfinderEnum",
      arguments: { domain: "example.test" },
      startedAtMs: 0,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/allowlist|suppressed|denied|not a declared tool/u);
    expect(result.outputPreview).not.toContain("MOCK");
  });
  test("server not assigned to specialist denied", async () => {
    expect((await bridge("enabled").execute({ specialistAgentId: "WebBreaker", mcpServer: "sechub-reconnaissance", toolName: "quick_scan", startedAtMs: 0 })).error).toMatch(/allowlist|not assigned/);
  });
  test("rejects privileged or raw Nmap options at the reviewed V2 boundary before a server call", async () => {
    for (const arguments_ of [
      { target: "127.0.0.1", scanTechnique: "SYN" },
      { target: "127.0.0.1", scanTechnique: "Connect", udpScan: true },
      { target: "127.0.0.1", scanTechnique: "Connect", osDetection: true },
      { target: "127.0.0.1", scanTechnique: "Connect", rawOptions: ["--privileged"] },
    ]) {
      const result = await bridge("enabled").execute({
        specialistAgentId: "ReconScout",
        mcpServer: "pentest-mcp-recon",
        toolName: "nmapScan",
        arguments: arguments_,
        startedAtMs: 0,
      });
      expect(result.success).toBe(false);
      expect(result.error).toStartWith("invalid input:");
      expect(result.outputPreview).not.toContain("MOCK nmapScan");
    }
  });
  test("keeps direct and forged full-TCP bridge calls behind the ordinary 1024-port cap", async () => {
    let verifierCalls = 0;
    const result = await bridge("enabled", 20_000, {
      trustedNmapReady: true,
      acceptFixtureImplementation: true,
      verifier: () => { verifierCalls += 1; return { approved: true }; },
      now: () => APPROVAL_NOW,
    }).execute({
      runId: "run-full-tcp-1",
      stepId: "step-full-tcp-1",
      specialistAgentId: "ReconScout",
      mcpServer: "pentest-mcp-recon",
      toolName: "nmapScan",
      arguments: FULL_TCP_ARGUMENTS,
      startedAtMs: 0,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("1024-port Safe Recon boundary");
    expect(result.outputPreview).not.toContain("MOCK nmapScan");
    expect(verifierCalls).toBe(0);

    const denied = await bridge("enabled", 20_000, {
      trustedNmapReady: true,
      acceptFixtureImplementation: true,
      verifier: () => ({ approved: false, reason: "no runtime issuance receipt" }),
      now: () => APPROVAL_NOW,
    }).execute({
      runId: "run-full-tcp-1",
      stepId: "step-full-tcp-1",
      specialistAgentId: "ReconScout",
      mcpServer: "pentest-mcp-recon",
      toolName: "nmapScan",
      arguments: FULL_TCP_ARGUMENTS,
      approvalAttestation: autonomousFullTcpApproval(),
      startedAtMs: 0,
    });
    expect(denied.success).toBe(false);
    expect(denied.error).toContain("no runtime issuance receipt");
    expect(denied.outputPreview).not.toContain("MOCK nmapScan");

    const unavailable = await bridge("enabled", 20_000, {
      trustedNmapReady: true,
      acceptFixtureImplementation: true,
      now: () => APPROVAL_NOW,
    }).execute({
      runId: "run-full-tcp-1",
      stepId: "step-full-tcp-1",
      specialistAgentId: "ReconScout",
      mcpServer: "pentest-mcp-recon",
      toolName: "nmapScan",
      arguments: FULL_TCP_ARGUMENTS,
      approvalAttestation: autonomousFullTcpApproval(),
      startedAtMs: 0,
    });
    expect(unavailable.success).toBe(false);
    expect(unavailable.error).toContain("durable approval verifier is unavailable");
    expect(unavailable.outputPreview).not.toContain("MOCK nmapScan");
  });
  test("relaxes the cap only after one exact claim wins parallel durable verification", async () => {
    let releaseVerifier!: () => void;
    const release = new Promise<void>((resolve) => { releaseVerifier = resolve; });
    let verifierCalls = 0;
    const b = bridge("enabled", 20_000, {
      trustedNmapReady: true,
      acceptFixtureImplementation: true,
      now: () => APPROVAL_NOW,
      verifier: async () => {
        verifierCalls += 1;
        await release;
        return { approved: true };
      },
    });
    const input = {
      runId: "run-full-tcp-1",
      stepId: "step-full-tcp-1",
      specialistAgentId: "ReconScout",
      mcpServer: "pentest-mcp-recon",
      toolName: "nmapScan",
      arguments: FULL_TCP_ARGUMENTS,
      approvalAttestation: autonomousFullTcpApproval(),
      startedAtMs: 0,
    } as const;
    const first = b.execute(input);
    await Promise.resolve();
    const competing = b.execute(input);
    await Promise.resolve();
    releaseVerifier();
    const results = await Promise.all([first, competing]);
    expect(results.filter(({ success }) => success)).toHaveLength(1);
    expect(results.find(({ success }) => success)?.outputPreview).toContain("MOCK nmapScan");
    expect(results.find(({ success }) => !success)?.error).toContain("already consumed");
    expect(verifierCalls).toBe(1);

    const replay = await b.execute(input);
    expect(replay.success).toBe(false);
    expect(replay.error).toContain("already consumed");
    expect(verifierCalls).toBe(1);
  });
  test("enabled approval-required execution rejects a missing attestation without invoking its verifier", async () => {
    let verifierCalls = 0;
    const b = bridge("enabled", 20_000, {
      verifier: () => { verifierCalls += 1; return { approved: true }; },
      now: () => APPROVAL_NOW,
    });
    const result = await b.execute({
      runId: "run-exact-1", stepId: "step-exact-1", specialistAgentId: "ReconScout",
      mcpServer: "sechub-reconnaissance", toolName: "nmapScan", arguments: { target: "10.0.0.9" }, startedAtMs: 0,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("attestation is required");
    expect(result.outputPreview).not.toContain("MOCK");
    expect(verifierCalls).toBe(0);
  });
  test("an exact durable attestation executes once and replay fails before a second server call", async () => {
    const consumed = new Set<string>();
    let verifierCalls = 0;
    const verifier: McpApprovalAttestationVerifier = ({ attestation }) => {
      verifierCalls += 1;
      if (consumed.has(attestation.claimId)) return { approved: false, reason: "durable claim already consumed" };
      consumed.add(attestation.claimId);
      return { approved: true };
    };
    const b = bridge("enabled", 20_000, { verifier, now: () => APPROVAL_NOW });
    const input = {
      runId: "run-exact-1", stepId: "step-exact-1", specialistAgentId: "ReconScout",
      mcpServer: "sechub-reconnaissance", toolName: "nmapScan", arguments: { target: "10.0.0.9" },
      approvalAttestation: approval(), startedAtMs: 0,
    } as const;
    const first = await b.execute(input);
    const replay = await b.execute(input);
    expect(first.success).toBe(true);
    expect(first.outputPreview).toContain("MOCK nmapScan");
    expect(replay.success).toBe(false);
    expect(replay.error).toContain("already consumed");
    expect(verifierCalls).toBe(1);
  });
  test("changed arguments, tool, identity, expiry, and an unavailable verifier all fail closed", async () => {
    let verifierCalls = 0;
    const verifier: McpApprovalAttestationVerifier = () => { verifierCalls += 1; return { approved: true }; };
    const exact = approval();
    const base = {
      runId: exact.runId, stepId: exact.stepId, specialistAgentId: exact.specialistAgentId,
      mcpServer: exact.mcpServer, toolName: exact.toolName, arguments: { target: "10.0.0.9" },
      approvalAttestation: exact, startedAtMs: 0,
    } as const;
    expect((await bridge("enabled", 20_000, { verifier, now: () => APPROVAL_NOW }).execute({
      ...base, arguments: { target: "10.0.0.10" },
    })).error).toContain("exact execution binding");
    expect((await bridge("enabled", 20_000, { verifier, now: () => APPROVAL_NOW }).execute({
      ...base, toolName: "gobuster",
    })).error).toContain("exact execution binding");
    expect((await bridge("enabled", 20_000, { verifier, now: () => APPROVAL_NOW }).execute({
      ...base, runId: "run-changed",
    })).error).toContain("exact execution binding");
    expect((await bridge("enabled", 20_000, { verifier, now: () => APPROVAL_NOW }).execute({
      ...base, approvalAttestation: approval(undefined, { expiresAt: "2026-07-15T14:59:30.000Z" }),
    })).error).toContain("expired");
    expect((await bridge("enabled", 20_000, { now: () => APPROVAL_NOW }).execute(base)).error)
      .toContain("verifier is unavailable");
    expect(verifierCalls).toBe(0);
  });
  test("dry-run previews an approval-required call without consuming or executing it", async () => {
    let verifierCalls = 0;
    const result = await bridge("dry-run", 20_000, {
      verifier: () => { verifierCalls += 1; return { approved: true }; },
      now: () => APPROVAL_NOW,
    }).execute({
      runId: "run-exact-1", stepId: "step-exact-1", specialistAgentId: "ReconScout",
      mcpServer: "sechub-reconnaissance", toolName: "nmapScan", arguments: { target: "10.0.0.9" }, startedAtMs: 0,
    });
    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.outputPreview).toContain("approval-required");
    expect(result.outputPreview).not.toContain("MOCK nmapScan");
    expect(verifierCalls).toBe(0);
  });
});
