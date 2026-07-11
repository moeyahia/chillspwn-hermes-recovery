import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { McpServerRegistry } from "../McpServerRegistry";
import { McpArsenalBridge } from "../McpArsenalBridge";
import { callServerTool, listServerTools, flattenMcpContent, resolveStartCommand } from "../McpToolExecutor";

let dir: string, cfgPath: string, mockPath: string;
const MOCK = `import readline from "readline";
const rl = readline.createInterface({ input: process.stdin });
const send = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
rl.on("line", (line) => { let m; try { m = JSON.parse(line); } catch { return; }
  if (m.method === "initialize") send({ jsonrpc:"2.0", id:m.id, result:{ protocolVersion:"2024-11-05", capabilities:{}, serverInfo:{name:"mock",version:"1"} } });
  else if (m.method === "tools/list") send({ jsonrpc:"2.0", id:m.id, result:{ tools:[{name:"quick_scan"},{name:"port_scan"}] } });
  else if (m.method === "tools/call") { const big = m.params.arguments && m.params.arguments.big; send({ jsonrpc:"2.0", id:m.id, result:{ content:[{type:"text",text: big ? "X".repeat(50000) : ("MOCK "+m.params.name+" "+JSON.stringify(m.params.arguments))}], isError:false } }); } });`;

function bridge(mode: "disabled" | "dry-run" | "enabled", maxOut = 20000) {
  return new McpArsenalBridge({ configPath: cfgPath, manifestPath: join(import.meta.dir, "..", "..", "agents", "mcpArsenal.manifest.json"), mode, allowDocker: false, startServers: true, defaultTimeoutMs: 8000, maxOutputBytes: maxOut });
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "p16-"));
  mockPath = join(dir, "mock.mjs"); writeFileSync(mockPath, MOCK);
  cfgPath = join(dir, ".mcp.arsenal.json");
  writeFileSync(cfgPath, JSON.stringify({ mcpServers: {
    "mock-recon": { enabled: true, runtime: "stdio", command: "node", args: [mockPath], assignedAgents: ["ReconScout"], toolNames: ["quick_scan", "port_scan"], requiredBinaries: ["node"], requiredDockerImages: [], envTemplate: {}, apiKeysRequired: [], installMethod: "mock" },
    "needs-bin": { enabled: true, runtime: "stdio", command: "x", assignedAgents: ["WebBreaker"], toolNames: ["ffuf_dir"], requiredBinaries: ["definitely_missing_bin_xyz"], requiredDockerImages: [], envTemplate: {}, apiKeysRequired: [], installMethod: "mock" },
    "needs-key": { enabled: true, runtime: "stdio", command: "x", assignedAgents: ["OSINTSeeker"], toolNames: ["virustotal_lookup"], requiredBinaries: [], requiredDockerImages: [], envTemplate: { VT_API_KEY: "<set-me>" }, apiKeysRequired: ["VirusTotal"], installMethod: "mock" },
    "docker-srv": { enabled: true, runtime: "docker", assignedAgents: ["ReconScout"], toolNames: ["x"], requiredBinaries: [], requiredDockerImages: ["mcp/foo"], envTemplate: {}, apiKeysRequired: [], installMethod: "docker" },
    "off-srv": { enabled: false, runtime: "stdio", command: "node", args: [mockPath], assignedAgents: ["ReconScout"], toolNames: ["quick_scan"], requiredBinaries: [], requiredDockerImages: [], envTemplate: {}, apiKeysRequired: [], installMethod: "mock" },
  } }));
});
afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

describe("16.1 registry: load + health states", () => {
  test("loads config + manifest, no load error", () => { const r = new McpServerRegistry(cfgPath); expect(r.getLoadError()).toBeNull(); expect(r.list().length).toBe(5); });
  test("missing config → load error", () => { expect(new McpServerRegistry("/nope/x.json").getLoadError()).toContain("not found"); });
  test("health states: configured / missing_dependency / missing_secret / docker-gated / disabled", () => {
    const r = new McpServerRegistry(cfgPath);
    expect(r.health("mock-recon").state).toBe("configured");
    expect(r.health("needs-bin").state).toBe("missing_dependency");
    expect(r.health("needs-bin").missingBinaries).toContain("definitely_missing_bin_xyz");
    expect(r.health("needs-key").state).toBe("missing_secret");
    expect(r.health("needs-key").missingEnv).toContain("VT_API_KEY");
    expect(r.health("docker-srv", { allowDocker: false }).state).toBe("missing_dependency"); // docker gated
    expect(r.health("off-srv").state).toBe("disabled");
  });
  test("forAgent maps servers to specialists", () => { expect(new McpServerRegistry(cfgPath).forAgent("ReconScout").map(s => s.name)).toContain("mock-recon"); });
});

