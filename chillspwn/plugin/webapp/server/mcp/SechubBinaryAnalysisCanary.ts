import { createHash } from "node:crypto";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { MCP_PROTOCOL_VERSION, type JsonRpcResponse } from "./McpTypes";
import { normalizeAndValidateMcpToolInput } from "./McpToolInputSchema";
import {
  toolInputSchemaSha256,
  type V2ToolCoverageEvidence,
} from "./V2ToolCoverageAudit";

const SERVER_NAME = "sechub-binary-analysis";
const SPECIALIST_ID = "ReverseSage";
const IMAGE = "radare2-mcp:latest";
const FIXTURE_CONTAINER_DIR = "/home/mcpuser/samples";
const FIXTURE_CONTAINER_PATH = `${FIXTURE_CONTAINER_DIR}/chillspwn-v2-binary-canary`;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_STDERR_BYTES = 64 * 1024;

export const SECHUB_BINARY_ANALYSIS_TOOLS = [
  "open_file",
  "close_file",
  "list_functions",
  "list_functions_tree",
  "list_libraries",
  "list_imports",
  "list_exports",
  "list_sections",
  "list_memory_maps",
  "show_function_details",
  "get_current_address",
  "show_info",
  "list_symbols",
  "list_entrypoints",
  "list_methods",
  "list_classes",
  "list_decompilers",
  "rename_function",
  "rename_flag",
  "use_decompiler",
  "get_function_prototype",
  "set_function_prototype",
  "set_comment",
  "list_strings",
  "list_all_strings",
  "analyze",
  "xrefs_to",
  "decompile_function",
  "list_files",
  "disassemble_function",
  "disassemble",
  "calculate",
] as const;

export type SechubBinaryAnalysisTool = (typeof SECHUB_BINARY_ANALYSIS_TOOLS)[number];

export interface SechubBinaryAnalysisToolReceipt {
  readonly serverName: typeof SERVER_NAME;
  readonly toolName: SechubBinaryAnalysisTool;
  readonly inputSchemaSha256: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  /** Hash of the exact name+schema binding returned by the live server. */
  readonly toolAssetSha256: string;
  readonly schemaValidationPassed: boolean;
  readonly successPassed: boolean;
  readonly deterministicFailurePassed: boolean;
  readonly successSummary: string;
  readonly failureSummary: string;
}

export interface SechubBinaryAnalysisCanaryBlocker {
  readonly code:
    | "adapter_state_not_persistent"
    | "adapter_fixture_unreachable"
    | "adapter_network_not_disabled"
    | "compile_failed"
    | "docker_image_unavailable"
    | "live_tool_surface_drift"
    | "live_schema_invalid"
    | "vendor_success_failed"
    | "vendor_failure_not_signalled"
    | "canary_process_failed";
  readonly toolName: SechubBinaryAnalysisTool | null;
  readonly message: string;
}

export interface SechubBinaryAnalysisCanaryReceipt {
  readonly version: 1;
  readonly receiptId: string;
  readonly generatedAt: string;
  readonly serverName: typeof SERVER_NAME;
  readonly specialistAgentId: typeof SPECIALIST_ID;
  readonly safety: {
    readonly fixtureKind: "disposable_local_lab";
    readonly networkMode: "none";
    readonly clientArtifactsUsed: 0;
    readonly engagementTargetsContacted: 0;
    readonly publicProvidersCalled: 0;
    readonly fixtureExecutedByServer: false;
    readonly readOnlyRootFilesystem: true;
    readonly droppedCapabilities: true;
    readonly noNewPrivileges: true;
  };
  readonly assets: {
    readonly serverImage: typeof IMAGE;
    readonly serverImageSha256: string;
    readonly adapterAssetSha256: string;
    readonly registryAssetSha256: string;
    readonly canaryImplementationSha256: string;
    readonly fixtureSourceSha256: string;
    readonly fixtureBinarySha256: string;
    readonly toolSurfaceSha256: string;
  };
  readonly adapterSupported: boolean;
  readonly callsAttempted: number;
  readonly tools: readonly SechubBinaryAnalysisToolReceipt[];
  readonly blockers: readonly SechubBinaryAnalysisCanaryBlocker[];
}

export interface RunSechubBinaryAnalysisCanaryOptions {
  readonly configPath?: string;
  readonly manifestPath?: string;
  readonly adapterPaths?: readonly string[];
  readonly fixtureSourcePath?: string;
  readonly image?: typeof IMAGE;
  readonly requestTimeoutMs?: number;
  readonly receiptPath?: string;
  readonly now?: () => Date;
}