describe("16.2 stdio MCP client", () => {
  const spec: any = { name: "mock", runtime: "stdio", command: "node", args: [""], requiredDockerImages: [], toolNames: ["quick_scan"] };
  test("tools/list + tools/call against a real mock server", async () => {
    spec.args = [mockPath];
    const tl = await listServerTools(spec, { timeoutMs: 8000, allowDocker: false });
    expect(tl.ok).toBe(true); expect(tl.result.tools.map((t: any) => t.name)).toEqual(["quick_scan", "port_scan"]);
    const tc = await callServerTool(spec, "quick_scan", { target: "10.0.0.1" }, { timeoutMs: 8000, allowDocker: false });
    expect(flattenMcpContent(tc.result).text).toContain("MOCK quick_scan");
  });
  test("timeout + missing binary handled", async () => {
    expect((await callServerTool({ ...spec, command: "sleep", args: ["30"] }, "x", {}, { timeoutMs: 800, allowDocker: false })).error).toContain("timed out");
    expect((await callServerTool({ ...spec, command: "/no/such/bin" }, "x", {}, { timeoutMs: 3000, allowDocker: false })).ok).toBe(false);
  });
  test("docker without allowDocker is refused", () => {
    const r = resolveStartCommand({ name: "d", runtime: "docker", requiredDockerImages: ["img"] } as any, false);
    expect("error" in r).toBe(true);
  });
});

describe("16.x bridge: tool view + execute modes + binding", () => {
  test("specialist tool view: only its tools; isolation", () => {
    const b = bridge("enabled");
    const v = b.toolsForSpecialist("ReconScout")!;
    expect(v.availableTools).toContain("quick_scan");
    expect(b.toolsForSpecialist("WebBreaker")!.availableTools).not.toContain("quick_scan");
  });
  test("disabled mode never executes", async () => {
    const r = await bridge("disabled").execute({ specialistAgentId: "ReconScout", mcpServer: "mock-recon", toolName: "quick_scan", startedAtMs: 0 });
    expect(r.success).toBe(false); expect(r.error).toContain("disabled");
  });
  test("dry-run records but does NOT execute", async () => {
    const r = await bridge("dry-run").execute({ specialistAgentId: "ReconScout", mcpServer: "mock-recon", toolName: "quick_scan", arguments: { target: "x" }, startedAtMs: 0 });
    expect(r.dryRun).toBe(true); expect(r.success).toBe(true); expect(r.outputPreview).toContain("[dry-run]"); expect(r.outputPreview).not.toContain("MOCK quick_scan");
  });
  test("enabled mode executes the mocked MCP server", async () => {
    const r = await bridge("enabled").execute({ specialistAgentId: "ReconScout", mcpServer: "mock-recon", toolName: "quick_scan", arguments: { target: "10.0.0.9" }, startedAtMs: 0 });
    expect(r.success).toBe(true); expect(r.outputPreview).toContain("MOCK quick_scan");
  });
  test("large output is truncated for the preview (→ artifact upstream)", async () => {
    const r = await bridge("enabled", 2000).execute({ specialistAgentId: "ReconScout", mcpServer: "mock-recon", toolName: "quick_scan", arguments: { big: true }, startedAtMs: 0 });
    expect(r.fullOutputBytes).toBeGreaterThan(2000); expect(r.outputPreview).toContain("truncated"); expect(r.outputPreview.length).toBeLessThan(3000);
  });
  test("out-of-allowlist tool denied (defense in depth)", async () => {
    expect((await bridge("enabled").execute({ specialistAgentId: "ReconScout", mcpServer: "mock-recon", toolName: "hashcat", startedAtMs: 0 })).error).toContain("allowlist");
  });
  test("server not assigned to specialist denied", async () => {
    expect((await bridge("enabled").execute({ specialistAgentId: "WebBreaker", mcpServer: "mock-recon", toolName: "quick_scan", startedAtMs: 0 })).error).toMatch(/allowlist|not assigned/);
  });
});