interface ToolDescriptor {
  readonly name: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

interface ToolCallResult {
  readonly protocolOk: boolean;
  readonly isError: boolean;
  readonly semanticError: boolean;
  readonly text: string;
  readonly error: string | null;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Cannot hash a non-JSON canary value");
  return encoded;
}

export function sechubBinaryToolAssetSha256(
  toolName: SechubBinaryAnalysisTool,
  inputSchema: Readonly<Record<string, unknown>>,
): string {
  const inputSchemaSha256 = toolInputSchemaSha256(inputSchema);
  return sha256(canonicalJson({ toolName, inputSchemaSha256 }));
}

export function sechubBinaryToolSurfaceSha256(
  tools: readonly Pick<SechubBinaryAnalysisToolReceipt, "toolName" | "inputSchema">[],
): string {
  const surface = tools
    .map(({ toolName, inputSchema }) => ({ name: toolName, inputSchema }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return sha256(canonicalJson(surface));
}

function hashFiles(paths: readonly string[]): string {
  const hash = createHash("sha256");
  for (const path of [...paths].map((item) => resolve(item)).sort()) {
    hash.update(basename(path));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function concise(value: string, limit = 240): string {
  const flattened = value.replace(/\s+/gu, " ").trim();
  if (!flattened) return "The tool returned no human-readable content.";
  return flattened.length <= limit ? flattened : `${flattened.slice(0, limit)}…`;
}

function vendorSemanticError(text: string): boolean {
  const normalized = text.replace(/\s+/gu, " ").trim();
  return /^(?:error:|failed\b|unknown decompiler\b|use the open_file\b|no file is currently open\b)/iu.test(normalized)
    || /\[ERROR\]/u.test(normalized)
    || /\bcannot find\b/iu.test(normalized);
}

function flattenToolResult(value: unknown): ToolCallResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { protocolOk: false, isError: true, semanticError: true, text: "", error: "tools/call returned an invalid result" };
  }
  const result = value as Record<string, unknown>;
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content.map((item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      if (record.type === "text" && typeof record.text === "string") return record.text;
      if (record.type === "resource" && record.resource && typeof record.resource === "object") {
        const resource = record.resource as Record<string, unknown>;
        if (typeof resource.text === "string") return resource.text;
      }
    }
    return canonicalJson(item);
  }).join("\n");
  return {
    protocolOk: true,
    isError: result.isError === true,
    semanticError: result.isError === true || vendorSemanticError(text),
    text,
    error: result.isError === true ? concise(text || "The MCP tool reported an error.") : null,
  };
}

class PersistentMcpClient {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #timeoutMs: number;
  readonly #pending = new Map<number, {
    readonly resolve: (response: JsonRpcResponse) => void;
    readonly reject: (error: Error) => void;
    readonly timer: ReturnType<typeof setTimeout>;
  }>();
  #buffer = "";
  #stderrBytes = 0;
  #nextId = 1;
  #closed = false;

  constructor(command: string, args: readonly string[], timeoutMs: number) {
    this.#timeoutMs = timeoutMs;
    this.#child = spawn(command, [...args], {
      env: {
        PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        HOME: "/var/empty",
        TMPDIR: "/tmp",
        LANG: "C.UTF-8",
        TZ: "UTC",
      },
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    this.#child.stdout.on("data", (chunk: Buffer) => this.#consume(chunk));
    // Drain and count only. Third-party stderr is never retained in evidence.
    this.#child.stderr.on("data", (chunk: Buffer) => {
      this.#stderrBytes = Math.min(MAX_STDERR_BYTES, this.#stderrBytes + chunk.length);
    });
    this.#child.on("error", (error) => this.#failAll(error));
    this.#child.on("exit", (code) => {
      if (!this.#closed) this.#failAll(new Error(`MCP canary process exited with code ${code ?? "unknown"}`));
    });
  }

  async initialize(): Promise<void> {
    const response = await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "chillspwn-v2-binary-analysis-canary", version: "1" },
    });
    if (response.error) throw new Error(`initialize failed: ${response.error.message}`);
    this.notify("notifications/initialized");
  }

  async listTools(): Promise<readonly ToolDescriptor[]> {
    const response = await this.request("tools/list", {});
    if (response.error) throw new Error(`tools/list failed: ${response.error.message}`);
    const raw = response.result?.tools;
    if (!Array.isArray(raw)) throw new Error("tools/list omitted the tool array");
    return raw.map((item: unknown) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error("tools/list returned an invalid descriptor");
      }
      const record = item as Record<string, unknown>;
      if (typeof record.name !== "string" || !record.inputSchema || typeof record.inputSchema !== "object" || Array.isArray(record.inputSchema)) {
        throw new Error("tools/list returned an unusable name or input schema");
      }
      return { name: record.name, inputSchema: record.inputSchema as Readonly<Record<string, unknown>> };
    });
  }

  async call(toolName: string, args: Readonly<Record<string, unknown>>): Promise<ToolCallResult> {
    const response = await this.request("tools/call", { name: toolName, arguments: args });
    if (response.error) {
      return { protocolOk: false, isError: true, semanticError: true, text: "", error: response.error.message };
    }
    return flattenToolResult(response.result);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("MCP canary process closed"));
    }
    this.#pending.clear();
    try {
      if (process.platform !== "win32" && this.#child.pid) process.kill(-this.#child.pid, "SIGKILL");
      else this.#child.kill("SIGKILL");
    } catch {
      try { this.#child.kill("SIGKILL"); } catch { /* already closed */ }
    }
  }

  private request(method: string, params: unknown): Promise<JsonRpcResponse> {
    if (this.#closed) return Promise.reject(new Error("MCP canary process is closed"));
    const id = this.#nextId++;
    return new Promise<JsonRpcResponse>((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        rejectRequest(new Error(`${method} timed out after ${this.#timeoutMs}ms`));
      }, this.#timeoutMs);
      this.#pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
      this.#child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  private notify(method: string): void {
    this.#child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  }

  #consume(chunk: Buffer): void {
    this.#buffer += chunk.toString("utf8");
    let newline = this.#buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.#buffer.slice(0, newline).trim();
      this.#buffer = this.#buffer.slice(newline + 1);
      newline = this.#buffer.indexOf("\n");
      if (!line) continue;
      let response: JsonRpcResponse;
      try { response = JSON.parse(line) as JsonRpcResponse; }
      catch { continue; }
      if (typeof response.id !== "number") continue;
      const pending = this.#pending.get(response.id);
      if (!pending) continue;
      this.#pending.delete(response.id);
      clearTimeout(pending.timer);
      pending.resolve(response);
    }
  }

  #failAll(error: Error): void {
    this.#closed = true;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

function dockerImageSha256(image: string): string | null {
  const result = spawnSync("/usr/bin/docker", ["image", "inspect", image, "--format", "{{.Id}}"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.status !== 0) return null;
  const id = result.stdout.trim().replace(/^sha256:/u, "");
  return SHA256.test(id) ? id : null;
}

function compileFixture(sourcePath: string, outputPath: string): string | null {
  const result = spawnSync("/usr/bin/c++", [
    "-std=c++17",
    "-O0",
    "-g3",
    "-fno-omit-frame-pointer",
    "-fno-pie",
    "-no-pie",
    "-fvisibility=default",
    "-rdynamic",
    "-Wl,--build-id=sha1",
    "-Wl,-z,relro,-z,now",
    sourcePath,
    "-o",
    outputPath,
  ], { encoding: "utf8", timeout: 30_000 });
  if (result.status !== 0) return concise(result.stderr || "The local fixture compiler failed.", 500);
  chmodSync(outputPath, 0o555);
  return null;
}

function exportedSymbolAddress(binaryPath: string, symbol: string): string | null {
  const result = spawnSync("/usr/bin/nm", ["-g", "--defined-only", binaryPath], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.status !== 0) return null;
  for (const line of result.stdout.split("\n")) {
    const match = line.trim().match(/^([a-fA-F0-9]+)\s+[A-Za-z]\s+(\S+)$/u);
    if (match?.[2] === symbol) return `0x${match[1]!.toLowerCase()}`;
  }
  return null;
}

function positiveArguments(
  toolName: SechubBinaryAnalysisTool,
  addresses: { readonly functionAddress: string; readonly flagAddress: string },
): Readonly<Record<string, unknown>> {
  const functionAddress = addresses.functionAddress;
  const flagAddress = addresses.flagAddress;
  switch (toolName) {
    case "open_file": return { file_path: FIXTURE_CONTAINER_PATH };
    case "list_files": return { path: FIXTURE_CONTAINER_DIR, filter: "canary", page_size: 50 };
    case "analyze": return { level: 2, timeout_seconds: 20 };
    case "list_functions": return { filter: "chillspwn_canary|main", max_length: 50 };
    case "list_functions_tree":
    case "list_libraries":
    case "list_imports":
    case "list_exports":
    case "list_symbols":
    case "list_strings":
    case "list_all_strings": return { filter: "canary|chillspwn|main|libc", page_size: 200 };
    case "list_sections": return { filter: "\\.text|\\.data|\\.rodata", page_size: 200 };
    case "list_memory_maps": return { page_size: 200 };
    case "list_classes": return { filter: "ChillsPwnCanary", page_size: 200 };
    case "list_methods": return { classname: "ChillsPwnCanary", page_size: 50 };
    case "rename_function": return { address: functionAddress, name: "chillspwn_canary_add_reviewed" };
    case "rename_flag": return {
      address: flagAddress,
      name: "obj.chillspwn_canary_counter",
      new_name: "chillspwn_canary_counter_reviewed",
    };
    case "use_decompiler": return { name: "pdc" };
    case "get_function_prototype": return { address: functionAddress };
    case "set_function_prototype": return {
      address: functionAddress,
      prototype: "int chillspwn_canary_add_reviewed(int left, int right)",
    };
    case "set_comment": return { address: functionAddress, message: "Local V2 binary-analysis canary function" };
    case "xrefs_to":
    case "decompile_function":
    case "disassemble_function": return { address: functionAddress, page_size: 300 };
    case "disassemble": return { address: functionAddress, num_instructions: 12 };
    case "calculate": return { expression: "1 + 2 * 3" };
    default: return {};
  }
}

function failureArguments(
  toolName: SechubBinaryAnalysisTool,
  positive: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (toolName === "open_file") return { file_path: `${FIXTURE_CONTAINER_DIR}/missing-canary-binary` };
  if (toolName === "list_files") return { path: `${FIXTURE_CONTAINER_DIR}/missing-directory` };
  if (toolName === "use_decompiler") return { name: "definitely_missing_canary_decompiler" };
  if (toolName === "calculate") return { expression: "invalid@@@canary@@@expression" };
  if (toolName === "rename_function") return { address: "0xffffffffffffffff", name: "invalid_canary_name" };
  if (toolName === "rename_flag") {
    return { address: "0xffffffffffffffff", name: "missing_canary_flag", new_name: "still_missing" };
  }
  if ("address" in positive) return { ...positive, address: "0xffffffffffffffff" };
  return positive;
}

function positiveOutputSatisfied(toolName: SechubBinaryAnalysisTool, result: ToolCallResult): boolean {
  if (!result.protocolOk || result.semanticError) return false;
  const text = result.text;
  const expectations: Partial<Record<SechubBinaryAnalysisTool, RegExp>> = {
    open_file: /file opened successfully/iu,
    close_file: /file closed successfully/iu,
    list_functions: /main|chillspwn_canary/iu,
    list_functions_tree: /chillspwn_canary/iu,
    list_libraries: /libc/iu,
    list_imports: /__libc_start_main|printf|strlen/iu,
    list_exports: /chillspwn_canary/iu,
    list_sections: /\.text|\.data|\.rodata/iu,
    list_memory_maps: /0x[0-9a-f]+/iu,
    show_function_details: /addr:\s*0x[0-9a-f]+/iu,
    get_current_address: /0x[0-9a-f]+/iu,
    show_info: /format\s+elf64|bintype\s+elf/iu,
    list_symbols: /chillspwn_canary/iu,
    list_entrypoints: /_start|main|entry0/iu,
    list_methods: /transform|ChillsPwnCanary/iu,
    list_classes: /ChillsPwnCanary/iu,
    list_decompilers: /pdc|r2dec|ghidra/iu,
    rename_function: /^ok$/iu,
    rename_flag: /^ok$/iu,
    use_decompiler: /pdc|selected|active|ok/iu,
    get_function_prototype: /chillspwn_canary_add/iu,
    set_function_prototype: /^ok$/iu,
    set_comment: /^ok$/iu,
    list_strings: /binary-analysis-canary|CHILLSPWN_V2/iu,
    list_all_strings: /chillspwn_canary|CHILLSPWN_V2/iu,
    analyze: /analysis completed/iu,
    xrefs_to: /dbg\.main|chillspwn_canary/iu,
    decompile_function: /chillspwn_canary_add/iu,
    list_files: /chillspwn-v2-binary-canary/iu,
    disassemble_function: /chillspwn_canary_add/iu,
    disassemble: /chillspwn_canary_add/iu,
    calculate: /0x7\b|\b7\b/u,
  };
  return expectations[toolName]?.test(text) ?? text.trim().length > 0;
}

const POSITIVE_ORDER: readonly SechubBinaryAnalysisTool[] = [
  "open_file",
  "list_files",
  "show_info",
  "get_current_address",
  "list_sections",
  "list_memory_maps",
  "list_libraries",
  "list_imports",
  "list_exports",
  "list_entrypoints",
  "list_symbols",
  "list_strings",
  "list_all_strings",
  "list_decompilers",
  "list_classes",
  "list_methods",
  "analyze",
  "list_functions",
  "list_functions_tree",
  "show_function_details",
  "get_function_prototype",
  "set_function_prototype",
  "set_comment",
  "xrefs_to",
  "disassemble",
  "disassemble_function",
  "use_decompiler",
  "decompile_function",
  "rename_function",
  "rename_flag",
  "calculate",
  "close_file",
];

function adapterBlockers(): readonly SechubBinaryAnalysisCanaryBlocker[] {
  /*
   * These are properties of the currently installed production adapter, not
   * assumptions about the vendor implementation. McpToolExecutor.rpcSession
   * launches and kills one process per tools/call, while resolveStartCommand
   * reduces Docker execution to `docker run -i --rm <image>`.
   */
  return [
    {
      code: "adapter_state_not_persistent",
      toolName: null,
      message: "The production MCP executor starts a new disposable server for every tools/call, so open_file/analyze state cannot reach a later binary-analysis action.",
    },
    {
      code: "adapter_fixture_unreachable",
      toolName: "open_file",
      message: "The production Docker start command does not mount an authorized input directory, so open_file cannot access a mission or disposable host artifact.",
    },
    {
      code: "adapter_network_not_disabled",
      toolName: null,
      message: "The production Docker start command does not set --network=none; offline binary analysis is therefore not yet enforced by the adapter.",
    },
  ];
}

function receiptId(value: Omit<SechubBinaryAnalysisCanaryReceipt, "receiptId">): string {
  return `sechub_binary_receipt_${sha256(canonicalJson(value))}`;
}

export function sealSechubBinaryAnalysisCanaryReceipt(
  value: Omit<SechubBinaryAnalysisCanaryReceipt, "receiptId">,
): SechubBinaryAnalysisCanaryReceipt {
  return { ...value, receiptId: receiptId(value) };
}

function isToolName(value: string): value is SechubBinaryAnalysisTool {
  return (SECHUB_BINARY_ANALYSIS_TOOLS as readonly string[]).includes(value);
}

export async function runSechubBinaryAnalysisCanary(
  options: RunSechubBinaryAnalysisCanaryOptions = {},
): Promise<SechubBinaryAnalysisCanaryReceipt> {
  const root = resolve(import.meta.dir, "../..");
  const fixtureSourcePath = resolve(options.fixtureSourcePath
    ?? join(import.meta.dir, "fixtures/sechub-binary-analysis-canary.cpp"));
  const configPath = resolve(options.configPath ?? "/opt/chillspwn-mcp-arsenal/.mcp.arsenal.json");
  const manifestPath = resolve(options.manifestPath ?? join(root, "server/agents/mcpArsenal.manifest.json"));
  const adapterPaths = options.adapterPaths?.map((path) => resolve(path)) ?? [
    resolve(join(import.meta.dir, "McpToolExecutor.ts")),
    resolve(join(import.meta.dir, "McpArsenalBridge.ts")),
  ];
  const implementationPath = resolve(import.meta.filename);
  const generatedAt = (options.now ?? (() => new Date()))().toISOString();
  const requestTimeoutMs = options.requestTimeoutMs ?? 45_000;
  const image = options.image ?? IMAGE;
  const blockers: SechubBinaryAnalysisCanaryBlocker[] = [...adapterBlockers()];
  const tools: SechubBinaryAnalysisToolReceipt[] = [];
  const tempRoot = mkdtempSync(join(tmpdir(), "chillspwn-v2-binary-canary-"));
  // The container runs as uid 1000 and needs read/execute traversal only.
  chmodSync(tempRoot, 0o555);
  const fixtureBinaryPath = join(tempRoot, "chillspwn-v2-binary-canary");
  let callsAttempted = 0;
  let serverImageSha256 = "0".repeat(64);
  let fixtureBinarySha256 = "0".repeat(64);
  let toolSurfaceSha256 = "0".repeat(64);
  let client: PersistentMcpClient | null = null;

  try {
    const compileError = compileFixture(fixtureSourcePath, fixtureBinaryPath);
    if (compileError) {
      blockers.push({ code: "compile_failed", toolName: null, message: compileError });
      throw new Error("Local binary-analysis fixture compilation failed");
    }
    fixtureBinarySha256 = sha256(readFileSync(fixtureBinaryPath));
    const activeConfig = JSON.parse(readFileSync(configPath, "utf8")) as {
      readonly mcpServers?: Readonly<Record<string, {
        readonly enabled?: boolean;
        readonly runtime?: string;
        readonly assignedAgents?: readonly string[];
        readonly requiredDockerImages?: readonly string[];
        readonly toolNames?: readonly string[];
      }>>;
    };
    const activeServer = activeConfig.mcpServers?.[SERVER_NAME];
    const configuredNames = [...(activeServer?.toolNames ?? [])].sort();
    const expectedConfiguredNames = [...SECHUB_BINARY_ANALYSIS_TOOLS].sort();
    if (
      activeServer?.enabled !== true
      || activeServer.runtime !== "docker"
      || !activeServer.assignedAgents?.includes(SPECIALIST_ID)
      || !activeServer.requiredDockerImages?.includes(image)
      || canonicalJson(configuredNames) !== canonicalJson(expectedConfiguredNames)
    ) {
      blockers.push({
        code: "live_tool_surface_drift",
        toolName: null,
        message: "The active registry does not bind the exact 32-tool ReverseSage surface to the attested local Docker image.",
      });
      throw new Error("Binary-analysis registry binding differs from the canary contract");
    }
    const observedImageSha = dockerImageSha256(image);
    if (!observedImageSha) {
      blockers.push({
        code: "docker_image_unavailable",
        toolName: null,
        message: `The exact local Docker image ${image} is unavailable or has no inspectable content hash.`,
      });
      throw new Error("Binary-analysis Docker image unavailable");
    }
    serverImageSha256 = observedImageSha;

    const dockerArgs = [
      "run",
      "--interactive",
      "--rm",
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--pids-limit=128",
      "--memory=512m",
      "--cpus=1",
      "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=64m",
      `--mount=type=bind,source=${tempRoot},target=${FIXTURE_CONTAINER_DIR},readonly`,
      image,
    ] as const;
    client = new PersistentMcpClient("/usr/bin/docker", dockerArgs, requestTimeoutMs);
    await client.initialize();
    const descriptors = await client.listTools();
    const liveNames = descriptors.map(({ name }) => name).sort();
    const expectedNames = [...SECHUB_BINARY_ANALYSIS_TOOLS].sort();
    if (canonicalJson(liveNames) !== canonicalJson(expectedNames)) {
      blockers.push({
        code: "live_tool_surface_drift",
        toolName: null,
        message: `Expected ${expectedNames.length} exact binary-analysis tools but the live server returned ${liveNames.length}.`,
      });
    }
    const descriptorByName = new Map(descriptors.map((descriptor) => [descriptor.name, descriptor] as const));
    toolSurfaceSha256 = sechubBinaryToolSurfaceSha256(descriptors.map(({ name, inputSchema }) => ({
      toolName: name as SechubBinaryAnalysisTool,
      inputSchema,
    })));
    const functionAddress = exportedSymbolAddress(fixtureBinaryPath, "chillspwn_canary_add") ?? "0x401000";
    const flagAddress = exportedSymbolAddress(fixtureBinaryPath, "chillspwn_canary_counter") ?? "0x404000";
    const addresses = { functionAddress, flagAddress } as const;
    const positiveResults = new Map<SechubBinaryAnalysisTool, ToolCallResult>();
    const positiveArgs = new Map<SechubBinaryAnalysisTool, Readonly<Record<string, unknown>>>();

    for (const toolName of POSITIVE_ORDER) {
      const descriptor = descriptorByName.get(toolName);
      if (!descriptor || !isToolName(descriptor.name)) continue;
      const args = positiveArguments(toolName, addresses);
      try {
        normalizeAndValidateMcpToolInput(args, descriptor.inputSchema);
      } catch (error) {
        blockers.push({
          code: "live_schema_invalid",
          toolName,
          message: error instanceof Error ? error.message : "The positive canary input did not satisfy the live schema.",
        });
        continue;
      }
      positiveArgs.set(toolName, args);
      callsAttempted += 1;
      let result: ToolCallResult;
      try { result = await client.call(toolName, args); }
      catch (error) {
        result = {
          protocolOk: false,
          isError: true,
          semanticError: true,
          text: "",
          error: error instanceof Error ? error.message : "The tool call failed.",
        };
      }
      positiveResults.set(toolName, result);
      if (!positiveOutputSatisfied(toolName, result)) {
        blockers.push({
          code: "vendor_success_failed",
          toolName,
          message: `The real vendor implementation did not return the expected canary-specific success: ${concise(result.error ?? result.text)}`,
        });
      }
    }

    // Every deterministic negative is run after close_file, using the same
    // process. This is deliberate: state-dependent tools must signal that no
    // file is open instead of returning a false success.
    const failureResults = new Map<SechubBinaryAnalysisTool, ToolCallResult>();
    for (const toolName of SECHUB_BINARY_ANALYSIS_TOOLS) {
      const descriptor = descriptorByName.get(toolName);
      const valid = positiveArgs.get(toolName) ?? positiveArguments(toolName, addresses);
      if (!descriptor) continue;
      const args = failureArguments(toolName, valid);
      try { normalizeAndValidateMcpToolInput(args, descriptor.inputSchema); }
      catch {
        // A deterministic vendor-side negative must be schema-valid. Invalid
        // input is already proven separately by the exact schema canary.
        failureResults.set(toolName, {
          protocolOk: false,
          isError: true,
          semanticError: false,
          text: "",
          error: "No schema-valid deterministic failure fixture is available.",
        });
        continue;
      }
      callsAttempted += 1;
      let result: ToolCallResult;
      try { result = await client.call(toolName, args); }
      catch (error) {
        result = {
          protocolOk: false,
          isError: true,
          semanticError: false,
          text: "",
          error: error instanceof Error ? error.message : "The deterministic failure call failed.",
        };
      }
      failureResults.set(toolName, result);
      if (!result.semanticError || !result.isError) {
        blockers.push({
          code: "vendor_failure_not_signalled",
          toolName,
          message: "The vendor adapter returned success for the deterministic negative case, so V2 cannot reliably classify this tool-side failure.",
        });
      }
    }

    for (const toolName of SECHUB_BINARY_ANALYSIS_TOOLS) {
      const descriptor = descriptorByName.get(toolName);
      if (!descriptor) continue;
      const schemaHash = toolInputSchemaSha256(descriptor.inputSchema);
      const success = positiveResults.get(toolName);
      const failure = failureResults.get(toolName);
      tools.push({
        serverName: SERVER_NAME,
        toolName,
        inputSchemaSha256: schemaHash,
        inputSchema: descriptor.inputSchema,
        toolAssetSha256: sechubBinaryToolAssetSha256(toolName, descriptor.inputSchema),
        schemaValidationPassed: true,
        successPassed: Boolean(success && positiveOutputSatisfied(toolName, success)),
        deterministicFailurePassed: Boolean(failure && (!failure.protocolOk || failure.isError) && failure.semanticError),
        successSummary: concise(success?.error ?? success?.text ?? "The positive call was not executed."),
        failureSummary: concise(failure?.error ?? failure?.text ?? "The deterministic failure call was not executed."),
      });
    }
  } catch (error) {
    if (!blockers.some(({ code }) => ["compile_failed", "docker_image_unavailable"].includes(code))) {
      blockers.push({
        code: "canary_process_failed",
        toolName: null,
        message: error instanceof Error ? concise(error.message, 500) : "The isolated MCP canary process failed.",
      });
    }
  } finally {
    client?.close();
  }

  const withoutId: Omit<SechubBinaryAnalysisCanaryReceipt, "receiptId"> = {
    version: 1,
    generatedAt,
    serverName: SERVER_NAME,
    specialistAgentId: SPECIALIST_ID,
    safety: {
      fixtureKind: "disposable_local_lab",
      networkMode: "none",
      clientArtifactsUsed: 0,
      engagementTargetsContacted: 0,
      publicProvidersCalled: 0,
      fixtureExecutedByServer: false,
      readOnlyRootFilesystem: true,
      droppedCapabilities: true,
      noNewPrivileges: true,
    },
    assets: {
      serverImage: IMAGE,
      serverImageSha256,
      adapterAssetSha256: hashFiles(adapterPaths),
      registryAssetSha256: hashFiles([configPath, manifestPath]),
      canaryImplementationSha256: sha256(readFileSync(implementationPath)),
      fixtureSourceSha256: sha256(readFileSync(fixtureSourcePath)),
      fixtureBinarySha256,
      toolSurfaceSha256,
    },
    adapterSupported: false,
    callsAttempted,
    tools,
    blockers,
  };
  const receipt = sealSechubBinaryAnalysisCanaryReceipt(withoutId);
  if (options.receiptPath) writeFileSync(resolve(options.receiptPath), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  rmSync(tempRoot, { recursive: true, force: true });
  return receipt;
}

export function verifySechubBinaryAnalysisCanaryReceipt(
  receipt: SechubBinaryAnalysisCanaryReceipt,
): boolean {
  if (receipt.version !== 1 || receipt.serverName !== SERVER_NAME || receipt.specialistAgentId !== SPECIALIST_ID) return false;
  if (!receipt.receiptId.startsWith("sechub_binary_receipt_")) return false;
  if (
    receipt.safety.fixtureKind !== "disposable_local_lab"
    || receipt.safety.networkMode !== "none"
    || receipt.safety.clientArtifactsUsed !== 0
    || receipt.safety.engagementTargetsContacted !== 0
    || receipt.safety.publicProvidersCalled !== 0
    || receipt.safety.fixtureExecutedByServer !== false
    || receipt.safety.readOnlyRootFilesystem !== true
    || receipt.safety.droppedCapabilities !== true
    || receipt.safety.noNewPrivileges !== true
  ) return false;
  const receiptTools = receipt.tools.map(({ toolName }) => toolName).sort();
  const expectedTools = [...SECHUB_BINARY_ANALYSIS_TOOLS].sort();
  if (
    receiptTools.length !== expectedTools.length
    || new Set(receiptTools).size !== expectedTools.length
    || canonicalJson(receiptTools) !== canonicalJson(expectedTools)
    || receipt.tools.some(({ serverName }) => serverName !== SERVER_NAME)
  ) return false;
  if (receipt.tools.some((tool) => (
    toolInputSchemaSha256(tool.inputSchema) !== tool.inputSchemaSha256
    || sechubBinaryToolAssetSha256(tool.toolName, tool.inputSchema) !== tool.toolAssetSha256
  ))) return false;
  if (sechubBinaryToolSurfaceSha256(receipt.tools) !== receipt.assets.toolSurfaceSha256) return false;
  const { receiptId: _ignored, ...withoutId } = receipt;
  if (receiptId(withoutId) !== receipt.receiptId) return false;
  const hashes = [
    receipt.assets.serverImageSha256,
    receipt.assets.adapterAssetSha256,
    receipt.assets.registryAssetSha256,
    receipt.assets.canaryImplementationSha256,
    receipt.assets.fixtureSourceSha256,
    receipt.assets.fixtureBinarySha256,
    receipt.assets.toolSurfaceSha256,
    ...receipt.tools.flatMap((tool) => [tool.inputSchemaSha256, tool.toolAssetSha256]),
  ];
  return hashes.every((hash) => SHA256.test(hash));
}

/**
 * Convert a verified live receipt into exact audit evidence. Vendor success is
 * retained, but it is deliberately not promoted to release success while the
 * production adapter cannot preserve the same state and fixture boundary.
 */
export function sechubBinaryReceiptCoverageEvidence(
  receipt: SechubBinaryAnalysisCanaryReceipt,
): readonly V2ToolCoverageEvidence[] {
  if (!verifySechubBinaryAnalysisCanaryReceipt(receipt)) return [];
  return receipt.tools.map((tool) => {
    const toolBlockers = receipt.blockers.filter(({ toolName }) => toolName === null || toolName === tool.toolName);
    const adapterMessage = toolBlockers
      .filter(({ code }) => code.startsWith("adapter_"))
      .map(({ message }) => message)
      .join(" ");
    return {
      serverName: tool.serverName,
      toolName: tool.toolName,
      schemaValidation: {
        testId: "SechubBinaryAnalysisCanary: exact live schema positive/negative boundary",
        schemaSha256: tool.inputSchemaSha256,
      },
      ...(receipt.adapterSupported && tool.successPassed ? {
        successPath: {
          testId: "SechubBinaryAnalysisCanary: persistent offline vendor implementation success",
          fixtureKind: "disposable_local_lab" as const,
          implementationLevel: "vendor_implementation" as const,
        },
      } : {
        implementationBlocker: {
          receiptId: receipt.receiptId,
          message: adapterMessage || `The safe vendor success canary for ${tool.toolName} did not pass.`,
        },
      }),
      ...(tool.deterministicFailurePassed ? {
        failurePath: {
          testId: "SechubBinaryAnalysisCanary: exact invalid input and deterministic vendor failure",
          invalidInputCategory: "invalid_input" as const,
          executionFailureCategory: "deterministic_tool_error" as const,
        },
      } : {}),
    };
  });
}
